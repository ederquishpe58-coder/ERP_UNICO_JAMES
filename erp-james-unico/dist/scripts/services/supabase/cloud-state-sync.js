(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const SYNC_META_PREFIX = "jaeder-cloud-sync-v3";
  const REQUEST_TIMEOUT_MS = 15000;
  let revision = 0;
  let activeCompanyUuid = "";
  let activeCompanyKey = "";
  let loadedMetaCompanyKey = "";
  let saveTimer = null;
  let hydrating = false;
  let saving = false;
  let pending = false;
  let conflict = false;
  let attempts = 0;
  let changeVersion = 0;
  let lastError = "";
  let lastSuccessAt = "";
  let lastAttemptAt = "";
  let lastRemoteCheckAt = "";
  let serverReachable = false;
  let realtimeState = "CLOSED";
  let lastRealtimeError = "";
  let supervisorStarted = false;
  let recoveryPromise = null;

  function enabled() {
    return Boolean(
      BlessERP.isCoreSupabaseEnabled?.()
      && BlessERP.authAccess?.activeAccess?.()
      && BlessERP.getSupabaseClient?.()
    );
  }

  function incrementalPrimary() {
    return Boolean(BlessERP.getEnvConfig?.().incrementalSyncEnabled && BlessERP.offlineSync);
  }

  function isOnline() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function waitForIdle(timeout = 800) {
    if (typeof window.requestIdleCallback === "function") {
      return new Promise(resolve => window.requestIdleCallback(resolve, { timeout }));
    }
    return new Promise(resolve => window.setTimeout(resolve, 0));
  }

  function requestSignal() {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    if (typeof AbortController === "undefined") return null;
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return controller.signal;
  }

  function abortable(request) {
    const signal = requestSignal();
    return signal && typeof request?.abortSignal === "function"
      ? request.abortSignal(signal)
      : request;
  }

  function emit(name, detail) {
    if (typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function projectRef() {
    try {
      return new URL(BlessERP.getEnvConfig?.().supabaseUrl || "").hostname.split(".")[0] || "unknown";
    } catch {
      return "unknown";
    }
  }

  function metaKey() {
    return `${SYNC_META_PREFIX}:${projectRef()}:${activeCompanyKey || "unknown"}`;
  }

  function loadMeta() {
    if (!activeCompanyKey || loadedMetaCompanyKey === activeCompanyKey) return;
    loadedMetaCompanyKey = activeCompanyKey;
    try {
      const stored = JSON.parse(localStorage.getItem(metaKey()) || "null") || {};
      revision = Number(stored.revision || 0);
      pending = stored.pending === true;
      conflict = stored.conflict === true;
      attempts = Number(stored.attempts || 0);
      changeVersion = Number(stored.changeVersion || 0);
      lastError = String(stored.lastError || "");
      lastSuccessAt = String(stored.lastSuccessAt || "");
      lastAttemptAt = String(stored.lastAttemptAt || "");
    } catch {
      revision = 0;
      pending = false;
      conflict = false;
      attempts = 0;
      changeVersion = 0;
    }
  }

  function persistMeta() {
    if (!activeCompanyKey) return;
    try {
      localStorage.setItem(metaKey(), JSON.stringify({
        companyId: activeCompanyUuid,
        companyKey: activeCompanyKey,
        revision,
        pending,
        conflict,
        attempts,
        changeVersion,
        lastError,
        lastSuccessAt,
        lastAttemptAt,
        updatedAt: new Date().toISOString()
      }));
    } catch {
      // El estado principal continúa en localStorage aunque no quepa esta marca auxiliar.
    }
  }

  function clearLegacyCoordinationFlags() {
    pending = false;
    conflict = false;
    attempts = 0;
    lastError = "";
    lastAttemptAt = "";
    persistMeta();
  }

  function resolveContext() {
    const access = BlessERP.authAccess?.activeAccess?.();
    const company = access?.activeCompany;
    const nextCompanyUuid = company?.id || "";
    const nextCompanyKey = company?.company_key || "";
    if (nextCompanyKey && nextCompanyKey !== activeCompanyKey) {
      activeCompanyUuid = nextCompanyUuid;
      activeCompanyKey = nextCompanyKey;
      loadedMetaCompanyKey = "";
      loadMeta();
    } else {
      activeCompanyUuid = nextCompanyUuid;
      activeCompanyKey = nextCompanyKey;
      loadMeta();
    }
    return Boolean(activeCompanyUuid && activeCompanyKey);
  }

  function snapshot(db) {
    BlessERP.companyCapabilities?.captureActiveStore?.(db);
    const store = db?.companyStores?.[activeCompanyKey]
      || BlessERP.companyCapabilities?.snapshotActiveStore?.(db, activeCompanyKey)
      || {};
    return clone(store);
  }

  function status() {
    return {
      enabled: enabled(),
      backupOnly: incrementalPrimary(),
      activeCompanyUuid,
      activeCompanyKey,
      revision,
      hydrating,
      saving,
      pending,
      conflict,
      attempts,
      online: isOnline(),
      serverReachable,
      realtimeState,
      lastRealtimeError,
      pendingCount: pending ? 1 : 0,
      lastError,
      lastSuccessAt,
      lastAttemptAt,
      lastRemoteCheckAt
    };
  }

  function emitStatus() {
    emit("erp:cloud-sync-status", status());
  }

  async function hydrate(db) {
    if (!enabled() || !resolveContext()) return { ok: true, mode: "LOCAL" };
    // erp_company_state queda únicamente como respaldo. Nunca se restaura sobre
    // el estado activo: la autoridad compartida es erp_entity_records, registro
    // por registro y con versión de servidor.
    clearLegacyCoordinationFlags();
    emitStatus();
    return {
      ok: true,
      mode: incrementalPrimary() ? "SNAPSHOT_BACKUP_ONLY" : "SNAPSHOT_RESTORE_DISABLED"
    };
  }

  async function saveNow(db = BlessERP.state?.state?.db, options = {}) {
    if (options.backup !== true) {
      return {
        ok: true,
        mode: incrementalPrimary() ? "INCREMENTAL_PRIMARY" : "SNAPSHOT_WRITE_DISABLED",
        pending: false
      };
    }
    if (!enabled() || hydrating || !db || !resolveContext()) {
      return { ok: true, mode: "LOCAL_OR_BUSY", pending };
    }
    if (saving) return { ok: true, mode: "SAVE_IN_PROGRESS", pending: true };
    if (!pending && options.force !== true) return { ok: true, mode: "NO_CHANGES", pending: false };
    if (conflict) {
      return { ok: false, mode: "CONFLICT", message: lastError, pending: true };
    }
    if (!isOnline()) {
      pending = false;
      lastError = "Sin conexión. Se omitió el snapshot opcional; la cola incremental conserva los cambios.";
      persistMeta();
      emitStatus();
      return { ok: false, mode: "BACKUP_SKIPPED_OFFLINE", message: lastError, pending: false };
    }

    const client = BlessERP.getSupabaseClient();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = null;
    saving = true;
    attempts += 1;
    lastAttemptAt = new Date().toISOString();
    persistMeta();
    emitStatus();
    try {
      await waitForIdle();
      const payload = BlessERP.performance?.measureSync?.("sync:snapshot-empresa", () => snapshot(db), {
        companyKey: activeCompanyKey
      }) || snapshot(db);
      const { data, error } = await abortable(client.rpc("erp_save_company_state", {
        p_company_id: activeCompanyUuid,
        p_state_json: payload,
        p_expected_revision: revision,
        p_schema_version: 1
      }));
      if (error) throw error;
      serverReachable = true;
      const saved = Array.isArray(data) ? data[0] : data;
      revision = Number(saved?.revision || revision + 1);
      attempts = 0;
      conflict = false;
      lastError = "";
      lastSuccessAt = saved?.updated_at || new Date().toISOString();
      pending = false;
      persistMeta();
      emit("erp:cloud-sync-success", {
        companyId: activeCompanyUuid,
        revision,
        updatedAt: lastSuccessAt,
        pending
      });
      emitStatus();
      return { ok: true, mode: "REMOTE_SAVED", revision, pending };
    } catch (error) {
      lastError = error.message || "No se pudo guardar el estado en Supabase.";
      const backupFailure = options.backup === true;
      pending = backupFailure ? false : true;
      conflict = backupFailure ? false : (error?.code === "40001" || /conflicto|revision|40001/i.test(lastError));
      serverReachable = backupFailure ? serverReachable : conflict;
      persistMeta();
      emit("erp:cloud-sync-error", {
        message: conflict
          ? "Otra computadora guardó cambios antes. Sus datos locales se conservaron y no fueron sobrescritos."
          : lastError,
        phase: "save",
        conflict
      });
      emitStatus();
      return { ok: false, mode: backupFailure ? "BACKUP_FAILED" : conflict ? "SAVE_CONFLICT" : "SAVE_ERROR", message: lastError, pending };
    } finally {
      saving = false;
      emitStatus();
    }
  }

  function scheduleSave(db = BlessERP.state?.state?.db) {
    // El snapshot no participa en el guardado normal; solo backupNow puede
    // generarlo después de confirmar la cola incremental.
    return;
  }

  async function checkRemote(db = BlessERP.state?.state?.db) {
    if (incrementalPrimary()) {
      return BlessERP.offlineSync?.pullBootstrap?.() || { ok: true, mode: "INCREMENTAL_PRIMARY" };
    }
    return { ok: false, mode: "INCREMENTAL_SYNC_REQUIRED", message: "La restauración de snapshots está deshabilitada." };
  }

  function setRealtimeState(nextState, error = "") {
    realtimeState = String(nextState || "CLOSED").toUpperCase();
    lastRealtimeError = String(error || "");
    if (realtimeState === "SUBSCRIBED") {
      lastRealtimeError = "";
    }
    emitStatus();
  }

  async function handleRealtimeChange(payload = {}) {
    return { ok: true, mode: enabled() ? "SNAPSHOT_BACKUP_IGNORED" : "DISABLED" };
  }

  async function recover(reason = "RECOVER", db = BlessERP.state?.state?.db) {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      if (!enabled() || !resolveContext()) return { ok: true, mode: "DISABLED" };
      if (incrementalPrimary()) {
        return BlessERP.offlineSync?.recover?.(reason) || { ok: true, mode: "INCREMENTAL_PRIMARY" };
      }
      return { ok: false, mode: "INCREMENTAL_SYNC_REQUIRED", message: "La sincronización incremental no está activa." };
    })().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  }

  function startSupervisor(db = BlessERP.state?.state?.db) {
    if (supervisorStarted) return;
    supervisorStarted = true;
    resolveContext();
    clearLegacyCoordinationFlags();
    emitStatus();
  }

  function retryNow(db = BlessERP.state?.state?.db) {
    if (incrementalPrimary()) return BlessERP.offlineSync?.retryNow?.();
    return Promise.resolve({
      ok: false,
      mode: "INCREMENTAL_SYNC_REQUIRED",
      message: "La sincronización incremental no está activa. No se restauró ningún snapshot."
    });
  }

  async function resolveConflict(strategy = "server", db = BlessERP.state?.state?.db) {
    if (incrementalPrimary()) {
      return { ok: true, mode: "INCREMENTAL_AUTOMATIC_MERGE" };
    }
    return { ok: false, mode: "SNAPSHOT_RESOLUTION_DISABLED", message: "Los snapshots no pueden reemplazar datos por registro." };
  }

  BlessERP.cloudStateSync = {
    backupNow(db = BlessERP.state?.state?.db) {
      return incrementalPrimary()
        ? saveNow(db, { force: true, backup: true })
        : Promise.resolve({ ok: false, mode: "INCREMENTAL_SYNC_REQUIRED" });
    },
    checkRemote,
    handleRealtimeChange,
    hydrate,
    recover,
    resolveConflict,
    retryNow,
    saveNow,
    scheduleSave,
    setRealtimeState,
    startSupervisor,
    status
  };
})();
