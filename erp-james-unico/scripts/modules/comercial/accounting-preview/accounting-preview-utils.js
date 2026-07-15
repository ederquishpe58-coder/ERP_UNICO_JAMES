(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;

  const previewStates = {
    NO_GENERADO: {
      label: "NO_GENERADO",
      shortLabel: "No generado",
      tone: "pending"
    },
    PREVIEW: {
      label: "PREVIEW",
      shortLabel: "Preview",
      tone: "partial"
    },
    LISTO_PARA_CONTABILIZAR_FUTURO: {
      label: "LISTO_PARA_CONTABILIZAR_FUTURO",
      shortLabel: "Listo futuro",
      tone: "authorized"
    },
    CONTABILIZADO_FUTURO: {
      label: "CONTABILIZADO_FUTURO",
      shortLabel: "Contabilizado futuro",
      tone: "authorized"
    }
  };

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function currentUser(appState) {
    return BlessERP.services?.adminConfig?.activeUser?.()
      || appState?.db?.session?.activeUser
      || { id: "demo-user", name: "Usuario demo", role: "Administrador" };
  }

  function normalizePreviewState(value) {
    const key = String(value || "NO_GENERADO").trim().toUpperCase();
    return previewStates[key] ? key : "NO_GENERADO";
  }

  function getPreviewDefinition(value) {
    return previewStates[normalizePreviewState(value)] || previewStates.NO_GENERADO;
  }

  function ensurePreviewStore(order) {
    if (!order || typeof order !== "object") {
      return {
        state: "NO_GENERADO",
        asientoPreviewId: "",
        cxcPreviewId: "",
        generatedAt: "",
        generatedBy: "",
        readyAt: "",
        readyBy: "",
        observation: "",
        snapshot: null
      };
    }

    const current = order.accountingPreview && typeof order.accountingPreview === "object"
      ? order.accountingPreview
      : {};

    order.accountingPreview = {
      state: normalizePreviewState(current.state),
      asientoPreviewId: String(current.asientoPreviewId || "").trim(),
      cxcPreviewId: String(current.cxcPreviewId || "").trim(),
      generatedAt: String(current.generatedAt || "").trim(),
      generatedBy: String(current.generatedBy || "").trim(),
      readyAt: String(current.readyAt || "").trim(),
      readyBy: String(current.readyBy || "").trim(),
      observation: String(current.observation || "").trim(),
      snapshot: current.snapshot && typeof current.snapshot === "object"
        ? current.snapshot
        : null
    };

    return order.accountingPreview;
  }

  function resetOrderPreview(order) {
    if (!order || typeof order !== "object") return;
    order.accountingPreview = {
      state: "NO_GENERADO",
      asientoPreviewId: "",
      cxcPreviewId: "",
      generatedAt: "",
      generatedBy: "",
      readyAt: "",
      readyBy: "",
      observation: "",
      snapshot: null
    };
  }

  function settings() {
    return BlessERP.services?.companySettings?.settings?.() || {};
  }

  function resolveAccountReference(code, label) {
    const resolvedCode = String(code || "").trim();
    const account = resolvedCode
      ? BlessERP.services?.chartOfAccounts?.findByCode?.(resolvedCode)
      : null;

    return {
      label,
      code: resolvedCode,
      name: account?.name || "",
      exists: Boolean(account),
      acceptsCostCenter: Boolean(account?.acceptsCostCenter),
      isMovement: Boolean(account?.isMovement),
      status: String(account?.status || "").trim()
    };
  }

  function resolveSuggestedAccounts() {
    const defaults = settings().defaultAccounts || {};
    return {
      receivable: resolveAccountReference(defaults.accountsReceivableCustomers, "Cuentas por cobrar clientes"),
      exportSales: resolveAccountReference(defaults.exportSales, "Ventas exportacion"),
      customerAdvances: resolveAccountReference(defaults.customerAdvances, "Anticipos de clientes"),
      withholdingReceivable: resolveAccountReference(defaults.withholdingReceivable, "Retenciones recibidas por cobrar")
    };
  }

  function activeCostCenters() {
    return BlessERP.services?.adminConfig?.costCenters?.({ status: "activo" }) || [];
  }

  function resolveSuggestedCostCenter(order) {
    const rows = activeCostCenters();
    const status = String(order?.destination || "").trim().toUpperCase() === "ECUADOR"
      ? ["COMERCIAL", "VENTAS", "LOCAL"]
      : ["EXPORT", "COMERCIAL", "VENTAS"];

    const preferred = rows.find(item => {
      const haystack = `${item.code || ""} ${item.name || ""}`.toUpperCase();
      return status.some(token => haystack.includes(token));
    });

    const fallback = preferred || rows[0] || null;
    return {
      code: String(fallback?.code || "").trim(),
      name: String(fallback?.name || "").trim(),
      exists: Boolean(fallback),
      availableCount: rows.length
    };
  }

  function addDays(isoDate, days) {
    const safeDate = utils.iso(isoDate);
    if (!safeDate) return "";
    const base = new Date(`${safeDate}T00:00:00`);
    base.setDate(base.getDate() + Number(days || 0));
    return base.toISOString().slice(0, 10);
  }

  function buildCommercialTotals(order) {
    const metrics = utils.getOrderMetrics(order);
    const subtotal = round2(metrics.totalUsd);
    const discount = 0;
    const iva = 0;
    return {
      subtotal,
      discount,
      iva,
      totalUsd: round2(subtotal - discount + iva)
    };
  }

  function buildPreviewIds(order) {
    const sanitized = String(order?.number || "PEDIDO").replace(/[^A-Z0-9-]/gi, "");
    return {
      asientoPreviewId: `AS-PREV-${sanitized}`,
      cxcPreviewId: `CXC-PREV-${sanitized}`
    };
  }

  function isEligibleStatus(order) {
    const status = BlessERP.comercialWorkflow?.normalizeStatus
      ? BlessERP.comercialWorkflow.normalizeStatus(order?.status)
      : String(order?.status || "").trim().toUpperCase();
    return ["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO", "DESPACHADO_DEMO", "CERRADO_DEMO"].includes(status);
  }

  BlessERP.comercialAccountingPreviewUtils = {
    activeCostCenters,
    addDays,
    buildCommercialTotals,
    buildPreviewIds,
    currentUser,
    ensurePreviewStore,
    getPreviewDefinition,
    isEligibleStatus,
    nowIso,
    normalizePreviewState,
    previewStates,
    resetOrderPreview,
    resolveSuggestedAccounts,
    resolveSuggestedCostCenter,
    round2,
    settings
  };
})();
