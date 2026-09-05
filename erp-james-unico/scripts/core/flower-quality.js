(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const VALUES = Object.freeze(["PREMIUM", "TIPO_B"]);
  const VALUE_SET = new Set(VALUES);

  function raw(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function normalize(value) {
    const candidate = raw(value);
    return VALUE_SET.has(candidate) ? candidate : "";
  }

  function preserve(value) {
    return raw(value);
  }

  function isValid(value) {
    return Boolean(normalize(value));
  }

  function fromTipoB(checked) {
    return checked === true ? "TIPO_B" : "PREMIUM";
  }

  function isTipoB(value) {
    return normalize(value) === "TIPO_B";
  }

  function label(value, options = {}) {
    const canonical = normalize(value);
    if (canonical === "TIPO_B") return "TIPO B";
    if (canonical === "PREMIUM") return "PREMIUM";
    const historical = preserve(value);
    return historical && options.historical !== false ? historical : (options.empty || "SIN CALIDAD");
  }

  function options(selected, options = {}) {
    const current = preserve(selected);
    const placeholder = options.placeholder || "Seleccione calidad";
    const rows = [`<option value="" ${current ? "" : "selected"}>${placeholder}</option>`];
    if (current && !isValid(current)) rows.push(`<option value="${current}" selected disabled>${current} (HISTÓRICO)</option>`);
    VALUES.forEach(value => rows.push(`<option value="${value}" ${current === value ? "selected" : ""}>${label(value)}</option>`));
    return rows.join("");
  }

  BlessERP.flowerQuality = Object.freeze({
    VALUES,
    fromTipoB,
    isTipoB,
    isValid,
    label,
    normalize,
    options,
    preserve
  });
})();
