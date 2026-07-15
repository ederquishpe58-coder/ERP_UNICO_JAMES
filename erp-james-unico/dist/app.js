(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  async function boot() {
    await BlessERP.menuService.refreshMenuFromProvider();
    BlessERP.state.refreshNavigationAccess();
    BlessERP.layout.bindNavigation();
    BlessERP.layout.renderApp();
    BlessERP.layout.toast("ERP JAMES UNICO listo");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
