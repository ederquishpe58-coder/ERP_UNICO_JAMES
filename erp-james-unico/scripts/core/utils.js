(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function uid(prefix = "ID") {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
  }

  function today() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function money(value) {
    return new Intl.NumberFormat("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function number(value) {
    return new Intl.NumberFormat("es-EC").format(Number(value || 0));
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nextCustomerExternalId(rows = [], companyId = "", excludedId = "") {
    const targetCompany = String(companyId || "").trim();
    const ignoredId = String(excludedId || "").trim();
    const highest = (rows || []).reduce((max, item) => {
      if (!item || String(item.id || "").trim() === ignoredId) return max;
      const rowCompany = String(item.companyId || item.company_id || "").trim();
      if (targetCompany && rowCompany && rowCompany !== targetCompany) return max;
      const value = String(item.identification || item.taxId || "").trim().toUpperCase();
      const match = value.match(/^CE(\d+)$/);
      return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, 0);
    return `CE${String(highest + 1).padStart(4, "0")}`;
  }

  BlessERP.utils = { uid, today, money, number, esc, clone, nextCustomerExternalId };
})();
