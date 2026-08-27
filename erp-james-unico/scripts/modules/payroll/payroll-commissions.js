(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid } = BlessERP.utils;

  const commissionModes = [
    "PERCENT_SALES",
    "PERCENT_COLLECTED",
    "FIXED_SALE",
    "FIXED_INVOICE",
    "PER_BOX",
    "PER_STEM",
    "MANUAL_BONUS",
    "MIXED"
  ];
  const calculationBases = ["GENERATED", "INVOICED", "SHIPPED", "COLLECTED"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function store() {
    const current = BlessERP.payrollService?.ensureStore?.() || stateApi.state.db.payroll || {};
    current.commissionRules = Array.isArray(current.commissionRules) ? current.commissionRules : [];
    current.commissionSources = Array.isArray(current.commissionSources) ? current.commissionSources : [];
    stateApi.state.db.payroll = current;
    return current;
  }

  function currentUser() {
    return BlessERP.services.adminConfig?.activeUser?.()
      || stateApi.state.db.session?.activeUser
      || { id: "USR-DEMO", name: "Usuario demo" };
  }

  function normalizeRule(rule = {}) {
    return {
      id: rule.id || uid("PCR"),
      companyId: String(rule.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER"),
      sellerId: String(rule.sellerId || ""),
      periodId: String(rule.periodId || ""),
      validFrom: String(rule.validFrom || ""),
      validTo: String(rule.validTo || ""),
      mode: commissionModes.includes(String(rule.mode || "").toUpperCase()) ? String(rule.mode).toUpperCase() : "PERCENT_SALES",
      basis: calculationBases.includes(String(rule.basis || "").toUpperCase()) ? String(rule.basis).toUpperCase() : "INVOICED",
      percentage: Number(rule.percentage || 0),
      fixedPerSale: Number(rule.fixedPerSale || 0),
      fixedPerInvoice: Number(rule.fixedPerInvoice || 0),
      ratePerBox: Number(rule.ratePerBox || 0),
      ratePerStem: Number(rule.ratePerStem || 0),
      manualBonus: Number(rule.manualBonus || 0),
      status: String(rule.status || "ACTIVE").toUpperCase(),
      notes: String(rule.notes || ""),
      updatedAt: rule.updatedAt || new Date().toISOString(),
      updatedBy: rule.updatedBy || currentUser().id
    };
  }

  function saveRule(rule = {}) {
    const target = normalizeRule(rule);
    const errors = [];
    if (!target.sellerId) errors.push("El vendedor es obligatorio.");
    if (!commissionModes.includes(target.mode)) errors.push("La modalidad de comisión no es válida.");
    if (!calculationBases.includes(target.basis)) errors.push("La base de comisión no es válida.");
    if (errors.length) return { ok: false, errors };
    const current = store();
    const rows = current.commissionRules;
    const index = rows.findIndex(item => item.id === target.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = target;
    else rows.unshift(target);
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS",
      action: index >= 0 ? "EDITAR_REGLA_COMISION" : "CREAR_REGLA_COMISION",
      entityType: "payroll_commission_rule",
      entityId: target.id,
      entityLabel: target.sellerId,
      description: "Regla de comisión de vendedor guardada.",
      before,
      after: target,
      result: "exitoso"
    });
    return { ok: true, rule: clone(target) };
  }

  function rules(filters = {}) {
    return clone(store().commissionRules).filter(rule => {
      if (filters.companyId && rule.companyId !== filters.companyId) return false;
      if (filters.sellerId && rule.sellerId !== filters.sellerId) return false;
      if (filters.periodId && rule.periodId && rule.periodId !== filters.periodId) return false;
      if (filters.status && rule.status !== filters.status) return false;
      return true;
    });
  }

  function applicableRule(sellerId, period = {}) {
    const from = String(period.from || period.dateFrom || "");
    const to = String(period.to || period.dateTo || "");
    return rules({ companyId: period.companyId || "", sellerId, status: "ACTIVE" })
      .filter(rule => {
        if (period.id && rule.periodId && rule.periodId !== period.id) return false;
        if (rule.validFrom && to && rule.validFrom > to) return false;
        if (rule.validTo && from && rule.validTo < from) return false;
        return true;
      })
      .sort((a, b) => `${b.periodId}|${b.validFrom}|${b.updatedAt}`.localeCompare(`${a.periodId}|${a.validFrom}|${a.updatedAt}`, "es"))[0]
      || null;
  }

  function orderMetrics(order = {}) {
    if (BlessERP.comercialUtils?.getOrderMetrics) {
      return BlessERP.comercialUtils.getOrderMetrics(order);
    }
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const boxes = new Set();
    return lines.reduce((summary, line) => {
      if (line.boxNumber) boxes.add(line.boxNumber);
      summary.totalBoxes = Math.max(summary.totalBoxes, Number(line.boxCount || 0), boxes.size);
      summary.totalStems += Number(line.totalStems || line.stems || 0);
      summary.totalUsd += Number(line.totalLine || line.totalUsd || 0);
      return summary;
    }, { totalBoxes: Number(order.totalBoxes || 0), totalStems: 0, totalUsd: Number(order.totalUsd || 0) });
  }

  function orderDate(order = {}) {
    return String(order.issuedAt || order.issueDate || order.date || order.createdAt || "").slice(0, 10);
  }

  function isInvoiced(order = {}) {
    const sri = String(order.sriAuthorizationStatus || "").toUpperCase();
    return sri === "AUTORIZADO" || sri === "AUTHORIZED" || Boolean(order.sriAuthorizedAt)
      || ["FACTURADO", "CERRADO"].includes(String(order.status || "").toUpperCase());
  }

  function isShipped(order = {}) {
    return Boolean(order.dispatchedAt || order.shippedAt)
      || ["DESPACHADO", "EMBARCADO", "CERRADO"].includes(String(order.status || "").toUpperCase())
      || ["COMPLETADO", "DESPACHADO"].includes(String(order.warehouseStatus || "").toUpperCase());
  }

  function isCollected(order = {}) {
    return ["COBRADO", "PAGADO", "PAID"].includes(String(order.collectionStatus || order.paymentStatus || "").toUpperCase())
      || Number(order.collectedAmount || 0) >= Number(orderMetrics(order).totalUsd || 0) && Number(orderMetrics(order).totalUsd || 0) > 0;
  }

  function appliesToBasis(order, basis) {
    if (String(order.status || "").toUpperCase() === "ANULADO") return false;
    if (basis === "INVOICED") return isInvoiced(order);
    if (basis === "SHIPPED") return isShipped(order);
    if (basis === "COLLECTED") return isCollected(order);
    return true;
  }

  function customerName(order = {}) {
    const commercial = stateApi.state.db.commercial || {};
    const customer = (commercial.customers || []).find(item => item.id === order.customerId);
    return customer?.commercialName || customer?.legalName || order.customerName || order.clientName || "";
  }

  function calculateRow(rule, metrics, order) {
    const percentageBase = rule.mode === "PERCENT_COLLECTED"
      ? Number(order.collectedAmount || metrics.totalUsd || 0)
      : Number(metrics.totalUsd || 0);
    switch (rule.mode) {
      case "PERCENT_SALES":
      case "PERCENT_COLLECTED":
        return round2(percentageBase * Number(rule.percentage || 0) / 100);
      case "FIXED_SALE":
        return round2(rule.fixedPerSale);
      case "FIXED_INVOICE":
        return isInvoiced(order) ? round2(rule.fixedPerInvoice) : 0;
      case "PER_BOX":
        return round2(Number(metrics.totalBoxes || 0) * Number(rule.ratePerBox || 0));
      case "PER_STEM":
        return round2(Number(metrics.totalStems || 0) * Number(rule.ratePerStem || 0));
      case "MANUAL_BONUS":
        return 0;
      case "MIXED":
        return round2(
          Number(metrics.totalUsd || 0) * Number(rule.percentage || 0) / 100
          + Number(rule.fixedPerSale || 0)
          + (isInvoiced(order) ? Number(rule.fixedPerInvoice || 0) : 0)
          + Number(metrics.totalBoxes || 0) * Number(rule.ratePerBox || 0)
          + Number(metrics.totalStems || 0) * Number(rule.ratePerStem || 0)
        );
      default:
        return 0;
    }
  }

  function calculate({ companyId = "", sellerId, period = {}, rule: explicitRule = null, exclusions = [] } = {}) {
    const scopedCompanyId = String(companyId || period.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
    const scopedPeriod = { ...period, companyId: scopedCompanyId };
    const rule = normalizeRule(explicitRule || applicableRule(sellerId, scopedPeriod) || {
      companyId: scopedCompanyId,
      sellerId,
      mode: "MANUAL_BONUS",
      manualBonus: 0
    });
    const excludedMap = new Map((exclusions || []).map(item => [String(item.orderId || item.saleId || ""), String(item.reason || "")]));
    const from = String(period.from || period.dateFrom || "");
    const to = String(period.to || period.dateTo || "");
    const commercialOrders = stateApi.state.db.commercial?.orders || [];
    const legacySales = stateApi.state.db.sales || [];
    const candidates = [...commercialOrders, ...legacySales].filter(order => {
      const linkedSeller = String(order.seller_id || order.sellerId || order.vendedorId || "");
      if (linkedSeller !== String(sellerId || "")) return false;
      const orderCompanyId = String(order.company_id || order.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
      if (orderCompanyId !== scopedCompanyId) return false;
      const date = orderDate(order);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return appliesToBasis(order, rule.basis);
    });
    const details = candidates.map(order => {
      const metrics = orderMetrics(order);
      const exclusionReason = excludedMap.get(String(order.id || "")) || "";
      return {
        id: uid("PCS"),
        orderId: order.id || "",
        orderNumber: order.number || order.invoiceNumber || "",
        sellerId,
        customer: customerName(order),
        date: orderDate(order),
        saleValue: round2(metrics.totalUsd),
        boxes: Number(metrics.totalBoxes || 0),
        stems: Number(metrics.totalStems || 0),
        saleStatus: order.status || "",
        collectionStatus: order.collectionStatus || order.paymentStatus || "",
        invoiceStatus: order.sriAuthorizationStatus || "",
        basis: rule.basis,
        mode: rule.mode,
        rate: rule.percentage || rule.ratePerBox || rule.ratePerStem || rule.fixedPerSale || rule.fixedPerInvoice || 0,
        excluded: Boolean(exclusionReason),
        exclusionReason,
        commission: exclusionReason ? 0 : calculateRow(rule, metrics, order)
      };
    });
    const manualBonus = ["MANUAL_BONUS", "MIXED"].includes(rule.mode) ? round2(rule.manualBonus) : 0;
    return {
      sellerId,
      rule: clone(rule),
      details,
      manualBonus,
      total: round2(details.reduce((sum, item) => sum + item.commission, 0) + manualBonus),
      calculatedAt: new Date().toISOString()
    };
  }

  BlessERP.payrollCommissions = {
    commissionModes,
    calculationBases,
    normalizeRule,
    saveRule,
    rules,
    applicableRule,
    calculate,
    orderMetrics,
    appliesToBasis
  };
})();
