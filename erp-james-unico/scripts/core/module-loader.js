(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const groupPromises = new Map();
  const loadedGroups = new Set();
  const nodePromises = new WeakMap();
  const EXTERNAL_TIMEOUT_MS = 12000;
  const EXTERNAL_RETRIES = 1;

  const ROUTE_GROUPS = Object.freeze({
    "commercial-panel": ["commercial-dashboard"],
    "commercial-orders-day": ["commercial-day-orders"],
    "commercial-preorders": ["commercial-po"],
    "commercial-order-master": ["commercial-order"],
    "commercial-order-detail": ["commercial-order-tracking"],
    "commercial-order-coordination": ["commercial-order-tracking"],
    "commercial-order-history": ["commercial-history"],
    "commercial-availability-reservations": ["commercial-availability"],
    "commercial-sri-authorization": ["commercial-sri"],
    "commercial-credit-notes": ["commercial-sri"],
    "commercial-senae-liquidation": ["commercial-senae"],
    "commercial-customers-brands": ["commercial-catalogs"],
    "commercial-brands": ["commercial-catalogs"],
    "commercial-cargo-agencies": ["commercial-catalogs"],
    "commercial-countries": ["commercial-catalogs"],
    "commercial-daes": ["commercial-catalogs"],
    "commercial-airlines": ["commercial-catalogs"],
    "commercial-export-products": ["commercial-catalogs"],
    "commercial-box-types": ["commercial-catalogs"],
    "operations-parameters": ["operations", "payroll"],
    "operations-dispatch": ["operations-dispatch"],
    "reports-commercial": ["reports-commercial"],
    "settings-company": ["foundation"],
    "accounting-chart": ["foundation"],
    "accounting-journal": ["accounting"],
    "accounting-ledger": ["accounting"],
    "accounting-sales": ["accounting"],
    "accounting-financials": ["reports"],
    "tax-ats": ["tax"]
  });

  function groupsForRoute(routeId) {
    const id = String(routeId || "");
    if (ROUTE_GROUPS[id]) return ROUTE_GROUPS[id];
    if (id.startsWith("operations-")) return ["operations"];
    if (id.startsWith("commercial-")) return ["commercial"];
    if (id.startsWith("payroll-")) return ["payroll"];
    if (id.startsWith("settings-")) return ["settings"];
    if (id.startsWith("purchases-")) return ["purchases"];
    if (id.startsWith("portfolios-")) return ["portfolios"];
    if (id.startsWith("banks-")) return ["banks"];
    if (id.startsWith("inventory-")) return ["inventory"];
    if (id.startsWith("reports-")) return ["reports"];
    if (id.startsWith("tax-")) return ["tax"];
    return [];
  }

  function descriptors(group) {
    return [...document.querySelectorAll(`script[data-jaeder-lazy-group~="${CSS.escape(group)}"]`)];
  }

  function executeEmbedded(node) {
    const source = String(node.textContent || "");
    if (!source.trim()) return Promise.reject(new Error(`El modulo ${node.dataset.source || "diferido"} no contiene codigo embebido.`));
    return Promise.resolve().then(() => {
      (0, eval)(`${source}\n//# sourceURL=${node.dataset.source || "jaeder-lazy-module.js"}`);
      node.dataset.jaederLoaded = "true";
    });
  }

  function sourceWithRetry(source, attempt) {
    if (!attempt) return source;
    try {
      const url = new URL(source, document.baseURI);
      url.searchParams.set("jaeder_retry", String(Date.now()));
      return url.href;
    } catch (_error) {
      const separator = source.includes("?") ? "&" : "?";
      return `${source}${separator}jaeder_retry=${Date.now()}`;
    }
  }

  function loadExternalAttempt(node, source, attempt = 0) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const requestedSource = sourceWithRetry(source, attempt);
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.onload = null;
        script.onerror = null;
        callback(value);
      };
      const timeoutId = window.setTimeout(() => {
        script.remove();
        finish(reject, new Error(`Tiempo agotado al cargar ${source}.`));
      }, EXTERNAL_TIMEOUT_MS);
      script.src = requestedSource;
      script.async = false;
      script.dataset.source = source.split(/[?#]/, 1)[0];
      script.onload = () => {
        node.dataset.jaederLoaded = "true";
        finish(resolve);
      };
      script.onerror = () => {
        script.remove();
        finish(reject, new Error(`No se pudo cargar ${source}.`));
      };
      document.head.appendChild(script);
    });
  }

  async function loadExternal(node) {
    const source = node.getAttribute("src");
    if (!source) throw new Error("Un modulo diferido no tiene ruta de origen.");
    let lastError = null;
    for (let attempt = 0; attempt <= EXTERNAL_RETRIES; attempt += 1) {
      try {
        await loadExternalAttempt(node, source, attempt);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < EXTERNAL_RETRIES) {
          console.warn(`[JAEDER PERF] Reintentando carga de ${source}.`, error);
        }
      }
    }
    throw lastError || new Error(`No se pudo cargar ${source}.`);
  }

  function loadNode(node) {
    if (node.dataset.jaederLoaded === "true") return Promise.resolve();
    if (nodePromises.has(node)) return nodePromises.get(node);
    const promise = (node.type === "application/x-jaeder-lazy-source"
      ? executeEmbedded(node)
      : loadExternal(node)
    ).catch(error => {
      nodePromises.delete(node);
      throw error;
    });
    nodePromises.set(node, promise);
    return promise;
  }

  async function loadGroup(group) {
    if (loadedGroups.has(group)) return { group, loaded: false };
    if (groupPromises.has(group)) return groupPromises.get(group);
    const promise = BlessERP.performance.measureAsync(`modulo:${group}`, async () => {
      const nodes = descriptors(group);
      for (const node of nodes) {
        await loadNode(node);
      }
      loadedGroups.add(group);
      window.dispatchEvent?.(new CustomEvent("erp:module-loaded", { detail: { group } }));
      return { group, loaded: true, scripts: nodes.length };
    }, { group });
    groupPromises.set(group, promise);
    try {
      return await promise;
    } catch (error) {
      groupPromises.delete(group);
      throw error;
    }
  }

  function isCodeRouteReady(routeId) {
    return groupsForRoute(routeId).every(group => loadedGroups.has(group));
  }

  function isRouteReady(routeId) {
    return isCodeRouteReady(routeId)
      && (BlessERP.domainDataLoader?.isRouteReady?.(routeId) ?? true);
  }

  async function ensureRoute(routeId) {
    const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRoute?.(routeId, { source: "MODULE_ROUTE" });
    if (capabilityDecision?.enforced === true && capabilityDecision.allowed !== true) {
      const error = new Error(`CAPABILITY_ROUTE_REQUIRED:${routeId}`);
      error.code = "CAPABILITY_ROUTE_REQUIRED";
      error.routeId = routeId;
      throw error;
    }
    const groups = groupsForRoute(routeId);
    for (const group of groups) await loadGroup(group);
    const data = await BlessERP.domainDataLoader?.ensureRoute?.(routeId);
    return { routeId, groups, domains: data?.domains || [] };
  }

  function prefetchRoute(routeId) {
    const id = String(routeId || "");
    const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRoute?.(id, { source: "MODULE_PREFETCH" });
    if (capabilityDecision?.enforced === true && capabilityDecision.allowed !== true) {
      return Promise.resolve({ routeId: id, groups: [], denied: true });
    }
    const groups = groupsForRoute(id);
    if (!id || isCodeRouteReady(id)) return Promise.resolve({ routeId: id, groups });
    // Prefetch prepara únicamente código. Los datos de dominio solo se piden
    // cuando la ruta se convierte realmente en la ruta activa.
    return (async () => {
      for (const group of groups) await loadGroup(group);
      return { routeId: id, groups };
    })().catch(error => {
      console.warn(`[JAEDER PERF] No se pudo precargar ${id}.`, error);
      return { routeId: id, groups, error };
    });
  }

  BlessERP.moduleLoader = {
    ensureRoute,
    groupsForRoute,
    isRouteReady,
    loadGroup,
    prefetchRoute,
    status() {
      return {
        loadedGroups: [...loadedGroups],
        loadingGroups: [...groupPromises.keys()].filter(group => !loadedGroups.has(group))
      };
    }
  };
})();
