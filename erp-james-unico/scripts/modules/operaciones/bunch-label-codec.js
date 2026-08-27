(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const COLOR_CODES = {
    ROJO: "RJ",
    AZUL: "AZ",
    VERDE: "VD",
    AMARILLO: "AM",
    NARANJA: "NJ",
    BLANCO: "BL",
    ROSADO: "RS",
    MORADO: "MR"
  };

  function text(value) {
    return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function token(value) {
    return text(value).replace(/[^A-Z0-9-]+/g, "");
  }

  function varietyCode(value) {
    const words = text(value).replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    return words.length === 1 ? words[0].slice(0, 3) : words.map(word => word.slice(0, 3)).join("").slice(0, 8);
  }

  function colorCode(value) {
    const normalized = text(value);
    return COLOR_CODES[normalized] || token(normalized).slice(0, 2);
  }

  function supplierCode(value) {
    const normalized = token(value);
    const digits = normalized.replace(/\D+/g, "");
    if (digits) return `P${digits.padStart(3, "0").slice(-3)}`;
    return normalized.slice(0, 6);
  }

  function blockCode(value) {
    return token(value).slice(0, 8);
  }

  function transportToken(value, maximum) {
    return text(value).replace(/[^A-Z0-9]+/g, "").slice(0, maximum);
  }

  function uniqueCode() {
    const bytes = new Uint8Array(3);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else {
      const seed = Date.now();
      bytes.forEach((_, index) => { bytes[index] = (seed >> (index * 8)) & 255; });
    }
    return Array.from(bytes, value => value.toString(36).padStart(2, "0")).join("").slice(0, 6).toUpperCase();
  }

  function normalizeStructuredCode(rawCode) {
    return text(rawCode).replace(/[\r\n\t ]+/g, "");
  }

  function isStructuredCode(rawCode) {
    const code = normalizeStructuredCode(rawCode);
    return code.startsWith("BF2") || code.startsWith("BF|");
  }

  function normalizedComponents(row) {
    return (row.components || [])
      .filter(item => item.provider || item.block || Number(item.stems || 0) > 0)
      .map(item => ({
        provider: transportToken(supplierCode(item.provider), 6),
        block: transportToken(blockCode(item.block), 8),
        stems: Math.max(0, Math.min(999, Math.trunc(Number(item.stems || 0))))
      }));
  }

  function encode(row) {
    const components = normalizedComponents(row);
    const total = (row.components || []).reduce((sum, item) => sum + Number(item.stems || 0), 0);
    const variety = varietyCode(row.variety).slice(0, 8);
    const length = String(Math.max(0, Math.min(999, Math.trunc(Number(row.length || 0))))).padStart(3, "0");
    const color = colorCode(row.color).padEnd(2, "X").slice(0, 2);
    const nonce = (token(row.nonce) || uniqueCode()).slice(0, 12);
    const componentData = components.map(item => (
      `${item.provider.length}${item.provider}${item.block.length}${item.block}${String(item.stems).padStart(3, "0")}`
    )).join("");
    return `BF2${variety.length}${variety}${length}${color}${components.length}${componentData}${String(Math.trunc(total)).padStart(3, "0")}${String(nonce.length).padStart(2, "0")}${nonce}`;
  }

  function catalogValues(store, type, fallbackKey) {
    const master = (store?.masterData?.[type] || []).filter(item => item.active !== false);
    if (master.length) return master;
    return (store?.catalogs?.[fallbackKey] || []).map((name, index) => ({ name: String(name), code: `${type.slice(0, 3).toUpperCase()}${index + 1}` }));
  }

  function resolveVariety(store, code) {
    return catalogValues(store, "varieties", "varieties").find(item => varietyCode(item.name) === code)?.name || code;
  }

  function resolveColor(store, code) {
    const buncherColors = catalogValues(store, "bunchers", "bunchers").map(item => item.labelColor || item.color).filter(Boolean);
    const colors = [...new Set([...buncherColors, ...(store?.catalogs?.dayColors || [])])];
    return colors.find(item => colorCode(item) === code) || code;
  }

  function resolveSupplier(store, code) {
    const found = catalogValues(store, "suppliers", "suppliers").find(item => transportToken(supplierCode(item.code || item.name), 6) === code);
    return found ? { code: supplierCode(found.code || found.name), name: found.name, item: found } : { code, name: code, item: null };
  }

  function resolveBlock(store, code, supplier) {
    const candidates = [supplier?.assignedBlock, supplier?.block];
    (store?.masterData?.blocks || []).forEach(item => candidates.push(item?.name || item?.code));
    (store?.catalogs?.blocks || []).forEach(item => candidates.push(typeof item === "string" ? item : (item?.name || item?.code)));
    return candidates.find(value => transportToken(value, 8) === code) || code;
  }

  function resolveBuncher(store, color) {
    const match = catalogValues(store, "bunchers", "bunchers").find(item => text(item.labelColor || item.color) === text(color));
    return match || null;
  }

  function decodedResult(store, values) {
    const color = resolveColor(store, values.colorToken);
    const buncher = resolveBuncher(store, color);
    return {
      ok: true,
      code: values.code,
      nonce: values.nonce,
      variety: resolveVariety(store, values.varietyToken),
      varietyCode: values.varietyToken,
      length: values.length,
      color,
      colorCode: values.colorToken,
      total: values.total,
      stemsPerBunch: values.total,
      components: values.components,
      type: values.components.length === 1 ? "INDIVIDUAL" : "MIXTO",
      supplier: values.components.length === 1 ? values.components[0].supplier : [...new Set(values.components.map(item => item.supplier))].join(" + "),
      block: values.components.length === 1 ? values.components[0].block : values.components.map(item => item.block).join(" + "),
      buncher: buncher?.name || color,
      buncherEmployeeId: buncher?.employee_id || buncher?.employeeId || ""
    };
  }

  function decodeV2(rawCode, store) {
    const code = normalizeStructuredCode(rawCode);
    let cursor = 3;
    const fail = error => ({ ok: false, error });
    const take = length => {
      const value = code.slice(cursor, cursor + length);
      cursor += length;
      return value;
    };
    const digit = label => {
      const value = take(1);
      if (!/^\d$/.test(value)) throw new Error(`Longitud de ${label} invalida.`);
      return Number(value);
    };
    try {
      if (!code.startsWith("BF2")) return fail("Formato de etiqueta BF2 invalido.");
      const varietyLength = digit("variedad");
      if (varietyLength < 1 || varietyLength > 8) return fail("La variedad de la etiqueta BF2 es invalida.");
      const varietyToken = take(varietyLength);
      const lengthText = take(3);
      const colorToken = take(2);
      const componentCount = digit("componentes");
      if (!/^\d{3}$/.test(lengthText) || !/^[A-Z0-9]{2}$/.test(colorToken) || componentCount < 1 || componentCount > 4) {
        return fail("La cabecera de la etiqueta BF2 es invalida.");
      }
      const components = [];
      for (let index = 0; index < componentCount; index += 1) {
        const providerLength = digit("proveedor");
        if (providerLength < 1 || providerLength > 6) return fail("El proveedor de la etiqueta BF2 es invalido.");
        const provider = take(providerLength);
        const blockLength = digit("bloque");
        if (blockLength < 1 || blockLength > 8) return fail("El bloque de la etiqueta BF2 es invalido.");
        const block = take(blockLength);
        const stemsText = take(3);
        if (!/^[A-Z0-9-]+$/.test(provider) || !/^[A-Z0-9-]+$/.test(block) || !/^\d{3}$/.test(stemsText)) {
          return fail("La composicion de la etiqueta BF2 es invalida.");
        }
        const resolved = resolveSupplier(store, provider);
        components.push({ provider: resolved.code, supplier: resolved.name, block: resolveBlock(store, block, resolved.item), stems: Number(stemsText) });
      }
      const totalText = take(3);
      const nonceLengthText = take(2);
      if (!/^\d{3}$/.test(totalText) || !/^\d{2}$/.test(nonceLengthText)) return fail("El total de la etiqueta BF2 es invalido.");
      const nonceLength = Number(nonceLengthText);
      if (nonceLength < 6 || nonceLength > 12) return fail("El identificador de la etiqueta BF2 es invalido.");
      const nonce = take(nonceLength);
      if (cursor !== code.length || !/^[A-Z0-9]+$/.test(nonce)) return fail("La etiqueta BF2 esta incompleta o contiene datos adicionales.");
      const total = Number(totalText);
      const componentTotal = components.reduce((sum, item) => sum + item.stems, 0);
      if (!varietyToken || !Number(lengthText) || components.some(item => item.stems <= 0)) {
        return fail("La etiqueta BF2 no contiene todos los datos obligatorios.");
      }
      if (componentTotal !== total) return fail(`La etiqueta declara ${total} tallos pero sus componentes suman ${componentTotal}.`);
      return decodedResult(store, { code, nonce, varietyToken, length: Number(lengthText), colorToken, total, components });
    } catch (error) {
      return fail(error?.message || "Formato de etiqueta BF2 incompleto.");
    }
  }

  function decodeLegacy(rawCode, store) {
    const code = normalizeStructuredCode(rawCode);
    const parts = code.split("|").filter(Boolean);
    if (parts[0] !== "BF" || parts.length < 7) return { ok: false, error: "Formato de etiqueta BF incompleto." };
    const varietyToken = parts[1];
    const length = Number(parts[2]);
    const colorToken = parts[3];
    const totalPart = parts.find(part => /^T\d+$/.test(part));
    const noncePart = parts.find(part => /^U[A-Z0-9]+$/.test(part));
    const componentParts = parts.slice(4).filter(part => !/^T\d+$/.test(part) && !/^U[A-Z0-9]+$/.test(part));
    const components = componentParts.map(part => {
      const [provider, block, stems] = part.split(":");
      const resolved = resolveSupplier(store, provider);
      return { provider: resolved.code, supplier: resolved.name, block, stems: Number(stems) };
    });
    const total = Number(String(totalPart || "T0").slice(1));
    if (!varietyToken || !length || !colorToken || !totalPart || !noncePart || !components.length) {
      return { ok: false, error: "La etiqueta BF no contiene todos los datos obligatorios." };
    }
    if (components.some(item => !item.provider || !item.block || !Number.isFinite(item.stems) || item.stems <= 0)) {
      return { ok: false, error: "La composición de la etiqueta BF es inválida." };
    }
    const componentTotal = components.reduce((sum, item) => sum + item.stems, 0);
    if (componentTotal !== total) return { ok: false, error: `La etiqueta declara ${total} tallos pero sus componentes suman ${componentTotal}.` };
    return decodedResult(store, { code, nonce: noncePart.slice(1), varietyToken, length, colorToken, total, components });
  }

  function decode(rawCode, store) {
    const code = normalizeStructuredCode(rawCode);
    if (code.startsWith("BF2")) return decodeV2(code, store);
    if (code.startsWith("BF|")) return decodeLegacy(code, store);
    return { ok: false, error: "El codigo no corresponde a una etiqueta BF compatible." };
  }

  function isCompleteCode(rawCode) {
    const code = normalizeStructuredCode(rawCode);
    if (code.startsWith("BF2")) return decodeV2(code, null).ok;
    return /^BF\|[^|]+\|\d+\|[A-Z0-9]+\|.+\|T\d+\|U[A-Z0-9]{6,12}$/.test(code)
      && decodeLegacy(code, null).ok;
  }

  BlessERP.bunchLabelCodec = {
    blockCode,
    colorCode,
    decode,
    encode,
    isCompleteCode,
    isStructuredCode,
    normalizeStructuredCode,
    supplierCode,
    text,
    uniqueCode,
    varietyCode
  };
})();
