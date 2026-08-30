(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.operacionesData;
  const utils = BlessERP.operacionesUtils;
  const workdayCore = BlessERP.operacionesWorkdayCore;
  const { clone, uid, today } = BlessERP.utils;
  const ZEBRA_LABEL_REGISTRY_KEY = "jaeder-zebra-label-registry-v1";
  const ZEBRA_LABEL_SEQUENCE_KEY = "jaeder-zebra-label-next-sequence-v2";
  let zebraLabelSequenceMemory = 1;
  let normalizedStore = null;
  let normalizedRenderCycle = -1;
  let noticeTimer = 0;
  let commandSimulationDepth = 0;
  const labelScanIndexCache = new WeakMap();
  const inventoryScanIndexCache = new WeakMap();
  const OPERATIONS_V2_ENTITY_KEYS = Object.freeze({
    operations_receptions: "receptions",
    operations_classifier_assignments: "classifierAssignments",
    operations_classification_results: "classificationResults",
    operations_rose_inventory: "roseInventory",
    operations_performances: "performances",
    operations_mesh_records: "meshProcessingRecords",
    operations_mesh_history: "processedMeshHistory",
    operations_bunch_entries: "bunchEntries",
    operations_scanner_events: "scannerEvents",
    operations_inventory_movements: "inventoryMovements",
    operations_destination_lots: "destinationLots"
  });

  function scanArraySignature(rows, codeOf) {
    return {
      rows,
      length: rows.length,
      first: normalizeBunchLabelCode(codeOf(rows[0])),
      last: normalizeBunchLabelCode(codeOf(rows[rows.length - 1]))
    };
  }

  function cachedScanIndex(cacheStore, rows, codeOf, alternateIdOf) {
    const signature = scanArraySignature(rows, codeOf);
    const cached = cacheStore.get(rows);
    if (cached && cached.length === signature.length && cached.first === signature.first && cached.last === signature.last) return cached;
    const byCode = new Map();
    const byAlternateId = new Map();
    rows.forEach(item => {
      const code = normalizeBunchLabelCode(codeOf(item));
      if (code) byCode.set(code, item);
      const alternateId = String(alternateIdOf?.(item) || "").trim();
      if (alternateId) byAlternateId.set(alternateId, item);
    });
    const next = { ...signature, byCode, byAlternateId };
    cacheStore.set(rows, next);
    return next;
  }

  function labelScanIndex(store) {
    const rows = Array.isArray(store.labelBatches) ? store.labelBatches : [];
    return cachedScanIndex(labelScanIndexCache, rows, item => item?.code, item => item?.id);
  }

  function inventoryScanIndex(store) {
    const rows = Array.isArray(store.roseInventory) ? store.roseInventory : [];
    return cachedScanIndex(inventoryScanIndexCache, rows, item => item?.labelCode || item?.code, item => item?.sourceLabelId);
  }

  function registerInventoryInScanIndex(store, inventory) {
    const rows = Array.isArray(store.roseInventory) ? store.roseInventory : [];
    const cached = inventoryScanIndexCache.get(rows);
    if (!cached) return;
    const signature = scanArraySignature(rows, item => item?.labelCode || item?.code);
    cached.length = signature.length;
    cached.first = signature.first;
    cached.last = signature.last;
    const code = normalizeBunchLabelCode(inventory?.labelCode || inventory?.code);
    if (code) cached.byCode.set(code, inventory);
    if (inventory?.sourceLabelId) cached.byAlternateId.set(String(inventory.sourceLabelId), inventory);
  }

  function readStoredZebraSequence(storage) {
    try {
      const raw = storage?.getItem?.(ZEBRA_LABEL_SEQUENCE_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return Math.max(0, Number(typeof parsed === "object" ? parsed.nextSequence : parsed) || 0);
    } catch {
      return 0;
    }
  }

  function readPersistentZebraSequence() {
    return Math.max(
      zebraLabelSequenceMemory,
      readStoredZebraSequence(window.localStorage),
      readStoredZebraSequence(window.sessionStorage),
      1
    );
  }

  function persistZebraSequence(nextSequence) {
    const safeNext = Math.max(1, Math.trunc(Number(nextSequence) || 1));
    zebraLabelSequenceMemory = Math.max(zebraLabelSequenceMemory, safeNext);
    const payload = JSON.stringify({ nextSequence: zebraLabelSequenceMemory, updatedAt: new Date().toISOString() });
    try {
      window.localStorage?.setItem?.(ZEBRA_LABEL_SEQUENCE_KEY, payload);
      try { window.sessionStorage?.removeItem?.(ZEBRA_LABEL_SEQUENCE_KEY); } catch {}
      return "LOCAL";
    } catch {
      try {
        window.sessionStorage?.setItem?.(ZEBRA_LABEL_SEQUENCE_KEY, payload);
        return "SESSION";
      } catch {
        return "MEMORY";
      }
    }
  }

  function numericBunchLabelCodes(store) {
    const codes = new Set();
    const add = rawCode => {
      const compact = String(rawCode ?? "").replace(/[\r\n\t ]+/g, "").trim();
      if (/^\d{10}$/.test(compact)) codes.add(compact);
    };
    (store.labelBatches || []).forEach(item => add(item.code));
    (store.roseInventory || []).forEach(item => add(item.labelCode || item.code));
    (store.bunchEntries || []).forEach(item => add(item.code || item.labelCode));
    (store.scannerEvents || []).forEach(item => add(item.code || item.labelCode));
    (store.bunchScanEvents || []).forEach(item => add(item.code || item.labelCode));
    (store.bunchDeletionAudit || []).forEach(item => add(item.code || item.labelCode));
    return codes;
  }

  function synchronizeBunchLabelSequence(store) {
    store.sequences = store.sequences || {};
    const usedCodes = numericBunchLabelCodes(store);
    const highestUsed = [...usedCodes].reduce((highest, code) => Math.max(highest, Number(code) || 0), 0);
    const nextSequence = Math.max(
      1,
      Math.trunc(utils.parseNumber(store.sequences.bunchLabel, 1)),
      readPersistentZebraSequence(),
      highestUsed + 1
    );
    store.sequences.bunchLabel = nextSequence;
    if (nextSequence > zebraLabelSequenceMemory) persistZebraSequence(nextSequence);
    return { nextSequence, usedCodes, highestUsed };
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

  function saveDb() {
    if (commandSimulationDepth > 0) return true;
    try {
      return BlessERP.state.saveDb() !== false;
    } catch (error) {
      console.error("No se pudo persistir el cambio de Operaciones.", error);
      return false;
    }
  }

  function cacheSave() {
    try {
      const saveLocalOnly = BlessERP.state?.saveDbLocalOnly;
      if (typeof saveLocalOnly !== "function") throw new Error("saveDbLocalOnly no está disponible");
      return saveLocalOnly() !== false;
    } catch (error) {
      console.error("No se pudo actualizar la caché local de Operaciones V2.", error);
      return false;
    }
  }

  function operationsV2Repository() {
    return BlessERP.getOperationsV2Repository?.() || null;
  }

  function zebraV2Repository() {
    return BlessERP.getZebraV2Repository?.() || null;
  }

  function destinationV2Repository() {
    return BlessERP.getLocalDestinationV2Repository?.() || null;
  }

  function requiresConfirmedRemoteOperations() {
    return operationsV2Repository()?.remoteRequired?.() === true;
  }

  function requiresConfirmedZebra() {
    return zebraV2Repository()?.remoteRequired?.() === true;
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.()
      || globalThis.crypto?.randomUUID?.()
      || uid("UUID");
  }

  function simulateLegacyMutation(appState, callback) {
    const currentStore = ensureStore(appState);
    const shadowState = {
      ...appState,
      db: {
        ...appState.db,
        operations: clone(currentStore)
      }
    };
    commandSimulationDepth += 1;
    try {
      return {
        baseStore: clone(currentStore),
        shadowState,
        result: callback(shadowState),
        nextStore: shadowState.db.operations
      };
    } finally {
      commandSimulationDepth -= 1;
    }
  }

  function recordIdForEntity(entity, record = {}) {
    if (entity === "operations_rose_inventory") return String(record.inventoryId || record.id || "").trim();
    if (entity === "operations_scanner_events") return String(record.eventId || record.id || "").trim();
    return String(record.id || record.operation_id || record.operationId || "").trim();
  }

  function serializableRecord(record) {
    return BlessERP.syncEntityRegistry?.serializableRecord?.(record) || clone(record);
  }

  function changedOperationRecords(baseStore, nextStore, entities) {
    const records = [];
    entities.forEach(entity => {
      const key = OPERATIONS_V2_ENTITY_KEYS[entity];
      if (!key) return;
      const beforeRows = Array.isArray(baseStore?.[key]) ? baseStore[key] : [];
      const afterRows = Array.isArray(nextStore?.[key]) ? nextStore[key] : [];
      const beforeById = new Map(beforeRows.map(row => [recordIdForEntity(entity, row), row]).filter(([id]) => Boolean(id)));
      afterRows.forEach(row => {
        const recordId = recordIdForEntity(entity, row);
        if (!recordId) return;
        const before = beforeById.get(recordId) || null;
        const payload = serializableRecord(row);
        if (before && JSON.stringify(serializableRecord(before)) === JSON.stringify(payload)) return;
        records.push({
          entity,
          recordId,
          payload,
          baseVersion: Math.max(0, Number(before?.__syncVersion || 0))
        });
      });
    });
    return records;
  }

  async function executeOperationsCommand(command, payload, options = {}) {
    const repository = operationsV2Repository();
    if (!repository?.execute) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "El repositorio confirmado de Operaciones V2 no está disponible." };
    }
    return repository.execute(command, payload, options);
  }

  function applyConfirmedUiState(appState, shadowStore, keys = []) {
    const store = ensureStore(appState);
    keys.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(shadowStore?.ui || {}, key)) store.ui[key] = clone(shadowStore.ui[key]);
    });
    cacheSave();
    return store;
  }

  function attachDurableSync(result, options = {}) {
    if (!result || typeof result !== "object") return result;
    const syncPromise = BlessERP.state.waitForLastSave?.({ processRemote: options.processRemote !== false })
      || Promise.resolve({ ok: true, durable: true, confirmed: false, mode: "LOCAL_ONLY" });
    Object.defineProperty(result, "syncPromise", {
      value: syncPromise,
      configurable: true,
      enumerable: false,
      writable: false
    });
    return result;
  }

  function readCompactZebraRegistry() {
    const read = storage => {
      try {
        const parsed = JSON.parse(storage?.getItem?.(ZEBRA_LABEL_REGISTRY_KEY) || "[]");
        if (Array.isArray(parsed)) return { labels: parsed, nextSequence: 0 };
        return {
          labels: Array.isArray(parsed?.labels) ? parsed.labels : [],
          nextSequence: Math.max(0, Number(parsed?.nextSequence) || 0)
        };
      } catch {
        return { labels: [], nextSequence: 0 };
      }
    };
    const localRegistry = read(window.localStorage);
    const sessionRegistry = read(window.sessionStorage);
    zebraLabelSequenceMemory = Math.max(
      zebraLabelSequenceMemory,
      localRegistry.nextSequence,
      sessionRegistry.nextSequence
    );
    const merged = [...localRegistry.labels, ...sessionRegistry.labels];
    return [...new Map(merged.filter(item => item?.code).map(item => [String(item.code), item])).values()];
  }

  function writeCompactZebraRegistry(labels = []) {
    const compact = labels
      .filter(item => item?.sourceType === "DIGITACION_ETIQUETA_ZEBRA" && item?.code)
      .slice(0, 1000)
      .map(item => ({
        id: item.id,
        code: item.code,
        date: item.date,
        createdAt: item.createdAt,
        printedAt: item.printedAt,
        scannedAt: item.scannedAt,
        colorDay: item.colorDay,
        color: item.color,
        supplier: item.supplier,
        block: item.block,
        buncher: item.buncher,
        buncher_employee_id: item.buncher_employee_id || item.buncherEmployeeId || "",
        buncherEmployeeId: item.buncherEmployeeId || item.buncher_employee_id || "",
        variety: item.variety,
        length: item.length,
        category: item.category,
        stemsPerBunch: item.stemsPerBunch,
        labelType: item.labelType,
        composition: item.composition,
        state: item.state,
        inventoryId: item.inventoryId,
        outputType: item.outputType,
        sourceType: item.sourceType,
        lotId: item.lotId || "",
        lotCode: item.lotCode || "",
        destinationType: item.destinationType || (item.localDestinationCustomerId ? "LOCAL" : "EXPORT"),
        destinationMode: item.destinationMode || "BLESS_EXPORT",
        destinationCustomerId: item.destinationCustomerId || item.localDestinationCustomerId || "",
        localDestinationCustomerId: item.localDestinationCustomerId || item.destinationCustomerId || "",
        destinationCustomerName: item.destinationCustomerName || item.localDestinationName || "",
        localDestinationName: item.localDestinationName || item.destinationCustomerName || "",
        destinationOrderId: item.destinationOrderId || "",
        storedComposition: true,
        printCount: item.printCount
      }));
    const serialized = JSON.stringify({
      version: 2,
      nextSequence: readPersistentZebraSequence(),
      labels: compact
    });
    try {
      window.localStorage?.setItem?.(ZEBRA_LABEL_REGISTRY_KEY, serialized);
      try { window.sessionStorage?.removeItem?.(ZEBRA_LABEL_REGISTRY_KEY); } catch {}
      return "LOCAL";
    } catch {
      try {
        window.sessionStorage?.setItem?.(ZEBRA_LABEL_REGISTRY_KEY, serialized);
        return "SESSION";
      } catch {
        return "MEMORY";
      }
    }
  }

  function hydrateCompactZebraRegistry(store) {
    const compact = readCompactZebraRegistry();
    compact.forEach(saved => {
      const existing = store.labelBatches.find(item => normalizeBunchLabelCode(item.code) === normalizeBunchLabelCode(saved.code));
      if (existing) Object.assign(existing, saved);
      else store.labelBatches.unshift(saved);
    });
  }

  const PERSON_CATALOG_TYPES = new Set(["classifiers", "bunchers", "receptionists", "digitizers", "scanners", "responsibles"]);

  function normalizePersonName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function normalizePayrollEmployee(employee = {}) {
    const employeeId = String(employee.employee_id || employee.employeeId || employee.id || "").trim();
    const fullName = employee.full_name || employee.fullName || employee.name || employee.nombre || "";
    return {
      ...employee,
      employee_id: employeeId,
      employeeId,
      full_name: fullName,
      fullName
    };
  }

  function listPayrollEmployees(appState) {
    try {
      const serviceRows = BlessERP.payrollService?.listEmployees?.({ includeInactive: true });
      if (Array.isArray(serviceRows)) return serviceRows.map(normalizePayrollEmployee);
      const direct = appState?.db?.payroll?.employees;
      if (Array.isArray(direct)) return direct.map(normalizePayrollEmployee);
      const seedRows = BlessERP.payrollData?.createDemoEmployees?.();
      return Array.isArray(seedRows) ? seedRows.map(normalizePayrollEmployee) : [];
    } catch (error) {
      const direct = appState?.db?.payroll?.employees;
      if (Array.isArray(direct)) return direct.map(normalizePayrollEmployee);
      const seedRows = BlessERP.payrollData?.createDemoEmployees?.();
      return Array.isArray(seedRows) ? seedRows.map(normalizePayrollEmployee) : [];
    }
  }

  function employeeIdOf(value = {}) {
    const source = value || {};
    return String(source.employee_id || source.employeeId || "").trim();
  }

  function setEmployeeId(target, employeeId, options = {}) {
    if (!target || !employeeId) return target;
    const normalizedEmployeeId = String(employeeId).trim();
    target.employee_id = normalizedEmployeeId;
    target.employeeId = normalizedEmployeeId;
    if (options.role) {
      target[`${options.role}_employee_id`] = normalizedEmployeeId;
      target[`${options.role}EmployeeId`] = normalizedEmployeeId;
    }
    if (options.source) target.employeeLinkSource = options.source;
    return target;
  }

  function findCatalogPerson(store, type, value = {}) {
    const rows = PERSON_CATALOG_TYPES.has(type) ? (store.masterData?.[type] || []) : [];
    const explicitEmployeeId = String(value.employee_id || value.employeeId || "").trim();
    const catalogId = String(value.catalogId || value.id || "").trim();
    const name = String(value.name || "").trim();
    return rows.find(item => explicitEmployeeId && employeeIdOf(item) === explicitEmployeeId)
      || rows.find(item => catalogId && String(item.id || "") === catalogId)
      || rows.find(item => name && normalizePersonName(item.name) === normalizePersonName(name))
      || null;
  }

  function resolveCatalogEmployee(store, type, value = {}) {
    const catalog = findCatalogPerson(store, type, value);
    // employee_id es la identidad operativa histórica de Poscosecha. Nómina V2
    // la vincula a un employee_id UUID mediante su tabla canónica; nunca por nombre.
    const operationalWorkerId = String(
      value.operational_worker_id || value.operationalWorkerId
      || catalog?.operational_worker_id || catalog?.operationalWorkerId
      || value.employee_id || value.employeeId || employeeIdOf(catalog) || catalog?.id || ""
    ).trim();
    return {
      employeeId: operationalWorkerId,
      employee_id: operationalWorkerId,
      operationalWorkerId,
      operational_worker_id: operationalWorkerId,
      catalogId: catalog?.id || "",
      name: catalog?.name || String(value.name || "").trim(),
      linked: Boolean(operationalWorkerId)
    };
  }

  function migrateLegacyEmployeeLinks(appState, store) {
    let catalogLinks = 0;
    PERSON_CATALOG_TYPES.forEach(type => {
      (store.masterData?.[type] || []).forEach(item => {
        const currentId = employeeIdOf(item) || String(item.id || "").trim();
        if (!currentId) return;
        if (!employeeIdOf(item)) catalogLinks += 1;
        setEmployeeId(item, currentId, { source: item.employeeLinkSource || "OPERATIONAL_CATALOG_ID" });
        item.operational_worker_id = currentId;
        item.operationalWorkerId = currentId;
      });
    });

    const linkByCatalog = (target, type, nameField, role, primary = true) => {
      if (!target) return;
      const existingRoleId = target[`${role}_employee_id`] || target[`${role}EmployeeId`] || (primary ? employeeIdOf(target) : "");
      const link = resolveCatalogEmployee(store, type, {
        name: target[nameField],
        employeeId: existingRoleId
      });
      if (!link.employeeId) return;
      if (primary) setEmployeeId(target, link.employeeId, { source: target.employeeLinkSource || "CATALOG_ID" });
      target[`${role}_employee_id`] = link.employeeId;
      target[`${role}EmployeeId`] = link.employeeId;
    };

    (store.receptions || []).forEach(item => {
      linkByCatalog(item, "receptionists", "receptionist", "receptionist");
      linkByCatalog(item, "responsibles", "responsible", "responsible", false);
    });
    (store.classifierAssignments || []).forEach(item => linkByCatalog(item, "classifiers", "classifier", "classifier"));
    (store.meshProcessingRecords || []).forEach(item => linkByCatalog(item, "classifiers", "classifier", "classifier"));
    (store.processedMeshHistory || []).forEach(item => linkByCatalog(item, "classifiers", "workerName", "classifier"));
    (store.labelBatches || []).forEach(item => linkByCatalog(item, "bunchers", "buncher", "buncher"));
    (store.roseInventory || []).forEach(item => linkByCatalog(item, "bunchers", "buncher", "buncher"));
    (store.bunchEntries || []).forEach(item => {
      linkByCatalog(item, "bunchers", "buncher", "buncher");
      linkByCatalog(item, "classifiers", "classifier", "classifier", false);
    });
    (store.performances || []).forEach(item => {
      const type = String(item.activity || "").toUpperCase() === "CLASIFICACION" ? "classifiers" : "bunchers";
      const role = type === "classifiers" ? "classifier" : "buncher";
      linkByCatalog(item, type, "worker", role);
    });
    (store.classificationResults || []).forEach(item => {
      const assignment = (store.classifierAssignments || []).find(entry => entry.id === item.assignmentId);
      if (assignment && employeeIdOf(assignment)) setEmployeeId(item, employeeIdOf(assignment), { role: "classifier", source: "ASSIGNMENT_ID" });
    });
    return { catalogLinks };
  }

  function syncPayrollPerformanceEntries(store) {
    const annulledMeshIds = new Set((store.processedMeshHistory || [])
      .filter(item => item.annulled || String(item.state || "").toUpperCase() === "ANULADO")
      .map(item => item.meshId)
      .filter(Boolean));
    const classifierRows = (store.meshProcessingRecords || [])
      .filter(item => !item.demoValidationSeed
        && !annulledMeshIds.has(item.id)
        && !["ANULADO", "CANCELADO"].includes(String(item.status || item.state || "").toUpperCase())
        && employeeIdOf(item))
      .map(item => ({
        id: `PAY-${item.id}`,
        performanceId: `PAY-${item.id}`,
        performance_entry_id: `PAY-${item.id}`,
        employeeId: employeeIdOf(item),
        employee_id: employeeIdOf(item),
        date: String(item.date || item.registeredAt || "").slice(0, 10),
        activity: "CLASIFICACION",
        unit: "TALLOS",
        quantity: utils.parseNumber(item.totalStems),
        completedQuantity: utils.parseNumber(item.totalStems),
        stems: utils.parseNumber(item.totalStems),
        bunches: 0,
        origin: "OPERACIONES_CLASIFICACION",
        sourceId: item.id,
        source_id: item.id,
        workdayId: item.workdayId || "",
        observation: item.observation || "Rendimiento conectado desde Clasificacion."
      }));
    const buncherRows = (store.bunchEntries || [])
      .filter(item => {
        const inventory = (store.roseInventory || []).find(row => row.inventoryId === item.inventoryId || row.sourceBunchEntryId === item.id);
        return !item.demoValidationSeed
          && !inventory?.demoValidationSeed
          && !["ANULADO", "CANCELADO"].includes(String(item.status || item.state || "").toUpperCase())
          && !["ANULADO", "CANCELADO"].includes(String(inventory?.status || inventory?.state || "").toUpperCase())
          && employeeIdOf(item);
      })
      .map(item => ({
        id: `PAY-${item.id}`,
        performanceId: `PAY-${item.id}`,
        performance_entry_id: `PAY-${item.id}`,
        employeeId: employeeIdOf(item),
        employee_id: employeeIdOf(item),
        date: String(item.date || item.registeredAt || "").slice(0, 10),
        activity: "EMBONCHADO",
        unit: "BONCHES",
        quantity: 1,
        completedQuantity: 1,
        bunches: 1,
        stems: utils.parseNumber(item.stemsPerBunch),
        origin: "OPERACIONES_EMBONCHADO",
        sourceId: item.id,
        source_id: item.id,
        workdayId: item.workdayId || "",
        observation: item.observation || "Rendimiento conectado desde el escaneo de ramos."
      }));
    store.payrollPerformanceEntries = [...classifierRows, ...buncherRows];
    return store.payrollPerformanceEntries;
  }

  function linkOperationalCatalogEmployee(appState, type, catalogId, employeeId) {
    const store = ensureStore(appState);
    if (!PERSON_CATALOG_TYPES.has(type)) return { ok: false, error: "El catalogo seleccionado no corresponde a personal." };
    const item = (store.masterData?.[type] || []).find(entry => entry.id === catalogId);
    if (!item) return { ok: false, error: "Parametro operativo no encontrado." };
    const normalizedEmployeeId = String(employeeId || "").trim();
    if (normalizedEmployeeId && !listPayrollEmployees(appState).some(employee => employee.employee_id === normalizedEmployeeId)) {
      return { ok: false, error: "Empleado de Rol de pagos no encontrado." };
    }
    item.employee_id = normalizedEmployeeId;
    item.employeeId = normalizedEmployeeId;
    item.employeeLinkSource = normalizedEmployeeId ? "MANUAL_ID" : "";
    item.employeeLinkedAt = normalizedEmployeeId ? nowLabel() : "";
    migrateLegacyEmployeeLinks(appState, store);
    saveDb();
    return { ok: true, item };
  }

  function activeMasterNames(store, type) {
    return (store.masterData?.[type] || [])
      .filter(item => item.active !== false)
      .map(item => type === "lengths" ? utils.parseNumber(item.name) : item.name);
  }

  function syncCatalogsFromMasterData(store) {
    const map = {
      suppliers: "suppliers",
      classifiers: "classifiers",
      bunchers: "bunchers",
      receptionists: "receptionists",
      digitizers: "digitizers",
      scanners: "scanners",
      responsibles: "responsibles",
      varieties: "varieties",
      lengths: "lengths",
      stemTypes: "stemTypes",
      labelTypes: "labelTypes"
    };
    Object.entries(map).forEach(([catalogKey, masterKey]) => {
      const values = activeMasterNames(store, masterKey);
      // Fincas/bloques y variedades ya son catálogos canónicos de servidor.
      // Incluso un conjunto activo vacío es autoritativo y debe retirar del
      // selector operativo cualquier valor legacy previamente cacheado.
      if (values.length || ["suppliers", "varieties"].includes(masterKey)) {
        store.catalogs[catalogKey] = values;
      }
    });
  }

  function appendMissingValidationRows(target, baseRows, idKey, codeKey, options = {}) {
    // Solo una inicialización de desarrollo invocada expresamente puede
    // reponer seeds. La normalización ordinaria jamás restaura datos borrados.
    if (options.explicitDevelopmentSeed !== true) return 0;
    const ids = new Set((target || []).map(item => item[idKey]).filter(Boolean));
    const codes = new Set((target || []).map(item => item[codeKey]).filter(Boolean));
    const missing = (baseRows || []).filter(item => (
      item.demoValidationSeed && !ids.has(item[idKey]) && !codes.has(item[codeKey])
    ));
    if (missing.length) target.push(...clone(missing));
    return missing.length;
  }

  function deriveInventoryAgeDays(item, now = Date.now()) {
    const admittedValue = String(item?.admittedAt || item?.date || "").trim();
    const admittedDate = new Date(admittedValue.replace(" ", "T"));
    if (Number.isNaN(admittedDate.getTime())) return utils.parseNumber(item?.ageDays);
    return Math.max(0, Math.floor((Number(now) - admittedDate.getTime()) / 86400000));
  }

  function refreshAvailabilityFromScannedInventory(store) {
    if (BlessERP.operacionesAvailabilityDemo?.canonicalAvailabilityRows) {
      store.availabilityDemo = BlessERP.operacionesAvailabilityDemo.canonicalAvailabilityRows(store);
      return store.availabilityDemo;
    }
    const grouped = new Map();
    (store.roseInventory || [])
      .filter(item => item.sourceType === "ESCANEO_ETIQUETA" && !["ASIGNADO_CAJA", "RESERVADO", "DESPACHADO", "VENCIDO", "OBSERVADO", "ANULADO"].includes(item.state))
      .forEach(item => {
        const key = [item.variety, item.length, item.stemsPerBunch, item.warehouse, item.supplier, item.block, item.category].join("|").toUpperCase();
        const current = grouped.get(key) || {
          availability_id: `AVL-SCAN-${key.replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").slice(0, 70)}`,
          fecha: item.date,
          fecha_ingreso_bodega: item.date,
          variedad: item.variety,
          longitud: item.length,
          tallos_por_ramo: item.stemsPerBunch,
          ramos_disponibles: 0,
          tallos_disponibles: 0,
          bodega: item.warehouse,
          proveedor: item.supplier,
          bloque: item.block,
          categoria: item.category,
          estado: "DISPONIBLE",
          edad_dias: deriveInventoryAgeDays(item),
          observacion: "Generada exclusivamente desde ramos ingresados por escaneo.",
          inventory_ids: []
        };
        current.ramos_disponibles += utils.parseNumber(item.bunches, 1);
        current.tallos_disponibles += utils.parseNumber(item.stems, item.stemsPerBunch);
        current.inventory_ids.push(item.inventoryId);
        grouped.set(key, current);
      });
    store.availabilityDemo = [...grouped.values()];
  }

  function addScannedInventoryToAvailability(store, item) {
    store.availabilityDemo = Array.isArray(store.availabilityDemo) ? store.availabilityDemo : [];
    const key = [item.variety, item.length, item.stemsPerBunch, item.warehouse, item.supplier, item.block, item.category].join("|").toUpperCase();
    let current = store.availabilityDemo.find(row => (
      [row.variedad, row.longitud, row.tallos_por_ramo, row.bodega, row.proveedor, row.bloque, row.categoria].join("|").toUpperCase() === key
    ));
    if (!current) {
      current = {
        availability_id: `AVL-SCAN-${key.replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").slice(0, 70)}`,
        fecha: item.date,
        fecha_ingreso_bodega: item.date,
        variedad: item.variety,
        longitud: item.length,
        tallos_por_ramo: item.stemsPerBunch,
        ramos_disponibles: 0,
        tallos_disponibles: 0,
        bodega: item.warehouse,
        proveedor: item.supplier,
        bloque: item.block,
        categoria: item.category,
        estado: "DISPONIBLE",
        edad_dias: item.ageDays || 0,
        observacion: "Generada exclusivamente desde ramos ingresados por escaneo.",
        inventory_ids: []
      };
      store.availabilityDemo.push(current);
    }
    current.fecha = item.date || current.fecha;
    current.fecha_ingreso_bodega = item.date || current.fecha_ingreso_bodega;
    current.ramos_disponibles = utils.parseNumber(current.ramos_disponibles) + utils.parseNumber(item.bunches, 1);
    current.tallos_disponibles = utils.parseNumber(current.tallos_disponibles) + utils.parseNumber(item.stems, item.stemsPerBunch);
    current.inventory_ids = Array.isArray(current.inventory_ids) ? current.inventory_ids : [];
    if (item.inventoryId && !current.inventory_ids.includes(item.inventoryId)) current.inventory_ids.unshift(item.inventoryId);
    return current;
  }

  function isPermanentBunchEntry(item) {
    if (!item || typeof item !== "object") return false;
    const code = normalizeBunchLabelCode(item.code || item.labelCode);
    if (!code) return false;
    return item.admissionSource === "ESCANEO_ETIQUETA"
      || item.intakeState === "INGRESADO_POR_ESCANEO"
      || ["INGRESADO_POR_ESCANEO", "ANULADO"].includes(String(item.state || "").toUpperCase())
      || Boolean(item.inventoryId || item.registeredAt || item.labelId);
  }

  function reconcilePermanentBunchInventories(store) {
    store.roseInventory = Array.isArray(store.roseInventory) ? store.roseInventory : [];
    store.bunchEntries = Array.isArray(store.bunchEntries) ? store.bunchEntries : [];

    const inventoryByCode = new Map();
    store.roseInventory.forEach(item => {
      const code = normalizeBunchLabelCode(item.labelCode || item.code);
      if (!code) return;
      item.labelCode = code;
      inventoryByCode.set(code, item);
    });

    const entryByCode = new Map();
    store.bunchEntries.forEach(item => {
      const code = normalizeBunchLabelCode(item.code || item.labelCode);
      if (!code) return;
      item.code = code;
      if (isPermanentBunchEntry(item)) {
        item.admissionSource = "ESCANEO_ETIQUETA";
        item.intakeState = "INGRESADO_POR_ESCANEO";
        entryByCode.set(code, item);
      }
    });

    const labelByCode = new Map((store.labelBatches || []).map(label => [
      normalizeBunchLabelCode(label.code),
      label
    ]).filter(([code]) => Boolean(code)));
    const admissionEvidence = new Map();
    (store.scannerEvents || []).forEach(event => {
      const code = normalizeBunchLabelCode(event.code || event.labelCode);
      if (!code || String(event.result || "").toUpperCase() !== "INVENTARIO_CREADO") return;
      admissionEvidence.set(code, {
        registeredAt: event.dateTime || "",
        inventoryId: event.inventoryId || "",
        labelId: event.labelId || ""
      });
    });
    labelByCode.forEach((label, code) => {
      if (!label.inventoryId && !label.scannedAt && String(label.state || "").toUpperCase() !== "ESCANEADA") return;
      const current = admissionEvidence.get(code) || {};
      admissionEvidence.set(code, {
        registeredAt: current.registeredAt || label.scannedAt || "",
        inventoryId: current.inventoryId || label.inventoryId || "",
        labelId: current.labelId || label.id || ""
      });
    });
    admissionEvidence.forEach((evidence, code) => {
      if (entryByCode.has(code)) return;
      const label = labelByCode.get(code) || {};
      const annulled = ["ANULADA", "ANULADO"].includes(String(label.state || "").toUpperCase());
      const entry = {
        id: `RAMO-REC-${code}`,
        date: String(evidence.registeredAt || label.date || today()).slice(0, 10),
        code,
        supplier: label.supplier || "",
        block: label.block || "",
        variety: label.variety || "",
        length: label.length,
        stemsPerBunch: label.stemsPerBunch,
        classifier: "NO RELACIONADO",
        buncher: label.buncher || "",
        responsible: "",
        state: annulled ? "ANULADO" : "INGRESADO_POR_ESCANEO",
        intakeState: "INGRESADO_POR_ESCANEO",
        admissionSource: "ESCANEO_ETIQUETA",
        operationalState: annulled ? "ANULADO" : "DISPONIBLE",
        observation: "Historial de ingreso reconstruido desde la evidencia permanente del escáner.",
        registeredAt: evidence.registeredAt || label.scannedAt || `${label.date || today()} 00:00`,
        labelId: evidence.labelId || label.id || "",
        inventoryId: evidence.inventoryId || label.inventoryId || `INV-REC-${code}`,
        composition: Array.isArray(label.composition) ? clone(label.composition) : []
      };
      store.bunchEntries.push(entry);
      entryByCode.set(code, entry);
    });

    entryByCode.forEach((entry, code) => {
      let inventory = inventoryByCode.get(code);
      if (!inventory) {
        const inventoryId = entry.inventoryId || `INV-REC-${code}`;
        inventory = {
          inventoryId,
          date: entry.date || String(entry.registeredAt || today()).slice(0, 10),
          admittedAt: entry.registeredAt || `${entry.date || today()} 00:00`,
          labelCode: code,
          variety: entry.variety || "",
          length: utils.parseNumber(entry.length),
          stemsPerBunch: utils.parseNumber(entry.stemsPerBunch),
          bunches: 1,
          stems: utils.parseNumber(entry.stemsPerBunch),
          warehouse: entry.warehouse || "CUARTO FRIO 1",
          location: entry.location || "PENDIENTE UBICACION",
          supplier: entry.supplier || "",
          block: entry.block || "",
          ageDays: 0,
          category: entry.category || "EXPORTACION",
          state: String(entry.operationalState || entry.inventoryState || "").toUpperCase()
            || (String(entry.state || "").toUpperCase() === "ANULADO" ? "ANULADO" : "DISPONIBLE"),
          buncher: entry.buncher || "",
          responsible: entry.responsible || "",
          coldState: entry.coldState || "PENDIENTE_UBICACION",
          observation: `${entry.observation || ""}${entry.observation ? " | " : ""}Inventario operativo reconstruido desde el historial permanente de ingreso por escaneo.`,
          composition: Array.isArray(entry.composition) ? clone(entry.composition) : [],
          sourceType: "ESCANEO_ETIQUETA",
          sourceBunchEntryId: entry.id || `RAMO-REC-${code}`,
          sourceLabelId: entry.labelId || "",
          sourceScannerEventId: entry.sourceScannerEventId || ""
        };
        store.roseInventory.push(inventory);
        inventoryByCode.set(code, inventory);
      }
      inventory.sourceType = "ESCANEO_ETIQUETA";
      inventory.sourceBunchEntryId = inventory.sourceBunchEntryId || entry.id || `RAMO-REC-${code}`;
      entry.inventoryId = inventory.inventoryId;
      entry.operationalState = inventory.state || entry.operationalState || "DISPONIBLE";
    });

    inventoryByCode.forEach((inventory, code) => {
      const hasScannerEvidence = inventory.sourceType === "ESCANEO_ETIQUETA"
        || Boolean(inventory.sourceScannerEventId || inventory.sourceBunchEntryId)
        || entryByCode.has(code);
      if (!hasScannerEvidence) return;
      inventory.sourceType = "ESCANEO_ETIQUETA";
      let entry = entryByCode.get(code);
      if (!entry) {
        const entryId = inventory.sourceBunchEntryId || `RAMO-REC-${code}`;
        entry = {
          id: entryId,
          date: inventory.date || String(inventory.admittedAt || today()).slice(0, 10),
          code,
          supplier: inventory.supplier || "",
          block: inventory.block || "",
          variety: inventory.variety || "",
          length: inventory.length,
          stemsPerBunch: inventory.stemsPerBunch || inventory.stems,
          classifier: inventory.classifier || "NO RELACIONADO",
          buncher: inventory.buncher || "",
          responsible: inventory.responsible || "",
          state: inventory.state === "ANULADO" ? "ANULADO" : "INGRESADO_POR_ESCANEO",
          intakeState: "INGRESADO_POR_ESCANEO",
          admissionSource: "ESCANEO_ETIQUETA",
          observation: inventory.observation || "Ingreso recuperado desde inventario operativo.",
          registeredAt: inventory.admittedAt || `${inventory.date || today()} 00:00`,
          labelId: inventory.sourceLabelId || "",
          inventoryId: inventory.inventoryId,
          operationalState: inventory.state || "DISPONIBLE",
          composition: Array.isArray(inventory.composition) ? clone(inventory.composition) : []
        };
        store.bunchEntries.push(entry);
        entryByCode.set(code, entry);
      } else {
        entry.operationalState = inventory.state || entry.operationalState || "DISPONIBLE";
      }
      inventory.sourceBunchEntryId = inventory.sourceBunchEntryId || entry.id;
    });

    return { inventoryByCode, entryByCode };
  }

  function synchronizeAvailabilityFromInventory(appState, options = {}) {
    const store = ensureStore(appState);
    refreshAvailabilityFromScannedInventory(store);
    if (options.persist === true) saveDb();
    return store.availabilityDemo;
  }

  function normalizeOperationalStore(store, base) {
    store.bunches = Array.isArray(store.bunches) ? store.bunches : [];
    store.labelBatches = Array.isArray(store.labelBatches) ? store.labelBatches : [];
    hydrateCompactZebraRegistry(store);
    store.roseInventory = Array.isArray(store.roseInventory) ? store.roseInventory : [];
    store.bunchEntries = Array.isArray(store.bunchEntries) ? store.bunchEntries : [];
    store.bunchDeletionAudit = Array.isArray(store.bunchDeletionAudit) ? store.bunchDeletionAudit : [];
    store.labelBatches.forEach(item => {
      const code = normalizeBunchLabelCode(item.code);
      if (code) item.code = code;
    });
    store.roseInventory.forEach(item => {
      const code = normalizeBunchLabelCode(item.labelCode || item.code);
      if (code) item.labelCode = code;
    });
    store.bunchEntries.forEach(item => {
      const code = normalizeBunchLabelCode(item.code || item.labelCode);
      if (code) item.code = code;
    });
    store.masterData = store.masterData || data.createMasterData();
    const baseMasterData = data.createMasterData();
    Object.entries(baseMasterData).forEach(([type, rows]) => {
      if (!Array.isArray(store.masterData[type])) store.masterData[type] = rows;
    });
    (store.masterData.suppliers || []).forEach((supplier, index) => {
      const baseSupplier = baseMasterData.suppliers.find(item => item.name === supplier.name) || baseMasterData.suppliers[index];
      supplier.assignedBlock = supplier.assignedBlock || baseSupplier?.assignedBlock || store.catalogs.blocks[index] || "SIN BLOQUE";
    });
    synchronizeBunchLabelSequence(store);
    store.classifierAssignments = Array.isArray(store.classifierAssignments) ? store.classifierAssignments : [];
    store.classificationResults = Array.isArray(store.classificationResults) ? store.classificationResults : [];
    store.receptionEditAudit = Array.isArray(store.receptionEditAudit) ? store.receptionEditAudit : [];
    const assignmentsWithNational = new Set(store.classificationResults.map(item => item.assignmentId).filter(Boolean));
    store.classifierAssignments.forEach(item => {
      if (item.status === "ANULADO") return;
      const hasNationalResult = assignmentsWithNational.has(item.id)
        || item.status === "COMPLETADO"
        || item.status === "ENTREGADO + REGISTRADO NACIONAL"
        || utils.parseNumber(item.nationalStems) > 0;
      item.status = hasNationalResult ? "ENTREGADO + REGISTRADO NACIONAL" : "ENTREGADO";
    });
    store.ui.parameterDraft = store.ui.parameterDraft || data.createParameterDraft();
    store.ui.receptionItemDraft = store.ui.receptionItemDraft || data.createReceptionItemDraft();
    if (store.ui.receptionVarietyPlaceholderVersion !== 1) {
      if (!store.ui.receptionItemDraft.id && store.ui.receptionItemDraft.variety === "EXPLORER") {
        store.ui.receptionItemDraft.variety = "";
      }
      store.ui.receptionVarietyPlaceholderVersion = 1;
    }
    store.ui.receptionHistorySupplier = store.ui.receptionHistorySupplier || "";
    store.ui.receptionHistoryBlock = store.ui.receptionHistoryBlock || "";
    store.ui.receptionHistoryVariety = store.ui.receptionHistoryVariety || "";
    const receptionHistoryStatus = String(store.ui.receptionHistoryStatus || "").toUpperCase() === "COMPLETA"
      ? "COMPLETO"
      : String(store.ui.receptionHistoryStatus || "").toUpperCase();
    store.ui.receptionHistoryStatus = ["PENDIENTE", "PARCIAL", "COMPLETO"].includes(receptionHistoryStatus)
      ? receptionHistoryStatus
      : "";
    store.ui.receptionHistoryView = ["DETALLE", "ACUMULADO"].includes(store.ui.receptionHistoryView)
      ? store.ui.receptionHistoryView
      : "DETALLE";
    store.ui.receptionSummaryGroup = ["PROVEEDOR", "VARIEDAD"].includes(store.ui.receptionSummaryGroup)
      ? store.ui.receptionSummaryGroup
      : "PROVEEDOR";
    store.ui.classificationAssignmentDraft = store.ui.classificationAssignmentDraft || data.createClassificationAssignmentDraft();
    store.ui.classificationResultDraft = store.ui.classificationResultDraft || data.createClassificationResultDraft();
    store.ui.bunchIntakeDraft = store.ui.bunchIntakeDraft || data.createBunchIntakeDraft();
    store.ui.bunchIntakeDraft.responsible = data.DEFAULT_BUNCH_INTAKE_RESPONSIBLE || "DIGITADOR GENERAL";
    store.ui.lastBunchIntakeResult = store.ui.lastBunchIntakeResult || null;
    store.ui.mixedBunchIntakeDraft = store.ui.mixedBunchIntakeDraft || null;
    if (store.ui.bunchHidAutomaticMigrated !== true) {
      if (store.ui.bunchIntakeDraft.code === "0000000002") store.ui.bunchIntakeDraft.code = "";
      store.ui.bunchHidAutomaticMigrated = true;
    }
    store.ui.bunchIntakeReaderConnected = true;
    store.ui.bunchSearchReaderConnected = true;
    store.ui.bunchReaderConnected = true;
    store.ui.bunchReaderTarget = ["INGRESO", "BUSQUEDA"].includes(store.ui.bunchReaderTarget) ? store.ui.bunchReaderTarget : "INGRESO";
    store.ui.bunchSearchScanCode = store.ui.bunchSearchScanCode || "";
    store.ui.bunchSearchFilter = store.ui.bunchSearchFilter || "";
    store.ui.bunchSearchCodes = Array.isArray(store.ui.bunchSearchCodes) ? [...new Set(store.ui.bunchSearchCodes.map(normalizeBunchLabelCode).filter(Boolean))] : [];
    store.ui.bunchSearchSelectedCodes = Array.isArray(store.ui.bunchSearchSelectedCodes) ? [...new Set(store.ui.bunchSearchSelectedCodes.map(normalizeBunchLabelCode).filter(Boolean))] : [];
    store.ui.bunchSearchTargetLength = store.ui.bunchSearchTargetLength || "";
    store.ui.bunchSearchDialog = ["UPDATE", "DELETE"].includes(store.ui.bunchSearchDialog) ? store.ui.bunchSearchDialog : "";
    store.ui.bunchSearchDeleteReason = store.ui.bunchSearchDeleteReason || "";
    store.ui.availabilityBunchesPerPiece = [4, 12, 14].includes(utils.parseNumber(store.ui.availabilityBunchesPerPiece))
      ? utils.parseNumber(store.ui.availabilityBunchesPerPiece)
      : 12;
    store.ui.meshHistoryOpen = Boolean(store.ui.meshHistoryOpen);
    store.ui.meshHistoryFilters = { ...data.createMeshHistoryFilters(), ...(store.ui.meshHistoryFilters || {}) };
    store.ui.meshHistoryAppliedFilters = { ...data.createMeshHistoryFilters(), ...(store.ui.meshHistoryAppliedFilters || {}) };
    store.ui.meshHistorySort = store.ui.meshHistorySort || "date-desc";
    store.ui.meshHistoryPage = Math.max(1, utils.parseNumber(store.ui.meshHistoryPage, 1));
    store.ui.meshHistoryPageSize = [10, 25, 50, 100].includes(utils.parseNumber(store.ui.meshHistoryPageSize)) ? utils.parseNumber(store.ui.meshHistoryPageSize) : 10;
    store.ui.meshHistoryDialog = store.ui.meshHistoryDialog || null;
    store.ui.meshHistoryEditDraft = store.ui.meshHistoryEditDraft || null;
    const supplierReportFilterDefaults = {
      from: "",
      to: "",
      supplier: "",
      variety: "",
      length: "",
      classificationType: "",
      reportType: "DETALLADO"
    };
    store.ui.inventorySupplierReportOpen = Boolean(store.ui.inventorySupplierReportOpen);
    store.ui.inventorySupplierReportFilters = {
      ...supplierReportFilterDefaults,
      ...(store.ui.inventorySupplierReportFilters || {})
    };
    store.ui.inventorySupplierReportAppliedFilters = {
      ...supplierReportFilterDefaults,
      ...(store.ui.inventorySupplierReportAppliedFilters || {})
    };
    const supplierReportSort = store.ui.inventorySupplierReportSort || {};
    store.ui.inventorySupplierReportSort = {
      field: supplierReportSort.field || "dateTime",
      direction: supplierReportSort.direction === "asc" ? "asc" : "desc"
    };
    store.ui.roseInventorySearch = store.ui.roseInventorySearch || "";
    store.ui.roseInventorySupplier = store.ui.roseInventorySupplier || "";
    store.ui.roseInventoryVariety = store.ui.roseInventoryVariety || "";
    store.ui.roseInventoryBuncher = store.ui.roseInventoryBuncher || "";
    store.ui.roseInventoryDate = store.ui.roseInventoryDate || "";
    store.processedMeshHistory = Array.isArray(store.processedMeshHistory) ? store.processedMeshHistory : [];
    store.processedMeshHistoryAudit = Array.isArray(store.processedMeshHistoryAudit) ? store.processedMeshHistoryAudit : [];
    store.processedMeshHistory.forEach(item => {
      item.meshCount = Math.max(0, utils.parseNumber(item.meshCount, 0));
      item.inventoryScope = "HISTORIAL_OPERATIVO_MALLAS";
      item.accountingImpact = false;
    });
    store.yieldSettings = data.createYieldSettings(store.yieldSettings || {});
    store.yieldWorkdayHistory = Array.isArray(store.yieldWorkdayHistory) ? store.yieldWorkdayHistory : [];
    const rawWorkday = store.yieldWorkday || data.createYieldWorkday();
    const normalizedWorkdayStatus = workdayCore.normalizeStatus(rawWorkday.status);
    const staleLegacyWorkday = String(rawWorkday.status || "").endsWith("_DEMO") && rawWorkday.date !== today();
    store.yieldWorkday = staleLegacyWorkday
      ? data.createYieldWorkday()
      : data.createYieldWorkday({
          ...rawWorkday,
          status: normalizedWorkdayStatus,
          pauses: Array.isArray(rawWorkday.pauses) ? rawWorkday.pauses : [],
          summary: rawWorkday.summary || null
        });
    const currentDate = today();
    const currentMonth = String(currentDate || "").slice(0, 7);
    const [currentYear, currentMonthNumber] = currentMonth.split("-").map(Number);
    const currentMonthLastDay = currentYear && currentMonthNumber
      ? new Date(currentYear, currentMonthNumber, 0).getDate()
      : 31;
    store.ui.bunchReportFrom = store.ui.bunchReportFrom || `${currentMonth}-01`;
    store.ui.bunchReportTo = store.ui.bunchReportTo || `${currentMonth}-${String(currentMonthLastDay).padStart(2, "0")}`;
    store.ui.warehouseOrderId = store.ui.warehouseOrderId || "order-demo-0001";
    store.ui.warehouseBoxNumber = utils.parseNumber(store.ui.warehouseBoxNumber, 1);
    store.ui.warehouseScanCode = store.ui.warehouseScanCode || "";
    store.ui.warehouseOrderFilter = store.ui.warehouseOrderFilter || "ABIERTAS";
    store.ui.warehouseLastScan = store.ui.warehouseLastScan || null;
    (store.receptions || []).forEach(reception => {
      reception.createdAt = reception.createdAt || `${reception.date || today()} 00:00`;
      if (!Array.isArray(reception.items) || !reception.items.length) {
        reception.items = [{
          id: uid("REC-ITEM"),
          variety: reception.variety || store.catalogs.varieties[0] || "",
          stemType: reception.stemType || "LARGO",
          meshCount: utils.parseNumber(reception.meshCount),
          stemsPerMesh: utils.parseNumber(reception.stemsPerMesh, 25),
          extraStems: utils.parseNumber(reception.extraStems),
          totalStems: utils.calculateReceptionTotal(reception)
        }];
      }
      reception.items.forEach(item => { item.totalStems = utils.calculateReceptionTotal(item); });
      reception.totalDeclared = reception.items.reduce((sum, item) => sum + utils.parseNumber(item.totalStems), 0);
      const first = reception.items[0];
      reception.variety = first?.variety || reception.variety;
      reception.stemType = first?.stemType || reception.stemType;
      reception.meshCount = reception.items.reduce((sum, item) => sum + utils.parseNumber(item.meshCount), 0);
      reception.stemsPerMesh = first?.stemsPerMesh || reception.stemsPerMesh;
      reception.extraStems = reception.items.reduce((sum, item) => sum + utils.parseNumber(item.extraStems), 0);
    });
    (store.classifierAssignments || []).forEach(assignment => {
      if (assignment.receptionItemId) return;
      const reception = (store.receptions || []).find(item => item.id === assignment.receptionId);
      const matchingLine = (reception?.items || []).find(item => (
        item.variety === assignment.variety && item.stemType === assignment.stemType
      )) || reception?.items?.[0];
      assignment.receptionItemId = matchingLine?.id || "";
    });
    (store.labelBatches || []).forEach(label => {
      label.createdAt = label.createdAt || `${label.date || today()} 00:00`;
      label.inventoryId = label.inventoryId || "";
      label.printCount = utils.parseNumber(label.printCount, label.state?.includes("IMP") ? 1 : 0);
      if (!/^\d{10}$/.test(String(label.code || ""))) label.legacyCode = true;
    });
    (store.roseInventory || []).forEach(item => {
      item.admittedAt = item.admittedAt || `${item.date || today()} 00:00`;
      item.labelCode = item.labelCode || (store.labelBatches || []).find(label => label.id === item.sourceLabelId)?.code || "";
      const recognizedScanCode = /^\d{10}$/.test(String(item.labelCode || ""))
        || BlessERP.bunchLabelCodec?.isStructuredCode?.(item.labelCode);
      const matchingEntry = (store.bunchEntries || []).find(entry => (
        normalizeBunchLabelCode(entry.code || entry.labelCode) === normalizeBunchLabelCode(item.labelCode)
        && isPermanentBunchEntry(entry)
      ));
      const scannerEvidence = item.sourceType === "ESCANEO_ETIQUETA"
        || Boolean(item.sourceScannerEventId || item.sourceBunchEntryId)
        || Boolean(matchingEntry);
      item.sourceType = scannerEvidence && recognizedScanCode ? "ESCANEO_ETIQUETA" : (item.sourceType || "LEGACY_DEMO");
      item.assignedOrderId = item.assignedOrderId || "";
      item.assignedBoxNumber = item.assignedBoxNumber || "";
      item.assignedLineId = item.assignedLineId || "";
      item.assignedAt = item.assignedAt || "";
    });
    // En producción Supabase es la autoridad: una evidencia parcial conservada
    // en caché nunca puede volver a crear inventario. El reconciliador se mantiene
    // únicamente para el HTML local heredado, donde no existe backend compartido.
    if (!requiresConfirmedRemoteOperations()) reconcilePermanentBunchInventories(store);
    syncCatalogsFromMasterData(store);
    // Disponibilidad y edad son proyecciones de lectura. Se calculan cuando la
    // vista las solicita y no se escriben durante ensureStore()/render.
  }

  function ensureStore(appState) {
    const renderCycle = BlessERP.performance?.currentRenderCycle?.();
    const currentStore = appState.db.operations;
    if (Number.isFinite(renderCycle) && currentStore && currentStore === normalizedStore && renderCycle === normalizedRenderCycle) {
      return currentStore;
    }
    const base = data.createOperationsStore();
    appState.db.operations = mergeMissing(base, appState.db.operations || {});
    const store = appState.db.operations;
    normalizeOperationalStore(store, base);
    migrateLegacyEmployeeLinks(appState, store);
    syncPayrollPerformanceEntries(store);
    store.ui.receptionDraft.items = Array.isArray(store.ui.receptionDraft.items) ? store.ui.receptionDraft.items : [];
    store.ui.receptionDraft.totalDeclared = store.ui.receptionDraft.items.reduce((sum, item) => sum + utils.calculateReceptionTotal(item), 0);
    store.availabilityDemo = Array.isArray(store.availabilityDemo) ? store.availabilityDemo : [];
    store.demoReservations = Array.isArray(store.demoReservations) ? store.demoReservations : [];
    const hasSelectedAvailability = store.availabilityDemo.some(item => item.availability_id === store.ui.selectedAvailabilityId);
    if (!hasSelectedAvailability) {
      store.ui.selectedAvailabilityId = store.availabilityDemo[0]?.availability_id || "";
    }
    store.ui.selectedDispatchOrderId = String(store.ui.selectedDispatchOrderId || "").trim();
    store.ui.dispatchViewMode = store.ui.dispatchViewMode || "list";
    store.ui.dispatchPreviewOrderId = store.ui.dispatchPreviewOrderId || "";
    store.ui.dispatchDetailTab = store.ui.dispatchDetailTab || "boxes";
    store.ui.dispatchAssemblyBoxNumber = utils.parseNumber(store.ui.dispatchAssemblyBoxNumber, 1);
    store.ui.dispatchBunchScanCode = store.ui.dispatchBunchScanCode || "";
    store.ui.dispatchLastBunchScan = store.ui.dispatchLastBunchScan || null;
    if (store.ui.classificationAssignmentManualSelectionVersion !== 2) {
      const previousClassifier = store.ui.classificationAssignmentDraft?.classifier || store.catalogs.classifiers[0] || "";
      store.ui.classificationAssignmentDraft = data.createClassificationAssignmentDraft({
        classifier: previousClassifier,
        receptionId: "",
        receptionItemId: "",
        supplier: "",
        block: "",
        variety: "",
        meshCount: 0,
        extraStems: 0
      });
      store.ui.classificationAssignmentSelectionConfirmed = false;
      store.ui.classificationAssignmentManualSelectionVersion = 2;
    }
    const pendingReceptionLines = receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
      .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
      .map(item => ({ ...item, receptionId: reception.id, supplier: reception.supplier, block: reception.block })));
    const assignmentDraft = store.ui.classificationAssignmentDraft;
    const hasExplicitAssignment = store.ui.classificationAssignmentSelectionConfirmed === true
      || Boolean(assignmentDraft.receptionId && assignmentDraft.receptionItemId);
    let selectedPendingLine = hasExplicitAssignment
      ? pendingReceptionLines.find(item => (
          item.receptionId === assignmentDraft.receptionId
          && item.id === assignmentDraft.receptionItemId
        ))
      : null;
    if (!selectedPendingLine && hasExplicitAssignment && assignmentDraft.block && assignmentDraft.variety) {
      selectedPendingLine = pendingReceptionLines.find(item => (
        String(item.block || "").trim().toUpperCase() === String(assignmentDraft.block || "").trim().toUpperCase()
        && String(item.variety || "").trim().toUpperCase() === String(assignmentDraft.variety || "").trim().toUpperCase()
      ));
    }
    if (selectedPendingLine) {
      assignmentDraft.supplier = selectedPendingLine.supplier || "";
      assignmentDraft.block = selectedPendingLine.block || "";
      assignmentDraft.variety = selectedPendingLine.variety || "";
      store.ui.classificationAssignmentSelectionConfirmed = true;
    } else if (store.ui.classificationAssignmentSelectionConfirmed === true) {
      const configuredSupplier = (store.masterData?.suppliers || []).find(item => (
        item.active !== false
        && String(item.assignedBlock || "").trim().toUpperCase() === String(assignmentDraft.block || "").trim().toUpperCase()
      ));
      if (configuredSupplier) {
        assignmentDraft.supplier = configuredSupplier.name || "";
        assignmentDraft.block = configuredSupplier.assignedBlock || assignmentDraft.block;
      } else {
        assignmentDraft.supplier = "";
        assignmentDraft.block = "";
        assignmentDraft.variety = "";
        store.ui.classificationAssignmentSelectionConfirmed = false;
      }
    }
    assignmentDraft.receptionId = selectedPendingLine?.receptionId || "";
    assignmentDraft.receptionItemId = selectedPendingLine?.id || "";
    const resultDraft = store.ui.classificationResultDraft;
    const selectedResultAssignment = (store.classifierAssignments || []).find(item => item.id === resultDraft.assignmentId && item.status !== "ANULADO");
    if (selectedResultAssignment) {
      resultDraft.supplier = selectedResultAssignment.supplier || "";
      resultDraft.block = selectedResultAssignment.block || "";
      resultDraft.classifier = selectedResultAssignment.classifier || "";
      resultDraft.variety = selectedResultAssignment.variety || "";
    } else {
      const latest = classificationResultAssignments(store)[0];
      resultDraft.assignmentId = latest?.id || "";
      resultDraft.supplier = latest?.supplier || "";
      resultDraft.block = latest?.block || "";
      resultDraft.classifier = latest?.classifier || "";
      resultDraft.variety = latest?.variety || "";
    }
    normalizedStore = store;
    normalizedRenderCycle = Number.isFinite(renderCycle) ? renderCycle : -1;
    return store;
  }

  function getStore(appState) {
    return ensureStore(appState);
  }

  function getUi(appState) {
    return ensureStore(appState).ui;
  }

  function setNotice(appState, text, tone = "info", persist = true, options = {}) {
    const store = ensureStore(appState);
    store.ui.notice = text || "";
    store.ui.noticeTone = tone;
    if (text && options.toast !== false) BlessERP.layout?.toast?.(text, { tone });
    if (noticeTimer) clearTimeout(noticeTimer);
    if (text) {
      noticeTimer = setTimeout(() => {
        if (store.ui.notice === text && store.ui.noticeTone === tone) {
          store.ui.notice = "";
          store.ui.noticeTone = "info";
        }
        noticeTimer = 0;
      }, tone === "danger" ? 4600 : tone === "warning" ? 3400 : tone === "success" ? 1800 : 2400);
    }
    if (persist) saveDb();
  }

  function classificationResultAssignments(store) {
    return (store.classifierAssignments || [])
      .filter(item => item.status !== "ANULADO")
      .slice()
      .sort((left, right) => String(right.dateTime || "").localeCompare(String(left.dateTime || "")));
  }

  function findClassificationResultAssignment(store, draft = {}) {
    const assignments = classificationResultAssignments(store);
    const selected = assignments.find(item => item.id === draft.assignmentId);
    if (selected) return selected;
    return assignments.find(item => (
      (!draft.block || item.block === draft.block) &&
      (!draft.supplier || item.supplier === draft.supplier) &&
      (!draft.classifier || item.classifier === draft.classifier) &&
      (!draft.variety || item.variety === draft.variety)
    ));
  }

  function syncClassificationResultDraft(store, draft, changedField = "") {
    const assignments = classificationResultAssignments(store);
    let candidates = assignments;
    if (changedField === "block") {
      const normalizedBlock = String(draft.block || "").trim().toUpperCase();
      const latest = assignments.find(item => String(item.block || "").trim().toUpperCase() === normalizedBlock);
      draft.block = latest?.block || draft.block;
      draft.supplier = latest?.supplier || "";
      draft.classifier = latest?.classifier || draft.classifier || "";
      draft.variety = latest?.variety || "";
      draft.assignmentId = latest?.id || "";
      return;
    }
    if (draft.block) candidates = candidates.filter(item => item.block === draft.block);
    if (draft.supplier) candidates = candidates.filter(item => item.supplier === draft.supplier);
    if (changedField === "supplier") {
      const latest = candidates[0];
      if (latest) {
        draft.classifier = latest.classifier;
        draft.variety = latest.variety;
        draft.assignmentId = latest.id;
      } else {
        draft.variety = "";
        draft.assignmentId = "";
      }
      return;
    }
    if (draft.classifier) candidates = candidates.filter(item => item.classifier === draft.classifier);
    if (changedField === "classifier") {
      const latest = candidates[0];
      if (latest) {
        draft.variety = latest.variety;
        draft.assignmentId = latest.id;
      } else {
        draft.variety = "";
        draft.assignmentId = "";
      }
      return;
    }
    if (draft.variety) candidates = candidates.filter(item => item.variety === draft.variety);
    draft.assignmentId = candidates[0]?.id || "";
  }

  function updateDraftField(appState, draftKey, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui[draftKey];
    if (!draft) return;
    draft[field] = value;
    if (draftKey === "parameterDraft" && field === "type") {
      store.ui.parameterType = value;
      draft.assignedBlock = value === "suppliers" ? draft.assignedBlock : "";
      draft.labelColor = value === "bunchers" ? draft.labelColor : "";
      if (!PERSON_CATALOG_TYPES.has(value)) {
        draft.employee_id = "";
        draft.employeeId = "";
      }
    }
    if (draftKey === "parameterDraft" && field === "employee_id") {
      const normalizedEmployeeId = String(value || "").trim();
      draft.employee_id = normalizedEmployeeId;
      draft.employeeId = normalizedEmployeeId;
      const employee = listPayrollEmployees(appState)
        .find(item => String(item.employee_id || "") === normalizedEmployeeId);
      if (employee && !String(draft.name || "").trim()) {
        draft.name = String(employee.full_name || "").trim();
      }
    }
    if (draftKey === "receptionDraft") {
      if (field === "supplier") {
        const supplier = (store.masterData.suppliers || []).find(item => item.active !== false && item.name === value);
        draft.block = supplier?.assignedBlock || "SIN BLOQUE ASIGNADO";
      }
      if (field === "block") {
        const normalizedBlock = String(value || "").trim().toUpperCase();
        const supplier = (store.masterData.suppliers || []).find(item => item.active !== false && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock);
        draft.block = supplier?.assignedBlock || value;
        draft.supplier = supplier?.name || "";
      }
      if (field === "receptionist") draft.responsible = value;
      draft.totalDeclared = (draft.items || []).reduce((sum, item) => sum + utils.calculateReceptionTotal(item), 0);
    }
    if (draftKey === "receptionItemDraft") {
      draft.totalStems = utils.calculateReceptionTotal(draft);
    }
    if (draftKey === "labelDraft" && field === "block") {
      const normalizedBlock = String(value || "").trim().toUpperCase();
      const supplier = (store.masterData.suppliers || []).find(item =>
        item.active !== false && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock
      );
      draft.block = supplier?.assignedBlock || value;
      draft.supplier = draft.labelType === "MIXTA" ? "BLESS FL" : (supplier?.name || "");
    }
    if (draftKey === "labelDraft" && field === "labelType") {
      if (value === "MIXTA") {
        draft.block = "";
        draft.supplier = "BLESS FL";
      } else {
        const normalizedBlock = String(draft.block || "").trim().toUpperCase();
        const supplier = (store.masterData.suppliers || []).find(item =>
          item.active !== false && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock
        );
        draft.supplier = supplier?.name || "";
      }
    }
    if (draftKey === "classificationAssignmentDraft" && field === "receptionItemId") {
      const reception = (store.receptions || []).find(item => (item.items || []).some(line => line.id === value));
      draft.receptionId = reception?.id || "";
    }
    if (draftKey === "classificationAssignmentDraft" && ["block", "supplier", "variety"].includes(field)) {
      const pendingLines = receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
        .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
        .map(item => ({ ...item, receptionId: reception.id, supplier: reception.supplier, block: reception.block })));
      if (field === "block") {
        const normalizedBlock = String(value || "").trim().toUpperCase();
        const selectedBlockLine = pendingLines.find(item => String(item.block || "").trim().toUpperCase() === normalizedBlock);
        const configuredSupplier = (store.masterData?.suppliers || []).find(item => (
          item.active !== false
          && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock
        ));
        draft.block = selectedBlockLine?.block || configuredSupplier?.assignedBlock || value;
        draft.supplier = selectedBlockLine?.supplier || configuredSupplier?.name || "";
        store.ui.classificationAssignmentSelectionConfirmed = Boolean(selectedBlockLine || configuredSupplier);
      }
      const blockLines = pendingLines.filter(item => item.block === draft.block);
      if (["block", "supplier"].includes(field) && !blockLines.some(item => item.variety === draft.variety)) {
        draft.variety = blockLines[0]?.variety || "";
      }
      const selectedLine = blockLines.find(item => item.variety === draft.variety);
      draft.receptionId = selectedLine?.receptionId || "";
      draft.receptionItemId = selectedLine?.id || "";
      Object.assign(draft, classificationAssignmentQuantitySeed(selectedLine));
    }
    if (draftKey === "classificationResultDraft" && ["block", "supplier", "classifier", "variety"].includes(field)) {
      syncClassificationResultDraft(store, draft, field);
    }
    saveDb();
  }

  function setUiValue(appState, field, value) {
    const store = ensureStore(appState);
    store.ui[field] = value;
    saveDb();
  }

  function calculateMeshTotal(draft) {
    return (utils.parseNumber(draft.meshCount) * 25) + utils.parseNumber(draft.extraStems);
  }

  function getDemoUser(appState) {
    return appState.db.session?.activeUser?.name || "Usuario demo";
  }

  function nowLabel() {
    const now = new Date();
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localNow.toISOString().replace("T", " ").slice(0, 16);
  }

  function nowExactLabel() {
    const now = new Date();
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localNow.toISOString().replace("T", " ").slice(0, 19);
  }

  function receptionProgressFromStore(store, reception) {
    const activeAssignments = (store.classifierAssignments || []).filter(item => item.status !== "ANULADO");
    const lines = (reception?.items || []).map(item => {
      const classifiedStems = activeAssignments
        .filter(assignment => (
          assignment.receptionItemId === item.id
          && (!assignment.receptionId || assignment.receptionId === reception.id)
        ))
        .reduce((sum, assignment) => sum + utils.parseNumber(assignment.totalStems), 0);
      const totalStems = utils.parseNumber(item.totalStems, utils.calculateReceptionTotal(item));
      return {
        ...item,
        totalStems,
        classifiedStems,
        pendingStems: Math.max(totalStems - classifiedStems, 0),
        classificationComplete: totalStems > 0 && classifiedStems >= totalStems
      };
    });
    const totalStems = lines.reduce((sum, item) => sum + item.totalStems, 0);
    const classifiedStems = lines.reduce((sum, item) => sum + item.classifiedStems, 0);
    const pendingStems = Math.max(totalStems - classifiedStems, 0);
    const status = totalStems > 0 && pendingStems === 0
      ? "COMPLETADO_CLASIFICACION"
      : classifiedStems > 0
        ? "PARCIAL_CLASIFICACION"
        : "PENDIENTE_CLASIFICACION";
    return { totalStems, classifiedStems, pendingStems, status, lines };
  }

  function getReceptionClassificationProgress(appState, receptionId) {
    const store = ensureStore(appState);
    const reception = store.receptions.find(item => item.id === receptionId);
    return reception ? receptionProgressFromStore(store, reception) : null;
  }

  function receptionQueueFromStore(store) {
    return store.receptions.map(reception => ({
      ...reception,
      classificationProgress: receptionProgressFromStore(store, reception)
    })).sort((left, right) => {
      const leftCompleted = left.classificationProgress.status === "COMPLETADO_CLASIFICACION" ? 1 : 0;
      const rightCompleted = right.classificationProgress.status === "COMPLETADO_CLASIFICACION" ? 1 : 0;
      if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
      return `${left.date || ""} ${left.createdAt || ""} ${left.id}`.localeCompare(`${right.date || ""} ${right.createdAt || ""} ${right.id}`);
    });
  }

  function getReceptionQueue(appState) {
    return receptionQueueFromStore(ensureStore(appState));
  }

  function upsertPerformanceRecord(store, payload) {
    const keyDate = payload.date || today();
    const employeeId = String(payload.employee_id || payload.employeeId || "").trim();
    const operationalWorkerId = String(payload.operational_worker_id || payload.operationalWorkerId || employeeId).trim();
    const worker = String(payload.worker || "").trim() || "Sin responsable";
    const activity = String(payload.activity || "").trim() || "OTRO";
    const variety = String(payload.variety || "").trim() || "SIN VARIEDAD";
    let entry = (store.performances || []).find(item => (
      item.date === keyDate &&
      (
        operationalWorkerId
          ? String(item.operational_worker_id || item.operationalWorkerId || employeeIdOf(item)) === operationalWorkerId
          : (!employeeIdOf(item) && String(item.worker || "").trim() === worker)
      ) &&
      String(item.activity || "").trim() === activity &&
      String(item.variety || "").trim() === variety &&
      String(item.workdayId || "") === String(payload.workdayId || "")
    ));

    if (!entry) {
      entry = {
        id: uid("REN-OPS"),
        date: keyDate,
        employee_id: employeeId,
        employeeId,
        operational_worker_id: operationalWorkerId,
        operationalWorkerId,
        worker,
        activity,
        variety,
        bunches: 0,
        stems: 0,
        performancePerHour: 0,
        workdayId: payload.workdayId || "",
        observation: payload.observation || "Registro operativo demo."
      };
      store.performances.unshift(entry);
    }

    if (employeeId) {
      const role = activity === "CLASIFICACION" ? "classifier" : "buncher";
      setEmployeeId(entry, employeeId, { role, source: payload.employeeLinkSource || "CATALOG_ID" });
    }
    if (operationalWorkerId) {
      entry.operational_worker_id = operationalWorkerId;
      entry.operationalWorkerId = operationalWorkerId;
    }
    entry.bunches = utils.parseNumber(entry.bunches) + utils.parseNumber(payload.bunches);
    entry.stems = utils.parseNumber(entry.stems) + utils.parseNumber(payload.stems);
    entry.performancePerHour = activity === "CLASIFICACION"
      ? Math.max(1, Math.round(entry.stems / 25 / 8))
      : Math.max(1, Math.round(entry.bunches / 8));
    if (payload.observation) {
      entry.observation = payload.observation;
    }
    return entry;
  }

  function getYieldRegistrationGate(appState, currentStore = null) {
    const store = currentStore || ensureStore(appState);
    const workday = store.yieldWorkday || data.createYieldWorkday();
    const allowed = workdayCore.canRegister(workday);
    let message = "";
    if (!allowed) {
      message = workday.status === "PAUSADA"
        ? "La jornada laboral esta pausada. Reanudela antes de registrar rendimientos."
        : "Debe iniciar una jornada laboral antes de registrar rendimientos.";
    }
    return { allowed, workday, message };
  }

  function syncYieldWorkday(appState, workday) {
    const syncService = BlessERP.operationsWorkdayCloudSync;
    workday.syncState = syncService?.isEnabled?.() ? "PENDIENTE" : "LOCAL";
    if (!syncService?.isEnabled?.()) return;
    syncService.sync(clone(workday)).then(result => {
      const store = ensureStore(appState);
      if (store.yieldWorkday?.id !== workday.id) return;
      store.yieldWorkday.syncState = result.ok ? "SINCRONIZADA" : "PENDIENTE";
      store.yieldWorkday.cloudId = result.cloudId || store.yieldWorkday.cloudId || "";
      store.yieldWorkday.syncError = result.ok ? "" : result.error;
      const history = store.yieldWorkdayHistory.find(item => item.id === workday.id);
      if (history) Object.assign(history, {
        syncState: store.yieldWorkday.syncState,
        cloudId: store.yieldWorkday.cloudId,
        syncError: store.yieldWorkday.syncError
      });
      saveDb();
    });
  }

  function getYieldWorkdaySummary(appState) {
    const store = ensureStore(appState);
    return workdayCore.buildSummary(
      store.yieldWorkday,
      store.meshProcessingRecords || [],
      store.bunchEntries || []
    );
  }

  function updateYieldWorkday(appState, requestedAction) {
    const store = ensureStore(appState);
    const current = store.yieldWorkday || data.createYieldWorkday();
    const actionMap = {
      EN_CURSO_DEMO: "START",
      PAUSADA_DEMO: "PAUSE",
      REANUDADA_DEMO: "RESUME",
      CERRADA_DEMO: "FINISH"
    };
    const action = actionMap[requestedAction] || String(requestedAction || "").toUpperCase();
    const timestamp = nowExactLabel();
    const user = appState.db.session?.activeUser || {};
    let workday = current;

    if (action === "START") {
      if (["ACTIVA", "PAUSADA"].includes(current.status)) {
        const message = "Ya existe una jornada laboral abierta.";
        setNotice(appState, message, "warning");
        return { ok: false, workday: current, message };
      }
      workday = data.createYieldWorkday({
        id: uid("JOR-OPS"),
        date: timestamp.slice(0, 10),
        status: "ACTIVA",
        startedAt: timestamp,
      startedBy: user.name || "Usuario JAEDER SYSTEMS",
        startedByUserId: user.id || "",
        observation: "Jornada laboral activa."
      });
    } else if (action === "PAUSE") {
      if (current.status !== "ACTIVA") {
        const message = "Solo una jornada activa puede pausarse.";
        setNotice(appState, message, "warning");
        return { ok: false, workday: current, message };
      }
      current.status = "PAUSADA";
      current.pausedAt = timestamp;
      current.pauses.push({ pausedAt: timestamp, resumedAt: "", durationMs: 0 });
      current.observation = "Jornada laboral pausada; el registro de rendimientos esta detenido.";
    } else if (action === "RESUME") {
      if (current.status !== "PAUSADA") {
        const message = "Solo una jornada pausada puede reanudarse.";
        setNotice(appState, message, "warning");
        return { ok: false, workday: current, message };
      }
      const pause = current.pauses.at(-1);
      if (pause && !pause.resumedAt) {
        pause.resumedAt = timestamp;
        pause.durationMs = workdayCore.totalPausedMs({ pauses: [pause] }, workdayCore.parseDateTime(timestamp));
      }
      current.status = "ACTIVA";
      current.resumedAt = timestamp;
      current.totalPausedMs = workdayCore.totalPausedMs(current, workdayCore.parseDateTime(timestamp));
      current.observation = "Jornada laboral reanudada."
    } else if (action === "FINISH") {
      if (!["ACTIVA", "PAUSADA"].includes(current.status)) {
        const message = "No existe una jornada abierta para finalizar.";
        setNotice(appState, message, "warning");
        return { ok: false, workday: current, message };
      }
      if (current.status === "PAUSADA") {
        const pause = current.pauses.at(-1);
        if (pause && !pause.resumedAt) {
          pause.resumedAt = timestamp;
          pause.durationMs = workdayCore.totalPausedMs({ pauses: [pause] }, workdayCore.parseDateTime(timestamp));
        }
      }
      current.status = "FINALIZADA";
      current.endedAt = timestamp;
      current.closedBy = user.name || "Usuario JAEDER SYSTEMS";
      current.closedByUserId = user.id || "";
      current.totalPausedMs = workdayCore.totalPausedMs(current, workdayCore.parseDateTime(timestamp));
      current.summary = workdayCore.buildSummary(
        current,
        store.meshProcessingRecords || [],
        store.bunchEntries || [],
        workdayCore.parseDateTime(timestamp)
      );
      current.observation = "Jornada finalizada y resumen de rendimientos guardado.";
      const historyIndex = store.yieldWorkdayHistory.findIndex(item => item.id === current.id);
      if (historyIndex >= 0) store.yieldWorkdayHistory[historyIndex] = clone(current);
      else store.yieldWorkdayHistory.unshift(clone(current));
    } else {
      const message = "Accion de jornada no reconocida.";
      setNotice(appState, message, "warning");
      return { ok: false, workday: current, message };
    }

    store.yieldWorkday = workday;
    setNotice(appState, `Jornada laboral actualizada: ${workday.status}.`, workday.status === "FINALIZADA" ? "success" : "info", false);
    saveDb();
    syncYieldWorkday(appState, workday);
    return { ok: true, workday, message: workday.observation };
  }

  function nextBunchLabelCode(store, additionalReservedCodes = null) {
    const synchronized = synchronizeBunchLabelSequence(store);
    const reservedCodes = new Set([
      ...synchronized.usedCodes,
      ...(additionalReservedCodes || [])
    ]);
    let sequence = synchronized.nextSequence;
    let code = String(sequence).padStart(10, "0");
    while (reservedCodes.has(code) && sequence < 9999999999) {
      sequence += 1;
      code = String(sequence).padStart(10, "0");
    }
    if (sequence > 9999999999 || reservedCodes.has(code)) {
      throw new Error("El secuencial de etiquetas Zebra agoto los 10 digitos disponibles.");
    }
    store.sequences.bunchLabel = sequence + 1;
    persistZebraSequence(store.sequences.bunchLabel);
    return code;
  }

  function resetParameterDraft(appState, type = "") {
    const store = ensureStore(appState);
    store.ui.parameterDraft = data.createParameterDraft({ type: type || store.ui.parameterType || "suppliers" });
    saveDb();
  }

  function editParameter(appState, type, id) {
    const store = ensureStore(appState);
    const entry = (store.masterData?.[type] || []).find(item => item.id === id);
    if (!entry) return false;
    store.ui.parameterType = type;
    store.ui.parameterDraft = data.createParameterDraft({ ...entry, type });
    saveDb();
    return true;
  }

  function saveParameter(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.parameterDraft || {});
    const type = draft.type || store.ui.parameterType;
    const name = String(draft.name || "").trim();
    if (!type || !Array.isArray(store.masterData?.[type])) {
      setNotice(appState, "Seleccione un tipo de parametro valido.", "warning");
      return { ok: false };
    }
    if (!name) {
      setNotice(appState, type === "suppliers" ? "Ingrese el nombre del proveedor." : "Ingrese el nombre o valor del parametro.", "warning");
      return { ok: false };
    }
    const duplicate = store.masterData[type].find(item => item.id !== draft.id && String(item.name).trim().toUpperCase() === name.toUpperCase());
    if (duplicate) {
      setNotice(appState, "Ya existe un parametro con el mismo nombre.", "warning");
      return { ok: false };
    }
    if (type === "suppliers" && !String(draft.assignedBlock || "").trim()) {
      setNotice(appState, "Asigne un numero de bloque al proveedor.", "warning");
      return { ok: false };
    }
    if (type === "suppliers") {
      const normalizedBlock = String(draft.assignedBlock || "").trim().toUpperCase();
      const duplicateBlock = store.masterData.suppliers.find(item => item.id !== draft.id && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock);
      if (duplicateBlock) {
        setNotice(appState, `El bloque ${draft.assignedBlock} ya pertenece a ${duplicateBlock.name}.`, "warning");
        return { ok: false };
      }
    }
    let entry = store.masterData[type].find(item => item.id === draft.id);
    if (entry) {
      const operationalWorkerId = PERSON_CATALOG_TYPES.has(type)
        ? String(entry.operational_worker_id || entry.operationalWorkerId || employeeIdOf(entry) || entry.id).trim()
        : "";
      Object.assign(entry, {
        code: draft.code || entry.code,
        name,
        employee_id: operationalWorkerId,
        employeeId: operationalWorkerId,
        operational_worker_id: operationalWorkerId,
        operationalWorkerId,
        employeeLinkSource: operationalWorkerId ? (entry.employeeLinkSource || "OPERATIONAL_CATALOG_ID") : "",
        assignedBlock: type === "suppliers" ? String(draft.assignedBlock || "").trim() : "",
        labelColor: type === "bunchers" ? String(draft.labelColor || "").trim().toUpperCase() : "",
        active: draft.active !== false,
        observation: draft.observation || ""
      });
    } else {
      const parameterId = uid(`PAR-${type.slice(0, 3).toUpperCase()}`);
      const operationalWorkerId = PERSON_CATALOG_TYPES.has(type) ? parameterId : "";
      entry = {
        id: parameterId,
        code: String(draft.code || `${type.slice(0, 3).toUpperCase()}-${store.masterData[type].length + 1}`).trim().toUpperCase(),
        name,
        employee_id: operationalWorkerId,
        employeeId: operationalWorkerId,
        operational_worker_id: operationalWorkerId,
        operationalWorkerId,
        employeeLinkSource: operationalWorkerId ? "OPERATIONAL_CATALOG_ID" : "",
        assignedBlock: type === "suppliers" ? String(draft.assignedBlock || "").trim() : "",
        labelColor: type === "bunchers" ? String(draft.labelColor || "").trim().toUpperCase() : "",
        active: true,
        observation: draft.observation || ""
      };
      store.masterData[type].push(entry);
    }
    syncCatalogsFromMasterData(store);
    BlessERP.performance?.invalidateCache?.("ops-catalogs:");
    store.ui.parameterType = type;
    store.ui.parameterDraft = data.createParameterDraft({ type });
    setNotice(appState, `Parametro guardado: ${entry.name}.`, "success", false);
    const persisted = saveDb();
    const noticeStore = ensureStore(appState);
    if (!persisted) {
      noticeStore.ui.parameterSyncPending = true;
      setNotice(appState, `Parametro guardado: ${entry.name}. La sincronizacion general queda pendiente y se reintentara sin duplicar el registro.`, "info", false);
    } else {
      noticeStore.ui.parameterSyncPending = false;
    }
    return { ok: true, persisted, entry };
  }

  function toggleParameter(appState, type, id) {
    const store = ensureStore(appState);
    const entry = (store.masterData?.[type] || []).find(item => item.id === id);
    if (!entry) return false;
    entry.active = !entry.active;
    syncCatalogsFromMasterData(store);
    BlessERP.performance?.invalidateCache?.("ops-catalogs:");
    setNotice(appState, `${entry.name}: ${entry.active ? "ACTIVO" : "INACTIVO"}.`, "info");
    saveDb();
    return true;
  }

  function deleteParameter(appState, type, id) {
    const store = ensureStore(appState);
    const list = store.masterData?.[type] || [];
    const entry = list.find(item => item.id === id);
    if (!entry) return false;
    const used = [...(store.receptions || []), ...(store.labelBatches || []), ...(store.classifierAssignments || [])]
      .some(row => Object.values(row).some(value => String(value) === String(entry.name)));
    if (used) {
      entry.active = false;
      syncCatalogsFromMasterData(store);
      BlessERP.performance?.invalidateCache?.("ops-catalogs:");
      setNotice(appState, "El parametro tiene historial y fue desactivado, no eliminado.", "warning");
      saveDb();
      return true;
    }
    store.masterData[type] = list.filter(item => item.id !== id);
    syncCatalogsFromMasterData(store);
    BlessERP.performance?.invalidateCache?.("ops-catalogs:");
    setNotice(appState, `Parametro eliminado: ${entry.name}.`, "info");
    saveDb();
    return true;
  }

  function resetReceptionDraft(appState) {
    const store = ensureStore(appState);
    store.ui.receptionDraft = data.createReceptionDraft();
    store.ui.receptionItemDraft = data.createReceptionItemDraft();
    saveDb();
  }

  function resetReceptionItemDraft(appState) {
    const store = ensureStore(appState);
    store.ui.receptionItemDraft = data.createReceptionItemDraft();
    saveDb();
  }

  function addOrUpdateReceptionItem(appState) {
    const store = ensureStore(appState);
    const itemDraft = clone(store.ui.receptionItemDraft || {});
    if (!itemDraft.variety || !itemDraft.stemType || utils.parseNumber(itemDraft.meshCount) <= 0 || utils.parseNumber(itemDraft.stemsPerMesh) <= 0) {
      setNotice(appState, "Complete variedad, tipo de tallo, mallas y tallos por malla para agregar el item.", "warning");
      return null;
    }

    const item = {
      id: itemDraft.id || uid("REC-ITEM"),
      variety: itemDraft.variety,
      stemType: itemDraft.stemType,
      meshCount: utils.parseNumber(itemDraft.meshCount),
      stemsPerMesh: utils.parseNumber(itemDraft.stemsPerMesh),
      extraStems: utils.parseNumber(itemDraft.extraStems),
      totalStems: utils.calculateReceptionTotal(itemDraft)
    };
    const existingIndex = store.ui.receptionDraft.items.findIndex(row => row.id === item.id);
    if (existingIndex >= 0) store.ui.receptionDraft.items[existingIndex] = item;
    else store.ui.receptionDraft.items.push(item);
    store.ui.receptionDraft.totalDeclared = store.ui.receptionDraft.items.reduce((sum, row) => sum + utils.parseNumber(row.totalStems), 0);
    store.ui.receptionItemDraft = data.createReceptionItemDraft({
      stemType: item.stemType,
      stemsPerMesh: item.stemsPerMesh
    });
    setNotice(appState, `${existingIndex >= 0 ? "Item actualizado" : "Item agregado"}: ${item.variety}, ${item.totalStems} tallos.`, "success");
    saveDb();
    return item;
  }

  function editReceptionItem(appState, itemId) {
    const store = ensureStore(appState);
    const item = (store.ui.receptionDraft.items || []).find(row => row.id === itemId);
    if (!item) return false;
    store.ui.receptionItemDraft = data.createReceptionItemDraft(clone(item));
    setNotice(appState, `Editando item ${item.variety}.`, "info");
    saveDb();
    return true;
  }

  function removeReceptionItem(appState, itemId) {
    const store = ensureStore(appState);
    const usedInClassification = (store.classifierAssignments || []).some(row => row.receptionItemId === itemId);
    if (usedInClassification) {
      setNotice(appState, "No se puede eliminar el item porque ya fue utilizado en Clasificacion. Puede editar sus datos para corregirlos.", "warning");
      return false;
    }
    const previousLength = store.ui.receptionDraft.items.length;
    store.ui.receptionDraft.items = store.ui.receptionDraft.items.filter(row => row.id !== itemId);
    if (previousLength === store.ui.receptionDraft.items.length) return false;
    store.ui.receptionDraft.totalDeclared = store.ui.receptionDraft.items.reduce((sum, row) => sum + utils.parseNumber(row.totalStems), 0);
    if (store.ui.receptionItemDraft.id === itemId) store.ui.receptionItemDraft = data.createReceptionItemDraft();
    setNotice(appState, "Item retirado del borrador de recepcion.", "info");
    saveDb();
    return true;
  }

  function editReception(appState, receptionId) {
    const store = ensureStore(appState);
    const reception = store.receptions.find(item => item.id === receptionId);
    if (!reception) return false;
    store.ui.receptionDraft = data.createReceptionDraft({
      ...clone(reception),
      id: reception.id,
      items: clone(reception.items || [])
    });
    store.ui.receptionItemDraft = data.createReceptionItemDraft();
    setNotice(appState, `Editando recepcion ${reception.id}. El estado ${reception.status} se conservara.`, "info");
    saveDb();
    return true;
  }

  function synchronizeReceptionCorrection(store, reception) {
    const receptionItems = new Map((reception.items || []).map(item => [item.id, item]));
    (store.classifierAssignments || []).forEach(assignment => {
      if (assignment.receptionId !== reception.id) return;
      const receptionItem = receptionItems.get(assignment.receptionItemId);
      assignment.supplier = reception.supplier;
      assignment.block = reception.block;
      if (receptionItem) {
        assignment.variety = receptionItem.variety;
        assignment.stemType = receptionItem.stemType;
      }
      assignment.updatedAt = nowExactLabel();

      (store.meshProcessingRecords || []).filter(item => item.assignmentId === assignment.id).forEach(item => {
        item.supplier = assignment.supplier;
        item.block = assignment.block;
        item.variety = assignment.variety;
        item.updatedAt = assignment.updatedAt;
      });
      (store.processedMeshHistory || []).filter(item => item.assignmentId === assignment.id).forEach(item => {
        item.supplier = assignment.supplier;
        item.block = assignment.block;
        item.variety = assignment.variety;
        item.updatedAt = assignment.updatedAt;
      });
    });
  }

  function registerReceptionLegacy(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.receptionDraft);
    const existing = draft.id ? store.receptions.find(item => item.id === draft.id) : null;
    const previousReception = existing ? clone(existing) : null;
    const items = (draft.items || []).map(item => ({
      ...item,
      id: existing ? (item.id || uid("REC-ITEM")) : uid("REC-ITEM"),
      totalStems: utils.calculateReceptionTotal(item)
    }));
    if (!draft.supplier || !draft.block || !draft.receptionist || !items.length) {
      setNotice(appState, "Complete proveedor con bloque, recepcionista y agregue al menos una variedad a la recepcion.", "warning");
      return null;
    }
    const assignedTotals = new Map();
    (store.classifierAssignments || []).filter(item => item.status !== "ANULADO").forEach(assignment => {
      assignedTotals.set(assignment.receptionItemId, (assignedTotals.get(assignment.receptionItemId) || 0) + utils.parseNumber(assignment.totalStems));
    });
    const itemBelowClassified = items.find(item => utils.parseNumber(item.totalStems) < (assignedTotals.get(item.id) || 0));
    if (itemBelowClassified) {
      setNotice(appState, `No puede reducir ${itemBelowClassified.variety} por debajo de ${(assignedTotals.get(itemBelowClassified.id) || 0)} tallos ya enviados a Clasificacion.`, "warning");
      return null;
    }
    const totalDeclared = items.reduce((sum, item) => sum + utils.parseNumber(item.totalStems), 0);
    const first = items[0];
    const receptionistLink = resolveCatalogEmployee(store, "receptionists", {
      name: draft.receptionist,
      employeeId: draft.receptionist_employee_id || draft.receptionistEmployeeId || draft.employee_id || draft.employeeId
    });
    const entry = existing || { id: draft.id || uuid(), status: "RECIBIDO" };
    const canonicalProvider = BlessERP.services?.supplierFinanceV2?.resolveReceptionProvider?.(draft);
    Object.assign(entry, {
      ...draft,
      id: entry.id,
      date: existing?.date || today(),
      createdAt: existing?.createdAt || nowExactLabel(),
      items,
      responsible: draft.receptionist,
      variety: first.variety,
      stemType: first.stemType,
      meshCount: items.reduce((sum, item) => sum + utils.parseNumber(item.meshCount), 0),
      stemsPerMesh: first.stemsPerMesh,
      extraStems: items.reduce((sum, item) => sum + utils.parseNumber(item.extraStems), 0),
      totalDeclared,
      providerId: canonicalProvider?.id || canonicalProvider?.providerId || draft.providerId || existing?.providerId || "",
      status: existing?.status || "RECIBIDO",
      updatedAt: nowExactLabel()
    });
    if (receptionistLink.employeeId) {
      setEmployeeId(entry, receptionistLink.employeeId, { role: "receptionist", source: "CATALOG_ID" });
      entry.responsible_employee_id = receptionistLink.employeeId;
      entry.responsibleEmployeeId = receptionistLink.employeeId;
    }
    if (!existing) store.receptions.unshift(entry);
    if (existing) {
      synchronizeReceptionCorrection(store, entry);
      store.receptionEditAudit.unshift({
        id: uid("AUD-REC"),
        receptionId: entry.id,
        dateTime: nowExactLabel(),
        user: getDemoUser(appState),
        action: "EDICION_RECEPCION",
        before: previousReception,
        after: clone(entry)
      });
    }
    if (existing && entry.status !== "OBSERVADO") {
      const progress = receptionProgressFromStore(store, entry);
      entry.status = progress.pendingStems === 0
        ? "CERRADO"
        : progress.classifiedStems > 0
          ? "EN_CLASIFICACION"
          : "RECIBIDO";
    }
    store.ui.receptionDraft = data.createReceptionDraft({
      supplier: draft.supplier,
      block: draft.block,
      receptionist: draft.receptionist,
      responsible: draft.receptionist
    });
    store.ui.receptionItemDraft = data.createReceptionItemDraft();
    store.ui.receptionHistoryMode = "DIA";
    store.ui.receptionHistoryDate = entry.date;
    store.ui.receptionHistoryMonth = String(entry.date || "").slice(0, 7);
    setNotice(appState, `Recepcion ${existing ? "actualizada" : "registrada"}: ${items.length} variedad(es), ${totalDeclared} tallos.`, "success");
    saveDb();
    return attachDurableSync({ ...entry, wasUpdated: Boolean(existing) });
  }

  function classificationAssignmentQuantitySeed() {
    return { meshCount: "", extraStems: "" };
  }

  function beginClassificationAssignmentSearch(appState) {
    const store = ensureStore(appState);
    const draft = store.ui.classificationAssignmentDraft;
    draft.receptionId = "";
    draft.receptionItemId = "";
    draft.supplier = "";
    draft.block = "";
    draft.variety = "";
    draft.meshCount = "";
    draft.extraStems = "";
    store.ui.classificationAssignmentSelectionConfirmed = false;
    return draft;
  }

  function resetClassificationAssignmentDraft(appState, options = {}) {
    const store = ensureStore(appState);
    const preferredPending = options.preservePending === true
      ? receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
          .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
          .map(item => ({ ...item, receptionId: reception.id, supplier: reception.supplier, block: reception.block })))
        .find(item => (
          String(item.block || "").trim().toUpperCase() === String(options.block || "").trim().toUpperCase()
          && String(item.supplier || "").trim().toUpperCase() === String(options.supplier || "").trim().toUpperCase()
          && String(item.variety || "").trim().toUpperCase() === String(options.variety || "").trim().toUpperCase()
        ))
      : null;
    store.ui.classificationAssignmentDraft = data.createClassificationAssignmentDraft({
      receptionId: preferredPending?.receptionId || "",
      receptionItemId: preferredPending?.id || "",
      supplier: preferredPending?.supplier || "",
      block: preferredPending?.block || "",
      variety: preferredPending?.variety || "",
      classifier: options.classifier || store.catalogs.classifiers[0] || "",
      ...(preferredPending ? classificationAssignmentQuantitySeed(preferredPending) : { meshCount: "", extraStems: "" })
    });
    store.ui.classificationAssignmentSelectionConfirmed = Boolean(preferredPending);
    saveDb();
  }

  function normalizedOperationalValue(value) {
    return String(value || "").trim().toUpperCase();
  }

  function compatibleClassifierPendingEntries(pendingEntries, selectedPending) {
    if (!selectedPending) return [];
    const reference = selectedPending.item;
    const referenceReception = selectedPending.reception;
    return pendingEntries.filter(entry => (
      normalizedOperationalValue(entry.reception.block) === normalizedOperationalValue(referenceReception.block)
      && normalizedOperationalValue(entry.reception.supplier) === normalizedOperationalValue(referenceReception.supplier)
      && normalizedOperationalValue(entry.item.variety) === normalizedOperationalValue(reference.variety)
      && normalizedOperationalValue(entry.item.stemType || "LARGO") === normalizedOperationalValue(reference.stemType || "LARGO")
      && utils.parseNumber(entry.item.stemsPerMesh) === utils.parseNumber(reference.stemsPerMesh)
    ));
  }

  function allocateClassifierDelivery(pendingEntries, totalStems) {
    let remainingStems = utils.parseNumber(totalStems);
    const allocations = [];
    pendingEntries.forEach(entry => {
      if (remainingStems <= 0) return;
      const pendingStems = utils.parseNumber(entry.item.pendingStems);
      const allocatedStems = Math.min(remainingStems, pendingStems);
      if (allocatedStems <= 0) return;
      const stemsPerMesh = utils.parseNumber(entry.item.stemsPerMesh);
      const meshCount = stemsPerMesh > 0 ? Math.floor(allocatedStems / stemsPerMesh) : 0;
      allocations.push({
        ...entry,
        allocatedStems,
        meshCount,
        extraStems: allocatedStems - (meshCount * stemsPerMesh)
      });
      remainingStems -= allocatedStems;
    });
    return { allocations, remainingStems };
  }

  function registerClassifierAssignmentLegacy(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.classificationAssignmentDraft);
    const pendingEntries = receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
      .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
      .map(item => ({ reception, item })));
    const selectedPending = draft.receptionId || draft.receptionItemId
      ? pendingEntries.find(entry => (
          (!draft.receptionId || entry.reception.id === draft.receptionId)
          && (!draft.receptionItemId || entry.item.id === draft.receptionItemId)
        ))
      : pendingEntries.find(entry => entry.reception.block === draft.block && entry.item.variety === draft.variety);
    const referenceReception = (store.receptions || []).find(item => item.id === selectedPending?.reception?.id);
    const referenceReceptionItem = (referenceReception?.items || []).find(item => item.id === selectedPending?.item?.id);
    if (!referenceReception || !referenceReceptionItem || !draft.classifier) {
      setNotice(appState, "Seleccione bloque, variedad y clasificador. Debe existir saldo pendiente en Recepcion.", "warning");
      return null;
    }
    const meshCount = utils.parseNumber(draft.meshCount);
    const extraStems = utils.parseNumber(draft.extraStems);
    if (meshCount < 0 || extraStems < 0) {
      setNotice(appState, "Las mallas y los tallos extras no pueden ser negativos.", "warning");
      return null;
    }
    const totalStems = utils.calculateReceptionTotal({
      meshCount,
      stemsPerMesh: referenceReceptionItem.stemsPerMesh,
      extraStems
    });
    if (totalStems <= 0) {
      setNotice(appState, "Ingrese al menos una malla o una cantidad de tallos extras mayor a cero.", "warning");
      return null;
    }
    const gate = getYieldRegistrationGate(appState, store);
    if (!gate.allowed) {
      setNotice(appState, gate.message, "warning");
      return null;
    }
    const compatiblePendingEntries = compatibleClassifierPendingEntries(pendingEntries, selectedPending);
    const availableStems = compatiblePendingEntries.reduce((sum, entry) => sum + utils.parseNumber(entry.item.pendingStems), 0);
    const allocation = allocateClassifierDelivery(compatiblePendingEntries, totalStems);
    if (allocation.remainingStems > 0) {
      const stemsPerMesh = utils.parseNumber(referenceReceptionItem.stemsPerMesh);
      const availableMeshes = stemsPerMesh > 0 ? Math.floor(availableStems / stemsPerMesh) : 0;
      const availableExtraStems = stemsPerMesh > 0 ? availableStems % stemsPerMesh : availableStems;
      setNotice(
        appState,
        `La entrega supera el saldo acumulado de ${availableMeshes} mallas y ${availableExtraStems} tallos extras (${availableStems} tallos) para ${referenceReceptionItem.variety}.`,
        "warning"
      );
      return null;
    }
    const classifierLink = resolveCatalogEmployee(store, "classifiers", {
      name: draft.classifier,
      employeeId: draft.classifier_employee_id || draft.classifierEmployeeId || draft.employee_id || draft.employeeId
    });
    const deliveryGroupId = uuid();
    const deliveryDateTime = nowLabel();
    const deliveryReceptionIds = [...new Set(allocation.allocations.map(item => item.reception.id))];
    const entries = allocation.allocations.map((part, index) => {
      const reception = (store.receptions || []).find(item => item.id === part.reception.id);
      const receptionItem = (reception?.items || []).find(item => item.id === part.item.id);
      const entry = {
        id: uuid(),
        receptionId: reception.id,
        receptionItemId: receptionItem.id,
        deliveryGroupId,
        deliveryPartIndex: index + 1,
        deliveryPartCount: allocation.allocations.length,
        deliveryReceptionCount: deliveryReceptionIds.length,
        deliveryRequestedMeshes: meshCount,
        deliveryRequestedExtraStems: extraStems,
        deliveryTotalStems: totalStems,
        dateTime: deliveryDateTime,
        classifier: draft.classifier,
        supplier: reception.supplier,
        block: reception.block,
        variety: receptionItem.variety,
        stemType: receptionItem.stemType || "LARGO",
        meshCount: part.meshCount,
        stemsPerMesh: utils.parseNumber(receptionItem.stemsPerMesh),
        extraStems: part.extraStems,
        totalStems: part.allocatedStems,
        nationalStems: 0,
        exportableStems: part.allocatedStems,
        status: "ENTREGADO",
        observation: draft.observation || "Flor entregada al clasificador."
      };
      if (classifierLink.employeeId) setEmployeeId(entry, classifierLink.employeeId, { role: "classifier", source: "CATALOG_ID" });
      reception.status = "EN_CLASIFICACION";
      const meshEntry = {
        id: uuid(),
        date: today(),
        supplier: entry.supplier,
        block: entry.block,
        variety: entry.variety,
        classifier: entry.classifier,
        responsible: getDemoUser(appState),
        meshCount: entry.meshCount,
        stemsPerMesh: entry.stemsPerMesh,
        extraStems: entry.extraStems,
        totalStems: entry.totalStems,
        workdayId: gate.workday.id,
        status: "ENTREGADA_CLASIFICACION",
        observation: entry.observation,
        registeredAt: entry.dateTime,
        assignmentId: entry.id,
        deliveryGroupId,
        sourceType: "CLASIFICACION_ENTREGA",
        inventoryScope: "HISTORIAL_OPERATIVO_MALLAS",
        accountingImpact: false
      };
      if (classifierLink.employeeId) setEmployeeId(meshEntry, classifierLink.employeeId, { role: "classifier", source: "CATALOG_ID" });
      store.meshProcessingRecords.unshift(meshEntry);
      const archivedMesh = archiveProcessedMesh(appState, meshEntry, { state: "PROCESADA" });
      entry.meshProcessingId = meshEntry.id;
      entry.processedMeshHistoryId = archivedMesh.history?.id || archivedMesh.duplicate?.id || "";
      meshEntry.processedMeshHistoryId = entry.processedMeshHistoryId;
      upsertPerformanceRecord(store, {
        date: meshEntry.date,
        employeeId: classifierLink.employeeId,
        operationalWorkerId: classifierLink.operationalWorkerId,
        worker: meshEntry.classifier,
        activity: "CLASIFICACION",
        variety: meshEntry.variety,
        bunches: Math.round(meshEntry.totalStems / 25),
        stems: meshEntry.totalStems,
        workdayId: meshEntry.workdayId,
        observation: "Actualizado desde la entrega consolidada de mallas a clasificacion."
      });
      return entry;
    });
    store.classifierAssignments.unshift(...entries);
    deliveryReceptionIds.forEach(receptionId => {
      const reception = (store.receptions || []).find(item => item.id === receptionId);
      if (reception && receptionProgressFromStore(store, reception).pendingStems === 0) reception.status = "CERRADO";
    });
    const entry = entries[0];
    store.ui.classificationResultDraft = data.createClassificationResultDraft({
      assignmentId: entry.id,
      supplier: entry.supplier,
      block: entry.block,
      classifier: entry.classifier,
      classifierEmployeeId: classifierLink.employeeId,
      variety: entry.variety
    });
    resetClassificationAssignmentDraft(appState, {
      preservePending: true,
      supplier: entry.supplier,
      block: entry.block,
      variety: entry.variety,
      classifier: entry.classifier
    });
    setNotice(
      appState,
      `Flor entregada a ${entry.classifier}: ${meshCount} mallas / ${totalStems} tallos, aplicada a ${deliveryReceptionIds.length} recepcion(es) por orden de llegada. Historial y rendimiento actualizados.`,
      "success"
    );
    saveDb();
    return attachDurableSync({
      ...entry,
      meshCount,
      extraStems,
      totalStems,
      receptionCount: deliveryReceptionIds.length,
      receptionIds: deliveryReceptionIds,
      entries
    });
  }

  function resetClassificationResultDraft(appState) {
    const store = ensureStore(appState);
    const assignment = classificationResultAssignments(store)[0];
    store.ui.classificationResultDraft = data.createClassificationResultDraft({
      assignmentId: assignment?.id || "",
      supplier: assignment?.supplier || "",
      block: assignment?.block || "",
      classifier: assignment?.classifier || "",
      variety: assignment?.variety || ""
    });
    saveDb();
  }

  function classificationNationalCauses(source = {}) {
    return {
      oidio: utils.parseNumber(source.nationalOidioStems),
      velloso: utils.parseNumber(source.nationalVellosoStems),
      botrytis: utils.parseNumber(source.nationalBotrytisStems),
      maltrato: utils.parseNumber(source.nationalMaltratoStems)
    };
  }

  function classificationNationalCauseTotal(causes = {}) {
    return Object.values(causes).reduce((sum, value) => sum + utils.parseNumber(value), 0);
  }

  function registerClassificationResultLegacy(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.classificationResultDraft);
    const assignment = findClassificationResultAssignment(store, draft);
    const generalNationalStems = utils.parseNumber(draft.nationalStems);
    const nationalCauses = classificationNationalCauses(draft);
    const causeValues = Object.values(nationalCauses);
    const detailedNationalStems = classificationNationalCauseTotal(nationalCauses);
    if (generalNationalStems < 0 || causeValues.some(value => value < 0)) {
      setNotice(appState, "Las cantidades de nacional no pueden ser negativas.", "warning");
      return null;
    }
    if (generalNationalStems > 0 && detailedNationalStems > 0 && generalNationalStems !== detailedNationalStems) {
      setNotice(appState, `El total general (${generalNationalStems}) debe coincidir con la suma O + V + B + M (${detailedNationalStems}), o deje el total general en 0.`, "warning");
      return null;
    }
    const nationalStems = detailedNationalStems > 0 ? detailedNationalStems : generalNationalStems;
    const previousNationalStems = utils.parseNumber(assignment?.nationalStems);
    const accumulatedNationalStems = previousNationalStems + nationalStems;
    if (!assignment || accumulatedNationalStems > utils.parseNumber(assignment.totalStems)) {
      const availableStems = Math.max(utils.parseNumber(assignment?.totalStems) - previousNationalStems, 0);
      setNotice(appState, `Seleccione bloque, clasificador y variedad, y registre una cantidad nacional valida. Disponible: ${availableStems} tallos.`, "warning");
      return null;
    }
    const previousCauses = classificationNationalCauses(assignment);
    const previousCauseTotal = classificationNationalCauseTotal(previousCauses);
    const previousGeneralNationalStems = assignment?.nationalGeneralStems === undefined
      ? Math.max(previousNationalStems - previousCauseTotal, 0)
      : utils.parseNumber(assignment.nationalGeneralStems);
    const accumulatedCauses = {
      oidio: previousCauses.oidio + nationalCauses.oidio,
      velloso: previousCauses.velloso + nationalCauses.velloso,
      botrytis: previousCauses.botrytis + nationalCauses.botrytis,
      maltrato: previousCauses.maltrato + nationalCauses.maltrato
    };
    const nationalGeneralStems = detailedNationalStems > 0 ? 0 : generalNationalStems;
    const accumulatedGeneralNationalStems = previousGeneralNationalStems + nationalGeneralStems;
    const observation = detailedNationalStems > 0
      ? `O=${nationalCauses.oidio} | V=${nationalCauses.velloso} | B=${nationalCauses.botrytis} | M=${nationalCauses.maltrato}`
      : `Nacional/rechazo general=${generalNationalStems}`;
    const hasPreviousResults = store.classificationResults.some(item => item.assignmentId === assignment.id);
    const result = {
      id: uuid(),
      assignmentId: assignment.id,
      dateTime: nowLabel(),
      nationalStems,
      nationalGeneralStems,
      nationalOidioStems: nationalCauses.oidio,
      nationalVellosoStems: nationalCauses.velloso,
      nationalBotrytisStems: nationalCauses.botrytis,
      nationalMaltratoStems: nationalCauses.maltrato,
      accumulatedNationalStems,
      accumulatedGeneralNationalStems,
      accumulatedNationalOidioStems: accumulatedCauses.oidio,
      accumulatedNationalVellosoStems: accumulatedCauses.velloso,
      accumulatedNationalBotrytisStems: accumulatedCauses.botrytis,
      accumulatedNationalMaltratoStems: accumulatedCauses.maltrato,
      exportableStems: Math.max(utils.parseNumber(assignment.totalStems) - accumulatedNationalStems, 0),
      observation
    };
    if (employeeIdOf(assignment)) setEmployeeId(result, employeeIdOf(assignment), { role: "classifier", source: "ASSIGNMENT_ID" });
    store.classificationResults.unshift(result);
    assignment.nationalStems = result.accumulatedNationalStems;
    assignment.nationalGeneralStems = result.accumulatedGeneralNationalStems;
    assignment.nationalOidioStems = result.accumulatedNationalOidioStems;
    assignment.nationalVellosoStems = result.accumulatedNationalVellosoStems;
    assignment.nationalBotrytisStems = result.accumulatedNationalBotrytisStems;
    assignment.nationalMaltratoStems = result.accumulatedNationalMaltratoStems;
    assignment.classificationResultObservation = result.observation;
    assignment.exportableStems = result.exportableStems;
    assignment.status = "ENTREGADO + REGISTRADO NACIONAL";
    assignment.closedAt = result.dateTime;
    if (!hasPreviousResults) {
      upsertPerformanceRecord(store, {
        date: today(),
        employeeId: employeeIdOf(assignment),
        operationalWorkerId: assignment.operational_worker_id || assignment.operationalWorkerId || employeeIdOf(assignment),
        worker: assignment.classifier,
        activity: "CLASIFICACION",
        variety: assignment.variety,
        bunches: 0,
        stems: assignment.totalStems,
        observation: `${result.observation}. Nacional/rechazo: ${nationalStems} tallos. Exportable estimado: ${result.exportableStems}.`
      });
    }
    resetClassificationResultDraft(appState);
    setNotice(appState, `Nacional registrada: ${result.nationalStems} tallos. Acumulada: ${result.accumulatedNationalStems} de ${assignment.totalStems}.`, "success");
    saveDb();
    return attachDurableSync(result);
  }

  function updateReceptionStatusLegacy(appState, receptionId, status) {
    const store = ensureStore(appState);
    const entry = store.receptions.find(item => item.id === receptionId);
    if (!entry) return false;
    entry.status = status;
    saveDb();
    return true;
  }

  function reviewClassification(appState, classificationId) {
    const store = ensureStore(appState);
    const entry = store.classifications.find(item => item.id === classificationId);
    if (!entry) return false;
    entry.reviewStatus = "REVISION_DEMO";
    entry.observation = `${entry.observation} | Cierre demo revisado.`;
    saveDb();
    return true;
  }

  function resetLabelDraft(appState) {
    const store = ensureStore(appState);
    store.ui.labelDraft = data.createLabelDraft();
    saveDb();
  }

  function resetYieldMeshDraft(appState) {
    const store = ensureStore(appState);
    store.ui.yieldMeshDraft = data.createYieldMeshDraft({
      supplier: store.ui.yieldMeshDraft?.supplier,
      block: store.ui.yieldMeshDraft?.block,
      classifier: store.ui.yieldMeshDraft?.classifier,
      responsible: store.ui.yieldMeshDraft?.responsible
    });
    saveDb();
  }

  function archiveProcessedMesh(appState, meshEntry, options = {}) {
    const store = ensureStore(appState);
    const processedAt = options.processedAt || meshEntry.registeredAt || nowLabel();
    const meshCode = String(meshEntry.code || meshEntry.meshCode || meshEntry.id || "").trim();
    const duplicate = store.processedMeshHistory.find(item => item.meshId === meshEntry.id || (item.meshCode === meshCode && item.processedAt === processedAt));
    if (duplicate) {
      if (options.notifyDuplicate) setNotice(appState, "La malla ya se encuentra registrada en el historial de procesadas.", "warning");
      return { created: false, duplicate };
    }
    const user = appState.db.session?.activeUser || {};
    const worker = (store.masterData?.classifiers || []).find(item => item.name === meshEntry.classifier);
    const totalStems = utils.parseNumber(meshEntry.totalStems);
    const history = {
      id: uid("HMP-OPS"),
      meshId: meshEntry.id,
      meshCode,
      meshCount: Math.max(0, utils.parseNumber(meshEntry.meshCount, 0)),
      stemsPerMesh: utils.parseNumber(meshEntry.stemsPerMesh),
      entryDate: meshEntry.date || String(processedAt).slice(0, 10),
      processedAt,
      supplier: meshEntry.supplier || "",
      block: meshEntry.block || "",
      variety: meshEntry.variety || "",
      length: utils.parseNumber(meshEntry.length),
      initialStems: totalStems,
      processedStems: totalStems,
      bunchesObtained: Math.round(totalStems / 25),
      workerId: worker?.id || "",
      workerName: meshEntry.classifier || "",
      userId: user.id || "",
        userName: user.name || "Usuario JAEDER SYSTEMS",
      station: meshEntry.station || meshEntry.table || "",
      shift: meshEntry.shift || "",
      state: options.state || "PROCESADA",
      observations: meshEntry.observation || "",
      workdayId: meshEntry.workdayId || "",
      assignmentId: meshEntry.assignmentId || "",
      sourceType: meshEntry.sourceType || "REGISTRO_MALLAS",
      inventoryScope: "HISTORIAL_OPERATIVO_MALLAS",
      accountingImpact: false,
      annulled: false,
      createdAt: nowLabel(),
      updatedAt: nowLabel()
    };
    const classifierEmployeeId = employeeIdOf(meshEntry) || employeeIdOf(worker);
    if (classifierEmployeeId) setEmployeeId(history, classifierEmployeeId, { role: "classifier", source: "MESH_ENTRY_ID" });
    store.processedMeshHistory.unshift(history);
    return { created: true, history };
  }

  function canEditProcessedMeshHistory(appState) {
    if (BlessERP.capabilityRuntime?.can?.("operations.classification.edit") === true) return true;
    return /ADMIN|SUPERVISOR/i.test(String(appState.db.session?.activeUser?.role || ""));
  }

  function canAnnulProcessedMeshHistory(appState) {
    return /ADMIN|SUPERVISOR/i.test(String(appState.db.session?.activeUser?.role || ""));
  }

  function openMeshHistoryDialog(appState, type, historyId) {
    const store = ensureStore(appState);
    const record = store.processedMeshHistory.find(item => item.id === historyId);
    if (!record) return false;
    const denied = type === "EDIT"
      ? !canEditProcessedMeshHistory(appState)
      : type === "ANNUL" && !canAnnulProcessedMeshHistory(appState);
    if (denied) {
      setNotice(appState, "Solo supervisores o administradores pueden modificar el historial.", "warning");
      return false;
    }
    store.ui.meshHistoryDialog = { type, historyId };
    store.ui.meshHistoryEditDraft = type === "EDIT" ? { ...clone(record), editReason: "" } : { annulReason: "" };
    saveDb();
    return true;
  }

  function closeMeshHistoryDialog(appState) {
    const store = ensureStore(appState);
    store.ui.meshHistoryDialog = null;
    store.ui.meshHistoryEditDraft = null;
    saveDb();
  }

  function saveMeshHistoryEdit(appState) {
    const store = ensureStore(appState);
    const dialog = store.ui.meshHistoryDialog;
    const draft = store.ui.meshHistoryEditDraft || {};
    const record = store.processedMeshHistory.find(item => item.id === dialog?.historyId);
    const reason = String(draft.editReason || "").trim();
    if (!record || dialog?.type !== "EDIT" || !canEditProcessedMeshHistory(appState) || !reason) {
      setNotice(appState, "La correccion requiere autorizacion y un motivo.", "warning");
      return false;
    }
    const before = clone(record);
    ["supplier", "block", "variety", "workerName", "station", "shift", "observations"].forEach(field => {
      record[field] = String(draft[field] ?? record[field]).trim();
    });
    record.length = utils.parseNumber(draft.length);
    record.processedStems = utils.parseNumber(draft.processedStems);
    record.bunchesObtained = utils.parseNumber(draft.bunchesObtained);
    record.updatedAt = nowLabel();
    store.processedMeshHistoryAudit.unshift({
      id: uid("AUD-HMP"),
      historyId: record.id,
      action: "EDITADO",
      before,
      after: clone(record),
      user: getDemoUser(appState),
      dateTime: nowLabel(),
      reason
    });
    store.ui.meshHistoryDialog = null;
    store.ui.meshHistoryEditDraft = null;
    setNotice(appState, `Historial ${record.meshCode} corregido con auditoria.`, "success");
    saveDb();
    return true;
  }

  function annulProcessedMeshHistory(appState) {
    const store = ensureStore(appState);
    const dialog = store.ui.meshHistoryDialog;
    const draft = store.ui.meshHistoryEditDraft || {};
    const record = store.processedMeshHistory.find(item => item.id === dialog?.historyId);
    const reason = String(draft.annulReason || "").trim();
    if (!record || dialog?.type !== "ANNUL" || !canAnnulProcessedMeshHistory(appState) || !reason) {
      setNotice(appState, "La anulacion requiere autorizacion y un motivo.", "warning");
      return false;
    }
    const before = clone(record);
    record.state = "ANULADO";
    record.annulled = true;
    record.annulledAt = nowLabel();
    record.annulledBy = getDemoUser(appState);
    record.annulledReason = reason;
    record.updatedAt = nowLabel();
    store.processedMeshHistoryAudit.unshift({ id: uid("AUD-HMP"), historyId: record.id, action: "ANULADO", before, after: clone(record), user: getDemoUser(appState), dateTime: nowLabel(), reason });
    store.ui.meshHistoryDialog = null;
    store.ui.meshHistoryEditDraft = null;
    setNotice(appState, `Historial ${record.meshCode} marcado como ANULADO.`, "success");
    saveDb();
    return true;
  }

  function applyMeshHistoryFilters(appState, mode = "SEARCH") {
    const store = ensureStore(appState);
    if (mode === "CLEAR" || mode === "ALL") store.ui.meshHistoryFilters = data.createMeshHistoryFilters();
    if (mode === "TODAY") store.ui.meshHistoryFilters = data.createMeshHistoryFilters({ from: today(), to: today() });
    store.ui.meshHistoryAppliedFilters = mode === "ALL" ? data.createMeshHistoryFilters() : clone(store.ui.meshHistoryFilters);
    store.ui.meshHistoryPage = 1;
    saveDb();
    return store.ui.meshHistoryAppliedFilters;
  }

  function registerYieldMeshProcessing(appState) {
    const store = ensureStore(appState);
    const gate = getYieldRegistrationGate(appState, store);
    if (!gate.allowed) {
      setNotice(appState, gate.message, "warning");
      return null;
    }
    const draft = clone(store.ui.yieldMeshDraft);
    const totalStems = calculateMeshTotal(draft);
    const classifierLink = resolveCatalogEmployee(store, "classifiers", {
      name: draft.classifier,
      employeeId: draft.classifier_employee_id || draft.classifierEmployeeId || draft.employee_id || draft.employeeId
    });
    const entry = {
      id: uid("MALLA-OPS"),
      date: draft.date || today(),
      supplier: draft.supplier,
      block: draft.block,
      variety: draft.variety,
      classifier: draft.classifier,
      responsible: draft.responsible,
      meshCount: utils.parseNumber(draft.meshCount),
      extraStems: utils.parseNumber(draft.extraStems),
      totalStems,
      workdayId: gate.workday.id,
      status: "PROCESADA",
      observation: draft.observation || "Mallas registradas para clasificacion.",
      registeredAt: nowLabel()
    };
    if (classifierLink.employeeId) setEmployeeId(entry, classifierLink.employeeId, { role: "classifier", source: "CATALOG_ID" });
    store.meshProcessingRecords.unshift(entry);
    archiveProcessedMesh(appState, entry);
    upsertPerformanceRecord(store, {
      date: entry.date,
      employeeId: classifierLink.employeeId,
      operationalWorkerId: classifierLink.operationalWorkerId,
      worker: entry.classifier,
      activity: "CLASIFICACION",
      variety: entry.variety,
      bunches: Math.round(totalStems / 25),
      stems: totalStems,
      workdayId: gate.workday.id,
      observation: "Actualizado desde mallas procesadas durante la jornada activa."
    });
    store.ui.yieldMeshDraft = data.createYieldMeshDraft({
      supplier: draft.supplier,
      block: draft.block,
      classifier: draft.classifier,
      classifierEmployeeId: classifierLink.employeeId,
      responsible: draft.responsible,
      variety: draft.variety
    });
    setNotice(appState, `Mallas procesadas registradas: ${entry.meshCount} mallas / ${entry.totalStems} tallos.`, "success");
    saveDb();
    return entry;
  }

  function resetYieldScannerDraft(appState) {
    const store = ensureStore(appState);
    store.ui.yieldScannerDraft = data.createYieldScannerDraft({
      classifier: store.ui.yieldScannerDraft?.classifier,
      buncher: store.ui.yieldScannerDraft?.buncher,
      responsible: store.ui.yieldScannerDraft?.responsible
    });
    saveDb();
  }

  function registerYieldBunchEntry(appState, codeOverride = "") {
    const store = ensureStore(appState);
    const code = codeOverride || store.ui.yieldScannerDraft?.code || "";
    return scanBunchLabelIntoInventory(appState, code, {
      responsible: store.ui.yieldScannerDraft?.responsible,
      observation: store.ui.yieldScannerDraft?.observation,
      source: "COMPATIBILIDAD_RENDIMIENTOS"
    });
  }

  function generateLabelBatch(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.labelDraft);
    const isMixed = draft.labelType === "MIXTA";
    if (isMixed) draft.block = "";
    const normalizedBlock = String(draft.block || "").trim().toUpperCase();
    const recognizedSupplier = (store.masterData?.suppliers || []).find(item => (
      item.active !== false
      && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock
    ));
    const buncherLink = resolveCatalogEmployee(store, "bunchers", {
      name: draft.buncher,
      employeeId: draft.buncher_employee_id || draft.buncherEmployeeId || draft.employee_id || draft.employeeId
    });
    if (isMixed) {
      draft.supplier = "BLESS FL";
    } else if (recognizedSupplier?.name) {
      draft.supplier = recognizedSupplier.name;
    }
    const quantity = Math.floor(utils.parseNumber(draft.quantity, 0));
    const blockMissing = !isMixed && !draft.block;
    if (blockMissing || !draft.buncher || !draft.supplier || !draft.variety || !draft.length || !draft.stemsPerBunch || quantity <= 0) {
      const missing = [
        blockMissing ? "bloque" : "",
        !isMixed && !recognizedSupplier ? "bloque parametrizado con proveedor" : "",
        !draft.buncher ? "embonchador" : "",
        !draft.variety ? "variedad" : "",
        !draft.length ? "longitud" : "",
        !draft.stemsPerBunch ? "tallos por ramo" : "",
        quantity <= 0 ? "cantidad de etiquetas" : ""
      ].filter(Boolean);
      setNotice(appState, `No se generaron las etiquetas. Complete: ${[...new Set(missing)].join(", ")}.`, "warning");
      return null;
    }
    const labels = Array.from({ length: quantity }, () => ({
      id: uid("LBL-OPS"),
      bunchId: uuid(),
      ...draft,
      quantity: 1,
      code: nextBunchLabelCode(store),
      state: "IMPRESA",
      createdAt: nowLabel(),
      printedAt: nowLabel(),
      scannedAt: "",
      inventoryId: "",
      printCount: 1
    })).map(label => {
      if (buncherLink.employeeId) setEmployeeId(label, buncherLink.employeeId, { role: "buncher", source: "CATALOG_ID" });
      return label;
    });
    store.labelBatches.unshift(...labels);
    store.ui.labelDraft = data.createLabelDraft({
      supplier: draft.supplier,
      block: draft.block,
      buncher: draft.buncher,
      buncherEmployeeId: buncherLink.employeeId,
      colorDay: draft.colorDay,
      variety: draft.variety,
      length: draft.length,
      stemsPerBunch: draft.stemsPerBunch,
      labelType: draft.labelType,
      printWidthMm: draft.printWidthMm,
      printHeightMm: draft.printHeightMm
    });
    setNotice(appState, `${labels.length} etiqueta(s) generadas y preparadas en PDF. Inventario creado: 0 ramos.`, "success");
    saveDb();
    return { labels, code: labels[0]?.code || "", firstCode: labels[0]?.code || "", lastCode: labels.at(-1)?.code || "", count: labels.length };
  }

  function registerPrintedZebraLabelsLegacy(appState, sourceLabels = [], options = {}) {
    const store = ensureStore(appState);
    const rows = Array.isArray(sourceLabels) ? sourceLabels : [];
    const assignedCodes = numericBunchLabelCodes(store);
    const allocateCode = () => {
      const code = nextBunchLabelCode(store, assignedCodes);
      assignedCodes.add(code);
      return code;
    };
    const prepared = rows.map(source => {
      const requestedCode = normalizeBunchLabelCode(source?.code);
      const code = options.assignNumericCodes === true && !/^\d{10}$/.test(requestedCode) ? allocateCode() : requestedCode;
      const structured = BlessERP.bunchLabelCodec?.isStructuredCode?.(code) || false;
      let decoded = structured ? BlessERP.bunchLabelCodec?.decode?.(code, store) : null;
      if (/^\d{10}$/.test(code)) {
        const color = String(source.colorDay || source.color || "").trim().toUpperCase();
        const buncher = (store.masterData?.bunchers || []).find(item => (
          item.active !== false && String(item.labelColor || item.color || "").trim().toUpperCase() === color
        ));
        const components = (source.components || [])
          .map(component => {
            const provider = String(component.provider || "").trim().toUpperCase();
            const block = String(component.block || "").trim().toUpperCase();
            const supplier = (store.masterData?.suppliers || []).find(item => (
              item.active !== false && (
                BlessERP.bunchLabelCodec?.supplierCode?.(item.code || item.name) === BlessERP.bunchLabelCodec?.supplierCode?.(provider)
                || String(item.assignedBlock || "").trim().toUpperCase() === block
              )
            ));
            return { provider, supplier: supplier?.name || provider, block, stems: utils.parseNumber(component.stems) };
          })
          .filter(component => component.block || component.provider || component.stems > 0);
        const total = components.reduce((sum, component) => sum + component.stems, 0);
        const target = utils.parseNumber(source.stemsPerBunch || source.target);
        const valid = Boolean(source.variety && source.length && color && components.length && total > 0 && total === target);
        decoded = valid ? {
          ok: true,
          code,
          nonce: code,
          color,
          buncher: buncher?.name || color,
          buncherEmployeeId: buncher?.employee_id || buncher?.employeeId || "",
          variety: source.variety,
          length: utils.parseNumber(source.length),
          total,
          type: components.length > 1 ? "MIXTO" : "INDIVIDUAL",
          components,
          supplier: components.length === 1 ? components[0].supplier : [...new Set(components.map(item => item.supplier))].join(" + "),
          block: components.length === 1 ? components[0].block : components.map(item => item.block).join(" + ")
        } : { ok: false, error: "La composicion interna de la etiqueta esta incompleta o no suma los tallos objetivo." };
      }
      if (!code || !decoded?.ok) {
        return { ok: false, code, error: decoded?.error || "El codigo de la etiqueta no es valido." };
      }
      const existing = store.labelBatches.find(item => normalizeBunchLabelCode(item.code) === code);
      if (existing?.state === "ESCANEADA" || existing?.inventoryId) {
        return { ok: false, code, error: `La etiqueta ${code} ya fue ingresada al inventario y no puede reutilizarse.` };
      }
      return { ok: true, code, decoded, source, existing, structured };
    });
    const invalid = prepared.find(item => !item.ok);
    if (invalid) {
      setNotice(appState, invalid.error, "warning");
      return { ok: false, error: invalid.error, labels: [] };
    }

    const printedAt = nowLabel();
    const outputType = String(options.outputType || "ZEBRA").toUpperCase() === "PDF" ? "PDF" : "ZEBRA";
    const labels = prepared.map(item => {
      const { decoded, existing, source, code, structured } = item;
      const buncherLink = resolveCatalogEmployee(store, "bunchers", {
        name: decoded.buncher,
        employeeId: decoded.buncherEmployeeId
      });
      const composition = decoded.components.map(component => ({
        provider: component.provider || "",
        supplier: component.supplier || "",
        block: component.block || "",
        stems: utils.parseNumber(component.stems)
      }));
      const label = existing || {
        id: uid("LBL-ZEBRA"),
        bunchId: String(source.bunchId || source.bunch_id || uuid()),
        code,
        createdAt: printedAt,
        scannedAt: "",
        inventoryId: "",
        printCount: 0
      };
      Object.assign(label, {
        bunchId: String(label.bunchId || source.bunchId || source.bunch_id || uuid()),
        code,
        date: printedAt.slice(0, 10),
        printedAt,
        colorDay: decoded.color || source.colorDay || source.color || "",
        color: decoded.color || source.color || source.colorDay || "",
        supplier: decoded.supplier || "",
        block: decoded.block || "",
        buncher: decoded.buncher || "",
        variety: decoded.variety || source.variety || "",
        length: utils.parseNumber(decoded.length || source.length),
        category: source.localDestinationCustomerId ? "LOCAL" : "EXPORTACION",
        destinationMode: source.destinationMode || "BLESS_EXPORT",
        localDestinationCustomerId: source.localDestinationCustomerId || "",
        localDestinationName: source.localDestinationName || "",
        stemsPerBunch: utils.parseNumber(decoded.total || source.stemsPerBunch),
        quantity: 1,
        labelType: decoded.type === "MIXTO" ? "MIXTA" : "NORMAL",
        composition,
        state: "IMPRESA",
        outputType,
        sourceType: "DIGITACION_ETIQUETA_ZEBRA",
        inlineStructured: structured,
        storedComposition: true,
        observation: "Ficha interna creada al generar la etiqueta. El inventario se creara solamente al escanearla.",
        printCount: utils.parseNumber(label.printCount) + 1
      });
      if (buncherLink.employeeId) setEmployeeId(label, buncherLink.employeeId, { role: "buncher", source: "COLOR_EMBONCHADOR" });
      if (!existing) store.labelBatches.unshift(label);
      return label;
    });

    const compactMode = writeCompactZebraRegistry(store.labelBatches);
    const fullPersisted = saveDb();
    if (!fullPersisted && compactMode === "MEMORY") {
      const warning = "La etiqueta quedo disponible durante esta sesion, pero el navegador no permitio persistirla despues de cerrar la pagina.";
      setNotice(appState, warning, "warning");
      return { ok: true, warning, labels, count: labels.length, persistenceMode: compactMode };
    }
    const detail = fullPersisted ? "registro general" : (compactMode === "LOCAL" ? "registro compacto local" : "registro temporal de la pestaña");
    setNotice(appState, `${labels.length} etiqueta(s) registradas mediante ${detail}. Inventario creado: 0 ramos.`, "success");
    return { ok: true, labels, count: labels.length, persistenceMode: fullPersisted ? "GENERAL" : compactMode };
  }

  async function registerPrintedZebraLabelsConfirmed(appState, sourceLabels = [], options = {}) {
    const store = ensureStore(appState);
    const rows = Array.isArray(sourceLabels) ? sourceLabels : [];
    if (!rows.length) return { ok: false, error: "No existen etiquetas para crear.", labels: [] };
    const outputType = String(options.outputType || "ZEBRA").toUpperCase() === "PDF" ? "PDF" : "ZEBRA";
    const operationId = String(options.operationId || options.operation_id || uuid());
    const labels = rows.map(source => {
      const components = (source.components || [])
        .map(component => ({
          provider: String(component.provider || "").trim().toUpperCase(),
          supplier: String(component.supplier || component.provider || "").trim(),
          block: String(component.block || "").trim().toUpperCase(),
          stems: Math.max(0, Math.trunc(utils.parseNumber(component.stems)))
        }))
        .filter(component => component.provider || component.block || component.stems > 0);
      const labelColor = String(source.colorDay || source.color || "").trim().toUpperCase();
      const buncherByColor = (store.masterData?.bunchers || []).find(item => (
        item.active !== false
        && String(item.labelColor || item.color || "").trim().toUpperCase() === labelColor
      ));
      const buncherLink = resolveCatalogEmployee(store, "bunchers", {
        name: source.buncher || buncherByColor?.name || labelColor,
        employeeId: source.buncher_employee_id || source.buncherEmployeeId || buncherByColor?.employee_id || buncherByColor?.employeeId
      });
      return {
        bunchId: String(source.bunchId || source.bunch_id || uuid()),
        variety: String(source.variety || "").trim().toUpperCase(),
        length: utils.parseNumber(source.length),
        quality: String(source.quality || source.category || "EXPORTACION").trim().toUpperCase(),
        category: String(source.category || (source.localDestinationCustomerId ? "LOCAL" : "EXPORTACION")).trim().toUpperCase(),
        stemsPerBunch: utils.parseNumber(source.stemsPerBunch || source.target),
        color: labelColor,
        buncher: buncherLink.name || String(source.buncher || buncherByColor?.name || labelColor).trim(),
        buncherEmployeeId: buncherLink.employeeId || "",
        supplier: String(source.supplier || components[0]?.supplier || components[0]?.provider || "").trim(),
        block: String(source.block || components[0]?.block || "").trim().toUpperCase(),
        components,
        labelType: components.length > 1 ? "MIXTA" : "NORMAL",
        receptionId: String(source.receptionId || source.reception_id || "").trim(),
        classificationResultId: String(source.classificationResultId || source.classification_result_id || "").trim(),
        destinationMode: String(source.destinationMode || "BLESS_EXPORT").trim(),
        destinationType: String(source.destinationType || (source.localDestinationCustomerId ? "LOCAL" : "EXPORT")).trim().toUpperCase(),
        localDestinationCustomerId: String(source.localDestinationCustomerId || "").trim(),
        localDestinationName: String(source.localDestinationName || "").trim(),
        destinationOrderId: String(source.destinationOrderId || source.orderId || "").trim(),
        outputType
      };
    });
    const invalid = labels.find(label => (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(label.bunchId)
      || !label.variety
      || label.length <= 0
      || label.stemsPerBunch <= 0
      || !label.color
      || !label.components.length
      || label.components.some(component => !component.provider || !component.block || component.stems <= 0)
      || label.components.reduce((sum, component) => sum + component.stems, 0) !== label.stemsPerBunch
    ));
    if (invalid) {
      const error = "La etiqueta no contiene una identidad UUID y una composición completa igual al total de tallos.";
      setNotice(appState, error, "warning", false);
      return { ok: false, error, labels: [] };
    }

    const destination = {
      type: String(options.destinationType || labels[0]?.destinationType || "EXPORT").trim().toUpperCase(),
      customerId: String(options.destinationCustomerId || labels[0]?.localDestinationCustomerId || "").trim(),
      orderId: String(options.destinationOrderId || labels[0]?.destinationOrderId || "").trim()
    };
    const destinationRepository = destinationV2Repository();
    const persisted = await destinationRepository?.createLabels?.(labels, destination, { operationId });
    if (!persisted?.ok) {
      const error = persisted?.message || "Las etiquetas no fueron confirmadas por Supabase.";
      setNotice(appState, error, "danger", false);
      return { ok: false, error, labels: [], operationId };
    }
    const canonicalLabels = (persisted.records || [])
      .filter(record => record.entity === "operations_label_batches")
      .map(record => ({
        ...clone(record.payload),
        __syncVersion: Number(record.version || 1),
        __syncUpdatedAt: String(record.updated_at || ""),
        __syncUpdatedBy: String(record.updated_by || ""),
        __syncDeviceId: String(record.device_id || ""),
        __syncOperationId: String(record.last_operation_id || operationId)
      }));
    if (canonicalLabels.length !== labels.length) {
      const error = "Supabase no devolvió todas las etiquetas canónicas solicitadas.";
      setNotice(appState, error, "danger", false);
      return { ok: false, error, labels: canonicalLabels, operationId };
    }
    cacheSave();
    setNotice(appState, `${canonicalLabels.length} etiqueta(s) confirmadas. Inventario creado: 0 ramos.`, "success", false);
    return {
      ok: true,
      confirmed: true,
      labels: canonicalLabels,
      count: canonicalLabels.length,
      operationId,
      persistenceMode: "SUPABASE_TRANSACTION_CONFIRMED"
    };
  }

  function registerPrintedZebraLabels(appState, sourceLabels = [], options = {}) {
    return requiresConfirmedZebra()
      ? registerPrintedZebraLabelsConfirmed(appState, sourceLabels, options)
      : registerPrintedZebraLabelsLegacy(appState, sourceLabels, options);
  }

  function updateLabelStateLegacy(appState, labelId, state) {
    const store = ensureStore(appState);
    const entry = store.labelBatches.find(item => item.id === labelId);
    if (!entry) return false;
    if (entry.state === "ESCANEADA" && state !== "ESCANEADA") {
      setNotice(appState, "Una etiqueta escaneada no puede cambiarse desde esta pantalla.", "warning");
      return false;
    }
    if (state === "REIMPRESA" || state === "IMPRESA") {
      entry.state = "IMPRESA";
      entry.printedAt = nowLabel();
      entry.printCount = utils.parseNumber(entry.printCount) + 1;
    } else {
      entry.state = state;
    }
    saveDb();
    return true;
  }

  async function updateLabelStateConfirmed(appState, labelId, state, options = {}) {
    const store = ensureStore(appState);
    const label = (store.labelBatches || []).find(item => item.id === labelId);
    if (!label) return null;
    if (String(state || "").toUpperCase() !== "REIMPRESA") {
      setNotice(appState, "El flujo Zebra V2 solo permite reimpresión explícita desde esta acción.", "warning", false);
      return null;
    }
    const operationId = String(options.operationId || options.operation_id || uuid());
    const persisted = await zebraV2Repository()?.reprintLabel?.(label.code, options.outputType || "ZEBRA", { operationId });
    if (!persisted?.ok) {
      setNotice(appState, persisted?.message || "La reimpresión no fue confirmada por Supabase.", "danger", false);
      return null;
    }
    const canonical = canonicalPayload(persisted, "operations_label_batches", label.id);
    cacheSave();
    setNotice(appState, `Reimpresión confirmada para ${canonical?.code || label.code}. Inventario sin cambios.`, "success", false);
    return canonical || label;
  }

  function updateLabelState(appState, labelId, state, options = {}) {
    return requiresConfirmedZebra()
      ? updateLabelStateConfirmed(appState, labelId, state, options)
      : updateLabelStateLegacy(appState, labelId, state);
  }

  function normalizeBunchLabelCode(rawCode) {
    const compact = String(rawCode ?? "").replace(/[\r\n\t ]+/g, "").trim();
    if (BlessERP.bunchLabelCodec?.isStructuredCode?.(compact)) {
      return BlessERP.bunchLabelCodec.normalizeStructuredCode(compact);
    }
    const digits = compact.replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.length < 10) return digits.padStart(10, "0");
    return digits.slice(-10);
  }

  function setBunchReaderConnection(appState, connected, target = "INGRESO") {
    const store = ensureStore(appState);
    const readerTarget = target === "BUSQUEDA" ? "BUSQUEDA" : "INGRESO";
    const stateField = readerTarget === "BUSQUEDA" ? "bunchSearchReaderConnected" : "bunchIntakeReaderConnected";
    store.ui.bunchIntakeReaderConnected = true;
    store.ui.bunchSearchReaderConnected = true;
    store.ui.bunchReaderConnected = true;
    store.ui.bunchReaderTarget = readerTarget;
    setNotice(appState, `Lector ZEBRA de ${readerTarget === "BUSQUEDA" ? "busqueda" : "ingreso"} activo automaticamente en modo HID.`, "success");
    saveDb();
    return Boolean(store.ui[stateField]);
  }

  function addBunchToSearch(appState, rawCode) {
    const store = ensureStore(appState);
    const code = normalizeBunchLabelCode(rawCode);
    const structured = BlessERP.bunchLabelCodec?.isStructuredCode?.(code) || false;
    const decoded = structured ? BlessERP.bunchLabelCodec.decode(code, store) : null;
    store.ui.bunchSearchScanCode = "";
    if ((!structured && !/^\d{10}$/.test(code)) || (structured && !decoded?.ok)) {
      setNotice(appState, structured
        ? (decoded?.error || "La etiqueta BF esta incompleta o no es valida.")
        : "La busqueda requiere un codigo de ramo de 10 digitos o una etiqueta BF valida.", "warning", false);
      return null;
    }
    const inventory = store.roseInventory.find(item => item.labelCode === code && item.sourceType === "ESCANEO_ETIQUETA");
    if (!inventory) {
      setNotice(appState, `El codigo ${code} no existe entre los ramos ingresados por lector.`, "warning", false);
      return null;
    }
    if (inventory.state === "ANULADO") {
      setNotice(appState, `El ramo ${code} esta anulado y no puede agregarse a la lista.`, "warning", false);
      return null;
    }
    if (store.ui.bunchSearchCodes.includes(code)) {
      setNotice(appState, `El ramo ${code} ya esta en la lista; no se agrego nuevamente.`, "warning", false);
      return inventory;
    }
    store.ui.bunchSearchCodes.unshift(code);
    store.ui.bunchSearchSelectedCodes = [...new Set([...store.ui.bunchSearchSelectedCodes, code])];
    setNotice(appState, `Ramo ${code} agregado y seleccionado automaticamente.`, "success", false);
    return inventory;
  }

  function toggleBunchSearchSelection(appState, code, selected) {
    const store = ensureStore(appState);
    const normalizedCode = normalizeBunchLabelCode(code);
    const current = new Set(store.ui.bunchSearchSelectedCodes);
    if (selected) current.add(normalizedCode);
    else current.delete(normalizedCode);
    store.ui.bunchSearchSelectedCodes = [...current].filter(item => store.ui.bunchSearchCodes.includes(item));
    saveDb();
    return store.ui.bunchSearchSelectedCodes;
  }

  function selectBunchSearchRows(appState, codes) {
    const store = ensureStore(appState);
    const validCodes = new Set(store.ui.bunchSearchCodes);
    store.ui.bunchSearchSelectedCodes = [...new Set((codes || []).map(normalizeBunchLabelCode).filter(code => validCodes.has(code)))];
    saveDb();
    return store.ui.bunchSearchSelectedCodes;
  }

  function setVisibleBunchSearchRowsSelection(appState, codes, selected) {
    const store = ensureStore(appState);
    const visibleCodes = new Set((codes || []).map(normalizeBunchLabelCode).filter(code => store.ui.bunchSearchCodes.includes(code)));
    const current = new Set(store.ui.bunchSearchSelectedCodes);
    visibleCodes.forEach(code => {
      if (selected) current.add(code);
      else current.delete(code);
    });
    store.ui.bunchSearchSelectedCodes = [...current].filter(code => store.ui.bunchSearchCodes.includes(code));
    saveDb();
    return store.ui.bunchSearchSelectedCodes;
  }

  function removeBunchSearchRows(appState, codes = []) {
    const store = ensureStore(appState);
    const removeCodes = new Set((codes.length ? codes : store.ui.bunchSearchSelectedCodes).map(normalizeBunchLabelCode));
    store.ui.bunchSearchCodes = store.ui.bunchSearchCodes.filter(code => !removeCodes.has(code));
    store.ui.bunchSearchSelectedCodes = store.ui.bunchSearchSelectedCodes.filter(code => !removeCodes.has(code));
    setNotice(appState, `${removeCodes.size} ramo(s) retirado(s) de la busqueda. El inventario se conserva.`, "info");
    saveDb();
    return removeCodes.size;
  }

  function updateBunchSearchLengths(appState, targetLength) {
    const store = ensureStore(appState);
    const selectedCodes = [...new Set(store.ui.bunchSearchSelectedCodes)];
    const nextLength = utils.parseNumber(targetLength);
    const allowedLengths = [40, 50, 60, 70, 80, 90, 100];
    const inventories = selectedCodes.map(code => store.roseInventory.find(item => item.labelCode === code && item.sourceType === "ESCANEO_ETIQUETA")).filter(Boolean);
    if (!inventories.length || !allowedLengths.includes(nextLength)) {
      setNotice(appState, "Seleccione uno o varios ramos y una medida valida.", "warning");
      return null;
    }
    inventories.forEach(inventory => {
      const previousLength = utils.parseNumber(inventory.length);
      inventory.originalLength = inventory.originalLength || previousLength;
      inventory.length = nextLength;
      inventory.observation = `${inventory.observation || ""} | Medida ajustada de ${previousLength} a ${nextLength} cm el ${nowLabel()}.`.trim();
      const entry = store.bunchEntries.find(item => item.inventoryId === inventory.inventoryId || item.code === inventory.labelCode);
      if (entry) {
        entry.originalLength = entry.originalLength || utils.parseNumber(entry.length);
        entry.length = nextLength;
        entry.observation = inventory.observation;
      }
      const label = store.labelBatches.find(item => item.id === inventory.sourceLabelId || item.code === inventory.labelCode);
      if (label) {
        label.originalLength = label.originalLength || utils.parseNumber(label.length);
        label.length = nextLength;
        label.observation = inventory.observation;
      }
    });
    refreshAvailabilityFromScannedInventory(store);
    store.ui.bunchSearchCodes = [];
    store.ui.bunchSearchSelectedCodes = [];
    store.ui.bunchSearchTargetLength = "";
    store.ui.bunchSearchScanCode = "";
    store.ui.bunchSearchFilter = "";
    setNotice(appState, `${inventories.length} etiqueta(s) actualizada(s) correctamente a ${nextLength} cm.`, "success", false);
    saveDb();
    return inventories;
  }

  function deleteBunchSearchRows(appState, reason = "") {
    const store = ensureStore(appState);
    const normalizedReason = String(reason || "").trim();
    const selectedCodes = [...new Set(store.ui.bunchSearchSelectedCodes.map(normalizeBunchLabelCode))];
    if (!selectedCodes.length) {
      setNotice(appState, "Seleccione una o varias etiquetas para eliminar.", "warning");
      return null;
    }
    if (!normalizedReason) {
      setNotice(appState, "El motivo de eliminacion es obligatorio.", "warning");
      return null;
    }
    const protectedStates = new Set(["ASIGNADO_CAJA", "RESERVADO", "DESPACHADO"]);
    const inventories = selectedCodes.map(code => store.roseInventory.find(item => item.labelCode === code && item.sourceType === "ESCANEO_ETIQUETA")).filter(Boolean);
    const blocked = inventories.filter(item => protectedStates.has(item.state));
    const deletable = inventories.filter(item => !protectedStates.has(item.state) && item.state !== "ANULADO");
    if (!deletable.length) {
      setNotice(appState, blocked.length
        ? "Las etiquetas seleccionadas estan asignadas, reservadas o despachadas y no pueden anularse."
        : "No existen etiquetas activas seleccionadas para anular.", "warning");
      return null;
    }
    const deletedAt = nowLabel();
    const deletedBy = getDemoUser(appState);
    const deletedCodes = deletable.map(item => item.labelCode);
    deletable.forEach(inventory => {
      inventory.previousState = inventory.state;
      inventory.state = "ANULADO";
      inventory.annulledAt = deletedAt;
      inventory.annulledBy = deletedBy;
      inventory.annulledReason = normalizedReason;
      inventory.observation = `${inventory.observation || ""} | Anulado el ${deletedAt}. Motivo: ${normalizedReason}.`.trim();
      const entry = store.bunchEntries.find(item => item.inventoryId === inventory.inventoryId || item.code === inventory.labelCode);
      if (entry) {
        entry.previousState = entry.state;
        entry.state = "ANULADO";
        entry.intakeState = entry.intakeState || "INGRESADO_POR_ESCANEO";
        entry.admissionSource = entry.admissionSource || "ESCANEO_ETIQUETA";
        entry.operationalState = "ANULADO";
        entry.annulledAt = deletedAt;
        entry.annulledBy = deletedBy;
        entry.annulledReason = normalizedReason;
        entry.observation = inventory.observation;
      }
      const label = store.labelBatches.find(item => item.id === inventory.sourceLabelId || item.code === inventory.labelCode);
      if (label) {
        label.previousState = label.state;
        label.state = "ANULADA";
        label.annulledAt = deletedAt;
        label.annulledBy = deletedBy;
        label.annulledReason = normalizedReason;
        label.observation = inventory.observation;
      }
    });
    store.bunchDeletionAudit.unshift({
      id: uid("DEL-RAMO"),
      dateTime: deletedAt,
      user: deletedBy,
      codes: deletedCodes,
      count: deletedCodes.length,
      reason: normalizedReason,
      blockedCodes: blocked.map(item => item.labelCode)
    });
    const deletedSet = new Set(deletedCodes);
    store.ui.bunchSearchCodes = store.ui.bunchSearchCodes.filter(code => !deletedSet.has(code));
    store.ui.bunchSearchSelectedCodes = blocked.map(item => item.labelCode).filter(code => store.ui.bunchSearchCodes.includes(code));
    store.ui.bunchSearchTargetLength = "";
    refreshAvailabilityFromScannedInventory(store);
    setNotice(appState, `${deletedCodes.length} etiqueta(s) anulada(s) correctamente.${blocked.length ? ` ${blocked.length} protegida(s) no se modificaron.` : ""}`, "success", false);
    saveDb();
    return { deleted: deletable, blocked, audit: store.bunchDeletionAudit[0] };
  }

  function addBunchScanEvent(store, appState, payload) {
    const event = {
      eventId: uid("SCN-OPS"),
      dateTime: nowLabel(),
      code: payload.code,
      type: "RAMO",
      moduleOrigin: "Ingreso de ramos por escaner",
      result: payload.result,
      user: getDemoUser(appState),
      labelId: payload.labelId || "",
      inventoryId: payload.inventoryId || "",
      observation: payload.observation || ""
    };
    store.scannerEvents.unshift(event);
    return event;
  }

  function scanBunchLabelIntoInventoryLegacy(appState, rawCode, options = {}) {
    const store = ensureStore(appState);
    const code = normalizeBunchLabelCode(rawCode);
    const structured = BlessERP.bunchLabelCodec?.isStructuredCode?.(code) || false;
    const decoded = structured ? BlessERP.bunchLabelCodec.decode(code, store) : null;
    const finish = (result, tone, observation, extra = {}) => {
      const event = addBunchScanEvent(store, appState, { code, result, observation, ...extra });
      const response = { ok: result === "INVENTARIO_CREADO", result, code, observation, event, ...extra };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, observation, tone);
      saveDb();
      return response;
    };

    const gate = getYieldRegistrationGate(appState, store);
    if (!gate.allowed) {
      return finish("JORNADA_INACTIVA", "warning", `${gate.message} No se creo inventario ni rendimiento.`);
    }

    if ((!structured && !/^\d{10}$/.test(code)) || (structured && !decoded?.ok)) {
      return finish("FORMATO_INVALIDO", "warning", structured ? (decoded?.error || "La etiqueta BF es invalida.") : "El codigo debe contener exactamente 10 digitos o corresponder a una etiqueta BF2.");
    }
    const registeredLabel = labelScanIndex(store).byCode.get(code) || null;
    const label = registeredLabel || (structured ? {
      id: `LBL-INLINE-${decoded.nonce}`,
      code,
      state: "IMPRESA",
      colorDay: decoded.color,
      supplier: decoded.supplier,
      block: decoded.block,
      buncher: decoded.buncher,
      buncher_employee_id: decoded.buncherEmployeeId,
      buncherEmployeeId: decoded.buncherEmployeeId,
      variety: decoded.variety,
      length: decoded.length,
      category: "EXPORTACION",
      stemsPerBunch: decoded.total,
      labelType: decoded.type === "MIXTO" ? "MIXTA" : "NORMAL",
      composition: decoded.components,
      inlineStructured: true
    } : null);
    if (!label) {
      return finish("NO_ENCONTRADO", "warning", "Etiqueta no encontrada. No se creo inventario.");
    }
    const inventoryIndex = inventoryScanIndex(store);
    const existingInventory = inventoryIndex.byAlternateId.get(String(label.id)) || inventoryIndex.byCode.get(code) || null;
    if (existingInventory || label.state === "ESCANEADA" || label.inventoryId) {
      return finish("DUPLICADO", "warning", `La etiqueta ${code} ya fue escaneada. No se duplico el ramo.`, {
        labelId: label.id,
        inventoryId: existingInventory?.inventoryId || label.inventoryId || ""
      });
    }
    if (["ANULADA", "OBSERVADA"].includes(label.state)) {
      return finish("BLOQUEADA", "warning", `La etiqueta esta ${label.state}. No se creo inventario.`, { labelId: label.id });
    }

    const hasStoredComposition = Array.isArray(label.composition) && label.composition.length > 0 && label.storedComposition === true;
    if (!structured && label.labelType === "MIXTA" && !hasStoredComposition && !Array.isArray(options.confirmedComposition)) {
      const previousDraft = store.ui.mixedBunchIntakeDraft?.code === code ? store.ui.mixedBunchIntakeDraft : null;
      const lines = previousDraft?.lines || [
        { block: "", supplier: "", stems: 0 },
        { block: "", supplier: "", stems: 0 },
        { block: "", supplier: "", stems: 0 }
      ];
      store.ui.mixedBunchIntakeDraft = {
        labelId: label.id,
        code,
        expectedStems: utils.parseNumber(label.stemsPerBunch),
        responsible: options.responsible || store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState),
        observation: options.observation || "",
        lines
      };
      const observation = `Etiqueta mixta ${code}: registre de uno a tres bloques y complete ${label.stemsPerBunch} tallos antes de confirmar.`;
      const event = addBunchScanEvent(store, appState, { code, result: "PENDIENTE_COMPOSICION", labelId: label.id, observation });
      const response = { ok: false, pendingComposition: true, result: "PENDIENTE_COMPOSICION", code, observation, event, labelId: label.id };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, observation, "info", false);
      saveDb();
      return response;
    }

    const admittedAt = nowLabel();
    const composition = structured
      ? (Array.isArray(label.composition) && label.composition.length ? label.composition : decoded.components)
        .map(item => ({ block: item.block, supplier: item.supplier, provider: item.provider, stems: utils.parseNumber(item.stems) }))
      : Array.isArray(options.confirmedComposition)
      ? options.confirmedComposition.map(item => ({ block: item.block, supplier: item.supplier, stems: utils.parseNumber(item.stems) }))
      : hasStoredComposition
      ? label.composition.map(item => ({ block: item.block, supplier: item.supplier, provider: item.provider, stems: utils.parseNumber(item.stems) }))
      : [];
    const isMixed = label.labelType === "MIXTA";
    const inventorySupplier = isMixed ? [...new Set(composition.map(item => item.supplier))].join(" + ") : label.supplier;
    const inventoryBlock = isMixed ? composition.map(item => item.block).join(" + ") : label.block;
    const compositionText = composition.map(item => `${item.block}: ${item.stems} tallos`).join("; ");
    const buncherLink = resolveCatalogEmployee(store, "bunchers", {
      name: label.buncher,
      employeeId: label.buncher_employee_id || label.buncherEmployeeId || label.employee_id || label.employeeId
    });
    const inventoryId = uuid();
    const bunchId = String(label.bunchId || uuid());
    label.bunchId = bunchId;
    // El historial de rendimiento usa el prefijo RAMO-OPS como contrato
    // funcional; la identidad canónica del stock sigue siendo inventoryId UUID.
    const bunchEntryId = uid("RAMO-OPS");
    const event = addBunchScanEvent(store, appState, {
      code,
      bunchId,
      result: "INVENTARIO_CREADO",
      labelId: label.id,
      inventoryId,
      observation: "Primer escaneo valido; ramo creado en inventario operativo demo."
    });
    const inventory = {
      inventoryId,
      bunchId,
      date: admittedAt.slice(0, 10),
      admittedAt,
      labelCode: code,
      variety: label.variety,
      length: utils.parseNumber(label.length),
      stemsPerBunch: utils.parseNumber(label.stemsPerBunch),
      bunches: 1,
      stems: utils.parseNumber(label.stemsPerBunch),
      warehouse: "CUARTO FRIO 1",
      location: "PENDIENTE UBICACION",
      supplier: inventorySupplier,
      block: inventoryBlock,
      ageDays: 0,
      category: label.category || "EXPORTACION",
      destinationMode: label.destinationMode || "BLESS_EXPORT",
      localDestinationCustomerId: label.localDestinationCustomerId || "",
      localDestinationName: label.localDestinationName || "",
      state: label.localDestinationCustomerId ? "ASIGNADO_LOCAL" : "DISPONIBLE",
      buncher: label.buncher,
      responsible: options.responsible || store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState),
      coldState: "PENDIENTE_UBICACION",
      observation: isMixed
        ? `Ramo mixto confirmado. ${compositionText}${options.observation ? ` | ${options.observation}` : ""}`
        : (options.observation || "Ingreso creado exclusivamente por escaneo de etiqueta."),
      composition,
      sourceType: "ESCANEO_ETIQUETA",
      workdayId: gate.workday.id,
      sourceBunchEntryId: bunchEntryId,
      sourceLabelId: label.id,
      sourceScannerEventId: event.eventId
    };
    if (buncherLink.employeeId) setEmployeeId(inventory, buncherLink.employeeId, { role: "buncher", source: "LABEL_ID" });
    const bunchEntry = {
      id: bunchEntryId,
      bunchId,
      date: admittedAt.slice(0, 10),
      code,
      supplier: inventorySupplier,
      block: inventoryBlock,
      variety: label.variety,
      length: label.length,
      stemsPerBunch: label.stemsPerBunch,
      classifier: "NO RELACIONADO",
      buncher: label.buncher,
      responsible: inventory.responsible,
      state: "INGRESADO_POR_ESCANEO",
      intakeState: "INGRESADO_POR_ESCANEO",
      admissionSource: "ESCANEO_ETIQUETA",
      destinationMode: label.destinationMode || "BLESS_EXPORT",
      localDestinationCustomerId: label.localDestinationCustomerId || "",
      localDestinationName: label.localDestinationName || "",
      operationalState: label.localDestinationCustomerId ? "ASIGNADO_LOCAL" : "DISPONIBLE",
      workdayId: gate.workday.id,
      observation: inventory.observation,
      registeredAt: admittedAt,
      labelId: label.id,
      inventoryId
    };
    if (buncherLink.employeeId) setEmployeeId(bunchEntry, buncherLink.employeeId, { role: "buncher", source: "LABEL_ID" });
    bunchEntry.composition = composition;
    store.roseInventory.unshift(inventory);
    store.bunchEntries.unshift(bunchEntry);
    store.inventoryMovements = Array.isArray(store.inventoryMovements) ? store.inventoryMovements : [];
    store.inventoryMovements.unshift({
      id: uuid(),
      operationId: uuid(),
      bunchId,
      date: admittedAt.slice(0, 10),
      dateTime: admittedAt,
      movementType: "BUNCH_RECEIPT",
      direction: "IN",
      sourceEntity: "operations_bunch_entries",
      sourceId: bunchEntryId,
      inventoryId,
      labelCode: code,
      variety: inventory.variety,
      length: inventory.length,
      quality: inventory.quality || inventory.category || "EXPORTACION",
      warehouse: inventory.warehouse,
      location: inventory.location,
      stockKey: inventoryLogicalKey(inventory),
      bunches: 1,
      stems: utils.parseNumber(inventory.stems || inventory.stemsPerBunch),
      observation: "Entrada local creada exclusivamente por el primer escaneo válido."
    });
    registerInventoryInScanIndex(store, inventory);
    addScannedInventoryToAvailability(store, inventory);
    if (registeredLabel) {
      label.state = "ESCANEADA";
      label.scannedAt = admittedAt;
      label.inventoryId = inventoryId;
      if (buncherLink.employeeId) setEmployeeId(label, buncherLink.employeeId, { role: "buncher", source: label.employeeLinkSource || "CATALOG_ID" });
      if (isMixed) {
        label.composition = composition;
        label.compositionConfirmedAt = admittedAt;
      }
    }
    writeCompactZebraRegistry(store.labelBatches);
    upsertPerformanceRecord(store, {
      date: bunchEntry.date,
      employeeId: buncherLink.employeeId,
      operationalWorkerId: buncherLink.operationalWorkerId,
      worker: label.buncher,
      activity: "EMBONCHADO",
      variety: label.variety,
      bunches: 1,
      stems: label.stemsPerBunch,
      workdayId: gate.workday.id,
      observation: "Rendimiento calculado desde escaneo valido dentro de la jornada activa."
    });
    const response = { ok: true, result: "INVENTARIO_CREADO", code, observation: `Ramo ${code} ingresado al inventario a las ${admittedAt}.`, event, label, inventory, entry: bunchEntry, labelId: label.id, inventoryId };
    store.ui.lastBunchIntakeResult = response;
    store.ui.bunchIntakeDraft = data.createBunchIntakeDraft({ responsible: inventory.responsible, code: "" });
    store.ui.mixedBunchIntakeDraft = null;
    setNotice(appState, response.observation, "success");
    saveDb();
    return attachDurableSync(response, { processRemote: false });
  }

  function resetBunchIntakeDraft(appState) {
    const store = ensureStore(appState);
    store.ui.bunchIntakeDraft = data.createBunchIntakeDraft({ code: "", responsible: store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState) });
    store.ui.lastBunchIntakeResult = null;
    store.ui.mixedBunchIntakeDraft = null;
    saveDb();
  }

  function updateMixedBunchCompositionLine(appState, lineIndex, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.mixedBunchIntakeDraft;
    const index = Math.max(0, Math.min(2, utils.parseNumber(lineIndex)));
    if (!draft?.lines?.[index] || !["block", "stems"].includes(field)) return false;
    draft.lines[index][field] = field === "stems" ? Math.max(0, utils.parseNumber(value)) : value;
    if (field === "block") {
      const normalizedBlock = String(value || "").trim().toUpperCase();
      const supplier = (store.masterData.suppliers || []).find(item =>
        item.active !== false && String(item.assignedBlock || "").trim().toUpperCase() === normalizedBlock
      );
      draft.lines[index].block = supplier?.assignedBlock || value;
      draft.lines[index].supplier = supplier?.name || "";
    }
    saveDb();
    return true;
  }

  function confirmMixedBunchIntakeLegacy(appState) {
    const store = ensureStore(appState);
    const draft = store.ui.mixedBunchIntakeDraft;
    const label = store.labelBatches.find(item => item.id === draft?.labelId && item.code === draft?.code);
    if (!draft || !label || label.labelType !== "MIXTA") {
      setNotice(appState, "No existe una etiqueta mixta pendiente de composicion.", "warning");
      return null;
    }
    const lines = draft.lines
      .map(item => ({ block: String(item.block || "").trim(), supplier: String(item.supplier || "").trim(), stems: utils.parseNumber(item.stems) }))
      .filter(item => item.block || item.supplier || item.stems > 0);
    if (!lines.length || lines.length > 3 || lines.some(item => !item.block || !item.supplier || item.stems <= 0)) {
      setNotice(appState, "Complete entre uno y tres bloques/proveedores con una cantidad de tallos mayor a cero.", "warning");
      return null;
    }
    const uniqueBlocks = new Set(lines.map(item => item.block.toUpperCase()));
    if (uniqueBlocks.size !== lines.length) {
      setNotice(appState, "Cada bloque debe aparecer una sola vez en la composicion del bonche mixto.", "warning");
      return null;
    }
    const total = lines.reduce((sum, item) => sum + item.stems, 0);
    if (total !== utils.parseNumber(draft.expectedStems)) {
      setNotice(appState, `La composicion suma ${total} tallos y debe sumar exactamente ${draft.expectedStems}.`, "warning");
      return null;
    }
    return scanBunchLabelIntoInventoryLegacy(appState, draft.code, {
      responsible: draft.responsible,
      observation: draft.observation,
      confirmedComposition: lines
    });
  }

  function cancelMixedBunchIntake(appState) {
    const store = ensureStore(appState);
    store.ui.mixedBunchIntakeDraft = null;
    store.ui.lastBunchIntakeResult = null;
    setNotice(appState, "Composicion mixta cancelada. La etiqueta sigue disponible y no se creo inventario.", "info");
    saveDb();
    return true;
  }

  function updateInventoryStateLegacy(appState, inventoryId, state) {
    const store = ensureStore(appState);
    const entry = store.roseInventory.find(item => item.inventoryId === inventoryId);
    if (!entry) return false;
    if (entry.assignedOrderId || entry.state === "ASIGNADO_CAJA") return false;
    entry.state = state;
    const permanentEntry = store.bunchEntries.find(item => item.inventoryId === inventoryId || normalizeBunchLabelCode(item.code) === normalizeBunchLabelCode(entry.labelCode));
    if (permanentEntry) permanentEntry.operationalState = state;
    refreshAvailabilityFromScannedInventory(store);
    saveDb();
    return true;
  }

  function propagateSimulationNotice(appState, shadowStore, fallback, tone = "warning") {
    const text = String(shadowStore?.ui?.notice || fallback || "No se pudo completar la operación.");
    setNotice(appState, text, shadowStore?.ui?.noticeTone || tone, false);
    return text;
  }

  function canonicalPayload(commandResult, entity, recordId = "") {
    const serverRecord = (commandResult?.records || []).find(record => (
      record.entity === entity && (!recordId || String(record.record_id) === String(recordId))
    ));
    return serverRecord?.payload ? {
      ...clone(serverRecord.payload),
      __syncVersion: Number(serverRecord.version || 1),
      __syncUpdatedAt: String(serverRecord.updated_at || ""),
      __syncUpdatedBy: String(serverRecord.updated_by || ""),
      __syncOperationId: String(serverRecord.last_operation_id || "")
    } : null;
  }

  async function registerReceptionConfirmed(appState) {
    const simulation = simulateLegacyMutation(appState, shadowState => {
      const draft = shadowState.db.operations.ui.receptionDraft;
      if (!draft.id) draft.id = uuid();
      const result = registerReceptionLegacy(shadowState);
      if (result && result.wasUpdated !== true) {
        const reception = shadowState.db.operations.receptions.find(item => item.id === result.id);
        if (reception) {
          reception.items = (reception.items || []).map(item => ({ ...item, id: uuid() }));
          result.items = reception.items;
        }
      }
      return result;
    });
    if (!simulation.result) {
      propagateSimulationNotice(appState, simulation.nextStore, "La recepción contiene datos inválidos.");
      return null;
    }

    const records = changedOperationRecords(simulation.baseStore, simulation.nextStore, [
      "operations_receptions",
      "operations_classifier_assignments",
      "operations_mesh_records",
      "operations_mesh_history"
    ]);
    const operationId = uuid();
    const persisted = await executeOperationsCommand("SAVE_RECEPTION", {
      receptionId: simulation.result.id,
      records
    }, { operationId });
    if (!persisted.ok) {
      setNotice(appState, persisted.message || "La recepción no fue confirmada por Supabase.", "danger", false);
      return { ok: false, confirmed: false, operationId, error: persisted.error, message: persisted.message };
    }

    applyConfirmedUiState(appState, simulation.nextStore, [
      "receptionDraft",
      "receptionItemDraft",
      "receptionHistoryMode",
      "receptionHistoryDate",
      "receptionHistoryMonth"
    ]);
    const reception = canonicalPayload(persisted, "operations_receptions", simulation.result.id);
    setNotice(appState, `Recepción confirmada en Supabase: ${reception?.id || simulation.result.id}.`, "success", false);
    return { ...reception, ok: true, confirmed: true, operationId, wasUpdated: simulation.result.wasUpdated === true };
  }

  async function registerClassifierAssignmentConfirmed(appState) {
    const simulation = simulateLegacyMutation(appState, shadowState => registerClassifierAssignmentLegacy(shadowState));
    if (!simulation.result) {
      propagateSimulationNotice(appState, simulation.nextStore, "La entrega al clasificador contiene datos inválidos.");
      return null;
    }
    const records = changedOperationRecords(simulation.baseStore, simulation.nextStore, [
      "operations_receptions",
      "operations_classifier_assignments",
      "operations_mesh_records",
      "operations_mesh_history",
      "operations_performances"
    ]);
    const operationId = uuid();
    const persisted = await executeOperationsCommand("ASSIGN_CLASSIFICATION", {
      deliveryGroupId: simulation.result.deliveryGroupId,
      assignmentIds: (simulation.result.entries || []).map(item => item.id),
      records
    }, { operationId });
    if (!persisted.ok) {
      setNotice(appState, persisted.message || "La entrega al clasificador fue rechazada por Supabase.", "danger", false);
      return { ok: false, confirmed: false, operationId, error: persisted.error, message: persisted.message };
    }
    applyConfirmedUiState(appState, simulation.nextStore, ["classificationAssignmentDraft", "classificationResultDraft", "classificationAssignmentSelectionConfirmed"]);
    const entry = canonicalPayload(persisted, "operations_classifier_assignments", simulation.result.id);
    setNotice(appState, `Entrega confirmada para ${entry?.classifier || simulation.result.classifier}.`, "success", false);
    return { ...entry, ok: true, confirmed: true, operationId, entries: simulation.result.entries };
  }

  async function registerClassificationResultConfirmed(appState) {
    const simulation = simulateLegacyMutation(appState, shadowState => {
      const result = registerClassificationResultLegacy(shadowState);
      if (!result) return result;
      const row = shadowState.db.operations.classificationResults.find(item => item.id === result.id);
      if (row) {
        const nextId = uuid();
        row.id = nextId;
        result.id = nextId;
      }
      return result;
    });
    if (!simulation.result) {
      propagateSimulationNotice(appState, simulation.nextStore, "El resultado de clasificación contiene datos inválidos.");
      return null;
    }
    const records = changedOperationRecords(simulation.baseStore, simulation.nextStore, [
      "operations_classification_results",
      "operations_classifier_assignments",
      "operations_performances"
    ]);
    const operationId = uuid();
    const persisted = await executeOperationsCommand("REGISTER_CLASSIFICATION_RESULT", {
      assignmentId: simulation.result.assignmentId,
      resultId: simulation.result.id,
      nationalStems: simulation.result.nationalStems,
      records
    }, { operationId });
    if (!persisted.ok) {
      setNotice(appState, persisted.message || "El resultado fue rechazado por Supabase.", "danger", false);
      return { ok: false, confirmed: false, operationId, error: persisted.error, message: persisted.message };
    }
    applyConfirmedUiState(appState, simulation.nextStore, ["classificationResultDraft"]);
    const result = canonicalPayload(persisted, "operations_classification_results", simulation.result.id);
    setNotice(appState, `Resultado de clasificación confirmado: ${result?.nationalStems || 0} tallos de nacional.`, "success", false);
    return { ...result, ok: true, confirmed: true, operationId };
  }

  function inventoryLogicalKey(inventory = {}) {
    return [
      String(inventory.variety || "").trim().toUpperCase(),
      String(utils.parseNumber(inventory.length)),
      String(inventory.quality || inventory.category || "EXPORTACION").trim().toUpperCase(),
      String(inventory.warehouse || "CUARTO FRIO 1").trim().toUpperCase(),
      String(inventory.location || "PENDIENTE UBICACION").trim().toUpperCase()
    ].join("|");
  }

  async function scanBunchLabelIntoInventoryConfirmed(appState, rawCode, options = {}) {
    const store = ensureStore(appState);
    const code = normalizeBunchLabelCode(rawCode);
    if (!/^\d{10}$/.test(code)) {
      const response = { ok: false, result: "FORMATO_INVALIDO", code, observation: "El código Zebra debe contener exactamente 10 dígitos." };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, response.observation, "warning", false, { toast: options.suppressToast !== true });
      return response;
    }
    const operationId = String(options.operationId || uuid());
    const persisted = await destinationV2Repository()?.receiveBunch?.(code, {
      responsible: options.responsible || store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState),
      observation: String(options.observation || "").trim()
    }, { operationId });
    if (!persisted?.ok) {
      const response = {
        ok: false,
        result: "ERROR_DE_SINCRONIZACION",
        code,
        observation: persisted?.message || "El ingreso no fue confirmado.",
        operationId,
        mode: String(persisted?.mode || ""),
        errorCode: String(persisted?.error?.code || "")
      };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, persisted?.message || "El ramo no fue confirmado por Supabase.", "danger", false, { toast: options.suppressToast !== true });
      return response;
    }

    const alreadyReceived = String(persisted.result?.status || "").toUpperCase() === "ALREADY_RECEIVED";
    const inventoryId = String(persisted.result?.inventoryId || "");
    const inventory = canonicalPayload(persisted, "operations_rose_inventory", inventoryId)
      || canonicalPayload(persisted, "operations_rose_inventory");
    const label = canonicalPayload(persisted, "operations_label_batches", String(persisted.result?.labelId || ""))
      || canonicalPayload(persisted, "operations_label_batches");
    const bunch = canonicalPayload(persisted, "operations_bunches", String(persisted.result?.bunchId || ""))
      || canonicalPayload(persisted, "operations_bunches");
    const response = {
      ok: !alreadyReceived,
      confirmed: true,
      result: alreadyReceived ? "DUPLICADO" : "INVENTARIO_CREADO",
      code,
      observation: alreadyReceived
        ? `La etiqueta ${code} ya había sido ingresada. El inventario no cambió.`
        : `Ramo ${code} confirmado en inventario a las ${persisted.serverTime || "hora del servidor"}.`,
      operationId,
      label,
      bunch,
      inventory,
      inventoryId: inventory?.inventoryId || inventoryId,
      bunchId: bunch?.bunchId || persisted.result?.bunchId || ""
    };
    store.ui.lastBunchIntakeResult = response;
    store.ui.bunchIntakeDraft = data.createBunchIntakeDraft({
      responsible: options.responsible || store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState),
      code: ""
    });
    store.ui.mixedBunchIntakeDraft = null;
    refreshAvailabilityFromScannedInventory(store);
    cacheSave();
    setNotice(appState, response.observation, alreadyReceived ? "warning" : "success", false, { toast: options.suppressToast !== true });
    return response;
  }

  async function confirmMixedBunchIntakeConfirmed(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.mixedBunchIntakeDraft);
    const label = (store.labelBatches || []).find(item => item.id === draft?.labelId && item.code === draft?.code);
    if (!draft || !label || label.labelType !== "MIXTA") {
      setNotice(appState, "No existe una etiqueta mixta pendiente de composición.", "warning", false);
      return null;
    }
    const lines = (draft.lines || [])
      .map(item => ({ block: String(item.block || "").trim(), supplier: String(item.supplier || "").trim(), stems: utils.parseNumber(item.stems) }))
      .filter(item => item.block || item.supplier || item.stems > 0);
    if (!lines.length || lines.length > 3 || lines.some(item => !item.block || !item.supplier || item.stems <= 0)) {
      setNotice(appState, "Complete entre uno y tres bloques/proveedores con tallos mayores a cero.", "warning", false);
      return null;
    }
    if (new Set(lines.map(item => item.block.toUpperCase())).size !== lines.length) {
      setNotice(appState, "Cada bloque debe aparecer una sola vez en la composición.", "warning", false);
      return null;
    }
    const total = lines.reduce((sum, item) => sum + item.stems, 0);
    if (total !== utils.parseNumber(draft.expectedStems)) {
      setNotice(appState, `La composición suma ${total} tallos y debe sumar ${draft.expectedStems}.`, "warning", false);
      return null;
    }
    return scanBunchLabelIntoInventoryConfirmed(appState, draft.code, {
      responsible: draft.responsible,
      observation: draft.observation,
      confirmedComposition: lines
    });
  }

  async function updateReceptionStatusConfirmed(appState, receptionId, status) {
    const simulation = simulateLegacyMutation(appState, shadowState => updateReceptionStatusLegacy(shadowState, receptionId, status));
    if (!simulation.result) return false;
    const records = changedOperationRecords(simulation.baseStore, simulation.nextStore, ["operations_receptions"]);
    const persisted = await executeOperationsCommand("UPDATE_RECEPTION_STATUS", { receptionId, status, records }, { operationId: uuid() });
    if (!persisted.ok) {
      setNotice(appState, persisted.message || "El estado de la recepción no fue confirmado.", "danger", false);
      return false;
    }
    setNotice(appState, `Recepción actualizada a ${status}.`, "success", false);
    return true;
  }

  async function updateInventoryStateConfirmed(appState, inventoryId, state) {
    const simulation = simulateLegacyMutation(appState, shadowState => updateInventoryStateLegacy(shadowState, inventoryId, state));
    if (!simulation.result) return false;
    const operationId = uuid();
    const previous = (simulation.baseStore.roseInventory || []).find(item => item.inventoryId === inventoryId) || {};
    const next = (simulation.nextStore.roseInventory || []).find(item => item.inventoryId === inventoryId) || {};
    simulation.nextStore.inventoryMovements = Array.isArray(simulation.nextStore.inventoryMovements) ? simulation.nextStore.inventoryMovements : [];
    simulation.nextStore.inventoryMovements.unshift({
      id: operationId,
      operationId,
      date: today(),
      dateTime: nowLabel(),
      movementType: "CAMBIO_ESTADO",
      direction: "NONE",
      sourceEntity: "operations_rose_inventory",
      sourceId: inventoryId,
      inventoryId,
      labelCode: next.labelCode || previous.labelCode || "",
      variety: next.variety || previous.variety || "",
      length: next.length || previous.length || 0,
      quality: next.quality || next.category || previous.quality || previous.category || "EXPORTACION",
      warehouse: next.warehouse || previous.warehouse || "",
      location: next.location || previous.location || "",
      stockKey: inventoryLogicalKey(next),
      bunches: 0,
      stems: 0,
      previousState: previous.state || "",
      nextState: next.state || state,
      user: getDemoUser(appState)
    });
    const records = changedOperationRecords(simulation.baseStore, simulation.nextStore, [
      "operations_rose_inventory",
      "operations_bunch_entries",
      "operations_inventory_movements"
    ]);
    const persisted = await executeOperationsCommand("UPDATE_INVENTORY_STATE", { inventoryId, state, records }, { operationId });
    if (!persisted.ok) {
      setNotice(appState, persisted.message || "El cambio de inventario no fue confirmado.", "danger", false);
      return false;
    }
    setNotice(appState, `Estado de inventario confirmado: ${state}.`, "success", false);
    return true;
  }

  // Mantiene compatibles los flujos estrictamente locales y los validadores
  // existentes. Con Supabase activo, cada mutación compartida pasa por el
  // comando V2 y devuelve una promesa que la interfaz debe esperar.
  function registerReception(appState) {
    return requiresConfirmedRemoteOperations()
      ? registerReceptionConfirmed(appState)
      : registerReceptionLegacy(appState);
  }

  function registerClassifierAssignment(appState) {
    return requiresConfirmedRemoteOperations()
      ? registerClassifierAssignmentConfirmed(appState)
      : registerClassifierAssignmentLegacy(appState);
  }

  function registerClassificationResult(appState) {
    return requiresConfirmedRemoteOperations()
      ? registerClassificationResultConfirmed(appState)
      : registerClassificationResultLegacy(appState);
  }

  function scanBunchLabelIntoInventory(appState, rawCode, options = {}) {
    return requiresConfirmedZebra()
      ? scanBunchLabelIntoInventoryConfirmed(appState, rawCode, options)
      : scanBunchLabelIntoInventoryLegacy(appState, rawCode, options);
  }

  function confirmMixedBunchIntake(appState) {
    return requiresConfirmedZebra()
      ? confirmMixedBunchIntakeConfirmed(appState)
      : confirmMixedBunchIntakeLegacy(appState);
  }

  function updateReceptionStatus(appState, receptionId, status) {
    return requiresConfirmedRemoteOperations()
      ? updateReceptionStatusConfirmed(appState, receptionId, status)
      : updateReceptionStatusLegacy(appState, receptionId, status);
  }

  function updateInventoryState(appState, inventoryId, state) {
    return requiresConfirmedRemoteOperations()
      ? updateInventoryStateConfirmed(appState, inventoryId, state)
      : updateInventoryStateLegacy(appState, inventoryId, state);
  }

  function findScannedInventoryByCode(appState, rawCode) {
    const store = ensureStore(appState);
    const code = normalizeBunchLabelCode(rawCode);
    if (!code) return null;
    if (requiresConfirmedRemoteOperations()) {
      return (store.roseInventory || []).find(item => (
        normalizeBunchLabelCode(item.labelCode || item.code) === code
      )) || null;
    }
    const reconciled = reconcilePermanentBunchInventories(store);
    return reconciled.inventoryByCode.get(code) || null;
  }

  function currentAvailability(appState) {
    if (BlessERP.operacionesAvailabilityDemo?.getAvailabilityByIdDemo) {
      return BlessERP.operacionesAvailabilityDemo.getAvailabilityByIdDemo(appState, ensureStore(appState).ui.selectedAvailabilityId);
    }
    const store = ensureStore(appState);
    return (store.availabilityDemo || []).find(item => item.availability_id === store.ui.selectedAvailabilityId) || null;
  }

  function simulateScan(appState, overrides = {}) {
    const store = ensureStore(appState);
    const draft = { ...clone(store.ui.scannerDraft), ...overrides };
    const service = BlessERP.operacionesScannerDemo;
    const event = service?.scanCodeDemo
      ? service.scanCodeDemo(draft.code, {
          appState,
          tipo_codigo: draft.tipo_codigo || draft.type,
          modulo_origen: draft.moduleOrigin,
          pedido_id: draft.pedido_id,
          observacion: draft.observation
        })
      : {
          eventId: uid("SCN-OPS"),
          dateTime: new Date().toISOString().replace("T", " ").slice(0, 16),
          code: String(draft.code || "SIN-CODIGO").trim(),
          type: draft.type,
          moduleOrigin: draft.moduleOrigin,
          result: "LEIDO_DEMO",
          user: appState.db.session?.activeUser?.name || "Usuario demo",
          observation: draft.observation || "Escaneo simulado."
        };
    if (!service?.scanCodeDemo) {
      store.scannerEvents.unshift(event);
    }
    store.ui.scannerDraft = data.createScannerDraft({
      type: draft.type,
      moduleOrigin: draft.moduleOrigin
    });
    saveDb();
    return event;
  }

  function clearScannerEventsDemo(appState) {
    const result = BlessERP.operacionesScannerDemo?.clearScannerEventsDemo
      ? BlessERP.operacionesScannerDemo.clearScannerEventsDemo(appState)
      : { ok: false, cleared: 0 };
    if (result.ok) {
      setNotice(appState, `Eventos de scanner demo limpiados: ${result.cleared}.`, "info");
    }
    saveDb();
    return result;
  }

  function simulateConsumptionDemo(appState, pedidoId) {
    const result = BlessERP.operacionesConsumptionDemo?.simulateConsumptionFromDispatchDemo
      ? BlessERP.operacionesConsumptionDemo.simulateConsumptionFromDispatchDemo(appState, pedidoId)
      : { ok: false, error: "Servicio demo de consumo no disponible." };
    if (result.ok) {
      setNotice(appState, `Consumo demo simulado para ${result.consumptions?.length || 0} linea(s). No descuenta inventario real.`, "success");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function reverseConsumptionDemo(appState, pedidoId, motivo = "") {
    const result = BlessERP.operacionesConsumptionDemo?.reverseConsumptionDemo
      ? BlessERP.operacionesConsumptionDemo.reverseConsumptionDemo(appState, pedidoId, motivo)
      : { ok: false, error: "Servicio demo de consumo no disponible." };
    if (result.ok) {
      setNotice(appState, `Consumo demo revertido para ${result.consumptions?.length || 0} linea(s).`, "info");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function startHidScannerDemo(appState) {
    const result = BlessERP.operacionesHidScannerDemo?.startHidScannerDemo
      ? BlessERP.operacionesHidScannerDemo.startHidScannerDemo()
      : { active: false };
    setNotice(appState, "Modo HID demo activo. Enfoque el campo y presione Enter tras el codigo.", "info");
    saveDb();
    return result;
  }

  function stopHidScannerDemo(appState) {
    const result = BlessERP.operacionesHidScannerDemo?.stopHidScannerDemo
      ? BlessERP.operacionesHidScannerDemo.stopHidScannerDemo()
      : { active: false };
    setNotice(appState, "Modo HID demo detenido. No hay lector real conectado.", "warning");
    saveDb();
    return result;
  }

  function clearHidScannerInputDemo(appState) {
    const store = ensureStore(appState);
    store.ui.scannerHidInput = "";
    if (BlessERP.operacionesHidScannerDemo?.createHidScannerSessionDemo) {
      const status = BlessERP.operacionesHidScannerDemo.getHidScannerStatusDemo?.() || {};
      BlessERP.operacionesHidScannerDemo.createHidScannerSessionDemo({
        active: Boolean(status.active),
        reason: "Campo HID demo limpiado."
      });
    }
    setNotice(appState, "Prueba HID demo reiniciada.", "info");
    saveDb();
    return true;
  }

  function processHidScannerInputDemo(appState, rawValue, context = {}) {
    const store = ensureStore(appState);
    const adapter = BlessERP.operacionesHidScannerDemo;
    const scanner = BlessERP.operacionesScannerDemo;
    if (!adapter?.handleHidInputDemo) {
      setNotice(appState, "Adaptador HID demo no disponible.", "warning");
      return { ok: false };
    }

    const hidEvent = adapter.handleHidInputDemo(rawValue, context);
    if (!hidEvent.normalized_value) {
      setNotice(appState, "Ingrese un codigo demo antes de procesar Enter.", "warning");
      store.ui.scannerHidInput = "";
      saveDb();
      return { ok: false, hidEvent };
    }

    const scanEvent = scanner?.scanCodeDemo
      ? scanner.scanCodeDemo(hidEvent.normalized_value, {
          appState,
          tipo_codigo: context.tipo_codigo,
          modulo_origen: "Operaciones / Scanner Zebra HID demo",
          pedido_id: context.pedido_id,
          observacion: "Entrada procesada desde campo HID demo."
        })
      : null;

    if (scanEvent) {
      adapter.handleHidInputDemo(rawValue, {
        ...context,
        result: scanEvent.resultado || scanEvent.result || "LEIDO_DEMO"
      });
      setNotice(
        appState,
        `HID demo procesado: ${scanEvent.codigo || hidEvent.normalized_value} -> ${scanEvent.resultado || scanEvent.result || "LEIDO_DEMO"}.`,
        scanEvent.resultado === "NO_ENCONTRADO" ? "warning" : "success"
      );
    }

    store.ui.scannerHidInput = "";
    saveDb();
    return { ok: true, hidEvent, scanEvent };
  }

  function scanBoxForDispatchDemo(appState, pedidoId, codigo) {
    const result = BlessERP.operacionesScannerDemo?.scanBoxForDispatchDemo
      ? BlessERP.operacionesScannerDemo.scanBoxForDispatchDemo(appState, codigo, pedidoId)
      : { resultado: "ERROR_DEMO", observacion: "Servicio scanner demo no disponible." };
    const tone = result.resultado === "VALIDADO_DEMO"
      ? "success"
      : result.resultado === "DUPLICADO"
        ? "warning"
        : "warning";
    setNotice(appState, `${result.codigo || codigo}: ${result.observacion || result.resultado}`, tone);
    saveDb();
    return result;
  }

  function scanAllBoxesForDispatchDemo(appState, pedidoId) {
    const result = BlessERP.operacionesScannerDemo?.scanAllBoxesForDispatchDemo
      ? BlessERP.operacionesScannerDemo.scanAllBoxesForDispatchDemo(appState, pedidoId)
      : { ok: false, scanned: 0 };
    setNotice(appState, `Escaneo demo masivo completado: ${result.scanned || 0} caja(s).`, "info");
    saveDb();
    return result;
  }

  function resetBoxScansForOrderDemo(appState, pedidoId) {
    const result = BlessERP.operacionesScannerDemo?.resetBoxScansForOrderDemo
      ? BlessERP.operacionesScannerDemo.resetBoxScansForOrderDemo(appState, pedidoId)
      : { ok: false, cleared: 0 };
    setNotice(appState, `Escaneos demo reiniciados para pedido: ${result.cleared || 0}.`, "info");
    saveDb();
    return result;
  }

  function updateDispatchState(appState, dispatchId, state) {
    const store = ensureStore(appState);
    const entry = store.dispatches.find(item => item.id === dispatchId);
    if (!entry) return false;
    entry.state = state;
    entry.estado_despacho = state;
    saveDb();
    return true;
  }

  function prepareDispatchDemo(appState, pedidoId) {
    const result = BlessERP.operacionesDispatchDemo?.prepareDispatchFromOrderDemo
      ? BlessERP.operacionesDispatchDemo.prepareDispatchFromOrderDemo(appState, pedidoId)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Despacho demo preparado. No afecta inventario real.", "info");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function markDispatchReady(appState, pedidoId) {
    const result = BlessERP.operacionesDispatchDemo?.markDispatchReadyDemo
      ? BlessERP.operacionesDispatchDemo.markDispatchReadyDemo(appState, pedidoId)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Pedido marcado como listo para despacho demo.", "success");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function confirmDispatchDemo(appState, pedidoId, payload = {}) {
    const result = BlessERP.operacionesDispatchDemo?.confirmDispatchDemo
      ? BlessERP.operacionesDispatchDemo.confirmDispatchDemo(appState, pedidoId, payload)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Despacho demo confirmado. No descuenta inventario real.", "success");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function observeDispatchDemo(appState, pedidoId, motivo = "") {
    const result = BlessERP.operacionesDispatchDemo?.observeDispatchDemo
      ? BlessERP.operacionesDispatchDemo.observeDispatchDemo(appState, pedidoId, motivo)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Despacho demo marcado como observado.", "warning");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function cancelDispatchDemo(appState, pedidoId, motivo = "") {
    const result = BlessERP.operacionesDispatchDemo?.cancelDispatchDemo
      ? BlessERP.operacionesDispatchDemo.cancelDispatchDemo(appState, pedidoId, motivo)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Despacho demo anulado.", "warning");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function reopenDispatchDemo(appState, pedidoId, motivo = "") {
    const result = BlessERP.operacionesDispatchDemo?.reopenDispatchDemo
      ? BlessERP.operacionesDispatchDemo.reopenDispatchDemo(appState, pedidoId, motivo)
      : { ok: false, error: "Servicio de despacho demo no disponible." };
    if (result.ok) {
      setNotice(appState, "Despacho demo reabierto en preparacion.", "info");
    } else if (result.error) {
      setNotice(appState, result.error, "warning");
    }
    saveDb();
    return result;
  }

  function releaseAvailabilityReservation(appState, reservationId) {
    const reservation = BlessERP.operacionesAvailabilityDemo?.releaseReservationDemo
      ? BlessERP.operacionesAvailabilityDemo.releaseReservationDemo(appState, reservationId)
      : null;
    if (!reservation) return false;

    const order = BlessERP.comercialState?.findOrder
      ? BlessERP.comercialState.findOrder(appState, reservation.orderId || reservation.pedido_id)
      : null;

    if (order && BlessERP.comercialWorkflow?.recordEvent) {
      BlessERP.comercialWorkflow.recordEvent(order, appState, {
        action: "LIBERAR_RESERVA",
        actionLabel: "Liberar reserva",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Reserva demo liberada desde Operaciones para ${reservation.variety || reservation.variedad} ${reservation.length || reservation.longitud} cm.`,
        result: "exitoso"
      });
    }

    setNotice(appState, "Reserva demo liberada desde Operaciones. El saldo comercial disponible fue restaurado.", "success");
    saveDb();
    return reservation;
  }

  BlessERP.operacionesState = {
    addOrUpdateReceptionItem,
    currentAvailability,
    deleteParameter,
    deriveInventoryAgeDays,
    editParameter,
    editReception,
    editReceptionItem,
    getStore,
    getUi,
    getYieldRegistrationGate,
    getYieldWorkdaySummary,
    getReceptionClassificationProgress,
    getReceptionQueue,
    listPayrollEmployees,
    linkOperationalCatalogEmployee,
    migrateLegacyEmployeeLinks,
    resolveCatalogEmployee,
    syncCatalogsFromMasterData,
    syncPayrollPerformanceEntries,
    generateLabelBatch,
    markDispatchReady,
    prepareDispatchDemo,
    registerReception,
    registerClassifierAssignment,
    registerClassificationResult,
    registerYieldBunchEntry,
    registerYieldMeshProcessing,
    archiveProcessedMesh,
    canEditProcessedMeshHistory,
    openMeshHistoryDialog,
    closeMeshHistoryDialog,
    saveMeshHistoryEdit,
    annulProcessedMeshHistory,
    applyMeshHistoryFilters,
    resetLabelDraft,
    resetBunchIntakeDraft,
    beginClassificationAssignmentSearch,
    resetClassificationAssignmentDraft,
    resetClassificationResultDraft,
    resetParameterDraft,
    resetReceptionDraft,
    resetReceptionItemDraft,
    resetYieldMeshDraft,
    resetYieldScannerDraft,
    reviewClassification,
    cancelDispatchDemo,
    confirmDispatchDemo,
    reopenDispatchDemo,
    setNotice,
    setUiValue,
    simulateScan,
    clearScannerEventsDemo,
    clearHidScannerInputDemo,
    confirmMixedBunchIntake,
    cancelMixedBunchIntake,
    scanBoxForDispatchDemo,
    scanAllBoxesForDispatchDemo,
    resetBoxScansForOrderDemo,
    processHidScannerInputDemo,
    startHidScannerDemo,
    stopHidScannerDemo,
    observeDispatchDemo,
    releaseAvailabilityReservation,
    removeReceptionItem,
    removeBunchSearchRows,
    deleteBunchSearchRows,
    saveParameter,
    registerPrintedZebraLabels,
    scanBunchLabelIntoInventory,
    findScannedInventoryByCode,
    selectBunchSearchRows,
    setVisibleBunchSearchRowsSelection,
    setBunchReaderConnection,
    reverseConsumptionDemo,
    simulateConsumptionDemo,
    synchronizeAvailabilityFromInventory,
    updateDispatchState,
    updateDraftField,
    updateBunchSearchLengths,
    updateMixedBunchCompositionLine,
    updateInventoryState,
    updateLabelState,
    toggleParameter,
    updateReceptionStatus,
    toggleBunchSearchSelection,
    addBunchToSearch,
    updateYieldWorkday
  };
})();
