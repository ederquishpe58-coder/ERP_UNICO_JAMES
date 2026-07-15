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

  function exportClassificationXlsx(appState, rows) {
    const escapeXml = value => String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const cells = row => row.map(value => `<c t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("");
    const sheetRows = [
      ["Fecha y hora", "Bloque", "Proveedor", "Variedad", "Clasificador", "Mallas", "Tallos extras", "Total tallos", "Estado"],
      ...rows.map(item => [item.dateTime, item.block, item.supplier, item.variety, item.classifier, item.meshCount, item.extraStems, item.totalStems, item.status])
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
    const assignmentBlocks = [...new Set(receptionItems.map(item => item.block))];
    const assignmentVarieties = [...new Set(receptionItems.filter(item => normalize(item.block) === normalize(assignmentDraft.block)).map(item => item.variety))];
    const selectedReceptionItem = receptionItems.find(item => item.block === assignmentDraft.block && item.variety === assignmentDraft.variety);
    const pendingResults = assignments.filter(item => item.status === "ENTREGADO").slice().sort((left, right) => String(right.dateTime || "").localeCompare(String(left.dateTime || "")));
    const resultBlocks = [...new Set(pendingResults.map(item => item.block))];
    const resultClassifiers = store.catalogs.classifiers || [];
    const resultVarieties = [...new Set(pendingResults.filter(item => item.block === resultDraft.block && item.classifier === resultDraft.classifier).map(item => item.variety))];
    const selectedAssignment = pendingResults.find(item => item.id === resultDraft.assignmentId) || pendingResults.find(item => item.supplier === resultDraft.supplier && item.classifier === resultDraft.classifier && item.variety === resultDraft.variety);
    const totalAssigned = assignments.reduce((sum, item) => sum + utils.parseNumber(item.totalStems), 0);
    const totalNational = assignments.reduce((sum, item) => sum + utils.parseNumber(item.nationalStems), 0);

    return `
      ${utils.renderPageHeader(route, "Clasificacion operativa activa demo", "authorized", "Controla flor entregada al clasificador y nacional/rechazo. No genera inventario.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner"><div><strong>Clasificacion controla trabajo, no inventario</strong><span>Los datos de proveedor, variedad y tallos por malla se reutilizan desde la recepcion seleccionada.</span></div></section>
      ${utils.renderSummaryCards([
        { label: "Entregas", value: utils.number(assignments.length), help: "Trabajo entregado" },
        { label: "Tallos entregados", value: utils.number(totalAssigned), help: "Desde recepciones" },
        { label: "Nacional / rechazo", value: utils.number(totalNational), help: "Resultado registrado" },
        { label: "Pendientes", value: utils.number(assignments.filter(item => item.status === "ENTREGADO").length), help: "Por completar" }
      ])}
      <section class="placeholder-grid ops-classification-grid">
        <article class="panel-card ops-classification-compact">
          <div class="panel-card-head"><div><p class="section-kicker">INGRESO AL CLASIFICADOR</p><h3>Entregar flor</h3></div><span class="status-badge partial">Sin inventario</span></div>
          <div class="ops-form-grid">
            <label class="compact-inline-field"><span>Numero de bloque</span><input list="ops-classification-blocks" autocomplete="off" value="${utils.esc(assignmentDraft.block || "")}" data-ops-bind="classificationAssignmentDraft" data-field="block"><datalist id="ops-classification-blocks">${assignmentBlocks.map(value => `<option value="${utils.esc(value)}"></option>`).join("")}</datalist></label>
            <label class="compact-inline-field"><span>Proveedor reconocido</span><input readonly value="${utils.esc(assignmentDraft.supplier || "Seleccione un bloque")}"></label>
            <label class="compact-inline-field"><span>Variedad</span><select data-ops-bind="classificationAssignmentDraft" data-field="variety">${valueOptions(assignmentVarieties, assignmentDraft.variety)}</select></label>
            <label class="compact-inline-field"><span>Clasificador</span><select data-ops-bind="classificationAssignmentDraft" data-field="classifier">${store.catalogs.classifiers.map(item => `<option ${item === assignmentDraft.classifier ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
            <label class="compact-inline-field"><span>Numero de mallas</span><input type="number" min="1" value="${utils.esc(assignmentDraft.meshCount)}" data-ops-bind="classificationAssignmentDraft" data-field="meshCount"></label>
            <label class="compact-inline-field"><span>Tallos extras</span><input type="number" min="0" value="${utils.esc(assignmentDraft.extraStems)}" data-ops-bind="classificationAssignmentDraft" data-field="extraStems"></label>
          </div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="classification-assignment-save">Registrar entrega</button><button class="secondary-button" data-ops-action="classification-assignment-reset">Limpiar</button></div>
        </article>
        <article class="panel-card ops-classification-compact">
          <div class="panel-card-head"><div><p class="section-kicker">RESULTADO</p><h3>Nacional o rechazo</h3></div><span class="status-badge pending">Cierre del clasificador</span></div>
          <div class="ops-form-grid">
            <label class="compact-inline-field"><span>Numero de bloque</span><input list="ops-result-blocks" autocomplete="off" value="${utils.esc(resultDraft.block || "")}" data-ops-bind="classificationResultDraft" data-field="block"><datalist id="ops-result-blocks">${resultBlocks.map(value => `<option value="${utils.esc(value)}"></option>`).join("")}</datalist></label>
            <label class="compact-inline-field"><span>Proveedor reconocido</span><input readonly value="${utils.esc(resultDraft.supplier || "Seleccione un bloque")}"></label>
            <label class="compact-inline-field"><span>Clasificador</span><select data-ops-bind="classificationResultDraft" data-field="classifier">${valueOptions(resultClassifiers, resultDraft.classifier)}</select></label>
            <label class="compact-inline-field"><span>Variedad</span><select data-ops-bind="classificationResultDraft" data-field="variety">${valueOptions(resultVarieties, resultDraft.variety)}</select></label>
            <label class="compact-inline-field"><span>Cantidad nacional / rechazo</span><input type="number" min="0" value="${utils.esc(resultDraft.nationalStems)}" data-ops-bind="classificationResultDraft" data-field="nationalStems"></label>
            <label class="compact-inline-field"><span>Entrega aplicada</span><input readonly value="${utils.esc(selectedAssignment ? `${String(selectedAssignment.dateTime || "").slice(0, 10)} · ${selectedAssignment.totalStems} tallos` : "Sin entrega pendiente")}"></label>
            <label class="compact-inline-field ops-form-span-2"><span>Observacion</span><textarea rows="2" data-ops-bind="classificationResultDraft" data-field="observation">${utils.esc(resultDraft.observation)}</textarea></label>
          </div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="classification-result-save">Registrar resultado</button><button class="secondary-button" data-ops-action="classification-result-reset">Limpiar</button></div>
        </article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">HISTORIAL</p><h3>Trabajo entregado a clasificadores</h3></div><button class="secondary-button" data-ops-action="classification-export-xlsx">Descargar Excel</button></div>
        <div class="ops-form-grid ops-filter-grid">
          <label class="compact-inline-field"><span>Desde</span><input type="date" data-ops-ui-field="classificationHistoryFrom" value="${utils.esc(ui.classificationHistoryFrom || "")}"></label>
          <label class="compact-inline-field"><span>Hasta</span><input type="date" data-ops-ui-field="classificationHistoryTo" value="${utils.esc(ui.classificationHistoryTo || "")}"></label>
          <label class="compact-inline-field"><span>Variedad</span><select data-ops-ui-field="classificationHistoryVariety"><option value="">Todas</option>${valueOptions([...new Set(assignments.map(item => item.variety))], ui.classificationHistoryVariety)}</select></label>
        </div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Fecha y hora</th><th>Bloque</th><th>Clasificador</th><th>Proveedor</th><th>Variedad</th><th>Mallas</th><th>Extras</th><th>Total tallos</th><th>Estado</th></tr></thead>
          <tbody>${assignments.filter(item => (!ui.classificationHistoryFrom || String(item.dateTime).slice(0, 10) >= ui.classificationHistoryFrom) && (!ui.classificationHistoryTo || String(item.dateTime).slice(0, 10) <= ui.classificationHistoryTo) && (!ui.classificationHistoryVariety || item.variety === ui.classificationHistoryVariety)).map(item => `<tr>
            <td>${utils.esc(item.dateTime)}</td><td>${utils.esc(item.block)}</td><td>${utils.esc(item.classifier)}</td><td>${utils.esc(item.supplier)}</td><td>${utils.esc(item.variety)}</td>
            <td>${utils.number(item.meshCount)}</td><td>${utils.number(item.extraStems)}</td><td>${utils.number(item.totalStems)}</td>
            <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
          </tr>`).join("") || `<tr><td colspan="9">Sin entregas al clasificador con estos filtros.</td></tr>`}</tbody>
        </table></div>
      </section>
    `;
  }

  BlessERP.operacionesClasificacion = { render, exportClassificationXlsx };
})();
