(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const data = BlessERP.comercialData;

  const lifecycleStatuses = [
    "BORRADOR",
    "REFERENCIAL",
    "VALIDADO_COMERCIAL",
    "LISTO_BODEGA",
    "LISTO_DESPACHO",
    "DESPACHADO_DEMO",
    "CERRADO_DEMO"
  ];

  const statusDefinitions = {
    BORRADOR: {
      label: "BORRADOR",
      shortLabel: "Borrador",
      description: "Pedido en edicion. Puede estar incompleto.",
      tone: "pending"
    },
    REFERENCIAL: {
      label: "REFERENCIAL",
      shortLabel: "Referencial",
      description: "Pedido preliminar que permite imprimir documentos referenciales con advertencias.",
      tone: "partial"
    },
    VALIDADO_COMERCIAL: {
      label: "VALIDADO_COMERCIAL",
      shortLabel: "Validado comercial",
      description: "Pedido revisado comercialmente. No debe tener errores criticos.",
      tone: "authorized"
    },
    LISTO_BODEGA: {
      label: "LISTO_BODEGA",
      shortLabel: "Listo bodega",
      description: "Pedido revisado por bodega demo. Puede tener advertencias, no errores criticos comerciales.",
      tone: "authorized"
    },
    LISTO_DESPACHO: {
      label: "LISTO_DESPACHO",
      shortLabel: "Listo despacho",
      description: "Pedido listo para imprimir documentos finales demo, HR, MP y etiquetas.",
      tone: "authorized"
    },
    DESPACHADO_DEMO: {
      label: "DESPACHADO_DEMO",
      shortLabel: "Despachado demo",
      description: "Pedido marcado como despachado en modo demo sin afectar inventario real ni contabilidad.",
      tone: "authorized"
    },
    CERRADO_DEMO: {
      label: "CERRADO_DEMO",
      shortLabel: "Cerrado demo",
      description: "Pedido cerrado internamente en demo. No permite edicion directa.",
      tone: "authorized"
    },
    ANULADO: {
      label: "ANULADO",
      shortLabel: "Anulado",
      description: "Pedido anulado. No se elimina y mantiene historial.",
      tone: "cancelled"
    },
    REABIERTO_DEMO: {
      label: "REABIERTO_DEMO",
      shortLabel: "Reabierto demo",
      description: "Pedido reabierto desde un estado controlado, con motivo registrado.",
      tone: "partial"
    },
    AUTORIZADO_SRI_FUTURO: {
      label: "AUTORIZADO_SRI_FUTURO",
      shortLabel: "SRI futuro",
      description: "Placeholder reservado. No implementar SRI en esta fase.",
      tone: "cancelled"
    }
  };

  const transitionMap = {
    BORRADOR: ["REFERENCIAL", "ANULADO"],
    REFERENCIAL: ["BORRADOR", "VALIDADO_COMERCIAL", "ANULADO"],
    VALIDADO_COMERCIAL: ["LISTO_BODEGA", "REABIERTO_DEMO", "ANULADO"],
    LISTO_BODEGA: ["LISTO_DESPACHO", "REABIERTO_DEMO", "ANULADO"],
    LISTO_DESPACHO: ["DESPACHADO_DEMO", "REABIERTO_DEMO", "ANULADO"],
    DESPACHADO_DEMO: ["CERRADO_DEMO", "REABIERTO_DEMO"],
    CERRADO_DEMO: ["REABIERTO_DEMO"],
    REABIERTO_DEMO: ["BORRADOR", "REFERENCIAL"],
    ANULADO: [],
    AUTORIZADO_SRI_FUTURO: []
  };

  const criticalFields = [
    "customerId",
    "brandId",
    "destination",
    "destinationCountry",
    "issuedAt",
    "flightDate",
    "transportType",
    "agencyId",
    "daeNumber",
    "airlineId",
    "flightNumber",
    "generalPo",
    "currency"
  ];

  const finalDispatchDocuments = ["PACKING_LIST", "HR", "MP", "ETIQUETAS", "CONTROL_DAE"];

  function unique(items) {
    return [...new Set((items || []).filter(Boolean))];
  }

  function normalizeStatus(value) {
    const key = String(value || "BORRADOR").trim().toUpperCase();
    return statusDefinitions[key] ? key : "BORRADOR";
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function currentUser(appState) {
    if (BlessERP.adminConfig?.activeUser) {
      const user = BlessERP.adminConfig.activeUser();
      if (user) return user;
    }

    return appState?.db?.session?.activeUser || {
      id: "demo-user",
      code: "USR-DEMO",
      name: "Usuario demo",
      role: "Administrador",
      area: "Comercial"
    };
  }

  function orderDateTime(order) {
    if (String(order?.issuedAt || "").trim()) {
      return `${order.issuedAt}T09:00:00.000Z`;
    }
    return nowIso();
  }

  function formatActionLabel(action) {
    return String(action || "")
      .trim()
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getStatusDefinition(status) {
    return statusDefinitions[normalizeStatus(status)] || statusDefinitions.BORRADOR;
  }

  function getAllowedTransitions(status) {
    return transitionMap[normalizeStatus(status)] || [];
  }

  function isTransitionAllowed(currentStatus, targetStatus) {
    return getAllowedTransitions(currentStatus).includes(normalizeStatus(targetStatus));
  }

  function buildHistoryEvent(payload = {}, appState) {
    const user = currentUser(appState);
    return {
      id: payload.id || BlessERP.utils.uid("COM-HIS"),
      createdAt: payload.createdAt || nowIso(),
      userId: user.id || "",
      userName: payload.userName || user.name || "Usuario demo",
      userRole: payload.userRole || user.role || user.area || "",
      action: String(payload.action || "ACTUALIZAR_PEDIDO").trim().toUpperCase(),
      actionLabel: String(payload.actionLabel || formatActionLabel(payload.action || "ACTUALIZAR_PEDIDO")).trim(),
      previousStatus: normalizeStatus(payload.previousStatus || "BORRADOR"),
      nextStatus: normalizeStatus(payload.nextStatus || payload.previousStatus || "BORRADOR"),
      description: String(payload.description || "").trim(),
      reason: String(payload.reason || "").trim(),
      result: ["exitoso", "bloqueado", "error"].includes(String(payload.result || "").toLowerCase())
        ? String(payload.result || "").toLowerCase()
        : "exitoso",
      documentCode: String(payload.documentCode || "").trim(),
      documentLabel: String(payload.documentLabel || "").trim()
    };
  }

  function ensureOrderWorkflow(order, appState) {
    if (!order || typeof order !== "object") return order;

    order.status = normalizeStatus(order.status);
    order.history = Array.isArray(order.history) ? order.history : [];
    order.documentActivity = order.documentActivity && typeof order.documentActivity === "object"
      ? order.documentActivity
      : {};
    order.statusUpdatedAt = String(order.statusUpdatedAt || orderDateTime(order)).trim();
    order.statusUpdatedBy = String(order.statusUpdatedBy || currentUser(appState).name || "Usuario demo").trim();
    order.lastTransitionReason = String(order.lastTransitionReason || "").trim();
    order.reopenedFromStatus = String(order.reopenedFromStatus || "").trim();
    order.dispatchedAt = String(order.dispatchedAt || "").trim();
    order.closedAt = String(order.closedAt || "").trim();

    Object.keys(order.documentActivity).forEach(docCode => {
      const row = order.documentActivity[docCode];
      order.documentActivity[docCode] = {
        code: docCode,
        lastAction: String(row?.lastAction || "").trim(),
        lastActionAt: String(row?.lastActionAt || "").trim(),
        lastMode: String(row?.lastMode || "").trim(),
        previewedAt: String(row?.previewedAt || "").trim(),
        printedAt: String(row?.printedAt || "").trim()
      };
    });

    if (!order.history.length && order.historySeedDisabled !== true) {
      order.history.unshift(buildHistoryEvent({
        createdAt: orderDateTime(order),
        action: "CREAR_PEDIDO_DEMO",
        actionLabel: "Crear pedido demo",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Pedido ${order.number || "demo"} disponible dentro del ERP unico.`,
        reason: "",
        result: "exitoso"
      }, appState));
    }

    return order;
  }

  function getHistory(order) {
    ensureOrderWorkflow(order);
    return order?.history || [];
  }

  function getLatestHistoryEvent(order) {
    return getHistory(order)[0] || null;
  }

  function writeAuditLog(order, event) {
    if (!BlessERP.adminConfig?.addAuditLog || !order || !event) return;
    BlessERP.adminConfig.addAuditLog({
      module: "COMERCIAL",
      action: event.action,
      entityType: "PEDIDO_COMERCIAL",
      entityId: order.id,
      entityLabel: order.number,
      documentLabel: event.documentLabel || order.number,
      previousStatus: event.previousStatus,
      nextStatus: event.nextStatus,
      description: event.description,
      reason: event.reason,
      result: event.result
    });
  }

  function recordEvent(order, appState, payload = {}) {
    ensureOrderWorkflow(order, appState);
    const event = buildHistoryEvent(payload, appState);
    order.history.unshift(event);

    if (event.nextStatus && (event.previousStatus !== event.nextStatus || payload.forceStatusStamp)) {
      order.statusUpdatedAt = event.createdAt;
      order.statusUpdatedBy = event.userName;
      order.lastTransitionReason = event.reason || order.lastTransitionReason || "";
    }

    if (!payload.skipAudit) {
      writeAuditLog(order, event);
    }

    return event;
  }

  function markDocumentActivity(order, appState, docCode, action, options = {}) {
    ensureOrderWorkflow(order, appState);
    const name = data.printDocs.find(item => item.code === docCode)?.name || docCode;
    const now = nowIso();
    const row = {
      code: docCode,
      ...(order.documentActivity[docCode] || {}),
      lastAction: action,
      lastActionAt: now,
      lastMode: String(options.mode || "").trim()
    };

    if (action === "preview") {
      row.previewedAt = now;
    }
    if (action === "print") {
      row.printedAt = now;
      if (docCode === "ETIQUETAS") {
        const revision = Number(order.labelRevision || 1);
        order.labelReprintRequired = false;
        row.revision = revision;
        row.reprintRequired = false;
        order.boxFulfillment = order.boxFulfillment && typeof order.boxFulfillment === "object" ? order.boxFulfillment : {};
        [...new Set((order.lines || []).map(line => Number(line.boxNumber)).filter(Boolean))].forEach(boxNumber => {
          order.boxFulfillment[boxNumber] = {
            ...(order.boxFulfillment[boxNumber] || {}),
            labelStatus: "ETIQUETA_IMPRESA",
            labelRevision: revision,
            labelPrintedAt: now
          };
        });
      }
    }

    order.documentActivity[docCode] = row;
    return recordEvent(order, appState, {
      action: action === "print" ? "IMPRIMIR_DOCUMENTO" : "PREVISUALIZAR_DOCUMENTO",
      actionLabel: action === "print" ? "Imprimir documento" : "Vista previa documento",
      previousStatus: order.status,
      nextStatus: order.status,
      documentCode: docCode,
      documentLabel: name,
      description: `${name} ${action === "print" ? "impreso" : "previsualizado"} en modo demo.`,
      result: "exitoso"
    });
  }

  function getEditPolicy(order) {
    const status = normalizeStatus(order?.status);
    if (status === "BORRADOR") {
      return {
        status,
        editBlocked: false,
        criticalLocked: false,
        linesLocked: false,
        message: ""
      };
    }

    if (status === "REFERENCIAL" || status === "REABIERTO_DEMO") {
      return {
        status,
        editBlocked: false,
        criticalLocked: false,
        linesLocked: false,
        message: "Editar este pedido puede afectar documentos ya emitidos en modo referencial."
      };
    }

    if (status === "VALIDADO_COMERCIAL" || status === "LISTO_BODEGA") {
      return {
        status,
        editBlocked: false,
        criticalLocked: true,
        linesLocked: true,
        message: "Los datos criticos y las cajas estan bloqueados. Reabra el pedido para modificarlos."
      };
    }

    if (status === "LISTO_DESPACHO" || status === "DESPACHADO_DEMO" || status === "CERRADO_DEMO" || status === "ANULADO" || status === "AUTORIZADO_SRI_FUTURO") {
      return {
        status,
        editBlocked: true,
        criticalLocked: true,
        linesLocked: true,
        message: status === "ANULADO"
          ? "Pedido anulado. Solo se permite consulta o reimpresion anulada."
          : "El pedido esta bloqueado para edicion directa. Debe reabrirse para cambios."
      };
    }

    return {
      status,
      editBlocked: false,
      criticalLocked: false,
      linesLocked: false,
      message: ""
    };
  }

  function canEditOrderField(order, field) {
    const policy = getEditPolicy(order);
    if (policy.editBlocked) {
      return { ok: false, message: policy.message };
    }
    if (policy.criticalLocked && criticalFields.includes(field)) {
      return { ok: false, message: policy.message || "Campo critico bloqueado. Reabra el pedido para cambiarlo." };
    }
    return { ok: true, message: policy.message };
  }

  function canEditLines(order) {
    const policy = getEditPolicy(order);
    if (policy.editBlocked || policy.linesLocked) {
      return { ok: false, message: policy.message || "Las cajas y lineas estan bloqueadas en este estado." };
    }
    return { ok: true, message: policy.message };
  }

  function getBaseValidation(order, appState) {
    return utils.getValidationState(
      order,
      BlessERP.comercialState?.getReservations ? BlessERP.comercialState.getReservations(appState) : []
    );
  }

  function getLabelsData(order, appState) {
    if (!BlessERP.comercialLabels?.buildDocumentData) return null;
    const options = BlessERP.comercialLabels.getCurrentSelection
      ? BlessERP.comercialLabels.getCurrentSelection(appState)
      : {};
    return BlessERP.comercialLabels.buildDocumentData(order, appState, options);
  }

  function getDocumentValidation(docCode, order, appState, options = {}) {
    if (!BlessERP.comercialPrintDocs?.[docCode] || !BlessERP.comercialPrintUtils?.buildContext) {
      return { errors: [], warnings: [] };
    }
    const definition = BlessERP.comercialPrintDocs[docCode];
    const context = BlessERP.comercialPrintUtils.buildContext(order, appState, options);
    const result = definition.validate ? definition.validate(context, options) : { errors: [], warnings: [] };
    return {
      errors: unique(result?.errors || []),
      warnings: unique(result?.warnings || [])
    };
  }

  function getDispatchReview(order, appState) {
    if (!BlessERP.operacionesDispatchDemo?.validateDispatchReadinessDemo) {
      return { ok: true, errors: [], warnings: [], checklist: [] };
    }
    return BlessERP.operacionesDispatchDemo.validateDispatchReadinessDemo(appState, order.id);
  }

  function getDispatchState(order, appState) {
    if (!BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo) return "";
    return String(BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, order.id)?.estado_despacho || "").trim().toUpperCase();
  }

  function buildTransitionValidation(order, targetStatus, appState) {
    const normalizedTarget = normalizeStatus(targetStatus);
    const validation = getBaseValidation(order, appState);
    const errors = [];
    const warnings = [...validation.warnings];
    const labelsData = getLabelsData(order, appState);
    const packaging = BlessERP.comercialPackaging?.calculateOrderRequirements
      ? BlessERP.comercialPackaging.calculateOrderRequirements(order, appState)
      : null;
    const dispatchReview = getDispatchReview(order, appState);
    const dispatchState = getDispatchState(order, appState);
    const requiredDispatchDocs = [
      ["INVOICE_PACKING_REAL", "Invoice carguera real demo"],
      ["PACKING_LIST", "Packing List"],
      ["HR", "HR / Hoja de Ruta"],
      ["MP", "MP / Master Packing"],
      ["ETIQUETAS", "Etiquetas de caja"],
      ["CONTROL_DAE", "Control DAE"]
    ];

    if (normalizedTarget === "REFERENCIAL") {
      if (!order.customerId) errors.push("Falta cliente principal.");
      if (!order.brandId) errors.push("Falta marca / cliente final.");
      if (!validation.metrics?.lines?.length) errors.push("Debe existir al menos una linea comercial.");
    }

    if (normalizedTarget === "VALIDADO_COMERCIAL") {
      errors.push(...validation.errors);
    }

    if (normalizedTarget === "LISTO_BODEGA") {
      if (normalizeStatus(order.status) !== "VALIDADO_COMERCIAL") {
        errors.push("El pedido debe estar validado comercialmente antes de pasar a LISTO_BODEGA.");
      }
      errors.push(...validation.errors);
      if (!packaging?.requirements?.length) warnings.push("Materiales de empaque aun no calculados; no bloquea el armado de rosas.");
      if (!labelsData?.rows?.length || labelsData.errors.length) warnings.push("Las etiquetas de caja se prepararan cuando Bodega cierre cada caja.");
      if (!String(order.documentActivity?.ETIQUETAS?.previewedAt || order.documentActivity?.ETIQUETAS?.printedAt || "").trim()) warnings.push("Etiqueta de caja aun no impresa; corresponde despues del cierre fisico.");
    }

    if (normalizedTarget === "LISTO_DESPACHO") {
      if (normalizeStatus(order.status) !== "LISTO_BODEGA") {
        errors.push("El pedido debe estar en LISTO_BODEGA antes de pasar a LISTO_DESPACHO.");
      }
      requiredDispatchDocs.forEach(([docCode, label]) => {
        const docValidation = getDocumentValidation(docCode, order, appState, docCode === "ETIQUETAS"
          ? (BlessERP.comercialLabels?.getCurrentSelection ? BlessERP.comercialLabels.getCurrentSelection(appState) : {})
          : {}
        );
        if (docValidation.errors.length) {
          errors.push(`${label} no esta listo.`);
        }
        if (!String(order.documentActivity?.[docCode]?.previewedAt || order.documentActivity?.[docCode]?.printedAt || "").trim()) {
          errors.push(`Falta generar ${label} antes de pasar a LISTO_DESPACHO.`);
        }
      });
      errors.push(...dispatchReview.errors);
      warnings.push(...dispatchReview.warnings);
    }

    if (normalizedTarget === "DESPACHADO_DEMO") {
      if (normalizeStatus(order.status) !== "LISTO_DESPACHO") {
        errors.push("El pedido debe estar en LISTO_DESPACHO antes de confirmar despacho demo.");
      }
      requiredDispatchDocs.forEach(([docCode, label]) => {
        if (!String(order.documentActivity?.[docCode]?.previewedAt || order.documentActivity?.[docCode]?.printedAt || "").trim()) {
          errors.push(`Falta ${label} previo al despacho demo.`);
        }
      });
      errors.push(...dispatchReview.errors);
      warnings.push(...dispatchReview.warnings);
    }

    if (normalizedTarget === "CERRADO_DEMO") {
      if (normalizeStatus(order.status) !== "DESPACHADO_DEMO") {
        errors.push("El pedido debe estar en DESPACHADO_DEMO antes de cerrarse.");
      }
      if (dispatchState !== "DESPACHADO_DEMO") {
        errors.push("El despacho demo debe estar confirmado antes del cierre.");
      }
      warnings.push(...dispatchReview.warnings);
    }

    return {
      targetStatus: normalizedTarget,
      errors: unique(errors),
      warnings: unique(warnings)
    };
  }

  function getSuggestedNext(order, appState) {
    const suggestionMap = {
      BORRADOR: "REFERENCIAL",
      REFERENCIAL: "VALIDADO_COMERCIAL",
      VALIDADO_COMERCIAL: "LISTO_BODEGA",
      LISTO_BODEGA: "LISTO_DESPACHO",
      LISTO_DESPACHO: "DESPACHADO_DEMO",
      DESPACHADO_DEMO: "CERRADO_DEMO",
      REABIERTO_DEMO: "REFERENCIAL"
    };

    const targetStatus = suggestionMap[normalizeStatus(order?.status)] || "";
    if (!targetStatus) return null;

    const review = buildTransitionValidation(order, targetStatus, appState);
    return {
      targetStatus,
      label: getStatusDefinition(targetStatus).shortLabel,
      errors: review.errors,
      warnings: review.warnings,
      ready: !review.errors.length
    };
  }

  function getProgressSteps(order) {
    const currentStatus = normalizeStatus(order?.status);
    const activeIndex = lifecycleStatuses.indexOf(currentStatus);

    return lifecycleStatuses.map((status, index) => ({
      status,
      definition: getStatusDefinition(status),
      completed: activeIndex > -1 ? index < activeIndex : false,
      current: status === currentStatus || (currentStatus === "REABIERTO_DEMO" && status === "BORRADOR"),
      upcoming: activeIndex > -1 ? index > activeIndex : true
    }));
  }

  function buildDocumentPolicyValidation(docCode, order, options = {}) {
    const status = normalizeStatus(order?.status);
    const errors = [];
    const warnings = [];
    const realDemoRequested = docCode === "INVOICE_PACKING_REAL" || options.mode === "REAL_DEMO";

    if (status === "ANULADO") {
      warnings.push("Pedido anulado. Solo se permite copia ANULADA o preview referencial.");
      if (realDemoRequested) {
        errors.push("Pedido anulado. La impresion real demo esta bloqueada.");
      }
      return { errors, warnings };
    }

    if (status === "BORRADOR") {
      warnings.push("Pedido en BORRADOR. El documento sale como preliminar.");
      if (realDemoRequested) {
        errors.push("El documento real demo requiere VALIDADO_COMERCIAL como minimo.");
      }
    }

    if (status === "REFERENCIAL" || status === "REABIERTO_DEMO") {
      warnings.push("Pedido referencial. El documento sale con advertencias.");
      if (realDemoRequested) {
        errors.push("Debe validarse comercialmente antes de usar modo real demo.");
      }
    }

    if ((status === "VALIDADO_COMERCIAL" || status === "LISTO_BODEGA") && finalDispatchDocuments.includes(docCode)) {
      warnings.push("Documento operativo aun no esta en fase LISTO_DESPACHO.");
    }

    if (status === "DESPACHADO_DEMO" || status === "CERRADO_DEMO") {
      warnings.push("Pedido en modo reimpresion / consulta. La edicion esta bloqueada.");
    }

    return {
      errors: unique(errors),
      warnings: unique(warnings)
    };
  }

  function canExecuteDocumentAction(docCode, order, appState, action = "preview", options = {}) {
    const policy = buildDocumentPolicyValidation(docCode, order, options);
    const status = normalizeStatus(order?.status);
    const errors = [...policy.errors];
    const warnings = [...policy.warnings];
    const realDemoRequested = docCode === "INVOICE_PACKING_REAL" || options.mode === "REAL_DEMO";

    if (action === "print") {
      if (realDemoRequested && !["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO", "DESPACHADO_DEMO", "CERRADO_DEMO"].includes(status)) {
        errors.push("Para imprimir este documento en modo real demo, el pedido debe estar al menos en VALIDADO_COMERCIAL.");
      }
      if (finalDispatchDocuments.includes(docCode) && !["LISTO_DESPACHO", "DESPACHADO_DEMO", "CERRADO_DEMO", "ANULADO"].includes(status)) {
        errors.push("Para imprimir este documento como salida final demo, el pedido debe estar en LISTO_DESPACHO.");
      }
    }

    return {
      allowed: !errors.length,
      errors: unique(errors),
      warnings: unique(warnings)
    };
  }

  function getDocumentPresentation(order, docCode, options = {}) {
    const status = normalizeStatus(order?.status);
    const realDemoRequested = docCode === "INVOICE_PACKING_REAL" || options.mode === "REAL_DEMO";

    if (status === "ANULADO") {
      return { label: "ANULADO", tone: "cancelled" };
    }
    if (status === "BORRADOR") {
      return { label: "BORRADOR / PRELIMINAR", tone: "pending" };
    }
    if (status === "REFERENCIAL" || status === "REABIERTO_DEMO") {
      return { label: "REFERENCIAL", tone: "partial" };
    }
    if (realDemoRequested || ["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO", "DESPACHADO_DEMO", "CERRADO_DEMO"].includes(status)) {
      return { label: "VALIDADO INTERNAMENTE", tone: "authorized" };
    }
    return { label: status, tone: getStatusDefinition(status).tone };
  }

  function buildOrderAlerts(order, appState) {
    const validation = getBaseValidation(order, appState);
    const alerts = [];
    const status = normalizeStatus(order.status);
    const dae = utils.findDae(order.daeNumber);
    const dispatchReview = getDispatchReview(order, appState);
    const dispatchState = getDispatchState(order, appState);

    if (dae && utils.isDaeNearExpiry(dae)) {
      alerts.push({ tone: "pending", message: "DAE proxima a caducar." });
    }
    if (validation.errors.includes("Fecha vuelo posterior a caducidad DAE.")) {
      alerts.push({ tone: "cancelled", message: "Fecha vuelo posterior a la caducidad DAE." });
    }
    if (!order.awb || !order.hawb) {
      alerts.push({ tone: "pending", message: "Falta AWB / HAWB." });
    }
    if (validation.warnings.includes("Falta PO cuando la marca lo requiere.")) {
      alerts.push({ tone: "pending", message: "Falta PO requerido." });
    }
    if (validation.warnings.some(item => item.includes("Materiales faltantes"))) {
      alerts.push({ tone: "pending", message: "Hay materiales faltantes en bodega." });
    }
    if (validation.warnings.includes("Etiquetas no generadas.")) {
      alerts.push({ tone: "pending", message: "Etiquetas pendientes de despacho." });
    }
    if (validation.warnings.includes("Documentos de despacho aun no impresos o sin vista previa.")) {
      alerts.push({ tone: "partial", message: "Documentos de despacho pendientes." });
    }
    if (dispatchState === "OBSERVADO") {
      alerts.push({ tone: "pending", message: "Despacho operativo observado." });
    }
    if (status === "LISTO_DESPACHO") {
      alerts.push({ tone: "authorized", message: "Pedido listo para despacho." });
    }
    if (status === "DESPACHADO_DEMO") {
      alerts.push({ tone: "authorized", message: "Pedido despachado en modo demo." });
    }
    if (status === "REFERENCIAL") {
      alerts.push({ tone: "partial", message: "Pedido referencial pendiente de validar." });
    }
    dispatchReview.errors.forEach(message => {
      alerts.push({ tone: "cancelled", message });
    });

    return unique(alerts.map(item => JSON.stringify(item))).map(item => JSON.parse(item));
  }

  function buildWorkflowSummary(order, appState) {
    ensureOrderWorkflow(order, appState);
    const validation = getBaseValidation(order, appState);
    const policy = getEditPolicy(order);
    const latestAction = getLatestHistoryEvent(order);
    const suggestedNext = getSuggestedNext(order, appState);
    const allowedTransitions = getAllowedTransitions(order.status).map(targetStatus => {
      const review = buildTransitionValidation(order, targetStatus, appState);
      return {
        targetStatus,
        label: getStatusDefinition(targetStatus).shortLabel,
        description: getStatusDefinition(targetStatus).description,
        ready: !review.errors.length,
        errors: review.errors,
        warnings: review.warnings
      };
    });

    return {
      status: normalizeStatus(order.status),
      definition: getStatusDefinition(order.status),
      validation,
      progressSteps: getProgressSteps(order),
      editPolicy: policy,
      latestAction,
      suggestedNext,
      allowedTransitions,
      alerts: buildOrderAlerts(order, appState)
    };
  }

  function buildCommercialWorkflowContract(order, appState) {
    const summary = buildWorkflowSummary(order, appState);
    const previousTransition = getHistory(order).find(item => item.previousStatus !== item.nextStatus) || null;
    const documentsEnabled = data.printDocs
      .filter(doc => canExecuteDocumentAction(doc.code, order, appState, "preview", {}).allowed)
      .map(doc => doc.code);

    return {
      pedido_id: order.id,
      estado_actual: summary.status,
      estado_anterior: previousTransition?.previousStatus || summary.status,
      transicion: previousTransition?.nextStatus || summary.status,
      usuario: currentUser(appState).name || "Usuario demo",
      fecha_hora: nowIso(),
      motivo: order.lastTransitionReason || "",
      errores: [...summary.validation.errors],
      advertencias: [...summary.validation.warnings],
      documentos_habilitados: documentsEnabled,
      edicion_bloqueada: Boolean(summary.editPolicy.editBlocked || summary.editPolicy.criticalLocked)
    };
  }

  function buildPortfolioSummary(orders, appState) {
    const rows = (orders || []).map(order => {
      ensureOrderWorkflow(order, appState);
      const metrics = utils.getOrderMetrics(order);
      return {
        order,
        metrics,
        alerts: buildOrderAlerts(order, appState)
      };
    });

    const counts = {};
    Object.keys(statusDefinitions).forEach(status => {
      counts[status] = rows.filter(row => normalizeStatus(row.order.status) === status).length;
    });

    const totalUsd = rows.reduce((sum, row) => sum + Number(row.metrics.totalUsd || 0), 0);
    const pendingDispatchBoxes = rows
      .filter(row => !["DESPACHADO_DEMO", "CERRADO_DEMO", "ANULADO"].includes(normalizeStatus(row.order.status)))
      .reduce((sum, row) => sum + Number(row.metrics.totalBoxes || 0), 0);

    const alerts = rows.flatMap(row => row.alerts.map(alert => ({
      orderId: row.order.id,
      orderNumber: row.order.number,
      status: row.order.status,
      tone: alert.tone,
      message: alert.message
    })));

    return {
      counts,
      totalUsd,
      pendingDispatchBoxes,
      alerts
    };
  }

  BlessERP.comercialWorkflow = {
    buildCommercialWorkflowContract,
    buildOrderAlerts,
    buildPortfolioSummary,
    buildTransitionValidation,
    buildWorkflowSummary,
    canEditLines,
    canEditOrderField,
    canExecuteDocumentAction,
    ensureOrderWorkflow,
    getAllowedTransitions,
    getDocumentPresentation,
    getDocumentValidation,
    getEditPolicy,
    getHistory,
    getLatestHistoryEvent,
    getProgressSteps,
    getStatusDefinition,
    isTransitionAllowed,
    lifecycleStatuses,
    markDocumentActivity,
    normalizeStatus,
    recordEvent,
    statusDefinitions,
    transitionMap
  };
})();
