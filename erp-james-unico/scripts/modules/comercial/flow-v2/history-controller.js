(function(){
  const B = window.BlessERP = window.BlessERP || {};
  const bindings = new WeakMap();
  function prepare(appState, filters) {
    const reader = B.commercialHistoryRead;
    if (!reader?.remote()) return null;
    const utils = B.comercialUtils, page = reader.view(appState, filters);
    const totals = order => {
      const summary = order._historyMetrics || {};
      const subtotal = utils.roundMoney(Number(summary.totalUsd || 0));
      const discount = utils.roundMoney(subtotal * utils.normalizeDiscountPercentage(order.discountPercentage ?? order.discount_percentage) / 100);
      return { boxes: Number(summary.totalBoxes || 0), total: utils.roundMoney(subtotal - discount + utils.roundMoney(order.taxAmount ?? order.tax_amount ?? 0)) };
    };
    const feedback = page.error ? '<div class="inline-feedback danger">' + utils.esc(page.error) + ' <button type="button" class="secondary-button" data-history-retry>Reintentar</button></div>'
      : page.loading ? '<div class="inline-feedback info">Consultando pedidos y clientes finales…</div>' : '';
    return { page, totals, feedback, name: (kind, id) => reader.name(appState, kind, id) };
  }
  function bind(container, appState, rerender) {
    bindings.get(container)?.abort();
    const controller = new window.AbortController();
    bindings.set(container, controller);
    const active = () => !controller.signal.aborted && container.isConnected && B.state.currentRoute()?.id === "commercial-order-history";
    const reader = B.commercialHistoryRead;
    if (reader?.remote()) {
      const company = B.commercialFlowV2.activeCompanyId(appState), filters = B.commercialFlowV2.sessionFor(appState).history;
      const pending = reader.view(appState, filters).loading;
      const loading = reader.load(appState, filters);
      if (pending) loading.finally(() => { if (active() && company === B.commercialFlowV2.activeCompanyId(appState)) rerender(); });
      window.addEventListener("erp:domain-loaded", event => {
        if (!active() || event.detail?.domain !== "commercial-catalog") return;
        reader.invalidate(); rerender();
      }, { signal: controller.signal });
    }
    return { signal: controller.signal, active };
  }
  async function prepareAction(appState, button, active) {
    const id = button.dataset.historyEdit || button.dataset.historyTrack || button.dataset.historySend || button.dataset.historyAnnul;
    if (!id || !B.commercialHistoryRead?.remote()) return true;
    button.disabled = true;
    try { await B.commercialHistoryRead.fullOrder(appState, id); return active(); }
    catch (error) { B.layout.toast(error.message, { tone: "danger" }); return false; }
    finally { if (button.isConnected) button.disabled = false; }
  }
  B.commercialHistoryController = { prepare, bind, prepareAction };
})();
