import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./scripts/services/admin-config.js", import.meta.url), "utf8");
const companies = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    company_key: "COMP-BLESS-FLOWER",
    company_code: "BLESS",
    commercial_name: "BLESS FLOWER",
    is_active: true
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    company_key: "COMP-IMPERIO-FLOWERS",
    company_code: "IMPERIO",
    commercial_name: "IMPERIO FLOWERS",
    is_active: true
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    company_key: "COMP-NOT-AUTHORIZED",
    company_code: "OTHER",
    commercial_name: "OTHER COMPANY",
    is_active: true
  }
];

const windowObject = {
  __ERP_ENV__: { VITE_APP_ENV: "production" },
  BlessERP: {
    utils: {
      clone: value => structuredClone(value),
      uid: prefix => `${prefix}-fixture`
    },
    authAccess: {
      activeAccess() {
        return {
          companies,
          allowedCompanyKeys: ["COMP-BLESS-FLOWER", "COMP-IMPERIO-FLOWERS"]
        };
      }
    },
    state: { state: { db: {} } }
  }
};

const context = vm.createContext({ window: windowObject, structuredClone, console });
vm.runInContext(source, context, { filename: "scripts/services/admin-config.js" });

const profiles = context.window.BlessERP.services.adminConfig.companyProfiles();
assert.equal(profiles.length, 2, "Solo deben aparecer empresas activas autorizadas por membership");
assert.deepEqual(
  profiles.map(item => item.id),
  ["COMP-BLESS-FLOWER", "COMP-IMPERIO-FLOWERS"],
  "Las claves deben provenir del directorio canónico"
);
assert.deepEqual(
  profiles.map(item => item.uuid),
  ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  "El formulario debe conservar los UUID reales"
);
assert.ok(profiles.every(item => item.active === true));
assert.ok(!profiles.some(item => item.id === "COMP-NOT-AUTHORIZED"));

console.log(JSON.stringify({
  result: "PASS",
  companies: profiles.map(item => ({ key: item.id, uuid: item.uuid, active: item.active })),
  crossCompanyCatalogLeak: 0
}, null, 2));
