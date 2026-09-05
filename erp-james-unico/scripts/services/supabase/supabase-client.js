(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let cachedClient = null;

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

  function measuredFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    let operation = "solicitud";
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const restIndex = parts.findIndex((part, index) => part === "v1" && parts[index - 1] === "rest");
      const table = restIndex >= 0 ? parts[restIndex + 1] : "";
      operation = table ? `rest/${table}` : (parts.slice(0, 3).join("/") || parsed.hostname);
    } catch {
      operation = "solicitud";
    }
    const execute = () => window.fetch(input, init);
    return BlessERP.performance?.measureAsync?.(`supabase:${operation}`, execute, {
      method: String(init?.method || "GET").toUpperCase()
    }) || execute();
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
        mode: "DISABLED_LOCAL",
        message: "Supabase desactivado. JAEDER SYSTEMS usa almacenamiento local.",
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
        message: "Supabase habilitado en variables, pero faltan URL o ANON KEY. ERP sigue usando almacenamiento local.",
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
        message: "Supabase configurado, pero la libreria cliente no esta cargada. ERP sigue usando almacenamiento local.",
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
        message: "Cliente Supabase preparado para los modulos habilitados.",
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
      if (!cachedClient) {
        cachedClient = runtimeFactory()(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          },
          global: {
            fetch: measuredFetch
          }
        });
      }
      return cachedClient;
    } catch (error) {
      return null;
    }
  }

  BlessERP.getSupabaseClient = getSupabaseClient;
  BlessERP.isSupabaseConfigured = isSupabaseConfigured;
  BlessERP.assertSupabaseEnabled = assertSupabaseEnabled;
  BlessERP.getSupabaseStatus = getSupabaseStatus;
})();
