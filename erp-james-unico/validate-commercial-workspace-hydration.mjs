import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const repositoryPath = path.join(root, "scripts", "repositories", "comercial", "commercial-order-repository.js");
const loaderPath = path.join(root, "scripts", "services", "sync", "domain-loader.js");
const repositorySource = fs.readFileSync(repositoryPath, "utf8");
const loaderSource = fs.readFileSync(loaderPath, "utf8");
const syncSource = fs.readFileSync(path.join(root, "scripts", "services", "sync", "incremental-sync.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const companyId = "11111111-1111-4111-8111-111111111111";
const targetId = "COM-DRAFT-bpgsdd-mt7gwoyt";
let remoteReads = 0;
const applied = [];
const filters = [];

function queryBuilder() {
  const query = {
    select() { return query; },
    eq(column, value) { filters.push(["eq", column, value]); return query; },
    is(column, value) { filters.push(["is", column, value]); return query; },
    in(column, value) { filters.push(["in", column, value]); return query; },
    order() { return query; },
    range() { return query; },
    abortSignal() { return query; },
    then(resolve) {
      remoteReads += 1;
      return Promise.resolve({
        data: [{
          id: "22222222-2222-4222-8222-222222222222",
          company_id: companyId,
          entity: "commercial_orders",
          record_id: targetId,
          payload: { id: targetId, number: "PED-COM-2026-0038", hawb: "TEST-M1-COORD", status: "GUARDADO" },
          version: 7,
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-25T00:00:00Z",
          created_by: null,
          updated_by: null,
          device_id: "DEVICE-A",
          last_operation_id: "33333333-3333-4333-8333-333333333333",
          deleted_at: null
        }],
        error: null
      }).then(resolve);
    }
  };
  return query;
}

const repositoryWindow = {
  location: { protocol: "https:" },
  BlessERP: {
    repositoryModules: { core: {}, comercial: {}, operaciones: {}, inventarioMateriales: {}, contabilidad: {} },
    authAccess: { activeAccess: () => ({ activeCompany: { id: companyId } }) },
    state: { state: { db: { authAccess: {}, commercial: { orders: [] } } } },
    getEnvConfig: () => ({ supabaseEnabled: true, incrementalSyncEnabled: true, authEnabled: true }),
    getSupabaseClient: () => ({ from: table => { assert(table === "erp_entity_records", "Fuente canónica incorrecta."); return queryBuilder(); } }),
    createRepositoryBase: entity => ({ entity }),
    offlineSync: {
      applyRemoteRecord: async (row, options) => {
        applied.push({ row, options });
        return { ok: true, changed: true };
      }
    }
  }
};
repositoryWindow.window = repositoryWindow;
vm.runInNewContext(repositorySource, repositoryWindow, { filename: repositoryPath });

const repository = repositoryWindow.BlessERP.getCommercialOrderRepository();
const [hydratedA, hydratedB] = await Promise.all([
  repository.hydrateWorkspace({ full: true, genericResult: { ok: false, mode: "UNAVAILABLE" } }),
  repository.hydrateWorkspace({ full: true, genericResult: { ok: false, mode: "UNAVAILABLE" } })
]);
assert(hydratedA.ok && hydratedB.ok, "La hidratación canónica falló.");
assert(hydratedA.mode === "SUPABASE_COMMERCIAL_WORKSPACE", "El modo canónico no quedó explícito.");
assert(hydratedA.fetchedRows === 1, "El conteo del workspace no coincide.");
assert(remoteReads === 1, "Las hidrataciones concurrentes no fueron deduplicadas.");
assert(applied.length === 1, "El registro canónico no se fusionó exactamente una vez.");
assert(applied[0].row.record_id === targetId && applied[0].row.version === 7, "Se perdió record_id o version.");
assert(applied[0].options.forceServer === true, "Supabase no quedó como autoridad de hidratación.");
assert(applied[0].options.ignoreEditGuard === true, "La hidratación inicial quedó diferida por el estado transitorio de montaje.");
assert(filters.some(row => row[1] === "company_id" && row[2] === companyId), "Falta filtro por empresa.");
assert(filters.some(row => row[1] === "entity" && row[2] === "commercial_orders"), "Falta filtro por entidad.");
assert(filters.some(row => row[0] === "in" && row[1] === "payload->>status"), "Falta filtro de pedidos operativos activos.");

const readsBeforeGeneric = remoteReads;
const generic = await repository.hydrateWorkspace({ genericResult: { ok: true, mode: "INCREMENTAL_PULL" } });
assert(generic.skipped === true && remoteReads === readsBeforeGeneric, "El fallback descargó duplicadamente después de un pull válido.");

let loaderPulls = 0;
let loaderHydrates = 0;
const recordedPulls = [];
const loaderWindow = {
  BlessERP: {
    authAccess: { activeAccess: () => ({ activeCompany: { id: companyId } }) },
    syncEntityRegistry: {
      entitiesForDomain: domain => domain === "commercial-workspace" ? ["commercial_orders"] : [],
      domainForEntity: () => "commercial-workspace"
    },
    offlineSync: { pullDomain: async () => { loaderPulls += 1; return { ok: false, mode: "UNAVAILABLE", fetchedRows: 0 }; } },
    domainDataHydrators: {
      "commercial-workspace": async options => {
        loaderHydrates += 1;
        assert(options.genericResult?.mode === "UNAVAILABLE", "El hydrator no recibió el resultado genérico.");
        return { ok: true, mode: "SUPABASE_COMMERCIAL_WORKSPACE", fetchedRows: 1 };
      }
    },
    syncInstrumentation: { recordPull: (_kind, detail) => recordedPulls.push(detail) }
  },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  addEventListener() {},
  dispatchEvent() {},
  setTimeout,
  clearTimeout
};
loaderWindow.window = loaderWindow;
vm.runInNewContext(loaderSource, loaderWindow, { filename: loaderPath });
const firstLoad = await loaderWindow.BlessERP.domainDataLoader.ensureDomain("commercial-workspace");
const cachedLoad = await loaderWindow.BlessERP.domainDataLoader.ensureDomain("commercial-workspace");
const status = loaderWindow.BlessERP.domainDataLoader.status().domains["commercial-workspace"];
assert(firstLoad.ok === true && firstLoad.mode === "SUPABASE_COMMERCIAL_WORKSPACE", "UNAVAILABLE no fue recuperado por la fuente canónica.");
assert(cachedLoad.mode === "DOMAIN_CACHE", "La reapertura produjo una descarga completa innecesaria.");
assert(loaderPulls === 1 && loaderHydrates === 1, "La carga lazy no fue exactamente una.");
assert(status.loaded === true && status.lastMode === "SUPABASE_COMMERCIAL_WORKSPACE" && status.rowsReceived === 1, "La telemetría del dominio no representa la hidratación real.");
assert(recordedPulls.length === 1 && recordedPulls[0].mode === "SUPABASE_COMMERCIAL_WORKSPACE", "La instrumentación conservó UNAVAILABLE incorrectamente.");

for (const forbidden of ["saveDb(", "putOperation(", "captureChange("]) {
  assert(!repositorySource.includes(forbidden), `El fallback agregó una escritura no permitida: ${forbidden}`);
}
assert(syncSource.includes("BlessERP.domainDataLoader?.isEntityActive?.(entity) === true"), "El bootstrap todavía puede desalojar un dominio lazy activo.");
assert(syncSource.includes("evictableEntities"), "La limpieza selectiva no separa dominios activos de históricos dormidos.");

console.log("COMMERCIAL WORKSPACE HYDRATION VALIDATOR = OK");
console.log("CANONICAL SOURCE = erp_entity_records / commercial_orders");
console.log("UNAVAILABLE RECOVERY MODE = SUPABASE_COMMERCIAL_WORKSPACE");
console.log("CONCURRENT DUPLICATE LOADS = 0");
console.log("HYDRATION MUTATIONS = 0");
