(function(root, factory){
  const provider = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = provider;
    return;
  }
  const BlessERP = root.BlessERP = root.BlessERP || {};
  BlessERP.softwareProvider = provider;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  const profile = Object.freeze({
    productName: "JAEDER SYSTEMS",
    ruc: "1754767067001",
    legalName: "LANCHIMBA TIPANLUISA JAMES SANTIAGO",
    phone: "0983072006",
    email: "jameslanchimba14@gmail.com"
  });

  const publicAdditionalInformation = Object.freeze({
    "RUC Proveedor": profile.ruc
  });

  function mergeAdditionalInformation(values = {}) {
    const providerKeys = new Set(Object.keys(publicAdditionalInformation));
    const businessRows = Object.entries(values || {})
      .filter(([key, value]) => String(key || "").trim() && String(value ?? "").trim())
      .filter(([key]) => !providerKeys.has(String(key).trim()))
      .slice(0, Math.max(15 - providerKeys.size, 0));
    return Object.fromEntries([
      ...businessRows,
      ...Object.entries(publicAdditionalInformation)
    ]);
  }

  function hasRequiredRucField(xmlText) {
    const xml = String(xmlText || "");
    return xml.includes('nombre="RUC Proveedor"')
      && xml.includes(profile.ruc);
  }

  return Object.freeze({
    ...profile,
    profile,
    publicAdditionalInformation,
    mergeAdditionalInformation,
    hasRequiredRucField
  });
});
