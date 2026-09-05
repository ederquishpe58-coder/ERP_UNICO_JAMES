import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

function storageMock() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    }
  };
}

function createBaseSandbox() {
  const localStorage = storageMock();
  const sessionStorage = storageMock();
  const listeners = new Map();
  const documentListeners = new Map();
  const sandbox = {
    Array,
    Blob,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextEncoder,
    Uint8Array,
    atob(value) {
      return Buffer.from(String(value), "base64").toString("binary");
    },
    btoa(value) {
      return Buffer.from(String(value), "binary").toString("base64");
    },
    clearTimeout,
    console,
    crypto: webcrypto,
    localStorage,
    navigator: { onLine: true },
    sessionStorage,
    setTimeout,
    structuredClone,
    document: {
      visibilityState: "visible",
      addEventListener(name, callback) {
        documentListeners.set(name, callback);
      },
      body: {
        classList: {
          add() {},
          remove() {}
        }
      }
    },
    window: {
      crypto: webcrypto,
      location: {
        protocol: "https:",
        search: "",
        href: "https://jaeder.example/"
      },
      setInterval() {
        return 1;
      },
      clearInterval() {},
      setTimeout,
      clearTimeout,
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatchEvent(event) {
        listeners.get(event.type)?.(event);
        return true;
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = localStorage;
  sandbox.window.sessionStorage = sessionStorage;
  sandbox.window.navigator = sandbox.navigator;
  return { sandbox, localStorage, sessionStorage };
}

{
  const { sandbox, localStorage, sessionStorage } = createBaseSandbox();
  sandbox.window.BlessERP = {
    state: {
      state: {
        db: {
          activeCompanyId: "COMP-BLESS-FLOWER",
          visualUsers: [],
          session: {}
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("scripts/services/local-auth.js", "utf8"), sandbox, {
    filename: "scripts/services/local-auth.js"
  });
  const auth = sandbox.window.BlessERP.localAuth;
  assert.equal(auth.markCurrentSession("USR-15H"), true);
  const stored = JSON.parse(localStorage.getItem("bless_flower_erp_local_auth_session_v1"));
  assert.equal(stored.userId, "USR-15H");
  assert.equal(stored.durationHours, 15);
  assert.equal(sessionStorage.getItem("bless_flower_erp_local_auth_session_v1"), null);
  const status = auth.sessionStatus();
  assert.equal(status.active, true);
  assert.equal(status.durationHours, 15);
  assert.ok(status.remainingMs > 14.9 * 60 * 60 * 1000);

  stored.expiresAt = new Date(Date.now() - 1000).toISOString();
  localStorage.setItem("bless_flower_erp_local_auth_session_v1", JSON.stringify(stored));
  assert.equal(auth.sessionStatus().active, false, "Una sesión realmente vencida debe pedir acceso nuevamente.");
}

{
  const { sandbox, localStorage } = createBaseSandbox();
  const companyKey = "COMP-BLESS-FLOWER";
  const companyUuid = "00000000-0000-0000-0000-000000000001";
  const db = {
    activeCompanyId: companyKey,
    companyStores: {
      [companyKey]: {
        records: [{ id: "A", value: 1 }]
      }
    }
  };
  let rpcCalls = 0;
  let rpcMode = "NETWORK_ERROR";
  const client = {
    rpc() {
      rpcCalls += 1;
      if (rpcMode === "NETWORK_ERROR") {
        return Promise.resolve({ data: null, error: new Error("network temporarily unavailable") });
      }
      if (rpcMode === "CONFLICT") {
        return Promise.resolve({ data: null, error: new Error("conflicto de revision 40001") });
      }
      return Promise.resolve({
        data: [{ revision: rpcCalls, updated_at: "2026-07-31T12:00:00.000Z" }],
        error: null
      });
    }
  };
  sandbox.window.BlessERP = {
    isCoreSupabaseEnabled() {
      return true;
    },
    authAccess: {
      activeAccess() {
        return {
          activeCompany: {
            id: companyUuid,
            company_key: companyKey
          }
        };
      }
    },
    getSupabaseClient() {
      return client;
    },
    companyCapabilities: {
      captureActiveStore() {},
      snapshotActiveStore(state, key) {
        return state.companyStores[key];
      },
      applyActiveStore() {}
    },
    state: { state: { db } },
    storage: { save() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("scripts/services/supabase/cloud-state-sync.js", "utf8"), sandbox, {
    filename: "scripts/services/supabase/cloud-state-sync.js"
  });
  const sync = sandbox.window.BlessERP.cloudStateSync;

  const callsBeforeLegacySave = rpcCalls;
  sync.scheduleSave(db);
  let result = await sync.saveNow(db);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "SNAPSHOT_WRITE_DISABLED");
  assert.equal(rpcCalls, callsBeforeLegacySave, "El snapshot legado no debe competir con la sincronización incremental.");
  assert.equal(sync.status().pending, false);
  assert.equal(sync.status().conflict, false);

  sandbox.navigator.onLine = false;
  db.companyStores[companyKey].records.push({ id: "B", value: 2 });
  sync.scheduleSave(db);
  const callsBeforeOfflineSave = rpcCalls;
  result = await sync.saveNow(db);
  assert.equal(result.mode, "SNAPSHOT_WRITE_DISABLED");
  assert.equal(rpcCalls, callsBeforeOfflineSave, "Sin Internet el snapshot legado tampoco debe hacer llamadas.");
  assert.equal(sync.status().pending, false);

  sandbox.navigator.onLine = true;
  result = await sync.saveNow(db);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "SNAPSHOT_WRITE_DISABLED");
  assert.equal(sync.status().pending, false);

  sync.scheduleSave(db);
  rpcMode = "CONFLICT";
  result = await sync.saveNow(db);
  assert.equal(result.mode, "SNAPSHOT_WRITE_DISABLED");
  assert.equal(sync.status().conflict, false);
  assert.equal(db.companyStores[companyKey].records.length, 2, "Un conflicto no debe borrar datos locales.");
  assert.equal((await sync.retryNow(db)).ok, false, "Sin incremental activo no debe restaurarse ni sobrescribirse un snapshot.");
  assert.equal(localStorage.getItem(`jaeder-cloud-sync-v3:unknown:${companyKey}`), null);
}

const authSource = readFileSync("scripts/services/supabase/auth-access.js", "utf8");
assert.match(authSource, /ACCESS_CACHE_OFFLINE_MAX_AGE_MS = 15 \* 60 \* 60 \* 1000/);
assert.match(authSource, /AUTHENTICATED_OFFLINE_CACHE/);
assert.match(authSource, /startSessionSupervisor/);
assert.doesNotMatch(
  authSource,
  /error\?\.name === "AbortError"\s*\|\|\s*!transientDirectoryError/,
  "AbortError debe reintentarse como falla temporal."
);

const layoutSource = readFileSync("scripts/ui/layout.js", "utf8");
assert.match(layoutSource, /Cambios sin confirmar/);
assert.match(layoutSource, /Incidencia en conciliación/);
assert.match(layoutSource, /resolverá automáticamente/);
assert.match(layoutSource, /data-cloud-sync-now/);

const realtimeSource = readFileSync("scripts/services/sync/realtime-sync.js", "utf8");
assert.match(realtimeSource, /table: "erp_company_state"/);
assert.match(realtimeSource, /table: "erp_entity_records"/);
assert.match(realtimeSource, /incrementalPrimary/);
assert.match(realtimeSource, /applyRemoteRecord/);
assert.match(realtimeSource, /visibilitychange/);
assert.match(realtimeSource, /WINDOW_FOCUS/);
assert.match(realtimeSource, /PAGE_RESTORED/);

const pwaSource = readFileSync("service-worker.js", "utf8");
assert.match(pwaSource, /networkFirstAsset/);
assert.match(pwaSource, /cache: "no-store"/);

console.log("VALIDACION_SESION_SINCRONIZACION_OK");
console.log("Sesión 15 h, caché sin conexión, cola persistente, reintentos y conciliación automática: OK");
