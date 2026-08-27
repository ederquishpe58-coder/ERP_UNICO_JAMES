(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const PATTERNS = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"
  ];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function numericPayload(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function encodeNumeric(value) {
    const payload = numericPayload(value);
    if (!payload) return { payload: "", sequence: [] };

    const values = [];
    let cursor = 0;
    while (cursor + 1 < payload.length) {
      values.push(Number(payload.slice(cursor, cursor + 2)));
      cursor += 2;
    }
    if (cursor < payload.length) {
      values.push(100, payload.charCodeAt(cursor) - 32);
    }

    const start = 105;
    const checksum = (start + values.reduce((sum, item, index) => sum + (item * (index + 1)), 0)) % 103;
    return { payload, sequence: [start, ...values, checksum, 106] };
  }

  function barcodeBits(value) {
    const encoded = encodeNumeric(value);
    if (!encoded.sequence.length) return { payload: "", bits: "", moduleCount: 0 };
    let bits = "";
    encoded.sequence.forEach(code => {
      [...PATTERNS[code]].forEach((width, index) => {
        bits += (index % 2 === 0 ? "1" : "0").repeat(Number(width));
      });
    });
    return { payload: encoded.payload, bits, moduleCount: bits.length };
  }

  function barcodeSvg(value, options = {}) {
    const encoded = encodeNumeric(value);
    if (!encoded.sequence.length) return "";

    const height = Math.max(20, Number(options.height || 58));
    const quietZone = Math.max(10, Number(options.quietZone || 12));
    const className = String(options.className || "code128-barcode-svg").trim();
    let x = quietZone;
    const bars = [];

    encoded.sequence.forEach(code => {
      [...PATTERNS[code]].forEach((width, index) => {
        const size = Number(width);
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${size}" height="${height}"/>`);
        x += size;
      });
    });

    return `<svg class="${escapeHtml(className)}" viewBox="0 0 ${x + quietZone} ${height}" preserveAspectRatio="none" role="img" aria-label="Codigo de barras DAE ${escapeHtml(encoded.payload)}">${bars.join("")}</svg>`;
  }

  BlessERP.code128 = { barcodeBits, barcodeSvg, encodeNumeric, numericPayload };
})();
