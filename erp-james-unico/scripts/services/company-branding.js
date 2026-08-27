(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const FALLBACK_IDS = Object.freeze({
    BLESS: "COMP-BLESS-FLOWER",
    IMPERIO: "COMP-IMPERIO-FLOWERS"
  });

  function clone(value) {
    if (BlessERP.utils?.clone) return BlessERP.utils.clone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function companyIds() {
    return BlessERP.companyCapabilities?.COMPANY_IDS || FALLBACK_IDS;
  }

  function normalizeCompanyId(value) {
    const ids = companyIds();
    const candidate = String(value || "").trim();
    if ([ids.BLESS, ids.IMPERIO].includes(candidate)) return candidate;
    return BlessERP.services?.companyContext?.activeCompanyId?.() || ids.BLESS;
  }

  function companyIdFromOrder(order = {}) {
    return normalizeCompanyId(
      order.sellingCompanyId
      || order.sellerCompanyId
      || order.companyId
      || order.company_id
    );
  }

  function profile(companyId) {
    const id = normalizeCompanyId(companyId);
    const contextProfile = BlessERP.services?.companyContext?.company?.(id);
    if (contextProfile) return contextProfile;
    return clone(BlessERP.companyCapabilities?.COMPANY_PROFILES?.[id] || {});
  }

  function settings(companyId) {
    const id = normalizeCompanyId(companyId);
    const fromContext = BlessERP.services?.companyContext?.companySettings?.(id);
    if (fromContext && Object.keys(fromContext).length) return fromContext;
    const db = BlessERP.state?.state?.db || {};
    return clone(
      db.companyStores?.[id]?.companySettings
      || (db.activeCompanyId === id ? db.companySettings : {})
      || {}
    );
  }

  function resolve(companyId) {
    const id = normalizeCompanyId(companyId);
    const ids = companyIds();
    const base = BlessERP.comercialData?.company || {};
    const companyProfile = profile(id);
    const companySettings = settings(id);
    const isImperio = id === ids.IMPERIO;
    const commercialName = companySettings.commercialName
      || companyProfile.commercialName
      || (isImperio ? "Imperio Flowers" : "Bless Flower");
    const legalName = companySettings.legalName
      || companyProfile.legalName
      || commercialName;
    const matrixAddress = companySettings.matrixAddress
      || companySettings.branchAddress
      || companyProfile.address
      || (isImperio ? "" : base.address)
      || "";

    return {
      ...clone(base),
      ...clone(companyProfile),
      ...clone(companySettings),
      id,
      companyId: id,
      company_id: id,
      commercialName,
      legalName,
      ruc: String(companySettings.ruc || companyProfile.ruc || "").trim(),
      address: matrixAddress,
      address2: companySettings.branchAddress && companySettings.branchAddress !== matrixAddress
        ? companySettings.branchAddress
        : (isImperio ? "" : base.address2 || ""),
      city: companySettings.city || companyProfile.city || (isImperio ? "Ecuador" : base.city || "Ecuador"),
      phone: companySettings.phone || companyProfile.phone || (isImperio ? "" : base.phone || ""),
      email: companySettings.email || companyProfile.email || (isImperio ? "" : base.email || ""),
      logoPath: isImperio
        ? (companySettings.logoPath || companyProfile.logoPath || "scripts/assets/imperio-flowers-logo.png")
        : (companyProfile.logoPath || "scripts/assets/bless-flower-logo-official-transparent.png"),
      farmCode: companySettings.farmCode || companyProfile.farmCode || (isImperio ? "IMP" : base.farmCode || "BLE"),
      originCountryAlpha2: String(companySettings.originCountryAlpha2 || companyProfile.originCountryAlpha2 || "EC").trim().toUpperCase(),
      preparedBy: companySettings.preparedBy || companyProfile.preparedBy || "Departamento Comercial",
      incoterm: companySettings.incoterm || companyProfile.incoterm || base.incoterm || "FCA UIO",
      sriEnvironment: "PRUEBAS"
    };
  }

  function resolveForOrder(order = {}) {
    return resolve(companyIdFromOrder(order));
  }

  function isImperio(value) {
    const id = typeof value === "object" ? companyIdFromOrder(value) : normalizeCompanyId(value);
    return id === companyIds().IMPERIO;
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.companyBranding = {
    companyIdFromOrder,
    isImperio,
    normalizeCompanyId,
    resolve,
    resolveForOrder,
    settings
  };
})();
