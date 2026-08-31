(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { clone, today } = BlessERP.utils;

  const TEMPLATE_HEADERS = Object.freeze([
    "TIPO",
    "IDENTIFICACION",
    "NOMBRE",
    "NUMERO_DOCUMENTO",
    "FECHA_EMISION",
    "FECHA_VENCIMIENTO",
    "SALDO_INICIAL",
    "CUENTA_CONTRAPARTIDA",
    "OBSERVACION"
  ]);

  const HEADER_ALIASES = Object.freeze({
    TIPO: ["TIPO", "TIPO_CARTERA", "CARTERA"],
    IDENTIFICACION: ["IDENTIFICACION", "RUC", "CEDULA", "TAX_ID", "ID_CLIENTE", "ID_PROVEEDOR"],
    NOMBRE: ["NOMBRE", "RAZON_SOCIAL", "CLIENTE", "PROVEEDOR"],
    NUMERO_DOCUMENTO: ["NUMERO_DOCUMENTO", "DOCUMENTO", "NUM_FACTURA", "NUMERO_FACTURA"],
    FECHA_EMISION: ["FECHA_EMISION", "FECHA", "ISSUE_DATE"],
    FECHA_VENCIMIENTO: ["FECHA_VENCIMIENTO", "VENCIMIENTO", "DUE_DATE"],
    SALDO_INICIAL: ["SALDO_INICIAL", "SALDO", "VALOR", "TOTAL"],
    CUENTA_CONTRAPARTIDA: ["CUENTA_CONTRAPARTIDA", "CONTRAPARTIDA", "CUENTA_APERTURA", "CUENTA_CONTABLE"],
    OBSERVACION: ["OBSERVACION", "NOTA", "DETALLE"]
  });

  function normalizeHeader(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function headerKey(value) {
    const normalized = normalizeHeader(value);
    return Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || "";
  }

  function normalizeKind(value, fallback = "") {
    const normalized = normalizeHeader(value);
    if (["CXC", "CUENTAS_POR_COBRAR", "COBRAR", "CLIENTE", "CLIENTES"].includes(normalized)) return "CXC";
    if (["CXP", "CUENTAS_POR_PAGAR", "PAGAR", "PROVEEDOR", "PROVEEDORES"].includes(normalized)) return "CXP";
    return String(fallback || "").toUpperCase();
  }

  function normalizeIdentity(value) {
    return String(value ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  }

  function numberValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let text = String(value ?? "").trim().replace(/\s|\$/g, "");
    if (!text) return NaN;
    if (text.includes(",") && text.includes(".")) {
      text = text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
  }

  function normalizeDate(value) {
    if (typeof value === "number" || /^\d{5}(?:\.\d+)?$/.test(String(value || "").trim())) {
      const serial = Number(value);
      if (!Number.isFinite(serial) || serial < 1) return "";
      return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)).toISOString().slice(0, 10);
    }
    const text = String(value || "").trim();
    let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
    return "";
  }

  function tableToRecords(table, options = {}) {
    const rows = Array.isArray(table) ? table : [];
    const kindFilter = normalizeKind(options.kind);
    if (!rows.length) return { records: [], errors: ["El archivo no contiene filas."] };
    const headerIndex = rows.findIndex(row => (row || []).some(cell => headerKey(cell)));
    if (headerIndex < 0) return { records: [], errors: ["No se encontro la fila de encabezados de la plantilla."] };
    const headerMap = {};
    (rows[headerIndex] || []).forEach((header, index) => {
      const key = headerKey(header);
      if (key && headerMap[key] === undefined) headerMap[key] = index;
    });
    const required = ["IDENTIFICACION", "NOMBRE", "NUMERO_DOCUMENTO", "FECHA_EMISION", "SALDO_INICIAL", "CUENTA_CONTRAPARTIDA"];
    const missing = required.filter(key => headerMap[key] === undefined);
    if (missing.length) return { records: [], errors: [`Faltan columnas obligatorias: ${missing.join(", ")}.`] };

    const records = [];
    const errors = [];
    const seen = new Set();
    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const rowNumber = headerIndex + offset + 2;
      const values = row || [];
      if (!values.some(value => String(value ?? "").trim())) return;
      const raw = key => headerMap[key] === undefined ? "" : values[headerMap[key]] ?? "";
      const kind = normalizeKind(raw("TIPO"), kindFilter);
      if (kindFilter && kind && kind !== kindFilter) return;
      const identity = normalizeIdentity(raw("IDENTIFICACION"));
      const name = String(raw("NOMBRE") || "").trim();
      const documentNumber = String(raw("NUMERO_DOCUMENTO") ?? "").trim().toUpperCase();
      const issueDate = normalizeDate(raw("FECHA_EMISION"));
      const dueDate = normalizeDate(raw("FECHA_VENCIMIENTO")) || issueDate;
      const openingBalance = numberValue(raw("SALDO_INICIAL"));
      const counterAccountCode = String(raw("CUENTA_CONTRAPARTIDA") || "").trim();
      const observation = String(raw("OBSERVACION") || "").trim();
      const rowErrors = [];
      if (!kind || !["CXC", "CXP"].includes(kind)) rowErrors.push("tipo debe ser CXC o CXP");
      if (!identity) rowErrors.push("identificacion vacia");
      if (!name) rowErrors.push("nombre vacio");
      if (!documentNumber) rowErrors.push("numero de documento vacio");
      if (!issueDate) rowErrors.push("fecha de emision invalida");
      if (!Number.isFinite(openingBalance) || openingBalance <= 0) rowErrors.push("saldo inicial debe ser mayor que cero");
      if (!counterAccountCode) rowErrors.push("cuenta contrapartida vacia");
      const uniqueKey = `${kind}|${identity}|${documentNumber}`;
      if (seen.has(uniqueKey)) rowErrors.push("documento repetido dentro del archivo");
      if (rowErrors.length) {
        errors.push(`Fila ${rowNumber}: ${rowErrors.join("; ")}.`);
        return;
      }
      seen.add(uniqueKey);
      records.push({ kind, identity, name, documentNumber, issueDate, dueDate, openingBalance, counterAccountCode, observation, rowNumber });
    });
    if (!records.length && !errors.length) errors.push(`La hoja no contiene saldos ${kindFilter || "CXC/CXP"} para importar.`);
    return { records, errors, headerRowNumber: headerIndex + 1 };
  }

  function templateSheets() {
    return [
      {
        name: "SALDOS",
        title: "PLANTILLA MASIVA DE SALDOS INICIALES",
        widths: [12, 22, 42, 26, 18, 20, 18, 25, 48],
        headers: [...TEMPLATE_HEADERS],
        rows: Array.from({ length: 300 }, () => Array(TEMPLATE_HEADERS.length).fill(""))
      },
      {
        name: "EJEMPLOS",
        title: "EJEMPLOS - NO IMPORTAR ESTA HOJA",
        widths: [12, 22, 42, 26, 18, 20, 18, 25, 48],
        headers: [...TEMPLATE_HEADERS],
        rows: [
          ["CXC", "1700000001", "CLIENTE DE EJEMPLO", "FAC-ANT-0001", "2026-01-01", "2026-01-31", 1250.50, "3.2.01", "Saldo pendiente anterior"],
          ["CXP", "1700000002", "PROVEEDOR DE EJEMPLO", "001-001-000000123", "2026-01-01", "2026-02-01", 780.25, "3.2.01", "Saldo pendiente anterior"]
        ]
      },
      {
        name: "INSTRUCCIONES",
        title: "INSTRUCCIONES DE IMPORTACION",
        widths: [28, 90],
        headers: ["CAMPO", "REGLA"],
        rows: [
          ["TIPO", "Use CXC para cuentas por cobrar o CXP para cuentas por pagar."],
          ["IDENTIFICACION", "RUC, cedula o identificacion del cliente/proveedor. Evita duplicar auxiliares."],
          ["NOMBRE", "Razon social o nombres completos. Si no existe, el sistema crea el cliente/proveedor."],
          ["NUMERO_DOCUMENTO", "Obligatorio. Conserve prefijos, guiones y ceros; se valida por auxiliar."],
          ["FECHA_EMISION", "Obligatoria. Use AAAA-MM-DD o DD/MM/AAAA."],
          ["FECHA_VENCIMIENTO", "Opcional. Si queda vacia se usa la fecha de emision."],
          ["SALDO_INICIAL", "Obligatorio y mayor que cero. Use valor positivo con dos decimales."],
          ["CUENTA_CONTRAPARTIDA", "Cuenta de movimiento activa para el asiento de apertura. CXC/CXP usa la cuenta predeterminada de la empresa."],
          ["OBSERVACION", "Opcional. Nota de origen o corte del saldo."],
          ["CONTABILIZACION", "La importacion valida todas las filas y contabiliza cada saldo. Si una fila falla, se revierte el lote local completo."],
          ["IMPORTANTE", "No repita el mismo numero de documento para la misma identificacion y tipo de cartera."]
        ]
      }
    ];
  }

  function downloadArchive(archive, fileName) {
    const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  }

  async function generateTemplate(options = {}) {
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) return { ok: false, errors: ["El generador XLSX compartido no esta disponible."] };
    const logoBytes = options.logoBytes || await BlessERP.reportFinancialXlsx?.companyLogoBytes?.().catch(() => undefined);
    const archive = workbookApi.buildWorkbookArchive(templateSheets(), {
      period: "PLANTILLA",
      range: "CUENTAS POR COBRAR Y CUENTAS POR PAGAR",
      from: "",
      to: today()
    }, logoBytes);
    const fileName = "plantilla-saldos-iniciales-cxc-cxp.xlsx";
    if (options.download !== false) downloadArchive(archive, fileName);
    return { ok: true, archive, fileName };
  }

  function movementAccountError(accountCode) {
    const account = BlessERP.services.chartOfAccounts.findByCode(accountCode);
    if (!account) return `La cuenta ${accountCode} no existe.`;
    if (account.status !== "Activa") return `La cuenta ${accountCode} esta inactiva.`;
    if (!account.isMovement) return `La cuenta ${accountCode} no es de movimiento.`;
    return "";
  }

  function validateBusinessRecords(records, kind) {
    const errors = [];
    const receivableService = BlessERP.services.receivables;
    const purchaseService = BlessERP.services.purchases;
    const settings = BlessERP.services.companySettings.settings();
    const defaultCode = kind === "CXC"
      ? settings.defaultAccounts?.accountsReceivableCustomers
      : settings.defaultAccounts?.accountsPayableSuppliers;
    const defaultError = defaultCode ? movementAccountError(defaultCode) : `No existe cuenta predeterminada para ${kind}.`;
    if (defaultError) errors.push(defaultError);
    records.forEach(record => {
      const accountError = movementAccountError(record.counterAccountCode);
      if (accountError) errors.push(`Fila ${record.rowNumber}: ${accountError}`);
      if (kind === "CXC") {
        const customer = receivableService.findCustomerByTaxId(record.identity);
        if (customer?.status !== undefined && customer.status !== "activo") errors.push(`Fila ${record.rowNumber}: el cliente esta inactivo.`);
        if (receivableService.receivableDocuments().some(item =>
          normalizeIdentity(item.customerTaxId) === record.identity
          && String(item.documentNumber || "").trim().toUpperCase() === record.documentNumber
        )) {
          errors.push(`Fila ${record.rowNumber}: el documento ${record.documentNumber} ya existe para el cliente.`);
        }
      } else {
        const provider = BlessERP.services.portfolios.findProviderByTaxId(record.identity);
        if (provider?.status !== undefined && provider.status !== "activo") errors.push(`Fila ${record.rowNumber}: el proveedor esta inactivo.`);
        if (purchaseService.purchases().some(item =>
          normalizeIdentity(item.supplierRuc) === record.identity
          && item.voucherType === "saldo_inicial"
          && String(item.documentNumber || "").trim().toUpperCase() === record.documentNumber
        )) {
          errors.push(`Fila ${record.rowNumber}: el documento ${record.documentNumber} ya existe para el proveedor.`);
        }
      }
    });
    return [...new Set(errors)];
  }

  function snapshotKeys(keys) {
    const db = BlessERP.state.state.db;
    return Object.fromEntries(keys.map(key => [key, { exists: Object.prototype.hasOwnProperty.call(db, key), value: clone(db[key]) }]));
  }

  function restoreSnapshot(snapshot) {
    const db = BlessERP.state.state.db;
    Object.entries(snapshot).forEach(([key, item]) => {
      if (item.exists) db[key] = clone(item.value);
      else delete db[key];
    });
    BlessERP.state.saveDb();
  }

  async function importReceivable(record, fileName) {
    const service = BlessERP.services.receivables;
    let customer = service.findCustomerByTaxId(record.identity);
    if (!customer) {
      const created = service.saveCustomer({
        taxId: record.identity,
        name: record.name,
        commercialName: record.name,
        customerType: "otro",
        country: "Ecuador",
        status: "activo",
        observation: `Creado desde plantilla de saldos iniciales ${fileName}.`
      });
      if (!created.ok) throw new Error(created.errors?.join(" ") || `No se pudo crear el cliente de la fila ${record.rowNumber}.`);
      customer = created.customer;
    }
    const candidate = {
      ...service.emptyReceivable(customer.id),
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      documentType: "saldo inicial",
      documentNumber: record.documentNumber,
      issueDate: record.issueDate,
      dueDate: record.dueDate,
      concept: `Saldo inicial ${record.documentNumber}`,
      total: record.openingBalance,
      counterAccountCode: record.counterAccountCode,
      observation: [record.observation, `Importado desde ${fileName}.`].filter(Boolean).join(" "),
      source: "SALDO_INICIAL_XLSX"
    };
    const saved = service.saveReceivable(candidate);
    if (!saved.ok) throw new Error(saved.errors?.join(" ") || `No se pudo guardar la fila ${record.rowNumber}.`);
    const posted = await service.postReceivableV2(saved.receivable.id, {
      sourceType: "OPENING_BALANCE",
      sourceId: saved.receivable.id,
      eventType: "POST_OPENING_BALANCE"
    });
    if (!posted.ok) throw new Error(posted.errors?.join(" ") || `No se pudo contabilizar la fila ${record.rowNumber}.`);
    return posted.receivable;
  }

  function importPayable(record, fileName) {
    const portfolioService = BlessERP.services.portfolios;
    const purchaseService = BlessERP.services.purchases;
    let provider = portfolioService.findProviderByTaxId(record.identity);
    if (!provider) {
      const created = portfolioService.saveProvider({
        taxId: record.identity,
        name: record.name,
        commercialName: record.name,
        providerType: "otros",
        status: "activo",
        createdSource: "SALDO_INICIAL_XLSX",
        observation: `Creado desde plantilla de saldos iniciales ${fileName}.`
      });
      if (!created.ok) throw new Error(created.errors?.join(" ") || `No se pudo crear el proveedor de la fila ${record.rowNumber}.`);
      provider = created.provider;
    }
    const line = {
      ...purchaseService.emptyLine(),
      description: `Saldo inicial ${record.documentNumber}`,
      quantity: 1,
      unitPrice: record.openingBalance,
      discount: 0,
      taxableBase: record.openingBalance,
      vatRate: 0,
      vatCode: "0",
      vatCategory: "TARIFA",
      vatValue: 0,
      totalLine: record.openingBalance,
      accountCode: record.counterAccountCode,
      lineType: "gasto",
      suggestionMode: "Manual"
    };
    const candidate = {
      ...purchaseService.emptyPurchase(),
      source: "SALDO_INICIAL_XLSX",
      supplierId: provider.id,
      supplierName: provider.name,
      supplierRuc: provider.taxId,
      issueDate: record.issueDate,
      accountingDate: record.issueDate,
      dueDate: record.dueDate,
      voucherType: "saldo_inicial",
      externalDocumentNumber: record.documentNumber,
      taxSupportCode: "",
      purchaseType: "GASTO",
      settlementMode: "CXP",
      observation: [record.observation, `Importado desde ${fileName}.`].filter(Boolean).join(" "),
      retentionDecision: "PENDIENTE",
      retentionStatus: "No emite retencion",
      lines: [line]
    };
    const saved = purchaseService.savePurchase(candidate);
    if (!saved.ok) throw new Error(saved.errors?.join(" ") || `No se pudo guardar la fila ${record.rowNumber}.`);
    const posted = purchaseService.postPurchase(saved.purchase.id);
    if (!posted.ok) throw new Error(posted.errors?.join(" ") || `No se pudo contabilizar la fila ${record.rowNumber}.`);
    return posted.purchase;
  }

  async function importFile(file, options = {}) {
    const kind = normalizeKind(options.kind);
    if (!kind) return { ok: false, errors: ["Debe indicar si la importacion corresponde a CXC o CXP."] };
    const reader = BlessERP.services.bankStatementXlsx?.readWorkbookTable;
    if (!reader) return { ok: false, errors: ["El lector XLSX compartido no esta disponible."] };
    try {
      const parsed = tableToRecords(await reader(file), { kind });
      if (parsed.errors.length) return { ok: false, ...parsed };
      const errors = validateBusinessRecords(parsed.records, kind);
      if (errors.length) return { ok: false, records: parsed.records, errors };
      const snapshot = snapshotKeys(["customers", "customerReceivables", "providers", "purchases", "purchasePayables", "journalEntries", "auditLogs"]);
      try {
        const imported = [];
        for (const record of parsed.records) {
          imported.push(kind === "CXC"
            ? await importReceivable(record, file.name || "plantilla.xlsx")
            : importPayable(record, file.name || "plantilla.xlsx"));
        }
        return { ok: true, kind, imported, count: imported.length, errors: [] };
      } catch (error) {
        restoreSnapshot(snapshot);
        return { ok: false, records: parsed.records, errors: [`No se importo ningun saldo. ${error.message || "El lote no pudo contabilizarse."}`] };
      }
    } catch (error) {
      return { ok: false, records: [], errors: [error.message || "No se pudo leer el archivo XLSX."] };
    }
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.openingBalancesXlsx = {
    TEMPLATE_HEADERS,
    normalizeHeader,
    normalizeDate,
    tableToRecords,
    templateSheets,
    generateTemplate,
    validateBusinessRecords,
    importFile
  };
})();
