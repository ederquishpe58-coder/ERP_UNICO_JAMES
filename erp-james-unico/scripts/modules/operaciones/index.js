(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function isOperationsRoute() {
    return String(BlessERP.state.currentRoute()?.id || "").startsWith("operations-");
  }

  function refreshCalculatedNodes(container, appState) {
    if (!isOperationsRoute()) return;
    const ui = stateApi.getUi(appState);
    const totalNode = container.querySelector("[data-ops-reception-total]");
    if (totalNode) {
      totalNode.textContent = `${utils.number(ui.receptionDraft.totalDeclared)} tallos`;
    }
    const receptionItemTotalNode = container.querySelector("[data-ops-reception-item-total]");
    if (receptionItemTotalNode) {
      receptionItemTotalNode.textContent = `${utils.number(ui.receptionItemDraft?.totalStems)} tallos`;
    }
    const receptionSupplierNode = container.querySelector("[data-ops-reception-supplier]");
    if (receptionSupplierNode) {
      receptionSupplierNode.value = ui.receptionDraft?.supplier || "Seleccione un bloque";
    }
    const codeNode = container.querySelector("[data-ops-label-code-preview]");
    if (codeNode) {
      const store = stateApi.getStore(appState);
      codeNode.textContent = utils.buildLabelCode({ sequence: store.sequences.bunchLabel });
    }
    const yieldMeshNode = container.querySelector("[data-ops-yield-mesh-total]");
    if (yieldMeshNode) {
      const total = (utils.parseNumber(ui.yieldMeshDraft?.meshCount) * 25) + utils.parseNumber(ui.yieldMeshDraft?.extraStems);
      yieldMeshNode.textContent = `${utils.number(total)} tallos`;
    }
  }

  function refreshMixedCompositionNodes(container, appState) {
    const draft = stateApi.getUi(appState).mixedBunchIntakeDraft;
    if (!draft) return;
    (draft.lines || []).forEach((line, index) => {
      const supplierNode = container.querySelector(`[data-mixed-line="${index}"] [data-mixed-supplier]`);
      if (supplierNode) supplierNode.value = line.supplier || "Seleccione un bloque";
    });
    const total = (draft.lines || []).reduce((sum, item) => sum + utils.parseNumber(item.stems), 0);
    const expected = utils.parseNumber(draft.expectedStems);
    const totalNode = container.querySelector("[data-mixed-total]");
    const remainingNode = container.querySelector("[data-mixed-remaining]");
    const confirmButton = container.querySelector("[data-mixed-confirm]");
    if (totalNode) totalNode.textContent = utils.number(total);
    if (remainingNode) remainingNode.textContent = utils.number(Math.max(expected - total, 0));
    if (confirmButton) confirmButton.disabled = total !== expected;
  }

  function rerender() {
    BlessERP.layout.renderPage();
  }

  function openCommercialDocumentFromDispatch(appState, orderId, docCode) {
    const order = BlessERP.comercialState?.findOrder ? BlessERP.comercialState.findOrder(appState, orderId) : null;
    if (!order || !BlessERP.comercialPrintSystem?.openPreview) return false;

    const options = docCode === "ETIQUETAS"
      ? (BlessERP.comercialLabels?.getCurrentSelection ? BlessERP.comercialLabels.getCurrentSelection(appState) : {})
      : docCode === "COMMERCIAL_INVOICE_CLIENT"
        ? { ...(BlessERP.comercialClientInvoice?.getCurrentOptions ? BlessERP.comercialClientInvoice.getCurrentOptions(appState) : {}), mode: "REFERENCIAL" }
        : {};
    const review = BlessERP.comercialWorkflow?.canExecuteDocumentAction
      ? BlessERP.comercialWorkflow.canExecuteDocumentAction(docCode, order, appState, "print", options)
      : { allowed: true, errors: [] };

    if (!review.allowed) {
      BlessERP.layout.toast(review.errors?.[0] || "El documento no puede imprimirse desde el estado actual del pedido.");
      return false;
    }

    const opened = BlessERP.comercialPrintSystem.openPreview(docCode, [order], appState, {
      autoPrint: true,
      options
    });

    if (opened && BlessERP.comercialWorkflow?.markDocumentActivity) {
      BlessERP.comercialWorkflow.markDocumentActivity(order, appState, docCode, "print", options);
      BlessERP.state.saveDb();
    }

    return opened;
  }

  function render(container, route, appState) {
    let html = "";
    if (route.id === "operations-postharvest") {
      html = BlessERP.operacionesPanel.render(appState, route);
    } else if (route.id === "operations-parameters") {
      html = BlessERP.operacionesParametros.render(appState, route);
    } else if (route.id === "operations-reception") {
      html = BlessERP.operacionesRecepcion.render(appState, route);
    } else if (route.id === "operations-grading") {
      html = BlessERP.operacionesClasificacion.render(appState, route);
    } else if (route.id === "operations-labels") {
      html = BlessERP.operacionesEtiquetas.render(appState, route);
    } else if (route.id === "operations-bunch-intake") {
      html = BlessERP.operacionesIngresoRamos.render(appState, route);
    } else if (route.id === "operations-roses-inventory") {
      html = BlessERP.operacionesInventario.render(appState, route);
    } else if (route.id === "operations-availability") {
      html = BlessERP.operacionesDisponibilidad.render(appState, route);
    } else if (route.id === "operations-warehouse") {
      html = BlessERP.operacionesBodega.render(appState, route);
    } else if (route.id === "operations-yields") {
      html = BlessERP.operacionesRendimientos.render(appState, route);
    } else if (route.id === "operations-scanner") {
      html = BlessERP.operacionesScanner.render(appState, route);
    } else if (route.id === "operations-dispatch") {
      html = BlessERP.operacionesDespacho.render(appState, route);
    }

    container.innerHTML = html;
    bind(container, appState);
    refreshCalculatedNodes(container, appState);
    const mixedModal = container.querySelector("[data-ops-mixed-composition]");
    if (mixedModal) setTimeout(() => mixedModal.querySelector("select, input[type='number']")?.focus(), 0);
  }

  function bind(container, appState) {
    if (container.dataset.operationsBound === "true") return;
    container.dataset.operationsBound = "true";

    container.addEventListener("input", event => {
      if (!isOperationsRoute()) return;
      const mixedField = event.target.closest("[data-ops-mixed-field]");
      if (mixedField) {
        stateApi.updateMixedBunchCompositionLine(appState, mixedField.dataset.lineIndex, mixedField.dataset.opsMixedField, mixedField.value);
        refreshMixedCompositionNodes(container, appState);
        return;
      }
      const field = event.target.closest("[data-ops-bind]");
      if (!field) {
        const uiField = event.target.closest("[data-ops-ui-field]");
        if (uiField) {
          stateApi.setUiValue(appState, uiField.dataset.opsUiField, uiField.value);
        }
        return;
      }
      stateApi.updateDraftField(appState, field.dataset.opsBind, field.dataset.field, field.value);
      refreshCalculatedNodes(container, appState);
    });

    container.addEventListener("change", event => {
      if (!isOperationsRoute()) return;
      const mixedField = event.target.closest("[data-ops-mixed-field]");
      if (mixedField) {
        stateApi.updateMixedBunchCompositionLine(appState, mixedField.dataset.lineIndex, mixedField.dataset.opsMixedField, mixedField.value);
        refreshMixedCompositionNodes(container, appState);
        return;
      }
      const boundField = event.target.closest("[data-ops-bind]");
      if (boundField) {
        stateApi.updateDraftField(appState, boundField.dataset.opsBind, boundField.dataset.field, boundField.value);
        refreshCalculatedNodes(container, appState);
        if (
          ["classificationAssignmentDraft", "classificationResultDraft"].includes(boundField.dataset.opsBind) ||
          (boundField.dataset.opsBind === "labelDraft" && ["block", "labelType"].includes(boundField.dataset.field)) ||
          (boundField.dataset.opsBind === "receptionDraft" && ["supplier", "block"].includes(boundField.dataset.field)) ||
          (boundField.dataset.opsBind === "parameterDraft" && boundField.dataset.field === "type")
        ) {
          rerender();
        }
        return;
      }
      const uiField = event.target.closest("[data-ops-ui-field]");
      if (!uiField) return;
      stateApi.setUiValue(appState, uiField.dataset.opsUiField, uiField.value);
      rerender();
    });

    container.addEventListener("keydown", event => {
      if (!isOperationsRoute()) return;
      const mixedModal = event.target.closest("[data-ops-mixed-composition]");
      if (mixedModal && event.key === "Escape") {
        event.preventDefault();
        stateApi.cancelMixedBunchIntake(appState);
        rerender();
        return;
      }
      if (mixedModal && event.key === "Enter" && event.target.matches("input[type='number'][data-ops-mixed-field='stems']")) {
        event.preventDefault();
        stateApi.confirmMixedBunchIntake(appState);
        rerender();
        return;
      }
      const bunchIntakeField = event.target.closest("[data-ops-bunch-intake]");
      if (bunchIntakeField && event.key === "Enter") {
        event.preventDefault();
        if (String(bunchIntakeField.value || "").trim()) {
          stateApi.scanBunchLabelIntoInventory(appState, bunchIntakeField.value);
          rerender();
        }
        return;
      }
      const dispatchBunchField = event.target.closest("[data-ops-dispatch-bunch-scan]");
      if (dispatchBunchField && event.key === "Enter") {
        event.preventDefault();
        const ui = stateApi.getUi(appState);
        const result = BlessERP.comercialOrderFulfillment?.scanBunchForOrder?.(
          appState,
          ui.selectedDispatchOrderId,
          ui.dispatchAssemblyBoxNumber,
          dispatchBunchField.value
        ) || { ok: false, error: "Servicio de armado no disponible." };
        stateApi.setUiValue(appState, "dispatchLastBunchScan", {
          ok: Boolean(result.ok),
          message: result.ok ? `Ramo ${dispatchBunchField.value} validado en caja ${result.boxNumber}.` : result.error,
          warning: result.warning || ""
        });
        if (result.ok) stateApi.setUiValue(appState, "dispatchBunchScanCode", "");
        rerender();
        return;
      }
      const hidField = event.target.closest("[data-ops-hid-input]");
      if (!hidField || event.key !== "Enter") return;
      event.preventDefault();
      const value = hidField.value;
      if (!String(value || "").trim()) return;
      stateApi.processHidScannerInputDemo(appState, value, {
        source: "ENTER",
        routeId: BlessERP.state.currentRoute()?.id || "operations-scanner"
      });
      rerender();
    });

    container.addEventListener("click", event => {
      if (!isOperationsRoute()) return;

      const uiButton = event.target.closest("[data-ops-ui-field][data-value]");
      if (uiButton) {
        stateApi.setUiValue(appState, uiButton.dataset.opsUiField, uiButton.dataset.value);
        rerender();
        return;
      }

      const action = event.target.closest("[data-ops-action]");
      if (!action) return;

      if (action.dataset.opsAction === "dispatch-view-detail") {
        stateApi.setUiValue(appState, "selectedDispatchOrderId", action.dataset.orderId || "");
        stateApi.setUiValue(appState, "dispatchDetailTab", "boxes");
        const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, action.dataset.orderId || "");
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", fulfillment?.boxes?.find(box => !box.automaticComplete)?.boxNumber || fulfillment?.boxes?.[0]?.boxNumber || 1);
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        stateApi.setUiValue(appState, "dispatchViewMode", "detail");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-back-list") {
        stateApi.setUiValue(appState, "dispatchViewMode", "list");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-select-assembly-box") {
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", Number(action.dataset.boxNumber || 1));
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-scan-bunch") {
        const ui = stateApi.getUi(appState);
        const result = BlessERP.comercialOrderFulfillment?.scanBunchForOrder?.(
          appState,
          action.dataset.orderId || ui.selectedDispatchOrderId,
          ui.dispatchAssemblyBoxNumber,
          ui.dispatchBunchScanCode
        ) || { ok: false, error: "Servicio de armado no disponible." };
        stateApi.setUiValue(appState, "dispatchLastBunchScan", {
          ok: Boolean(result.ok),
          message: result.ok ? `Ramo ${ui.dispatchBunchScanCode} validado en caja ${result.boxNumber}.` : result.error,
          warning: result.warning || ""
        });
        if (result.ok) stateApi.setUiValue(appState, "dispatchBunchScanCode", "");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-acknowledge-revision") {
        const user = appState.db.session?.activeUser?.name || "Bodega demo";
        const result = BlessERP.comercialOrderFulfillment?.acknowledgeOrderRevision?.(appState, action.dataset.orderId, user);
        BlessERP.layout.toast(result?.ok ? "Actualizacion del pedido revisada por Bodega." : result?.error || "No se pudo revisar la actualizacion.");
        rerender();
        return;
      }

      if (action.dataset.opsAction === "warehouse-open-order-detail") {
        const orderId = action.dataset.orderId || "";
        const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId);
        stateApi.setUiValue(appState, "selectedDispatchOrderId", orderId);
        stateApi.setUiValue(appState, "dispatchDetailTab", "boxes");
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", fulfillment?.boxes?.find(box => !box.automaticComplete)?.boxNumber || fulfillment?.boxes?.[0]?.boxNumber || 1);
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        stateApi.setUiValue(appState, "dispatchViewMode", "detail");
        BlessERP.state.setRoute("operations-dispatch");
        BlessERP.layout.renderApp();
        return;
      }

      if (action.dataset.opsAction === "parameter-save") {
        stateApi.saveParameter(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-reset") {
        stateApi.resetParameterDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-edit") {
        stateApi.editParameter(appState, action.dataset.type, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-toggle") {
        stateApi.toggleParameter(appState, action.dataset.type, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-delete") {
        stateApi.deleteParameter(appState, action.dataset.type, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-assignment-save") {
        stateApi.registerClassifierAssignment(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-assignment-reset") {
        stateApi.resetClassificationAssignmentDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-result-save") {
        stateApi.registerClassificationResult(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-result-reset") {
        stateApi.resetClassificationResultDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-export-xlsx") {
        const ui = stateApi.getUi(appState);
        const rows = (stateApi.getStore(appState).classifierAssignments || []).filter(item =>
          (!ui.classificationHistoryFrom || String(item.dateTime).slice(0, 10) >= ui.classificationHistoryFrom) &&
          (!ui.classificationHistoryTo || String(item.dateTime).slice(0, 10) <= ui.classificationHistoryTo) &&
          (!ui.classificationHistoryVariety || item.variety === ui.classificationHistoryVariety)
        );
        BlessERP.operacionesClasificacion.exportClassificationXlsx(appState, rows);
        return;
      }
      if (action.dataset.opsAction === "bunch-intake-scan") {
        const draft = stateApi.getUi(appState).bunchIntakeDraft;
        stateApi.scanBunchLabelIntoInventory(appState, draft.code, draft);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-intake-example") {
        stateApi.updateDraftField(appState, "bunchIntakeDraft", "code", "0000000002");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-intake-reset") {
        stateApi.resetBunchIntakeDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mixed-bunch-confirm") {
        stateApi.confirmMixedBunchIntake(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mixed-bunch-cancel") {
        stateApi.cancelMixedBunchIntake(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-report-export-xlsx") {
        const ui = stateApi.getUi(appState);
        try {
          const result = BlessERP.operacionesRamosReportXlsx?.exportBunchReportXlsx?.(appState, {
            from: ui.bunchReportFrom,
            to: ui.bunchReportTo
          }) || { ok: false, message: "El generador XLSX no esta disponible." };
          if (result.ok) {
            BlessERP.layout.toast(`Reporte Excel generado: ${result.report.records.length} ramos en ${result.sheets} hojas.`);
          } else {
            stateApi.setNotice(appState, result.message, "warning");
            rerender();
          }
        } catch (error) {
          stateApi.setNotice(appState, `No se pudo generar el reporte Excel: ${error.message}`, "warning");
          rerender();
        }
        return;
      }

      if (action.dataset.opsAction === "yield-workday-start") {
        stateApi.updateYieldWorkday(appState, "EN_CURSO_DEMO");
        BlessERP.layout.toast("Jornada demo de rendimientos iniciada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-pause") {
        stateApi.updateYieldWorkday(appState, "PAUSADA_DEMO");
        BlessERP.layout.toast("Jornada demo de rendimientos pausada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-resume") {
        stateApi.updateYieldWorkday(appState, "REANUDADA_DEMO");
        BlessERP.layout.toast("Jornada demo de rendimientos reanudada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-close") {
        stateApi.updateYieldWorkday(appState, "CERRADA_DEMO");
        BlessERP.layout.toast("Jornada demo de rendimientos cerrada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-mesh-save") {
        const entry = stateApi.registerYieldMeshProcessing(appState);
        BlessERP.layout.toast(`Mallas demo registradas: ${entry.id}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-mesh-reset") {
        stateApi.resetYieldMeshDraft(appState);
        BlessERP.layout.toast("Borrador de mallas procesadas reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "save-reception") {
        const entry = stateApi.registerReception(appState);
        if (entry) BlessERP.layout.toast(`Recepcion ${entry.wasUpdated ? "actualizada" : "registrada"}: ${entry.id}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-save") {
        stateApi.addOrUpdateReceptionItem(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-reset") {
        stateApi.resetReceptionItemDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-edit") {
        stateApi.editReceptionItem(appState, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-delete") {
        stateApi.removeReceptionItem(appState, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-edit") {
        stateApi.editReception(appState, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "clear-reception") {
        stateApi.resetReceptionDraft(appState);
        BlessERP.layout.toast("Borrador de recepcion reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-status") {
        stateApi.updateReceptionStatus(appState, action.dataset.id, action.dataset.status);
        BlessERP.layout.toast(`Recepcion demo actualizada a ${action.dataset.status}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "review-classification") {
        stateApi.reviewClassification(appState, action.dataset.id);
        BlessERP.layout.toast("Clasificacion demo marcada para cierre con motivo futuro");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "generate-labels") {
        const batch = stateApi.generateLabelBatch(appState);
        if (batch) {
          BlessERP.layout.toast(`${batch.count} etiqueta(s): ${batch.firstCode} a ${batch.lastCode}. Inventario: 0.`);
          BlessERP.operacionesEtiquetas.printLabels(batch.labels);
        }
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-print-draft") {
        stateApi.setNotice(appState, "Impresion demo preparada. No conecta impresora real ni Zebra.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-open-intake") {
        stateApi.updateDraftField(appState, "bunchIntakeDraft", "code", action.dataset.code || "");
        BlessERP.state.setRoute("operations-bunch-intake");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "clear-label-draft") {
        stateApi.resetLabelDraft(appState);
        BlessERP.layout.toast("Borrador de etiquetas reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-state") {
        const label = stateApi.getStore(appState).labelBatches.find(item => item.id === action.dataset.id);
        stateApi.updateLabelState(appState, action.dataset.id, action.dataset.status);
        if (action.dataset.status === "REIMPRESA" && label) BlessERP.operacionesEtiquetas.printLabels([label]);
        BlessERP.layout.toast(`Etiqueta demo marcada como ${action.dataset.status}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-state") {
        const updated = stateApi.updateInventoryState(appState, action.dataset.id, action.dataset.status);
        BlessERP.layout.toast(updated
          ? `Inventario demo actualizado a ${action.dataset.status}`
          : "El ramo ya esta asignado a una caja y no puede liberarse manualmente.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-status") {
        const adapterStatus = BlessERP.operacionesParte1Adapter?.getParte1AdapterStatus?.();
        stateApi.setNotice(
          appState,
          `Adapter Parte 1: ${adapterStatus?.status || "PENDIENTE_INTEGRACION_REAL"} / ${adapterStatus?.mode || "ADAPTADOR_DEMO"} / contratos: ${(adapterStatus?.supported_contracts || []).join(", ") || "sin definir"}.`,
          "info"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-validate") {
        const sampleRaw = BlessERP.operacionesParte1Adapter?.loadInventarioRosasFromParte1?.().rawRows?.[0];
        const review = BlessERP.operacionesParte1Adapter?.validateParte1InventoryPayload?.(sampleRaw);
        stateApi.setNotice(
          appState,
          review?.valid
            ? `Payload demo validado. Errores: 0. Advertencias: ${(review.warnings || []).length}.`
            : `Payload demo con observaciones. Errores: ${(review?.errors || []).length}. Advertencias: ${(review?.warnings || []).length}.`,
          review?.valid ? "info" : "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-map-inventory") {
        const sampleRaw = BlessERP.operacionesParte1Adapter?.loadInventarioRosasFromParte1?.().rawRows?.[0];
        const mapped = BlessERP.operacionesParte1Adapter?.mapParte1InventoryToOperationalInventoryContract?.(sampleRaw);
        stateApi.setNotice(
          appState,
          `Mapeo demo listo: ${mapped?.source_record_id || "-"} -> ${mapped?.inventory_id || "-"} / ${mapped?.variedad || "-"} / ${mapped?.ramos_disponibles || 0} ramos / ${mapped?.estado || "PENDIENTE_SINCRONIZACION"}.`,
          "info"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-warnings") {
        const warnings = BlessERP.operacionesParte1Adapter?.getParte1IntegrationWarnings?.() || [];
        stateApi.setNotice(
          appState,
          warnings.length ? `Advertencias del adapter Parte 1: ${warnings.join(" | ")}` : "Sin advertencias configuradas para el adapter Parte 1.",
          "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-reservations") {
        stateApi.setUiValue(appState, "selectedAvailabilityId", action.dataset.id);
        stateApi.setNotice(appState, "La demanda comercial se consulta sin apartar ramos; la asignacion ocurre al leer el ramo dentro del detalle operativo del pedido.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-send-commercial") {
        stateApi.setNotice(appState, "Comercial ya consulta el mismo stock y su demanda proyectada. No se crean reservas de ramos.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-release-reservation") {
        stateApi.releaseAvailabilityReservation(appState, action.dataset.reservationId);
        BlessERP.layout.toast("Reserva demo liberada desde Operaciones.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-open-commercial") {
        if (action.dataset.orderId) {
          BlessERP.comercialState?.openOrder?.(appState, action.dataset.orderId);
          BlessERP.comercialState?.setOrderTab?.(appState, "availability");
        }
        BlessERP.state.setRoute("commercial-order-master");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "simulate-scan") {
        const eventDemo = stateApi.simulateScan(appState);
        BlessERP.layout.toast(`Lectura demo registrada: ${eventDemo.code}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scan-demo") {
        const eventDemo = stateApi.simulateScan(appState);
        BlessERP.layout.toast(`Lectura demo registrada: ${eventDemo.codigo || eventDemo.code}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scan-box-demo") {
        const eventDemo = stateApi.simulateScan(appState, { code: "BOX-60334-001", type: "CAJA", tipo_codigo: "CAJA" });
        BlessERP.layout.toast(`Caja demo escaneada: ${eventDemo.codigo || eventDemo.code}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scan-dispatch-demo") {
        const eventDemo = stateApi.simulateScan(appState, { code: "DSP-60334", type: "DESPACHO", tipo_codigo: "DESPACHO" });
        BlessERP.layout.toast(`Despacho demo escaneado: ${eventDemo.codigo || eventDemo.code}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-clear-events") {
        stateApi.clearScannerEventsDemo(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-hid-start") {
        stateApi.startHidScannerDemo(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-hid-stop") {
        stateApi.stopHidScannerDemo(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-hid-clear") {
        stateApi.clearHidScannerInputDemo(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-hid-probe-box") {
        stateApi.processHidScannerInputDemo(appState, "BOX-60334-001", {
          source: "BOTON",
          routeId: "operations-scanner"
        });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-dispatch-scan") {
        const ui = stateApi.getUi(appState);
        stateApi.scanBoxForDispatchDemo(appState, ui.scannerDispatchPedidoId || "order-demo-0001", ui.scannerDispatchCode || ui.scannerDraft?.code || "");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-dispatch-reset") {
        const ui = stateApi.getUi(appState);
        stateApi.resetBoxScansForOrderDemo(appState, ui.scannerDispatchPedidoId || "order-demo-0001");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-dispatch-view") {
        const ui = stateApi.getUi(appState);
        stateApi.setUiValue(appState, "selectedDispatchOrderId", ui.scannerDispatchPedidoId || "order-demo-0001");
        stateApi.setNotice(appState, "Estado de cajas del pedido visible en Despacho operativo.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "scanner-disconnect") {
        stateApi.setNotice(appState, "Estado conexion: no conectado / demo. Zebra real pendiente.", "warning");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-state") {
        stateApi.updateDispatchState(appState, action.dataset.id, action.dataset.status);
        BlessERP.layout.toast(`Despacho demo actualizado a ${action.dataset.status}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-link-commercial") {
        stateApi.setNotice(appState, "Conexion futura preparada: Comercial / Pedido Maestro -> Despacho operativo.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-prepare") {
        stateApi.prepareDispatchDemo(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-ready") {
        stateApi.markDispatchReady(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-confirm") {
        const responsable = window.prompt("Responsable demo del despacho:", "") || "";
        if (!String(responsable).trim()) return;
        const observacion = window.prompt("Observacion del despacho demo:", "Despacho demo confirmado.") || "";
        stateApi.confirmDispatchDemo(appState, action.dataset.orderId, {
          responsable_demo: responsable,
          observacion
        });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-observe") {
        const motivo = window.prompt("Motivo de observacion del despacho:", "") || "";
        if (!String(motivo).trim()) return;
        stateApi.observeDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-cancel") {
        const motivo = window.prompt("Motivo de anulacion demo:", "Anulado desde despacho operativo demo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.cancelDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-reopen") {
        const motivo = window.prompt("Motivo de reapertura demo:", "Reabierto para revision operativa demo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.reopenDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-simulate") {
        stateApi.simulateConsumptionDemo(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-reverse") {
        const motivo = window.prompt("Motivo de reverso del consumo demo:", "Reverso demo desde despacho operativo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.reverseConsumptionDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-kardex") {
        stateApi.setNotice(appState, "Kardex operativo demo visible en Inventario de rosas. No corresponde al inventario real ni contabilidad.", "info");
        BlessERP.state.setRoute("operations-roses-inventory");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "dispatch-cycle-view") {
        const cycle = BlessERP.operacionesCycleDemo?.getOperationalCycleByOrderDemo?.(appState, action.dataset.orderId || "");
        stateApi.setNotice(
          appState,
          cycle
            ? `Ciclo operativo demo: ${cycle.estado_ciclo || "SIN_INICIAR"} / reservas ${cycle.reservas?.length || 0} / cajas ${cycle.cajas?.length || 0} / consumo ${cycle.consumos?.length || 0} / kardex ${cycle.kardex?.length || 0}.`
            : "Servicio de ciclo operativo demo no disponible.",
          cycle ? "info" : "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-clear-filters") {
        ["dispatchFilterState", "dispatchFilterDestination", "dispatchFilterBrand", "dispatchFilterFlightDate", "dispatchFilterSearch"].forEach(field => {
          stateApi.setUiValue(appState, field, "");
        });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-open-order") {
        if (action.dataset.orderId) {
          BlessERP.comercialState?.openOrder?.(appState, action.dataset.orderId);
          BlessERP.comercialState?.setOrderTab?.(appState, "dispatch");
        }
        BlessERP.state.setRoute("commercial-order-master");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "dispatch-print-doc") {
        openCommercialDocumentFromDispatch(appState, action.dataset.orderId, action.dataset.docCode);
        rerender();
        return;
      }
    });
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.operaciones = { render, bind };
})();
