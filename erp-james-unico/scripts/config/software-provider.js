(function(root, factory){
  const provider = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = provider;
    return;
  }
  const BlessERP = root.BlessERP = root.BlessERP || {};
  BlessERP.softwareProvider = provider;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  const configuration = Object.freeze({
    billingSystemProviderEnabled: false,
    mode: "OWN_INTERNAL",
    providerRuc: "1754767067001",
    providerName: "LANCHIMBA TIPANLUISA JAMES SANTIAGO",
    providerPhone: "0983072006",
    providerEmail: "jameslanchimba14@gmail.com"
  });

  const profile = Object.freeze({
    productName: "JAEDER SYSTEMS",
    ruc: configuration.providerRuc,
    legalName: configuration.providerName,
    phone: configuration.providerPhone,
    email: configuration.providerEmail
  });

  const providerFieldNames = Object.freeze([
    "RUC Proveedor",
    "Proveedor del sistema",
    "RUC proveedor del sistema"
  ]);
  const normalizedProviderFieldNames = new Set(providerFieldNames.map(value => value.toLocaleUpperCase("es")));
  const publicAdditionalInformation = Object.freeze(configuration.billingSystemProviderEnabled
    ? { "RUC Proveedor": configuration.providerRuc }
    : {});

  function isProviderField(name) {
    return normalizedProviderFieldNames.has(String(name || "").trim().toLocaleUpperCase("es"));
  }

  function mergeAdditionalInformation(values = {}) {
    const businessRows = Object.entries(values || {})
      .filter(([key, value]) => String(key || "").trim() && String(value ?? "").trim())
      .filter(([key]) => !isProviderField(key))
      .slice(0, Math.max(15 - Object.keys(publicAdditionalInformation).length, 0));
    return Object.fromEntries([
      ...businessRows,
      ...Object.entries(publicAdditionalInformation)
    ]);
  }

  function hasExpectedProviderField(xmlText) {
    const xml = String(xmlText || "");
    const hasProviderField = xml.includes('nombre="RUC Proveedor"');
    if (!configuration.billingSystemProviderEnabled) return !hasProviderField;
    return hasProviderField && xml.includes(configuration.providerRuc);
  }

  return Object.freeze({
    ...configuration,
    ...profile,
    configuration,
    profile,
    providerFieldNames,
    publicAdditionalInformation,
    isProviderField,
    mergeAdditionalInformation,
    hasExpectedProviderField,
    hasRequiredRucField: hasExpectedProviderField
  });
});
