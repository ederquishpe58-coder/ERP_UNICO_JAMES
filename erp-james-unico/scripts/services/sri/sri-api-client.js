(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const TEST_ENVIRONMENT = Object.freeze({ name: "TEST", code: "1", label: "PRUEBAS" });
  const ACTIVE_COMPANY_SESSION_KEY = "erp-james-sri-active-company";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PROFILE_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "BLESS_FLOWER",
      aliases: Object.freeze(["BLESS", "BLESS FLOWER", "COMP-BLESS-FLOWER"]),
      legalName: "MANUEL CLEMENTE LANCHIMBA TUTILLO",
      commercialName: "BLESS FLOWER",
      ruc: "1717637084001",
      habitualExporterLegend: "EXPORTADOR HABITUAL DE BIENES",
      deliveryGuidesEnabled: false,
      environment: TEST_ENVIRONMENT.name,
      environmentCode: TEST_ENVIRONMENT.code,
      defaultEstablishment: "001",
      defaultEmissionPoint: "003"
    }),
    Object.freeze({
      key: "IMPERIO_FLOWERS",
      aliases: Object.freeze(["IMPERIO", "IMPERIO FLOWERS", "COMP-IMPERIO-FLOWERS"]),
      legalName: "LANCHIMBA TIPANLUISA SANDY ANAHI",
      commercialName: "IMPERIO FLOWERS",
      ruc: "1727970137001",
      habitualExporterLegend: "",
      deliveryGuidesEnabled: false,
      environment: TEST_ENVIRONMENT.name,
      environmentCode: TEST_ENVIRONMENT.code,
      defaultEstablishment: "001",
      defaultEmissionPoint: "001"
    })
  ]);

  let realtimeChannel = null;
  let realtimeCompanyId = "";
  let membershipDiscoveryPromise = null;
  const runtimeBindings = new Map();

  function sessionStorageApi() {
    try {
      return window.sessionStorage || null;
    } catch {
      return null;
    }
  }

  function normalizeCompanyReference(value) {
    return String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
  }

  function profileDefinition(companyKey) {
    const normalized = normalizeCompanyReference(companyKey);
    return PROFILE_DEFINITIONS.find(profile => (
      normalizeCompanyReference(profile.key) === normalized
      || profile.aliases.some(alias => normalizeCompanyReference(alias) === normalized)
      || normalizeCompanyReference(profile.ruc) === normalized
      || String(runtimeBindings.get(profile.key)?.companyId || "") === String(companyKey || "")
    )) || null;
  }

  function configuredInitialCompanyKey() {
    const stored = sessionStorageApi()?.getItem(ACTIVE_COMPANY_SESSION_KEY);
    return profileDefinition(stored)?.key || PROFILE_DEFINITIONS[0].key;
  }

  let selectedCompanyKey = configuredInitialCompanyKey();

  function publicProfile(profile) {
    if (!profile) return null;
    const binding = runtimeBindings.get(profile.key) || {};
    return {
      key: profile.key,
      legalName: profile.legalName,
      commercialName: profile.commercialName,
      ruc: profile.ruc,
      habitualExporterLegend: profile.habitualExporterLegend,
      deliveryGuidesEnabled: profile.deliveryGuidesEnabled,
      environment: profile.environment,
      environmentCode: profile.environmentCode,
      defaultEstablishment: profile.defaultEstablishment,
      defaultEmissionPoint: profile.defaultEmissionPoint,
      companyId: binding.companyId || "",
      roleCode: binding.roleCode || "",
      bound: Boolean(binding.companyId)
    };
  }

  function companyProfiles() {
    return PROFILE_DEFINITIONS.map(publicProfile);
  }

  function activeCompanyKey() {
    return selectedCompanyKey;
  }

  function activeCompany() {
    return publicProfile(profileDefinition(selectedCompanyKey));
  }

  function selectCompany(companyKey) {
    const profile = profileDefinition(companyKey);
    if (!profile) throw new Error("La empresa SRI solicitada no esta configurada.");
    if (profile.key === selectedCompanyKey) return publicProfile(profile);
    selectedCompanyKey = profile.key;
    sessionStorageApi()?.setItem(ACTIVE_COMPANY_SESSION_KEY, selectedCompanyKey);
    unsubscribe();
    return publicProfile(profile);
  }

  function companyKeyForReference(reference, fallbackKey = "BLESS_FLOWER") {
    return profileDefinition(reference)?.key || profileDefinition(fallbackKey)?.key || PROFILE_DEFINITIONS[0].key;
  }

  function orderCompanyKey(order = {}) {
    const explicit = order.sriCompanyKey
      || order.companyKey
      || order.company_key
      || order.companyId
      || order.company_id;
    return companyKeyForReference(explicit, "BLESS_FLOWER");
  }

  function companyIdentity(companyKey = selectedCompanyKey) {
    const profile = profileDefinition(companyKey);
    if (!profile) throw new Error("La identidad tributaria solicitada no existe.");
    return {
      key: profile.key,
      legalName: profile.legalName,
      commercialName: profile.commercialName,
      ruc: profile.ruc,
      environment: TEST_ENVIRONMENT.name,
      environmentCode: TEST_ENVIRONMENT.code
    };
  }

  function client() {
    return BlessERP.getSupabaseClient?.() || null;
  }

  function status() {
    const env = BlessERP.getEnvConfig?.() || {};
    const supabaseStatus = BlessERP.getSupabaseStatus?.() || {};
    const ready = Boolean(
      env.supabaseEnabled && env.sriEnabled && env.sriSupabaseEnabled &&
      env.authEnabled && supabaseStatus.configured && supabaseStatus.hasRuntimeFactory
    );
    return {
      ready,
      env,
      supabaseStatus,
      activeCompany: activeCompany(),
      message: ready
        ? "Conexion tributaria disponible."
        : "Active Supabase, autenticacion y SRI en las variables publicas del despliegue."
    };
  }

  async function session() {
    const supabase = client();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function signIn(email, password) {
    const supabase = client();
    if (!supabase) throw new Error(status().message);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    runtimeBindings.clear();
    membershipDiscoveryPromise = null;
    return data.session;
  }

  async function signOut() {
    const supabase = client();
    if (!supabase) return;
    unsubscribe();
    runtimeBindings.clear();
    membershipDiscoveryPromise = null;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function rawApi(path = "", options = {}) {
    const activeSession = await session();
    if (!activeSession?.access_token) throw new Error("Inicie sesion para acceder a comprobantes electronicos.");
    const response = await fetch(`/api/sri${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${activeSession.access_token}`,
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      if (!response.ok) throw new Error(`La API SRI respondio HTTP ${response.status}.`);
      return response;
    }
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.error?.message || "La operacion SRI no pudo completarse.");
      error.code = payload.error?.code || "SRI_API_ERROR";
      error.retryable = Boolean(payload.error?.retryable);
      error.details = payload.error?.details || null;
      throw error;
    }
    return payload.data;
  }

  function query(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") search.set(key, value);
    });
    return `?${search.toString()}`;
  }

  function bindRuntimeCompany(companyKey, companyId, configuration = null, roleCode = "") {
    const profile = profileDefinition(companyKey);
    if (!profile) throw new Error("No existe el perfil tributario indicado.");
    if (!UUID_PATTERN.test(String(companyId || ""))) throw new Error("El company_id SRI debe ser un UUID valido.");
    const configuredRuc = String(configuration?.settings?.ruc || "");
    if (configuredRuc && configuredRuc !== profile.ruc) {
      throw new Error(`La configuracion remota no corresponde a ${profile.commercialName}.`);
    }
    runtimeBindings.set(profile.key, {
      companyId: String(companyId),
      roleCode: String(roleCode || ""),
      configuration: configuration || null
    });
    return publicProfile(profile);
  }

  async function discoverCompanies(options = {}) {
    if (membershipDiscoveryPromise && !options.force) return membershipDiscoveryPromise;
    membershipDiscoveryPromise = (async () => {
      const supabase = client();
      if (!supabase) throw new Error(status().message);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id) throw new Error("No existe una sesion Supabase autenticada.");
      const { data: memberships, error } = await supabase
        .from("sri_company_memberships")
        .select("company_id, role_code, active")
        .eq("auth_user_id", userData.user.id)
        .eq("active", true);
      if (error) throw error;
      if (!memberships?.length) throw new Error("El usuario no tiene empresas SRI habilitadas.");

      const resolved = [];
      for (const membership of memberships) {
        const configuration = await rawApi(query({
          action: "configuration",
          companyId: membership.company_id
        }));
        const profile = profileDefinition(configuration?.settings?.ruc);
        if (!profile) continue;
        bindRuntimeCompany(profile.key, membership.company_id, configuration, membership.role_code);
        resolved.push(publicProfile(profile));
      }
      return resolved;
    })();
    try {
      return await membershipDiscoveryPromise;
    } catch (error) {
      membershipDiscoveryPromise = null;
      throw error;
    }
  }

  async function ensureActiveCompany() {
    let binding = runtimeBindings.get(selectedCompanyKey);
    if (!binding?.companyId) {
      await discoverCompanies();
      binding = runtimeBindings.get(selectedCompanyKey);
    }
    if (!binding?.companyId) {
      throw new Error(`${activeCompany()?.commercialName || "La empresa"} no esta vinculada a una empresa SRI accesible para este usuario.`);
    }
    return { ...activeCompany(), ...binding };
  }

  async function api(path = "", options = {}) {
    const company = await ensureActiveCompany();
    let scopedPath = path;
    let scopedOptions = { ...options };
    if (String(options.method || "GET").toUpperCase() === "POST") {
      const sourceBody = typeof options.body === "string" && options.body ? JSON.parse(options.body) : (options.body || {});
      scopedOptions = { ...options, body: JSON.stringify({ ...sourceBody, companyId: company.companyId }) };
    } else {
      scopedPath = `${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(company.companyId)}`;
    }
    return rawApi(scopedPath, scopedOptions);
  }

  function list(filters = {}) {
    return api(query({ action: "list", ...filters }));
  }

  function detail(documentId) {
    return api(query({ action: "detail", documentId }));
  }

  async function configuration() {
    const company = await ensureActiveCompany();
    const value = await api(query({ action: "configuration" }));
    runtimeBindings.set(company.key, { ...runtimeBindings.get(company.key), configuration: value });
    return value;
  }

  function post(action, body = {}) {
    return api("", { method: "POST", body: JSON.stringify({ action, ...body }) });
  }

  async function download(fileId) {
    const response = await api(query({ action: "download", fileId }));
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const name = disposition.match(/filename="([^"]+)"/)?.[1] || "documento-sri";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return name;
  }

  async function subscribe(onChange) {
    const supabase = client();
    const company = await ensureActiveCompany();
    if (!supabase) return null;
    if (realtimeChannel && realtimeCompanyId === company.companyId) return realtimeChannel;
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
      realtimeCompanyId = "";
    }
    realtimeChannel = supabase.channel(`sri-electronic-documents-${company.companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${company.companyId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "sri_transmissions", filter: `company_id=eq.${company.companyId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounting_document_links", filter: `company_id=eq.${company.companyId}` }, onChange)
      .subscribe();
    realtimeCompanyId = company.companyId;
    return realtimeChannel;
  }

  function unsubscribe() {
    const supabase = client();
    if (supabase && realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
    realtimeCompanyId = "";
  }

  function numericText(value, length, label) {
    const normalized = String(value ?? "").trim();
    if (!new RegExp(`^[0-9]{${length}}$`).test(normalized)) {
      throw new Error(`${label} debe contener ${length} digitos.`);
    }
    return normalized;
  }

  function sequenceText(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > 999999999) {
      throw new Error("El secuencial debe estar entre 1 y 999999999.");
    }
    return String(number).padStart(9, "0");
  }

  function accessKeyDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) throw new Error("La fecha debe usar YYYY-MM-DD.");
    const [, year, month, day] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (
      Number.isNaN(date.getTime())
      || date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() + 1 !== Number(month)
      || date.getUTCDate() !== Number(day)
    ) throw new Error("La fecha de emision no es valida.");
    return `${day}${month}${year}`;
  }

  function modulo11(value) {
    const source = String(value || "");
    if (!/^\d+$/.test(source)) throw new Error("El valor de modulo 11 debe ser numerico.");
    let factor = 2;
    let total = 0;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      total += Number(source[index]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const result = 11 - (total % 11);
    if (result === 11) return 0;
    if (result === 10) return 1;
    return result;
  }

  function buildTestAccessKey(input = {}) {
    const profile = companyIdentity(input.companyKey || selectedCompanyKey);
    const documentType = numericText(input.documentType || "01", 2, "El tipo de comprobante");
    const establishmentCode = numericText(input.establishmentCode || profileDefinition(profile.key).defaultEstablishment, 3, "El establecimiento");
    const emissionPointCode = numericText(input.emissionPointCode || profileDefinition(profile.key).defaultEmissionPoint, 3, "El punto de emision");
    const sequential = sequenceText(input.sequential);
    const numericCode = numericText(input.numericCode || "12345678", 8, "El codigo numerico");
    const base = [
      accessKeyDate(input.issueDate),
      documentType,
      profile.ruc,
      TEST_ENVIRONMENT.code,
      establishmentCode,
      emissionPointCode,
      sequential,
      numericCode,
      "1"
    ].join("");
    if (base.length !== 48) throw new Error("La base de la clave SRI no contiene 48 digitos.");
    return {
      companyKey: profile.key,
      accessKey: `${base}${modulo11(base)}`,
      environment: TEST_ENVIRONMENT.name,
      environmentCode: TEST_ENVIRONMENT.code,
      establishmentCode,
      emissionPointCode,
      sequential,
      numericCode
    };
  }

  function parseAccessKey(value) {
    const accessKey = String(value || "").trim();
    if (!/^\d{49}$/.test(accessKey)) return null;
    return {
      accessKey,
      issueDate: accessKey.slice(0, 8),
      documentType: accessKey.slice(8, 10),
      ruc: accessKey.slice(10, 23),
      environmentCode: accessKey.slice(23, 24),
      establishmentCode: accessKey.slice(24, 27),
      emissionPointCode: accessKey.slice(27, 30),
      sequential: accessKey.slice(30, 39),
      numericCode: accessKey.slice(39, 47),
      emissionType: accessKey.slice(47, 48),
      verificationDigit: accessKey.slice(48, 49),
      validModulo11: modulo11(accessKey.slice(0, 48)) === Number(accessKey[48])
    };
  }

  function validateTestAccessKey(value, companyKey = selectedCompanyKey) {
    const parsed = parseAccessKey(value);
    const profile = companyIdentity(companyKey);
    const errors = [];
    if (!parsed) errors.push("La clave debe contener 49 digitos.");
    if (parsed && !parsed.validModulo11) errors.push("La clave no supera modulo 11.");
    if (parsed && parsed.environmentCode !== TEST_ENVIRONMENT.code) errors.push("La clave no pertenece al ambiente de pruebas.");
    if (parsed && parsed.ruc !== profile.ruc) errors.push("La clave pertenece a otra empresa emisora.");
    if (parsed && parsed.emissionType !== "1") errors.push("La clave no usa emision normal tipo 1.");
    return { ok: !errors.length, companyKey: profile.key, parsed, errors };
  }

  function synchronizedDocumentNumbers(input = {}) {
    const profile = companyIdentity(input.companyKey || selectedCompanyKey);
    const sequential = sequenceText(input.sequential);
    const establishmentCode = numericText(input.establishmentCode || profileDefinition(profile.key).defaultEstablishment, 3, "El establecimiento");
    const emissionPointCode = numericText(input.emissionPointCode || profileDefinition(profile.key).defaultEmissionPoint, 3, "El punto de emision");
    const fullNumber = `${establishmentCode}-${emissionPointCode}-${sequential}`;
    return {
      companyKey: profile.key,
      establishmentCode,
      emissionPointCode,
      sequential,
      sriInvoiceNumber: fullNumber,
      commercialInvoiceNumber: sequential,
      clientInvoiceNumber: sequential,
      packingListNumber: sequential,
      invoicePackingNumber: sequential
    };
  }

  function validateSynchronizedDocumentNumbers(input = {}) {
    const invoiceMatch = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(input.sriInvoiceNumber || ""));
    const expected = invoiceMatch?.[3] || "";
    const values = [
      input.commercialInvoiceNumber,
      input.clientInvoiceNumber,
      input.packingListNumber,
      input.invoicePackingNumber
    ].map(value => String(value || "").padStart(9, "0"));
    const errors = [];
    if (!invoiceMatch) errors.push("La factura SRI debe usar formato 000-000-000000000.");
    if (!expected || values.some(value => value !== expected)) {
      errors.push("Factura comercial, factura cliente y Packing List deben compartir el mismo secuencial.");
    }
    return { ok: !errors.length, sequential: expected, errors };
  }

  function validateSignerSelection(configuration = {}, companyKey = selectedCompanyKey, now = new Date()) {
    const profile = companyIdentity(companyKey);
    const activeCertificates = (configuration.certificates || []).filter(certificate => certificate.active !== false);
    const signer = activeCertificates.find(certificate => String(certificate.subject_ruc || "") === profile.ruc) || null;
    const errors = [];
    if (!signer) errors.push(`No existe un certificado activo asociado a ${profile.commercialName}.`);
    if (signer && String(signer.validation_status || "") !== "VALID") errors.push("El certificado activo no tiene validacion vigente.");
    if (signer?.valid_from && new Date(signer.valid_from) > now) errors.push("El certificado todavia no esta vigente.");
    if (signer?.valid_until && new Date(signer.valid_until) <= now) errors.push("El certificado activo esta vencido.");
    return {
      ok: !errors.length,
      companyKey: profile.key,
      signer: signer ? {
        id: signer.id || "",
        alias: signer.alias || "Certificado SRI",
        subjectName: signer.subject_name || "",
        subjectRuc: signer.subject_ruc || "",
        validFrom: signer.valid_from || "",
        validUntil: signer.valid_until || "",
        status: signer.validation_status || ""
      } : null,
      errors
    };
  }

  function validateCompanyConfiguration(configuration = {}, companyKey = selectedCompanyKey, now = new Date()) {
    const profile = companyIdentity(companyKey);
    const settings = configuration.settings || {};
    const errors = [];
    if (String(settings.ruc || "") !== profile.ruc) errors.push("El RUC configurado no corresponde a la empresa seleccionada.");
    if (String(settings.environment || "").toUpperCase() !== TEST_ENVIRONMENT.name) errors.push("La empresa debe permanecer en ambiente TEST.");
    if (settings.production_enabled) errors.push("Produccion debe permanecer bloqueada.");
    const activePoint = (configuration.emissionPoints || []).find(point => (
      point.active !== false && String(point.environment || "").toUpperCase() === TEST_ENVIRONMENT.name
    )) || null;
    if (!activePoint) errors.push("Falta un establecimiento y punto de emision activo en pruebas.");
    const signer = validateSignerSelection(configuration, profile.key, now);
    return {
      ok: !errors.length && signer.ok,
      readyForInvoice: !errors.length,
      readyForSignature: !errors.length && signer.ok,
      companyKey: profile.key,
      activePoint,
      signer: signer.signer,
      errors: [...errors, ...signer.errors]
    };
  }

  BlessERP.sriApi = {
    TEST_ENVIRONMENT,
    status,
    session,
    signIn,
    signOut,
    list,
    detail,
    configuration,
    post,
    download,
    subscribe,
    unsubscribe,
    companyProfiles,
    activeCompanyKey,
    activeCompany,
    selectCompany,
    companyKeyForReference,
    orderCompanyKey,
    companyIdentity,
    bindRuntimeCompany,
    discoverCompanies,
    buildTestAccessKey,
    parseAccessKey,
    validateTestAccessKey,
    synchronizedDocumentNumbers,
    validateSynchronizedDocumentNumbers,
    validateSignerSelection,
    validateCompanyConfiguration
  };
})();
