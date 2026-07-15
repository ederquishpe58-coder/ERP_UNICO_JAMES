(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const DEFAULTS = {
    VITE_SUPABASE_ENABLED: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
    VITE_APP_ENV: "demo",
    VITE_COMPANY_MODE: "single",
    VITE_ENABLE_AUTH: "false",
    VITE_ENABLE_RLS: "false",
    VITE_ENABLE_SRI: "false",
    VITE_ENABLE_REAL_INVENTORY: "false",
    VITE_ENABLE_REAL_ACCOUNTING: "false",
    VITE_ENABLE_REAL_SCANNER: "false",
    VITE_ENABLE_CORE_SUPABASE: "false",
    VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE: "false",
    VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE: "false",
    VITE_ENABLE_OPERATIONS_SUPABASE: "false",
    VITE_ENABLE_SCANNER_SUPABASE: "false",
    VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE: "false",
    VITE_ENABLE_ACCOUNTING_SUPABASE: "false",
    VITE_ENABLE_SRI_SUPABASE: "false"
  };

  function readImportMetaEnv() {
    try {
      const metaEnv = (0, eval)("import.meta.env");
      return metaEnv && typeof metaEnv === "object" ? metaEnv : {};
    } catch (error) {
      return {};
    }
  }

  function readWindowEnv() {
    const runtimeEnv = window.__ERP_ENV__;
    return runtimeEnv && typeof runtimeEnv === "object" ? runtimeEnv : {};
  }

  function readRawEnv() {
    return {
      ...DEFAULTS,
      ...readWindowEnv(),
      ...readImportMetaEnv()
    };
  }

  function asBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return fallback;
    if (["true", "1", "yes", "si", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return fallback;
  }

  function getEnvConfig() {
    const raw = readRawEnv();
    const supabaseEnabled = asBoolean(raw.VITE_SUPABASE_ENABLED, false);
    return {
      raw,
      supabaseEnabled,
      supabaseUrl: String(raw.VITE_SUPABASE_URL || "").trim(),
      supabaseAnonKey: String(raw.VITE_SUPABASE_ANON_KEY || "").trim(),
      authEnabled: asBoolean(raw.VITE_ENABLE_AUTH, false),
      rlsEnabled: asBoolean(raw.VITE_ENABLE_RLS, false),
      sriEnabled: asBoolean(raw.VITE_ENABLE_SRI, false),
      realInventoryEnabled: asBoolean(raw.VITE_ENABLE_REAL_INVENTORY, false),
      realAccountingEnabled: asBoolean(raw.VITE_ENABLE_REAL_ACCOUNTING, false),
      realScannerEnabled: asBoolean(raw.VITE_ENABLE_REAL_SCANNER, false),
      coreSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_CORE_SUPABASE, false),
      commercialCatalogsSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE, false),
      commercialOrdersSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE, false),
      operationsSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_OPERATIONS_SUPABASE, false),
      scannerSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_SCANNER_SUPABASE, false),
      materialInventorySupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE, false),
      accountingSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_ACCOUNTING_SUPABASE, false),
      sriSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_SRI_SUPABASE, false),
      appEnv: String(raw.VITE_APP_ENV || "demo").trim() || "demo",
      companyMode: String(raw.VITE_COMPANY_MODE || "single").trim() || "single"
    };
  }

  function isSupabaseEnabled() {
    return getEnvConfig().supabaseEnabled;
  }

  function isAuthEnabled() {
    return getEnvConfig().authEnabled;
  }

  function isSriEnabled() {
    return getEnvConfig().sriEnabled;
  }

  function isRealInventoryEnabled() {
    return getEnvConfig().realInventoryEnabled;
  }

  function isRealAccountingEnabled() {
    return getEnvConfig().realAccountingEnabled;
  }

  function isRealScannerEnabled() {
    return getEnvConfig().realScannerEnabled;
  }

  function getAppMode() {
    return getEnvConfig().appEnv || "demo";
  }

  function isCoreSupabaseEnabled() {
    return getEnvConfig().coreSupabaseEnabled;
  }

  function isCommercialCatalogsSupabaseEnabled() {
    return getEnvConfig().commercialCatalogsSupabaseEnabled;
  }

  function isCommercialOrdersSupabaseEnabled() {
    return getEnvConfig().commercialOrdersSupabaseEnabled;
  }

  function isOperationsSupabaseEnabled() {
    return getEnvConfig().operationsSupabaseEnabled;
  }

  function isScannerSupabaseEnabled() {
    return getEnvConfig().scannerSupabaseEnabled;
  }

  function isMaterialInventorySupabaseEnabled() {
    return getEnvConfig().materialInventorySupabaseEnabled;
  }

  function isAccountingSupabaseEnabled() {
    return getEnvConfig().accountingSupabaseEnabled;
  }

  function isSriSupabaseEnabled() {
    return getEnvConfig().sriSupabaseEnabled;
  }

  function getFeatureFlagsStatus() {
    const config = getEnvConfig();
    return {
      supabaseGlobalEnabled: config.supabaseEnabled,
      core: config.coreSupabaseEnabled,
      commercialCatalogs: config.commercialCatalogsSupabaseEnabled,
      commercialOrders: config.commercialOrdersSupabaseEnabled,
      operations: config.operationsSupabaseEnabled,
      scanner: config.scannerSupabaseEnabled,
      materialInventory: config.materialInventorySupabaseEnabled,
      accounting: config.accountingSupabaseEnabled,
      sri: config.sriSupabaseEnabled
    };
  }

  BlessERP.getEnvConfig = getEnvConfig;
  BlessERP.isSupabaseEnabled = isSupabaseEnabled;
  BlessERP.isAuthEnabled = isAuthEnabled;
  BlessERP.isSriEnabled = isSriEnabled;
  BlessERP.isRealInventoryEnabled = isRealInventoryEnabled;
  BlessERP.isRealAccountingEnabled = isRealAccountingEnabled;
  BlessERP.isRealScannerEnabled = isRealScannerEnabled;
  BlessERP.getAppMode = getAppMode;
  BlessERP.isCoreSupabaseEnabled = isCoreSupabaseEnabled;
  BlessERP.isCommercialCatalogsSupabaseEnabled = isCommercialCatalogsSupabaseEnabled;
  BlessERP.isCommercialOrdersSupabaseEnabled = isCommercialOrdersSupabaseEnabled;
  BlessERP.isOperationsSupabaseEnabled = isOperationsSupabaseEnabled;
  BlessERP.isScannerSupabaseEnabled = isScannerSupabaseEnabled;
  BlessERP.isMaterialInventorySupabaseEnabled = isMaterialInventorySupabaseEnabled;
  BlessERP.isAccountingSupabaseEnabled = isAccountingSupabaseEnabled;
  BlessERP.isSriSupabaseEnabled = isSriSupabaseEnabled;
  BlessERP.getFeatureFlagsStatus = getFeatureFlagsStatus;
})();
