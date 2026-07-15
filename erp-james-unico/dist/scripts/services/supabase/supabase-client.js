(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function envConfig() {
    return BlessERP.getEnvConfig ? BlessERP.getEnvConfig() : {
      supabaseEnabled: false,
      supabaseUrl: "",
      supabaseAnonKey: "",
      appEnv: "demo",
      authEnabled: false,
      rlsEnabled: false
    };
  }

  function runtimeFactory() {
    const maybeFactory = window.supabase?.createClient || window.createSupabaseClient || null;
    return typeof maybeFactory === "function" ? maybeFactory : null;
  }

  function isSupabaseConfigured() {
    const config = envConfig();
    return Boolean(config.supabaseEnabled && config.supabaseUrl && config.supabaseAnonKey);
  }

  function getSupabaseStatus() {
    const config = envConfig();
    const enabled = Boolean(config.supabaseEnabled);
    const configured = isSupabaseConfigured();
    const hasFactory = Boolean(runtimeFactory());

    if (!enabled) {
      return {
        enabled: false,
        configured: false,
        mode: "DISABLED_DEMO",
        message: "Supabase desactivado. ERP usando modo local/demo.",
        appEnv: config.appEnv || "demo",
        authEnabled: Boolean(config.authEnabled),
        rlsEnabled: Boolean(config.rlsEnabled),
        hasRuntimeFactory: hasFactory
      };
    }

    if (!configured) {
      return {
        enabled: true,
        configured: false,
        mode: "MISCONFIGURED_DEMO",
        message: "Supabase habilitado en variables, pero faltan URL o ANON KEY. ERP sigue en modo local/demo.",
        appEnv: config.appEnv || "demo",
        authEnabled: Boolean(config.authEnabled),
        rlsEnabled: Boolean(config.rlsEnabled),
        hasRuntimeFactory: hasFactory
      };
    }

    if (!hasFactory) {
      return {
        enabled: true,
        configured: true,
        mode: "PENDING_CLIENT_LIBRARY",
        message: "Supabase configurado, pero la libreria cliente no esta cargada. ERP sigue en modo local/demo.",
        appEnv: config.appEnv || "demo",
        authEnabled: Boolean(config.authEnabled),
        rlsEnabled: Boolean(config.rlsEnabled),
        hasRuntimeFactory: false
      };
    }

    return {
      enabled: true,
      configured: true,
      mode: "READY_NOT_CONNECTED",
      message: "Cliente Supabase preparado. La conexion real debera activarse en una fase posterior.",
      appEnv: config.appEnv || "demo",
      authEnabled: Boolean(config.authEnabled),
      rlsEnabled: Boolean(config.rlsEnabled),
      hasRuntimeFactory: true
    };
  }

  function assertSupabaseEnabled() {
    const status = getSupabaseStatus();
    if (!status.enabled || !status.configured) {
      throw new Error(status.message);
    }
    return status;
  }

  function getSupabaseClient() {
    const status = getSupabaseStatus();
    if (!status.enabled || !status.configured || !status.hasRuntimeFactory) return null;
    const config = envConfig();
    try {
      return runtimeFactory()(config.supabaseUrl, config.supabaseAnonKey);
    } catch (error) {
      return null;
    }
  }

  BlessERP.getSupabaseClient = getSupabaseClient;
  BlessERP.isSupabaseConfigured = isSupabaseConfigured;
  BlessERP.assertSupabaseEnabled = assertSupabaseEnabled;
  BlessERP.getSupabaseStatus = getSupabaseStatus;
})();
