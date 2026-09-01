(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const states = new Map();
  const refreshTimers = new Map();
  let activeRouteId = "";
  let activeDomains = new Set();
  let companyKey = "";

  const ROUTE_DOMAINS = Object.freeze({
    "commercial-panel": ["commercial-catalog", "commercial-workspace"],
    "commercial-orders-day": ["commercial-catalog", "commercial-workspace", "operations-catalog", "operations-workspace"],
    "commercial-preorders": ["commercial-catalog", "commercial-workspace"],
    "commercial-order-master": ["commercial-catalog", "commercial-workspace", "operations-catalog", "operations-workspace"],
    "commercial-order-detail": ["commercial-catalog", "commercial-workspace", "operations-catalog", "operations-workspace"],
    "commercial-order-coordination": ["commercial-catalog", "commercial-workspace"],
    "commercial-order-history": ["commercial-catalog"],
    "commercial-availability-reservations": ["commercial-catalog", "commercial-workspace", "operations-catalog", "operations-workspace"],
    "commercial-customers-brands": ["commercial-catalog"],
    "commercial-brands": ["commercial-catalog"],
    "commercial-cargo-agencies": ["commercial-catalog"],
    "commercial-countries": ["commercial-catalog"],
    "commercial-daes": ["commercial-catalog"],
    "commercial-airlines": ["commercial-catalog"],
    "commercial-export-products": ["commercial-catalog"],
    "commercial-box-types": ["commercial-catalog"],
    "commercial-senae-liquidation": [],
    "commercial-credit-notes": ["commercial-catalog", "commercial-workspace", "finance-workspace"],
    "commercial-sri-authorization": ["commercial-catalog", "commercial-workspace"],

    "accounting-chart": [],
    "accounting-journal": [],
    "accounting-ledger": [],
    "accounting-financials": [],
    "accounting-sales": ["commercial-catalog", "commercial-workspace", "finance-workspace"],

    "purchases-providers": ["purchases-catalog"],
    "purchases-tax-supports": [],
    "purchases-invoices": ["purchases-catalog"],
    "purchases-supplier-settlements": ["purchases-catalog"],
    "purchases-withholdings-issued": ["purchases-catalog"],
    "purchases-retention-report": ["purchases-catalog"],
    "purchases-upload-xml": ["purchases-catalog", "purchases-workspace"],
    "purchases-manual": ["purchases-catalog", "purchases-workspace"],

    "portfolios-suppliers": ["purchases-catalog"],
    "portfolios-customers": ["commercial-catalog"],
    "portfolios-ap": ["purchases-catalog"],
    "portfolios-ar": [],
    "portfolios-payments-single": ["purchases-catalog", "treasury-catalog"],
    "portfolios-collections-single": ["treasury-catalog"],
    "portfolios-payments-bulk": ["purchases-catalog", "portfolio-workspace", "treasury-catalog"],
    "portfolios-collections-bulk": ["commercial-catalog", "portfolio-workspace", "treasury-catalog"],

    "banks-accounts": ["treasury-catalog"],
    "banks-movements": ["treasury-catalog"],
    "banks-reconciliation": ["treasury-catalog"],
    "banks-transfers": ["treasury-catalog"],
    "banks-cash": ["treasury-catalog", "treasury-workspace"],
    "banks-cash-flow": ["treasury-catalog", "treasury-workspace", "finance-workspace"],

    "tax-parameters": [],
    "tax-retention-parameters": [],
    "tax-withholdings-received": ["commercial-catalog"],
    "tax-ats": ["tax", "commercial-catalog", "commercial-workspace", "purchases-catalog", "purchases-workspace", "portfolio-workspace"],

    "reports-dashboard": [],
    "reports-accounting": [],
    "reports-portfolio": [],
    "reports-banks": [],
    "reports-tax": ["purchases-catalog", "purchases-workspace", "portfolio-workspace"],
    "reports-inventory": ["inventory-catalog", "inventory-workspace"],
    "reports-commercial": ["commercial-catalog", "operations-workspace"],

    "settings-company": [],
    "settings-users": [],
    "settings-audit": ["audit"],
    "settings-sequences": [],
    "settings-cost-centers": [],
    "settings-synchronization": []
  });

  function currentCompanyKey() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.activeCompanyId || "local");
  }

  function resetForCompany() {
    const next = currentCompanyKey();
    if (next === companyKey) return;
    companyKey = next;
    states.clear();
    refreshTimers.forEach(timer => window.clearTimeout(timer));
    refreshTimers.clear();
    activeDomains = new Set();
    activeRouteId = "";
  }

  function routeDomains(routeId) {
    const id = String(routeId || "");
    if (Object.prototype.hasOwnProperty.call(ROUTE_DOMAINS, id)) return [...ROUTE_DOMAINS[id]];
    if (id.startsWith("operations-")) return ["operations-catalog", "operations-workspace"];
    if (id.startsWith("commercial-")) return ["commercial-catalog", "commercial-workspace"];
    if (id.startsWith("payroll-")) return ["payroll", "treasury-catalog"];
    if (id.startsWith("inventory-")) return ["inventory-catalog", "inventory-workspace"];
    return [];
  }

  function stateFor(domain) {
    if (!states.has(domain)) states.set(domain, {
      domain, loaded: false, loading: false, stale: false, cursor: "",
      lastSync: "", lastMode: "", rowsReceived: 0, loads: 0, duplicateLoads: 0, error: "", promise: null
    });
    return states.get(domain);
  }

  async function ensureDomain(domain, options = {}) {
    resetForCompany();
    const capabilityDecision = BlessERP.capabilityRuntime?.evaluateDomain?.(domain, {
      routeId: options.routeId || activeRouteId,
      authorizationContext: options.authorizationContext || "",
      source: options.source || "ENSURE_DOMAIN"
    });
    if (capabilityDecision?.enforced === true && capabilityDecision.allowed !== true) {
      const error = new Error(`CAPABILITY_DOMAIN_REQUIRED:${domain}`);
      error.code = "CAPABILITY_DOMAIN_REQUIRED";
      error.domain = domain;
      error.routeId = capabilityDecision.routeId || options.routeId || activeRouteId;
      throw error;
    }
    const entities = BlessERP.syncEntityRegistry?.entitiesForDomain?.(domain) || [];
    if (!entities.length) throw new Error(`Dominio de datos desconocido: ${domain}`);
    const state = stateFor(domain);
    if (state.loading && state.promise) {
      state.duplicateLoads += 1;
      BlessERP.syncInstrumentation?.recordDuplicateDomainLoad?.();
      return state.promise;
    }
    if (state.loaded && !state.stale && options.force !== true) return { ok: true, mode: "DOMAIN_CACHE", domain, fetchedRows: 0 };

    state.loading = true;
    state.error = "";
    state.promise = (async () => {
      const full = options.full === true || !state.loaded;
      const result = BlessERP.offlineSync?.pullDomain
        ? await BlessERP.offlineSync.pullDomain(entities, { full })
        : { ok: true, mode: "LOCAL_CACHE", fetchedRows: 0, entitiesRequested: entities.length };
      const hydrate = BlessERP.domainDataHydrators?.[domain];
      const canonical = typeof hydrate === "function"
        ? await hydrate({ force: options.force === true, full, domain, entities: [...entities], genericResult: result })
        : { ok: true, mode: "NO_CANONICAL_HYDRATOR", fetchedRows: 0 };
      if (canonical?.ok === false) throw new Error(canonical.message || canonical.errors?.[0] || `No se pudo hidratar ${domain}.`);
      const entityRecordRows = Number(result?.fetchedRows || 0);
      const canonicalRows = Number(canonical?.fetchedRows || 0);
      const canonicalRecoveredUnavailable = result?.ok === false && typeof hydrate === "function";
      const effectiveMode = canonicalRecoveredUnavailable
        ? String(canonical?.mode || "CANONICAL_DOMAIN_HYDRATION")
        : String(result?.mode || result?.scope || canonical?.mode || "DOMAIN_LOAD");
      const combinedResult = {
        ...result,
        ok: canonicalRecoveredUnavailable ? true : result?.ok !== false,
        mode: effectiveMode,
        fetchedRows: entityRecordRows + canonicalRows,
        entityRecordRows,
        canonicalRows,
        canonical
      };
      state.loaded = true;
      state.stale = false;
      state.cursor = String(result?.lastSyncAt || state.cursor || "");
      state.lastSync = new Date().toISOString();
      state.lastMode = effectiveMode;
      state.rowsReceived += entityRecordRows + canonicalRows;
      state.loads += 1;
      BlessERP.syncInstrumentation?.recordPull?.("domain", { ...combinedResult, domain, mode: effectiveMode });
      window.dispatchEvent?.(new CustomEvent("erp:domain-loaded", {
        detail: { domain, entities: [...entities], result: combinedResult }
      }));
      return { ...combinedResult, domain, entities };
    })().catch(error => {
      state.error = String(error?.message || error || "No se pudo cargar el dominio.");
      throw error;
    }).finally(() => {
      state.loading = false;
      state.promise = null;
    });
    return state.promise;
  }

  function activateRoute(routeId) {
    resetForCompany();
    activeRouteId = String(routeId || "");
    activeDomains = new Set(routeDomains(activeRouteId));
  }

  async function ensureRoute(routeId) {
    activateRoute(routeId);
    const loaded = [];
    for (const domain of activeDomains) {
      loaded.push(await ensureDomain(domain, { routeId, source: "ENSURE_ROUTE" }));
    }
    return { routeId, domains: [...activeDomains], loaded };
  }

  function isRouteReady(routeId) {
    resetForCompany();
    return routeDomains(routeId).every(domain => {
      const state = stateFor(domain);
      return state.loaded && !state.stale && !state.loading;
    });
  }

  function leaveRoute(routeId) {
    if (String(routeId || "") !== activeRouteId) return;
    refreshTimers.forEach(timer => window.clearTimeout(timer));
    refreshTimers.clear();
    activeRouteId = "";
    activeDomains = new Set();
  }

  function scheduleActiveRefresh(domain) {
    if (!activeDomains.has(domain) || refreshTimers.has(domain)) return;
    refreshTimers.set(domain, window.setTimeout(() => {
      refreshTimers.delete(domain);
      if (!activeDomains.has(domain)) return;
      ensureDomain(domain, { force: true, full: false }).catch(error => {
        console.warn(`[JAEDER CONT-D] No se pudo refrescar ${domain}.`, error);
      });
    }, 250));
  }

  function invalidateEntity(entity) {
    const domain = BlessERP.syncEntityRegistry?.domainForEntity?.(entity) || "";
    if (!domain) return false;
    const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRealtimeEntity?.(entity, { source: "DOMAIN_INVALIDATION" });
    if (capabilityDecision?.enforced === true && capabilityDecision.allowed !== true) return false;
    const state = stateFor(domain);
    state.stale = true;
    scheduleActiveRefresh(domain);
    return true;
  }

  window.addEventListener?.("erp:lazy-entity-invalidated", event => {
    invalidateEntity(event?.detail?.entity);
  });

  BlessERP.domainDataLoader = {
    ensureDomain,
    ensureRoute,
    isEntityActive(entity) {
      const domain = BlessERP.syncEntityRegistry?.domainForEntity?.(entity) || "";
      return Boolean(domain && activeDomains.has(domain));
    },
    isRouteReady,
    leaveRoute,
    routeDomains,
    status() {
      return {
        companyKey,
        activeRouteId,
        activeDomains: [...activeDomains],
        domains: Object.fromEntries([...states].map(([key, value]) => [key, {
          loaded: value.loaded, loading: value.loading, stale: value.stale,
          cursor: value.cursor, lastSync: value.lastSync, lastMode: value.lastMode, rowsReceived: value.rowsReceived,
          loads: value.loads, duplicateLoads: value.duplicateLoads, error: value.error
        }]))
      };
    }
  };
})();
