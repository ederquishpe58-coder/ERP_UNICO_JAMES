(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render(appState) {
    BlessERP.operacionesAvailabilityPolicy?.synchronizeDueOrders?.(appState);
    return BlessERP.comercialPedidoDemandView.renderAvailability(null, appState, {
      standalone: true,
      context: "operations",
      commercialAccess: true
    });
  }

  function bind(container, appState) {
    if (!container || container.dataset.commercialAvailabilityBound === "true") return;
    container.dataset.commercialAvailabilityBound = "true";
    const stateApi = BlessERP.operacionesState;
    const rerender = () => BlessERP.layout?.renderPage?.();

    container.addEventListener("change", event => {
      const uiField = event.target.closest("[data-ops-ui-field]");
      if (!uiField) return;
      stateApi?.setUiValue?.(appState, uiField.dataset.opsUiField, uiField.value);
      if (["availabilityFilterVariety", "availabilityFilterLength"].includes(uiField.dataset.opsUiField)) {
        BlessERP.performance?.resetPage?.("commercial-availability");
      }
      rerender();
    });

    container.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !event.target.closest("[data-ops-availability-pieces-dialog]")) return;
      event.preventDefault();
      stateApi?.setUiValue?.(appState, "availabilityPiecesOpen", false);
      rerender();
    });

    container.addEventListener("click", async event => {
      const uiButton = event.target.closest("[data-ops-ui-field][data-value]");
      if (uiButton) {
        stateApi?.setUiValue?.(appState, uiButton.dataset.opsUiField, uiButton.dataset.value);
        rerender();
        return;
      }
      const action = event.target.closest("[data-ops-action]");
      if (!action) return;
      const operation = action.dataset.opsAction;
      if (operation === "availability-pieces-open" || operation === "availability-pieces-close") {
        stateApi?.setUiValue?.(appState, "availabilityLastUpdated", new Date().toISOString());
        stateApi?.setUiValue?.(appState, "availabilityPiecesOpen", operation === "availability-pieces-open");
        rerender();
        return;
      }
      if (operation === "availability-pieces-copy") {
        const ui = stateApi?.getUi?.(appState) || {};
        const rows = BlessERP.operacionesAvailabilityPieces?.getRows?.(appState, {
          variety: ui.availabilityFilterVariety || "TODOS",
          length: ui.availabilityFilterLength || "TODOS",
          bunchesPerPiece: ui.availabilityBunchesPerPiece
        }) || [];
        try {
          await BlessERP.operacionesAvailabilityPieces?.copyRows?.(rows);
          BlessERP.layout?.toast?.(`${rows.length} fila(s) copiadas: pieza, variedad y medida.`);
        } catch (error) {
          BlessERP.layout?.toast?.(error?.message || "No se pudo copiar la disponibilidad.");
        }
        return;
      }
      if (operation === "availability-reserve-order" || operation === "availability-release-order") {
        const reserve = operation === "availability-reserve-order";
        const result = BlessERP.operacionesAvailabilityPolicy?.setFutureReservation?.(
          appState,
          action.dataset.orderId || "",
          reserve
        );
        BlessERP.layout?.toast?.(result?.ok
          ? reserve
            ? "Reserva aplicada. El pedido ya descuenta la disponibilidad."
            : "Reserva liberada. La flor volvió al Disponible Spot."
          : result?.error || "No se pudo actualizar la reserva futura.");
        if (result?.ok) rerender();
        return;
      }
      if (operation === "availability-refresh") {
        BlessERP.operacionesAvailabilityPolicy?.synchronizeDueOrders?.(appState, { force: true });
        stateApi?.setUiValue?.(appState, "availabilityLastUpdated", new Date().toISOString());
        rerender();
      }
    });
  }

  BlessERP.comercialAvailability = { bind, render };
})();
