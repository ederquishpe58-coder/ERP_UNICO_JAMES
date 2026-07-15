(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const STORAGE_KEY = "erp-james-unico-db";
  const UI_KEY = "erp-james-unico-ui";

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

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return BlessERP.demo.createDemoDatabase();
      return mergeMissing(BlessERP.demo.createDemoDatabase(), JSON.parse(raw));
    } catch {
      return BlessERP.demo.createDemoDatabase();
    }
  }

  function save(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function reset() {
    const db = BlessERP.demo.createDemoDatabase();
    save(db);
    return db;
  }

  function loadUi() {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY) || "null") || {};
    } catch {
      return {};
    }
  }

  function saveUi(ui) {
    localStorage.setItem(UI_KEY, JSON.stringify(ui || {}));
  }

  BlessERP.storage = { STORAGE_KEY, UI_KEY, load, save, reset, loadUi, saveUi };
})();
