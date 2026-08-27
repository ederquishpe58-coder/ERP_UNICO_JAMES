(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.BlessERP = root.BlessERP || {};
    root.BlessERP.comercialSriOrderQueueCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function(){
  const countryCodes = Object.freeze({
    ECUADOR: "593",
    USA: "110",
    "UNITED STATES": "110",
    "ESTADOS UNIDOS": "110",
    KAZAJSTAN: "348",
    KAZAKHSTAN: "348",
    NETHERLANDS: "215",
    "PAISES BAJOS": "215",
    "REPUBLICA DOMINICANA": "122",
    RUSIA: "230",
    RUSSIA: "230"
  });
  const legacyIsoCountryCodes = Object.freeze({
    "840": "110",
    "398": "348",
    "528": "215",
    "214": "122",
    "643": "230"
  });
  const selectableStatuses = new Set([
    "PENDIENTE", "BORRADOR", "VALIDADO", "XML_GENERADO", "FIRMADO",
    "ENVIADO_SRI", "RECIBIDO_SRI", "ERROR_ENVIO", "PENDIENTE_REINTENTO"
  ]);
  const diagnosticStatuses = new Set([
    "DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO", "PENDIENTE_REINTENTO"
  ]);
  const salePaymentMethodCodes = new Set(["01", "20"]);

  function normalizeText(value, maxLength = 300) {
    return String(value ?? "")
      .normalize("NFC")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function mergePublicAdditionalInformation(values = {}) {
    const compact = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => normalizeText(key) && normalizeText(value))
    );
    return globalThis.BlessERP?.softwareProvider?.mergeAdditionalInformation?.(compact) || compact;
  }

  function normalizedKey(value) {
    return normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function paymentMethodCode(value, fallback = "20") {
    const normalized = normalizedKey(value);
    if (salePaymentMethodCodes.has(normalized)) return normalized;
    if (normalized.includes("SIN UTILIZACION")) return "01";
    if (
      normalized.includes("TRANSFER")
      || normalized.includes("CHEQUE")
      || normalized.includes("DEBITO")
      || normalized.includes("CON UTILIZACION")
    ) return "20";
    if (fallback === "") return "";
    return salePaymentMethodCodes.has(fallback) ? fallback : "20";
  }

  function countryCode(order = {}, brand = {}) {
    const explicit = String(order.destinationCountryCode || "").replace(/\D+/g, "");
    if (/^\d{3}$/.test(explicit)) return legacyIsoCountryCodes[explicit] || explicit;
    return countryCodes[normalizedKey(brand?.country || order.destinationCountry || order.destination)] || "";
  }

  function guides(order = {}) {
    return [...new Set([
      order.sriGuides,
      order.awb,
      order.hawb
    ].flatMap(value => String(value || "").split(/[\r\n,;|/]+/))
      .map(value => normalizeText(value, 50))
      .filter(Boolean))].join(" / ");
  }

  function transportType(order = {}) {
    return normalizedKey(order.transportType || "AEREO") || "AEREO";
  }

  function isLocalSale(order = {}, brand = {}) {
    const declaredType = normalizedKey(order.saleType || order.salesType || order.tipoVenta);
    if (["LOCAL", "VENTA LOCAL", "VENTA_LOCAL"].includes(declaredType)) return true;
    if (["EXPORTACION", "EXPORTACIÓN", "EXPORT"].includes(declaredType)) return false;
    const destination = normalizedKey(order.destinationCountry || order.destination || brand?.country);
    return destination === "ECUADOR" || countryCode(order, brand) === "593";
  }

  function isExportOrder(order = {}, brand = {}) {
    return !isLocalSale(order, brand);
  }

  function sriDae(order = {}, brand = {}) {
    if (!isExportOrder(order, brand)) return "";
    const fallback = transportType(order) === "AEREO" ? order.daeNumber : "";
    return normalizeText(order.sriDaeNumber || fallback, 50);
  }

  function lineQuantity(line = {}) {
    const explicit = Number(line.totalStems);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return Number(line.bunches || 0) * Number(line.stemsPerBunch || 0);
  }

  function lineCode(line = {}, index = 0) {
    const source = `ROSA-${line.variety || index + 1}-${line.length || ""}`;
    return normalizedKey(source).replace(/[^A-Z0-9_-]+/g, "-").replace(/-+/g, "-").slice(0, 25);
  }

  function zeroTax(base) {
    return [{ code: "2", percentageCode: "0", rate: 0, taxableBase: Number(base || 0), value: 0 }];
  }

  function validateOrder(context = {}) {
    const { order = {}, customer, brand, metrics = {} } = context;
    const errors = [];
    if (!normalizeText(order.number, 50)) errors.push("Falta el numero del pedido.");
    if (!customer) errors.push("Falta el cliente principal.");
    if (!normalizeText(customer?.identification, 20)) errors.push("Falta la identificacion del comprador.");
    const declaredPaymentMethod = order.sriPaymentMethod || customer?.sriPaymentMethod;
    if (declaredPaymentMethod && !salePaymentMethodCodes.has(paymentMethodCode(declaredPaymentMethod, ""))) {
      errors.push("La forma de pago SRI de la factura no es valida.");
    }
    const exportOrder = isExportOrder(order, brand);
    if (exportOrder && !brand) errors.push("Falta la marca o cliente final.");
    const fiscalDae = sriDae(order, brand);
    if (exportOrder && !fiscalDae) {
      errors.push("Pendiente de DAE fiscal: registre la DAE real antes de procesar o autorizar la factura de exportación.");
    }
    if (exportOrder && !normalizeText(order.awb, 50)) errors.push("La exportacion requiere guia madre para autorizar en el SRI.");
    if (exportOrder && !normalizeText(order.hawb, 50)) errors.push("La exportacion requiere guia hija para autorizar en el SRI.");
    if (exportOrder && !countryCode(order, brand)) errors.push("Falta el codigo SRI del pais de destino.");
    const today = String(context.today || new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" })).slice(0, 10);
    const issueDate = String(order.issuedAt || order.createdAt || order.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      errors.push("Falta una fecha de emision valida en el pedido.");
    } else {
      const elapsedDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${issueDate}T00:00:00Z`)) / 86400000);
      if (elapsedDays < 0) errors.push("La fecha de emision no puede ser posterior al dia de autorizacion.");
      if (!exportOrder && issueDate !== today) errors.push("La venta local debe emitirse y autorizarse el mismo dia.");
      if (exportOrder && elapsedDays > 60) errors.push("La exportacion supera el plazo operativo de 60 dias desde la fecha de emision.");
    }
    if (!Array.isArray(metrics.lines) || !metrics.lines.length) errors.push("El pedido no contiene lineas para facturar.");
    if (Number(metrics.totalStems || 0) <= 0) errors.push("La cantidad total de tallos debe ser mayor que cero.");
    if (Number(metrics.totalUsd || 0) <= 0) errors.push("El valor total de la factura debe ser mayor que cero.");
    if ((metrics.lines || []).some(line => Number(line.unitPrice || 0) <= 0)) errors.push("Todas las lineas deben tener un precio unitario mayor que cero.");
    return [...new Set(errors)];
  }

  function buildExportSriLines(metrics = {}) {
    const quantity = Number(metrics.totalStems || 0);
    const subtotal = Number(Number(metrics.totalUsd || 0).toFixed(6));
    const unitPrice = quantity > 0 ? Number((subtotal / quantity).toFixed(6)) : 0;
    return [{
      sourceLineId: null,
      mainCode: "ROSES",
      description: "ROSES",
      variety: "ROSES",
      measure: "",
      unit: "TALLO",
      quantity,
      unitPrice,
      discount: 0,
      subtotal,
      taxes: zeroTax(subtotal)
    }];
  }

  function expandCompleteMixedLines(lines = []) {
    return lines.flatMap(line => {
      const composition = Array.isArray(line.mixedActualComposition)
        ? line.mixedActualComposition
        : [];
      const expectedBunches = Number(line.bunches || 0);
      const actualBunches = composition.reduce((sum, item) => sum + Number(item.bunches || 0), 0);
      if (!composition.length || expectedBunches <= 0 || actualBunches !== expectedBunches) return [line];
      const unitPrice = Number(line.unitPrice || 0);
      return composition.map((item, index) => {
        const bunches = Number(item.bunches || 0);
        const stemsPerBunch = Number(item.stemsPerBunch || line.stemsPerBunch || 0);
        const totalStems = Number(item.totalStems || (bunches * stemsPerBunch));
        return {
          ...line,
          id: `${line.id || "LINEA"}-MIX-${index + 1}`,
          variety: item.variety || line.variety,
          length: Number(item.length || line.length || 0),
          bunches,
          stemsPerBunch,
          totalStems,
          totalLine: totalStems * unitPrice,
          unitPrice
        };
      });
    });
  }

  function buildLocalSriLines(metrics = {}) {
    const grouped = new Map();
    expandCompleteMixedLines(metrics.lines || []).forEach((line, index) => {
      const variety = normalizeText(line.variety || "ROSAS", 300);
      const measure = normalizeText(`${line.length || ""} CM`, 300);
      const unitPrice = Number(line.unitPrice || 0);
      const key = `${normalizedKey(variety)}|${measure}|${unitPrice.toFixed(6)}`;
      const current = grouped.get(key) || {
        sourceLineId: line.id || null,
        mainCode: lineCode(line, index),
        description: normalizeText(`ROSAS ${variety} ${measure}`, 300),
        variety,
        measure,
        unit: "TALLO",
        quantity: 0,
        unitPrice,
        discount: 0,
        subtotal: 0
      };
      const quantity = lineQuantity(line);
      current.quantity += quantity;
      current.subtotal += Number(line.totalLine || (quantity * unitPrice));
      grouped.set(key, current);
    });

    return [...grouped.values()].map(line => {
      const subtotal = Number(line.subtotal.toFixed(6));
      return {
        ...line,
        quantity: Number(line.quantity.toFixed(6)),
        subtotal,
        taxes: zeroTax(subtotal)
      };
    });
  }

  function buildInvoicePayload(context = {}) {
    const { order = {}, customer = {}, brand = {}, company = {}, metrics = {} } = context;
    const errors = validateOrder(context);
    if (errors.length) return { ok: false, errors, payload: null };
    const exportOrder = isExportOrder(order, brand);
    const fiscalDae = sriDae(order, brand);
    const customerEmail = normalizeText(
      customer.email || customer.billingEmail || customer.contactEmail || order.customerEmail,
      300
    );
    const fulls = Number(metrics.totalFulls ?? metrics.fulls ?? order.totalFulls ?? 0);
    const additionalInformation = {
      "Correo cliente": customerEmail,
      Guias: exportOrder ? guides(order) : "",
      Piezas: `${Number(metrics.totalBoxes || order.totalBoxes || 0)} fulls ${Number.isFinite(fulls) ? Number(fulls.toFixed(2)) : 0}`,
      "Marca cliente": normalizeText(brand?.name || brand?.finalClientName, 300),
      DAE: exportOrder ? fiscalDae : ""
    };
    const publicAdditionalInformation = mergePublicAdditionalInformation(additionalInformation);
    if (!exportOrder) {
      ["DAE", "DAES", "Guias", "GUIAS", "Guías", "GUÍAS"].forEach(key => {
        delete publicAdditionalInformation[key];
      });
    }

    const incotermParts = normalizeText(company.incoterm || "FCA UIO", 50).split(/\s+/);
    const incoterm = incotermParts.shift() || "FCA";
    const incotermPlace = incotermParts.join(" ") || "UIO";
    const total = Number(metrics.totalUsd || 0);
    const paymentMethod = paymentMethodCode(order.sriPaymentMethod || customer.sriPaymentMethod, "20");
    const lines = exportOrder
      ? buildExportSriLines(metrics)
      : buildLocalSriLines(metrics);

    return {
      ok: true,
      errors: [],
      payload: {
        buyer: {
          identificationType: "08",
          identification: normalizeText(customer.identification, 20),
          // El adquirente tributario siempre es el cliente principal. La marca o
          // cliente final se conserva únicamente como información adicional.
          legalName: normalizeText(customer.legalName || customer.commercialName, 300),
          address: normalizeText(customer.address, 300),
          email: customerEmail
        },
        invoice: {
          commerceType: exportOrder ? "EXPORTADOR" : "LOCAL",
          ...(exportOrder ? {
            incoterm,
            incotermPlace,
            originCountryCode: "593",
            portOfLoading: incotermPlace,
            portOfDestination: normalizeText(order.destination || brand.destination || brand.city || brand.country, 300),
            destinationCountryCode: countryCode(order, brand),
            totalWithoutTaxIncoterm: incoterm
          } : {}),
          totalWithoutTax: total,
          discountTotal: 0,
          grandTotal: total,
          currency: "DOLAR",
          payments: [{
            method: paymentMethod,
            total,
            term: Math.max(0, Number(customer.creditDays || 0)),
            unit: "dias"
          }]
        },
        taxes: zeroTax(total),
        lines,
        additionalInformation: publicAdditionalInformation,
        erpEmission: {
          sourceOrderId: normalizeText(order.id, 120),
          sourceOrderNumber: normalizeText(order.number, 50),
          sourceOrderDate: String(order.issuedAt || "").slice(0, 10),
          transportType: exportOrder ? transportType(order) : "LOCAL"
        }
      }
    };
  }

  function sourceOrderNumber(document = {}) {
    const source = document.source_snapshot || {};
    const additional = document.additional_information || source.additionalInformation || {};
    return normalizeText(source.erpEmission?.sourceOrderNumber || additional.Pedido, 50);
  }

  function isSelectableStatus(status) {
    return selectableStatuses.has(String(status || "PENDIENTE").toUpperCase());
  }

  function isDiagnosticStatus(status) {
    return diagnosticStatuses.has(String(status || "PENDIENTE").toUpperCase());
  }

  function nextAction(status, hasRemoteDocument = true) {
    const normalized = String(status || "PENDIENTE").toUpperCase();
    if (!hasRemoteDocument || normalized === "PENDIENTE") return "create-draft";
    if (["BORRADOR", "VALIDADO"].includes(normalized)) return "generate-xml";
    if (normalized === "XML_GENERADO") return "sign";
    if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(normalized)) return "transmit";
    return "";
  }

  return {
    buildInvoicePayload,
    countryCode,
    guides,
    isExportOrder,
    isLocalSale,
    isDiagnosticStatus,
    isSelectableStatus,
    nextAction,
    normalizeText,
    paymentMethodCode,
    sourceOrderNumber,
    sriDae,
    transportType,
    validateOrder
  };
});
