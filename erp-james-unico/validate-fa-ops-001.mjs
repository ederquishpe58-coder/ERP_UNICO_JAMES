import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const navigationSource = read("scripts/config/navigation.js");
const treeSource = read("scripts/config/navigation-tree.js");
const policySource = read("scripts/config/capability-policy.js");
const menuSource = read("scripts/services/navigation/menu-service.js");
const stateSource = read("scripts/core/state.js");
const operationsSource = read("scripts/modules/operaciones/index.js");
const defaultRouteSources = [
  "scripts/modules/operaciones/recepcion-flor.js",
  "scripts/modules/operaciones/clasificacion.js",
  "scripts/modules/operaciones/ingreso-ramos-scanner.js",
  "scripts/modules/operaciones/inventario-rosas.js"
].map(relative => ({ relative, source: read(relative) }));
const profileMigration = read("supabase/migrations/202608250004_capability_security_engine_foundation.sql");

function profileCapabilities(profileId) {
  const pattern = new RegExp(
    `select\\s+'${profileId}',\\s*unnest\\(array\\[([\\s\\S]*?)\\]\\);`,
    "i"
  );
  const block = profileMigration.match(pattern)?.[1] || "";
  return new Set([...block.matchAll(/'([^']+)'/g)].map(match => match[1]));
}

let effectiveCapabilities = new Set();
let permissionToken = "FA-OPS-001";
const persistedUi = [];
const routeUrls = [];
const db = {
  activeCompanyId: "COMPANY-TEST",
  session: { activeUser: { id: "USER-TEST", status: "activo", role: "ADMIN" } },
  visualUsers: []
};
const context = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  navigator: { onLine: true },
  window: null,
  globalThis: null
};
context.window = context;
context.globalThis = context;
context.location = {
  href: "https://preview.test/?route=operations-postharvest",
  search: "?route=operations-postharvest",
  protocol: "https:"
};
context.history = {
  replaceState(_state, _title, url) {
    routeUrls.push(String(url));
    context.location.href = String(url);
    context.location.search = new URL(String(url)).search;
  }
};
context.addEventListener = () => {};
context.BlessERP = {
  storage: {
    load: () => db,
    loadUi: () => ({ currentRoute: "operations-postharvest", sidebarBehaviorVersion: 3 }),
    saveUi: value => persistedUi.push(structuredClone(value))
  },
  services: {
    companyContext: { activeCompanyId: () => "COMPANY-TEST" }
  },
  companyCapabilities: {
    COMPANY_IDS: { BLESS: "COMPANY-TEST" },
    filterMenuRecords: records => records
  },
  performance: { beginRouteTransition: () => {} }
};

const sandbox = vm.createContext(context);
vm.runInContext(navigationSource, sandbox, { filename: "navigation.js" });
vm.runInContext(treeSource, sandbox, { filename: "navigation-tree.js" });
vm.runInContext(policySource, sandbox, { filename: "capability-policy.js" });
context.BlessERP.capabilityRuntime = {
  evaluateRoute(routeId) {
    const required = context.BlessERP.capabilityPolicy.requiredCapability(routeId);
    return { enforced: true, allowed: Boolean(required && effectiveCapabilities.has(required)) };
  },
  status() {
    return { loaded: true, permissionToken };
  }
};
vm.runInContext(menuSource, sandbox, { filename: "menu-service.js" });

const expectedRoutes = {
  RECEPCION: "operations-reception",
  CLASIFICACION: "operations-grading",
  EMBONCHE_ZEBRA: "operations-bunch-intake",
  BODEGA_CUARTO_FRIO: "operations-roses-inventory",
  DESPACHO: "operations-roses-inventory"
};

const resolvedRoutes = {};
for (const [profileId, expectedRoute] of Object.entries(expectedRoutes)) {
  effectiveCapabilities = profileCapabilities(profileId);
  permissionToken = `FA-OPS-001:${profileId}`;
  const resolved = context.BlessERP.menuService.resolveOperationsDefaultRoute(db);
  resolvedRoutes[profileId] = resolved;
  assert.equal(resolved, expectedRoute, `${profileId} debe entrar por ${expectedRoute}`);
  assert.equal(
    context.BlessERP.capabilityRuntime.evaluateRoute(resolved).allowed,
    true,
    `${profileId} debe tener capability para su ruta resuelta`
  );
}

effectiveCapabilities = new Set();
permissionToken = "FA-OPS-001:NO-CAPABILITIES";
assert.equal(
  context.BlessERP.menuService.resolveOperationsDefaultRoute(db),
  "",
  "Sin capability operacional no debe existir entrada implícita"
);

effectiveCapabilities = profileCapabilities("RECEPCION");
permissionToken = "FA-OPS-001:STATE-ALIAS";
vm.runInContext(stateSource, sandbox, { filename: "state.js" });
assert.equal(
  context.BlessERP.state.currentRoute().id,
  "operations-reception",
  "La ruta directa operations-postharvest debe resolverse antes del renderer"
);
assert.equal(context.BlessERP.state.setRoute("operations-postharvest"), true);
assert.equal(context.BlessERP.state.currentRoute().id, "operations-reception");
assert.ok(routeUrls.every(url => !new URL(url).searchParams.get("route")?.includes("postharvest")));

const entryBranch = operationsSource.match(
  /if \(route\.id === "operations-postharvest"\) \{([\s\S]*?)\} else if \(route\.id === "operations-parameters"\)/
)?.[1] || "";
assert.ok(entryBranch, "Debe existir un alias defensivo para operations-postharvest");
assert.doesNotMatch(entryBranch, /operacionesPanel|operacionesCycleDemo|getOperationalCycleSummaryDemo/);
assert.doesNotMatch(entryBranch, /saveDb|insert\s*\(|update\s*\(|delete\s*\(|upsert\s*\(/);
assert.doesNotMatch(entryBranch, /ensureDomain|repository|supabase|fetch\s*\(/i);
assert.doesNotMatch(entryBranch, /demo/i);

assert.doesNotMatch(
  operationsSource,
  /route\.id === "operations-postharvest"[\s\S]{0,300}operacionesPanel\.render/,
  "El renderer productivo no puede reactivar el panel demo"
);
assert.match(menuSource, /OPERATIONS_ENTRY_ROUTES/);
assert.doesNotMatch(
  menuSource.match(/const OPERATIONS_ENTRY_ROUTES[\s\S]*?\]\);/)?.[0] || "",
  /operations-postharvest|operations-dispatch/,
  "El destino predeterminado no puede ser el panel demo ni el despacho demo histórico"
);
defaultRouteSources.forEach(({ relative, source }) => {
  assert.doesNotMatch(source, />[^<]*\bdemo\b[^<]*</i, `${relative} no debe mostrar rótulos DEMO`);
  assert.doesNotMatch(source, /\b(?:activa|activo)\s+demo\b/i, `${relative} no debe conservar estados DEMO`);
});

console.log(JSON.stringify({
  ok: true,
  rootCause: "operations-postharvest rendered operacionesPanel, which read operacionesCycleDemo",
  canonicalDashboardFound: false,
  resolvedRoutes,
  noCapabilityRoute: "DENY",
  productiveDemoReads: 0,
  productiveDemoWrites: 0,
  productiveDemoLabels: 0,
  persistedCanonicalRoute: persistedUi.at(-1)?.currentRoute || ""
}, null, 2));
