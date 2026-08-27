import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const rootUrl = new URL("./", import.meta.url);
const read = path => readFile(new URL(path, rootUrl), "utf8");
const parseJson = async path => JSON.parse(await read(path));
const assertEmptyArray = (value, message) => {
  assert.equal(Array.isArray(value), true, `${message}: debe ser un arreglo`);
  assert.equal(value.length, 0, message);
};

const [
  vercel,
  envExample,
  indexHtml,
  coreSql,
  sriSql,
  sriAuditCleanupSql,
  companyStateFixSql,
  companyOwnerCleanupSql,
  validationCompanyCleanupSql,
  sriCompanySequencesSql,
  supabaseClientSource,
  authAccessSource,
  adminUsersSource,
  remoteUserAccessSource,
  settingsUsersSource
] = await Promise.all([
  parseJson("../vercel.json"),
  read("./.env.example"),
  read("./index.html"),
  read("./supabase/migrations/202607240001_core_access.sql"),
  read("./supabase/migrations/202607240002_sri_test_backend.sql"),
  read("./supabase/migrations/202607250003_sri_audit_fk_cleanup.sql"),
  read("./supabase/migrations/202607250004_fix_company_state_company_id_ambiguity.sql"),
  read("./supabase/migrations/202607250005_allow_owner_cleanup_with_company_delete.sql"),
  read("./supabase/migrations/202607250006_allow_validation_company_owner_cleanup.sql"),
  read("./supabase/migrations/202608020007_sri_company_document_sequences.sql"),
  read("./scripts/services/supabase/supabase-client.js"),
  read("./scripts/services/supabase/auth-access.js"),
  read("./api/admin-users.js"),
  read("./scripts/services/supabase/user-access-remote.js"),
  read("./scripts/modules/part2-settings.js")
]);

assert.equal(vercel.outputDirectory, "erp-james-unico/dist");
assert.ok(vercel.functions?.["api/sri.js"]);
assert.ok(vercel.functions?.["api/sri-retry.js"]);
assert.ok(vercel.functions?.["api/admin-users.js"]);
assert.match(vercel.functions["api/sri.js"].includeFiles, /node_modules\/xmllint-wasm\/xmllint\.wasm/);
assert.match(vercel.functions["api/sri-retry.js"].includeFiles, /node_modules\/xmllint-wasm\/xmllint\.wasm/);
assert.match(envExample, /^VITE_APP_ENV=test$/m);
assert.match(envExample, /^VITE_ENABLE_AUTH=false$/m);
assert.doesNotMatch(envExample, /SUPABASE_SERVICE_ROLE_KEY=\S+/);

for (const source of [
  coreSql,
  sriSql,
  sriAuditCleanupSql,
  companyStateFixSql,
  companyOwnerCleanupSql,
  validationCompanyCleanupSql,
  sriCompanySequencesSql
]) {
  assert.match(source, /^\s*begin;/im);
  assert.match(source, /\bcommit;\s*$/i);
  assert.doesNotMatch(source, /\brollback;\s*$/i);
}
assert.match(coreSql, /create table public\.user_route_permissions/i);
assert.match(coreSql, /alter table public\.user_route_permissions enable row level security/i);
assert.match(coreSql, /create or replace function public\.erp_save_company_state/i);
assert.match(sriSql, /create view public\.sri_company_memberships/i);
assert.match(sriSql, /constraint sri_settings_test_only check \(environment = 'TEST'\)/i);
assert.match(sriSql, /constraint sri_settings_production_disabled check \(production_enabled = false\)/i);
assert.match(sriSql, /substring\(access_key from 24 for 1\) = '1'/i);
assert.match(sriAuditCleanupSql, /pg_trigger_depth\(\) <= 1/i);
assert.match(companyStateFixSql, /on conflict on constraint erp_company_state_pkey do nothing/i);
assert.match(companyOwnerCleanupSql, /not exists[\s\S]+public\.companies company_row/i);
assert.match(validationCompanyCleanupSql, /metadata ->> 'validation_only'/i);
assert.match(sriCompanySequencesSql, /document_type in \('01', '04', '06', '07'\)/i);
assert.match(sriCompanySequencesSql, /'003'::text, '01'::text, 675::bigint/i);
assert.match(sriCompanySequencesSql, /'002'::text, '07'::text, 687::bigint/i);
assert.match(supabaseClientSource, /persistSession:\s*true/);
assert.match(supabaseClientSource, /detectSessionInUrl:\s*true/);
assert.doesNotMatch(authAccessSource, /signInWithOtp|resetPasswordForEmail|erp-auth-recover/);
assert.match(adminUsersSource, /auth\.admin\.inviteUserByEmail/);
assert.match(adminUsersSource, /\/crear-contrasena/);
assert.match(adminUsersSource, /auth\.admin\.deleteUser/);
assert.doesNotMatch(adminUsersSource, /password:\s*input\.password/);
assert.match(authAccessSource, /refreshSession\(\)/);
assert.match(remoteUserAccessSource, /listUnlinked/);
assert.match(remoteUserAccessSource, /requestJson\(url, options, true\)/);
assert.match(settingsUsersSource, /CUENTAS SIN ACCESO A JAEDER SYSTEMS/);

const authIndex = indexHtml.indexOf("scripts/services/supabase/auth-access.js");
const cloudIndex = indexHtml.indexOf("scripts/services/supabase/cloud-state-sync.js");
const appIndex = indexHtml.indexOf("app.js");
assert.ok(authIndex > 0 && cloudIndex > authIndex && appIndex > cloudIndex);

let uidCounter = 0;
const windowObject = {
  __ERP_ENV__: { VITE_APP_ENV: "test" },
  BlessERP: {
    getAppMode: () => "test",
    utils: {
      clone: value => structuredClone(value),
      uid: prefix => `${prefix}-${++uidCounter}`,
      today: () => "2026-07-24"
    }
  }
};
const context = vm.createContext({
  window: windowObject,
  structuredClone,
  Date,
  console,
  URL,
  URLSearchParams
});
vm.runInContext(await read("./scripts/data/demo.js"), context, { filename: "demo.js" });
const initial = context.window.BlessERP.demo.createInitialDatabase();
assert.equal(initial.meta.mode, "operational-test");
for (const key of [
  "journalEntries", "providers", "visualUsers", "auditLogs", "purchases",
  "payments", "bankAccounts", "customers", "inventoryItems", "sales"
]) {
  assertEmptyArray(initial[key], `${key} debe iniciar vacío en TEST`);
}
assert.equal(initial.documentSequences.some(sequence => sequence.code === "FAC"), false);
assert.equal(initial.documentSequences.find(sequence => sequence.code === "FAC_LOCAL")?.currentNumber, 674);
assert.equal(initial.documentSequences.find(sequence => sequence.code === "FAC_EXPORT")?.currentNumber, 0);
assert.equal(initial.documentSequences.find(sequence => sequence.code === "RETE")?.currentNumber, 686);
assert.ok(initial.documentSequences.filter(sequence => !["FAC_LOCAL", "RETE"].includes(sequence.code)).every(sequence => sequence.currentNumber === 0));

vm.runInContext(await read("./scripts/modules/payroll/payroll-data.js"), context, { filename: "payroll-data.js" });
assertEmptyArray(
  context.window.BlessERP.payrollData.createPayrollStore().employees,
  "Los empleados del rol deben iniciar vacíos en TEST"
);

vm.runInContext(await read("./scripts/modules/operaciones/operaciones-data.js"), context, { filename: "operaciones-data.js" });
const operations = context.window.BlessERP.operacionesData.createOperationsStore();
for (const key of [
  "availabilityDemo", "receptions", "classifications", "labelBatches",
  "roseInventory", "performances", "bunchEntries", "scannerEvents", "dispatches"
]) {
  assertEmptyArray(operations[key], `Operaciones.${key} debe iniciar vacío en TEST`);
}
assertEmptyArray(operations.masterData.suppliers, "Los proveedores deben iniciar vacíos en TEST");
assertEmptyArray(operations.masterData.classifiers, "Los clasificadores deben iniciar vacíos en TEST");
assert.equal(operations.ui.receptionDraft.supplier, "");

context.window.BlessERP.companyCapabilities = {
  COMPANY_IDS: {
    BLESS: "COMP-BLESS-FLOWER",
    IMPERIO: "COMP-IMPERIO-FLOWERS"
  }
};
context.window.BlessERP.comercialInvoiceSequence = {
  synchronize(seed) {
    return {
      packingListNumber: seed.packingListNumber || "",
      sriInvoiceNumber: seed.sriInvoiceNumber || "",
      sriSequential: seed.sriSequential || "",
      sriSequenceSource: seed.sriSequenceSource || "",
      invoicePackingNumber: seed.invoicePackingNumber || "",
      clientInvoiceNumber: seed.clientInvoiceNumber || ""
    };
  }
};
vm.runInContext(await read("./scripts/modules/comercial/comercial-data.js"), context, { filename: "comercial-data.js" });
const commercial = context.window.BlessERP.comercialData.createCommercialStore();
assertEmptyArray(commercial.orders, "Los pedidos deben iniciar vacíos en TEST");
assertEmptyArray(commercial.preorders, "Los PO deben iniciar vacíos en TEST");
assertEmptyArray(commercial.customerCatalog, "Los clientes deben iniciar vacíos en TEST");
assertEmptyArray(commercial.brandCatalog, "Las marcas deben iniciar vacías en TEST");
assertEmptyArray(commercial.daeCatalog, "Las DAE deben iniciar vacías en TEST");
assert.equal(context.window.BlessERP.comercialData.company.commercialName, "Bless Flower");
assert.doesNotMatch(JSON.stringify(commercial), /order-demo|DEMO-BLF|Ventas demo/i);

if (process.env.ERP_DEPLOY_URL) {
  const base = String(process.env.ERP_DEPLOY_URL).replace(/\/+$/, "");
  const home = await fetch(`${base}/`);
  assert.equal(home.ok, true, "La portada desplegada debe responder correctamente");
  const html = await home.text();
  assert.match(html, /JAEDER SYSTEMS/);
  const sri = await fetch(`${base}/api/sri?action=list`);
  assert.ok([400, 401, 403, 422].includes(sri.status), "SRI debe rechazar solicitudes sin sesión");
  assert.match(await sri.text(), /sesion autenticada/i);
  const admin = await fetch(`${base}/api/admin-users?company=COMP-BLESS-FLOWER`);
  assert.ok([400, 401, 403, 422].includes(admin.status), "Administración de usuarios debe rechazar solicitudes sin sesión");
  assert.match(await admin.text(), /sesion autenticada/i);
}

console.log("Preparación de despliegue TEST: OK");
console.log("Arranque limpio sin datos demo: OK");
console.log("Migraciones, RLS, SRI TEST y funciones Vercel: OK");
