(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.BlessERP = root.BlessERP || {};
    root.BlessERP.comercialInvoiceSequence = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function(){
  const DEFAULT_ESTABLISHMENT = "001";
  const DEFAULT_EMISSION_POINT = "001";

  function saleSeries(companyId = "", saleType = "", transportType = "") {
    const local = /LOCAL/i.test(String(saleType || "")) || /TERRESTRE|LOCAL/i.test(String(transportType || ""));
    return {
      code: local ? "FAC_LOCAL" : "FAC_EXPORT",
      establishment: "001",
      emissionPoint: local ? "003" : "002",
      market: local ? "LOCAL" : "EXPORTACION"
    };
  }

  // Approved market series; the UUID must still resolve from this company's canonical catalog.
  function resolveEmissionPoint(configuration = {}, context = {}) {
    const companyId = String(context.companyId || "").trim();
    const settings = configuration.settings || {};
    const environment = settings.environment;
    if (!companyId || String(settings.company_id || "") !== companyId || !["TEST", "PRODUCTION"].includes(environment)) return null;
    const series = saleSeries(companyId, context.saleType, context.transportType);
    const matches = (configuration.emissionPoints || []).filter(point => (
      point.id && String(point.company_id || "") === companyId
      && point.active === true && point.environment === environment
      && point.establishment_code === series.establishment
      && point.emission_point_code === series.emissionPoint
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  function digits(value) {
    return String(value ?? "").replace(/\D+/g, "");
  }

  function sequenceText(value) {
    const source = String(value ?? "").trim();
    if (!source) return "";

    const fullNumber = /^(\d{3})-(\d{3})-(\d{9})$/.exec(source);
    if (fullNumber) return fullNumber[3];

    const compact = digits(source);
    if (compact.length === 49) return compact.slice(30, 39);
    if (/^\d{1,9}$/.test(source)) return source.padStart(9, "0");
    if (/^\d{15}$/.test(compact) && /^[\d-]+$/.test(source)) return compact.slice(-9);
    return "";
  }

  function fullNumberParts(value) {
    const match = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(value ?? "").trim());
    return match ? {
      establishment: match[1],
      emissionPoint: match[2],
      sequence: match[3]
    } : null;
  }

  function formatFullNumber(sequence, establishment = DEFAULT_ESTABLISHMENT, emissionPoint = DEFAULT_EMISSION_POINT) {
    const normalized = sequenceText(sequence);
    if (!normalized) return "";
    const establishmentCode = digits(establishment).slice(-3).padStart(3, "0");
    const emissionPointCode = digits(emissionPoint).slice(-3).padStart(3, "0");
    return `${establishmentCode}-${emissionPointCode}-${normalized}`;
  }

  function orderSequence(orderNumber) {
    const match = String(orderNumber ?? "").match(/(\d+)$/);
    if (!match) return "";
    return String(Number(match[1]) || 0).padStart(9, "0").slice(-9);
  }

  function resolveSequence(order = {}, options = {}) {
    return sequenceText(options.authoritativeFullNumber)
      || sequenceText(order.sriInvoiceNumber)
      || sequenceText(order.sriSequential)
      || sequenceText(order.packingListNumber)
      || sequenceText(order.invoicePackingNumber)
      || sequenceText(order.clientInvoiceNumber)
      || sequenceText(options.sequence)
      || (options.allowOrderNumberFallback === false ? "" : orderSequence(order.number));
  }

  function visibleInvoiceNumber(order = {}, fallback = "") {
    return resolveSequence(order, { allowOrderNumberFallback: false }) || String(fallback || "");
  }

  function synchronize(order = {}, options = {}) {
    const sequence = resolveSequence(order, options);
    if (!sequence) return { ...order };
    const existingParts = fullNumberParts(options.authoritativeFullNumber || order.sriInvoiceNumber);
    const establishment = options.establishment || existingParts?.establishment || DEFAULT_ESTABLISHMENT;
    const emissionPoint = options.emissionPoint || existingParts?.emissionPoint || DEFAULT_EMISSION_POINT;
    const authoritative = Boolean(options.authoritativeFullNumber);
    return {
      ...order,
      sriInvoiceNumber: formatFullNumber(sequence, establishment, emissionPoint),
      packingListNumber: sequence,
      invoicePackingNumber: sequence,
      clientInvoiceNumber: sequence,
      sriSequential: sequence,
      sriSequenceSource: authoritative ? "SRI_DB" : (order.sriSequenceSource || "LOCAL_RESERVADO")
    };
  }

  function sequenceNumber(order = {}) {
    return Number(resolveSequence(order)) || 0;
  }

  function nextSequence(orders = [], options = {}) {
    const configuredFloor = Math.max(0, Number(options.currentNumber || 0));
    const highest = (orders || []).reduce((maximum, order) => Math.max(maximum, sequenceNumber(order)), configuredFloor);
    if (highest >= 999999999) throw new Error("El secuencial SRI alcanzo el limite de 9 digitos.");
    return String(highest + 1).padStart(9, "0");
  }

  function isSynchronized(order = {}) {
    const parts = fullNumberParts(order.sriInvoiceNumber);
    return Boolean(parts
      && parts.sequence === sequenceText(order.packingListNumber)
      && parts.sequence === sequenceText(order.invoicePackingNumber)
      && parts.sequence === sequenceText(order.clientInvoiceNumber));
  }

  return {
    DEFAULT_EMISSION_POINT,
    DEFAULT_ESTABLISHMENT,
    formatFullNumber,
    fullNumberParts,
    isSynchronized,
    nextSequence,
    orderSequence,
    resolveSequence,
    resolveEmissionPoint,
    saleSeries,
    sequenceText,
    synchronize,
    visibleInvoiceNumber
  };
});
