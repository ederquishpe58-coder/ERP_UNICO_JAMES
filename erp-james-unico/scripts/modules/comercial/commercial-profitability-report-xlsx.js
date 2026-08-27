(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const BLESS_COMPANY_ID = BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER";
  const IMPERIO_COMPANY_ID = BlessERP.companyCapabilities?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS";

  function round(value, decimals = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const factor = 10 ** decimals;
    return Math.round((number + Number.EPSILON) * factor) / factor;
  }

  function text(value) {
    return { xlsxType: "text", value: String(value ?? "") };
  }

  function dateCell(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return value || "";
    const milliseconds = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    return { xlsxType: "dateTime", value: (milliseconds / 86400000) + 25569 };
  }

  function activeCompanyId(appState) {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || BlessERP.companyCapabilities?.companyIdOf?.(appState?.db?.activeCompanyId)
      || BLESS_COMPANY_ID;
  }

  function commercialStore(appState, companyId) {
    return BlessERP.comercialIntercompany?.getCommercialStore?.(appState, companyId)
      || appState?.db?.commercial
      || { orders: [] };
  }

  function companyRootStore(appState, companyId) {
    const current = activeCompanyId(appState);
    return current === companyId
      ? appState?.db || {}
      : appState?.db?.companyStores?.[companyId] || {};
  }

  function companyIdentity(appState, companyId) {
    const root = companyRootStore(appState, companyId);
    const profile = BlessERP.companyCapabilities?.getCompany?.(companyId) || {};
    const settings = root.companySettings || {};
    return {
      ...profile,
      ...settings,
      id: companyId,
      commercialName: settings.commercialName || profile.commercialName || (companyId === IMPERIO_COMPANY_ID ? "Imperio Flowers" : "Bless Flower"),
      legalName: settings.legalName || profile.legalName || "",
      ruc: settings.ruc || profile.ruc || "",
      logoPath: settings.logoPath || profile.logoPath || ""
    };
  }

  function activeCatalogs(appState, companyId) {
    const store = commercialStore(appState, companyId);
    return {
      customers: new Map((store.customerCatalog || []).map(item => [String(item.id), item])),
      brands: new Map((store.brandCatalog || []).map(item => [String(item.id), item]))
    };
  }

  function blessOperationsStore(appState) {
    const sourceState = BlessERP.comercialIntercompany?.getAvailabilitySourceState?.(appState) || appState;
    return sourceState?.db?.operations || appState?.db?.companyStores?.[BLESS_COMPANY_ID]?.operations || {};
  }

  function inventoryIndexes(appState) {
    const operations = blessOperationsStore(appState);
    const rows = operations.roseInventory || [];
    return {
      byId: new Map(rows.filter(item => item.inventoryId).map(item => [String(item.inventoryId), item])),
      byCode: new Map(rows.filter(item => item.labelCode).map(item => [String(item.labelCode), item])),
      availability: new Map((operations.availabilityDemo || []).filter(item => item.id).map(item => [String(item.id), item]))
    };
  }

  function unique(values, fallback = "") {
    const rows = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
    return rows.length ? rows.sort((left, right) => left.localeCompare(right, "es")).join(" + ") : fallback;
  }

  function scanInventory(line, indexes) {
    const scans = Array.isArray(line.scannedBunches) ? line.scannedBunches : [];
    const inventoryRows = scans
      .map(scan => indexes.byId.get(String(scan.inventoryId || "")) || indexes.byCode.get(String(scan.code || scan.labelCode || "")) || scan)
      .filter(Boolean);
    const composition = inventoryRows.flatMap(item => (
      Array.isArray(item.composition) && item.composition.length
        ? item.composition.map(part => ({
            supplier: part.supplier || item.supplier,
            block: part.block || item.block,
            stems: Number(part.stems || 0)
          }))
        : [{
            supplier: item.supplier || "",
            block: item.block || "",
            stems: Number(item.stemsPerBunch || item.stems || line.stemsPerBunch || 0)
          }]
    ));
    const reservation = indexes.availability.get(String(line.reservationSourceId || line.availability_id || ""));
    const stems = inventoryRows.reduce((sum, item) => sum + Number(item.stemsPerBunch || item.stems || line.stemsPerBunch || 0), 0);
    return {
      scans,
      inventoryRows,
      composition,
      actualStems: scans.length ? stems : 0,
      suppliers: unique([
        ...composition.map(item => item.supplier),
        reservation?.supplier
      ], "SIN PROVEEDOR REGISTRADO"),
      blocks: unique([
        ...composition.map(item => item.block),
        reservation?.block
      ], "SIN BLOQUE REGISTRADO"),
      varieties: unique([
        line.variety,
        ...inventoryRows.map(item => item.variety)
      ], "SIN VARIEDAD"),
      labels: unique(scans.map(item => item.code || item.labelCode), "")
    };
  }

  function costForLine(line) {
    const explicit = [
      ["COSTO UNITARIO", line.costPerStem],
      ["COSTO UNITARIO", line.unitCost],
      ["COSTO PRODUCCION", line.productionCostPerStem],
      ["COSTO PROVEEDOR", line.providerCostPerStem]
    ].find(([, value]) => Number(value) > 0);
    if (explicit) return { known: true, unitCost: round(explicit[1], 4), source: explicit[0] };
    return { known: false, unitCost: 0, source: "COSTO PENDIENTE" };
  }

  function lineRows(appState, companyId, orders) {
    const catalogs = activeCatalogs(appState, companyId);
    const indexes = inventoryIndexes(appState);
    return orders.flatMap(order => {
      const customer = catalogs.customers.get(String(order.customerId || "")) || {};
      const brand = catalogs.brands.get(String(order.brandId || "")) || {};
      return (order.lines || []).map(rawLine => {
        const metricsLine = BlessERP.comercialUtils?.getOrderMetrics?.({ lines: [rawLine] })?.lines?.[0] || rawLine;
        const inventory = scanInventory(rawLine, indexes);
        const plannedStems = Number(metricsLine.totalStems || (Number(rawLine.bunches || 0) * Number(rawLine.stemsPerBunch || 0)));
        const stems = inventory.actualStems > 0 ? inventory.actualStems : plannedStems;
        const bunches = inventory.scans.length || Number(rawLine.bunches || 0);
        const saleUnitPrice = round(rawLine.unitPrice, 4);
        const saleTotal = round(stems * saleUnitPrice, 2);
        const cost = costForLine(rawLine);
        const costTotal = cost.known ? round(stems * cost.unitCost, 2) : null;
        const grossMargin = cost.known ? round(saleTotal - costTotal, 2) : null;
        const marginPercent = cost.known && saleTotal > 0 ? round((grossMargin / saleTotal) * 100, 2) : null;
        return {
          companyId,
          order,
          line: rawLine,
          customer,
          brand,
          inventory,
          bunches,
          stems,
          quantitySource: inventory.actualStems > 0 ? "ACTUAL ESCANEADO" : "PLAN DEL PEDIDO",
          saleUnitPrice,
          saleTotal,
          costKnown: cost.known,
          costUnitPrice: cost.known ? cost.unitCost : null,
          costTotal,
          grossMargin,
          marginPercent,
          costSource: cost.source
        };
      });
    });
  }

  function orderSummary(rows, financialRows = []) {
    const officialByOrder = new Map(financialRows.map(row => [String(row.order_id || row.orderId || ""), row]));
    const groups = new Map();
    rows.forEach(row => {
      const key = String(row.order.id || row.order.number || "");
      const current = groups.get(key) || {
        sample: row,
        boxes: new Set(),
        bunches: 0,
        stems: 0,
        sales: 0,
        costs: 0,
        allCosted: true,
        providers: new Set(),
        blocks: new Set(),
        varieties: new Set()
      };
      current.boxes.add(Number(row.line.boxNumber || 0));
      current.bunches += row.bunches;
      current.stems += row.stems;
      current.sales += row.saleTotal;
      current.allCosted = current.allCosted && row.costKnown;
      if (row.costKnown) current.costs += row.costTotal;
      row.inventory.suppliers.split(" + ").forEach(value => current.providers.add(value));
      row.inventory.blocks.split(" + ").forEach(value => current.blocks.add(value));
      row.inventory.varieties.split(" + ").forEach(value => current.varieties.add(value));
      groups.set(key, current);
    });
    return [...groups.values()].map(group => {
      const orderId = String(group.sample.order.id || "");
      const official = officialByOrder.get(orderId);
      const officialCosts = official ? round(Number(official.direct_cost || official.directCost || 0) + Number(official.allocated_cost || official.allocatedCost || 0), 2) : null;
      const sales = official ? round(official.revenue, 2) : round(group.sales, 2);
      const costs = official ? officialCosts : (group.allCosted ? round(group.costs, 2) : null);
      const margin = official ? round(official.margin, 2) : (group.allCosted ? round(sales - costs, 2) : null);
      return {
        ...group,
        sales,
        costs,
        margin,
        allCosted: Boolean(official) || group.allCosted,
        marginPercent: (official || group.allCosted) && sales > 0 ? round((margin / sales) * 100, 2) : null,
        costSource: official ? "SUPABASE FINANCIAL V2" : "DETALLE OPERATIVO",
        flowerCost: official ? round(official.flower_cost || official.flowerCost || 0, 2) : null,
        packagingCost: official ? round(official.packaging_cost || official.packagingCost || 0, 2) : null,
        laborCost: official ? round(official.labor_cost || official.laborCost || 0, 2) : null,
        logisticsCost: official ? round(Number(official.direct_logistics_cost || official.directLogisticsCost || 0) + Number(official.allocated_cost || official.allocatedCost || 0), 2) : null
      };
    });
  }

  function reportPeriod(rows) {
    const dates = rows.map(row => String(row.order.issuedAt || row.order.flightDate || "").slice(0, 10)).filter(Boolean).sort();
    const from = dates[0] || "";
    const to = dates.at(-1) || "";
    const base = BlessERP.operacionesRamosReportXlsx?.reportPeriod?.(from, to)
      || { period: "PERIODO COMERCIAL", range: from && to ? `${from} A ${to}` : "RANGO SIN DEFINIR" };
    return { ...base, from, to };
  }

  function buildReport(appState, options = {}) {
    const companyId = BlessERP.companyCapabilities?.companyIdOf?.(options.companyId || activeCompanyId(appState))
      || options.companyId
      || BLESS_COMPANY_ID;
    const identity = companyIdentity(appState, companyId);
    const selected = new Set((options.orderIds || []).map(String));
    const sourceOrders = Array.isArray(options.orders)
      ? options.orders
      : (commercialStore(appState, companyId).orders || []);
    const orders = sourceOrders
      .filter(order => String(order.sellingCompanyId || order.selling_company_id || order.companyId || order.company_id || companyId) === companyId)
      .filter(order => !selected.size || selected.has(String(order.id)))
      .filter(order => options.includeAnnulled === true || String(order.status || "").toUpperCase() !== "ANULADO")
      .sort((left, right) => String(left.issuedAt || "").localeCompare(String(right.issuedAt || "")) || String(left.number || "").localeCompare(String(right.number || "")));
    const rows = lineRows(appState, companyId, orders);
    const period = reportPeriod(rows);
    return {
      companyId,
      identity,
      orders,
      rows,
      summary: orderSummary(rows, options.financialRows || []),
      ...period,
      generatedAt: new Date().toISOString(),
      validation: validateReport({ companyId, orders, rows })
    };
  }

  function validateReport(report) {
    const errors = [];
    const orderIds = new Set((report.orders || []).map(order => String(order.id)));
    (report.rows || []).forEach((row, index) => {
      if (row.companyId !== report.companyId) errors.push(`Fila ${index + 1}: empresa mezclada.`);
      if (!orderIds.has(String(row.order.id))) errors.push(`Fila ${index + 1}: pedido no pertenece al reporte.`);
      if (row.stems < 0 || row.saleTotal < 0) errors.push(`Fila ${index + 1}: cantidad o venta negativa.`);
      if (row.costKnown && Math.abs(round(row.saleTotal - row.costTotal, 2) - row.grossMargin) > 0.001) {
        errors.push(`Fila ${index + 1}: margen inconsistente.`);
      }
    });
    return { ok: errors.length === 0, errors };
  }

  function nullableNumber(value) {
    return value === null || value === undefined ? "" : Number(value);
  }

  function buildSheets(report) {
    const detailHeaders = [
      "Empresa", "RUC", "Pedido", "Estado pedido", "PO", "Factura / secuencial", "Estado SRI",
      "Fecha pedido", "Fecha venta / salida", "Cliente", "Marca / cliente final", "Pais", "Destino",
      "Vendedor ID", "Vendedor", "Transporte", "DAE", "AWB", "HAWB", "Caja", "Tipo caja",
      "Variedad", "Medida cm", "Ramos", "Tallos por ramo", "Total tallos", "Origen cantidad",
      "Precio venta por tallo", "Venta total", "Costo por tallo", "Costo total", "Margen bruto",
      "Margen %", "Estado costeo", "Origen costo", "Proveedor", "Bloque", "Etiquetas escaneadas",
      "Moneda", "Observacion"
    ];
    const detailRows = report.rows.map(row => [
      report.identity.commercialName,
      text(report.identity.ruc),
      text(row.order.number),
      row.order.status || "BORRADOR",
      text(row.line.po || row.order.generalPo || ""),
      text(row.order.sriInvoiceNumber || row.order.sriSequential || ""),
      row.order.sriAuthorizationStatus || "PENDIENTE",
      dateCell(row.order.issuedAt),
      dateCell(row.order.dispatchedAt || row.order.flightDate || row.order.closedAt || ""),
      row.customer.commercialName || row.customer.legalName || "SIN CLIENTE",
      row.brand.name || row.brand.finalClientName || "SIN MARCA",
      row.order.destinationCountry || row.brand.country || row.customer.country || "",
      row.order.destination || row.brand.destination || "",
      text(row.order.seller_id || row.order.sellerId || row.order.vendedorId || ""),
      row.order.seller_name || row.order.sellerName || row.order.vendedorNombre || "",
      String(row.order.transportType || "").toUpperCase(),
      text(row.order.sriDaeNumber || row.order.daeNumber || ""),
      text(row.order.awb || ""),
      text(row.order.hawb || ""),
      Number(row.line.boxNumber || 0),
      row.line.boxType || "",
      row.inventory.varieties,
      Number(row.line.length || 0),
      Number(row.bunches || 0),
      Number(row.line.stemsPerBunch || 0),
      Number(row.stems || 0),
      row.quantitySource,
      row.saleUnitPrice,
      row.saleTotal,
      nullableNumber(row.costUnitPrice),
      nullableNumber(row.costTotal),
      nullableNumber(row.grossMargin),
      nullableNumber(row.marginPercent),
      row.costKnown ? "COSTEADO" : "PENDIENTE",
      row.costSource,
      row.inventory.suppliers,
      row.inventory.blocks,
      text(row.inventory.labels),
      row.order.currency || "USD",
      row.order.notes || ""
    ]);

    const summaryHeaders = [
      "Empresa", "Pedido", "Fecha", "Fecha salida", "Cliente", "Marca", "Pais", "Destino",
      "Vendedor", "Cajas", "Ramos", "Tallos", "Venta total", "Costo flor", "Empaque", "Mano de obra",
      "Logística", "Costo total", "Margen bruto", "Margen %", "Estado costeo", "Origen costo",
      "Proveedores", "Bloques", "Variedades", "Factura", "Estado SRI", "DAE"
    ];
    const summaryRows = report.summary.map(group => {
      const row = group.sample;
      return [
        report.identity.commercialName,
        text(row.order.number),
        dateCell(row.order.issuedAt),
        dateCell(row.order.dispatchedAt || row.order.flightDate || row.order.closedAt || ""),
        row.customer.commercialName || row.customer.legalName || "SIN CLIENTE",
        row.brand.name || row.brand.finalClientName || "SIN MARCA",
        row.order.destinationCountry || row.brand.country || row.customer.country || "",
        row.order.destination || row.brand.destination || "",
        row.order.seller_name || row.order.sellerName || row.order.vendedorNombre || "",
        group.boxes.size,
        group.bunches,
        group.stems,
        group.sales,
        nullableNumber(group.flowerCost),
        nullableNumber(group.packagingCost),
        nullableNumber(group.laborCost),
        nullableNumber(group.logisticsCost),
        nullableNumber(group.costs),
        nullableNumber(group.margin),
        nullableNumber(group.marginPercent),
        group.allCosted ? "COSTEADO" : "PENDIENTE",
        group.costSource,
        [...group.providers].sort().join(" + "),
        [...group.blocks].sort().join(" + "),
        [...group.varieties].sort().join(" + "),
        text(row.order.sriInvoiceNumber || row.order.sriSequential || ""),
        row.order.sriAuthorizationStatus || "PENDIENTE",
        text(row.order.sriDaeNumber || row.order.daeNumber || "")
      ];
    });

    return [{
      name: "Resumen pedidos",
      title: `${report.identity.commercialName.toUpperCase()} - RENTABILIDAD POR PEDIDO`,
      widths: [22,20,18,18,28,25,20,24,24,12,12,14,16,15,15,15,15,16,16,14,16,22,32,26,32,22,18,24],
      headers: summaryHeaders,
      rows: summaryRows,
      totals: [
        "TOTAL", "", "", "", "", "", "", "", "",
        report.summary.reduce((sum, item) => sum + item.boxes.size, 0),
        report.summary.reduce((sum, item) => sum + item.bunches, 0),
        report.summary.reduce((sum, item) => sum + item.stems, 0),
        round(report.summary.reduce((sum, item) => sum + item.sales, 0), 2),
        report.summary.every(item => item.flowerCost !== null) ? round(report.summary.reduce((sum, item) => sum + item.flowerCost, 0), 2) : "",
        report.summary.every(item => item.packagingCost !== null) ? round(report.summary.reduce((sum, item) => sum + item.packagingCost, 0), 2) : "",
        report.summary.every(item => item.laborCost !== null) ? round(report.summary.reduce((sum, item) => sum + item.laborCost, 0), 2) : "",
        report.summary.every(item => item.logisticsCost !== null) ? round(report.summary.reduce((sum, item) => sum + item.logisticsCost, 0), 2) : "",
        report.summary.every(item => item.allCosted) ? round(report.summary.reduce((sum, item) => sum + item.costs, 0), 2) : "",
        report.summary.every(item => item.allCosted) ? round(report.summary.reduce((sum, item) => sum + item.margin, 0), 2) : "",
        "", "", "", "", "", "", "", "", ""
      ]
    }, {
      name: "Detalle comercial",
      title: `${report.identity.commercialName.toUpperCase()} - DETALLE COMERCIAL Y COSTEO`,
      widths: [22,18,20,20,18,24,18,18,20,28,28,20,24,20,24,16,24,18,18,10,12,28,12,12,16,14,20,20,16,18,16,16,14,16,24,30,24,34,24,12,36],
      headers: detailHeaders,
      rows: detailRows,
      totals: [
        "TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
        report.rows.reduce((sum, row) => sum + row.bunches, 0), "",
        report.rows.reduce((sum, row) => sum + row.stems, 0), "", "",
        round(report.rows.reduce((sum, row) => sum + row.saleTotal, 0), 2), "",
        report.rows.every(row => row.costKnown) ? round(report.rows.reduce((sum, row) => sum + row.costTotal, 0), 2) : "",
        report.rows.every(row => row.costKnown) ? round(report.rows.reduce((sum, row) => sum + row.grossMargin, 0), 2) : "",
        "", "", "", "", "", "", "", "", ""
      ]
    }];
  }

  function fallbackLogoBytes(identity) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    const imperio = identity.id === IMPERIO_COMPANY_ID;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = imperio ? "#0b63ce" : "#16803a";
    context.fillRect(0, 0, 22, canvas.height);
    context.font = "bold 54px Segoe UI, Arial";
    context.fillText(String(identity.commercialName || "ERP").toUpperCase(), 52, 86);
    context.fillStyle = "#475569";
    context.font = "26px Segoe UI, Arial";
    context.fillText(identity.legalName || "", 54, 128);
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  }

  async function loadCompanyLogo(identity) {
    if (!identity.logoPath || typeof fetch !== "function" || typeof document === "undefined") return fallbackLogoBytes(identity);
    try {
      const response = await fetch(new URL(identity.logoPath, document.baseURI));
      if (!response.ok) throw new Error("Logo no disponible.");
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return fallbackLogoBytes(identity);
    }
  }

  async function exportXlsx(appState, options = {}) {
    const report = buildReport(appState, options);
    if (!report.validation.ok) return { ok: false, message: report.validation.errors.join(" "), report };
    if (!report.rows.length) return { ok: false, message: "No existen líneas de pedidos para generar el reporte.", report };
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) {
      return { ok: false, message: "El generador XLSX todavía no está disponible.", report };
    }
    const logoBytes = options.logoBytes || await loadCompanyLogo(report.identity);
    const sheets = buildSheets(report);
    const archive = workbookApi.buildWorkbookArchive(sheets, report, logoBytes);
    const code = report.companyId === IMPERIO_COMPANY_ID ? "imperio" : "bless";
    const fileName = `rentabilidad-comercial-${code}-${report.from || "inicio"}-${report.to || "fin"}.xlsx`;
    if (options.download !== false) {
      const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    }
    return { ok: true, report, sheets, archive, fileName };
  }

  BlessERP.comercialProfitabilityReportXlsx = {
    BLESS_COMPANY_ID,
    IMPERIO_COMPANY_ID,
    buildReport,
    buildSheets,
    exportXlsx,
    validateReport
  };
})();
