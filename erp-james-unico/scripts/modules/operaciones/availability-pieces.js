(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const BUNCHES_PER_PIECE = 12;
  const PIECE_SIZE_OPTIONS = [4, 12, 14];

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizeBunchesPerPiece(value) {
    const parsed = Math.floor(number(value));
    return PIECE_SIZE_OPTIONS.includes(parsed) ? parsed : BUNCHES_PER_PIECE;
  }

  function availableBunches(row) {
    return Math.max(number(
      row?.spotAvailableBunches
      ?? row?.availableForSaleBunches
      ?? row?.availableBunches
      ?? row?.projectedBunches
    ), 0);
  }

  function isExactAvailability(row) {
    return !row?.openMixed && !row?.anyLength && Boolean(String(row?.variety || "").trim()) && number(row?.length) > 0;
  }

  function flexibleCandidates(entries, row) {
    const targetVariety = normalize(row?.variety);
    const excluded = new Set((row?.excludedVarieties || []).map(normalize));
    const targetLength = number(row?.length);
    const targetStems = number(row?.stemsPerBunch);
    return entries.filter(entry => {
      if (entry.available <= 0) return false;
      if (targetStems > 0 && entry.stemsPerBunch > 0 && entry.stemsPerBunch !== targetStems) return false;
      if (row?.openMixed) {
        if (excluded.has(normalize(entry.variety))) return false;
        if (!row?.anyLength && targetLength > 0 && entry.length !== targetLength) return false;
        return true;
      }
      return row?.anyLength && normalize(entry.variety) === targetVariety;
    });
  }

  function allocateFlexibleDemand(entries, availabilityRows) {
    (availabilityRows || [])
      // La medida abierta de una variedad fija sí puede proyectarse por FIFO.
      // Un MIXTO no se reparte entre variedades hasta que Bodega escanee las
      // etiquetas reales; el inventario exacto ya bajará con cada lectura.
      .filter(row => row?.anyLength && !row?.openMixed && !row?.pendingMixedPlaceholder)
      .forEach(row => {
        let pending = Math.max(number(row?.demandPendingBunches), 0);
        if (!pending) return;
        const candidates = flexibleCandidates(entries, row)
          .sort((left, right) =>
            String(left.oldestAdmission || "9999").localeCompare(String(right.oldestAdmission || "9999"))
            || left.variety.localeCompare(right.variety, "es")
            || left.length - right.length
          );
        candidates.forEach(candidate => {
          if (pending <= 0) return;
          const assigned = Math.min(candidate.available, pending);
          candidate.available -= assigned;
          pending -= assigned;
        });
      });
  }

  function buildRows(availabilityRows, options = {}) {
    const bunchesPerPiece = normalizeBunchesPerPiece(options.bunchesPerPiece);
    const entries = (availabilityRows || [])
      .filter(isExactAvailability)
      .map(row => ({
        variety: String(row.variety || "").trim(),
        length: number(row.length),
        stemsPerBunch: number(row.stemsPerBunch),
        oldestAdmission: row.oldestAdmission || "",
        available: availableBunches(row)
      }));

    allocateFlexibleDemand(entries, availabilityRows);

    const grouped = new Map();
    entries.forEach(entry => {
      if (entry.available <= 0) return;
      const key = `${normalize(entry.variety)}|${entry.length}`;
      const current = grouped.get(key) || {
        key,
        variety: entry.variety,
        length: entry.length,
        availableBunches: 0
      };
      current.availableBunches += entry.available;
      grouped.set(key, current);
    });

    return [...grouped.values()]
      .map(row => {
        const remainderBunches = row.availableBunches % bunchesPerPiece;
        return {
          ...row,
          bunchesPerPiece,
          pieces: Math.ceil(row.availableBunches / bunchesPerPiece),
          remainderBunches,
          missingBunches: remainderBunches === 0 ? 0 : bunchesPerPiece - remainderBunches,
          status: remainderBunches === 0 ? "PIEZA COMPLETA" : "PIEZA INCOMPLETA"
        };
      })
      .sort((left, right) => left.variety.localeCompare(right.variety, "es") || left.length - right.length);
  }

  function filterRows(rows, filters = {}) {
    const variety = normalize(filters.variety);
    const length = String(filters.length || "").trim().toUpperCase();
    return (rows || []).filter(row => {
      if (variety && variety !== "TODOS" && normalize(row.variety) !== variety) return false;
      if (length && length !== "TODOS" && length !== "CUALQUIER_MEDIDA" && number(row.length) !== number(length)) return false;
      if (length === "CUALQUIER_MEDIDA") return false;
      return true;
    });
  }

  function getRows(appState, filters = {}) {
    const availabilityRows = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(appState) || [];
    const ui = BlessERP.operacionesState?.getUi?.(appState) || {};
    const bunchesPerPiece = normalizeBunchesPerPiece(filters.bunchesPerPiece ?? ui.availabilityBunchesPerPiece);
    return filterRows(buildRows(availabilityRows, { bunchesPerPiece }), filters);
  }

  function buildCopyText(rows) {
    const header = ["NRO. PIEZA", "VARIEDAD", "MEDIDA"].join("\t");
    const lines = (rows || []).map(row => [
      row.pieces,
      String(row.variety || "").trim(),
      `${number(row.length)} CM`
    ].join("\t"));
    return ["DISPONIBILIDAD BLESS FLOWER", "", header, ...lines].join("\n");
  }

  async function writeText(text) {
    if (!String(text || "").trim()) throw new Error("No existe información para copiar.");
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return text;
      } catch {
        // En file:// algunos navegadores exponen Clipboard API, pero la bloquean.
      }
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("El navegador no permitió copiar la disponibilidad.");
    return text;
  }

  async function copyRows(rows) {
    return writeText(buildCopyText(rows));
  }

  BlessERP.operacionesAvailabilityPieces = {
    BUNCHES_PER_PIECE,
    PIECE_SIZE_OPTIONS,
    buildCopyText,
    buildRows,
    copyRows,
    filterRows,
    getRows,
    normalizeBunchesPerPiece,
    writeText
  };
})();
