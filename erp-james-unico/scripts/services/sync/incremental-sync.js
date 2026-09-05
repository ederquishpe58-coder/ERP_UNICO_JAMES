(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const QUEUE_INTERVAL_MS = 30000;
  const HEALTH_TIMEOUT_MS = 6500;
  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_ATTEMPTS = 5;
  const QUEUE_SCHEMA_VERSION = 2;
  const OPERATION_SCHEMA_VERSION = 2;
  const MAX_REPLAY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const PENDING_STATUSES = Object.freeze(["pending", "syncing", "error"]);
  const NON_CAPTURE_ORIGINS = Object.freeze(new Set([
    "SERVER_HYDRATE", "INCREMENTAL_PULL", "REALTIME", "CACHE_RESTORE",
    "NORMALIZATION", "RENDER_DERIVATION", "SERVER_CONFIRMATION"
  ]));
  const QUARANTINE_REASONS = Object.freeze({
    LEGACY_NO_ENVIRONMENT: "LEGACY_NO_ENVIRONMENT",
    SCHEMA_VERSION_MISMATCH: "SCHEMA_VERSION_MISMATCH",
    COMPANY_MISMATCH: "COMPANY_MISMATCH",
    USER_MISMATCH: "USER_MISMATCH",
    PROJECT_MISMATCH: "PROJECT_MISMATCH",
    STALE_OPERATION: "STALE_OPERATION",
    INVALID_OPERATION_ID: "INVALID_OPERATION_ID",
    DERIVED_FIELD_ONLY: "DERIVED_FIELD_ONLY",
    EXPLICIT_SERVER_AUTHORITY: "EXPLICIT_SERVER_AUTHORITY",
    SERVER_ALREADY_APPLIED: "SERVER_ALREADY_APPLIED"
  });
  const registry = () => BlessERP.syncEntityRegistry;
  const store = () => BlessERP.syncIndexedDb;

  let started = false;
  let captureSuppressed = 0;
  let baseline = new Map();
  let processingPromise = null;
  const pullPromises = new Map();
  let supervisorTimer = null;
  let deviceId = "";
  let backendReady = null;
  let lastServerTime = "";
  let recoveryPromise = null;
  let captureChain = Promise.resolve();
  let queueWakeTimer = null;
  let captureRetryTimer = null;
  const syncAuditLogs = [];
  const SYNC_LOG_LIMIT = 300;
  const deferredRemoteRecords = new Map();
  const heldRemoteRecords = new Map();
  const suspendedCaptureRecords = new Set();
  const failedCaptureRecords = new Set();
  const enqueueChains = new Map();
  let currentStatus = {
    enabled: false,
    phase: "local",
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    serverReachable: false,
    backendReady: false,
    pendingCount: 0,
    errorCount: 0,
    conflictCount: 0,
    syncingCount: 0,
    lastSyncAt: "",
    lastHealthAt: "",
    lastError: "",
    realtimeState: "CLOSED"
  };

  function recordGuardKey(entity, recordId) {
    return `${String(entity || "").trim()}:${String(recordId || "").trim()}`;
  }

  function scopeHash(values) {
    let hash = 2166136261;
    String(values || "").split("").forEach(character => {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function resolvePullScope(options = {}) {
    const requested = Array.isArray(options.entities)
      ? options.entities.map(value => String(value || "").trim()).filter(Boolean)
      : registry().preloadEntities?.() || [];
    const known = [...new Set(requested)]
      .filter(entity => registry().descriptor?.(entity))
      .sort((left, right) => left.localeCompare(right));
    if (!known.length) throw new Error("La sincronizacion selectiva no tiene entidades validas.");
    const bootstrap = !Array.isArray(options.entities);
    const scope = bootstrap ? "bootstrap-v1" : `domain-${scopeHash(known.join("|"))}`;
    return { bootstrap, entities: known, entitySet: new Set(known), scope };
  }

  function isRemoteRecordHeld(serverRecord) {
    return Number(heldRemoteRecords.get(recordGuardKey(serverRecord?.entity, serverRecord?.record_id)) || 0) > 0;
  }

  function isRecordCaptureSuspended(entity, recordId) {
    return suspendedCaptureRecords.has(recordGuardKey(entity, recordId));
  }

  function hasFailedLocalCapture(entity, recordId) {
    return failedCaptureRecords.has(recordGuardKey(entity, recordId));
  }

  function suspendRecordCapture(entity, recordId) {
    if (!entity || !recordId) return false;
    suspendedCaptureRecords.add(recordGuardKey(entity, recordId));
    return true;
  }

  function resumeRecordCapture(entity, recordId) {
    return suspendedCaptureRecords.delete(recordGuardKey(entity, recordId));
  }

  function holdRecord(entity, recordId) {
    const key = recordGuardKey(entity, recordId);
    if (!entity || !recordId) return () => Promise.resolve({ ok: true, held: false });
    heldRemoteRecords.set(key, Number(heldRemoteRecords.get(key) || 0) + 1);
    let released = false;
    return async () => {
      if (released) return { ok: true, held: false };
      released = true;
      const remaining = Math.max(0, Number(heldRemoteRecords.get(key) || 0) - 1);
      if (remaining) heldRemoteRecords.set(key, remaining);
      else heldRemoteRecords.delete(key);
      return flushDeferredRemoteRecords();
    };
  }

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        // JSON es suficiente para los registros del ERP.
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function fieldChanges(baseValue, nextValue, path = []) {
    if (sameJson(baseValue, nextValue)) return [];
    if (isPlainObject(baseValue) && isPlainObject(nextValue)) {
      const keys = new Set([...Object.keys(baseValue), ...Object.keys(nextValue)]);
      return [...keys].flatMap(key => fieldChanges(baseValue[key], nextValue[key], [...path, key]));
    }
    return [{
      path,
      base_exists: baseValue !== undefined,
      base: baseValue === undefined ? null : clone(baseValue),
      value_exists: nextValue !== undefined,
      value: nextValue === undefined ? null : clone(nextValue)
    }];
  }

  function sanitizeChangePayload(entity, value) {
    return registry()?.sanitizePayload?.(entity, value) ?? clone(value || {});
  }

  function operationFieldChanges(entity, baseValue, nextValue) {
    return fieldChanges(
      sanitizeChangePayload(entity, baseValue),
      sanitizeChangePayload(entity, nextValue)
    );
  }

  function isDerivedOnlyOperation(operation) {
    if (String(operation?.action || "").toUpperCase() !== "UPDATE") return false;
    const changes = Array.isArray(operation?.field_changes)
      ? operation.field_changes
      : fieldChanges(operation?.base_payload || {}, operation?.payload || {});
    if (!changes.length) return true;
    return changes.every(change => registry()?.isDerivedField?.(operation?.entity, change?.path));
  }

  function config() {
    return BlessERP.getEnvConfig?.() || {};
  }

  function projectRef() {
    try {
      return new URL(config().supabaseUrl || "").hostname.split(".")[0] || "unknown";
    } catch {
      return "unknown";
    }
  }

  function applicationVersion() {
    const raw = config().raw || {};
    return String(raw.VITE_APP_VERSION || raw.VITE_BUILD_VERSION || "1.0.0").trim() || "1.0.0";
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function enabled() {
    const env = config();
    return Boolean(
      env.supabaseEnabled
      && env.authEnabled
      && env.rlsEnabled
      && env.coreSupabaseEnabled
      && env.incrementalSyncEnabled
      && BlessERP.getSupabaseClient?.()
    );
  }

  function context() {
    const access = BlessERP.authAccess?.activeAccess?.();
    const db = BlessERP.state?.state?.db;
    const companyId = access?.activeCompany?.id || db?.authAccess?.activeCompanyUuid || "";
    const companyKey = access?.activeCompanyKey || db?.authAccess?.activeCompanyKey || db?.activeCompanyId || "";
    const userId = access?.session?.user?.id || db?.session?.activeUser?.id || "";
    return { companyId, companyKey, userId, projectRef: projectRef() };
  }

  function replayGate(operation, syncContext = context(), at = Date.now()) {
    if (registry()?.descriptor?.(operation?.entity)?.syncMode === "EXPLICIT_COMMERCIAL_MASTER_DATA") {
      return { ok: false, reason: QUARANTINE_REASONS.EXPLICIT_SERVER_AUTHORITY };
    }
    if (isDerivedOnlyOperation(operation)) {
      return { ok: false, reason: QUARANTINE_REASONS.DERIVED_FIELD_ONLY };
    }
    if (!String(operation?.project_ref || "").trim() || String(operation.project_ref).toLowerCase() === "unknown") {
      return { ok: false, reason: QUARANTINE_REASONS.LEGACY_NO_ENVIRONMENT };
    }
    if (String(operation.project_ref) !== String(syncContext.projectRef || "")) {
      return { ok: false, reason: QUARANTINE_REASONS.PROJECT_MISMATCH };
    }
    if (!String(operation?.company_id || "").trim() || String(operation.company_id) !== String(syncContext.companyId || "")) {
      return { ok: false, reason: QUARANTINE_REASONS.COMPANY_MISMATCH };
    }
    if (syncContext.userId && (!operation.user_id || String(operation.user_id) !== String(syncContext.userId))) {
      return { ok: false, reason: QUARANTINE_REASONS.USER_MISMATCH };
    }
    if (Number(operation.queue_schema_version || 0) !== QUEUE_SCHEMA_VERSION
      || Number(operation.operation_schema_version || 0) !== OPERATION_SCHEMA_VERSION) {
      return { ok: false, reason: QUARANTINE_REASONS.SCHEMA_VERSION_MISMATCH };
    }
    if (!validUuid(operation.operation_id)) {
      return { ok: false, reason: QUARANTINE_REASONS.INVALID_OPERATION_ID };
    }
    const createdAt = Date.parse(operation.local_created_at || operation.created_at || "");
    if (!Number.isFinite(createdAt) || createdAt > at + 5 * 60 * 1000 || at - createdAt > MAX_REPLAY_AGE_MS) {
      return { ok: false, reason: QUARANTINE_REASONS.STALE_OPERATION };
    }
    return { ok: true, reason: "REPLAY_ALLOWED" };
  }

  function syncLog(event, detail = {}) {
    const syncContext = context();
    const entry = {
      event: String(event || "SYNC"),
      table: "erp_entity_records",
      entity: String(detail.entity || detail.operation?.entity || ""),
      record_id: String(detail.record_id || detail.recordId || detail.operation?.record_id || ""),
      version: Number(detail.version ?? detail.result_version ?? detail.operation?.result_version ?? detail.operation?.base_version ?? 0),
      operation_id: String(detail.operation_id || detail.operationId || detail.operation?.operation_id || ""),
      user_id: String(detail.user_id || detail.operation?.user_id || syncContext.userId || ""),
      device_id: String(detail.device_id || detail.operation?.device_id || deviceId || ""),
      source: String(detail.source || ""),
      reason: String(detail.reason || ""),
      at: nowIso()
    };
    syncAuditLogs.push(entry);
    if (syncAuditLogs.length > SYNC_LOG_LIMIT) {
      syncAuditLogs.splice(0, syncAuditLogs.length - SYNC_LOG_LIMIT);
    }
    console.info(`[${entry.event}]`, entry);
    window.dispatchEvent?.(new CustomEvent("erp:sync-audit", { detail: { ...entry } }));
    return entry;
  }

  function emitStatus(patch = {}) {
    currentStatus = {
      ...currentStatus,
      enabled: enabled(),
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      backendReady: backendReady === true,
      ...patch
    };
    window.dispatchEvent?.(new CustomEvent("erp:sync-status", { detail: status() }));
    return status();
  }

  function status() {
    return { ...currentStatus };
  }

  function timeout(promise, milliseconds, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => window.setTimeout(
        () => reject(Object.assign(new Error(`${label} excedió ${Math.ceil(milliseconds / 1000)} segundos.`), {
          code: "ERP_TIMEOUT"
        })),
        milliseconds
      ))
    ]);
  }

  function transientError(error) {
    return /timeout|tiempo|network|fetch|aborted|connection|socket|offline|failed to fetch|gateway|503|502|504/i
      .test(String(error?.message || error || ""));
  }

  function authorizationError(error) {
    const code = String(error?.code || error?.status || "").trim().toUpperCase();
    const message = String(error?.message || error?.details || error || "");
    return code === "42501"
      || code === "401"
      || code === "403"
      || /U2C3_.*DENIED|CAPABILITY_(?:DENIED|REQUIRED)|NO TIENE AUTORIZACI[ÓO]N|PERMISSION DENIED|NOT AUTHORIZED|UNAUTHORIZED|FORBIDDEN/i.test(message);
  }

  function migrationMissing(error) {
    return /erp_sync_health|erp_apply_offline_operation|erp_sync_operations|erp_entity_records|PGRST202|42P01|does not exist|no existe/i
      .test(String(error?.message || error || ""));
  }

  async function ensureDeviceId() {
    if (deviceId) return deviceId;
    deviceId = await store().getMeta("device_id", "");
    if (!deviceId) {
      deviceId = uuid();
      await store().setMeta("device_id", deviceId);
    }
    return deviceId;
  }

  async function initializeQueueMetadata(syncContext = context()) {
    const existing = await store().getMeta("queue_context", null);
    const initializedAt = String(existing?.initialized_at || nowIso());
    const metadata = {
      queue_schema_version: QUEUE_SCHEMA_VERSION,
      operation_schema_version: OPERATION_SCHEMA_VERSION,
      project_ref: String(syncContext.projectRef || ""),
      company_id: String(syncContext.companyId || ""),
      application_version: applicationVersion(),
      initialized_at: initializedAt,
      updated_at: nowIso()
    };
    await store().setMeta("queue_context", metadata);
    if (metadata.project_ref && metadata.company_id) {
      await store().setMeta(`queue_context:${metadata.project_ref}:${metadata.company_id}`, metadata);
    }
    await store().setMeta("queue_schema_version", QUEUE_SCHEMA_VERSION);
    return metadata;
  }

  async function quarantineOperation(operation, reason, reasons = []) {
    const originalStatus = String(operation?.original_status || operation?.status || "pending");
    const allReasons = [...new Set([reason, ...reasons].filter(Boolean))];
    const quarantined = await store().updateOperation(operation.operation_id, {
      status: "quarantined",
      original_status: originalStatus,
      quarantine_reason: String(reason || "UNVERIFIED_OPERATION"),
      quarantine_reasons: allReasons,
      legacy_classification: operation?.project_ref && String(operation.project_ref).toLowerCase() !== "unknown"
        ? ""
        : "LEGACY_UNVERIFIED",
      quarantined_at: nowIso(),
      forensic_preserved: true,
      next_retry_at: "",
      last_error: `Operación aislada: ${String(reason || "UNVERIFIED_OPERATION")}`
    });
    syncLog("QUEUE_QUARANTINED", {
      operation: quarantined || operation,
      reason: String(reason || "UNVERIFIED_OPERATION")
    });
    return quarantined;
  }

  async function quarantineUnverifiedOperations(syncContext = context()) {
    const operations = await store().listOperations({ statuses: PENDING_STATUSES });
    let quarantined = 0;
    const byReason = {};
    for (const operation of operations) {
      const gate = replayGate(operation, syncContext);
      if (gate.ok) continue;
      const secondaryReasons = [];
      if (isDerivedOnlyOperation(operation) && gate.reason !== QUARANTINE_REASONS.DERIVED_FIELD_ONLY) {
        secondaryReasons.push(QUARANTINE_REASONS.DERIVED_FIELD_ONLY);
      }
      if ((!operation.project_ref || String(operation.project_ref).toLowerCase() === "unknown")
        && gate.reason !== QUARANTINE_REASONS.LEGACY_NO_ENVIRONMENT) {
        secondaryReasons.push(QUARANTINE_REASONS.LEGACY_NO_ENVIRONMENT);
      }
      await quarantineOperation(operation, gate.reason, secondaryReasons);
      quarantined += 1;
      byReason[gate.reason] = Number(byReason[gate.reason] || 0) + 1;
    }
    return { quarantined, byReason };
  }

  async function refreshCounts(extra = {}) {
    const syncContext = context();
    const operations = await store().listOperations({ companyId: syncContext.companyId || undefined });
    const count = state => operations.filter(operation => operation.status === state).length;
    const pendingCount = operations.filter(operation =>
      ["pending", "syncing", "error"].includes(operation.status)
    ).length;
    const patch = {
      pendingCount,
      syncingCount: count("syncing"),
      errorCount: count("error"),
      conflictCount: count("conflict"),
      ...extra
    };
    if (!patch.phase) {
      patch.phase = patch.conflictCount
        ? "conflict"
        : patch.syncingCount
          ? "syncing"
          : patch.errorCount
            ? "error"
            : patch.pendingCount
              ? "pending"
              : currentStatus.serverReachable
                ? "synced"
                : currentStatus.phase;
    }
    return emitStatus(patch);
  }

  async function healthCheck(options = {}) {
    if (!enabled()) {
      backendReady = false;
      return emitStatus({
        phase: "local",
        serverReachable: false,
        lastError: ""
      });
    }
    if (navigator.onLine === false) {
      return emitStatus({
        phase: "offline",
        serverReachable: false,
        lastError: "El navegador no tiene conexión de red."
      });
    }
    emitStatus({ phase: options.reconnecting ? "reconnecting" : "checking" });
    const supabase = BlessERP.getSupabaseClient();
    const { companyId } = context();
    try {
      const { data, error } = await timeout(
        supabase.rpc("erp_sync_health", { p_company_id: companyId || null }),
        HEALTH_TIMEOUT_MS,
        "La comprobación de Supabase"
      );
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      backendReady = true;
      lastServerTime = String(result?.server_time || result?.serverTime || nowIso());
      return emitStatus({
        phase: currentStatus.pendingCount ? "pending" : "online",
        serverReachable: true,
        lastHealthAt: lastServerTime,
        lastError: ""
      });
    } catch (error) {
      backendReady = migrationMissing(error) ? false : backendReady;
      const message = migrationMissing(error)
        ? "La migración de sincronización incremental aún no está aplicada en Supabase."
        : (error?.message || "Supabase no respondió al health check.");
      return emitStatus({
        phase: navigator.onLine === false ? "offline" : "error",
        serverReachable: false,
        lastHealthAt: nowIso(),
        lastError: message
      });
    }
  }

  function scheduleQueueProcessing(delay = 40) {
    if (!started || !enabled() || navigator.onLine === false) return;
    if (queueWakeTimer) window.clearTimeout(queueWakeTimer);
    queueWakeTimer = window.setTimeout(async () => {
      queueWakeTimer = null;
      try {
        if (!currentStatus.serverReachable || backendReady !== true) {
          await healthCheck({ reconnecting: true });
        }
        if (currentStatus.serverReachable && backendReady === true) {
          await processQueue();
        }
      } catch (error) {
        emitStatus({
          phase: navigator.onLine === false ? "offline" : "error",
          lastError: error?.message || "No se pudo iniciar la sincronización automática."
        });
      }
    }, Math.max(0, Number(delay) || 0));
  }

  function scheduleCaptureRetry(delay = 900) {
    if (!started || captureRetryTimer) return;
    captureRetryTimer = window.setTimeout(() => {
      captureRetryTimer = null;
      void captureChanges(BlessERP.state?.state?.db).catch(error => {
        console.warn("[jaeder-sync] La recaptura local seguirá pendiente.", error);
      });
    }, Math.max(250, Number(delay) || 900));
  }

  function makeOperation(change, syncContext) {
    const basePayload = sanitizeChangePayload(change.entity, change.basePayload || {});
    const payload = sanitizeChangePayload(change.entity, change.payload || {});
    const createdAt = nowIso();
    return {
      operation_id: uuid(),
      entity: change.entity,
      action: change.action,
      record_id: change.recordId,
      payload,
      base_payload: basePayload,
      field_changes: fieldChanges(basePayload, payload),
      company_id: syncContext.companyId,
      company_key: syncContext.companyKey,
      user_id: syncContext.userId,
      project_ref: String(syncContext.projectRef || projectRef()),
      queue_schema_version: QUEUE_SCHEMA_VERSION,
      operation_schema_version: OPERATION_SCHEMA_VERSION,
      application_version: applicationVersion(),
      device_id: deviceId,
      created_at: createdAt,
      local_created_at: createdAt,
      attempts: 0,
      status: "pending",
      queued_offline: navigator.onLine === false || !currentStatus.serverReachable,
      last_error: "",
      base_version: Number(change.baseVersion || 0),
      base_updated_at: String(change.baseUpdatedAt || ""),
      next_retry_at: "",
      server_confirmed_at: "",
      result_version: 0
    };
  }

  async function enqueueChangeNow(change) {
    const syncContext = context();
    if (!syncContext.companyId || !syncContext.userId) return null;
    await ensureDeviceId();
    const sanitizedPayload = sanitizeChangePayload(change.entity, change.payload || {});
    const sanitizedBase = sanitizeChangePayload(change.entity, change.basePayload || {});
    const sanitizedChanges = fieldChanges(sanitizedBase, sanitizedPayload);
    if (String(change.action || "").toUpperCase() === "UPDATE" && !sanitizedChanges.length) return null;
    const normalizedChange = {
      ...change,
      payload: sanitizedPayload,
      basePayload: sanitizedBase
    };
    const existing = await store().findPendingForRecord(
      syncContext.companyId,
      change.entity,
      change.recordId
    );
    if (
      existing
      && existing.status === "pending"
      && Number(existing.attempts || 0) === 0
    ) {
      const action = existing.action === "INSERT"
        ? (change.action === "DELETE" ? "DELETE" : "INSERT")
        : change.action;
      const updated = await store().updateOperation(existing.operation_id, {
        action,
        payload: clone(sanitizedPayload),
        field_changes: operationFieldChanges(change.entity, existing.base_payload || {}, sanitizedPayload),
        local_created_at: nowIso(),
        queued_offline: existing.queued_offline === true || navigator.onLine === false || !currentStatus.serverReachable,
        last_error: ""
      });
      syncLog("LOCAL_EDIT", { operation: updated, version: updated?.base_version, reason: "COALESCED_PENDING_EDIT" });
      if (navigator.onLine === false || !currentStatus.serverReachable) {
        syncLog("OFFLINE_QUEUED", { operation: updated, version: updated?.base_version });
      }
      await refreshCounts({ phase: "pending" });
      scheduleQueueProcessing();
      return updated;
    }
    const operation = makeOperation(normalizedChange, syncContext);
    await store().putOperation(operation);
    syncLog("LOCAL_EDIT", { operation, version: operation.base_version });
    if (navigator.onLine === false || !currentStatus.serverReachable) {
      syncLog("OFFLINE_QUEUED", { operation, version: operation.base_version });
    }
    await refreshCounts({ phase: "pending" });
    scheduleQueueProcessing();
    return operation;
  }

  function diffSnapshots(previous, next) {
    const changes = [];
    registry().descriptors.forEach(descriptor => {
      const oldRows = previous.get(descriptor.entity) || new Map();
      const newRows = next.get(descriptor.entity) || new Map();
      newRows.forEach((current, recordId) => {
        const prior = oldRows.get(recordId);
        if (!prior || prior.fingerprint !== current.fingerprint) {
          changes.push({
            entity: descriptor.entity,
            action: prior ? "UPDATE" : "INSERT",
            recordId,
            payload: current.value,
            basePayload: prior?.value || {},
            baseVersion: prior?.version || 0,
            baseUpdatedAt: prior?.updatedAt || ""
          });
        }
      });
      oldRows.forEach((prior, recordId) => {
        if (newRows.has(recordId)) return;
        changes.push({
          entity: descriptor.entity,
          action: "DELETE",
          recordId,
          payload: prior.value,
          basePayload: prior.value,
          baseVersion: prior.version || 0,
          baseUpdatedAt: prior.updatedAt || ""
        });
      });
    });
    return changes;
  }

  function advanceBaselinePreservingSuspended(previous, next) {
    if (!suspendedCaptureRecords.size) return next;
    const merged = new Map();
    registry().descriptors.forEach(descriptor => {
      const oldRows = previous.get(descriptor.entity) || new Map();
      const nextRows = next.get(descriptor.entity) || new Map();
      const rows = new Map(nextRows);
      suspendedCaptureRecords.forEach(key => {
        const separator = key.indexOf(":");
        const entity = separator >= 0 ? key.slice(0, separator) : key;
        const recordId = separator >= 0 ? key.slice(separator + 1) : "";
        if (entity !== descriptor.entity || !recordId) return;
        if (oldRows.has(recordId)) rows.set(recordId, oldRows.get(recordId));
        else rows.delete(recordId);
      });
      merged.set(descriptor.entity, rows);
    });
    return merged;
  }

  function updateBaselineRecords(records, db = BlessERP.state?.state?.db) {
    if (!Array.isArray(records) || !records.length || !db) return false;
    const grouped = new Map();
    records.forEach(record => {
      const entityKey = String(record?.entity || "").trim();
      const recordKey = String(record?.recordId || record?.record_id || "").trim();
      if (!entityKey || !recordKey) return;
      if (!grouped.has(entityKey)) grouped.set(entityKey, new Set());
      grouped.get(entityKey).add(recordKey);
    });
    if (!grouped.size) return false;
    const current = registry().snapshot(db);
    const nextBaseline = new Map(baseline);
    grouped.forEach((recordIds, entityKey) => {
      const currentRows = current.get(entityKey) || new Map();
      const rows = new Map(nextBaseline.get(entityKey) || []);
      recordIds.forEach(recordKey => {
        if (currentRows.has(recordKey)) rows.set(recordKey, currentRows.get(recordKey));
        else rows.delete(recordKey);
      });
      nextBaseline.set(entityKey, rows);
    });
    baseline = nextBaseline;
    return true;
  }

  function updateBaselineRecord(entity, recordId, db = BlessERP.state?.state?.db) {
    return updateBaselineRecords([{ entity, recordId }], db);
  }

  function persistAppliedRemoteRecords(records, db = BlessERP.state?.state?.db) {
    if (!Array.isArray(records) || !records.length || !db) return false;
    captureSuppressed += 1;
    try {
      // Las páginas remotas ya se guardaron registro por registro en IndexedDB.
      // Serializar state.db y recalcular su snapshot una vez por fila hacía que
      // dominios operativos medianos agotaran el timeout aun con Supabase sano.
      BlessERP.storage?.save?.(db);
      updateBaselineRecords(records, db);
      return true;
    } finally {
      captureSuppressed -= 1;
    }
  }

  async function discardCacheOnlyExplicitRecords(observedRemoteRecords, allowedEntities, db = BlessERP.state?.state?.db) {
    // Una carga completa es también una reconciliación de caché. Para las
    // entidades V2, un registro que no existe en Supabase no puede conservarse
    // como si fuera empresarial. Los módulos legacy todavía no se podan porque
    // pueden tener una operación incremental legítima pendiente de migración.
    if (!(observedRemoteRecords instanceof Set) || !db) {
      return { discarded: 0, preservedPending: 0 };
    }
    const syncContext = context();
    let discarded = 0;
    let preservedPending = 0;
    const discardedRecords = [];
    const allowed = allowedEntities instanceof Set ? allowedEntities : null;
    for (const descriptor of registry().descriptors) {
      if (allowed && !allowed.has(descriptor.entity)) continue;
      if (!registry().isExplicitCaptureReady?.(descriptor)) continue;
      const localRows = [...registry().recordsFor(db, descriptor)];
      for (const row of localRows) {
        const recordId = descriptor.kind === "singleton"
          ? descriptor.entity
          : registry().recordId(row);
        if (!recordId || observedRemoteRecords.has(recordGuardKey(descriptor.entity, recordId))) continue;
        const pending = syncContext.companyId
          ? await store().findPendingForRecord(syncContext.companyId, descriptor.entity, recordId)
          : null;
        const explicitServerAuthority = descriptor.syncMode === "EXPLICIT_COMMERCIAL_MASTER_DATA";
        if (!explicitServerAuthority && pending && pending.status !== "synced") {
          preservedPending += 1;
          continue;
        }
        const result = registry().applyServerRecord(db, {
          company_id: syncContext.companyId,
          entity: descriptor.entity,
          record_id: recordId,
          payload: {},
          version: Math.max(1, Number(row?.__syncVersion || 0) + 1),
          updated_at: lastServerTime || nowIso(),
          deleted_at: lastServerTime || nowIso(),
          last_operation_id: ""
        }, { forceServer: true });
        if (result.changed) {
          discarded += 1;
          discardedRecords.push({ entity: descriptor.entity, recordId });
        }
      }
    }
    if (discarded) {
      captureSuppressed += 1;
      try {
        BlessERP.storage?.save?.(db);
        discardedRecords.forEach(item => updateBaselineRecord(item.entity, item.recordId, db));
      } finally {
        captureSuppressed -= 1;
      }
    }
    return { discarded, preservedPending };
  }

  async function evictNonBootstrapLocalRecords(db = BlessERP.state?.state?.db) {
    if (!db) return { localRemoved: 0, indexedDbRemoved: 0, preservedPending: 0, entities: [] };
    const syncContext = context();
    if (!syncContext.companyId) return { localRemoved: 0, indexedDbRemoved: 0, preservedPending: 0, entities: [] };
    const excludedEntities = registry().nonPreloadEntities?.() || [];
    const excluded = new Set(excludedEntities);
    // El bootstrap y la primera ruta se inician en paralelo. Si un dominio
    // lazy ya está activo, su hidratación canónica no puede ser desalojada por
    // la limpieza selectiva que termina unos milisegundos después.
    const activeDomainEntities = new Set(excludedEntities.filter(entity => (
      BlessERP.domainDataLoader?.isEntityActive?.(entity) === true
    )));
    const evictableEntities = excludedEntities.filter(entity => !activeDomainEntities.has(entity));
    const pendingOperations = await store().listOperations({
      companyId: syncContext.companyId,
      statuses: ["pending", "syncing", "error", "conflict"]
    });
    const preserveKeys = new Set(pendingOperations
      .filter(operation => excluded.has(String(operation?.entity || "")))
      .map(operation => recordGuardKey(operation.entity, operation.record_id)));
    let localRemoved = 0;
    let preservedPending = 0;
    captureSuppressed += 1;
    try {
      for (const descriptor of registry().descriptors) {
        if (!excluded.has(descriptor.entity)) continue;
        if (activeDomainEntities.has(descriptor.entity)) continue;
        const currentRows = [...registry().recordsFor(db, descriptor)];
        const keptRows = currentRows.filter(row => {
          const recordId = descriptor.kind === "singleton" ? descriptor.entity : registry().recordId(row);
          if (preserveKeys.has(recordGuardKey(descriptor.entity, recordId))) {
            preservedPending += 1;
            return true;
          }
          localRemoved += 1;
          return false;
        });
        if (keptRows.length !== currentRows.length) registry().setRecords(db, descriptor, keptRows);
      }
      if (localRemoved) BlessERP.storage?.save?.(db);
      baseline = registry().snapshot(db);
    } finally {
      captureSuppressed -= 1;
    }
    const cacheCleanup = await store().removeCachedEntities(
      syncContext.companyId,
      evictableEntities,
      { preserveKeys: [...preserveKeys] }
    );
    return {
      localRemoved,
      indexedDbRemoved: Number(cacheCleanup?.removed || 0),
      preservedPending: Math.max(preservedPending, Number(cacheCleanup?.preserved || 0)),
      entities: evictableEntities,
      preservedActiveEntities: activeDomainEntities.size
    };
  }

  function captureChanges(db = BlessERP.state?.state?.db, options = {}) {
    const origin = String(options.origin || options.source || "USER_MUTATION").trim().toUpperCase();
    if (NON_CAPTURE_ORIGINS.has(origin)) return Promise.resolve([]);
    if (!started || captureSuppressed || !enabled() || !db) return Promise.resolve([]);
    const next = registry().snapshot(db);
    const runCapture = async () => {
      const changes = diffSnapshots(baseline, next).filter(change => (
        !isRecordCaptureSuspended(change.entity, change.recordId)
      ));
      if (!changes.length) return [];
      emitStatus({
        phase: "pending",
        pendingCount: Math.max(Number(currentStatus.pendingCount || 0), changes.length)
      });
      try {
        const operations = await Promise.all(changes.map(enqueueChange));
        changes.forEach(change => failedCaptureRecords.delete(recordGuardKey(change.entity, change.recordId)));
        // Solo se avanza después de que IndexedDB confirmó toda la captura.
        // Si falla una escritura, el siguiente intento vuelve a detectar el
        // cambio y nunca lo considera guardado prematuramente.
        baseline = advanceBaselinePreservingSuspended(baseline, next);
        scheduleQueueProcessing();
        return operations.filter(Boolean);
      } catch (error) {
        changes.forEach(change => failedCaptureRecords.add(recordGuardKey(change.entity, change.recordId)));
        emitStatus({
          phase: "error",
          lastError: `No se pudo guardar la cola local: ${error?.message || error}`
        });
        scheduleCaptureRetry();
        throw error;
      }
    };
    const queuedCapture = captureChain.catch(() => undefined).then(runCapture);
    captureChain = queuedCapture;
    return queuedCapture;
  }

  async function findRemoteOperation(operationId) {
    const supabase = BlessERP.getSupabaseClient();
    const { data, error } = await timeout(
      supabase
        .from("erp_sync_operations")
        .select("operation_id, company_id, entity, record_id, status, result_version, server_created_at, server_processed_at, last_error, conflict_details, discarded_fields, merge_summary")
        .eq("operation_id", operationId)
        .maybeSingle(),
      REQUEST_TIMEOUT_MS,
      "La comprobación idempotente"
    );
    if (error) throw error;
    return data || null;
  }

  async function markConfirmed(operation, result = {}) {
    const serverTime = String(
      result.server_processed_at
      || result.server_time
      || result.server_created_at
      || lastServerTime
      || nowIso()
    );
    await store().updateOperation(operation.operation_id, {
      status: "synced",
      last_error: "",
      server_confirmed_at: serverTime,
      result_version: Number(result.result_version || result.version || operation.result_version || 0),
      discarded_fields: clone(result.discarded_fields || []),
      merge_summary: clone(result.merge_summary || {})
    });
    syncLog("SUPABASE_CONFIRMED", {
      operation,
      version: Number(result.result_version || result.version || operation.result_version || 0)
    });
    if (operation.queued_offline === true) {
      syncLog("OFFLINE_SYNCED", {
        operation,
        version: Number(result.result_version || result.version || operation.result_version || 0)
      });
    }
    return serverTime;
  }

  async function markConflict(operation, result = {}) {
    await store().updateOperation(operation.operation_id, {
      status: "conflict",
      last_error: String(result.last_error || result.message || "El registro cambió en otro dispositivo."),
      server_confirmed_at: String(result.server_processed_at || result.server_time || lastServerTime || nowIso()),
      result_version: Number(result.result_version || result.version || 0),
      server_record: clone(result.server_record || result.conflict_details?.server_record || null),
      conflict_details: clone(result.conflict_details || result)
    });
    syncLog("CONFLICT", {
      operation,
      version: Number(result.result_version || result.version || 0),
      reason: String(result.last_error || result.message || "SERVER_VERSION_CHANGED")
    });
  }

  function captureRecord(entity, recordId, db = BlessERP.state?.state?.db, options = {}) {
    const origin = String(options.origin || options.source || "USER_MUTATION").trim().toUpperCase();
    if (NON_CAPTURE_ORIGINS.has(origin)) return Promise.resolve(null);
    if (!started || captureSuppressed || !enabled() || !db || !entity || !recordId) return Promise.resolve(null);
    const next = registry().snapshot(db);
    const runCapture = async () => {
      const oldRows = baseline.get(String(entity)) || new Map();
      const nextRows = next.get(String(entity)) || new Map();
      const prior = oldRows.get(String(recordId));
      const current = nextRows.get(String(recordId));
      if (!prior && !current) return null;
      const change = current
        ? {
            entity: String(entity),
            action: Number(current.version || 0) > 0 ? "UPDATE" : "INSERT",
            recordId: String(recordId),
            payload: current.value,
            basePayload: prior?.value || {},
            baseVersion: prior?.version || current.version || 0,
            baseUpdatedAt: prior?.updatedAt || current.updatedAt || ""
          }
        : {
            entity: String(entity),
            action: "DELETE",
            recordId: String(recordId),
            payload: prior.value,
            basePayload: prior.value,
            baseVersion: prior.version || 0,
            baseUpdatedAt: prior.updatedAt || ""
          };
      emitStatus({
        phase: "pending",
        pendingCount: Math.max(Number(currentStatus.pendingCount || 0), 1)
      });
      try {
        const operation = await enqueueChange(change);
        failedCaptureRecords.delete(recordGuardKey(change.entity, change.recordId));
        baseline = advanceBaselinePreservingSuspended(baseline, next);
        scheduleQueueProcessing();
        return operation;
      } catch (error) {
        failedCaptureRecords.add(recordGuardKey(change.entity, change.recordId));
        scheduleCaptureRetry();
        throw error;
      }
    };
    const queuedCapture = captureChain.catch(() => undefined).then(runCapture);
    captureChain = queuedCapture;
    return queuedCapture;
  }

  async function autoResolveConflictOperation(operation, result = {}) {
    await markConflict(operation, result);
    const automaticAttempts = Number(operation.auto_resolution_attempts || 0);
    let serverRecord = clone(
      result.server_record
      || result.conflict_details?.server_record
      || operation.server_record
      || operation.conflict_details?.server_record
      || null
    );
    if (!serverRecord && operation.entity !== "erp_company_state") {
      try { serverRecord = await fetchServerRecord(operation); } catch {}
    }

    if (operation.entity === "erp_company_state") {
      await store().updateOperation(operation.operation_id, {
        status: "synced",
        resolution: "AUTO_SNAPSHOT_IGNORED",
        resolved_at: nowIso(),
        last_error: "",
        server_record: serverRecord
      });
      return { ok: true, resolved: true, mode: "SNAPSHOT_AUDIT_ONLY" };
    }

    if (automaticAttempts >= 1) {
      // La función SQL actual fusiona parches por campo. Si un backend antiguo
      // todavía responde CONFLICT una segunda vez, Supabase prevalece como
      // fuente oficial y el cambio descartado permanece completo en auditoría.
      if (serverRecord) {
        await applyRemoteRecord(serverRecord, { source: "AUTO_CONFLICT_SERVER_LATEST", force: true });
      }
      await store().updateOperation(operation.operation_id, {
        status: "synced",
        resolution: "AUTO_SERVER_LATEST_AUDITED",
        resolved_at: nowIso(),
        last_error: "",
        server_record: serverRecord,
        discarded_local_payload: clone(operation.payload || {}),
        discarded_fields: clone(operation.field_changes || [])
      });
      return { ok: true, resolved: true, mode: "SERVER_LATEST_AUDITED" };
    }

    const originalBase = clone(operation.base_payload || {});
    const replacement = makeOperation({
      entity: operation.entity,
      action: operation.action,
      recordId: operation.record_id,
      payload: clone(operation.payload || {}),
      basePayload: originalBase,
      baseVersion: Number(operation.base_version || 0),
      baseUpdatedAt: String(operation.base_updated_at || "")
    }, {
      companyId: operation.company_id,
      companyKey: operation.company_key,
      userId: operation.user_id || context().userId
    });
    replacement.field_changes = clone(operation.field_changes || fieldChanges(originalBase, operation.payload || {}));
    replacement.auto_resolution_attempts = automaticAttempts + 1;
    replacement.auto_resolution_of = operation.operation_id;
    await store().updateOperation(operation.operation_id, {
      status: "synced",
      resolution: "AUTO_FIELD_MERGE_REQUEUED",
      resolved_at: nowIso(),
      last_error: "",
      replacement_operation_id: replacement.operation_id,
      server_record: serverRecord
    });
    await store().putOperation(replacement);
    return { ok: true, queued: true, replacement, mode: "FIELD_MERGE_REQUEUED" };
  }

  async function reconcileLegacyConflicts() {
    const syncContext = context();
    const conflicts = await store().listOperations({
      companyId: syncContext.companyId || undefined,
      statuses: ["conflict"]
    });
    for (const operation of conflicts) {
      await autoResolveConflictOperation(operation, operation.conflict_details || {});
    }
    return conflicts.length;
  }

  async function fetchServerRecord(operation) {
    const supabase = BlessERP.getSupabaseClient();
    const { data, error } = await timeout(
      supabase.from("erp_entity_records")
        .select("id, company_id, entity, record_id, payload, version, created_at, updated_at, created_by, updated_by, device_id, last_operation_id, deleted_at")
        .eq("company_id", operation.company_id)
        .eq("entity", operation.entity)
        .eq("record_id", operation.record_id)
        .maybeSingle(),
      REQUEST_TIMEOUT_MS,
      "La confirmación del registro"
    );
    if (error) throw error;
    return data || null;
  }

  async function recordSystemConflict(detail = {}) {
    await ensureDeviceId();
    const syncContext = context();
    const metaKey = `cloud_state_conflict:${syncContext.companyId || syncContext.companyKey || "local"}`;
    let operationId = await store().getMeta(metaKey, "");
    if (!operationId) {
      operationId = uuid();
      await store().setMeta(metaKey, operationId);
    }
    const operation = {
      operation_id: operationId,
      entity: "erp_company_state",
      action: "UPDATE",
      record_id: syncContext.companyKey || syncContext.companyId || "company-state",
      payload: clone(BlessERP.state?.state?.db || {}),
      company_id: syncContext.companyId,
      company_key: syncContext.companyKey,
      user_id: syncContext.userId,
      project_ref: syncContext.projectRef,
      queue_schema_version: QUEUE_SCHEMA_VERSION,
      operation_schema_version: OPERATION_SCHEMA_VERSION,
      application_version: applicationVersion(),
      device_id: deviceId,
      local_created_at: nowIso(),
      attempts: 0,
      status: "conflict",
      last_error: String(detail.message || "Hay un conflicto entre equipos."),
      conflict_details: clone(detail),
      server_confirmed_at: "",
      base_version: Number(BlessERP.cloudStateSync?.status?.().revision || 0)
    };
    await store().putOperation(operation);
    await refreshCounts({ phase: "conflict" });
    return operation;
  }

  function enqueueChange(change) {
    const key = recordGuardKey(change?.entity, change?.recordId);
    const releaseRemoteRecord = holdRecord(change?.entity, change?.recordId);
    const previous = enqueueChains.get(key) || Promise.resolve();
    let completed = null;
    const queued = previous
      .catch(error => {
        console.warn("[jaeder-sync] La captura anterior del registro no pudo terminar; se conservara el cambio mas reciente.", error);
      })
      .then(() => enqueueChangeNow(change));
    completed = queued.finally(async () => {
      await releaseRemoteRecord();
      if (enqueueChains.get(key) === completed) enqueueChains.delete(key);
    });
    enqueueChains.set(key, completed);
    return completed;
  }

  async function applyOperation(operation, baseVersionOverride = null) {
    const supabase = BlessERP.getSupabaseClient();
    const gate = replayGate(operation);
    if (!gate.ok) {
      await quarantineOperation(operation, gate.reason);
      return { ok: true, quarantined: true, applied: false, reason: gate.reason };
    }
    const alreadyProcessed = await findRemoteOperation(operation.operation_id);
    if (alreadyProcessed) {
      if (alreadyProcessed.status === "CONFLICT") {
        const automatic = await autoResolveConflictOperation(operation, alreadyProcessed);
        return { ok: automatic.ok, autoQueued: automatic.queued, automatic, result: alreadyProcessed };
      }
      if (["APPLIED", "SYNCED"].includes(String(alreadyProcessed.status || "").toUpperCase())) {
        syncLog("DUPLICATE_IGNORED", {
          operation,
          version: Number(alreadyProcessed.result_version || 0),
          reason: "OPERATION_ID_ALREADY_PROCESSED"
        });
        await markConfirmed(operation, alreadyProcessed);
        const serverRecord = await fetchServerRecord(operation);
        if (serverRecord) await applyRemoteRecord(serverRecord, { source: "IDEMPOTENT_CONFIRMATION" });
        return { ok: true, result: { ...alreadyProcessed, server_record: serverRecord }, idempotent: true };
      }
    }
    const attempts = Number(operation.attempts || 0) + 1;
    await store().updateOperation(operation.operation_id, {
      status: "syncing",
      attempts,
      last_attempt_at: nowIso(),
      last_error: ""
    });
    syncLog("SUPABASE_SEND", { operation, version: operation.base_version });
    await refreshCounts({ phase: "syncing" });
    const baseVersion = baseVersionOverride === null
      ? Number(operation.base_version || 0)
      : Number(baseVersionOverride || 0);
    try {
      const { data, error } = await timeout(
        supabase.rpc("erp_apply_offline_operation", {
          p_operation_id: operation.operation_id,
          p_company_id: operation.company_id,
          p_device_id: operation.device_id,
          p_entity: operation.entity,
          p_action: operation.action,
          p_record_id: operation.record_id,
          p_payload: operation.payload || {},
          p_base_payload: operation.base_payload || {},
          p_field_changes: operation.field_changes || fieldChanges(operation.base_payload || {}, operation.payload || {}),
          p_base_version: baseVersion,
          p_local_created_at: operation.local_created_at
        }),
        REQUEST_TIMEOUT_MS,
        "El guardado en Supabase"
      );
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (String(result?.status || "").toUpperCase() === "CONFLICT" || result?.conflict) {
        const automatic = await autoResolveConflictOperation(operation, result);
        return { ok: automatic.ok, autoQueued: automatic.queued, automatic, result };
      }
      await markConfirmed(operation, result || {});
      const serverRecord = result?.server_record || await fetchServerRecord(operation);
      if (!serverRecord) throw new Error("Supabase confirmó la operación, pero no devolvió el registro definitivo.");
      await applyRemoteRecord(serverRecord, { source: "SERVER_CONFIRMATION" });
      return { ok: true, result: { ...(result || {}), server_record: serverRecord } };
    } catch (error) {
      if (authorizationError(error)) {
        await quarantineOperation(operation, "AUTHORIZATION_DENIED", [String(error?.code || "42501")]);
        emitStatus({
          phase: "error",
          lastError: "No tiene autorización para realizar esta acción."
        });
        return { ok: false, error, retryable: false, authorizationDenied: true };
      }
      // Si la respuesta se perdió después del COMMIT, el siguiente intento primero
      // consultará operation_id y no volverá a insertar.
      const exhausted = attempts >= MAX_ATTEMPTS && !transientError(error);
      const delaySeconds = Math.min(60, 2 ** Math.min(attempts, 6));
      await store().updateOperation(operation.operation_id, {
        status: exhausted ? "error" : "pending",
        last_error: String(error?.message || error || "No se pudo sincronizar."),
        next_retry_at: new Date(Date.now() + delaySeconds * 1000).toISOString()
      });
      return { ok: false, error, retryable: !exhausted };
    }
  }

  async function processQueue() {
    if (processingPromise) return processingPromise;
    processingPromise = (async () => {
      if (!enabled()) return { ok: true, mode: "LOCAL" };
      await quarantineUnverifiedOperations(context());
      await refreshCounts();
      if (!currentStatus.serverReachable || backendReady !== true) {
        await healthCheck({ reconnecting: true });
      }
      if (!currentStatus.serverReachable || backendReady !== true) {
        return { ok: false, mode: "SERVER_UNAVAILABLE", message: currentStatus.lastError };
      }
      await reconcileLegacyConflicts();
      const syncContext = context();
      const operations = await store().listOperations({
        companyId: syncContext.companyId || undefined,
        statuses: PENDING_STATUSES
      });
      const recordVersions = new Map();
      let applied = 0;
      let conflicts = 0;
      for (const operation of operations) {
        const retryAt = Date.parse(operation.next_retry_at || "");
        if (Number.isFinite(retryAt) && retryAt > Date.now()) continue;
        const key = `${operation.company_id}:${operation.entity}:${operation.record_id}`;
        const override = recordVersions.has(key) ? recordVersions.get(key) : null;
        const result = await applyOperation(operation, override);
        if (result.ok) {
          if (!result.quarantined) applied += 1;
          if (result.autoQueued) window.setTimeout(() => processQueue(), 0);
          const version = Number(result.result?.result_version || result.result?.version || 0);
          if (version) recordVersions.set(key, version);
        } else if (result.conflict) {
          conflicts += 1;
        } else if (navigator.onLine === false || transientError(result.error)) {
          emitStatus({
            phase: navigator.onLine === false ? "offline" : "reconnecting",
            serverReachable: false,
            lastError: result.error?.message || "La conexión se interrumpió durante la sincronización."
          });
          break;
        }
      }
      if (currentStatus.serverReachable) await pullIncremental();
      await store().clearSyncedOperations(100);
      const finalStatus = await refreshCounts({
        lastSyncAt: applied ? (lastServerTime || nowIso()) : currentStatus.lastSyncAt
      });
      const confirmed = !finalStatus.pendingCount
        && !finalStatus.errorCount
        && !finalStatus.conflictCount
        && !finalStatus.syncingCount;
      return {
        ok: confirmed,
        mode: confirmed ? "SERVER_CONFIRMED" : "PENDING_OR_ERROR",
        applied,
        conflicts: finalStatus.conflictCount,
        pending: finalStatus.pendingCount,
        errors: finalStatus.errorCount
      };
    })().finally(() => {
      processingPromise = null;
    });
    return processingPromise;
  }

  async function confirmRecord(entity, recordId, options = {}) {
    if (!enabled()) return { ok: true, confirmed: false, mode: "LOCAL" };
    const syncContext = context();
    const pending = await store().findPendingForRecord(
      syncContext.companyId,
      String(entity || ""),
      String(recordId || "")
    );
    if (pending && pending.status !== "synced") {
      return {
        ok: false,
        confirmed: false,
        mode: "RECORD_PENDING",
        message: pending.last_error || "El pedido sigue pendiente de confirmación en Supabase."
      };
    }
    const serverRecord = await fetchServerRecord({
      company_id: syncContext.companyId,
      entity: String(entity || ""),
      record_id: String(recordId || "")
    });
    if (!serverRecord) {
      return {
        ok: false,
        confirmed: false,
        mode: "RECORD_NOT_FOUND",
        message: "Supabase todavía no devuelve el pedido guardado."
      };
    }
    const minimumVersion = Math.max(0, Number(options.minimumVersion || 0));
    if (minimumVersion && Number(serverRecord.version || 0) < minimumVersion) {
      return {
        ok: false,
        confirmed: false,
        mode: "RECORD_VERSION_NOT_CONFIRMED",
        serverVersion: Number(serverRecord.version || 0),
        minimumVersion,
        message: "Supabase respondió con una versión anterior del pedido; se mantendrá la edición local y se reintentará."
      };
    }
    await applyRemoteRecord(serverRecord, { source: "RECORD_CONFIRMATION" });
    return {
      ok: true,
      confirmed: true,
      mode: "RECORD_CONFIRMED",
      version: Number(serverRecord.version || 0),
      serverRecord
    };
  }

  async function applyRemoteRecord(serverRecord, options = {}) {
    const db = BlessERP.state?.state?.db;
    if (!db || !serverRecord?.entity || !serverRecord?.record_id) return { ok: false };
    if (options.source === "REALTIME") {
      syncLog("REALTIME_RECEIVED", {
        entity: serverRecord.entity,
        record_id: serverRecord.record_id,
        version: serverRecord.version,
        operation_id: serverRecord.last_operation_id,
        user_id: serverRecord.updated_by,
        device_id: serverRecord.device_id,
        source: options.source
      });
    }
    if (
      (!options.ignoreRecordHold && isRemoteRecordHeld(serverRecord))
      || hasFailedLocalCapture(serverRecord.entity, serverRecord.record_id)
      || (!options.ignoreEditGuard && BlessERP.layout?.isEditing?.())
    ) {
      const key = `${serverRecord.company_id}:${serverRecord.entity}:${serverRecord.record_id}`;
      const existing = deferredRemoteRecords.get(key);
      const existingVersion = Number(existing?.version || 0);
      const nextVersion = Number(serverRecord.version || 0);
      if (!existing || nextVersion >= existingVersion) {
        deferredRemoteRecords.set(key, clone(serverRecord));
      }
      await store().putEntity(serverRecord);
      return {
        ok: true,
        changed: false,
        deferred: true,
        reason: (!options.ignoreRecordHold && isRemoteRecordHeld(serverRecord))
          ? "RECORD_SAVE_IN_PROGRESS"
          : hasFailedLocalCapture(serverRecord.entity, serverRecord.record_id)
            ? "LOCAL_CAPTURE_RETRY_PENDING"
            : "ACTIVE_FORM_EDIT"
      };
    }
    const pending = await store().findPendingForRecord(
      serverRecord.company_id,
      serverRecord.entity,
      serverRecord.record_id
    );
    if (!options.force && pending && pending.status !== "synced") {
      // La operación conserva su base y su parche. El servidor fusionará campos
      // distintos y auditará solamente los campos concurrentes; no se bloquea.
      await store().putEntity(serverRecord);
      await store().updateOperation(pending.operation_id, {
        latest_server_record: clone(serverRecord),
        latest_server_version: Number(serverRecord.version || 0),
        latest_server_seen_at: String(serverRecord.updated_at || nowIso())
      });
      return { ok: true, skipped: true, pendingMerge: true };
    }
    const applied = registry().applyServerRecord(db, serverRecord, {
      // Una respuesta confirmada, Realtime o una consulta directa proviene de
      // la fuente oficial. Las colas locales pendientes ya fueron protegidas
      // arriba; fuera de ellas no se permite que metadatos locales obsoletos
      // rechacen la version de Supabase.
      forceServer: options.forceServer === true
        || ["ATOMIC_ORDER_SAVE", "INCREMENTAL_PULL", "REALTIME", "RECORD_CONFIRMATION"].includes(options.source)
    });
    await store().putEntity(serverRecord);
    if (applied.ignoredOlder) {
      syncLog("REMOTE_IGNORED_OLDER_VERSION", {
        entity: serverRecord.entity,
        record_id: serverRecord.record_id,
        version: serverRecord.version,
        operation_id: serverRecord.last_operation_id,
        user_id: serverRecord.updated_by,
        device_id: serverRecord.device_id,
        source: options.source,
        reason: `${applied.reason}:LOCAL_${applied.localVersion}:REMOTE_${applied.remoteVersion}`
      });
      return applied;
    }
    if (applied.duplicate) {
      syncLog("DUPLICATE_IGNORED", {
        entity: serverRecord.entity,
        record_id: serverRecord.record_id,
        version: serverRecord.version,
        operation_id: serverRecord.last_operation_id,
        source: options.source,
        reason: applied.reason
      });
      return applied;
    }
    if (applied.changed && options.deferSnapshotPersistence !== true) {
      // Una confirmación remota solo puede avanzar la línea base del registro
      // recibido. Reemplazar la línea base completa podía absorber cambios
      // locales todavía no enviados en otras colecciones (p. ej. Recepción,
      // Inventario o Cuarto Frío) y hacerlos desaparecer en otro dispositivo.
      persistAppliedRemoteRecords([{
        entity: serverRecord.entity,
        recordId: serverRecord.record_id
      }], db);
    }
    return applied;
  }

  async function flushDeferredRemoteRecords() {
    if (BlessERP.layout?.isEditing?.() || !deferredRemoteRecords.size) {
      return { ok: true, changed: 0, pending: deferredRemoteRecords.size };
    }
    const records = [...deferredRemoteRecords.values()];
    deferredRemoteRecords.clear();
    let changed = 0;
    const changedEntities = new Set();
    for (const record of records) {
      if (isRemoteRecordHeld(record) || hasFailedLocalCapture(record.entity, record.record_id)) {
        const key = `${record.company_id}:${record.entity}:${record.record_id}`;
        deferredRemoteRecords.set(key, record);
        continue;
      }
      const result = await applyRemoteRecord(record, {
        source: "DEFERRED_AFTER_EDIT",
        ignoreEditGuard: true
      });
      if (result.changed) {
        changed += 1;
        changedEntities.add(String(record.entity || ""));
      }
    }
    if (changed) {
      window.dispatchEvent?.(new CustomEvent("erp:incremental-sync-applied", {
        detail: { changed, entities: [...changedEntities].filter(Boolean), source: "DEFERRED_AFTER_EDIT" }
      }));
    }
    return { ok: true, changed, pending: deferredRemoteRecords.size };
  }

  async function pullIncrementalNow(options = {}) {
    if (!enabled() || !currentStatus.serverReachable || backendReady !== true) {
      return { ok: false, mode: "UNAVAILABLE" };
    }
    const syncContext = context();
    if (!syncContext.companyId) return { ok: false, mode: "NO_COMPANY" };
    const pullScope = resolvePullScope(options);
    const metaKey = `last_sync:${syncContext.projectRef}:${syncContext.companyId}:${pullScope.scope}`;
    const lastSyncAt = options.full === true
      ? "1970-01-01T00:00:00.000Z"
      : await store().getMeta(metaKey, "1970-01-01T00:00:00.000Z");
    const supabase = BlessERP.getSupabaseClient();
    let offset = 0;
    let changed = 0;
    let deferred = 0;
    let fetchedRows = 0;
    const observedRemoteRecords = options.full === true ? new Set() : null;
    const changedEntities = new Set();
    let newest = String(lastSyncAt);
    while (true) {
      let query = supabase
        .from("erp_entity_records")
        .select("id, company_id, entity, record_id, payload, version, created_at, updated_at, created_by, updated_by, device_id, last_operation_id, deleted_at")
        .eq("company_id", syncContext.companyId)
        .in("entity", pullScope.entities)
        .gt("updated_at", lastSyncAt)
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 499);
      const { data, error } = await timeout(
        query,
        REQUEST_TIMEOUT_MS,
        "La resincronización incremental"
      );
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      fetchedRows += rows.length;
      const pageAppliedRecords = [];
      try {
        for (const row of rows) {
          observedRemoteRecords?.add(recordGuardKey(row.entity, row.record_id));
          const result = await applyRemoteRecord(row, {
            source: "INCREMENTAL_PULL",
            deferSnapshotPersistence: true
          });
          if (result.changed) {
            changed += 1;
            changedEntities.add(String(row.entity || ""));
            pageAppliedRecords.push({ entity: row.entity, recordId: row.record_id });
          }
          if (result.deferred) deferred += 1;
          if (String(row.updated_at || "") > newest) newest = String(row.updated_at);
        }
      } finally {
        // Persistir incluso los registros ya aplicados de una página que falle
        // después; el cursor no avanza y el siguiente pull revalida versiones.
        persistAppliedRemoteRecords(pageAppliedRecords);
      }
      if (rows.length < 500) break;
      offset += rows.length;
    }
    const authorityCleanup = options.full === true
      ? await discardCacheOnlyExplicitRecords(observedRemoteRecords, pullScope.entitySet)
      : { discarded: 0, preservedPending: 0 };
    const hydrationCleanup = options.full === true && pullScope.bootstrap && options.pruneExcluded !== false
      ? await evictNonBootstrapLocalRecords()
      : { localRemoved: 0, indexedDbRemoved: 0, preservedPending: 0, entities: [] };
    const confirmedAt = !deferred && newest > String(lastSyncAt)
      ? newest
      : String(lastSyncAt);
    if (!deferred) await store().setMeta(metaKey, confirmedAt || lastServerTime || nowIso());
    await refreshCounts({
      phase: currentStatus.conflictCount ? "conflict" : currentStatus.pendingCount ? "pending" : "synced",
      lastSyncAt: confirmedAt,
      lastError: ""
    });
    if (changed) {
      window.dispatchEvent?.(new CustomEvent("erp:incremental-sync-applied", {
        detail: { changed, entities: [...changedEntities].filter(Boolean), companyId: syncContext.companyId, syncedAt: confirmedAt }
      }));
    }
    return {
      ok: true,
      changed,
      deferred,
      discardedCacheOnlyV2: authorityCleanup.discarded,
      evictedLocalHistoricalRows: hydrationCleanup.localRemoved,
      evictedIndexedDbHistoricalRows: hydrationCleanup.indexedDbRemoved,
      preservedPendingOperations: Number(authorityCleanup.preservedPending || 0)
        + Number(hydrationCleanup.preservedPending || 0),
      fetchedRows,
      entitiesRequested: pullScope.entities.length,
      scope: pullScope.scope,
      lastSyncAt: confirmedAt,
      full: options.full === true
    };
  }

  async function pullIncremental(options = {}) {
    const pullScope = resolvePullScope(options);
    if (pullPromises.has(pullScope.scope)) return pullPromises.get(pullScope.scope);
    const promise = pullIncrementalNow({ ...options, entities: pullScope.bootstrap ? undefined : pullScope.entities }).finally(() => {
      pullPromises.delete(pullScope.scope);
    });
    pullPromises.set(pullScope.scope, promise);
    return promise;
  }

  async function pullBootstrap(options = {}) {
    const result = await pullIncremental({ ...options, entities: undefined });
    BlessERP.syncInstrumentation?.recordPull?.("bootstrap", result || {});
    return result;
  }

  function pullDomain(entities, options = {}) {
    if (!Array.isArray(entities) || !entities.length) {
      return Promise.reject(new Error("pullDomain requiere una lista explicita de entidades."));
    }
    return pullIncremental({ ...options, entities });
  }

  async function resolveConflict(operationId, resolution, mergedPayload = null, options = {}) {
    const operation = await store().getOperation(operationId);
    if (!operation || operation.status !== "conflict") {
      return { ok: false, message: "El conflicto ya no está disponible." };
    }
    const serverRecord = operation.server_record || operation.conflict_details?.server_record;
    if (resolution === "server") {
      if (serverRecord) await applyRemoteRecord(serverRecord, { source: "CONFLICT_SERVER", force: true });
      await store().updateOperation(operationId, {
        status: "synced",
        resolution: options.automatic ? "AUTO_SERVER_RICHER" : "SERVER",
        resolved_at: nowIso(),
        last_error: ""
      });
      await refreshCounts();
      return { ok: true, mode: "SERVER_KEPT" };
    }
    const payload = resolution === "merge"
      ? {
          ...(clone(serverRecord?.payload) || {}),
          ...(clone(operation.payload) || {}),
          ...(clone(mergedPayload) || {})
        }
      : clone(operation.payload);
    await store().updateOperation(operationId, {
      status: "synced",
      resolution: options.automatic ? "AUTO_LOCAL_RICHER" : resolution === "merge" ? "MERGED" : "LOCAL_RETRY",
      resolved_at: nowIso()
    });
    const replacement = makeOperation({
      entity: operation.entity,
      action: serverRecord?.deleted_at ? "INSERT" : "UPDATE",
      recordId: operation.record_id,
      payload,
      baseVersion: Number(serverRecord?.version || operation.result_version || 0),
      baseUpdatedAt: String(serverRecord?.updated_at || "")
    }, context());
    await store().putOperation(replacement);
    await refreshCounts({ phase: "pending" });
    return options.deferProcessing ? { ok: true, mode: "QUEUED", operationId: replacement.operation_id } : processQueue();
  }

  async function retryNow() {
    emitStatus({ phase: "reconnecting", lastError: "" });
    await BlessERP.authAccess?.checkSessionContinuity?.(true);
    await healthCheck({ reconnecting: true });
    if (!currentStatus.serverReachable) {
      await refreshCounts();
      return { ok: false, message: currentStatus.lastError || "Supabase no responde." };
    }
    await BlessERP.realtimeSync?.close?.();
    await pullIncremental();
    const result = await processQueue();
    if (result.ok !== false) await pullIncremental();
    await BlessERP.realtimeSync?.reconnect?.("MANUAL_RETRY");
    return result;
  }

  async function errorDetails() {
    return store().listOperations({
      companyId: context().companyId || undefined,
      statuses: ["error", "conflict"]
    });
  }

  function setRealtimeState(realtimeState, error = "") {
    emitStatus({
      realtimeState,
      phase: ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(realtimeState)
        ? (currentStatus.serverReachable ? "reconnecting" : currentStatus.phase)
        : currentStatus.phase,
      lastError: error || currentStatus.lastError
    });
  }

  async function recover(reason = "NETWORK_CHANGE") {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      emitStatus({
        phase: navigator.onLine === false ? "offline" : "reconnecting",
        serverReachable: false,
        lastError: navigator.onLine === false ? "Sin conexión de red." : ""
      });
      if (navigator.onLine === false) {
        setRealtimeState("CLOSED", "Sin conexión de red.");
        await BlessERP.realtimeSync?.close?.();
        return status();
      }
      if (!enabled()) return status();
      await BlessERP.authAccess?.checkSessionContinuity?.(true);
      const health = await healthCheck({ reconnecting: true });
      if (!health.serverReachable) return health;
      // Supabase se consulta antes de reenviar la cola. Así una pestaña que
      // estuvo suspendida nunca parte de un snapshot local desactualizado.
      await BlessERP.realtimeSync?.close?.();
      await pullIncremental();
      await processQueue();
      await pullIncremental();
      await BlessERP.realtimeSync?.reconnect?.(reason);
      return status();
    })().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  }

  async function start(db = BlessERP.state?.state?.db) {
    if (started) return status();
    started = true;
    await store().open();
    await ensureDeviceId();
    const syncContext = context();
    await initializeQueueMetadata(syncContext);
    await quarantineUnverifiedOperations(syncContext);
    await reconcileLegacyConflicts();
    baseline = registry().snapshot(db || {});
    currentStatus.lastSyncAt = syncContext.companyId
      ? await store().getMeta(`last_sync:${syncContext.projectRef}:${syncContext.companyId}:bootstrap-v1`, "")
      : "";
    await refreshCounts({
      enabled: enabled(),
      phase: enabled() ? "checking" : "local"
    });
    window.addEventListener("offline", () => recover("BROWSER_OFFLINE"));
    window.addEventListener("online", () => recover("BROWSER_ONLINE"));
    window.addEventListener("focus", () => recover("WINDOW_FOCUS"));
    globalThis.navigator?.connection?.addEventListener?.("change", () => recover("NETWORK_INTERFACE_CHANGE"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") recover("TAB_VISIBLE");
    });
    window.addEventListener("pageshow", event => {
      if (event.persisted) recover("PAGE_RESTORED");
    });
    supervisorTimer = window.setInterval(async () => {
      await refreshCounts();
      if (currentStatus.pendingCount || currentStatus.errorCount) {
        await recover("PERIODIC_QUEUE");
      } else if (enabled() && document.visibilityState === "visible") {
        await healthCheck();
      }
    }, QUEUE_INTERVAL_MS);
    if (enabled()) {
      await healthCheck();
      if (currentStatus.serverReachable) {
        const forceFull = db?.meta?.forceFullRemoteSync === true;
        // CONT-D reconcilia completamente solo el bootstrap operativo. Los
        // historicos se leen por RPC/read-model cuando abre su modulo y nunca
        // vuelven a convertirse en autoridad local por iniciar sesion.
        await pullBootstrap({ full: true, pruneExcluded: true });
        if (forceFull && db?.meta) {
          delete db.meta.forceFullRemoteSync;
          db.meta.selectiveBootstrapCompletedAt = lastServerTime || nowIso();
          captureSuppressed += 1;
          try {
            BlessERP.storage?.save?.(db);
            baseline = registry().snapshot(db);
          } finally {
            captureSuppressed -= 1;
          }
        }
        await processQueue();
        await pullBootstrap();
      }
    }
    return status();
  }

  BlessERP.offlineSync = {
    applyRemoteRecord,
    confirmRecord,
    hasSuspendedCapture() {
      return suspendedCaptureRecords.size > 0;
    },
    holdRecord,
    isRecordCaptureSuspended,
    resumeRecordCapture,
    suspendRecordCapture,
    captureRecord,
    captureChanges,
    errorDetails,
    flushDeferredRemoteRecords,
    healthCheck,
    processQueue,
    pullBootstrap,
    pullDomain,
    pullIncremental,
    recover,
    recordSystemConflict,
    resolveConflict,
    retryNow,
    setRealtimeState,
    start,
    status,
    auditLogs() {
      return syncAuditLogs.map(entry => ({ ...entry }));
    },
    trace: syncLog,
    buildFieldChanges: fieldChanges,
    buildOperationFieldChanges: operationFieldChanges,
    createOperationId: uuid,
    isDerivedOnlyOperation,
    replayGate,
    quarantineOperation,
    quarantineUnverifiedOperations,
    queuePolicy: Object.freeze({
      queueSchemaVersion: QUEUE_SCHEMA_VERSION,
      operationSchemaVersion: OPERATION_SCHEMA_VERSION,
      maxReplayAgeMs: MAX_REPLAY_AGE_MS,
      quarantineReasons: QUARANTINE_REASONS
    }),
    async getDeviceId() {
      await ensureDeviceId();
      return deviceId;
    },
    withCaptureSuppressed(callback) {
      captureSuppressed += 1;
      try {
        return callback();
      } finally {
        captureSuppressed -= 1;
      }
    }
  };
})();
