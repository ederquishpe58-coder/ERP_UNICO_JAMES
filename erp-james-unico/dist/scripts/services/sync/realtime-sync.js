(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const BASE_RETRY_MS = 2000;
  const MAX_RETRY_MS = 60000;
  const DIRECT_REALTIME_TABLES = [
    "electronic_documents",
    "electronic_document_files",
    "electronic_document_sequences",
    "emission_points",
    "sri_settings",
    "sri_transmissions",
    "accounting_generation_rules",
    "companies",
    "user_profiles",
    "user_company_memberships",
    "user_route_permissions",
    "erp_security_engine_state",
    "erp_security_permission_versions"
  ];

  let channel = null;
  let channelKey = "";
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let generation = 0;
  let started = false;
  let reconnectPromise = null;

  function context() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return {
      companyId: access?.activeCompany?.id || "",
      userId: access?.session?.user?.id || ""
    };
  }

  function enabled() {
    const cloud = BlessERP.cloudStateSync?.status?.() || {};
    return Boolean(cloud.enabled && BlessERP.getSupabaseClient?.());
  }

  function incrementalPrimary() {
    return Boolean(BlessERP.getEnvConfig?.().incrementalSyncEnabled && BlessERP.offlineSync);
  }

  function setRealtimeState(state, error = "") {
    BlessERP.cloudStateSync?.setRealtimeState?.(state, error);
    BlessERP.offlineSync?.setRealtimeState?.(state, error);
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  async function closeChannel({ preserveTimer = false } = {}) {
    if (!preserveTimer) clearReconnectTimer();
    generation += 1;
    const previous = channel;
    channel = null;
    channelKey = "";
    if (!previous) return;
    const supabase = BlessERP.getSupabaseClient?.();
    try {
      await supabase?.removeChannel?.(previous);
    } catch {
      try {
        await previous.unsubscribe?.();
      } catch {
        // El canal ya estaba cerrado.
      }
    }
  }

  function scheduleReconnect(reason) {
    if (!enabled() || navigator.onLine === false || reconnectTimer) return;
    reconnectAttempts += 1;
    const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(reconnectAttempts - 1, 5)));
    setRealtimeState("RECONNECTING", reason);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      reconnect(reason).catch(error => {
        console.error("[jaeder-realtime] No se pudo reconectar", error);
      });
    }, delay);
  }

  function applyDirectPayload(table, payload) {
    const activeCompanyId = context().companyId;
    const rowCompanyId = String(payload?.new?.company_id || payload?.old?.company_id || "");
    if (rowCompanyId && activeCompanyId && rowCompanyId !== activeCompanyId) return;
    if (table.startsWith("erp_security_")) {
      BlessERP.capabilityRuntime?.handleSecurityRealtime?.(table, payload);
      return;
    }
    if (["companies", "user_profiles", "user_company_memberships", "user_route_permissions"].includes(table)) {
      BlessERP.authAccess?.validateActiveAccess?.(null, true).catch(error => {
        console.warn("[jaeder-realtime] No se pudo refrescar el acceso", error);
      });
    }
    window.dispatchEvent(new CustomEvent("erp:direct-realtime-change", {
      detail: { table, eventType: payload.eventType, payload }
    }));
  }

  async function subscribe(reason = "START") {
    if (!enabled()) return { ok: true, mode: "DISABLED" };
    const { companyId, userId } = context();
    if (!companyId || !userId) return { ok: false, mode: "NO_CONTEXT" };
    const desiredKey = `${companyId}:${userId}`;
    if (channel && channelKey === desiredKey) return { ok: true, mode: "EXISTING" };
    await closeChannel();
    const ownGeneration = ++generation;
    const supabase = BlessERP.getSupabaseClient();
    channelKey = desiredKey;
    let channelBuilder = supabase.channel(`erp-company-records:${desiredKey}`);
    if (incrementalPrimary()) {
      channelBuilder = channelBuilder.on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "erp_entity_records",
        filter: `company_id=eq.${companyId}`
      }, payload => {
        const record = payload.new || payload.old;
        const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRealtimeEntity?.(record?.entity, { source: "COMPANY_CHANNEL" });
        if (capabilityDecision?.enforced === true && capabilityDecision.allowed !== true) return;
        const derivedOnly = BlessERP.syncEntityRegistry?.isDerivedOnlyPayloadChange?.(
          record?.entity,
          payload.old?.payload,
          payload.new?.payload
        ) === true;
        if (derivedOnly && !payload.new?.deleted_at) {
          // Conserva la version remota en la cache tecnica, pero una variacion
          // puramente visual no invalida dominios ni dispara nuevos renders.
          const cacheWrite = BlessERP.syncIndexedDb?.putEntity?.(record);
          if (cacheWrite?.catch) cacheWrite.catch(() => {});
          return;
        }
        const hydrateNow = BlessERP.syncEntityRegistry?.isBootstrapEntity?.(record?.entity)
          || BlessERP.domainDataLoader?.isEntityActive?.(record?.entity);
        if (!hydrateNow) {
          // Las entidades lazy/historicas ya no se hidratan globalmente. Sus
          // repositorios de lectura mantienen suscripciones acotadas cuando la
          // pantalla esta abierta y consultada.
          window.dispatchEvent(new CustomEvent("erp:lazy-entity-invalidated", {
            detail: {
              companyId,
              entity: record?.entity || "",
              recordId: record?.record_id || "",
              source: "REALTIME_INVALIDATION_ONLY"
            }
          }));
          return;
        }
        BlessERP.offlineSync?.applyRemoteRecord?.(record, { source: "REALTIME" })
          .then(result => {
            if (result?.changed) {
              const granularEvent = new CustomEvent("erp:canonical-record-updated", {
                cancelable: true,
                detail: {
                  companyId,
                  entity: record?.entity || "",
                  recordId: record?.record_id || "",
                  serverRecord: record,
                  source: "REALTIME"
                }
              });
              const granularHandled = window.dispatchEvent(granularEvent) === false;
              window.dispatchEvent(new CustomEvent("erp:incremental-sync-applied", {
                  detail: {
                    changed: 1,
                    companyId,
                    entity: record?.entity || "",
                    recordId: record?.record_id || "",
                    granularHandled,
                    syncedAt: record?.updated_at || new Date().toISOString()
                  }
              }));
            }
          })
          .catch(error => console.error("[jaeder-realtime] No se pudo aplicar el registro remoto", error));
      });
    } else {
      channelBuilder = channelBuilder.on("postgres_changes", {
        event: "*", schema: "public", table: "erp_company_state", filter: `company_id=eq.${companyId}`
      }, payload => BlessERP.cloudStateSync?.handleRealtimeChange?.(payload).catch(error => {
        console.error("[jaeder-realtime] No se pudo aplicar el cambio remoto", error);
      }));
    }
    DIRECT_REALTIME_TABLES.forEach(table => {
      const directFilter = table === "erp_security_permission_versions"
        ? { filter: `company_id=eq.${companyId}` }
        : {};
      channelBuilder = channelBuilder.on("postgres_changes", {
        event: "*", schema: "public", table, ...directFilter
      }, payload => applyDirectPayload(table, payload));
    });
    channel = channelBuilder.subscribe(async (state, error) => {
        if (ownGeneration !== generation) return;
        setRealtimeState(state, error?.message || "");
        console.info("[jaeder-realtime]", { state, reason, companyId });
        if (state === "SUBSCRIBED") {
          reconnectAttempts = 0;
          clearReconnectTimer();
          // Realtime avisa; esta consulta recupera cualquier evento perdido.
          if (incrementalPrimary()) await BlessERP.offlineSync?.pullBootstrap?.().catch(() => {});
          else await BlessERP.cloudStateSync?.checkRemote?.(BlessERP.state?.state?.db).catch(() => {});
          return;
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) {
          await closeChannel({ preserveTimer: true });
          scheduleReconnect(`${reason}:${state}`);
        }
      });
    return { ok: true, mode: "SUBSCRIBING", reason };
  }

  async function reconnect(reason = "RECONNECT") {
    if (reconnectPromise) return reconnectPromise;
    reconnectPromise = (async () => {
      setRealtimeState("RECONNECTING", reason);
      await closeChannel();
      if (!enabled() || navigator.onLine === false) return { ok: false, mode: "OFFLINE" };
      if (!incrementalPrimary()) {
        await BlessERP.cloudStateSync?.recover?.(reason, BlessERP.state?.state?.db);
      }
      return subscribe(reason);
    })().finally(() => {
      reconnectPromise = null;
    });
    return reconnectPromise;
  }

  async function start() {
    if (started) return { ok: true, mode: "STARTED" };
    started = true;
    // Cuando incremental-sync está activo, ese supervisor es el único dueño de
    // los eventos de red/foco y también reconstruye Realtime. Así evitamos dos
    // recuperaciones simultáneas para el mismo cambio de conectividad.
    if (!incrementalPrimary()) {
      window.addEventListener("offline", () => {
        setRealtimeState("CLOSED", "Sin conexión de red.");
        closeChannel();
      });
      window.addEventListener("online", () => reconnect("BROWSER_ONLINE"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reconnect("TAB_VISIBLE");
      });
      window.addEventListener("focus", () => reconnect("WINDOW_FOCUS"));
      window.addEventListener("pageshow", event => reconnect(event.persisted ? "PAGE_RESTORED" : "PAGE_SHOW"));
    }
    return subscribe("START");
  }

  BlessERP.realtimeSync = {
    close: closeChannel,
    reconnect,
    start,
    status() {
      return {
        started,
        channelKey,
        activeSubscriptions: channel ? 1 : 0,
        connected: BlessERP.cloudStateSync?.status?.().realtimeState === "SUBSCRIBED",
        reconnectAttempts
      };
    }
  };
})();
