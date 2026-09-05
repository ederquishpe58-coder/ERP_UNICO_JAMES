import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const files = {
  navigation: "scripts/config/navigation.js",
  policy: "scripts/config/capability-policy.js",
  runtime: "scripts/services/security/capability-runtime.js",
  menu: "scripts/services/navigation/menu-service.js",
  domain: "scripts/services/sync/domain-loader.js",
  realtime: "scripts/services/sync/realtime-sync.js",
  modules: "scripts/core/module-loader.js",
  layout: "scripts/ui/layout.js",
  payroll: "scripts/modules/payroll/index.js",
  u2c1: "supabase/migrations/202608250004_capability_security_engine_foundation.sql"
};
const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])
));

function profileGrants(profileId) {
  const marker = `select '${profileId}', unnest(array[`;
  const start = source.u2c1.indexOf(marker);
  assert.ok(start >= 0, `No existe matriz ${profileId}.`);
  const end = source.u2c1.indexOf("]);", start);
  return [...source.u2c1.slice(start, end).matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g)]
    .map(match => match[1]);
}

const commercial = profileGrants("COMERCIAL");
const accounting = profileGrants("CONTABILIDAD");
assert.equal(commercial.length, 23);
assert.equal(commercial.filter(id => id.endsWith(".view")).length, 15);
assert.equal(accounting.length, 32);
assert.equal(accounting.filter(id => id.endsWith(".view")).length, 21);

function browserContext(capabilities) {
  const listeners = new Map();
  const rpcCalls = [];
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const window = {
    BlessERP: {}, CustomEvent, setTimeout, clearTimeout,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    }
  };
  const context = vm.createContext({ window, CustomEvent, console, setTimeout, clearTimeout, Date, Map, Set, URL });
  vm.runInContext(source.navigation, context, { filename: files.navigation });
  vm.runInContext(source.policy, context, { filename: files.policy });
  window.BlessERP.authAccess = { activeAccess: () => ({
    session: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    activeCompany: { id: "11111111-1111-4111-8111-111111111111", company_key: "COMPANY-A" },
    companies: [
      { id: "11111111-1111-4111-8111-111111111111", company_key: "COMPANY-A" },
      { id: "22222222-2222-4222-8222-222222222222", company_key: "COMPANY-B" }
    ]
  }) };
  window.BlessERP.services = { companyContext: { activeCompanyId: () => "COMPANY-A" } };
  window.BlessERP.state = { state: { db: { activeCompanyId: "COMPANY-A" } } };
  window.BlessERP.getSupabaseClient = () => ({ async rpc(name, args) {
    rpcCalls.push({ name, companyId: args.p_company_id });
    if (name === "erp_security_get_permission_version") {
      return { data: [{ catalog_version: 1, company_version: 4, security_token: "1:4" }], error: null };
    }
    if (name === "erp_security_get_effective_capabilities") {
      const rows = args.p_company_id.endsWith("2222") ? [] : capabilities.map(capability_id => ({ capability_id }));
      return { data: rows, error: null };
    }
    throw new Error(`RPC inesperado ${name}`);
  } });
  vm.runInContext(source.runtime, context, { filename: files.runtime });
  return { window, rpcCalls };
}

const commercialBrowser = browserContext(commercial);
const runtime = commercialBrowser.window.BlessERP.capabilityRuntime;
const policy = commercialBrowser.window.BlessERP.capabilityPolicy;
const resolved = await runtime.bootstrap();
assert.equal(policy.mode.shadow, true);
assert.equal(policy.mode.hardEnforcement, true);
assert.equal(resolved.effectiveCapabilityCount, 23);
assert.equal(runtime.evaluateRoute("commercial-orders-day", { legacyAllowed: false }).allowed, true);
const deniedRoute = runtime.evaluateRoute("accounting-journal", { legacyAllowed: true });
assert.equal(deniedRoute.allowed, false);
assert.equal(deniedRoute.enforced, true);
assert.equal(runtime.can("unknown.resource.view"), false);

runtime.invalidateCapabilities("COMPANY_SWITCH", { companyId: "COMPANY-B" });
assert.equal(runtime.can("commercial.orders.view"), false, "Invalidación debe denegar inmediatamente.");
const secondary = await runtime.refreshCapabilities({ companyId: "COMPANY-B" });
assert.equal(secondary.effectiveCapabilityCount, 0);
assert.equal(secondary.companyId, "22222222-2222-4222-8222-222222222222");

assert.match(source.menu, /capabilityDecision\?\.enforced === true \? capabilityDecision\.allowed : legacyAllowed/);
assert.doesNotMatch(source.menu, /function canCurrentUserAccessRoute[\s\S]{0,500}return legacyAllowed;/);
assert.match(source.domain, /CAPABILITY_DOMAIN_REQUIRED/);
assert.ok(source.domain.indexOf("CAPABILITY_DOMAIN_REQUIRED") < source.domain.indexOf("entitiesForDomain?.(domain)"),
  "Domain guard debe ejecutarse antes de resolver repositorio/entidades.");
assert.match(source.realtime, /capabilityDecision\?\.enforced === true && capabilityDecision\.allowed !== true\) return/);
assert.match(source.modules, /CAPABILITY_ROUTE_REQUIRED/);
assert.match(source.layout, /data-capability-access-denied/);
assert.match(source.layout, /erp:capabilities-refreshed/);
assert.match(source.domain, /id\.startsWith\("payroll-"\)\) return \["payroll", "treasury-catalog"\]/);
assert.doesNotMatch(source.payroll, /ensureDomain\([^)]*treasury-workspace/);
assert.doesNotMatch(source.runtime, /erp_security_assert_capability|assert_capability/,
  "U2C2B no activa enforcement en RPC de negocio.");

console.log(JSON.stringify({
  ok: true,
  hardEnforcement: true,
  shadowDiagnostics: true,
  navigationRoutesMapped: policy.routeCount,
  commercialCapabilities: commercial.length,
  accountingCapabilities: accounting.length,
  legacyAllowFallback: false,
  routeFailClosed: true,
  domainFailClosedBeforeRepository: true,
  realtimeUnauthorizedIgnored: true,
  companySwitchImmediateDeny: true,
  secondaryCompanyCapabilities: secondary.effectiveCapabilityCount,
  businessRpcAuthorizationChanged: false,
  payrollBankCatalog: "PRESERVED_CATALOG_ONLY"
}, null, 2));
