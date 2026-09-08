(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    const BlessERP = root.BlessERP = root.BlessERP || {};
    BlessERP.sriFiscalDate = api;
  }
})(typeof window === "object" ? window : globalThis, function () {
  const ECUADOR_TIME_ZONE = "America/Guayaquil";

  // Resolve an instant to Ecuador's civil day. Persisted date-only values and
  // supporting-document dates must not be converted through this clock helper.
  function ecuadorDate(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) throw new RangeError("La fecha de proceso SRI no es valida.");
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: ECUADOR_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  return Object.freeze({ ECUADOR_TIME_ZONE, ecuadorDate });
});
