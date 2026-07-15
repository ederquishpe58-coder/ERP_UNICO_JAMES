(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const MODES = Object.freeze({
    RANGE: "RANGO_IGUAL",
    MANUAL_MIX: "MIXTO_MANUAL",
    OPEN_MIX: "MIXTO_ABIERTO"
  });
  const ANY_LENGTH = "CUALQUIER_MEDIDA";

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function isAnyLengthValue(value) {
    return value === true || [ANY_LENGTH, "TRUE", "1"].includes(String(value || "").trim().toUpperCase());
  }

  function nextBoxNumber(order = {}) {
    return Math.max(0, ...(order.lines || []).map(line => number(line.boxNumber))) + 1;
  }

  function manualItem(seed = {}, index = 0) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-MIX-ITEM"),
      variety: seed.variety || (index === 0 ? "EXPLORER" : "MONDIAL"),
      length: Math.max(30, number(seed.length, 70)),
      anyLength: seed.anyLength === true || isAnyLengthValue(seed.lengthSelection),
      bunches: Math.max(1, number(seed.bunches, 1)),
      stemsPerBunch: Math.max(1, number(seed.stemsPerBunch, 25)),
      unitPrice: Math.max(0, number(seed.unitPrice, 0))
    };
  }

  function normalizeDraft(seed = {}, order = {}) {
    const items = Array.isArray(seed.manualItems) && seed.manualItems.length
      ? seed.manualItems
      : [manualItem({}, 0), manualItem({}, 1)];
    const mode = Object.values(MODES).includes(seed.mode) ? seed.mode : MODES.RANGE;
    const anyLength = seed.anyLength !== undefined
      ? Boolean(seed.anyLength)
      : seed.mixedAnyLength !== undefined
        ? Boolean(seed.mixedAnyLength)
        : mode === MODES.OPEN_MIX;
    return {
      mode,
      firstBox: Math.max(1, Math.floor(number(seed.firstBox, nextBoxNumber(order)))),
      quantity: Math.max(1, Math.min(200, Math.floor(number(seed.quantity, 1)))),
      boxType: seed.boxType || "QB",
      variety: seed.variety || "EXPLORER",
      length: Math.max(30, number(seed.length, 70)),
      anyLength,
      bunches: Math.max(1, number(seed.bunches, 1)),
      stemsPerBunch: Math.max(1, number(seed.stemsPerBunch, 25)),
      unitPrice: Math.max(0, number(seed.unitPrice, 0)),
      po: seed.po !== undefined ? String(seed.po) : String(order.generalPo || ""),
      excludedVarieties: seed.excludedVarieties !== undefined ? String(seed.excludedVarieties) : "",
      manualItems: items.map((item, index) => manualItem(item, index))
    };
  }

  function updateDraftField(draft, field, value) {
    if (!draft || field === "manualItems") return false;
    if (field === "lengthSelection") {
      draft.anyLength = isAnyLengthValue(value);
      if (!draft.anyLength) draft.length = Math.max(1, number(value, draft.length || 70));
      return true;
    }
    if (field === "anyLength") {
      draft.anyLength = isAnyLengthValue(value);
      return true;
    }
    if (!(field in draft)) return false;
    if (["firstBox", "quantity", "length", "bunches", "stemsPerBunch", "unitPrice"].includes(field)) {
      const parsed = number(value, 0);
      draft[field] = field === "unitPrice" ? Math.max(0, parsed) : Math.max(1, parsed);
      if (["firstBox", "quantity"].includes(field)) draft[field] = Math.floor(draft[field]);
      if (field === "quantity") draft.quantity = Math.min(200, draft.quantity);
    } else {
      draft[field] = String(value || "");
    }
    return true;
  }

  function updateManualItem(draft, itemId, field, value) {
    const item = draft?.manualItems?.find(entry => entry.id === itemId);
    if (!item || field === "id") return false;
    if (field === "lengthSelection") {
      item.anyLength = isAnyLengthValue(value);
      if (!item.anyLength) item.length = Math.max(1, number(value, item.length || 70));
      return true;
    }
    if (field === "anyLength") {
      item.anyLength = isAnyLengthValue(value);
      return true;
    }
    if (!(field in item)) return false;
    if (["length", "bunches", "stemsPerBunch", "unitPrice"].includes(field)) {
      const parsed = number(value, 0);
      item[field] = field === "unitPrice" ? Math.max(0, parsed) : Math.max(1, parsed);
    } else {
      item[field] = String(value || "");
    }
    return true;
  }

  function addManualItem(draft) {
    if (!draft) return null;
    const item = manualItem({}, draft.manualItems.length);
    draft.manualItems.push(item);
    return item;
  }

  function removeManualItem(draft, itemId) {
    if (!draft || draft.manualItems.length <= 2) return false;
    const index = draft.manualItems.findIndex(item => item.id === itemId);
    if (index < 0) return false;
    draft.manualItems.splice(index, 1);
    return true;
  }

  function excludedList(value) {
    return [...new Set(String(value || "").split(/[,;\n]/).map(item => item.trim().toUpperCase()).filter(Boolean))];
  }

  function validateDraft(draft, boxTypes = []) {
    const errors = [];
    if (!Number.isInteger(draft.firstBox) || draft.firstBox < 1) errors.push("La caja inicial debe ser un entero mayor a cero.");
    if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 200) errors.push("La cantidad de cajas debe estar entre 1 y 200.");
    if (!boxTypes.some(item => item.code === draft.boxType)) errors.push("Seleccione un tipo de caja valido.");

    if (draft.mode === MODES.RANGE) {
      if (!text(draft.variety)) errors.push("Seleccione la variedad.");
      if ((!draft.anyLength && draft.length <= 0) || draft.bunches <= 0 || draft.stemsPerBunch <= 0) errors.push("Complete medida, ramos y tallos por ramo.");
      if (draft.unitPrice <= 0) errors.push("Ingrese el precio manual por tallo.");
    }

    if (draft.mode === MODES.MANUAL_MIX) {
      if (!Array.isArray(draft.manualItems) || draft.manualItems.length < 2) errors.push("El mixto manual necesita al menos dos items.");
      (draft.manualItems || []).forEach((item, index) => {
        if (!text(item.variety)) errors.push(`Item ${index + 1}: seleccione variedad.`);
        if ((!item.anyLength && item.length <= 0) || item.bunches <= 0 || item.stemsPerBunch <= 0) errors.push(`Item ${index + 1}: complete medida, ramos y tallos.`);
        if (item.unitPrice <= 0) errors.push(`Item ${index + 1}: ingrese precio por tallo.`);
      });
    }

    if (draft.mode === MODES.OPEN_MIX) {
      if (!draft.anyLength && draft.length <= 0) errors.push("Seleccione la medida del mixto abierto.");
      if (draft.bunches <= 0 || draft.stemsPerBunch <= 0) errors.push("Complete ramos por caja y tallos por ramo.");
      if (draft.unitPrice <= 0) errors.push("Ingrese el precio comun por tallo del mixto abierto.");
    }
    return errors;
  }

  function buildLines(draft, options = {}) {
    const data = BlessERP.comercialData;
    const errors = validateDraft(draft, data.boxTypes || []);
    if (errors.length) return { ok: false, errors };

    const firstBox = Number(options.firstBox || draft.firstBox || 1);
    const lastBox = firstBox + draft.quantity - 1;
    const groupId = BlessERP.utils.uid("COM-BOX-GRP");
    const rangeLabel = `Cajas ${firstBox}-${lastBox}`;
    const lines = [];
    const boxNumbers = [];

    for (let index = 0; index < draft.quantity; index += 1) {
      const boxNumber = firstBox + index;
      boxNumbers.push(boxNumber);
      const common = {
        boxNumber,
        boxType: draft.boxType,
        po: draft.po || options.generalPo || "",
        boxRangeId: groupId,
        boxRangeSequence: index + 1,
        boxRangeTotal: draft.quantity,
        boxRangeLabel: rangeLabel,
        boxBuildGroupId: groupId,
        addedRevision: options.revisionNumber || 1,
        state: "borrador"
      };

      if (draft.mode === MODES.RANGE) {
        lines.push(data.createLine({
          ...common,
          boxBuildMode: MODES.RANGE,
          variety: draft.variety,
          length: draft.length,
          anyLength: Boolean(draft.anyLength),
          bunches: draft.bunches,
          stemsPerBunch: draft.stemsPerBunch,
          unitPrice: draft.unitPrice
        }));
      }

      if (draft.mode === MODES.MANUAL_MIX) {
        draft.manualItems.forEach(item => lines.push(data.createLine({
          ...common,
          boxBuildMode: MODES.MANUAL_MIX,
          variety: item.variety,
          length: item.length,
          anyLength: Boolean(item.anyLength),
          bunches: item.bunches,
          stemsPerBunch: item.stemsPerBunch,
          unitPrice: item.unitPrice
        })));
      }

      if (draft.mode === MODES.OPEN_MIX) {
        lines.push(data.createLine({
          ...common,
          boxBuildMode: MODES.OPEN_MIX,
          variety: "MIXTO ABIERTO",
          length: draft.length,
          anyLength: Boolean(draft.anyLength),
          bunches: draft.bunches,
          stemsPerBunch: draft.stemsPerBunch,
          unitPrice: draft.unitPrice,
          mixedAnyLength: Boolean(draft.anyLength),
          mixedExcludedVarieties: excludedList(draft.excludedVarieties),
          mixedActualComposition: []
        }));
      }
    }

    const labels = {
      [MODES.RANGE]: "Rango de cajas iguales",
      [MODES.MANUAL_MIX]: "Mixto manual",
      [MODES.OPEN_MIX]: "Mixto abierto"
    };
    return { ok: true, mode: draft.mode, modeLabel: labels[draft.mode], groupId, rangeLabel, firstBox, lastBox, boxNumbers, lines };
  }

  BlessERP.comercialBoxBuilder = {
    ANY_LENGTH,
    MODES,
    addManualItem,
    buildLines,
    excludedList,
    isAnyLengthValue,
    normalizeDraft,
    removeManualItem,
    updateDraftField,
    updateManualItem,
    validateDraft
  };
})();
