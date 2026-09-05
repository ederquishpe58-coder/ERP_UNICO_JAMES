(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function valueOptions(values, current) {
    return [...new Set(values.filter(Boolean))].map(value => `<option value="${utils.esc(value)}" ${value === current ? "selected" : ""}>${utils.esc(value)}</option>`).join("");
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function nationalBreakdown(item = {}) {
    const nationalOidioStems = utils.parseNumber(item.nationalOidioStems);
    const nationalVellosoStems = utils.parseNumber(item.nationalVellosoStems);
    const nationalBotrytisStems = utils.parseNumber(item.nationalBotrytisStems);
    const nationalMaltratoStems = utils.parseNumber(item.nationalMaltratoStems);
    const detailedNationalStems = nationalOidioStems
      + nationalVellosoStems
      + nationalBotrytisStems
      + nationalMaltratoStems;
    const nationalStems = utils.parseNumber(item.nationalStems);
    const nationalGeneralStems = item.nationalGeneralStems === undefined
      ? Math.max(nationalStems - detailedNationalStems, 0)
      : utils.parseNumber(item.nationalGeneralStems);
    return {
      nationalStems,
      nationalGeneralStems,
      nationalOidioStems,
      nationalVellosoStems,
      nationalBotrytisStems,
      nationalMaltratoStems,
      classificationResultObservation: item.classificationResultObservation || ""
    };
  }

  function buildClassificationHistoryRows(assignments) {
    const groups = new Map();
    (assignments || []).filter(item => item.status !== "ANULADO").forEach(item => {
      const key = item.deliveryGroupId || `LEGACY:${item.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const deliveredRows = [...groups.values()].map(group => {
      const first = group[0];
      const totals = group.reduce((result, item) => {
        const national = nationalBreakdown(item);
        result.meshCount += utils.parseNumber(item.meshCount);
        result.extraStems += utils.parseNumber(item.extraStems);
        result.totalStems += utils.parseNumber(item.totalStems);
        result.nationalStems += national.nationalStems;
        result.nationalGeneralStems += national.nationalGeneralStems;
        result.nationalOidioStems += national.nationalOidioStems;
        result.nationalVellosoStems += national.nationalVellosoStems;
        result.nationalBotrytisStems += national.nationalBotrytisStems;
        result.nationalMaltratoStems += national.nationalMaltratoStems;
        return result;
      }, {
        meshCount: 0,
        extraStems: 0,
        totalStems: 0,
        nationalStems: 0,
        nationalGeneralStems: 0,
        nationalOidioStems: 0,
        nationalVellosoStems: 0,
        nationalBotrytisStems: 0,
        nationalMaltratoStems: 0
      });
      const completedNational = group.some(item => (
        item.status === "COMPLETADO"
        || item.status === "ENTREGADO + REGISTRADO NACIONAL"
        || utils.parseNumber(item.nationalStems) > 0
      ));
      const receptionIds = [...new Set(group.map(item => item.receptionId).filter(Boolean))];
      return {
        ...first,
        ...totals,
        id: first.id,
        deliveryGroupId: first.deliveryGroupId || "",
        assignmentIds: group.map(item => item.id),
        receptionIds,
        receptionCount: receptionIds.length,
        meshCount: first.deliveryRequestedMeshes === undefined ? totals.meshCount : utils.parseNumber(first.deliveryRequestedMeshes),
        extraStems: first.deliveryRequestedExtraStems === undefined ? totals.extraStems : utils.parseNumber(first.deliveryRequestedExtraStems),
        status: completedNational ? "ENTREGADO + REGISTRADO NACIONAL" : "ENTREGADO"
      };
    });
    return deliveredRows
      .sort((left, right) => String(right.dateTime || "").localeCompare(String(left.dateTime || "")));
  }

  function getClassificationHistoryRows(appState) {
    const store = stateApi.getStore(appState);
    return buildClassificationHistoryRows(store.classifierAssignments || [], stateApi.getReceptionQueue(appState));
  }

  function exportClassificationXlsx(appState, rows) {
    const escapeXml = value => String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const cells = row => row.map(value => Number.isFinite(value)
      ? `<c t="n"><v>${value}</v></c>`
      : `<c t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
    ).join("");
    const totals = rows.reduce((result, item) => ({
      meshCount: result.meshCount + utils.parseNumber(item.meshCount),
      extraStems: result.extraStems + utils.parseNumber(item.extraStems),
      totalStems: result.totalStems + utils.parseNumber(item.totalStems),
      nationalStems: result.nationalStems + utils.parseNumber(item.nationalStems),
      nationalGeneralStems: result.nationalGeneralStems + utils.parseNumber(item.nationalGeneralStems),
      nationalOidioStems: result.nationalOidioStems + utils.parseNumber(item.nationalOidioStems),
      nationalVellosoStems: result.nationalVellosoStems + utils.parseNumber(item.nationalVellosoStems),
      nationalBotrytisStems: result.nationalBotrytisStems + utils.parseNumber(item.nationalBotrytisStems),
      nationalMaltratoStems: result.nationalMaltratoStems + utils.parseNumber(item.nationalMaltratoStems)
    }), {
      meshCount: 0,
      extraStems: 0,
      totalStems: 0,
      nationalStems: 0,
      nationalGeneralStems: 0,
      nationalOidioStems: 0,
      nationalVellosoStems: 0,
      nationalBotrytisStems: 0,
      nationalMaltratoStems: 0
    });
    const sheetRows = [
      ["Fecha y hora", "Bloque", "Proveedor", "Variedad", "Tipo de tallo", "Clasificador", "Mallas", "Tallos extras", "Total tallos", "Total nacional", "Nacional general", "O", "V", "B", "M", "Estado", "Observacion"],
      ...rows.map(item => [
        item.dateTime,
        item.block,
        item.supplier,
        item.variety,
        item.stemType || "",
        item.classifier,
        utils.parseNumber(item.meshCount),
        utils.parseNumber(item.extraStems),
        utils.parseNumber(item.totalStems),
        utils.parseNumber(item.nationalStems),
        utils.parseNumber(item.nationalGeneralStems),
        utils.parseNumber(item.nationalOidioStems),
        utils.parseNumber(item.nationalVellosoStems),
        utils.parseNumber(item.nationalBotrytisStems),
        utils.parseNumber(item.nationalMaltratoStems),
        item.status,
        item.classificationResultObservation || ""
      ]),
      ["TOTALES", "", "", "", "", "", totals.meshCount, totals.extraStems, totals.totalStems, totals.nationalStems, totals.nationalGeneralStems, totals.nationalOidioStems, totals.nationalVellosoStems, totals.nationalBotrytisStems, totals.nationalMaltratoStems, "", ""]
    ].map(row => `<row>${cells(row)}</row>`).join("");
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Entregas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    };
    const encoder = new TextEncoder();
    const crcTable = (() => { const table = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; } return table; })();
    const crc32 = bytes => { let c = 0xffffffff; bytes.forEach(byte => { c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); }); return (c ^ 0xffffffff) >>> 0; };
    const u16 = value => new Uint8Array([value & 255, (value >>> 8) & 255]);
    const u32 = value => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
    const concat = arrays => { const result = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0)); let offset = 0; arrays.forEach(item => { result.set(item, offset); offset += item.length; }); return result; };
    const chunks = []; const central = []; let offset = 0;
    Object.entries(files).forEach(([name, content]) => { const nameBytes = encoder.encode(name); const data = encoder.encode(content); const crc = crc32(data); const local = concat([new Uint8Array([80, 75, 3, 4]), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]); chunks.push(local); central.push(concat([new Uint8Array([80, 75, 1, 2]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes])); offset += local.length; });
    const directory = concat(central); const archive = concat([...chunks, directory, concat([new Uint8Array([80, 75, 5, 6]), u16(0), u16(0), u16(0), u16(0), u32(directory.length), u32(offset), u16(0)])]);
    // Replace the two count fields after constructing the directory without relying on compression.
    const count = Object.keys(files).length; archive.set(u16(count), offset + directory.length + 8); archive.set(u16(count), offset + directory.length + 10);
    const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `historial-clasificadores-${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    stateApi.setNotice(appState, `${rows.length} entrega(s) exportada(s) a Excel.`, "success");
  }

  function render(appState, route) {
    const search = BlessERP.operacionesReceptionClassificationSearch;
    if (search?.isOpen?.("classificationReceipts")) return search.renderClassificationReceipts(route);
    if (search?.isOpen?.("classificationDeliveries")) return search.renderClassificationDeliveries(route);
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const assignmentDraft = ui.classificationAssignmentDraft;
    const resultDraft = ui.classificationResultDraft;
    const assignments = store.classifierAssignments || [];
    const receptionItems = stateApi.getReceptionQueue(appState).flatMap(reception => reception.classificationProgress.lines
      .filter(item => item.pendingStems > 0 && !["CERRADO", "ANULADO"].includes(reception.status))
      .map(item => ({
        ...item,
        receptionId: reception.id,
        receptionDate: reception.date,
        supplier: reception.supplier,
        block: reception.block,
        receptionStatus: reception.status
      })));
    const assignmentBlockMap = new Map();
    receptionItems.forEach(item => {
      const key = normalize(item.block);
      if (key && !assignmentBlockMap.has(key)) {
        assignmentBlockMap.set(key, {
          block: item.block,
          supplier: item.supplier,
          pending: true
        });
      }
    });
    (store.masterData?.suppliers || [])
      .filter(item => item.active !== false && item.assignedBlock)
      .forEach(item => {
        const key = normalize(item.assignedBlock);
        if (!assignmentBlockMap.has(key)) {
          assignmentBlockMap.set(key, {
            block: item.assignedBlock,
            supplier: item.name,
            pending: false
          });
        }
      });
    const assignmentBlockOptions = [...assignmentBlockMap.values()].sort((left, right) => (
      Number(right.pending) - Number(left.pending)
      || String(left.block || "").localeCompare(String(right.block || ""))
    ));
    const assignmentQuality = BlessERP.flowerQuality.normalize(assignmentDraft.quality) || "PREMIUM";
    const assignmentVarieties = [...new Set(receptionItems.filter(item => (
      normalize(item.block) === normalize(assignmentDraft.block)
      && BlessERP.flowerQuality.normalize(item.quality) === assignmentQuality
    )).map(item => item.variety))];
    const selectedReceptionItem = receptionItems.find(item => (
      normalize(item.block) === normalize(assignmentDraft.block)
      && normalize(item.variety) === normalize(assignmentDraft.variety)
      && BlessERP.flowerQuality.normalize(item.quality) === assignmentQuality
    ));
    const compatibleReceptionItems = selectedReceptionItem
      ? receptionItems.filter(item => (
          normalize(item.block) === normalize(selectedReceptionItem.block)
          && normalize(item.supplier) === normalize(selectedReceptionItem.supplier)
          && normalize(item.variety) === normalize(selectedReceptionItem.variety)
          && normalize(item.stemType || "LARGO") === normalize(selectedReceptionItem.stemType || "LARGO")
          && BlessERP.flowerQuality.normalize(item.quality) === assignmentQuality
          && utils.parseNumber(item.stemsPerMesh) === utils.parseNumber(selectedReceptionItem.stemsPerMesh)
        ))
      : [];
    const compatibleReceptionCount = new Set(compatibleReceptionItems.map(item => item.receptionId).filter(Boolean)).size;
    const accumulatedAvailableStems = compatibleReceptionItems.reduce((sum, item) => sum + utils.parseNumber(item.pendingStems), 0);
    const selectedStemsPerMesh = utils.parseNumber(selectedReceptionItem?.stemsPerMesh);
    const accumulatedAvailableMeshes = selectedStemsPerMesh > 0 ? Math.floor(accumulatedAvailableStems / selectedStemsPerMesh) : 0;
    const accumulatedAvailableExtras = selectedStemsPerMesh > 0 ? accumulatedAvailableStems % selectedStemsPerMesh : accumulatedAvailableStems;
    const resultAssignments = assignments.filter(item => item.status !== "ANULADO").slice().sort((left, right) => String(right.dateTime || "").localeCompare(String(left.dateTime || "")));
    const resultBlocks = [...new Set(resultAssignments.map(item => item.block))];
    const resultClassifiers = store.catalogs.classifiers || [];
    const resultVarieties = [...new Set(resultAssignments.filter(item => item.block === resultDraft.block && item.classifier === resultDraft.classifier).map(item => item.variety))];
    const resultCauseTotal = [
      resultDraft.nationalOidioStems,
      resultDraft.nationalVellosoStems,
      resultDraft.nationalBotrytisStems,
      resultDraft.nationalMaltratoStems
    ].reduce((sum, value) => sum + utils.parseNumber(value), 0);

    return `
      ${utils.renderPageHeader(route, "Clasificacion operativa activa", "authorized", "Controla la flor entregada al clasificador y el resultado nacional/rechazo sin crear inventario.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui, { hideNationalResult: true })}
      <div class="table-actions-inline ops-search-first-access"><button class="secondary-button" data-ops-search-action="open" data-view="classificationReceipts">Recepciones de flor</button><button class="secondary-button" data-ops-search-action="open" data-view="classificationDeliveries">Trabajo entregado</button></div>
      <section class="placeholder-grid ops-classification-grid">
        <article class="panel-card ops-classification-compact">
          <div class="panel-card-head"><div><p class="section-kicker">INGRESO AL CLASIFICADOR</p><h3>Entregar flor</h3></div><span class="status-badge partial">Sin inventario</span></div>
          <div class="ops-form-grid">
            <label class="compact-inline-field ops-classification-block-autocomplete"><span>Bloque / proveedor</span><input autocomplete="off" value="${utils.esc(assignmentDraft.block || "")}" placeholder="Escriba bloque o proveedor" data-ops-classification-block-input aria-autocomplete="list" aria-label="Buscar bloque o proveedor"><div class="ops-classification-block-menu" data-ops-classification-block-menu role="listbox">${assignmentBlockOptions.map(item => `<button type="button" role="option" data-ops-classification-block-option data-block="${utils.esc(item.block)}" data-supplier="${utils.esc(item.supplier)}"><strong>${utils.esc(item.block)}</strong><span>${utils.esc(item.supplier)}</span><small>${item.pending ? "FLOR PENDIENTE" : "PARAMETRIZADO"}</small></button>`).join("") || `<p>No existen bloques parametrizados.</p>`}</div></label>
            <label class="compact-inline-field"><span>Proveedor reconocido</span><input readonly data-ops-classification-supplier-display value="${utils.esc(assignmentDraft.supplier || "Seleccione un bloque")}"></label>
            <label class="compact-inline-field"><span>Variedad</span><select data-ops-bind="classificationAssignmentDraft" data-field="variety">${valueOptions(assignmentVarieties, assignmentDraft.variety)}</select></label>
            <label class="compact-inline-field"><span>Clasificador</span><select data-ops-bind="classificationAssignmentDraft" data-field="classifier">${store.catalogs.classifiers.map(item => `<option ${item === assignmentDraft.classifier ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
            <label class="compact-inline-field ops-quality-checkbox"><span>Calidad: ${utils.esc(BlessERP.flowerQuality.label(assignmentQuality))}</span><span class="ops-quality-checkbox-control"><input type="checkbox" data-ops-classifier-tipo-b ${BlessERP.flowerQuality.isTipoB(assignmentQuality) ? "checked" : ""}> TIPO B</span><small>Filtra y consume únicamente recepciones de esta calidad.</small></label>
            <label class="compact-inline-field"><span>Numero de mallas</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only value="${utils.esc(assignmentDraft.meshCount)}" data-ops-bind="classificationAssignmentDraft" data-field="meshCount"></label>
            <label class="compact-inline-field"><span>Tallos extras</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only value="${utils.esc(assignmentDraft.extraStems)}" data-ops-bind="classificationAssignmentDraft" data-field="extraStems"></label>
            <label class="compact-inline-field ops-classification-availability"><span>Disponible acumulado</span><input readonly value="${utils.esc(selectedReceptionItem ? `${accumulatedAvailableStems} tallos · ${accumulatedAvailableMeshes} mallas + ${accumulatedAvailableExtras} extras (${compatibleReceptionCount} recepcion(es))` : "Sin saldo compatible")}"><small>Se aplica por orden de llegada y sin mezclar quality.</small></label>
          </div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="classification-assignment-save">Registrar entrega</button><button class="secondary-button" data-ops-action="classification-assignment-reset">Limpiar</button></div>
        </article>
        <article class="panel-card ops-classification-compact">
          <div class="panel-card-head"><div><p class="section-kicker">RESULTADO</p><h3>Nacional o rechazo</h3></div><span class="status-badge pending">Cierre del clasificador</span></div>
          <div class="ops-form-grid">
            <label class="compact-inline-field"><span>Numero de bloque</span><input list="ops-result-blocks" autocomplete="off" value="${utils.esc(resultDraft.block || "")}" data-ops-bind="classificationResultDraft" data-field="block"><datalist id="ops-result-blocks">${resultBlocks.map(value => `<option value="${utils.esc(value)}"></option>`).join("")}</datalist></label>
            <label class="compact-inline-field"><span>Clasificador</span><select data-ops-bind="classificationResultDraft" data-field="classifier">${valueOptions(resultClassifiers, resultDraft.classifier)}</select></label>
            <label class="compact-inline-field"><span>Variedad</span><select data-ops-bind="classificationResultDraft" data-field="variety">${valueOptions(resultVarieties, resultDraft.variety)}</select></label>
            <label class="compact-inline-field"><span>Cantidad nacional / rechazo (general)</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only value="${utils.esc(resultDraft.nationalStems)}" data-ops-bind="classificationResultDraft" data-field="nationalStems"></label>
            <fieldset class="ops-national-causes ops-national-causes-wide">
              <legend>Nacional por causa (tallos)</legend>
              <div class="ops-national-cause-grid">
                <label title="Oidio"><span>O</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only aria-label="Tallos nacionales por oidio" value="${utils.esc(resultDraft.nationalOidioStems)}" data-ops-bind="classificationResultDraft" data-field="nationalOidioStems"></label>
                <label title="Velloso"><span>V</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only aria-label="Tallos nacionales por velloso" value="${utils.esc(resultDraft.nationalVellosoStems)}" data-ops-bind="classificationResultDraft" data-field="nationalVellosoStems"></label>
                <label title="Botritis"><span>B</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only aria-label="Tallos nacionales por botritis" value="${utils.esc(resultDraft.nationalBotrytisStems)}" data-ops-bind="classificationResultDraft" data-field="nationalBotrytisStems"></label>
                <label title="Maltrato"><span>M</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-ops-numeric-only aria-label="Tallos nacionales por maltrato" value="${utils.esc(resultDraft.nationalMaltratoStems)}" data-ops-bind="classificationResultDraft" data-field="nationalMaltratoStems"></label>
                <div class="ops-national-cause-total"><span>Total</span><strong data-ops-national-cause-total>${utils.number(resultCauseTotal)}</strong></div>
              </div>
              <small>Use O, V, B y M, o registre solamente la cantidad general.</small>
            </fieldset>
          </div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="classification-result-save">Registrar resultado</button><button class="secondary-button" data-ops-action="classification-result-reset">Limpiar</button></div>
        </article>
      </section>
    `;
  }

  BlessERP.operacionesClasificacion = {
    buildClassificationHistoryRows,
    exportClassificationXlsx,
    getClassificationHistoryRows,
    render
  };
})();
