(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const DEFAULTS = {
    VITE_SUPABASE_ENABLED: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
    VITE_APP_ENV: "local",
    VITE_COMPANY_MODE: "multi",
    VITE_ENABLE_AUTH: "false",
    VITE_ENABLE_RLS: "false",
    VITE_ENABLE_SRI: "false",
    VITE_ENABLE_REAL_INVENTORY: "false",
    VITE_ENABLE_REAL_ACCOUNTING: "false",
    VITE_ENABLE_REAL_SCANNER: "false",
    VITE_ENABLE_CORE_SUPABASE: "false",
    VITE_ENABLE_INCREMENTAL_SYNC: "false",
    VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE: "false",
    VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE: "false",
    VITE_ENABLE_OPERATIONS_SUPABASE: "false",
    VITE_ENABLE_OPERATIONS_V2_CAPTURE: "false",
    VITE_ENABLE_SCANNER_SUPABASE: "false",
    VITE_ENABLE_ZEBRA_V2_CAPTURE: "false",
    VITE_ENABLE_WAREHOUSE_V2_CAPTURE: "false",
    VITE_ENABLE_DISPATCH_V2_CAPTURE: "false",
    VITE_ENABLE_EXPORT_V2_CAPTURE: "false",
    VITE_ENABLE_FINANCIAL_V2_CAPTURE: "false",
    VITE_ENABLE_SUPPLIER_FINANCE_V2_CAPTURE: "false",
    VITE_ENABLE_TREASURY_V2_CAPTURE: "false",
    VITE_ENABLE_PAYROLL_V2_CAPTURE: "false",
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

  function strictLocalFileMode() {
    return window.__ERP_LOCAL_MODE__ === true || window.location?.protocol === "file:";
  }

  function readRawEnv() {
    const configured = {
      ...DEFAULTS,
      ...readWindowEnv(),
      ...readImportMetaEnv()
    };
    if (!strictLocalFileMode()) return configured;
    return {
      ...configured,
      VITE_SUPABASE_ENABLED: "false",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_APP_ENV: "local-isolated",
      VITE_ENABLE_AUTH: "false",
      VITE_ENABLE_RLS: "false",
      VITE_ENABLE_CORE_SUPABASE: "false",
      VITE_ENABLE_INCREMENTAL_SYNC: "false",
      VITE_ENABLE_ACCOUNTING_SUPABASE: "false",
      VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE: "false",
      VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE: "false",
      VITE_ENABLE_OPERATIONS_SUPABASE: "false",
      VITE_ENABLE_OPERATIONS_V2_CAPTURE: "false",
      VITE_ENABLE_SCANNER_SUPABASE: "false",
      VITE_ENABLE_ZEBRA_V2_CAPTURE: "false",
      VITE_ENABLE_WAREHOUSE_V2_CAPTURE: "false",
      VITE_ENABLE_DISPATCH_V2_CAPTURE: "false",
      VITE_ENABLE_EXPORT_V2_CAPTURE: "false",
      VITE_ENABLE_FINANCIAL_V2_CAPTURE: "false",
      VITE_ENABLE_SUPPLIER_FINANCE_V2_CAPTURE: "false",
      VITE_ENABLE_TREASURY_V2_CAPTURE: "false",
      VITE_ENABLE_PAYROLL_V2_CAPTURE: "false",
      VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE: "false",
      VITE_ENABLE_SRI_SUPABASE: "false"
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
      incrementalSyncEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_INCREMENTAL_SYNC, false),
      commercialCatalogsSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE, false),
      commercialOrdersSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE, false),
      operationsSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_OPERATIONS_SUPABASE, false),
      operationsV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_OPERATIONS_V2_CAPTURE, false),
      scannerSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_SCANNER_SUPABASE, false),
      zebraV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_ZEBRA_V2_CAPTURE, false),
      warehouseV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_WAREHOUSE_V2_CAPTURE, false),
      dispatchV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_DISPATCH_V2_CAPTURE, false),
      exportV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_EXPORT_V2_CAPTURE, false),
      financialV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_FINANCIAL_V2_CAPTURE, false),
      supplierFinanceV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_SUPPLIER_FINANCE_V2_CAPTURE, false),
      treasuryV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_TREASURY_V2_CAPTURE, false),
      payrollV2CaptureEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_PAYROLL_V2_CAPTURE, false),
      materialInventorySupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE, false),
      accountingSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_ACCOUNTING_SUPABASE, false),
      sriSupabaseEnabled: supabaseEnabled && asBoolean(raw.VITE_ENABLE_SRI_SUPABASE, false),
      appEnv: String(raw.VITE_APP_ENV || "local").trim() || "local",
      companyMode: String(raw.VITE_COMPANY_MODE || "multi").trim() || "multi"
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
    return getEnvConfig().appEnv || "local";
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
      operationsV2Capture: config.operationsV2CaptureEnabled,
      scanner: config.scannerSupabaseEnabled,
      zebraV2Capture: config.zebraV2CaptureEnabled,
      warehouseV2Capture: config.warehouseV2CaptureEnabled,
      dispatchV2Capture: config.dispatchV2CaptureEnabled,
      exportV2Capture: config.exportV2CaptureEnabled,
      financialV2Capture: config.financialV2CaptureEnabled,
      supplierFinanceV2Capture: config.supplierFinanceV2CaptureEnabled,
      treasuryV2Capture: config.treasuryV2CaptureEnabled,
      payrollV2Capture: config.payrollV2CaptureEnabled,
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
