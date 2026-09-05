(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const DB_NAME = "jaeder-systems-offline-v1";
  const DB_VERSION = 1;
  const STORE_OPERATIONS = "operations";
  const STORE_METADATA = "metadata";
  const STORE_ENTITIES = "entity_cache";
  const memory = {
    operations: new Map(),
    metadata: new Map(),
    entities: new Map()
  };
  let openPromise = null;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        // Sigue con JSON para navegadores antiguos.
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function supported() {
    return typeof indexedDB !== "undefined";
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB no respondió."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("La transacción IndexedDB falló."));
      transaction.onabort = () => reject(transaction.error || new Error("La transacción IndexedDB fue cancelada."));
    });
  }

  function open() {
    if (!supported()) return Promise.resolve(null);
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_OPERATIONS)) {
          const operations = db.createObjectStore(STORE_OPERATIONS, { keyPath: "operation_id" });
          operations.createIndex("status", "status", { unique: false });
          operations.createIndex("entity_record", ["company_id", "entity", "record_id"], { unique: false });
          operations.createIndex("created", "local_created_at", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_ENTITIES)) {
          const entities = db.createObjectStore(STORE_ENTITIES, { keyPath: "cache_key" });
          entities.createIndex("company_entity", ["company_id", "entity"], { unique: false });
          entities.createIndex("updated_at", "updated_at", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        openPromise = null;
        reject(request.error || new Error("No se pudo abrir IndexedDB."));
      };
      request.onblocked = () => {
        openPromise = null;
        reject(new Error("IndexedDB está bloqueado por otra pestaña antigua."));
      };
    });
    return openPromise;
  }

  async function put(storeName, value) {
    const db = await open();
    if (!db) {
      const target = storeName === STORE_OPERATIONS
        ? memory.operations
        : storeName === STORE_METADATA
          ? memory.metadata
          : memory.entities;
      const key = value.operation_id || value.key || value.cache_key;
      target.set(key, clone(value));
      BlessERP.syncInstrumentation?.recordIndexedDbWrite?.("put");
      return clone(value);
    }
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(clone(value));
    await transactionDone(transaction);
    BlessERP.syncInstrumentation?.recordIndexedDbWrite?.("put");
    return clone(value);
  }

  async function get(storeName, key) {
    const db = await open();
    if (!db) {
      const target = storeName === STORE_OPERATIONS
        ? memory.operations
        : storeName === STORE_METADATA
          ? memory.metadata
          : memory.entities;
      return clone(target.get(key));
    }
    const transaction = db.transaction(storeName, "readonly");
    return clone(await requestResult(transaction.objectStore(storeName).get(key)));
  }

  async function getAll(storeName) {
    const db = await open();
    if (!db) {
      const target = storeName === STORE_OPERATIONS
        ? memory.operations
        : storeName === STORE_METADATA
          ? memory.metadata
          : memory.entities;
      return [...target.values()].map(clone);
    }
    const transaction = db.transaction(storeName, "readonly");
    return (await requestResult(transaction.objectStore(storeName).getAll())).map(clone);
  }

  async function remove(storeName, key) {
    const db = await open();
    if (!db) {
      const target = storeName === STORE_OPERATIONS
        ? memory.operations
        : storeName === STORE_METADATA
          ? memory.metadata
          : memory.entities;
      target.delete(key);
      BlessERP.syncInstrumentation?.recordIndexedDbWrite?.("delete");
      return;
    }
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
    BlessERP.syncInstrumentation?.recordIndexedDbWrite?.("delete");
  }

  async function updateOperation(operationId, patch) {
    const current = await get(STORE_OPERATIONS, operationId);
    if (!current) return null;
    return put(STORE_OPERATIONS, {
      ...current,
      ...clone(patch),
      operation_id: operationId
    });
  }

  async function listOperations(options = {}) {
    const statuses = Array.isArray(options.statuses)
      ? new Set(options.statuses.map(value => String(value).toLowerCase()))
      : null;
    return (await getAll(STORE_OPERATIONS))
      .filter(operation => !statuses || statuses.has(String(operation.status || "").toLowerCase()))
      .filter(operation => !options.companyId || operation.company_id === options.companyId)
      .sort((left, right) => String(left.local_created_at || "").localeCompare(String(right.local_created_at || "")));
  }

  async function findPendingForRecord(companyId, entity, recordId) {
    const rows = await listOperations({
      companyId,
      statuses: ["pending", "syncing", "error", "conflict"]
    });
    return rows.find(operation =>
      operation.entity === entity
      && operation.record_id === recordId
    ) || null;
  }

  async function setMeta(key, value) {
    await put(STORE_METADATA, {
      key: String(key),
      value: clone(value),
      updated_at: new Date().toISOString()
    });
    return value;
  }

  async function getMeta(key, fallback = null) {
    const row = await get(STORE_METADATA, String(key));
    return row ? clone(row.value) : fallback;
  }

  async function putEntity(record) {
    const cacheKey = `${record.company_id}:${record.entity}:${record.record_id}`;
    const current = await get(STORE_ENTITIES, cacheKey);
    const currentVersion = Math.max(0, Number(current?.version || 0) || 0);
    const nextVersion = Math.max(0, Number(record?.version || 0) || 0);
    if (current && nextVersion < currentVersion) {
      return { ...clone(current), _cache_write: "IGNORED_OLDER_VERSION" };
    }
    if (current && nextVersion === currentVersion) {
      const currentOperation = String(current.last_operation_id || "");
      const nextOperation = String(record?.last_operation_id || "");
      const currentUpdatedAt = String(current.updated_at || "");
      const nextUpdatedAt = String(record?.updated_at || "");
      if ((currentOperation && nextOperation && currentOperation === nextOperation)
        || (currentUpdatedAt && nextUpdatedAt && nextUpdatedAt < currentUpdatedAt)) {
        return { ...clone(current), _cache_write: "IGNORED_DUPLICATE_OR_OLDER" };
      }
    }
    const row = {
      ...clone(record),
      cache_key: cacheKey
    };
    return put(STORE_ENTITIES, row);
  }

  async function listEntityCache(options = {}) {
    const companyId = String(options.companyId || "");
    const entities = Array.isArray(options.entities)
      ? new Set(options.entities.map(value => String(value || "")).filter(Boolean))
      : null;
    return (await getAll(STORE_ENTITIES)).filter(row => (
      (!companyId || String(row?.company_id || "") === companyId)
      && (!entities || entities.has(String(row?.entity || "")))
    ));
  }

  async function removeCachedEntities(companyId, entities, options = {}) {
    const companyKey = String(companyId || "");
    const entitySet = new Set((Array.isArray(entities) ? entities : [])
      .map(value => String(value || ""))
      .filter(Boolean));
    if (!companyKey || !entitySet.size) return { removed: 0, preserved: 0 };
    const preserveKeys = new Set((Array.isArray(options.preserveKeys) ? options.preserveKeys : [])
      .map(value => String(value || ""))
      .filter(Boolean));
    const rows = await listEntityCache({ companyId: companyKey, entities: [...entitySet] });
    let removed = 0;
    let preserved = 0;
    for (const row of rows) {
      const key = `${String(row?.entity || "")}:${String(row?.record_id || "")}`;
      if (preserveKeys.has(key)) {
        preserved += 1;
        continue;
      }
      await remove(STORE_ENTITIES, row.cache_key);
      removed += 1;
    }
    return { removed, preserved };
  }

  async function clearSyncedOperations(maxToKeep = 100) {
    const synced = await listOperations({ statuses: ["synced"] });
    const removable = synced.slice(0, Math.max(synced.length - maxToKeep, 0));
    await Promise.all(removable.map(operation => remove(STORE_OPERATIONS, operation.operation_id)));
    return removable.length;
  }

  BlessERP.syncIndexedDb = {
    DB_NAME,
    clearSyncedOperations,
    findPendingForRecord,
    getMeta,
    getEntity(companyId, entity, recordId) {
      return get(STORE_ENTITIES, `${companyId}:${entity}:${recordId}`);
    },
    getOperation: operationId => get(STORE_OPERATIONS, operationId),
    listOperations,
    listEntityCache,
    open,
    putEntity,
    putOperation: operation => put(STORE_OPERATIONS, operation),
    removeOperation: operationId => remove(STORE_OPERATIONS, operationId),
    removeCachedEntities,
    setMeta,
    supported,
    updateOperation
  };
})();
