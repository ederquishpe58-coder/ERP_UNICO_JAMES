(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.operacionesData;
  const utils = BlessERP.operacionesUtils;
  const { clone, uid, today } = BlessERP.utils;

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
    BlessERP.state.saveDb();
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
      varieties: "varieties",
      lengths: "lengths",
      stemTypes: "stemTypes",
      labelTypes: "labelTypes"
    };
    Object.entries(map).forEach(([catalogKey, masterKey]) => {
      const values = activeMasterNames(store, masterKey);
      if (values.length) store.catalogs[catalogKey] = values;
    });
  }

  function appendMissingValidationRows(target, baseRows, idKey, codeKey) {
    const ids = new Set((target || []).map(item => item[idKey]).filter(Boolean));
    const codes = new Set((target || []).map(item => item[codeKey]).filter(Boolean));
    const missing = (baseRows || []).filter(item => (
      item.demoValidationSeed && !ids.has(item[idKey]) && !codes.has(item[codeKey])
    ));
    if (missing.length) target.push(...clone(missing));
  }

  function refreshAvailabilityFromScannedInventory(store) {
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
          edad_dias: item.ageDays || 0,
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

  function normalizeOperationalStore(store, base) {
    store.labelBatches = Array.isArray(store.labelBatches) ? store.labelBatches : [];
    store.roseInventory = Array.isArray(store.roseInventory) ? store.roseInventory : [];
    store.bunchEntries = Array.isArray(store.bunchEntries) ? store.bunchEntries : [];
    appendMissingValidationRows(store.labelBatches, base.labelBatches, "id", "code");
    appendMissingValidationRows(store.roseInventory, base.roseInventory, "inventoryId", "labelCode");
    appendMissingValidationRows(store.bunchEntries, base.bunchEntries, "id", "code");
    store.masterData = store.masterData || data.createMasterData();
    const baseMasterData = data.createMasterData();
    Object.entries(baseMasterData).forEach(([type, rows]) => {
      if (!Array.isArray(store.masterData[type])) store.masterData[type] = rows;
    });
    (store.masterData.suppliers || []).forEach((supplier, index) => {
      const baseSupplier = baseMasterData.suppliers.find(item => item.name === supplier.name) || baseMasterData.suppliers[index];
      supplier.assignedBlock = supplier.assignedBlock || baseSupplier?.assignedBlock || store.catalogs.blocks[index] || "SIN BLOQUE";
    });
    store.sequences = store.sequences || { bunchLabel: 1 };
    const numericCodes = (store.labelBatches || [])
      .map(item => /^\d{10}$/.test(String(item.code || "")) ? Number(item.code) : 0);
    const currentSequence = Math.max(utils.parseNumber(store.sequences.bunchLabel, 1), 1);
    const nextAfterExisting = Math.max(...numericCodes, 0) + 1;
    store.sequences.bunchLabel = Math.max(currentSequence, nextAfterExisting);
    if (store.sequences.bunchLabel < 1) store.sequences.bunchLabel = 1;
    store.classifierAssignments = Array.isArray(store.classifierAssignments) ? store.classifierAssignments : [];
    store.classificationResults = Array.isArray(store.classificationResults) ? store.classificationResults : [];
    store.ui.parameterDraft = store.ui.parameterDraft || data.createParameterDraft();
    store.ui.receptionItemDraft = store.ui.receptionItemDraft || data.createReceptionItemDraft();
    store.ui.receptionHistorySupplier = store.ui.receptionHistorySupplier || "";
    store.ui.receptionHistoryBlock = store.ui.receptionHistoryBlock || "";
    store.ui.receptionHistoryVariety = store.ui.receptionHistoryVariety || "";
    store.ui.receptionHistoryStatus = ["PENDIENTE", "PARCIAL", "COMPLETA"].includes(store.ui.receptionHistoryStatus)
      ? store.ui.receptionHistoryStatus
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
    store.ui.lastBunchIntakeResult = store.ui.lastBunchIntakeResult || null;
    store.ui.mixedBunchIntakeDraft = store.ui.mixedBunchIntakeDraft || null;
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
    store.ui.scannerTechnicalTab = store.ui.scannerTechnicalTab || "diagnostico";
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
    if (!(store.labelBatches || []).some(label => /^\d{10}$/.test(String(label.code || "")))) {
      store.labelBatches.unshift(...clone((base.labelBatches || []).filter(label => /^\d{10}$/.test(String(label.code || "")))));
    }
    if (!(store.roseInventory || []).some(item => item.sourceScannerEventId && /^\d{10}$/.test(String(item.labelCode || "")))) {
      store.roseInventory.unshift(...clone(base.roseInventory || []));
      const seededEntryIds = new Set((store.bunchEntries || []).map(item => item.id));
      store.bunchEntries.unshift(...clone((base.bunchEntries || []).filter(item => !seededEntryIds.has(item.id))));
      const seededEventIds = new Set((store.scannerEvents || []).map(item => item.eventId));
      store.scannerEvents.unshift(...clone((base.scannerEvents || []).filter(item => item.code === "0000000001" && !seededEventIds.has(item.eventId))));
    }
    (store.labelBatches || []).forEach(label => {
      label.createdAt = label.createdAt || `${label.date || today()} 00:00`;
      label.inventoryId = label.inventoryId || "";
      label.printCount = utils.parseNumber(label.printCount, label.state?.includes("IMP") ? 1 : 0);
      if (!/^\d{10}$/.test(String(label.code || ""))) label.legacyCode = true;
    });
    (store.roseInventory || []).forEach(item => {
      item.admittedAt = item.admittedAt || `${item.date || today()} 00:00`;
      item.labelCode = item.labelCode || (store.labelBatches || []).find(label => label.id === item.sourceLabelId)?.code || "";
      item.sourceType = item.sourceScannerEventId && /^\d{10}$/.test(String(item.labelCode || ""))
        ? "ESCANEO_ETIQUETA"
        : "LEGACY_DEMO";
      const admittedDate = new Date(String(item.admittedAt).replace(" ", "T"));
      item.ageDays = Number.isNaN(admittedDate.getTime())
        ? utils.parseNumber(item.ageDays)
        : Math.max(0, Math.floor((Date.now() - admittedDate.getTime()) / 86400000));
      item.assignedOrderId = item.assignedOrderId || "";
      item.assignedBoxNumber = item.assignedBoxNumber || "";
      item.assignedLineId = item.assignedLineId || "";
      item.assignedAt = item.assignedAt || "";
    });
    syncCatalogsFromMasterData(store);
    refreshAvailabilityFromScannedInventory(store);
  }

  function ensureStore(appState) {
    const base = data.createOperationsStore();
    appState.db.operations = mergeMissing(base, appState.db.operations || {});
    const store = appState.db.operations;
    normalizeOperationalStore(store, base);
    store.ui.receptionDraft.items = Array.isArray(store.ui.receptionDraft.items) ? store.ui.receptionDraft.items : [];
    store.ui.receptionDraft.totalDeclared = store.ui.receptionDraft.items.reduce((sum, item) => sum + utils.calculateReceptionTotal(item), 0);
    store.availabilityDemo = Array.isArray(store.availabilityDemo) ? store.availabilityDemo : [];
    store.demoReservations = Array.isArray(store.demoReservations) ? store.demoReservations : [];
    const hasSelectedAvailability = store.availabilityDemo.some(item => item.availability_id === store.ui.selectedAvailabilityId);
    if (!hasSelectedAvailability) {
      store.ui.selectedAvailabilityId = store.availabilityDemo[0]?.availability_id || "";
    }
    if (!String(store.ui.selectedDispatchOrderId || "").trim()) {
      store.ui.selectedDispatchOrderId = "order-demo-0001";
    }
    store.ui.dispatchViewMode = store.ui.dispatchViewMode || "list";
    store.ui.dispatchDetailTab = store.ui.dispatchDetailTab || "boxes";
    store.ui.dispatchAssemblyBoxNumber = utils.parseNumber(store.ui.dispatchAssemblyBoxNumber, 1);
    store.ui.dispatchBunchScanCode = store.ui.dispatchBunchScanCode || "";
    store.ui.dispatchLastBunchScan = store.ui.dispatchLastBunchScan || null;
    const pendingReceptionLines = receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
      .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
      .map(item => ({ ...item, receptionId: reception.id, supplier: reception.supplier, block: reception.block })));
    const assignmentDraft = store.ui.classificationAssignmentDraft;
    let selectedPendingLine = pendingReceptionLines.find(item => item.block === assignmentDraft.block && item.variety === assignmentDraft.variety);
    if (!selectedPendingLine) {
      selectedPendingLine = pendingReceptionLines[0];
      assignmentDraft.supplier = selectedPendingLine?.supplier || "";
      assignmentDraft.block = selectedPendingLine?.block || "";
      assignmentDraft.variety = selectedPendingLine?.variety || "";
    }
    assignmentDraft.receptionId = selectedPendingLine?.receptionId || "";
    assignmentDraft.receptionItemId = selectedPendingLine?.id || "";
    const resultDraft = store.ui.classificationResultDraft;
    const selectedResultAssignment = (store.classifierAssignments || []).find(item => item.id === resultDraft.assignmentId && item.status === "ENTREGADO");
    if (selectedResultAssignment) {
      resultDraft.supplier = selectedResultAssignment.supplier || "";
      resultDraft.block = selectedResultAssignment.block || "";
      resultDraft.classifier = selectedResultAssignment.classifier || "";
      resultDraft.variety = selectedResultAssignment.variety || "";
    } else {
      const latest = pendingClassificationAssignments(store)[0];
      resultDraft.assignmentId = latest?.id || "";
      resultDraft.supplier = latest?.supplier || "";
      resultDraft.block = latest?.block || "";
      resultDraft.classifier = latest?.classifier || "";
      resultDraft.variety = latest?.variety || "";
    }
    return store;
  }

  function getStore(appState) {
    return ensureStore(appState);
  }

  function getUi(appState) {
    return ensureStore(appState).ui;
  }

  function setNotice(appState, text, tone = "info") {
    const store = ensureStore(appState);
    store.ui.notice = text || "";
    store.ui.noticeTone = tone;
    saveDb();
  }

  function pendingClassificationAssignments(store) {
    return (store.classifierAssignments || [])
      .filter(item => item.status === "ENTREGADO")
      .slice()
      .sort((left, right) => String(right.dateTime || "").localeCompare(String(left.dateTime || "")));
  }

  function findLatestPendingAssignment(store, draft = {}) {
    return pendingClassificationAssignments(store).find(item => (
      (!draft.block || item.block === draft.block) &&
      (!draft.supplier || item.supplier === draft.supplier) &&
      (!draft.classifier || item.classifier === draft.classifier) &&
      (!draft.variety || item.variety === draft.variety)
    ));
  }

  function syncClassificationResultDraft(store, draft, changedField = "") {
    const pending = pendingClassificationAssignments(store);
    let candidates = pending;
    if (changedField === "block") {
      const normalizedBlock = String(draft.block || "").trim().toUpperCase();
      const latest = pending.find(item => String(item.block || "").trim().toUpperCase() === normalizedBlock);
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
        draft.block = selectedBlockLine?.block || value;
        draft.supplier = selectedBlockLine?.supplier || "";
      }
      const blockLines = pendingLines.filter(item => item.block === draft.block);
      if (["block", "supplier"].includes(field) && !blockLines.some(item => item.variety === draft.variety)) {
        draft.variety = blockLines[0]?.variety || "";
      }
      const selectedLine = blockLines.find(item => item.variety === draft.variety);
      draft.receptionId = selectedLine?.receptionId || "";
      draft.receptionItemId = selectedLine?.id || "";
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

  function receptionProgressFromStore(store, reception) {
    const activeAssignments = (store.classifierAssignments || []).filter(item => item.status !== "ANULADO");
    const lines = (reception?.items || []).map(item => {
      const classifiedStems = activeAssignments
        .filter(assignment => assignment.receptionItemId === item.id)
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
    const worker = String(payload.worker || "").trim() || "Sin responsable";
    const activity = String(payload.activity || "").trim() || "OTRO";
    const variety = String(payload.variety || "").trim() || "SIN VARIEDAD";
    let entry = (store.performances || []).find(item => (
      item.date === keyDate &&
      String(item.worker || "").trim() === worker &&
      String(item.activity || "").trim() === activity &&
      String(item.variety || "").trim() === variety
    ));

    if (!entry) {
      entry = {
        id: uid("REN-OPS"),
        date: keyDate,
        worker,
        activity,
        variety,
        bunches: 0,
        stems: 0,
        performancePerHour: 0,
        observation: payload.observation || "Registro operativo demo."
      };
      store.performances.unshift(entry);
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

  function updateYieldWorkday(appState, status) {
    const store = ensureStore(appState);
    const workday = store.yieldWorkday || data.createYieldWorkday();
    workday.date = workday.date || today();
    workday.status = status;
    if (status === "EN_CURSO_DEMO" && !workday.startedAt) {
      workday.startedAt = nowLabel();
      workday.observation = "Jornada demo iniciada.";
    }
    if (status === "PAUSADA_DEMO") {
      workday.pausedAt = nowLabel();
      workday.observation = "Jornada demo pausada.";
    }
    if (status === "REANUDADA_DEMO") {
      workday.resumedAt = nowLabel();
      workday.status = "EN_CURSO_DEMO";
      workday.observation = "Jornada demo reanudada.";
    }
    if (status === "CERRADA_DEMO") {
      workday.endedAt = nowLabel();
      workday.observation = "Jornada demo cerrada.";
    }
    store.yieldWorkday = workday;
    setNotice(appState, `Jornada de rendimientos actualizada: ${workday.status}.`, status === "CERRADA_DEMO" ? "warning" : "info");
    saveDb();
    return workday;
  }

  function nextBunchLabelCode(store) {
    const sequence = Math.max(1, utils.parseNumber(store.sequences?.bunchLabel, 1));
    store.sequences.bunchLabel = sequence + 1;
    return String(sequence).padStart(10, "0");
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
    if (!store.masterData?.[type] || !name) {
      setNotice(appState, "Seleccione un tipo e ingrese el nombre del parametro.", "warning");
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
      Object.assign(entry, {
        code: draft.code || entry.code,
        name,
        assignedBlock: type === "suppliers" ? String(draft.assignedBlock || "").trim() : "",
        active: draft.active !== false,
        observation: draft.observation || ""
      });
    } else {
      entry = {
        id: uid(`PAR-${type.slice(0, 3).toUpperCase()}`),
        code: String(draft.code || `${type.slice(0, 3).toUpperCase()}-${store.masterData[type].length + 1}`).trim().toUpperCase(),
        name,
        assignedBlock: type === "suppliers" ? String(draft.assignedBlock || "").trim() : "",
        active: true,
        observation: draft.observation || ""
      };
      store.masterData[type].push(entry);
    }
    syncCatalogsFromMasterData(store);
    store.ui.parameterType = type;
    store.ui.parameterDraft = data.createParameterDraft({ type });
    setNotice(appState, `Parametro guardado: ${entry.name}.`, "success");
    saveDb();
    return { ok: true, entry };
  }

  function toggleParameter(appState, type, id) {
    const store = ensureStore(appState);
    const entry = (store.masterData?.[type] || []).find(item => item.id === id);
    if (!entry) return false;
    entry.active = !entry.active;
    syncCatalogsFromMasterData(store);
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
      setNotice(appState, "El parametro tiene historial y fue desactivado, no eliminado.", "warning");
      saveDb();
      return true;
    }
    store.masterData[type] = list.filter(item => item.id !== id);
    syncCatalogsFromMasterData(store);
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

  function registerReception(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.receptionDraft);
    const items = (draft.items || []).map(item => ({
      ...item,
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
    const existing = draft.id ? store.receptions.find(item => item.id === draft.id) : null;
    const entry = existing || { id: uid("REC-OPS"), createdAt: nowLabel(), status: "RECIBIDO" };
    Object.assign(entry, {
      ...draft,
      id: entry.id,
      items,
      responsible: draft.receptionist,
      variety: first.variety,
      stemType: first.stemType,
      meshCount: items.reduce((sum, item) => sum + utils.parseNumber(item.meshCount), 0),
      stemsPerMesh: first.stemsPerMesh,
      extraStems: items.reduce((sum, item) => sum + utils.parseNumber(item.extraStems), 0),
      totalDeclared,
      status: existing?.status || "RECIBIDO",
      updatedAt: nowLabel()
    });
    if (!existing) store.receptions.unshift(entry);
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
    return { ...entry, wasUpdated: Boolean(existing) };
  }

  function resetClassificationAssignmentDraft(appState) {
    const store = ensureStore(appState);
    const queue = receptionQueueFromStore(store);
    const reception = queue.find(item => item.classificationProgress.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(item.status));
    const receptionItem = reception?.classificationProgress.lines.find(item => item.pendingStems > 0);
    store.ui.classificationAssignmentDraft = data.createClassificationAssignmentDraft({
      receptionId: reception?.id || "",
      receptionItemId: receptionItem?.id || "",
      supplier: reception?.supplier || "",
      block: reception?.block || "",
      variety: receptionItem?.variety || "",
      classifier: store.catalogs.classifiers[0] || ""
    });
    saveDb();
  }

  function registerClassifierAssignment(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.classificationAssignmentDraft);
    const selectedPending = receptionQueueFromStore(store).flatMap(reception => reception.classificationProgress.lines
      .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
      .map(item => ({ reception, item })))
      .find(entry => entry.reception.block === draft.block && entry.item.variety === draft.variety);
    const reception = selectedPending?.reception;
    const receptionItem = selectedPending?.item;
    if (!reception || !receptionItem || !draft.classifier || utils.parseNumber(draft.meshCount) <= 0) {
      setNotice(appState, "Seleccione bloque, variedad, clasificador y una cantidad de mallas mayor a cero. Debe existir saldo pendiente en Recepcion.", "warning");
      return null;
    }
    const totalStems = (utils.parseNumber(draft.meshCount) * utils.parseNumber(receptionItem.stemsPerMesh)) + utils.parseNumber(draft.extraStems);
    const progressBefore = receptionProgressFromStore(store, reception);
    const lineProgress = progressBefore.lines.find(item => item.id === receptionItem.id);
    if (totalStems > utils.parseNumber(lineProgress?.pendingStems)) {
      setNotice(appState, `La entrega supera el saldo pendiente de ${utils.parseNumber(lineProgress?.pendingStems)} tallos para ${receptionItem.variety}.`, "warning");
      return null;
    }
    const entry = {
      id: uid("ASG-OPS"),
      receptionId: reception.id,
      receptionItemId: receptionItem.id,
      dateTime: nowLabel(),
      classifier: draft.classifier,
      supplier: reception.supplier,
      block: reception.block,
      variety: receptionItem.variety,
      stemType: receptionItem.stemType || "LARGO",
      meshCount: utils.parseNumber(draft.meshCount),
      stemsPerMesh: utils.parseNumber(receptionItem.stemsPerMesh),
      extraStems: utils.parseNumber(draft.extraStems),
      totalStems,
      nationalStems: 0,
      exportableStems: totalStems,
      status: "ENTREGADO",
      observation: draft.observation || "Flor entregada al clasificador."
    };
    store.classifierAssignments.unshift(entry);
    reception.status = "EN_CLASIFICACION";
    store.meshProcessingRecords.unshift({
      id: uid("MALLA-OPS"),
      date: today(),
      supplier: entry.supplier,
      block: entry.block,
      variety: entry.variety,
      classifier: entry.classifier,
      responsible: getDemoUser(appState),
      meshCount: entry.meshCount,
      extraStems: entry.extraStems,
      totalStems: entry.totalStems,
      status: "ENTREGADA_CLASIFICACION",
      observation: entry.observation,
      registeredAt: entry.dateTime,
      assignmentId: entry.id
    });
    store.ui.classificationResultDraft = data.createClassificationResultDraft({
      assignmentId: entry.id,
      supplier: entry.supplier,
      block: entry.block,
      classifier: entry.classifier,
      variety: entry.variety
    });
    if (receptionProgressFromStore(store, reception).pendingStems === 0) reception.status = "CERRADO";
    resetClassificationAssignmentDraft(appState);
    setNotice(appState, `Flor entregada a ${entry.classifier}: ${entry.meshCount} mallas / ${entry.totalStems} tallos.`, "success");
    saveDb();
    return entry;
  }

  function resetClassificationResultDraft(appState) {
    const store = ensureStore(appState);
    const assignment = pendingClassificationAssignments(store)[0];
    store.ui.classificationResultDraft = data.createClassificationResultDraft({
      assignmentId: assignment?.id || "",
      supplier: assignment?.supplier || "",
      block: assignment?.block || "",
      classifier: assignment?.classifier || "",
      variety: assignment?.variety || ""
    });
    saveDb();
  }

  function registerClassificationResult(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.classificationResultDraft);
    const assignment = findLatestPendingAssignment(store, draft);
    const nationalStems = utils.parseNumber(draft.nationalStems);
    if (!assignment || nationalStems < 0 || nationalStems > utils.parseNumber(assignment.totalStems)) {
      setNotice(appState, "Seleccione proveedor, clasificador y variedad con una entrega pendiente, y registre una cantidad nacional valida.", "warning");
      return null;
    }
    const result = {
      id: uid("RES-CLA"),
      assignmentId: assignment.id,
      dateTime: nowLabel(),
      nationalStems,
      exportableStems: Math.max(utils.parseNumber(assignment.totalStems) - nationalStems, 0),
      observation: draft.observation || "Resultado de clasificacion registrado."
    };
    store.classificationResults.unshift(result);
    assignment.nationalStems = result.nationalStems;
    assignment.exportableStems = result.exportableStems;
    assignment.status = "COMPLETADO";
    assignment.closedAt = result.dateTime;
    upsertPerformanceRecord(store, {
      date: today(),
      worker: assignment.classifier,
      activity: "CLASIFICACION",
      variety: assignment.variety,
      bunches: 0,
      stems: assignment.totalStems,
      observation: `Nacional/rechazo: ${nationalStems} tallos. Exportable estimado: ${result.exportableStems}.`
    });
    resetClassificationResultDraft(appState);
    setNotice(appState, `Nacional o rechazo registrado: ${result.nationalStems} tallos.`, "success");
    saveDb();
    return result;
  }

  function updateReceptionStatus(appState, receptionId, status) {
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

  function registerYieldMeshProcessing(appState) {
    const store = ensureStore(appState);
    const draft = clone(store.ui.yieldMeshDraft);
    const totalStems = calculateMeshTotal(draft);
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
      status: "PROCESADA_DEMO",
      observation: draft.observation || "Mallas registradas para clasificacion demo.",
      registeredAt: nowLabel()
    };
    store.meshProcessingRecords.unshift(entry);
    upsertPerformanceRecord(store, {
      date: entry.date,
      worker: entry.classifier,
      activity: "CLASIFICACION",
      variety: entry.variety,
      bunches: Math.round(totalStems / 25),
      stems: totalStems,
      observation: "Actualizado desde mallas procesadas demo."
    });
    store.ui.yieldMeshDraft = data.createYieldMeshDraft({
      supplier: draft.supplier,
      block: draft.block,
      classifier: draft.classifier,
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
    if (draft.labelType === "MIXTA") draft.supplier = "BLESS FL";
    const quantity = Math.floor(utils.parseNumber(draft.quantity, 0));
    if (!draft.block || !draft.buncher || !draft.supplier || !draft.variety || !draft.length || !draft.stemsPerBunch || quantity <= 0) {
      setNotice(appState, "Seleccione un bloque parametrizado y complete embonchador, variedad, longitud, tallos por ramo y cantidad.", "warning");
      return null;
    }
    const labels = Array.from({ length: quantity }, () => ({
      id: uid("LBL-OPS"),
      ...draft,
      quantity: 1,
      code: nextBunchLabelCode(store),
      state: "IMPRESA",
      createdAt: nowLabel(),
      printedAt: nowLabel(),
      scannedAt: "",
      inventoryId: "",
      printCount: 1
    }));
    store.labelBatches.unshift(...labels);
    store.ui.labelDraft = data.createLabelDraft({
      supplier: draft.supplier,
      block: draft.block,
      buncher: draft.buncher,
      colorDay: draft.colorDay,
      variety: draft.variety,
      length: draft.length,
      stemsPerBunch: draft.stemsPerBunch
    });
    setNotice(appState, `${labels.length} etiqueta(s) generadas e impresas en demo. Inventario creado: 0 ramos.`, "success");
    saveDb();
    return { labels, code: labels[0]?.code || "", firstCode: labels[0]?.code || "", lastCode: labels.at(-1)?.code || "", count: labels.length };
  }

  function updateLabelState(appState, labelId, state) {
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

  function normalizeBunchLabelCode(rawCode) {
    return String(rawCode || "").replace(/[\r\n\t ]+/g, "").trim();
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

  function scanBunchLabelIntoInventory(appState, rawCode, options = {}) {
    const store = ensureStore(appState);
    const code = normalizeBunchLabelCode(rawCode);
    const finish = (result, tone, observation, extra = {}) => {
      const event = addBunchScanEvent(store, appState, { code, result, observation, ...extra });
      const response = { ok: result === "INVENTARIO_CREADO", result, code, observation, event, ...extra };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, observation, tone);
      saveDb();
      return response;
    };

    if (!/^\d{10}$/.test(code)) {
      return finish("FORMATO_INVALIDO", "warning", "El codigo debe contener exactamente 10 digitos.");
    }
    const label = store.labelBatches.find(item => item.code === code);
    if (!label) {
      return finish("NO_ENCONTRADO", "warning", "Etiqueta no encontrada. No se creo inventario.");
    }
    const existingInventory = store.roseInventory.find(item => item.sourceLabelId === label.id || item.labelCode === code);
    if (existingInventory || label.state === "ESCANEADA") {
      return finish("DUPLICADO", "warning", `La etiqueta ${code} ya fue escaneada. No se duplico el ramo.`, {
        labelId: label.id,
        inventoryId: existingInventory?.inventoryId || label.inventoryId || ""
      });
    }
    if (["ANULADA", "OBSERVADA"].includes(label.state)) {
      return finish("BLOQUEADA", "warning", `La etiqueta esta ${label.state}. No se creo inventario.`, { labelId: label.id });
    }

    if (label.labelType === "MIXTA" && !Array.isArray(options.confirmedComposition)) {
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
      const observation = `Etiqueta mixta ${code}: registre de uno a tres proveedores y complete ${label.stemsPerBunch} tallos antes de confirmar.`;
      const event = addBunchScanEvent(store, appState, { code, result: "PENDIENTE_COMPOSICION", labelId: label.id, observation });
      const response = { ok: false, pendingComposition: true, result: "PENDIENTE_COMPOSICION", code, observation, event, labelId: label.id };
      store.ui.lastBunchIntakeResult = response;
      store.ui.bunchIntakeDraft.code = "";
      setNotice(appState, observation, "info");
      saveDb();
      return response;
    }

    const admittedAt = nowLabel();
    const composition = Array.isArray(options.confirmedComposition)
      ? options.confirmedComposition.map(item => ({ block: item.block, supplier: item.supplier, stems: utils.parseNumber(item.stems) }))
      : [];
    const isMixed = label.labelType === "MIXTA";
    const inventorySupplier = isMixed ? [...new Set(composition.map(item => item.supplier))].join(" + ") : label.supplier;
    const inventoryBlock = isMixed ? composition.map(item => item.block).join(" + ") : label.block;
    const compositionText = composition.map(item => `${item.block}: ${item.stems} tallos`).join("; ");
    const inventoryId = uid("INV-OPS");
    const bunchEntryId = uid("RAMO-OPS");
    const event = addBunchScanEvent(store, appState, {
      code,
      result: "INVENTARIO_CREADO",
      labelId: label.id,
      inventoryId,
      observation: "Primer escaneo valido; ramo creado en inventario operativo demo."
    });
    const inventory = {
      inventoryId,
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
      state: "DISPONIBLE",
      buncher: label.buncher,
      responsible: options.responsible || store.ui.bunchIntakeDraft?.responsible || getDemoUser(appState),
      coldState: "PENDIENTE_UBICACION",
      observation: isMixed
        ? `Ramo mixto confirmado. ${compositionText}${options.observation ? ` | ${options.observation}` : ""}`
        : (options.observation || "Ingreso creado exclusivamente por escaneo de etiqueta."),
      composition,
      sourceType: "ESCANEO_ETIQUETA",
      sourceBunchEntryId: bunchEntryId,
      sourceLabelId: label.id,
      sourceScannerEventId: event.eventId
    };
    const assignment = store.classifierAssignments.find(item => item.supplier === label.supplier && item.variety === label.variety && item.status === "COMPLETADO");
    const bunchEntry = {
      id: bunchEntryId,
      date: admittedAt.slice(0, 10),
      code,
      supplier: inventorySupplier,
      block: inventoryBlock,
      variety: label.variety,
      length: label.length,
      stemsPerBunch: label.stemsPerBunch,
      classifier: assignment?.classifier || "NO RELACIONADO",
      buncher: label.buncher,
      responsible: inventory.responsible,
      state: "INGRESADO_POR_ESCANEO",
      observation: inventory.observation,
      registeredAt: admittedAt,
      labelId: label.id,
      inventoryId
    };
    bunchEntry.composition = composition;
    store.roseInventory.unshift(inventory);
    store.bunchEntries.unshift(bunchEntry);
    label.state = "ESCANEADA";
    label.scannedAt = admittedAt;
    label.inventoryId = inventoryId;
    if (isMixed) {
      label.composition = composition;
      label.compositionConfirmedAt = admittedAt;
    }
    upsertPerformanceRecord(store, {
      date: bunchEntry.date,
      worker: label.buncher,
      activity: "EMBONCHADO",
      variety: label.variety,
      bunches: 1,
      stems: label.stemsPerBunch,
      observation: "Rendimiento calculado desde escaneo valido, no desde impresion."
    });
    const response = { ok: true, result: "INVENTARIO_CREADO", code, observation: `Ramo ${code} ingresado al inventario a las ${admittedAt}.`, event, label, inventory, entry: bunchEntry, labelId: label.id, inventoryId };
    store.ui.lastBunchIntakeResult = response;
    store.ui.bunchIntakeDraft = data.createBunchIntakeDraft({ responsible: inventory.responsible, code: "" });
    store.ui.mixedBunchIntakeDraft = null;
    setNotice(appState, response.observation, "success");
    saveDb();
    return response;
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

  function confirmMixedBunchIntake(appState) {
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
    const uniqueSuppliers = new Set(lines.map(item => item.supplier.toUpperCase()));
    if (uniqueSuppliers.size !== lines.length) {
      setNotice(appState, "Cada proveedor debe aparecer una sola vez en la composicion del bonche mixto.", "warning");
      return null;
    }
    const total = lines.reduce((sum, item) => sum + item.stems, 0);
    if (total !== utils.parseNumber(draft.expectedStems)) {
      setNotice(appState, `La composicion suma ${total} tallos y debe sumar exactamente ${draft.expectedStems}.`, "warning");
      return null;
    }
    return scanBunchLabelIntoInventory(appState, draft.code, {
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

  function updateInventoryState(appState, inventoryId, state) {
    const store = ensureStore(appState);
    const entry = store.roseInventory.find(item => item.inventoryId === inventoryId);
    if (!entry) return false;
    if (entry.assignedOrderId || entry.state === "ASIGNADO_CAJA") return false;
    entry.state = state;
    saveDb();
    return true;
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
    editParameter,
    editReception,
    editReceptionItem,
    getStore,
    getUi,
    getReceptionClassificationProgress,
    getReceptionQueue,
    generateLabelBatch,
    markDispatchReady,
    prepareDispatchDemo,
    registerReception,
    registerClassifierAssignment,
    registerClassificationResult,
    registerYieldBunchEntry,
    registerYieldMeshProcessing,
    resetLabelDraft,
    resetBunchIntakeDraft,
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
    saveParameter,
    scanBunchLabelIntoInventory,
    reverseConsumptionDemo,
    simulateConsumptionDemo,
    updateDispatchState,
    updateDraftField,
    updateMixedBunchCompositionLine,
    updateInventoryState,
    updateLabelState,
    toggleParameter,
    updateReceptionStatus,
    updateYieldWorkday
  };
})();
