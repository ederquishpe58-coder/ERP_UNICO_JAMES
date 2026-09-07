(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.BlessERP = root.BlessERP || {}; root.BlessERP.purchaseVatCore = api; }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // SRI offline technical sheet 2.34, table 17. These are invoice VAT codes,
  // never withholding percentages. Effective applicability belongs to the document/catalog.
  const rates = Object.freeze({ "0": 0, "2": 12, "3": 14, "4": 15, "5": 5, "6": 0, "7": 0, "10": 13 });
  function fail(message) { throw new Error(`PURCHASE_VAT_CODE_RATE_MISMATCH: ${message}`); }
  function resolve({ rate, percentageCode, category = "TARIFA", issueDate } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(issueDate || "")) || !Number.isFinite(Date.parse(issueDate))
        || new Date(`${issueDate}T00:00:00Z`).toISOString().slice(0, 10) !== issueDate) fail("fecha del documento requerida");
    if (rate === null || rate === undefined || String(rate).trim() === "" || !Number.isFinite(Number(rate)) || Number(rate) < 0) fail("tarifa requerida");
    const value = Number(rate);
    let code = String(percentageCode ?? "").trim();
    if (!code) {
      if (category === "NO_OBJETO") code = "6";
      else if (category === "EXENTO") code = "7";
      else if (value >= 8 && value < 12) code = "8";
      else code = Object.keys(rates).find(key => !["6", "7"].includes(key) && rates[key] === value) || "";
    }
    const compatible = code === "8" ? value >= 8 && value < 12 : Object.hasOwn(rates, code) && rates[code] === value;
    if (!compatible || (category === "NO_OBJETO" && code !== "6") || (category === "EXENTO" && code !== "7")) fail(`código ${code || "vacío"}, tarifa ${value}`);
    return { code: "2", percentageCode: code, rate: value };
  }
  function supportingTax(line, issueDate) {
    return { ...resolve({ rate: line.vatRate, percentageCode: line.vatCode, category: line.vatCategory, issueDate }),
      taxableBase: Number(line.taxableBase), value: Number(line.vatValue) };
  }
  function validateSupportingDocuments(documents = []) {
    for (const doc of documents) for (const tax of doc.taxes || []) {
      if (String(tax.code) === "2") {
        if (tax.percentageCode === null || tax.percentageCode === undefined || String(tax.percentageCode).trim() === "") fail("código del IVA del sustento requerido");
        resolve({ rate: tax.rate, percentageCode: tax.percentageCode, issueDate: doc.issueDate });
      }
    }
  }
  return Object.freeze({ resolve, supportingTax, validateSupportingDocuments });
});
