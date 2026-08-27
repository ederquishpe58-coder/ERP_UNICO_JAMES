(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function text(value) {
    return { xlsxType: "text", value: String(value ?? "") };
  }

  function currency(value) {
    return { xlsxType: "currency", value: Number(value || 0) };
  }

  function date(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return value || "";
    const milliseconds = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return { xlsxType: "date", value: (milliseconds / 86400000) + 25569 };
  }

  function activeState() {
    return BlessERP.state?.state;
  }

  function identity() {
    return BlessERP.services?.companyBranding?.resolve?.()
      || BlessERP.services?.companyContext?.activeCompany?.()
      || {};
  }

  function reportMeta(filters = {}, title = "") {
    const company = identity();
    const period = BlessERP.operacionesRamosReportXlsx?.reportPeriod?.(
      filters.dateFrom || "",
      filters.dateTo || ""
    ) || {
      period: filters.period ? `PERIODO ${filters.period}` : "PERIODO SIN DEFINIR",
      range: [filters.dateFrom, filters.dateTo].filter(Boolean).join(" - ") || "RANGO SIN DEFINIR"
    };
    return {
      companyId: company.id || company.companyId || "",
      identity: company,
      title,
      from: filters.dateFrom || "",
      to: filters.dateTo || "",
      ...period
    };
  }

  function slug(value) {
    return String(value || "empresa")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  function dataUrlBytes(value) {
    const match = String(value || "").match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match) return null;
    return Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
  }

  const logoBytesCache = new Map();
  const LOGO_LOAD_TIMEOUT_MS = 1800;

  function nextPaint() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(resolve, 0));
        return;
      }
      setTimeout(resolve, 0);
    });
  }

  async function imagePathToPngBytes(path) {
    if (!path || typeof document === "undefined") return null;
    const direct = dataUrlBytes(path);
    if (direct) return direct;
    const url = new URL(path, document.baseURI).href;
    if (!url.startsWith("file:") && typeof fetch === "function") {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = setTimeout(() => controller?.abort(), LOGO_LOAD_TIMEOUT_MS);
      try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type === "image/png") return new Uint8Array(await blob.arrayBuffer());
        }
      } catch (error) {
        void error;
      } finally {
        clearTimeout(timeout);
      }
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(
        () => finish(reject)(new Error("El logo excedio el tiempo de carga y el XLSX continuara con el respaldo.")),
        LOGO_LOAD_TIMEOUT_MS
      );
      image.onload = () => {
        try {
          const sourceWidth = Math.max(1, image.naturalWidth || image.width || 600);
          const sourceHeight = Math.max(1, image.naturalHeight || image.height || 180);
          const scale = Math.min(1, 720 / sourceWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sourceWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceHeight * scale));
          const context = canvas.getContext("2d");
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/png").split(",")[1];
          finish(resolve)(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
        } catch (error) {
          finish(reject)(error);
        }
      };
      image.onerror = () => finish(reject)(new Error("No se pudo convertir el logo de la empresa para Excel."));
      image.src = url;
    });
  }

  async function companyLogoBytes() {
    const company = identity();
    const logoPath = company.logoDataUrl || company.logoPath || "";
    const cacheKey = `${company.id || company.companyId || "empresa"}|${logoPath}`;
    if (!logoBytesCache.has(cacheKey)) {
      logoBytesCache.set(cacheKey, imagePathToPngBytes(logoPath).catch(() => null));
    }
    return logoBytesCache.get(cacheKey);
  }

  function totals(values, fields) {
    return fields.reduce((result, field) => {
      result[field] = values.reduce((sum, row) => sum + Number(row[field] || 0), 0);
      return result;
    }, {});
  }

  function financialSignatureRows(company = {}) {
    const representative = company.legalRepresentative || company.representativeName || company.legalName || "";
    const accountant = company.accountantName || company.contadorName || "";
    return [
      ["", "", ""],
      ["____________________________", "", "____________________________"],
      [representative, "", accountant],
      ["FIRMA REPRESENTANTE LEGAL", "", "FIRMA CONTADOR"]
    ];
  }

  function trialBalanceSheet(report, company) {
    return {
      name: "Balance comprobacion",
      title: `${company.commercialName || company.legalName} - BALANCE DE COMPROBACION`,
      widths: [16, 40, 18, 18, 18, 18, 18, 18],
      headers: ["Codigo", "Cuenta", "Saldo inicial", "Debe", "Haber", "Saldo deudor", "Saldo acreedor", "Saldo final"],
      rows: report.rows.map(row => [
        text(row.code), row.name, currency(row.initialSigned), currency(row.debit), currency(row.credit),
        currency(row.saldoDeudor), currency(row.saldoAcreedor), currency(row.finalSigned)
      ]),
      totals: ["TOTAL", "", "", currency(report.totals.debit), currency(report.totals.credit), "", "", currency(report.totals.difference)]
    };
  }

  function incomeStatementSheet(report, company) {
    const rows = [];
    report.sections.forEach(section => {
      rows.push([section.label.toUpperCase(), "", ""]);
      section.rows.forEach(row => rows.push([text(row.code), row.name, currency(row.finalSigned)]));
      rows.push([`TOTAL ${section.label.toUpperCase()}`, "", currency(section.total)]);
    });
    rows.push(["RESULTADO DEL PERIODO", "", currency(report.resultPeriod)]);
    return {
      name: "Estado resultados",
      title: `${company.commercialName || company.legalName} - ESTADO DE RESULTADOS`,
      widths: [20, 52, 22],
      headers: ["Codigo", "Cuenta", "Saldo USD"],
      rows,
      totals: ["RESULTADO", "", currency(report.resultPeriod)],
      footerRows: financialSignatureRows(company),
      orientation: "portrait"
    };
  }

  function balanceSheetSheet(report, company) {
    const rows = [];
    report.sections.forEach(section => {
      rows.push([section.label.toUpperCase(), "", ""]);
      section.rows.forEach(row => rows.push([text(row.code), row.name, currency(row.finalSigned)]));
      rows.push([`TOTAL ${section.label.toUpperCase()}`, "", currency(section.total)]);
    });
    rows.push(["RESULTADO DEL PERIODO", "", currency(report.resultPeriod)]);
    rows.push(["PATRIMONIO + RESULTADO", "", currency(report.patrimonyWithResult)]);
    return {
      name: "Balance general",
      title: `${company.commercialName || company.legalName} - BALANCE GENERAL`,
      widths: [20, 52, 22],
      headers: ["Codigo", "Cuenta", "Saldo USD"],
      rows,
      totals: ["DIFERENCIA DE CONTROL", "", currency(report.validation?.difference || 0)],
      footerRows: financialSignatureRows(company),
      orientation: "portrait"
    };
  }

  function accountLedgerSheet(report, company) {
    if (!report.ledger) throw new Error("Seleccione una cuenta contable antes de descargar el mayor.");
    const ledger = report.ledger;
    return {
      name: `Mayor ${ledger.account.code}`,
      title: `${company.commercialName || company.legalName} - MAYOR ${ledger.account.code} ${ledger.account.name}`,
      widths: [16, 18, 42, 22, 18, 18, 18, 24],
      headers: ["Fecha", "Asiento", "Concepto", "Documento", "Debe", "Haber", "Saldo", "Modulo"],
      rows: [
        ["", "", "SALDO INICIAL", "", "", "", currency(ledger.initialBalance), ""],
        ...ledger.rows.map(row => [
          date(row.date), text(row.entryNumber), row.concept, text(row.sourceDocument || ""),
          currency(row.debit), currency(row.credit), currency(row.balance), row.originModule
        ])
      ],
      totals: ["TOTAL", "", "", "", currency(ledger.totals.debit), currency(ledger.totals.credit), currency(ledger.finalBalance), ""]
    };
  }

  function generalLedgerSheets(report, company) {
    const summary = {
      name: "Resumen mayores",
      title: `${company.commercialName || company.legalName} - MAYOR GENERAL`,
      widths: [18, 45, 18, 18, 18, 18],
      headers: ["Codigo", "Cuenta", "Saldo inicial", "Debe", "Haber", "Saldo final"],
      rows: report.ledgers.map(ledger => [
        text(ledger.account.code), ledger.account.name, currency(ledger.initialBalance),
        currency(ledger.totals.debit), currency(ledger.totals.credit), currency(ledger.finalBalance)
      ]),
      totals: ["TOTAL", "", "", currency(report.totals.debit), currency(report.totals.credit), ""]
    };
    return [
      summary,
      ...report.ledgers.map(ledger => ({
        name: ledger.account.code,
        title: `${company.commercialName || company.legalName} - ${ledger.account.code} ${ledger.account.name}`,
        widths: [16, 18, 42, 22, 18, 18, 18, 24],
        headers: ["Fecha", "Asiento", "Concepto", "Documento", "Debe", "Haber", "Saldo", "Modulo"],
        rows: [
          ["", "", "SALDO INICIAL", "", "", "", currency(ledger.initialBalance), ""],
          ...ledger.rows.map(row => [
            date(row.date), text(row.entryNumber), row.concept, text(row.sourceDocument || ""),
            currency(row.debit), currency(row.credit), currency(row.balance), row.originModule
          ])
        ],
        totals: ["TOTAL", "", "", "", currency(ledger.totals.debit), currency(ledger.totals.credit), currency(ledger.finalBalance), ""]
      }))
    ];
  }

  function purchasesSheet(report, company) {
    return {
      name: "Compras",
      title: `${company.commercialName || company.legalName} - REPORTE DE COMPRAS`,
      widths: [15, 15, 34, 18, 22, 24, 14, 18, 18, 18, 18, 18, 18, 18, 18, 16],
      headers: [
        "Fecha emision", "Fecha contable", "Proveedor", "RUC", "Documento", "Autorizacion", "Sustento",
        "Base 0%", "Base IVA", "IVA", "No objeto", "Exento", "Total", "Ret. renta", "Ret. IVA", "Estado"
      ],
      rows: report.rows.map(row => [
        date(row.issueDate), date(row.accountingDate), row.supplierName, text(row.supplierRuc),
        text(row.documentNumber), text(row.authorizationNumber), text(row.taxSupportCode),
        currency(row.base0), currency(row.baseIva), currency(row.iva), currency(row.noVatBase),
        currency(row.exemptBase), currency(row.total), currency(row.retentionRent), currency(row.retentionVat), row.status
      ]),
      totals: [
        "TOTAL", "", "", "", "", "", "", currency(report.totals.base0), currency(report.totals.baseIva),
        currency(report.totals.iva), currency(report.totals.noVatBase), currency(report.totals.exemptBase),
        currency(report.totals.total), currency(report.totals.retentionRent), currency(report.totals.retentionVat), ""
      ]
    };
  }

  function salesSheet(report, company) {
    return {
      name: "Ventas",
      title: `${company.commercialName || company.legalName} - REPORTE DE VENTAS AUTORIZADAS`,
      widths: [15, 15, 22, 24, 24, 34, 18, 26, 20, 18, 18, 18, 18, 18, 16, 16, 16, 18, 18, 18, 18, 24, 16],
      headers: [
        "Fecha emision", "Fecha autorizacion", "Factura", "Autorizacion", "Clave acceso", "Cliente", "Identificacion",
        "Marca / cliente final", "Destino", "Pais", "Transporte", "Incoterm", "DAE", "Guias", "Cajas", "Fulls", "Ramos",
        "Tallos", "Subtotal", "Total", "Notas credito", "Venta neta", "Vendedor"
      ],
      rows: report.rows.map(row => [
        date(row.issueDate), date(row.authorizationDate), text(row.documentNumber), text(row.authorizationNumber),
        text(row.accessKey), row.customerName, text(row.customerTaxId), row.brandName, row.destination, row.country,
        row.transportType, row.incoterm, text(row.dae), text(row.guides), row.boxes, row.fulls, row.bunches, row.stems,
        currency(row.subtotal), currency(row.total), currency(row.credited), currency(row.netTotal), row.seller
      ]),
      totals: [
        "TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", report.totals.boxes, report.totals.fulls,
        report.totals.bunches, report.totals.stems, currency(report.totals.subtotal), currency(report.totals.total),
        currency(report.totals.credited), currency(report.totals.netTotal), ""
      ]
    };
  }

  const portfolioScopeView = Object.freeze({
    "payables-report": "payables",
    "receivables-report": "receivables",
    "supplier-payments": "payments",
    "customer-collections": "collections"
  });
  const bankScopeView = Object.freeze({
    "bank-movements": "movements",
    "bank-balances": "balances",
    "bank-reconciliations": "reconciliations"
  });

  function portfolioSummarySheet(data, company) {
    const summary = data.summary || {};
    const labels = data.view === "payables"
      ? [["Documentos", data.total], ["Saldo", summary.totalBalance], ["Vencido", summary.totalOverdue], ["Por vencer", summary.totalUpcoming], ["Pagado periodo", summary.totalPaidPeriod]]
      : data.view === "receivables"
        ? [["Documentos", data.total], ["Saldo", summary.totalBalance], ["Vencido", summary.totalOverdue], ["Por vencer", summary.totalUpcoming], ["Cobrado periodo", summary.totalCollectedPeriod]]
        : [["Aplicaciones", data.total], ["Valor", summary.totalValue], ["Confirmado", summary.confirmedValue]];
    return {
      name: "Resumen",
      title: `${company.commercialName || company.legalName} - RESUMEN DE CARTERA`,
      widths: [34, 22],
      headers: ["Indicador", "Valor"],
      rows: labels.map(([label, value], index) => [label, index === 0 ? Number(value || 0) : currency(value)])
    };
  }

  function portfolioDetailSheet(data, company) {
    if (data.view === "payables") return {
      name: "Cuentas por pagar",
      title: `${company.commercialName || company.legalName} - CUENTAS POR PAGAR`,
      widths: [16, 34, 22, 16, 16, 18, 18, 18, 18, 16, 14],
      headers: ["Fecha", "Proveedor", "Documento", "Vence", "Total", "Retencion", "Pagado", "Saldo", "Estado", "Dias vencidos", "Fuente"],
      rows: data.items.map(row => [date(row.issueDate), row.providerName, text(row.documentNumber), date(row.dueDate), currency(row.totalDocument), currency(row.retentionApplied), currency(row.paid), currency(row.balance), row.state, Number(row.overdueDays || 0), row.source])
    };
    if (data.view === "receivables") return {
      name: "Cuentas por cobrar",
      title: `${company.commercialName || company.legalName} - CUENTAS POR COBRAR`,
      widths: [16, 34, 22, 16, 16, 16, 16, 16, 18, 16, 14],
      headers: ["Fecha", "Cliente", "Documento", "Vence", "Total", "Retenido", "Cobrado", "Notas credito", "Saldo", "Estado", "Dias vencidos"],
      rows: data.items.map(row => [date(row.issueDate), row.customerName, text(row.documentNumber), date(row.dueDate), currency(row.total), currency(row.withheld), currency(row.collected), currency(row.credited), currency(row.balance), row.status, Number(row.overdueDays || 0)])
    };
    const isPayment = data.view === "payments";
    return {
      name: isPayment ? "Pagos proveedores" : "Cobros clientes",
      title: `${company.commercialName || company.legalName} - ${isPayment ? "PAGOS A PROVEEDORES" : "COBROS A CLIENTES"}`,
      widths: [16, 22, 34, 22, 24, 24, 18, 16, 18, 14],
      headers: ["Fecha", isPayment ? "Pago" : "Cobro", isPayment ? "Proveedor" : "Cliente", "Documento", "Metodo", "Cuenta", "Valor", "Estado", "Asiento", "Fuente"],
      rows: data.items.map(row => [date(row.date), text(isPayment ? row.paymentNumber : row.collectionNumber), isPayment ? row.providerName : row.customerName, text(row.documentNumber), isPayment ? row.paymentMethod : row.collectionMethod, isPayment ? row.paymentAccount : row.collectionAccount, currency(row.value), row.status, text(row.entryNumber), row.source])
    };
  }

  function validatePortfolioExport(data) {
    if (!data?.ok || Number(data.total || 0) !== (data.items || []).length) {
      throw new Error("La cantidad consultada de cartera no coincide con la exportación.");
    }
    const rows = data.items || [];
    const summary = data.summary || {};
    if (["payables", "receivables"].includes(data.view)) {
      const statusKey = data.view === "payables" ? "state" : "status";
      const pending = round2(rows.filter(row => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(String(row[statusKey] || "").toUpperCase())).reduce((sum, row) => sum + Number(row.balance || 0), 0));
      const overdue = round2(rows.filter(row => String(row[statusKey] || "").toUpperCase() === "VENCIDO").reduce((sum, row) => sum + Number(row.balance || 0), 0));
      const upcoming = round2(rows.filter(row => ["PENDIENTE", "PARCIAL"].includes(String(row[statusKey] || "").toUpperCase()) && Number(row.overdueDays || 0) === 0).reduce((sum, row) => sum + Number(row.balance || 0), 0));
      if (pending !== round2(summary.totalPending) || overdue !== round2(summary.totalOverdue) || upcoming !== round2(summary.totalUpcoming)) {
        throw new Error("El resumen de cartera consultado no coincide con el universo exportado.");
      }
    } else {
      const value = round2(rows.reduce((sum, row) => sum + Number(row.value || 0), 0));
      if (value !== round2(summary.totalValue)) throw new Error("El total de aplicaciones consultado no coincide con la exportación.");
    }
    return true;
  }

  function validateBankExport(data) {
    if (!data?.ok || Number(data.total || 0) !== (data.items || []).length) throw new Error("La cantidad consultada del reporte bancario no coincide con la exportación.");
    const rows = data.items || []; const summary = data.summary || {};
    if (data.view === "movements") {
      const income = round2(rows.reduce((sum, row) => sum + Number(row.incomeValue || 0), 0));
      const expense = round2(rows.reduce((sum, row) => sum + Number(row.expenseValue || 0), 0));
      if (income !== round2(summary.totalIncome) || expense !== round2(summary.totalExpense)) throw new Error("Ingresos/egresos consultados no coinciden con la exportación.");
    } else if (data.view === "balances") {
      const opening = round2(rows.reduce((sum, row) => sum + Number(row.openingBalance || 0), 0));
      const closing = round2(rows.reduce((sum, row) => sum + Number(row.currentBalance || 0), 0));
      if (opening !== round2(summary.openingBalance) || closing !== round2(summary.closingBalance)) throw new Error("Los saldos libros consultados no coinciden con la exportación.");
    } else {
      const difference = round2(rows.reduce((sum, row) => sum + Number(row.difference || 0), 0));
      if (difference !== round2(summary.totalDifference)) throw new Error("Las diferencias de conciliación no coinciden con la exportación.");
    }
    return true;
  }

  function bankSheets(data, company) {
    const summary = data.summary || {};
    const summaryRows = data.view === "movements"
      ? [["Movimientos", data.total], ["Saldo inicial libros", summary.openingBalance], ["Ingresos", summary.totalIncome], ["Egresos", summary.totalExpense], ["Saldo final libros", summary.closingBalance], ["Neto extracto", summary.realStatementNet]]
      : data.view === "balances"
        ? [["Cuentas", data.total], ["Saldo inicial libros", summary.openingBalance], ["Ingresos", summary.totalIncome], ["Egresos", summary.totalExpense], ["Saldo final libros", summary.closingBalance], ["Neto extracto", summary.realStatementNet]]
        : [["Conciliaciones", data.total], ["Cerradas", summary.closed], ["Abiertas", summary.open], ["Diferencia", summary.totalDifference]];
    const summarySheet = { name: "Resumen", title: `${company.commercialName || company.legalName} - RESUMEN BANCARIO`, widths: [34, 22], headers: ["Indicador", "Valor"], rows: summaryRows.map(([label, value], index) => [label, index === 0 ? Number(value || 0) : currency(value)]) };
    if (data.view === "movements") return [summarySheet, { name: "Movimientos", title: `${company.commercialName || company.legalName} - MOVIMIENTOS BANCARIOS`, widths: [16, 22, 32, 14, 22, 38, 18, 18, 18, 18, 18], headers: ["Fecha", "Movimiento", "Cuenta", "Tipo", "Referencia", "Concepto", "Ingreso", "Egreso", "Saldo libros", "Estado", "Origen"], rows: data.items.map(row => [date(row.movementDate), text(row.movementNumber), `${row.bankName} · ${row.bankAccountCode}`, row.movementType, text(row.reference), row.concept, currency(row.incomeValue), currency(row.expenseValue), currency(row.auxiliaryBalance), row.status, row.originModule]) }];
    if (data.view === "balances") return [summarySheet, { name: "Saldos", title: `${company.commercialName || company.legalName} - SALDOS LIBROS POR BANCO`, widths: [32, 20, 20, 18, 18, 18, 18, 18, 14], headers: ["Banco", "Cuenta", "Cuenta contable", "Saldo inicial", "Ingresos", "Egresos", "Saldo libros", "Neto extracto", "Estado"], rows: data.items.map(row => [row.bankName, text(row.code), text(row.linkedAccountCode), currency(row.openingBalance), currency(row.incomes), currency(row.expenses), currency(row.currentBalance), currency(row.realStatementNet), row.status]) }];
    return [summarySheet, { name: "Conciliaciones", title: `${company.commercialName || company.legalName} - CONCILIACIONES BANCARIAS`, widths: [22, 34, 25, 18, 18, 18, 16, 30], headers: ["Conciliación", "Cuenta", "Periodo", "Saldo banco", "Saldo libros", "Diferencia", "Estado", "Observaciones"], rows: data.items.map(row => [text(row.reconciliationNumber), row.bankAccount, row.period, currency(row.closingBankBalance), currency(row.systemBalance), currency(row.difference), row.status, row.notes]) }];
  }

  async function serverReportDefinition(scope) {
    const view = portfolioScopeView[scope];
    if (view) {
      const service = BlessERP.services?.accountingPortfolioReportV2;
      if (!service?.exportAll) throw new Error("Backend de reportes de cartera pendiente de actualización.");
      const data = await service.exportAll(view); validatePortfolioExport(data); const company = identity();
      return { report: data, sheets: [portfolioSummarySheet(data, company), portfolioDetailSheet(data, company)], label: ({ payables: "cuentas-por-pagar", receivables: "cuentas-por-cobrar", payments: "pagos-proveedores", collections: "cobros-clientes" })[view] };
    }
    const bankView = bankScopeView[scope];
    if (!bankView) return null;
    const service = BlessERP.services?.accountingBankReportV2;
    if (!service?.exportAll) throw new Error("Backend de reportes bancarios pendiente de actualización.");
    const data = await service.exportAll(bankView); validateBankExport(data); const company = identity();
    return { report: data, sheets: bankSheets(data, company), label: ({ movements: "movimientos-bancarios", balances: "saldos-bancarios", reconciliations: "conciliaciones-bancarias" })[bankView] };
  }

  function domValue(value) {
    const source = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!source) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return date(source);
    if (/^-?\$\s*[\d,.]+$/.test(source)) {
      return currency(Number(source.replace(/[^\d.-]/g, "").replace(/,/g, "")));
    }
    if (/^-?[\d,]+(?:\.\d+)?$/.test(source) && !/^0\d+/.test(source)) {
      return Number(source.replace(/,/g, ""));
    }
    return source;
  }

  function domReportDefinition(scope) {
    if (typeof document === "undefined") throw new Error("El reporte seleccionado no tiene exportacion XLSX configurada.");
    const root = document.querySelector("#page-root");
    if (!root) throw new Error("No se encontro el reporte visible para exportar.");
    const scopeLabels = {
      "dashboard-general": "resumen-reportes",
      "tax-supports": "compras-sustento",
      "tax-suppliers": "compras-proveedor",
      "issued-withholdings": "retenciones-emitidas",
      "received-withholdings": "retenciones-recibidas",
      "payables-report": "cuentas-por-pagar",
      "receivables-report": "cuentas-por-cobrar",
      "supplier-payments": "pagos-proveedores",
      "customer-collections": "cobros-clientes",
      "bank-movements": "movimientos-bancarios",
      "bank-balances": "saldos-bancarios",
      "bank-reconciliations": "conciliaciones-bancarias",
      "inventory-stock": "inventario-stock",
      "inventory-kardex": "inventario-kardex",
      "inventory-consumptions": "inventario-consumos",
      "inventory-deliveries": "inventario-entregas-proveedores",
      "inventory-purchase-entries": "inventario-ingresos-compras"
    };
    const company = identity();
    const sheets = [...root.querySelectorAll("table.compact-table")].map((table, tableIndex) => {
      const card = table.closest(".panel-card");
      const title = card?.querySelector("h3")?.textContent?.trim() || scopeLabels[scope] || `Reporte ${tableIndex + 1}`;
      const headers = [...table.querySelectorAll("thead th")].map(cell => cell.textContent.replace(/\s+/g, " ").trim());
      const rows = [...table.querySelectorAll("tbody tr")].map(row => (
        [...row.querySelectorAll("td")].map(cell => domValue(cell.innerText || cell.textContent))
      )).filter(row => row.length && row.some(value => String(value?.value ?? value ?? "").trim()));
      const widths = headers.map((header, columnIndex) => {
        const longest = rows.slice(0, 100).reduce((max, row) => Math.max(max, String(row[columnIndex]?.value ?? row[columnIndex] ?? "").length), header.length);
        return Math.max(14, Math.min(45, longest + 3));
      });
      return {
        name: title || `Reporte ${tableIndex + 1}`,
        title: `${company.commercialName || company.legalName} - ${String(title).toUpperCase()}`,
        widths,
        headers,
        rows
      };
    });
    if (!sheets.length) {
      const summaryRows = [...root.querySelectorAll(".summary-card")].map(card => [
        card.querySelector("span")?.textContent?.trim() || "",
        domValue(card.querySelector("strong")?.textContent || ""),
        card.querySelector("small")?.textContent?.trim() || ""
      ]);
      const infoRows = [...root.querySelectorAll(".info-row")].map(row => [
        row.querySelector("strong")?.textContent?.trim() || "",
        row.querySelector("span")?.textContent?.trim() || "",
        ""
      ]);
      sheets.push({
        name: "Resumen",
        title: `${company.commercialName || company.legalName} - RESUMEN DE REPORTES`,
        widths: [35, 28, 55],
        headers: ["Indicador", "Valor", "Detalle"],
        rows: [...summaryRows, ...infoRows]
      });
    }
    return {
      report: { scope, source: "DOM_VISIBLE", sheets: sheets.length },
      sheets,
      label: scopeLabels[scope] || slug(scope)
    };
  }

  function reportDefinition(scope, filters = {}) {
    const service = BlessERP.services.reports;
    const financialService = BlessERP.services.financialStatementsReadV2;
    const company = identity();
    if (scope === "trial-balance") {
      const report = financialService.reportForScope(scope).report;
      validateFinancialReport(scope, report);
      return { report, sheets: [trialBalanceSheet(report, company)], label: "balance-comprobacion" };
    }
    if (scope === "income-statement") {
      const report = financialService.reportForScope(scope).report;
      validateFinancialReport(scope, report);
      return { report, sheets: [incomeStatementSheet(report, company)], label: "estado-resultados" };
    }
    if (scope === "balance-sheet") {
      const report = financialService.reportForScope(scope).report;
      validateFinancialReport(scope, report);
      return { report, sheets: [balanceSheetSheet(report, company)], label: "balance-general" };
    }
    if (scope === "financial-statements") {
      const trial = financialService.reportForScope("trial-balance").report;
      const income = financialService.reportForScope("income-statement").report;
      const balance = financialService.reportForScope("balance-sheet").report;
      validateFinancialReport("trial-balance", trial);
      validateFinancialReport("income-statement", income);
      validateFinancialReport("balance-sheet", balance);
      return {
        report: { filters, trial, income, balance },
        sheets: [trialBalanceSheet(trial, company), incomeStatementSheet(income, company), balanceSheetSheet(balance, company)],
        label: "estados-financieros"
      };
    }
    if (scope === "account-movement") {
      const report = service.accountMovementReport(filters);
      return { report, sheets: [accountLedgerSheet(report, company)], label: `mayor-${filters.accountCode || "cuenta"}` };
    }
    if (scope === "general-ledger") {
      const report = service.generalLedgerReport(filters);
      return { report, sheets: generalLedgerSheets(report, company), label: "mayor-general" };
    }
    if (scope === "purchases") {
      const report = service.purchasesReport(filters);
      return { report, sheets: [purchasesSheet(report, company)], label: "compras" };
    }
    if (scope === "sales") {
      const report = service.salesReport(filters);
      return { report, sheets: [salesSheet(report, company)], label: "ventas" };
    }
    return domReportDefinition(scope);
  }

  function round2(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }

  function validateFinancialReport(scope, report) {
    if (!report?.ok) throw new Error("El estado financiero consultado no está disponible para exportar.");
    if (scope === "trial-balance") {
      const difference = round2(Number(report.totals?.debit || 0) - Number(report.totals?.credit || 0));
      const controlDifference = round2(Number(report.controlTotals?.debit || 0) - Number(report.controlTotals?.credit || 0));
      if (difference !== round2(report.totals?.difference) || controlDifference !== round2(report.controlTotals?.difference)) {
        throw new Error("El Balance de Comprobación consultado no coincide con los totales de exportación.");
      }
      return true;
    }
    if (scope === "income-statement") {
      const byType = Object.fromEntries((report.sections || []).map(section => [
        section.key,
        round2((section.rows || []).filter(row => row.isMovement).reduce((sum, row) => sum + Number(row.finalSigned || 0), 0))
      ]));
      const expected = round2((byType.Ingreso || 0) - (byType.Costo || 0) - (byType.Gasto || 0));
      if ((report.sections || []).some(section => round2(section.total) !== round2(byType[section.key]))
        || expected !== round2(report.resultPeriod)) {
        throw new Error("El Estado de Resultados consultado no coincide con los totales de exportación.");
      }
      return true;
    }
    if (scope === "balance-sheet") {
      const totalsByType = Object.fromEntries((report.sections || []).map(section => [
        section.key,
        round2((section.rows || []).filter(row => !row.parentCode).reduce((sum, row) => sum + Number(row.finalSigned || 0), 0))
      ]));
      const difference = round2((totalsByType.Activo || 0) - (totalsByType.Pasivo || 0)
        - (totalsByType.Patrimonio || 0) - Number(report.resultPeriod || 0));
      if ((report.sections || []).some(section => round2(section.total) !== round2(totalsByType[section.key]))
        || difference !== round2(report.validation?.difference)) {
        throw new Error("El Balance General consultado no coincide con los totales de exportación.");
      }
      return true;
    }
    return true;
  }

  function downloadArchive(archive, fileName) {
    const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  async function exportReport(scope, filters = {}, options = {}) {
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) return { ok: false, message: "El generador XLSX compartido no esta disponible." };
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      await nextPaint();
      const definition = options.definition || await serverReportDefinition(scope) || reportDefinition(scope, filters);
      const company = identity();
      const meta = reportMeta(filters, definition.label);
      const logoBytes = options.logoBytes || await companyLogoBytes();
      const archive = logoBytes
        ? workbookApi.buildWorkbookArchive(definition.sheets, meta, logoBytes)
        : workbookApi.buildWorkbookArchive(definition.sheets, meta);
      const fileName = `${definition.label}-${slug(company.commercialName || company.legalName)}-${filters.dateFrom || "inicio"}-${filters.dateTo || "fin"}.xlsx`;
      if (options.download !== false) downloadArchive(archive, fileName);
      const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      return { ok: true, archive, fileName, sheets: definition.sheets, report: definition.report, meta, durationMs: finishedAt - startedAt };
    } catch (error) {
      return { ok: false, message: error.message || "No se pudo generar el XLSX." };
    }
  }

  const SENAE_PAGE_SIZE = 200;
  const SENAE_MAX_PAGES = 1000;

  function validateSenaeRange(filters = {}) {
    const dateFrom = String(filters.dateFrom || "").trim();
    const dateTo = String(filters.dateTo || "").trim();
    const commerceType = String(filters.commerceType || "TODOS").trim().toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return { ok: false, message: "Seleccione las fechas Desde y Hasta para generar la Liquidación SENAE." };
    }
    if (dateFrom > dateTo) {
      return { ok: false, message: "La fecha Desde no puede ser posterior a la fecha Hasta." };
    }
    if (!["TODOS", "LOCAL", "EXPORTADOR"].includes(commerceType)) {
      return { ok: false, message: "El tipo de comercio seleccionado no es válido." };
    }
    return { ok: true, dateFrom, dateTo, commerceType };
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function numericValue(value) {
    const normalized = typeof value === "string" ? value.replace(/\s/g, "").replace(",", ".") : value;
    const result = Number(normalized || 0);
    return Number.isFinite(result) ? result : 0;
  }

  function normalizedKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  function additionalValue(additionalInformation, name) {
    const expected = normalizedKey(name);
    if (Array.isArray(additionalInformation)) {
      const row = additionalInformation.find(item => normalizedKey(item?.name || item?.key || item?.label) === expected);
      return row?.value ?? row?.text ?? "";
    }
    const source = objectValue(additionalInformation);
    const key = Object.keys(source).find(item => normalizedKey(item) === expected);
    return key ? source[key] : "";
  }

  function deriveSenaeCommerceType(document = {}) {
    const normalized = String(document?.source_snapshot?.invoice?.commerceType || document?.commerce_type || "").trim().toUpperCase();
    if (normalized === "LOCAL") return "LOCAL";
    if (normalized === "EXPORTADOR") return "EXPORTADOR";
    return "SIN_CLASIFICAR";
  }

  function senaeCommerceLabel(value) {
    if (value === "LOCAL") return "LOCAL";
    if (value === "EXPORTADOR") return "EXPORTACIÓN";
    return "SIN CLASIFICAR";
  }

  function piecesMetrics(value) {
    const source = String(value || "").trim();
    const boxes = numericValue(source.match(/^\s*([\d.,]+)/)?.[1]);
    const fulls = numericValue(source.match(/\bfulls?\s+([\d.,]+)/i)?.[1]);
    return { boxes, fulls };
  }

  function invoiceSeries(value) {
    const parts = String(value || "").trim().split("-").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : String(value || "");
  }

  function canonicalSenaeLine(line = {}, row = {}) {
    const unit = String(line.unit || "").trim().toUpperCase();
    const quantity = numericValue(line.quantity);
    const bunches = ["RAMO", "RAMOS", "BUNCH", "BUNCHES"].includes(unit)
      ? quantity
      : numericValue(line.bunches);
    const stemsPerBunch = numericValue(line.stemsPerBunch || line.stems_per_bunch);
    const stems = ["TALLO", "TALLOS", "STEM", "STEMS"].includes(unit)
      ? quantity
      : numericValue(line.stems || (bunches * stemsPerBunch));
    return {
      documentId: row.documentId || "",
      invoice: row.documentNumber || "",
      saleType: row.saleType || "SIN CLASIFICAR",
      customer: row.customerName || "",
      brand: row.brandName || "",
      dae: row.dae || "",
      country: row.country || "",
      variety: line.variety || line.description || "",
      measure: line.measure || "",
      unit: line.unit || "",
      quantity,
      bunches,
      stemsPerBunch,
      stems,
      unitPrice: numericValue(line.unitPrice || line.unit_price),
      total: numericValue(line.subtotal)
    };
  }

  function mapSenaeDocument(document = {}) {
    const source = objectValue(document.source_snapshot);
    const invoice = objectValue(source.invoice);
    const erpEmission = objectValue(source.erpEmission);
    const buyer = Object.keys(objectValue(document.buyer_snapshot)).length
      ? objectValue(document.buyer_snapshot)
      : objectValue(source.buyer);
    const additional = source.additionalInformation || {};
    const guides = String(additionalValue(additional, "Guias") || "").split(/\s*\/\s*/).filter(Boolean);
    const pieces = piecesMetrics(additionalValue(additional, "Piezas"));
    const mapped = {
      documentId: String(document.id || ""),
      documentType: String(document.document_type || ""),
      documentNumber: String(document.full_number || ""),
      issueDate: String(document.issue_date || ""),
      authorizationDate: String(document.authorized_at || ""),
      authorizationNumber: String(document.authorization_number || ""),
      accessKey: String(document.access_key || ""),
      status: String(document.status || "").toUpperCase(),
      subtotal: numericValue(document.subtotal),
      taxTotal: numericValue(document.tax_total),
      total: numericValue(document.grand_total),
      customerName: String(buyer.legalName || buyer.legal_name || ""),
      customerTaxId: String(buyer.identification || buyer.taxId || buyer.tax_id || ""),
      brandName: String(additionalValue(additional, "Marca cliente") || ""),
      commerceType: deriveSenaeCommerceType(document),
      saleType: senaeCommerceLabel(deriveSenaeCommerceType(document)),
      country: String(invoice.destinationCountryCode || ""),
      transportType: String(erpEmission.transportType || ""),
      incoterm: String(invoice.incoterm || ""),
      dae: String(additionalValue(additional, "DAE") || ""),
      masterGuide: String(guides[0] || ""),
      childGuide: String(guides.slice(1).join(" / ") || ""),
      airline: String(additionalValue(additional, "Aerolínea") || additionalValue(additional, "Aerolinea") || ""),
      agency: String(additionalValue(additional, "Agencia") || ""),
      orderId: String(erpEmission.sourceOrderId || ""),
      orderNumber: String(erpEmission.sourceOrderNumber || ""),
      boxes: pieces.boxes,
      fulls: pieces.fulls,
      lines: []
    };
    mapped.lines = (Array.isArray(source.lines) ? source.lines : []).map(line => canonicalSenaeLine(line, mapped));
    mapped.bunches = mapped.lines.reduce((sum, line) => sum + line.bunches, 0);
    mapped.stems = mapped.lines.reduce((sum, line) => sum + line.stems, 0);
    return mapped;
  }

  async function loadSenaeDocuments(filters = {}, options = {}) {
    const range = validateSenaeRange(filters);
    if (!range.ok) throw new Error(range.message);
    if (!options.listDocuments && BlessERP.getSenaeLiquidationV2Repository) {
      const result = await BlessERP.getSenaeLiquidationV2Repository().exportAll(range);
      return result.documents;
    }
    const listDocuments = options.listDocuments || BlessERP.sriApi?.list;
    if (typeof listDocuments !== "function") throw new Error("La API SRI canónica no está disponible.");
    const pageSize = SENAE_PAGE_SIZE;
    const documents = [];
    const seenIds = new Set();
    for (let pageIndex = 0; pageIndex < SENAE_MAX_PAGES; pageIndex += 1) {
      const offset = pageIndex * pageSize;
      const page = await listDocuments({
        documentType: "01",
        status: "AUTORIZADO",
        from: range.dateFrom,
        to: range.dateTo,
        limit: pageSize,
        offset
      });
      if (!Array.isArray(page)) throw new Error("La API SRI devolvió una respuesta inválida para Liquidación SENAE.");
      let inserted = 0;
      page.forEach(document => {
        const id = String(document?.id || "");
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        documents.push(document);
        inserted += 1;
      });
      if (page.length < pageSize) break;
      if (!inserted) throw new Error("La API SRI no aplicó la paginación solicitada; el reporte fue detenido para evitar truncamiento.");
      if (pageIndex === SENAE_MAX_PAGES - 1) throw new Error("El rango excede el límite operativo de paginación SENAE.");
    }
    return documents.sort((left, right) => (
      String(left.issue_date || "").localeCompare(String(right.issue_date || ""))
      || String(left.full_number || "").localeCompare(String(right.full_number || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
  }

  function senaeSheets(documents = [], filters = {}) {
    const company = identity();
    const companyId = String(company.id || company.companyId || "");
    const filterByCompanyId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(companyId);
    const range = validateSenaeRange(filters);
    const rows = (Array.isArray(documents) ? documents : [])
      .filter(document => !filterByCompanyId || String(document?.company_id || "") === companyId)
      .filter(document => String(document?.document_type || "") === "01")
      .filter(document => String(document?.status || "").toUpperCase() === "AUTORIZADO")
      .filter(document => !range.ok || (
        String(document.issue_date || "") >= range.dateFrom
        && String(document.issue_date || "") <= range.dateTo
      ))
      .filter(document => !range.ok || range.commerceType === "TODOS" || deriveSenaeCommerceType(document) === range.commerceType)
      .map(mapSenaeDocument);
    const detailGroups = rows.map(row => ({ invoice: row.documentNumber, lines: row.lines }));
    const detail = detailGroups.flatMap(group => group.lines);
    const detailedRows = [];
    const detailSubtotalRowIndexes = [];
    detailGroups.forEach(group => {
      group.lines.forEach(item => detailedRows.push([
        text(item.invoice), item.saleType, item.customer, item.brand, text(item.dae), item.country,
        item.variety, item.measure, item.unit, item.quantity, currency(item.unitPrice), currency(item.total), text(item.documentId)
      ]));
      if (!group.lines.length) return;
      detailSubtotalRowIndexes.push(detailedRows.length);
      detailedRows.push([
        text(`SUBTOTAL FACTURA ${group.invoice}`), "", "", "", "", "", "", "", "", "", "",
        currency(totals(group.lines, ["total"]).total), ""
      ]);
    });
    const counts = rows.reduce((summary, row) => {
      summary.total += 1;
      if (row.saleType === "LOCAL") summary.local += 1;
      else if (row.saleType === "EXPORTACIÓN") summary.export += 1;
      else summary.unclassified += 1;
      return summary;
    }, { total: 0, local: 0, export: 0, unclassified: 0 });
    const reportTotals = totals(rows, ["subtotal", "taxTotal", "total", "boxes", "bunches", "stems", "fulls"]);
    const report = { filters: range.ok ? range : filters, rows, detail, counts, totals: reportTotals };
    return {
      report,
      sheets: [
        {
          name: "Liquidacion SENAE",
          title: `${company.commercialName || company.legalName} - FACTURAS AUTORIZADAS PARA LIQUIDACION SENAE`,
          widths: [16, 20, 18, 20, 34, 30, 20, 18, 16, 18, 22, 22, 24, 26, 28, 28, 20, 20, 14, 14, 14, 16, 38],
          headers: [
            "Fecha emision", "Fecha autorizacion", "Tipo de venta", "Identificacion", "Cliente principal", "Cliente final", "DAE",
            "Subtotal USD", "Impuestos USD", "Total USD", "Guia madre", "Guia hija", "Linea aerea", "Agencia", "Clave de acceso",
            "Numero autorizacion", "Pais", "Secuencial SRI (XXX-XXX)", "Cajas", "Ramos", "Tallos", "Fulls", "ID documento"
          ],
          rows: rows.map(row => [
            date(row.issueDate), date(row.authorizationDate), row.saleType, text(row.customerTaxId), row.customerName, row.brandName,
            text(row.dae), currency(row.subtotal), currency(row.taxTotal), currency(row.total), text(row.masterGuide), text(row.childGuide),
            row.airline, row.agency, text(row.accessKey), text(row.authorizationNumber), row.country, text(invoiceSeries(row.documentNumber)),
            row.boxes, row.bunches, row.stems, row.fulls, text(row.documentId)
          ]),
          totals: [
            "TOTAL GENERAL", "", "", "", "", "", "", currency(reportTotals.subtotal), currency(reportTotals.taxTotal), currency(reportTotals.total),
            "", "", "", "", "", "", "", "", reportTotals.boxes, reportTotals.bunches, reportTotals.stems, reportTotals.fulls, ""
          ]
        },
        {
          name: "Detalle variedades",
          title: `${company.commercialName || company.legalName} - DETALLE CANONICO DE VARIEDADES FACTURADAS`,
          widths: [24, 18, 34, 30, 20, 20, 28, 16, 14, 16, 18, 18, 38],
          headers: ["Factura", "Tipo de venta", "Cliente principal", "Cliente final", "DAE", "Pais", "Variedad", "Medida", "Unidad", "Cantidad", "Precio unitario", "Total USD", "ID documento"],
          rows: detailedRows,
          subtotalRowIndexes: detailSubtotalRowIndexes,
          totals: ["TOTAL GENERAL", "", "", "", "", "", "", "", "", "", "", currency(totals(detail, ["total"]).total), ""]
        }
      ]
    };
  }

  async function exportSenae(filters = {}, options = {}) {
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) return { ok: false, message: "El generador XLSX compartido no esta disponible." };
    try {
      const range = validateSenaeRange(filters);
      if (!range.ok) return { ok: false, message: range.message };
      const company = identity();
      const reportFilters = { ...filters, ...range };
      const documents = options.documents || await loadSenaeDocuments(reportFilters, options);
      const definition = senaeSheets(documents, reportFilters);
      if (!definition.report.rows.length) return { ok: false, message: "No existen facturas autorizadas en el rango seleccionado." };
      const meta = reportMeta(range, "liquidacion-senae");
      const logoBytes = options.logoBytes || await companyLogoBytes().catch(() => undefined);
      const archive = workbookApi.buildWorkbookArchive(definition.sheets, meta, logoBytes);
      const fileName = `liquidacion-senae-${slug(company.commercialName || company.legalName)}-${range.dateFrom}-${range.dateTo}.xlsx`;
      if (options.download !== false) downloadArchive(archive, fileName);
      return { ok: true, archive, fileName, documents, documentCount: documents.length, ...definition, meta };
    } catch (error) {
      return { ok: false, message: error.message || "No se pudo generar la Liquidación SENAE." };
    }
  }

  BlessERP.reportFinancialXlsx = {
    companyLogoBytes,
    exportReport,
    exportSenae,
    deriveSenaeCommerceType,
    loadSenaeDocuments,
    mapSenaeDocument,
    reportDefinition,
    validateFinancialReport,
    senaeSheets,
    validateSenaeRange,
    text,
    currency,
    date
  };
})();
