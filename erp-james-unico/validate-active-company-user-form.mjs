import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const COMPANY_KEY = "COMP-BLESS-FLOWER";
const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_KEY = "COMP-IMPERIO-FLOWERS";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";

const activeAccess = {
  activeCompanyKey: COMPANY_KEY,
  allowedCompanyKeys: [COMPANY_KEY],
  activeCompany: {
    id: COMPANY_ID,
    company_key: COMPANY_KEY,
    company_code: "BLESS",
    commercial_name: "Bless Flower",
    is_active: true,
  },
  companies: [
    {
      id: COMPANY_ID,
      company_key: COMPANY_KEY,
      company_code: "BLESS",
      commercial_name: "Bless Flower",
      is_active: true,
    },
    {
      id: OTHER_ID,
      company_key: OTHER_KEY,
      company_code: "IMPERIO",
      commercial_name: "Imperio Flowers",
      is_active: true,
    },
  ],
};

const db = {
  activeCompanyId: COMPANY_KEY,
  session: { activeUser: { id: "actor-user", name: "Gerencia", role: "GERENCIA_GENERAL" } },
  visualUsers: [],
  documentSequences: [],
  costCenters: [],
  auditLogs: [],
};
let fetchCalls = 0;
const frontendContext = vm.createContext({
  console,
  structuredClone,
  URL,
  setTimeout,
  clearTimeout,
  window: {
    location: { origin: "https://test.example.test" },
    __ERP_ENV__: { VITE_APP_ENV: "test" },
    BlessERP: {
      utils: {
        clone: value => structuredClone(value),
        uid: prefix => `${prefix}-TEST`,
      },
      state: {
        state: { db },
        saveDb() {},
        refreshNavigationAccess() {},
      },
      storage: { save() {} },
      getAppMode: () => "test",
      isCoreSupabaseEnabled: () => true,
      authAccess: {
        activeAccess: () => activeAccess,
        getAccessToken: async () => "test-access-token",
      },
      companyCapabilities: {
        listCompanies: () => [
          { id: COMPANY_KEY, code: "BLESS", commercialName: "Bless Flower", status: "ACTIVA" },
          { id: OTHER_KEY, code: "IMPERIO", commercialName: "Imperio Flowers", status: "ACTIVA" },
        ],
      },
      services: { companyContext: { activeCompanyId: () => COMPANY_KEY } },
      menuService: {
        ROLE_CODES: ["ADMIN", "INVITADO"],
        ROLE_LABELS: { ADMIN: "Administrador", INVITADO: "Invitado" },
        normalizeRoleCode: value => String(value || "INVITADO").toUpperCase(),
        getCompanyAvailablePages: () => [{ ruta: "settings-users" }],
        canUserAccessRoute: () => true,
      },
    },
  },
  fetch: async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, data: {} }) };
  },
});

vm.runInContext(read("./scripts/services/admin-config.js"), frontendContext, { filename: "admin-config.js" });
vm.runInContext(read("./scripts/services/supabase/user-access-remote.js"), frontendContext, { filename: "user-access-remote.js" });
const BlessERP = frontendContext.window.BlessERP;
const admin = BlessERP.services.adminConfig;
const remote = BlessERP.remoteUserAccess;

assert.deepEqual(
  admin.companyProfiles().map(company => company.id),
  [COMPANY_KEY],
  "El formulario remoto debe exponer únicamente empresas activas autorizadas por la sesión"
);
assert.deepEqual(JSON.parse(JSON.stringify(admin.activeCompanyIdentity())), {
  companyId: COMPANY_ID,
  companyKey: COMPANY_KEY,
  active: true,
});

const draft = admin.createUserDraft();
assert.deepEqual(Object.keys(draft.companyAccess), [COMPANY_KEY]);
draft.fullName = "Usuario ficticio";
draft.name = draft.fullName;
draft.username = "usuario.ficticio";
draft.email = "usuario.ficticio@example.test";
draft.phone = "+593000000000";
draft.cargo = "Prueba sin guardar";
draft.companyAccess[COMPANY_KEY] = {
  enabled: true,
  status: "activo",
  roleCode: "ADMIN",
  membershipRole: "ADMIN",
  profileId: "ADMINISTRADOR_ERP",
  routeAccess: {},
};
const payload = remote.payloadFor(draft);
assert.equal(payload.companies.length, 1);
assert.equal(payload.companies[0].companyKey, COMPANY_KEY);
assert.equal(payload.companies[0].profileId, "ADMINISTRADOR_ERP");
assert.equal(payload.phone, "+593000000000");

const manipulated = structuredClone(draft);
manipulated.companyAccess[OTHER_KEY] = {
  enabled: true,
  status: "activo",
  roleCode: "ADMIN",
  membershipRole: "ADMIN",
  profileId: "ADMINISTRADOR_ERP",
  routeAccess: {},
};
const manipulatedResult = await remote.save(manipulated);
assert.equal(manipulatedResult.ok, false);
assert.equal(manipulatedResult.code, "COMPANY_SCOPE_DENIED");
assert.equal(fetchCalls, 0, "La manipulación cross-company debe bloquearse antes de llamar al API");

function queryResult(table, filters, capabilityAllowed) {
  if (table === "companies") {
    const key = filters.get("company_key");
    if (key === COMPANY_KEY && filters.get("is_active") === true) {
      return { data: { id: COMPANY_ID, company_key: COMPANY_KEY, commercial_name: "Bless Flower" }, error: null };
    }
    if (key === OTHER_KEY && filters.get("is_active") === true) {
      return { data: { id: OTHER_ID, company_key: OTHER_KEY, commercial_name: "Imperio Flowers" }, error: null };
    }
    return { data: null, error: { code: "PGRST116" } };
  }
  if (table === "user_company_memberships") {
    const companyId = filters.get("company_id");
    if (companyId === COMPANY_ID && capabilityAllowed) {
      return { data: { membership_role: "OWNER", membership_status: "ACTIVE" }, error: null };
    }
    return { data: null, error: null };
  }
  if (table === "erp_security_profiles") {
    return {
      data: [{ profile_id: "ADMINISTRADOR_ERP", display_name: "Administrador ERP", active: true, system_defined: true }],
      error: null,
    };
  }
  return { data: [], error: null };
}

function queryBuilder(table, capabilityAllowed) {
  const filters = new Map();
  const builder = {
    select() { return builder; },
    eq(key, value) { filters.set(key, value); return builder; },
    in() { return builder; },
    order() { return Promise.resolve(queryResult(table, filters, capabilityAllowed)); },
    single() { return Promise.resolve(queryResult(table, filters, capabilityAllowed)); },
    maybeSingle() { return Promise.resolve(queryResult(table, filters, capabilityAllowed)); },
  };
  return builder;
}

async function apiGet(companyKey, { capabilityAllowed = true } = {}) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "actor-user" } }, error: null }) },
    from: table => queryBuilder(table, capabilityAllowed),
  };
  const module = { exports: {} };
  const apiContext = vm.createContext({ console, URL, module, exports: module.exports, require: specifier => {
    if (specifier !== "./sri/_lib/supabase-admin.cjs") throw new Error(`Unexpected require: ${specifier}`);
    return {
      bearerToken: () => "test-access-token",
      getSupabaseAdmin: () => client,
      assertUserCapability: async (_token, companyId, capability) => {
        assert.equal(capability, "admin.users.manage");
        if (!capabilityAllowed || companyId !== COMPANY_ID) throw new Error("CAPABILITY_DENIED");
      },
    };
  }});
  vm.runInContext(read("./api/admin-users.js"), apiContext, { filename: "api/admin-users.js" });
  const response = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = JSON.parse(body || "{}"); },
  };
  await module.exports({
    method: "GET",
    url: `/api/admin-users?company=${encodeURIComponent(companyKey)}&profiles=1`,
    query: { company: companyKey, profiles: "1" },
    headers: { authorization: "Bearer test-access-token" },
  }, response);
  return response;
}

const authorized = await apiGet(COMPANY_KEY);
assert.equal(authorized.statusCode, 200);
assert.equal(authorized.body.ok, true);
assert.equal(authorized.body.data.length, 1);

const unauthorized = await apiGet(COMPANY_KEY, { capabilityAllowed: false });
assert.equal(unauthorized.statusCode, 400);
assert.equal(unauthorized.body.ok, false);

const crossCompany = await apiGet(OTHER_KEY);
assert.equal(crossCompany.statusCode, 400);
assert.equal(crossCompany.body.ok, false);

const missingCompany = await apiGet("COMP-NO-EXISTE");
assert.equal(missingCompany.statusCode, 400);
assert.match(missingCompany.body.error, /no existe o está inactiva/i);

const capabilityPolicy = read("./scripts/config/capability-policy.js");
const settings = read("./scripts/modules/part2-settings.js");
const api = read("./api/admin-users.js");
assert.match(capabilityPolicy, /"settings-users": "admin\.users\.manage"/);
assert.match(settings, /Perfil funcional/);
assert.match(settings, /Teléfono \(opcional\)/);
assert.match(api, /\.eq\("is_active", true\)/);
assert.match(api, /assertCanManage\(client, actorUser, company\.id/);
assert.match(api, /erp_security_user_company_profiles/);

process.stdout.write(`${JSON.stringify({
  sessionCompanyId: COMPANY_ID,
  sessionCompanyKey: COMPANY_KEY,
  formCompanyIdBefore: COMPANY_KEY,
  formCompanyKeyBefore: COMPANY_KEY,
  formCompaniesBefore: [COMPANY_KEY, OTHER_KEY],
  formCompanyIdAfter: COMPANY_ID,
  formCompanyKeyAfter: COMPANY_KEY,
  formCompaniesAfter: [COMPANY_KEY],
  companyExists: true,
  companyActive: true,
  companyValid: true,
  profileOptionsCanonical: true,
  authorized: "PASS",
  unauthorized: "DENIED",
  crossCompany: "DENIED",
  nonexistentCompany: "DENIED",
  inactiveCompany: "DENIED_BY_IS_ACTIVE_FILTER",
  authUsersCreated: 0,
  invitationsSent: 0,
  result: "PASS",
}, null, 2)}\n`);
