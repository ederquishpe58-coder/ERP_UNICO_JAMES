(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid } = BlessERP.utils;
  const companyService = BlessERP.services.companySettings;
  const purchaseService = BlessERP.services.purchases;
  const taxConfigService = BlessERP.services.taxConfig;
  const withholdingService = BlessERP.services.taxWithholdings;
  const chartService = BlessERP.services.chartOfAccounts;
  const adminService = BlessERP.services.adminConfig;

  const generationStates = [
    "BORRADOR",
    "PREPARADO",
    "CON_ERRORES",
    "VALIDADO",
    "GENERADO",
    "ANULADO"
  ];

  const validationStatuses = ["pendiente", "corregido", "ignorado"];
  const periodicities = ["mensual", "semestral"];
  const atsTabs = [
    { id: "config", label: "Configuracion ATS" },
    { id: "generator", label: "Generar ATS" },
    { id: "purchases", label: "Compras ATS" },
    { id: "issued", label: "Retenciones emitidas ATS" },
    { id: "received", label: "Retenciones recibidas ATS" },
    { id: "validations", label: "Validaciones ATS" },
    { id: "export", label: "Exportacion ATS" },
    { id: "history", label: "Historial ATS" },
    { id: "sales", label: "Ventas ATS" }
  ];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function num(value) {
    return round2(Number(value || 0));
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function lastDay(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function normalizeMonth(value) {
    return String(value || "06").padStart(2, "0").slice(-2);
  }

  function inferPeriodFromSettings(settings = {}) {
    const raw = String(settings.activePeriod || settings.periodLabel || "2026-06");
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    return "2026-06";
  }

  function defaultConfig() {
    const settings = companyService.settings();
    const period = inferPeriodFromSettings(settings);
    const [year, month] = period.split("-");
    return {
      companyTaxId: settings.ruc || "",
      legalName: settings.legalName || "",
      commercialName: settings.commercialName || "",
      fiscalPeriod: period,
      month: month || "06",
      year: year || "2026",
      periodicity: "mensual",
      informantType: "sociedad",
      accountingRequired: settings.accountingRequired || "Si",
      taxRegime: settings.taxRegime || "",
      environment: settings.sriEnvironment || "Pruebas",
      currency: settings.baseCurrency || "USD",
      includePostedPurchases: true,
      includeIssuedConfirmed: true,
      includeReceivedApplied: true,
      includeAnnulled: false,
      excludeDrafts: true,
      excludeDuplicates: true,
      validateAccounts: true,
      validateTaxSupports: true,
      validateAuthorizations: true
    };
  }

  function ensureStore() {
    let changed = false;
    if (!stateApi.state.db.atsConfig || typeof stateApi.state.db.atsConfig !== "object") {
      stateApi.state.db.atsConfig = defaultConfig();
      changed = true;
    }
    if (!Array.isArray(stateApi.state.db.atsHistory)) {
      stateApi.state.db.atsHistory = [];
      changed = true;
    }
    if (changed) stateApi.saveDb();
  }

  function config() {
    ensureStore();
    return clone(stateApi.state.db.atsConfig);
  }

  function saveConfig(nextConfig = {}) {
    ensureStore();
    stateApi.state.db.atsConfig = {
      ...config(),
      ...clone(nextConfig),
      month: normalizeMonth(nextConfig.month || config().month),
      year: String(nextConfig.year || config().year || "2026")
    };
    stateApi.saveDb();
    return config();
  }

  function history() {
    ensureDemoGeneration();
    return clone(stateApi.state.db.atsHistory || []).sort((a, b) =>
      String(b.generatedAt || b.validatedAt || b.createdAt || "").localeCompare(String(a.generatedAt || a.validatedAt || a.createdAt || ""), "es")
    );
  }

  function findGenerationById(generationId) {
    ensureStore();
    return clone((stateApi.state.db.atsHistory || []).find(item => item.id === generationId) || null);
  }

  function rangeFromFilters(filters = {}) {
    const year = String(filters.year || config().year || "2026");
    const month = normalizeMonth(filters.month || config().month || "06");
    const periodicity = filters.periodicity || config().periodicity || "mensual";
    if (filters.dateFrom && filters.dateTo) {
      return { year, month, periodicity, dateFrom: filters.dateFrom, dateTo: filters.dateTo };
    }
    if (periodicity === "semestral") {
      const firstMonth = Number(month) <= 6 ? 1 : 7;
      const lastMonthValue = Number(month) <= 6 ? 6 : 12;
      return {
        year,
        month,
        periodicity,
        dateFrom: `${year}-${String(firstMonth).padStart(2, "0")}-01`,
        dateTo: `${year}-${String(lastMonthValue).padStart(2, "0")}-${String(lastDay(year, lastMonthValue)).padStart(2, "0")}`
      };
    }
    return {
      year,
      month,
      periodicity,
      dateFrom: `${year}-${month}-01`,
      dateTo: `${year}-${month}-${String(lastDay(year, month)).padStart(2, "0")}`
    };
  }

  function resolveFilters(filters = {}) {
    const base = config();
    const merged = { ...base, ...clone(filters) };
    const range = rangeFromFilters(merged);
    return {
      ...merged,
      ...range,
      month: normalizeMonth(range.month),
      year: String(range.year)
    };
  }

  function matchesDate(value, dateFrom = "", dateTo = "") {
    if (!value) return false;
    if (dateFrom && value < dateFrom) return false;
    if (dateTo && value > dateTo) return false;
    return true;
  }

  function identificationType(taxId) {
    const normalized = String(taxId || "").trim();
    if (!normalized) return "";
    if (/^\d{13}$/.test(normalized)) return "RUC";
    if (/^\d{10}$/.test(normalized)) return "CEDULA";
    if (/[A-Za-z]/.test(normalized)) return "EXTERIOR";
    return "OTRO";
  }

  function voucherCode(voucherType) {
    const map = {
      factura: "01",
      liquidacion_compra: "03",
      nota_credito: "04",
      nota_debito: "05"
    };
    return map[voucherType] || "";
  }

  function purchaseRequiresRetention(purchaseType) {
    return [
      "SERVICIOS",
      "SERVICIOS_PROFESIONALES",
      "SERVICIOS_EXTERIOR",
      "TRANSPORTE",
      "ARRIENDO",
      "GASTO",
      "OTROS"
    ].includes(String(purchaseType || "").toUpperCase());
  }

  function accountActiveAndMovement(code) {
    if (!String(code || "").trim()) return { ok: false, errors: ["Cuenta contable no configurada."] };
    const account = chartService.findByCode(code);
    if (!account) return { ok: false, errors: ["La cuenta contable configurada no existe."] };
    const errors = [];
    if (account.status !== "Activa") errors.push("La cuenta contable configurada esta inactiva.");
    if (!account.isMovement) errors.push("La cuenta contable configurada no es de movimiento.");
    return { ok: !errors.length, errors, account };
  }

  function duplicateKeyFromPurchase(row) {
    return [
      row.supplierRuc || "",
      row.voucherType || "",
      row.estab || "",
      row.ptoEmi || "",
      row.sequential || "",
      row.authorization || row.accessKey || ""
    ].join("|");
  }

  function duplicateKeyFromReceived(row) {
    return [
      row.customerTaxId || "",
      row.estab || "",
      row.ptoEmi || "",
      row.sequential || "",
      row.authorization || row.accessKey || ""
    ].join("|");
  }

  function aggregateIssuedRetentions(rows = []) {
    const byPurchase = new Map();
    rows.forEach(row => {
      const current = byPurchase.get(row.purchaseId) || { rent: 0, vat: 0, total: 0 };
      if (row.taxType === "RENTA") current.rent = round2(current.rent + row.retainedAmount);
      if (row.taxType === "IVA") current.vat = round2(current.vat + row.retainedAmount);
      current.total = round2(current.total + row.retainedAmount);
      byPurchase.set(row.purchaseId, current);
    });
    return byPurchase;
  }

  function mapPurchaseRow(purchase, retentionMap = new Map(), overrides = {}) {
    const support = purchaseService.taxSupportByCode(purchase.taxSupportCode) || { code: purchase.taxSupportCode || "", description: "" };
    const totals = purchase.totals || {};
    const retentions = retentionMap.get(purchase.id) || { rent: 0, vat: 0, total: 0 };
    return {
      sourceId: purchase.id,
      sourceMode: overrides.sourceMode || "ERP",
      issueDate: overrides.issueDate || purchase.issueDate || "",
      accountingDate: overrides.accountingDate || purchase.accountingDate || purchase.issueDate || "",
      supplierName: purchase.supplierName || "",
      supplierRuc: purchase.supplierRuc || "",
      supplierIdentificationType: identificationType(purchase.supplierRuc),
      voucherType: purchase.voucherType || "",
      voucherCode: voucherCode(purchase.voucherType),
      estab: purchase.estab || "",
      ptoEmi: purchase.ptoEmi || "",
      sequential: purchase.sequential || "",
      documentNumber: purchase.documentNumber || "",
      authorization: overrides.authorization !== undefined ? overrides.authorization : (purchase.authorizationNumber || ""),
      accessKey: overrides.accessKey !== undefined ? overrides.accessKey : (purchase.accessKey || ""),
      taxSupportCode: support.code || "",
      taxSupportName: support.description || "",
      purchaseType: purchase.purchaseType || "",
      baseNoObjetoIva: num(overrides.baseNoObjetoIva ?? 0),
      baseExentaIva: num(overrides.baseExentaIva ?? 0),
      base0: num(overrides.base0 ?? totals.base0),
      baseIva: num(overrides.baseIva ?? totals.baseIva),
      iva: num(overrides.iva ?? totals.iva),
      ice: num(overrides.ice ?? 0),
      total: num(overrides.total ?? totals.total),
      paymentMethod: overrides.paymentMethod ?? purchase.paymentMethod ?? "",
      retentionRent: num(overrides.retentionRent ?? retentions.rent),
      retentionVat: num(overrides.retentionVat ?? retentions.vat),
      retentionTotal: num(overrides.retentionTotal ?? retentions.total),
      status: overrides.status || purchase.status || "",
      lineCount: Array.isArray(purchase.lines) ? purchase.lines.length : 0,
      duplicateKey: overrides.duplicateKey || duplicateKeyFromPurchase({
        supplierRuc: purchase.supplierRuc,
        voucherType: purchase.voucherType,
        estab: purchase.estab,
        ptoEmi: purchase.ptoEmi,
        sequential: purchase.sequential,
        authorization: overrides.authorization !== undefined ? overrides.authorization : purchase.authorizationNumber,
        accessKey: overrides.accessKey !== undefined ? overrides.accessKey : purchase.accessKey
      }),
      errors: [],
      warnings: []
    };
  }

  function mapIssuedWithholdingRow(withholding, overrides = {}) {
    const rows = [];
    const base = {
      purchaseId: withholding.purchaseId || "",
      purchaseDocumentNumber: withholding.purchaseDocumentNumber || "",
      supplierName: withholding.supplierName || "",
      supplierRuc: withholding.supplierRuc || "",
      retentionDate: overrides.retentionDate || withholding.retentionDate || "",
      draftNumber: withholding.draftNumber || "",
      status: overrides.status || withholding.status || "",
      sourceMode: overrides.sourceMode || "ERP",
      accountingEntryNumber: withholding.journalEntryNumber || "",
      accountingEntryId: withholding.journalEntryId || ""
    };
    if (num(overrides.rentRetainedAmount ?? withholding.rentRetainedAmount) > 0 || overrides.forceRent) {
      rows.push({
        ...base,
        sourceId: `${withholding.id || uid("ATS")}:RENTA`,
        taxType: "RENTA",
        retentionCode: overrides.rentCode || withholding.rentCode || withholding.rentSriCode || "",
        sriCode: overrides.rentSriCode || withholding.rentSriCode || "",
        description: overrides.rentDescription || withholding.rentDescription || "",
        baseAmount: num(overrides.rentBaseAmount ?? withholding.rentBaseAmount),
        percentage: num(overrides.rentPercentage ?? withholding.rentPercentage),
        retainedAmount: num(overrides.rentRetainedAmount ?? withholding.rentRetainedAmount),
        payableAccountCode: overrides.rentPayableAccountCode || withholding.rentPayableAccountCode || ""
      });
    }
    if (num(overrides.vatRetainedAmount ?? withholding.vatRetainedAmount) > 0 || overrides.forceVat) {
      rows.push({
        ...base,
        sourceId: `${withholding.id || uid("ATS")}:IVA`,
        taxType: "IVA",
        retentionCode: overrides.vatCode || withholding.vatCode || withholding.vatSriCode || "",
        sriCode: overrides.vatSriCode || withholding.vatSriCode || "",
        description: overrides.vatDescription || withholding.vatDescription || "",
        baseAmount: num(overrides.vatBaseAmount ?? withholding.vatBaseAmount),
        percentage: num(overrides.vatPercentage ?? withholding.vatPercentage),
        retainedAmount: num(overrides.vatRetainedAmount ?? withholding.vatRetainedAmount),
        payableAccountCode: overrides.vatPayableAccountCode || withholding.vatPayableAccountCode || ""
      });
    }
    return rows;
  }

  function mapReceivedWithholdingRow(received, line, overrides = {}) {
    return {
      sourceId: `${received.id || uid("ATSR")}:${line.id || uid("LIN")}`,
      sourceMode: overrides.sourceMode || "ERP",
      issueDate: overrides.issueDate || received.issueDate || "",
      customerName: received.issuerName || "",
      customerTaxId: received.issuerTaxId || "",
      customerIdentificationType: identificationType(received.issuerTaxId),
      documentNumber: received.documentNumber || "",
      estab: received.estab || "",
      ptoEmi: received.ptoEmi || "",
      sequential: received.sequential || "",
      authorization: overrides.authorization !== undefined ? overrides.authorization : (received.authorizationNumber || ""),
      accessKey: overrides.accessKey !== undefined ? overrides.accessKey : (received.accessKey || ""),
      supportDocumentNumber: received.supportDocumentNumber || received.relatedReceivableNumber || "",
      supportDocumentDate: received.supportDocumentDate || "",
      taxType: overrides.taxType || line.taxType || "",
      retentionCode: overrides.retentionCode || line.retentionCode || line.sriCode || "",
      sriCode: overrides.sriCode || line.sriCode || "",
      baseAmount: num(overrides.baseAmount ?? line.baseAmount),
      percentage: num(overrides.percentage ?? line.percentage),
      retainedAmount: num(overrides.retainedAmount ?? line.retainedAmount),
      status: overrides.status || received.status || "",
      relatedDocumentNumber: overrides.relatedDocumentNumber || received.relatedReceivableNumber || received.suggestedReceivableNumber || "",
      accountingEntryNumber: received.journalEntryNumber || "",
      duplicateKey: overrides.duplicateKey || duplicateKeyFromReceived({
        customerTaxId: received.issuerTaxId,
        estab: received.estab,
        ptoEmi: received.ptoEmi,
        sequential: received.sequential,
        authorization: overrides.authorization !== undefined ? overrides.authorization : received.authorizationNumber,
        accessKey: overrides.accessKey !== undefined ? overrides.accessKey : received.accessKey
      })
    };
  }

  function buildLiveDataset(filters) {
    const issuedRows = purchaseService.issuedWithholdings()
      .filter(item => {
        if (!matchesDate(item.retentionDate, filters.dateFrom, filters.dateTo)) return false;
        if (!filters.includeAnnulled && item.status === "ANULADA") return false;
        if (filters.includeIssuedConfirmed && !["CONFIRMADA", "AUTORIZADA"].includes(item.status)) return false;
        return true;
      })
      .flatMap(item => mapIssuedWithholdingRow(item));

    const issuedByPurchase = aggregateIssuedRetentions(issuedRows);

    const purchaseRows = purchaseService.purchases()
      .filter(item => {
        const rowDate = item.accountingDate || item.issueDate || "";
        if (!matchesDate(rowDate, filters.dateFrom, filters.dateTo)) return false;
        if (filters.provider && !String(item.supplierName || "").toLowerCase().includes(String(filters.provider).toLowerCase())) return false;
        if (filters.voucherType && item.voucherType !== filters.voucherType) return false;
        if (filters.documentStatus && item.status !== filters.documentStatus) return false;
        if (filters.excludeDrafts && item.status === "BORRADOR") return false;
        if (filters.includePostedPurchases && !["CONTABILIZADO", "RETENIDO"].includes(item.status)) return false;
        if (!filters.includeAnnulled && item.status === "ANULADO") return false;
        return true;
      })
      .map(item => mapPurchaseRow(item, issuedByPurchase));

    const receivedRows = withholdingService.receivedWithholdings()
      .filter(item => {
        const rowDate = item.issueDate || item.createdAt?.slice(0, 10) || "";
        if (!matchesDate(rowDate, filters.dateFrom, filters.dateTo)) return false;
        if (!filters.includeAnnulled && item.status === "ANULADO") return false;
        if (!filters.includeReceivedApplied && item.status === "APLICADO") return false;
        return true;
      })
      .flatMap(item => (item.lines || []).map(line => mapReceivedWithholdingRow(item, line)));

    return {
      sourceMode: "live",
      purchases: purchaseRows,
      issued: issuedRows,
      received: receivedRows
    };
  }

  function pickPurchase(documentNumber, fallback) {
    return purchaseService.purchases().find(item => item.documentNumber === documentNumber) || fallback;
  }

  function pickReceived(documentNumber, fallback) {
    return withholdingService.receivedWithholdings().find(item => item.documentNumber === documentNumber) || fallback;
  }

  function demoJuneDataset() {
    const junePurchases = [
      pickPurchase("001-003-000000242", {
        id: uid("PUR"),
        supplierName: "Agroinsumos del Ecuador",
        supplierRuc: "1790012345001",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "003",
        sequential: "000000242",
        authorizationNumber: "1790012345678901234567890123456789012345678910",
        accessKey: "",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_SUMINISTROS",
        status: "CONTABILIZADO",
        totals: { base0: 560, baseIva: 0, iva: 0, total: 560 }
      }),
      pickPurchase("001-004-000000402", {
        id: uid("PUR"),
        supplierName: "Cartonera Andina",
        supplierRuc: "0990012345001",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "004",
        sequential: "000000402",
        authorizationNumber: "0990012345678901234567890123456789012345678911",
        accessKey: "",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_EMPAQUE",
        status: "CONTABILIZADO",
        totals: { base0: 1250, baseIva: 0, iva: 0, total: 1250 }
      }),
      pickPurchase("001-002-000000152", {
        id: uid("PUR"),
        supplierName: "Servicios Tecnicos Quito",
        supplierRuc: "1710012345001",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "002",
        sequential: "000000152",
        authorizationNumber: "",
        accessKey: "",
        taxSupportCode: "02",
        purchaseType: "SERVICIOS",
        status: "CONTABILIZADO",
        totals: { base0: 300, baseIva: 0, iva: 0, total: 300 }
      })
    ];

    const issuedPrototype = {
      id: uid("RET"),
      purchaseId: junePurchases[2].id,
      purchaseDocumentNumber: "001-002-000000152",
      supplierName: "Servicios Tecnicos Quito",
      supplierRuc: "1710012345001",
      retentionDate: "2026-06-18",
      draftNumber: "RET-JUN-000001",
      rentCode: "RET_304",
      rentSriCode: "304",
      rentDescription: "Servicios",
      rentBaseAmount: 300,
      rentPercentage: 2,
      rentRetainedAmount: 6,
      rentPayableAccountCode: "2.1.02.02",
      vatCode: "",
      vatSriCode: "",
      vatDescription: "",
      vatBaseAmount: 0,
      vatPercentage: 0,
      vatRetainedAmount: 0,
      vatPayableAccountCode: "2.1.02.01",
      journalEntryNumber: "",
      status: "CONFIRMADA"
    };

    const receivedApplied = pickReceived("001-001-000000041", {
      id: uid("WRC"),
      issuerTaxId: "1799999999001",
      issuerName: "Floristeria Quito",
      issueDate: "2026-06-21",
      estab: "001",
      ptoEmi: "001",
      sequential: "000000041",
      documentNumber: "001-001-000000041",
      authorizationNumber: "1799999999001001001000000041123456789012345678901234",
      accessKey: "1799999999001001001000000041123456789012345678901234",
      supportDocumentNumber: "CXC-001",
      supportDocumentDate: "2026-06-12",
      relatedReceivableNumber: "CXC-001",
      journalEntryNumber: "ASI-2026-000021",
      status: "APLICADO",
      lines: [{ id: uid("LIN"), taxType: "RENTA", retentionCode: "RET_304", sriCode: "304", percentage: 1.95, baseAmount: 450, retainedAmount: 8.78 }]
    });

    const receivedPending = pickReceived("001-002-000000085", {
      id: uid("WRC"),
      issuerTaxId: "FF-USA-001",
      issuerName: "FlowerForce",
      issueDate: "2026-06-24",
      estab: "001",
      ptoEmi: "002",
      sequential: "000000085",
      documentNumber: "001-002-000000085",
      authorizationNumber: "FF0010020000000851234567890123456789012345678901234",
      accessKey: "FF0010020000000851234567890123456789012345678901234",
      supportDocumentNumber: "CXC-002",
      supportDocumentDate: "2026-06-13",
      relatedReceivableNumber: "",
      journalEntryNumber: "",
      status: "PENDIENTE_RELACION",
      lines: [{ id: uid("LIN"), taxType: "RENTA", retentionCode: "RET_312", sriCode: "312", percentage: 1, baseAmount: 1200, retainedAmount: 12 }]
    });

    const issuedRows = mapIssuedWithholdingRow(issuedPrototype, { sourceMode: "demo-junio" });
    const retentionMap = aggregateIssuedRetentions(issuedRows);

    return {
      sourceMode: "demo-junio",
      purchases: [
        mapPurchaseRow(junePurchases[0], retentionMap, { sourceMode: "demo-junio", issueDate: "2026-06-11", accountingDate: "2026-06-11", paymentMethod: "" }),
        mapPurchaseRow(junePurchases[1], retentionMap, { sourceMode: "demo-junio", issueDate: "2026-06-14", accountingDate: "2026-06-14", paymentMethod: "Transferencia" }),
        mapPurchaseRow(junePurchases[2], retentionMap, { sourceMode: "demo-junio", issueDate: "2026-06-18", accountingDate: "2026-06-18", authorization: "", accessKey: "", paymentMethod: "" })
      ],
      issued: issuedRows,
      received: [
        mapReceivedWithholdingRow(receivedApplied, receivedApplied.lines?.[0] || {}, { sourceMode: "demo-junio", issueDate: "2026-06-21", status: "APLICADO", relatedDocumentNumber: "CXC-001" }),
        mapReceivedWithholdingRow(receivedPending, receivedPending.lines?.[0] || {}, { sourceMode: "demo-junio", issueDate: "2026-06-24", status: "PENDIENTE_RELACION", relatedDocumentNumber: "" })
      ]
    };
  }

  function shouldUseJuneDemo(dataset, filters) {
    return String(filters.year) === "2026"
      && String(filters.month) === "06"
      && (
        dataset.purchases.length < 3
        || dataset.issued.length < 1
        || dataset.received.length < 2
      );
  }

  function buildDataset(filters) {
    const live = buildLiveDataset(filters);
    if (shouldUseJuneDemo(live, filters)) return demoJuneDataset();
    return live;
  }

  function validationRecord(severity, moduleOrigin, documentLabel, description, suggestedAction, status = "pendiente", justification = "", key = "") {
    return {
      id: uid("ATSV"),
      key: key || `${severity}|${moduleOrigin}|${documentLabel}|${description}`,
      severity,
      moduleOrigin,
      documentLabel,
      description,
      suggestedAction,
      status,
      justification
    };
  }

  function carryValidationStatus(nextItems, previousItems = []) {
    const previousMap = new Map((previousItems || []).map(item => [item.key, item]));
    return nextItems.map(item => {
      const previous = previousMap.get(item.key);
      return previous ? { ...item, status: previous.status || item.status, justification: previous.justification || "" } : item;
    });
  }

  function validatePurchases(rows, filters) {
    const errors = [];
    const warnings = [];
    const duplicateMap = new Set();
    rows.forEach(row => {
      const label = row.documentNumber || `${row.estab}-${row.ptoEmi}-${row.sequential}`;
      if (!row.supplierRuc) errors.push(validationRecord("error", "Compras ATS", label, "Falta RUC del proveedor.", "Completar el proveedor antes de generar ATS.", "pendiente", "", `${label}|supplier-ruc`));
      if (!row.authorization && filters.validateAuthorizations) errors.push(validationRecord("error", "Compras ATS", label, "Falta autorizacion o clave de acceso.", "Completar o corregir la autorizacion del comprobante.", "pendiente", "", `${label}|authorization`));
      if (!row.voucherCode) errors.push(validationRecord("error", "Compras ATS", label, "Falta tipo de comprobante SRI.", "Revisar el tipo de documento de compra.", "pendiente", "", `${label}|voucher-code`));
      if (!row.taxSupportCode && filters.validateTaxSupports) errors.push(validationRecord("error", "Compras ATS", label, "Falta sustento tributario.", "Asignar el sustento tributario correcto.", "pendiente", "", `${label}|tax-support`));
      if (!["CONTABILIZADO", "RETENIDO"].includes(row.status)) errors.push(validationRecord("error", "Compras ATS", label, "La compra no esta contabilizada.", "Contabilizar la compra antes de incluirla en ATS.", "pendiente", "", `${label}|status`));
      if (Math.abs(round2(row.baseNoObjetoIva + row.baseExentaIva + row.base0 + row.baseIva + row.iva + row.ice - row.total)) > 0.01) {
        errors.push(validationRecord("error", "Compras ATS", label, "Las bases imponibles no cuadran con el total del documento.", "Revisar bases e impuestos del comprobante.", "pendiente", "", `${label}|totals`));
      }
      if (filters.excludeDuplicates && row.duplicateKey) {
        if (duplicateMap.has(row.duplicateKey)) {
          errors.push(validationRecord("error", "Compras ATS", label, "Documento duplicado dentro del periodo ATS.", "Depurar comprobantes repetidos antes de generar.", "pendiente", "", `${label}|duplicate`));
        }
        duplicateMap.add(row.duplicateKey);
      }
      if (!row.paymentMethod) warnings.push(validationRecord("warning", "Compras ATS", label, "Documento sin forma de pago registrada.", "Registrar forma de pago o justificar la ausencia.", "pendiente", "", `${label}|payment`));
      if (purchaseRequiresRetention(row.purchaseType) && num(row.retentionTotal) <= 0) {
        warnings.push(validationRecord("warning", "Compras ATS", label, "Compra sin retencion a pesar de que el tipo sugiere retener.", "Revisar si la compra requiere retencion emitida.", "pendiente", "", `${label}|retention-warning`));
      }
    });
    return { errors, warnings };
  }

  function validateIssued(rows) {
    const errors = [];
    const warnings = [];
    const duplicateSet = new Set();
    rows.forEach(row => {
      const label = `${row.draftNumber || row.purchaseDocumentNumber} / ${row.sriCode || row.retentionCode || row.taxType}`;
      if (!["CONFIRMADA", "AUTORIZADA"].includes(row.status)) {
        errors.push(validationRecord("error", "Retenciones emitidas ATS", label, "La retencion emitida esta en borrador o no confirmada.", "Confirmar la retencion antes de incluirla en ATS.", "pendiente", "", `${label}|status`));
      }
      if (!row.purchaseDocumentNumber) {
        errors.push(validationRecord("error", "Retenciones emitidas ATS", label, "Falta la compra relacionada.", "Relacionar la retencion con una compra contabilizada.", "pendiente", "", `${label}|purchase`));
      }
      if (num(row.retainedAmount) <= 0) {
        errors.push(validationRecord("error", "Retenciones emitidas ATS", label, "El valor retenido debe ser mayor a cero.", "Revisar base imponible y porcentaje.", "pendiente", "", `${label}|amount`));
      }
      const duplicateKey = `${row.purchaseId}|${row.taxType}|${row.sriCode || row.retentionCode}`;
      if (duplicateSet.has(duplicateKey)) {
        errors.push(validationRecord("error", "Retenciones emitidas ATS", label, "Existe una retencion duplicada para la misma compra y codigo.", "Eliminar o anular el duplicado antes de generar ATS.", "pendiente", "", `${label}|duplicate`));
      }
      duplicateSet.add(duplicateKey);
      const retentionValidity = taxConfigService.validateRetentionActiveOnDate(row.retentionCode || row.sriCode || "", row.retentionDate, { taxType: row.taxType });
      if (!retentionValidity.ok) {
        errors.push(validationRecord("error", "Retenciones emitidas ATS", label, retentionValidity.errors.join(" "), "Actualizar el codigo de retencion o su vigencia.", "pendiente", "", `${label}|vigency`));
      }
      const accountCheck = accountActiveAndMovement(row.payableAccountCode || "");
      if (!accountCheck.ok) {
        warnings.push(validationRecord("warning", "Retenciones emitidas ATS", label, accountCheck.errors.join(" "), "Completar la cuenta contable por pagar del codigo.", "pendiente", "", `${label}|account`));
      }
    });
    return { errors, warnings };
  }

  function validateReceived(rows, filters) {
    const errors = [];
    const warnings = [];
    const duplicateSet = new Set();
    rows.forEach(row => {
      const label = `${row.documentNumber} / ${row.sriCode || row.retentionCode || row.taxType}`;
      if (filters.excludeDuplicates && row.duplicateKey) {
        if (duplicateSet.has(row.duplicateKey)) {
          errors.push(validationRecord("error", "Retenciones recibidas ATS", label, "Retencion recibida duplicada dentro del periodo ATS.", "Depurar XML duplicados antes de exportar.", "pendiente", "", `${label}|duplicate`));
        }
        duplicateSet.add(row.duplicateKey);
      }
      if (!row.authorization && filters.validateAuthorizations) {
        errors.push(validationRecord("error", "Retenciones recibidas ATS", label, "Falta autorizacion o clave de acceso de la retencion recibida.", "Completar o importar correctamente el XML.", "pendiente", "", `${label}|authorization`));
      }
      if (row.status === "PENDIENTE_RELACION") {
        warnings.push(validationRecord("warning", "Retenciones recibidas ATS", label, "Retencion recibida pendiente de relacion.", "Relacionar el XML con la cuenta por cobrar o justificar su inclusion.", "pendiente", "", `${label}|relation`));
      }
      if (["APLICADO"].includes(row.status) && !row.relatedDocumentNumber) {
        errors.push(validationRecord("error", "Retenciones recibidas ATS", label, "Retencion aplicada sin documento relacionado.", "Relacionar la retencion con el documento sustento.", "pendiente", "", `${label}|document`));
      }
      if (num(row.retainedAmount) <= 0) {
        errors.push(validationRecord("error", "Retenciones recibidas ATS", label, "El valor retenido debe ser mayor a cero.", "Revisar base imponible y porcentaje del XML.", "pendiente", "", `${label}|amount`));
      }
    });
    return { errors, warnings };
  }

  function validateGlobal(filters) {
    const settings = config();
    const errors = [];
    const warnings = [];
    if (!String(settings.companyTaxId || "").trim()) errors.push(validationRecord("error", "Configuracion ATS", "Informante", "Falta RUC de la empresa.", "Completar el RUC en Parametros Generales / ATS.", "pendiente", "", "global|company-ruc"));
    if (!String(settings.legalName || "").trim()) errors.push(validationRecord("error", "Configuracion ATS", "Informante", "Falta razon social del informante.", "Completar la razon social antes de generar ATS.", "pendiente", "", "global|legal-name"));
    if (!String(filters.year || "").trim() || !String(filters.month || "").trim()) errors.push(validationRecord("error", "Configuracion ATS", "Periodo", "Falta definir periodo fiscal.", "Seleccionar mes y anio del ATS.", "pendiente", "", "global|period"));
    if (filters.validateAccounts) {
      const missingAccounts = companyService.missingDefaultAccounts();
      if (missingAccounts.length) {
        warnings.push(validationRecord("warning", "Configuracion ATS", "Cuentas contables", `Faltan ${missingAccounts.length} cuentas contables predeterminadas por configurar.`, "Completar las cuentas base para reportes y conciliaciones futuras.", "pendiente", "", "global|accounts"));
      }
    }
    return { errors, warnings };
  }

  function buildSummary(dataset, validations) {
    const errors = validations.filter(item => item.severity === "error" && item.status !== "corregido");
    const warnings = validations.filter(item => item.severity === "warning" && item.status === "pendiente");
    return {
      purchases: dataset.purchases.length,
      issued: dataset.issued.length,
      received: dataset.received.length,
      errors: errors.length,
      warnings: warnings.length
    };
  }

  function validateDataset(dataset, filters, previousValidations = []) {
    const globalResult = validateGlobal(filters);
    const purchasesResult = validatePurchases(dataset.purchases, filters);
    const issuedResult = validateIssued(dataset.issued);
    const receivedResult = validateReceived(dataset.received, filters);
    const validations = [
      ...globalResult.errors,
      ...globalResult.warnings,
      ...purchasesResult.errors,
      ...purchasesResult.warnings,
      ...issuedResult.errors,
      ...issuedResult.warnings,
      ...receivedResult.errors,
      ...receivedResult.warnings
    ];
    return carryValidationStatus(validations, previousValidations);
  }

  function buildAtsStructure(generation) {
    const cfg = generation.configSnapshot || config();
    return {
      informant: {
        ruc: cfg.companyTaxId,
        razonSocial: cfg.legalName,
        nombreComercial: cfg.commercialName || "",
        periodo: `${generation.year}${generation.month}`,
        periodicidad: generation.periodicity,
        obligadoContabilidad: cfg.accountingRequired,
        regimen: cfg.taxRegime || "",
        ambiente: cfg.environment || "",
        moneda: cfg.currency || "USD"
      },
      compras: generation.dataset.purchases.map(item => ({
        fechaEmision: item.issueDate,
        fechaContabilizacion: item.accountingDate,
        proveedor: item.supplierName,
        rucProveedor: item.supplierRuc,
        tipoComprobante: item.voucherCode,
        establecimiento: item.estab,
        puntoEmision: item.ptoEmi,
        secuencial: item.sequential,
        autorizacion: item.authorization || item.accessKey || "",
        sustento: item.taxSupportCode,
        tipoCompra: item.purchaseType,
        baseNoObjetoIva: item.baseNoObjetoIva,
        baseExentaIva: item.baseExentaIva,
        baseCero: item.base0,
        baseIva: item.baseIva,
        iva: item.iva,
        total: item.total,
        formaPago: item.paymentMethod || "",
        retencionFuente: item.retentionRent,
        retencionIva: item.retentionVat
      })),
      retencionesEmitidas: generation.dataset.issued.map(item => ({
        fecha: item.retentionDate,
        proveedor: item.supplierName,
        rucProveedor: item.supplierRuc,
        documentoSustento: item.purchaseDocumentNumber,
        codigoRetencion: item.sriCode || item.retentionCode || "",
        tipoImpuesto: item.taxType,
        baseImponible: item.baseAmount,
        porcentaje: item.percentage,
        valorRetenido: item.retainedAmount,
        estado: item.status
      })),
      retencionesRecibidas: generation.dataset.received.map(item => ({
        fecha: item.issueDate,
        cliente: item.customerName,
        identificacionCliente: item.customerTaxId,
        documentoSustento: item.supportDocumentNumber,
        codigoRetencion: item.sriCode || item.retentionCode || "",
        tipoImpuesto: item.taxType,
        baseImponible: item.baseAmount,
        porcentaje: item.percentage,
        valorRetenido: item.retainedAmount,
        documentoRelacionado: item.relatedDocumentNumber || "",
        estado: item.status
      }))
    };
  }

  function buildXmlPreview(generation) {
    const structure = buildAtsStructure(generation);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!-- XML ATS preliminar: requiere revision, correccion y validacion segun catalogo, ficha tecnica e instructivo SRI antes de uso definitivo. -->",
      `<ats version="base" estado="${generation.status}" etapa="preliminar">`,
      `  <informante ruc="${structure.informant.ruc}" razonSocial="${structure.informant.razonSocial}" periodo="${structure.informant.periodo}" periodicidad="${structure.informant.periodicidad}" obligadoContabilidad="${structure.informant.obligadoContabilidad}" ambiente="${structure.informant.ambiente}" moneda="${structure.informant.moneda}" />`,
      "  <compras>",
      ...structure.compras.map(item => `    <compra rucProveedor="${item.rucProveedor}" tipoComprobante="${item.tipoComprobante}" establecimiento="${item.establecimiento}" puntoEmision="${item.puntoEmision}" secuencial="${item.secuencial}" sustento="${item.sustento}" total="${item.total.toFixed(2)}" />`),
      "  </compras>",
      "  <retencionesEmitidas>",
      ...structure.retencionesEmitidas.map(item => `    <retencionEmitida documentoSustento="${item.documentoSustento}" codigo="${item.codigoRetencion}" tipo="${item.tipoImpuesto}" valor="${item.valorRetenido.toFixed(2)}" estado="${item.estado}" />`),
      "  </retencionesEmitidas>",
      "  <retencionesRecibidas>",
      ...structure.retencionesRecibidas.map(item => `    <retencionRecibida documentoSustento="${item.documentoSustento}" codigo="${item.codigoRetencion}" tipo="${item.tipoImpuesto}" valor="${item.valorRetenido.toFixed(2)}" estado="${item.estado}" />`),
      "  </retencionesRecibidas>",
      "</ats>"
    ].join("\n");
  }

  function buildJsonPreview(generation) {
    return JSON.stringify({
      metadata: {
        id: generation.id,
        period: generation.period,
        status: generation.status,
        generatedAt: generation.generatedAt || "",
        sourceMode: generation.sourceMode || "live"
      },
      summary: generation.summary,
      validations: generation.validations,
      ats: buildAtsStructure(generation)
    }, null, 2);
  }

  function buildGeneration(criteria = {}, existing = null) {
    const filters = resolveFilters(criteria);
    const dataset = buildDataset(filters);
    const previousValidations = existing?.validations || [];
    const validations = validateDataset(dataset, filters, previousValidations);
    const criticalErrors = validations.filter(item => item.severity === "error" && item.status !== "corregido");
    const summary = buildSummary(dataset, validations);
    const now = new Date().toISOString();
    return {
      id: existing?.id || uid("ATS"),
      period: `${filters.year}-${filters.month}`,
      month: filters.month,
      year: filters.year,
      periodicity: filters.periodicity,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      status: criticalErrors.length ? "CON_ERRORES" : (existing?.status === "GENERADO" ? "GENERADO" : "VALIDADO"),
      sourceMode: dataset.sourceMode,
      configSnapshot: {
        companyTaxId: filters.companyTaxId,
        legalName: filters.legalName,
        commercialName: filters.commercialName,
        accountingRequired: filters.accountingRequired,
        taxRegime: filters.taxRegime,
        environment: filters.environment,
        currency: filters.currency
      },
      criteria: {
        year: filters.year,
        month: filters.month,
        periodicity: filters.periodicity,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        documentStatus: filters.documentStatus || "",
        voucherType: filters.voucherType || "",
        provider: filters.provider || "",
        customer: filters.customer || ""
      },
      dataset,
      validations,
      summary,
      createdAt: existing?.createdAt || now,
      validatedAt: now,
      generatedAt: existing?.generatedAt || "",
      annulledAt: existing?.annulledAt || "",
      annulReason: existing?.annulReason || "",
      userName: existing?.userName || currentUser().name || "Usuario demo",
      preview: {
        xml: "",
        json: ""
      }
    };
  }

  function saveGenerationRecord(record) {
    ensureStore();
    const rows = stateApi.state.db.atsHistory || [];
    const index = rows.findIndex(item => item.id === record.id);
    if (index >= 0) rows[index] = clone(record);
    else rows.unshift(clone(record));
    stateApi.state.db.atsHistory = rows;
    stateApi.saveDb();
    return clone(record);
  }

  function prepareGeneration(criteria = {}) {
    const generation = buildGeneration(criteria, null);
    generation.status = generation.summary.errors ? "CON_ERRORES" : "PREPARADO";
    const saved = saveGenerationRecord(generation);
    adminService.addAuditLog({
      module: "ATS",
      action: "PREPARAR_ATS_PRELIMINAR",
      entityType: "ATS",
      entityId: saved.id,
      entityLabel: `${saved.year}-${saved.month}`,
      description: `Se preparo el ATS preliminar del periodo ${saved.year}-${saved.month}.`,
      after: {
        status: saved.status,
        errors: saved.summary?.errors || 0,
        warnings: saved.summary?.warnings || 0
      }
    });
    return saved;
  }

  function revalidateGeneration(generationId) {
    const current = findGenerationById(generationId);
    if (!current) return { ok: false, message: "No se encontro la generacion ATS." };
    const refreshed = buildGeneration(current.criteria || {}, current);
    const saved = saveGenerationRecord(refreshed);
    adminService.addAuditLog({
      module: "ATS",
      action: "VALIDAR_ATS_PRELIMINAR",
      entityType: "ATS",
      entityId: saved.id,
      entityLabel: `${saved.year}-${saved.month}`,
      description: `Se revalido el ATS preliminar del periodo ${saved.year}-${saved.month}.`,
      after: {
        status: saved.status,
        errors: saved.summary?.errors || 0,
        warnings: saved.summary?.warnings || 0
      }
    });
    return { ok: true, generation: saved };
  }

  function updateValidationStatus(generationId, validationId, status, justification = "") {
    const generation = findGenerationById(generationId);
    if (!generation) return { ok: false, message: "No se encontro la generacion ATS." };
    if (!validationStatuses.includes(status)) return { ok: false, message: "Estado de validacion no permitido." };
    generation.validations = (generation.validations || []).map(item => item.id === validationId
      ? { ...item, status, justification: status === "ignorado" ? justification : "" }
      : item
    );
    generation.summary = buildSummary(generation.dataset, generation.validations);
    if (generation.summary.errors) generation.status = "CON_ERRORES";
    return { ok: true, generation: saveGenerationRecord(generation) };
  }

  function canMarkGenerated(generation) {
    const blockingErrors = (generation.validations || []).filter(item => item.severity === "error" && item.status !== "corregido");
    if (blockingErrors.length) return { ok: false, message: "No se puede preparar el XML preliminar ATS mientras existan errores criticos." };
    const pendingWarnings = (generation.validations || []).filter(item => item.severity === "warning" && item.status === "pendiente");
    if (pendingWarnings.length) return { ok: false, message: "Hay advertencias pendientes. Corrigelas o justificalas antes de marcar el XML preliminar como generado." };
    return { ok: true };
  }

  function markGenerated(generationId) {
    const generation = findGenerationById(generationId);
    if (!generation) return { ok: false, message: "No se encontro la generacion ATS." };
    const validation = canMarkGenerated(generation);
    if (!validation.ok) return validation;
    generation.preview = {
      xml: buildXmlPreview(generation),
      json: buildJsonPreview(generation)
    };
    generation.status = "GENERADO";
    generation.generatedAt = new Date().toISOString();
    const saved = saveGenerationRecord(generation);
    adminService.addAuditLog({
      module: "ATS",
      action: "GENERAR_XML_PRELIMINAR_ATS",
      entityType: "ATS",
      entityId: saved.id,
      entityLabel: `${saved.year}-${saved.month}`,
      description: `Se genero el XML preliminar ATS del periodo ${saved.year}-${saved.month}.`,
      before: {
        status: "VALIDADO"
      },
      after: {
        status: saved.status,
        generatedAt: saved.generatedAt
      }
    });
    return { ok: true, generation: saved };
  }

  function annulGeneration(generationId, reason = "") {
    const generation = findGenerationById(generationId);
    if (!generation) return { ok: false, message: "No se encontro la generacion ATS." };
    const previousStatus = generation.status;
    generation.status = "ANULADO";
    generation.annulledAt = new Date().toISOString();
    generation.annulReason = String(reason || "").trim();
    const saved = saveGenerationRecord(generation);
    adminService.addAuditLog({
      module: "ATS",
      action: "ANULAR_ATS_PRELIMINAR",
      entityType: "ATS",
      entityId: saved.id,
      entityLabel: `${saved.year}-${saved.month}`,
      description: `Se anulo el ATS preliminar del periodo ${saved.year}-${saved.month}.`,
      before: {
        status: previousStatus
      },
      after: {
        status: saved.status,
        reason: saved.annulReason
      }
    });
    return { ok: true, generation: saved };
  }

  function exportPayload(generationId, type = "xml") {
    const generation = findGenerationById(generationId);
    if (!generation) return { ok: false, message: "No se encontro la generacion ATS." };
    if (type === "json") {
      return { ok: true, filename: `ATS-PRELIMINAR-${generation.year}-${generation.month}.json`, mime: "application/json", content: generation.preview?.json || buildJsonPreview(generation) };
    }
    if (type === "review") {
      const content = [
        "Tipo,Documento,Descripcion,Estado,Sugerencia",
        ...(generation.validations || []).map(item => [
          item.severity,
          `"${String(item.documentLabel || "").replace(/"/g, '""')}"`,
          `"${String(item.description || "").replace(/"/g, '""')}"`,
          item.status,
          `"${String(item.suggestedAction || "").replace(/"/g, '""')}"`
        ].join(","))
      ].join("\n");
      return { ok: true, filename: `ATS-REVISION-PRELIMINAR-${generation.year}-${generation.month}.csv`, mime: "text/csv;charset=utf-8", content };
    }
    return { ok: true, filename: `ATS-PRELIMINAR-${generation.year}-${generation.month}.xml`, mime: "application/xml", content: generation.preview?.xml || buildXmlPreview(generation) };
  }

  function ensureDemoGeneration() {
    ensureStore();
    const rows = stateApi.state.db.atsHistory || [];
    const exists = rows.some(item => item.period === "2026-06" && item.sourceMode === "demo-junio");
    if (exists) return;
    const seeded = buildGeneration({
      year: "2026",
      month: "06",
      periodicity: "mensual",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30"
    });
    seeded.status = "BORRADOR";
    seeded.createdAt = new Date().toISOString();
    seeded.validatedAt = "";
    saveGenerationRecord(seeded);
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.ats = {
    generationStates,
    validationStatuses,
    periodicities,
    tabs: atsTabs,
    config,
    saveConfig,
    history,
    findGenerationById,
    prepareGeneration,
    revalidateGeneration,
    updateValidationStatus,
    markGenerated,
    annulGeneration,
    exportPayload,
    buildAtsStructure,
    buildXmlPreview,
    buildJsonPreview,
    resolveFilters
  };
})();
