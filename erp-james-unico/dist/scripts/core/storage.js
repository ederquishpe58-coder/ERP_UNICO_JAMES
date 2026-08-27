(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const STRICT_LOCAL_FILE_MODE = window.__ERP_LOCAL_MODE__ === true || window.location?.protocol === "file:";
  const STORAGE_KEY = STRICT_LOCAL_FILE_MODE ? "jaeder-systems-local-isolated-db-v1" : "erp-james-unico-db";
  const UI_KEY = STRICT_LOCAL_FILE_MODE ? "jaeder-systems-local-isolated-ui-v1" : "erp-james-unico-ui";
  const TAB_COMPANY_KEY = STRICT_LOCAL_FILE_MODE ? "jaeder-systems-local-isolated-company-v1" : "erp-james-unico-tab-company";
  const LOCAL_DATA_RESET_VERSION = "20260807-clean-start-users-data-1";
  const DEMO_DATA_CLEANUP_VERSION = "20260807-demo-records-removed-1";
  const LOCAL_DATA_BACKUP_KEY = `${STORAGE_KEY}-backup-${LOCAL_DATA_RESET_VERSION}`;
  const LOCAL_WORKSPACE_USER_ID = "LOCAL-WORKSPACE-ADMIN";
  const COMPRESSED_STORAGE_PREFIX = "JDS-LZW1|";
  let storeBaselines = {};
  let volatileUi = {};

  function codeUnitsToString(codes) {
    let output = "";
    for (let index = 0; index < codes.length; index += 8192) {
      output += String.fromCharCode(...codes.slice(index, index + 8192));
    }
    return output;
  }

  function compressStorageText(value) {
    if (typeof TextEncoder !== "function") return "";
    const input = new TextEncoder().encode(String(value || ""));
    if (!input.length) return "";
    const dictionary = new Map();
    const output = [];
    let nextCode = 256;
    let phraseCode = input[0];
    for (let index = 1; index < input.length; index += 1) {
      const characterCode = input[index];
      const dictionaryKey = phraseCode * 256 + characterCode;
      const combinedCode = dictionary.get(dictionaryKey);
      if (combinedCode !== undefined) {
        phraseCode = combinedCode;
        continue;
      }
      output.push(phraseCode);
      if (nextCode < 65535) dictionary.set(dictionaryKey, nextCode++);
      phraseCode = characterCode;
    }
    output.push(phraseCode);
    return codeUnitsToString(output);
  }

  function decompressStorageText(value) {
    const input = String(value || "");
    if (!input) return "";
    if (typeof TextDecoder !== "function") return "";
    const prefixes = new Uint16Array(65535);
    const suffixes = new Uint8Array(65535);
    const stack = new Uint8Array(65535);
    const output = [];
    let nextCode = 256;
    const appendCode = code => {
      let cursor = code;
      let size = 0;
      while (cursor >= 256) {
        if (cursor >= nextCode || size >= stack.length) {
          throw new Error("La caché local comprimida no tiene un formato válido.");
        }
        stack[size++] = suffixes[cursor];
        cursor = prefixes[cursor];
      }
      const firstByte = cursor;
      output.push(firstByte);
      for (let index = size - 1; index >= 0; index -= 1) output.push(stack[index]);
      return firstByte;
    };
    let previousCode = input.charCodeAt(0);
    if (previousCode >= 256) throw new Error("La caché local comprimida no tiene una cabecera válida.");
    appendCode(previousCode);
    for (let index = 1; index < input.length; index += 1) {
      const currentCode = input.charCodeAt(index);
      let firstByte = 0;
      if (currentCode < nextCode) {
        firstByte = appendCode(currentCode);
      } else if (currentCode === nextCode && nextCode < 65535) {
        firstByte = appendCode(previousCode);
        output.push(firstByte);
      } else {
        throw new Error("La caché local comprimida no tiene un formato válido.");
      }
      if (nextCode < 65535) {
        prefixes[nextCode] = previousCode;
        suffixes[nextCode] = firstByte;
        nextCode += 1;
      }
      previousCode = currentCode;
    }
    return new TextDecoder().decode(Uint8Array.from(output));
  }

  function databaseStoragePayload(db) {
    if (!db?.companyStores || typeof db.companyStores !== "object") return db;
    const compact = { ...db };
    const scopedKeys = BlessERP.companyCapabilities?.SCOPED_ROOT_KEYS || [];
    // La tienda de la empresa activa ya está dentro de companyStores. Evita
    // persistir una segunda copia completa en la raíz del objeto.
    scopedKeys.forEach(key => { delete compact[key]; });
    return compact;
  }

  function serializeStoredDatabase(db, options = {}) {
    const raw = JSON.stringify(databaseStoragePayload(db));
    if (options.compress !== true) return raw;
    try {
      const compressed = compressStorageText(raw);
      return compressed && compressed.length + COMPRESSED_STORAGE_PREFIX.length < raw.length
        ? `${COMPRESSED_STORAGE_PREFIX}${compressed}`
        : raw;
    } catch (error) {
      console.warn("La caché local no pudo comprimirse; se usará JSON normal.", error);
      return raw;
    }
  }

  function isStorageQuotaError(error) {
    return error?.name === "QuotaExceededError"
      || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || Number(error?.code) === 22
      || Number(error?.code) === 1014;
  }

  function writeStoredDatabase(db) {
    const raw = serializeStoredDatabase(db);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      return { compressed: false, length: raw.length };
    } catch (error) {
      if (!isStorageQuotaError(error)) throw error;
      const compressed = serializeStoredDatabase(db, { compress: true });
      if (!compressed.startsWith(COMPRESSED_STORAGE_PREFIX)) throw error;
      localStorage.setItem(STORAGE_KEY, compressed);
      console.warn(`La caché local alcanzó su límite. Se guardó comprimida (${raw.length} -> ${compressed.length} caracteres).`);
      return { compressed: true, length: compressed.length, rawLength: raw.length };
    }
  }

  function deserializeStoredDatabase(raw) {
    const value = String(raw || "");
    return value.startsWith(COMPRESSED_STORAGE_PREFIX)
      ? decompressStorageText(value.slice(COMPRESSED_STORAGE_PREFIX.length))
      : value;
  }

  function ensureLocalWorkspaceAccess(db) {
    if (!STRICT_LOCAL_FILE_MODE || !db || typeof db !== "object") return false;
    const users = Array.isArray(db.visualUsers) ? db.visualUsers : [];
    // Si el usuario configuró autenticación local, esa sesión conserva el control.
    if (users.some(user => user?.localCredential?.version === 1)) return false;
    const existing = users.find(user => user?.id === LOCAL_WORKSPACE_USER_ID);
    if (existing && db.session?.activeUser?.id === LOCAL_WORKSPACE_USER_ID) return false;
    const companyAccess = {
      "COMP-BLESS-FLOWER": {
        enabled: true,
        status: "activo",
        roleCode: "ADMIN",
        routeAccess: {}
      },
      "COMP-IMPERIO-FLOWERS": {
        enabled: true,
        status: "activo",
        roleCode: "ADMIN",
        routeAccess: {}
      }
    };
    const localUser = {
      id: LOCAL_WORKSPACE_USER_ID,
      code: "LOCAL",
      username: "LOCAL",
      name: "Operador local",
      fullName: "Operador local",
      email: "",
      role: "ADMIN",
      roleCode: "ADMIN",
      cargo: "Administrador local",
      area: "Pruebas locales",
      status: "activo",
      companyAccess,
      localWorkspaceOnly: true
    };
    db.visualUsers = [...users.filter(user => user?.id !== LOCAL_WORKSPACE_USER_ID), localUser];
    db.session = db.session && typeof db.session === "object" ? db.session : {};
    db.session.activeUser = {
      id: localUser.id,
      name: localUser.name,
      username: localUser.username,
      role: localUser.role,
      roleCode: localUser.roleCode,
      cargo: localUser.cargo,
      area: localUser.area,
      email: ""
    };
    db.session.alerts = Array.isArray(db.session.alerts) ? db.session.alerts : [];
    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    db.meta.localWorkspaceMode = true;
    return true;
  }

  const LOCAL_TRANSACTION_KEYS = Object.freeze([
    "journalEntries",
    "purchaseMemory",
    "auditLogs",
    "purchases",
    "purchasePayables",
    "issuedWithholdings",
    "payments",
    "paymentBatches",
    "bankMovements",
    "bankStatementMovements",
    "bankReconciliations",
    "customerReceivables",
    "collections",
    "collectionBatches",
    "receivedWithholdings",
    "inventoryMovements",
    "sales",
    "atsHistory"
  ]);

  function cleanCommercialTestingData(commercial) {
    if (!commercial || typeof commercial !== "object") return commercial;
    [
      "orders",
      "preorders",
      "reservations",
    ].forEach(key => {
      commercial[key] = [];
    });
    commercial.ui = {
      ...(commercial.ui || {}),
      currentOrderId: "",
      currentPreorderId: "",
      selectedCustomerId: "",
      selectedBrandId: "",
      selectedAgencyId: "",
      selectedAirlineId: "",
      selectedDaeId: "",
      selectedDestinationId: "",
      selectedOrderIds: [],
      labelSelectedOrderIds: [],
      printCenterSelectedOrderIds: [],
      availabilityReserveDrafts: {},
      reservationLineDrafts: {},
      boxRangeDrafts: {},
      orderScanCode: "",
      notice: "",
      noticeTone: "info"
    };
    return commercial;
  }

  function cleanOperationsTestingData(operations) {
    if (!operations || typeof operations !== "object") return operations;
    [
      "availabilityDemo",
      "demoReservations",
      "receptions",
      "classifierAssignments",
      "classificationResults",
      "classifications",
      "bunches",
      "labelBatches",
      "roseInventory",
      "performances",
      "meshProcessingRecords",
      "processedMeshHistory",
      "processedMeshHistoryAudit",
      "receptionEditAudit",
      "bunchEntries",
      "bunchDeletionAudit",
      "scannerEvents",
      "inventoryMovements",
      "consumptionsDemo",
      "kardexOperativoDemo",
      "dispatches",
      "yieldWorkdayHistory"
    ].forEach(key => {
      operations[key] = [];
    });
    operations.yieldWorkday = null;
    operations.ui = {
      ...(operations.ui || {}),
      selectedAvailabilityId: "",
      selectedDispatchOrderId: "",
      warehouseOrderId: "",
      warehouseScanCode: "",
      warehouseLastScan: null,
      dispatchScanCode: "",
      dispatchBunchScanCode: "",
      dispatchLastBunchScan: null,
      scannerDispatchPedidoId: "",
      scannerDispatchCode: "",
      scannerHidInput: "",
      bunchSearchScanCode: "",
      bunchSearchFilter: "",
      bunchSearchCodes: [],
      bunchSearchSelectedCodes: [],
      bunchSearchDialog: "",
      bunchSearchDeleteReason: "",
      lastBunchIntakeResult: null,
      notice: "",
      noticeTone: "info"
    };
    return operations;
  }

  function cleanPayrollTestingData(payroll) {
    if (!payroll || typeof payroll !== "object") return payroll;
    [
      "hour_entries",
      "performance_entries",
      "payroll_periods",
      "payrolls",
      "payroll_details",
      "commission_entries",
      "payments",
      "audit_log"
    ].forEach(key => {
      if (key in payroll || ["hour_entries", "performance_entries"].includes(key)) {
        payroll[key] = [];
      }
    });
    return payroll;
  }

  function cleanScopedTestingData(store) {
    if (!store || typeof store !== "object") return store;
    LOCAL_TRANSACTION_KEYS.forEach(key => {
      store[key] = [];
    });
    store.commercial = cleanCommercialTestingData(store.commercial);
    store.operations = cleanOperationsTestingData(store.operations);
    store.payroll = cleanPayrollTestingData(store.payroll);
    store.providers = [];
    // Los clientes principales, clientes finales y marcas son catálogos reales
    // compartidos. Nunca deben eliminarse durante una limpieza de transacciones
    // locales ni al abrir una versión nueva del sistema.
    if (store.payroll && typeof store.payroll === "object") {
      store.payroll.employees = [];
    }
    return store;
  }

  const PRESERVED_CONFIGURATION_PATHS = new Set([
    "companySettings",
    "chartOfAccounts",
    "taxParameters",
    "retentionParameters",
    "taxSupports",
    "purchaseTypes",
    "documentSequences",
    "costCenters",
    "countryCatalog",
    "operations.catalogs",
    "operations.masterData",
    "operations.yieldSettings",
    "payroll.parameters_by_company",
    "payroll.rate_rules",
    "payroll.obligation_settings"
  ]);

  function isDemoIdentityValue(value) {
    return /(^|[-_\s])(demo|sample|mock|seed)([-_\s]|$)|validation_only|demo-junio|system-demo/i
      .test(String(value ?? ""));
  }

  function hasDemoIdentity(value) {
    if (!value || typeof value !== "object") return false;
    if (value.demoValidationSeed === true || value.validation_only === true) return true;
    return Object.entries(value).some(([key, nested]) => {
      if (nested && typeof nested === "object") return hasDemoIdentity(nested);
      const identityField = /(^id$|_id$|Id$|identification|taxId|customerTaxId|ruc|sourceMode|created_by|updated_by)/i.test(key);
      return identityField && isDemoIdentityValue(nested);
    });
  }

  function isPreservedConfigurationPath(path) {
    return Array.from(PRESERVED_CONFIGURATION_PATHS).some(configPath => (
      path === configPath || path.startsWith(`${configPath}.`)
    ));
  }

  function removeMarkedDemoRecords(value, path = "") {
    if (Array.isArray(value)) {
      const preserveRows = isPreservedConfigurationPath(path);
      return value
        .filter(item => preserveRows || !hasDemoIdentity(item))
        .filter(item => path !== "commercial.brandCatalog" || !/\bdemo\b/i.test(String(item?.name || item?.finalClientName || "")))
        .filter(item => path !== "operations.scannerEvents" || !/demo|prueba automatizada|validacion seed/i.test(JSON.stringify(item)))
        .map(item => removeMarkedDemoRecords(item, path));
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
      const nestedPath = path ? `${path}.${key}` : key;
      return [key, removeMarkedDemoRecords(nested, nestedPath)];
    }));
  }

  function sanitizePreservedParameterNotes(store) {
    [store?.operations?.catalogs, store?.operations?.masterData]
      .filter(Boolean)
      .forEach(group => Object.values(group).forEach(rows => {
        if (!Array.isArray(rows)) return;
        rows.forEach(row => {
          if (!row || typeof row !== "object" || typeof row.observation !== "string") return;
          row.observation = row.observation
            .replace(/parametro operativo local\/demo\.?/ig, "Parametro operativo configurado.")
            .replace(/\bdemo\b/ig, "configurado")
            .trim();
        });
      }));
  }

  function cleanMarkedDemoData(db) {
    if (!db || typeof db !== "object") return { db, changed: false };
    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    if (db.meta.demoDataCleanupVersion === DEMO_DATA_CLEANUP_VERSION) return { db, changed: false };
    const cleaned = removeMarkedDemoRecords(db);
    [cleaned, ...Object.values(cleaned.companyStores || {})].forEach(store => {
      if (store?.operations?.ui) {
        const ui = store.operations.ui;
        ["selectedDispatchOrderId", "warehouseOrderId", "scannerDispatchPedidoId"].forEach(key => {
          if (isDemoIdentityValue(ui[key])) ui[key] = "";
        });
        if (/demo/i.test(JSON.stringify(ui.lastBunchIntakeResult || {}))) ui.lastBunchIntakeResult = null;
      }
      sanitizePreservedParameterNotes(store);
    });
    cleaned.meta.demoDataCleanupVersion = DEMO_DATA_CLEANUP_VERSION;
    cleaned.meta.demoDataCleanupAt = new Date().toISOString();
    return { db: cleaned, changed: true };
  }

  function cleanLocalTestingDatabase(db, rawStoredValue = "") {
    if (!db || typeof db !== "object") return { db, changed: false };
    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    if (db.meta.localDataResetVersion === LOCAL_DATA_RESET_VERSION) return { db, changed: false };

    if (rawStoredValue) {
      try {
        localStorage.setItem(LOCAL_DATA_BACKUP_KEY, rawStoredValue);
      } catch {
        // La limpieza solicitada puede continuar aunque el navegador no tenga espacio para otra copia local.
      }
    }

    cleanScopedTestingData(db);
    Object.values(db.companyStores || {}).forEach(cleanScopedTestingData);
    db.visualUsers = [];
    db.authAccess = null;
    db.session = db.session && typeof db.session === "object" ? db.session : {};
    db.session.activeUser = null;
    db.session.alerts = [];
    try {
      localStorage.removeItem("bless_flower_erp_local_auth_session_v1");
      sessionStorage.removeItem("bless_flower_erp_local_auth_session_v1");
    } catch {
      // La autenticación Supabase volverá a validar la sesión oficial.
    }
    try {
      window.indexedDB?.deleteDatabase?.("jaeder-systems-offline-v1");
    } catch {
      // La siguiente carga inicia con una cola nueva aunque IndexedDB no esté disponible.
    }
    db.meta.localDataResetVersion = LOCAL_DATA_RESET_VERSION;
    db.meta.localDataResetAt = new Date().toISOString();
    return { db, changed: true };
  }

  function mergeMissing(baseValue, currentValue) {
    if (Array.isArray(baseValue)) return Array.isArray(currentValue) ? currentValue : baseValue;
    if (baseValue && typeof baseValue === "object") {
      const result = { ...baseValue };
      const source = currentValue && typeof currentValue === "object" ? currentValue : {};
      Object.keys(source).forEach(key => {
        result[key] = key in baseValue
          ? mergeMissing(baseValue[key], source[key])
          : source[key];
      });
      return result;
    }
    return currentValue === undefined ? baseValue : currentValue;
  }

  function policy() {
    return BlessERP.companyCapabilities || null;
  }

  function normalizeCompanyId(value) {
    const companyPolicy = policy();
    const raw = String(value || "").trim();
    const aliases = {
      BLESS: companyPolicy?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER",
      IMPERIO: companyPolicy?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS"
    };
    const candidate = aliases[raw.toUpperCase()] || raw;
    return companyPolicy?.COMPANY_PROFILES?.[candidate] ? candidate : "";
  }

  function queryCompanyId() {
    try {
      const params = new URLSearchParams(window.location?.search || "");
      return normalizeCompanyId(params.get("company") || params.get("companyId"));
    } catch {
      return "";
    }
  }

  function tabCompanyId() {
    const companyPolicy = policy();
    const fallback = companyPolicy?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER";
    const companyId = queryCompanyId() || fallback;
    try {
      sessionStorage.setItem(TAB_COMPANY_KEY, companyId);
    } catch {
      // El query de la pestaña sigue siendo la fuente de verdad si sessionStorage no está disponible.
    }
    return companyId;
  }

  function setTabCompanyId(companyId) {
    const resolved = normalizeCompanyId(companyId);
    if (!resolved) return "";
    try {
      sessionStorage.setItem(TAB_COMPANY_KEY, resolved);
    } catch {
      // La URL mantendrá el contexto aun cuando sessionStorage esté bloqueado.
    }
    return resolved;
  }

  function migrateDatabase(db) {
    const companyMigrated = policy()?.migrateDatabase?.(db) || db;
    const accountingMigrated = BlessERP.accountingRules?.migrateDatabase?.(companyMigrated) || companyMigrated;
    return BlessERP.accountingPlanBlessV1?.migrateDatabase?.(accountingMigrated) || accountingMigrated;
  }

  function createInitialDatabase() {
    const factory = BlessERP.demo?.createInitialDatabase;
    if (typeof factory !== "function") throw new Error("No existe una fabrica de datos iniciales.");
    return factory();
  }

  function createEmptyDefaultDatabase() {
    const fresh = migrateDatabase(createInitialDatabase());
    cleanScopedTestingData(fresh);
    Object.values(fresh.companyStores || {}).forEach(cleanScopedTestingData);
    fresh.visualUsers = [];
    fresh.authAccess = null;
    fresh.session = fresh.session && typeof fresh.session === "object" ? fresh.session : {};
    fresh.session.activeUser = null;
    fresh.session.alerts = [];
    return fresh;
  }

  function createCleanInitialCache(reason = "FIRST_LOAD") {
    const fresh = createEmptyDefaultDatabase();
    fresh.meta = fresh.meta && typeof fresh.meta === "object" ? fresh.meta : {};
    fresh.meta.forceFullRemoteSync = true;
    fresh.meta.localCacheInitializedAt = new Date().toISOString();
    fresh.meta.localCacheInitializationReason = reason;
    return fresh;
  }

  function initialCompanyStore(companyId = tabCompanyId()) {
    const resolvedCompanyId = normalizeCompanyId(companyId) || tabCompanyId();
    const fresh = createEmptyDefaultDatabase();
    const stored = fresh?.companyStores?.[resolvedCompanyId]
      || policy()?.snapshotActiveStore?.(fresh, resolvedCompanyId)
      || {};
    try {
      return structuredClone(stored);
    } catch {
      return JSON.parse(JSON.stringify(stored));
    }
  }

  function applyTabCompany(db) {
    const companyPolicy = policy();
    if (!companyPolicy?.applyActiveStore) return db;
    return companyPolicy.applyActiveStore(db, tabCompanyId());
  }

  function fingerprint(value) {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return "";
    }
  }

  function rememberStoreBaselines(db) {
    const stores = db?.companyStores && typeof db.companyStores === "object" ? db.companyStores : {};
    storeBaselines = Object.fromEntries(
      Object.entries(stores).map(([companyId, store]) => [companyId, fingerprint(store)])
    );
  }

  function parseStoredDatabase(raw) {
    if (!raw) return null;
    // Los valores faltantes se completan desde una estructura vacía y nunca
    // desde los registros de demostración incluidos en el diseño inicial.
    const parsed = mergeMissing(createEmptyDefaultDatabase(), JSON.parse(deserializeStoredDatabase(raw)));
    return migrateDatabase(parsed);
  }

  function notifyAutomaticReconciliation(companyIds) {
    if (typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("erp:storage-reconciled", {
      detail: {
        companyIds,
        message: "La caché de esta pestaña conservó su cambio. Supabase conciliará los registros individualmente."
      }
    }));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    try {
      // Las limpiezas de datos quedan reservadas para una acción administrativa
      // explícita. Una actualización del HTML nunca debe borrar transacciones,
      // operaciones ni la cola offline de un navegador existente.
      const parsed = raw ? parseStoredDatabase(raw) : createCleanInitialCache();
      const resolved = applyTabCompany(parsed);
      const localAccessAdded = ensureLocalWorkspaceAccess(resolved);
      if (!raw || localAccessAdded) {
        writeStoredDatabase(resolved);
      }
      rememberStoreBaselines(resolved);
      return resolved;
    } catch (error) {
      console.error("No se pudo leer la caché local. Se conservará intacta y Supabase realizará una carga completa.", error);
      if (raw) {
        try {
          localStorage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw);
        } catch {
          // La copia original permanece bajo STORAGE_KEY aunque no exista espacio para otra copia.
        }
      }
      const recovered = createCleanInitialCache("LOCAL_CACHE_READ_ERROR");
      recovered.meta.storageLoadError = String(error?.message || error || "No se pudo leer la caché local.");
      const resolved = applyTabCompany(recovered);
      ensureLocalWorkspaceAccess(resolved);
      rememberStoreBaselines(resolved);
      return resolved;
    }
  }

  function save(db, options = {}) {
    const companyPolicy = policy();
    const activeCompanyId = normalizeCompanyId(db?.activeCompanyId) || tabCompanyId();
    companyPolicy?.captureActiveStore?.(db);

    if (options.replaceAll) {
      const replacement = migrateDatabase(db);
      companyPolicy?.applyActiveStore?.(replacement, activeCompanyId);
      writeStoredDatabase(replacement);
      rememberStoreBaselines(replacement);
      return true;
    }

    let latest = null;
    try {
      latest = parseStoredDatabase(localStorage.getItem(STORAGE_KEY));
      companyPolicy?.captureActiveStore?.(latest);
    } catch {
      latest = null;
    }

    if (!latest?.companyStores || !db?.companyStores) {
      companyPolicy?.applyActiveStore?.(db, activeCompanyId);
      writeStoredDatabase(db);
      rememberStoreBaselines(db);
      return true;
    }

    const companyIds = new Set([
      ...Object.keys(latest.companyStores || {}),
      ...Object.keys(db.companyStores || {})
    ]);
    const mergedStores = {};
    const conflicts = [];

    companyIds.forEach(companyId => {
      const currentStore = db.companyStores?.[companyId];
      const latestStore = latest.companyStores?.[companyId];
      const baseline = storeBaselines[companyId];
      const currentHash = fingerprint(currentStore);
      const latestHash = fingerprint(latestStore);
      const currentChanged = baseline === undefined ? latestStore === undefined : currentHash !== baseline;
      const externalChanged = baseline === undefined ? currentStore === undefined : latestHash !== baseline;

      if (currentChanged && externalChanged && currentHash !== latestHash) {
        conflicts.push(companyId);
        // localStorage es solamente una caché entre pestañas. No debe bloquear
        // ni decidir la versión empresarial completa: la cola incremental ya
        // conserva cada registro con base, parche y operation_id propios.
        mergedStores[companyId] = currentStore ?? latestStore;
        return;
      }
      mergedStores[companyId] = currentChanged ? currentStore : (latestStore ?? currentStore);
    });

    if (conflicts.length) {
      notifyAutomaticReconciliation(conflicts);
    }

    db.companyStores = mergedStores;
    const persisted = {
      ...latest,
      ...db,
      companyStores: mergedStores,
      activeCompanyId
    };
    companyPolicy?.applyActiveStore?.(persisted, activeCompanyId);
    writeStoredDatabase(persisted);
    rememberStoreBaselines(persisted);
    return true;
  }

  function reset() {
    const db = createEmptyDefaultDatabase();
    const migrated = applyTabCompany(db);
    ensureLocalWorkspaceAccess(migrated);
    save(migrated, { replaceAll: true });
    return migrated;
  }

  function uiStorageKey() {
    return `${UI_KEY}:${tabCompanyId()}`;
  }

  function loadUi() {
    try {
      const scopedKey = uiStorageKey();
      const scoped = sessionStorage.getItem(scopedKey);
      if (scoped) return JSON.parse(scoped) || {};
      const legacy = tabCompanyId() === (policy()?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER")
        ? localStorage.getItem(UI_KEY)
        : "";
      const migrated = JSON.parse(legacy || "null") || {};
      sessionStorage.setItem(scopedKey, JSON.stringify(migrated));
      return migrated;
    } catch {
      return volatileUi;
    }
  }

  function saveUi(ui) {
    volatileUi = ui || {};
    try {
      sessionStorage.setItem(uiStorageKey(), JSON.stringify(volatileUi));
    } catch {
      // Mantiene el estado visual en memoria si el navegador bloquea sessionStorage.
    }
  }

  BlessERP.storage = {
    STORAGE_KEY,
    TAB_COMPANY_KEY,
    UI_KEY,
    load,
    loadUi,
    initialCompanyStore,
    reset,
    save,
    saveUi,
    storageCodec: {
      deserialize: deserializeStoredDatabase,
      serialize: serializeStoredDatabase,
      serializeCompressed: db => serializeStoredDatabase(db, { compress: true })
    },
    setTabCompanyId,
    tabCompanyId,
    uiStorageKey
  };
})();
