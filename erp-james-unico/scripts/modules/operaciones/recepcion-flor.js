(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function optionList(values, current) {
    return values.map(item => `<option value="${utils.esc(item)}" ${item === current ? "selected" : ""}>${utils.esc(item)}</option>`).join("");
  }

  function filterOptionList(values, current, emptyLabel) {
    return `<option value="">${utils.esc(emptyLabel)}</option>${[...new Set(values.filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right)))
      .map(item => `<option value="${utils.esc(item)}" ${item === current ? "selected" : ""}>${utils.esc(item)}</option>`)
      .join("")}`;
  }

  function publicStatus(progress) {
    if (utils.parseNumber(progress?.pendingStems) === 0 && utils.parseNumber(progress?.totalStems) > 0) return "COMPLETO";
    if (utils.parseNumber(progress?.classifiedStems) > 0) return "PARCIAL";
    return "PENDIENTE";
  }

  function normalizePublicStatus(status) {
    const normalized = String(status || "").trim().toUpperCase();
    if (normalized === "COMPLETA") return "COMPLETO";
    return ["PENDIENTE", "PARCIAL", "COMPLETO"].includes(normalized) ? normalized : "";
  }

  function statusLabel(status) {
    return normalizePublicStatus(status).toLowerCase();
  }

  function statusTone(status) {
    if (normalizePublicStatus(status) === "COMPLETO") return "authorized";
    if (status === "PARCIAL") return "partial";
    return "pending";
  }

  function pendingMeshCount(progress) {
    const stemsPerMesh = utils.parseNumber(progress?.stemsPerMesh);
    if (stemsPerMesh <= 0) return 0;
    return Math.max(0, Math.floor(utils.parseNumber(progress?.pendingStems) / stemsPerMesh));
  }

  function progressFromLines(lines) {
    const totalStems = lines.reduce((sum, item) => sum + utils.parseNumber(item.totalStems), 0);
    const classifiedStems = lines.reduce((sum, item) => sum + utils.parseNumber(item.classifiedStems), 0);
    const pendingStems = Math.max(totalStems - classifiedStems, 0);
    return {
      lines,
      totalStems,
      classifiedStems,
      pendingStems,
      status: pendingStems === 0 && totalStems > 0
        ? "COMPLETADO_CLASIFICACION"
        : classifiedStems > 0
          ? "PARCIAL_CLASIFICACION"
          : "PENDIENTE_CLASIFICACION"
    };
  }

  function renderReceptionItems(items, itemDraft) {
    if (!items.length) return `<tr class="ops-reception-empty-row"><td colspan="9">Agregue una o varias variedades antes de registrar la recepcion.</td></tr>`;
    return items.map((item, index) => `
      <tr class="${item.id === itemDraft.id ? "is-editing" : ""}">
        <td>${index + 1}</td>
        <td><strong>${utils.esc(item.variety)}</strong></td>
        <td>${utils.esc(item.stemType)}</td>
        <td>${utils.esc(BlessERP.flowerQuality.label(item.quality))}</td>
        <td>${utils.number(item.meshCount)}</td>
        <td>${utils.number(item.stemsPerMesh)}</td>
        <td>${utils.number(item.extraStems)}</td>
        <td><strong>${utils.number(item.totalStems)}</strong></td>
        <td><div class="table-actions-inline ops-reception-row-actions">
          <button class="row-action-button" data-ops-action="reception-item-edit" data-id="${utils.esc(item.id)}">Editar</button>
          <button class="row-action-button" data-ops-action="reception-item-delete" data-id="${utils.esc(item.id)}">Quitar</button>
        </div></td>
      </tr>
    `).join("");
  }

  function receptionDateTime(item) {
    const raw = String(item.createdAt || `${item.date || ""} 00:00`);
    const time = raw.match(/\b\d{2}:\d{2}\b/)?.[0] || "00:00";
    return `${utils.dateLabel(item.date || raw)} ${time}`;
  }

  function lineProgress(item) {
    const totalStems = utils.parseNumber(item.totalStems);
    const classifiedStems = utils.parseNumber(item.classifiedStems);
    const pendingStems = Math.max(totalStems - classifiedStems, 0);
    const stemsPerMesh = utils.parseNumber(item.stemsPerMesh);
    return {
      totalStems,
      classifiedStems,
      pendingStems,
      stemsPerMesh,
      pendingMeshes: pendingMeshCount({ pendingStems, stemsPerMesh })
    };
  }

  function progressPercent(progress) {
    const totalStems = utils.parseNumber(progress?.totalStems);
    if (totalStems <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((utils.parseNumber(progress?.classifiedStems) / totalStems) * 100)));
  }

  function renderHistoryLines(lines) {
    return lines.map(item => {
      const progress = lineProgress(item);
      const status = publicStatus(progress);
      return `
        <tr>
          <td><strong>${utils.esc(item.variety)}</strong></td>
          <td>${utils.esc(item.stemType || "-")}</td>
          <td>${utils.number(item.meshCount)}</td>
          <td><strong>${utils.number(progress.pendingMeshes)}</strong></td>
          <td>${utils.number(item.stemsPerMesh)}</td>
          <td>${utils.number(item.extraStems)}</td>
          <td><strong>${utils.number(progress.totalStems)}</strong></td>
          <td>${utils.number(progress.classifiedStems)}</td>
          <td><strong>${utils.number(progress.pendingStems)}</strong></td>
          <td><span class="status-badge ${statusTone(status)}">${statusLabel(status)}</span></td>
        </tr>
      `;
    }).join("");
  }

  function renderReceptionHistoryEntry(reception) {
    const progress = reception.classificationProgress;
    const status = publicStatus(progress);
    return `
      <article class="ops-reception-history-entry ${status.toLowerCase()}">
        <div class="ops-reception-history-head">
          <div class="ops-reception-arrival">
            <strong>${utils.esc(receptionDateTime(reception))}</strong>
            <span>${utils.esc(reception.id)} · ${utils.esc(reception.receptionist || reception.responsible || "Sin recepcionista")}</span>
          </div>
          <div class="ops-reception-origin">
            <strong>${utils.esc(reception.block || "SIN BLOQUE")}</strong>
            <span>${utils.esc(reception.supplier || "Sin proveedor")}</span>
          </div>
          <div class="ops-reception-progress">
            <span><small>Variedades</small><strong>${progress.lines.length}</strong></span>
            <span><small>Total</small><strong>${utils.number(progress.totalStems)}</strong></span>
            <span><small>Clasificado</small><strong>${utils.number(progress.classifiedStems)}</strong></span>
            <span><small>Pendiente</small><strong>${utils.number(progress.pendingStems)}</strong></span>
          </div>
          <div class="ops-reception-history-actions">
            <span class="status-badge ${statusTone(status)}">${statusLabel(status)}</span>
            <button class="row-action-button" data-ops-action="reception-edit" data-id="${utils.esc(reception.id)}">Editar</button>
          </div>
        </div>
        <div class="compact-table-wrap"><table class="compact-table ops-reception-history-table">
          <thead><tr><th>Variedad</th><th>Tipo</th><th>Mallas</th><th>Mallas pendientes</th><th>Tallos/malla</th><th>Extras</th><th>Total</th><th>Clasificado</th><th>Pendiente</th><th>Estado</th></tr></thead>
          <tbody>${renderHistoryLines(progress.lines)}</tbody>
        </table></div>
        ${reception.observation ? `<p class="ops-reception-history-note"><strong>Nota:</strong> ${utils.esc(reception.observation)}</p>` : ""}
      </article>
    `;
  }

  function renderArrivalHistoryRows(receptions) {
    const rows = receptions.flatMap(reception => reception.classificationProgress.lines.map(line => {
      const progress = lineProgress(line);
      return {
        receptionId: reception.id,
        dateTime: receptionDateTime(reception),
        block: reception.block || "SIN BLOQUE",
        variety: line.variety,
        stemType: line.stemType || "-",
        meshCount: line.meshCount,
        extraStems: line.extraStems,
        totalStems: progress.totalStems,
        pendingMeshes: progress.pendingMeshes,
        pendingStems: progress.pendingStems,
        progress: progressPercent(progress),
        status: publicStatus(progress)
      };
    }));

    if (!rows.length) {
      return `<tr><td colspan="12" class="ops-reception-empty-state">No existen recepciones para los filtros seleccionados.</td></tr>`;
    }

    return rows.map(item => `
      <tr>
        <td><strong>${utils.esc(item.dateTime)}</strong></td>
        <td>${utils.esc(item.block)}</td>
        <td><strong>${utils.esc(item.variety)}</strong></td>
        <td>${utils.esc(item.stemType)}</td>
        <td>${utils.number(item.meshCount)}</td>
        <td><strong>${utils.number(item.pendingMeshes)}</strong></td>
        <td>${utils.number(item.extraStems)}</td>
        <td><strong>${utils.number(item.totalStems)}</strong></td>
        <td><span class="status-badge ${statusTone(item.status)}">${statusLabel(item.status)}</span></td>
        <td><strong>${utils.number(item.pendingStems)}</strong></td>
        <td><div class="ops-reception-progress-meter" aria-label="Avance ${item.progress}%"><strong>${item.progress}%</strong><span><i style="width:${item.progress}%"></i></span></div></td>
        <td><button class="row-action-button" data-ops-action="reception-edit" data-id="${utils.esc(item.receptionId)}">Editar</button></td>
      </tr>
    `).join("");
  }

  function filterReceptions(queue, filters) {
    return queue.flatMap(reception => {
      const matchesPeriod = filters.mode === "MES"
        ? String(reception.date || "").startsWith(filters.month)
        : reception.date === filters.date;
      if (!matchesPeriod) return [];
      if (filters.supplier && reception.supplier !== filters.supplier) return [];
      if (filters.block && reception.block !== filters.block) return [];

      const lines = filters.variety
        ? reception.classificationProgress.lines.filter(item => item.variety === filters.variety)
        : reception.classificationProgress.lines;
      if (!lines.length) return [];

      const projected = {
        ...reception,
        classificationProgress: progressFromLines(lines)
      };
      if (normalizePublicStatus(filters.status) && publicStatus(projected.classificationProgress) !== normalizePublicStatus(filters.status)) return [];
      return [projected];
    });
  }

  function aggregateBySupplier(receptions) {
    const groups = new Map();
    receptions.forEach(reception => {
      reception.classificationProgress.lines.forEach(line => {
        const key = [reception.supplier, reception.block, line.variety].join("|");
        const entry = groups.get(key) || {
          supplier: reception.supplier,
          block: reception.block,
          variety: line.variety,
          receptions: new Set(),
          meshCount: 0,
          totalStems: 0,
          classifiedStems: 0,
          pendingStems: 0
        };
        entry.receptions.add(reception.id);
        entry.meshCount += utils.parseNumber(line.meshCount);
        entry.totalStems += utils.parseNumber(line.totalStems);
        entry.classifiedStems += utils.parseNumber(line.classifiedStems);
        entry.pendingStems += utils.parseNumber(line.pendingStems);
        groups.set(key, entry);
      });
    });
    return [...groups.values()].sort((left, right) => `${left.supplier}|${left.block}|${left.variety}`.localeCompare(`${right.supplier}|${right.block}|${right.variety}`));
  }

  function aggregateByVariety(receptions) {
    const groups = new Map();
    receptions.forEach(reception => {
      reception.classificationProgress.lines.forEach(line => {
        const entry = groups.get(line.variety) || {
          variety: line.variety,
          origins: new Set(),
          receptions: new Set(),
          meshCount: 0,
          totalStems: 0,
          classifiedStems: 0,
          pendingStems: 0
        };
        entry.origins.add(`${reception.supplier} · ${reception.block}`);
        entry.receptions.add(reception.id);
        entry.meshCount += utils.parseNumber(line.meshCount);
        entry.totalStems += utils.parseNumber(line.totalStems);
        entry.classifiedStems += utils.parseNumber(line.classifiedStems);
        entry.pendingStems += utils.parseNumber(line.pendingStems);
        groups.set(line.variety, entry);
      });
    });
    return [...groups.values()].sort((left, right) => left.variety.localeCompare(right.variety));
  }

  function renderAccumulated(receptions, groupMode) {
    if (groupMode === "VARIEDAD") {
      const rows = aggregateByVariety(receptions);
      return `
        <div class="compact-table-wrap"><table class="compact-table ops-reception-summary-table">
          <thead><tr><th>Variedad</th><th>Proveedores / bloques</th><th>Recepciones</th><th>Mallas</th><th>Total</th><th>Clasificado</th><th>Pendiente</th><th>Estado</th></tr></thead>
          <tbody>${rows.map(item => {
            const status = publicStatus(item);
            return `<tr><td><strong>${utils.esc(item.variety)}</strong></td><td>${[...item.origins].map(origin => utils.esc(origin)).join("<br>")}</td><td>${item.receptions.size}</td><td>${utils.number(item.meshCount)}</td><td><strong>${utils.number(item.totalStems)}</strong></td><td>${utils.number(item.classifiedStems)}</td><td><strong>${utils.number(item.pendingStems)}</strong></td><td><span class="status-badge ${statusTone(status)}">${statusLabel(status)}</span></td></tr>`;
          }).join("") || `<tr><td colspan="8">No existen datos para los filtros seleccionados.</td></tr>`}</tbody>
        </table></div>
      `;
    }

    const rows = aggregateBySupplier(receptions);
    return `
      <div class="compact-table-wrap"><table class="compact-table ops-reception-summary-table">
        <thead><tr><th>Proveedor</th><th>Bloque</th><th>Variedad</th><th>Recepciones</th><th>Mallas</th><th>Total</th><th>Clasificado</th><th>Pendiente</th><th>Estado</th></tr></thead>
        <tbody>${rows.map(item => {
          const status = publicStatus(item);
          return `<tr><td><strong>${utils.esc(item.supplier)}</strong></td><td>${utils.esc(item.block)}</td><td>${utils.esc(item.variety)}</td><td>${item.receptions.size}</td><td>${utils.number(item.meshCount)}</td><td><strong>${utils.number(item.totalStems)}</strong></td><td>${utils.number(item.classifiedStems)}</td><td><strong>${utils.number(item.pendingStems)}</strong></td><td><span class="status-badge ${statusTone(status)}">${statusLabel(status)}</span></td></tr>`;
        }).join("") || `<tr><td colspan="9">No existen datos para los filtros seleccionados.</td></tr>`}</tbody>
      </table></div>
    `;
  }

  function periodLabel(filters) {
    return filters.mode === "MES" ? `Mes ${filters.month}` : utils.dateLabel(filters.date);
  }

  function render(appState, route) {
    const search = BlessERP.operacionesReceptionClassificationSearch;
    if (search?.isOpen?.("receptionHistory")) return search.renderReceptionHistory(route);
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.receptionDraft;
    const itemDraft = ui.receptionItemDraft;
    const editing = Boolean(draft.id);
    const blockOptions = (store.masterData.suppliers || []).filter(item => item.active !== false && item.assignedBlock).map(item => item.assignedBlock);
    const itemIndex = Math.max(0, (draft.items || []).findIndex(item => item.id === itemDraft.id));

    return `
      ${utils.renderPageHeader(route, "Recepcion operativa activa", "authorized", "Registra una entrega por bloque con varias variedades. No crea inventario.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui, { hideNationalResult: true })}
      <div class="table-actions-inline ops-search-first-access"><button class="secondary-button" data-ops-search-action="open" data-view="receptionHistory">Historial de recepciones</button></div>

      <section class="panel-card ops-reception-sheet" data-ops-reception-form>
        <div class="panel-card-head ops-reception-sheet-title">
          <div><p class="section-kicker">RECEPCION DE FLOR</p><h3>${editing ? `Editar recepcion ${utils.esc(draft.id)}` : "Nueva recepcion de flor"}</h3></div>
          <span class="status-badge ${editing ? "partial" : "pending"}">${editing ? "Edicion controlada" : "Borrador local"}</span>
        </div>
        <div class="ops-reception-sheet-header">
          <label class="compact-inline-field"><span>Recepcionista</span><select data-ops-bind="receptionDraft" data-field="receptionist">${optionList(store.catalogs.receptionists, draft.receptionist)}</select></label>
          <label class="compact-inline-field"><span>Numero de bloque</span><input list="ops-reception-blocks" autocomplete="off" value="${utils.esc(draft.block || "")}" data-ops-bind="receptionDraft" data-field="block"><datalist id="ops-reception-blocks">${blockOptions.map(value => `<option value="${utils.esc(value)}"></option>`).join("")}</datalist></label>
          <label class="compact-inline-field"><span>Proveedor reconocido</span><input readonly value="${utils.esc(draft.supplier || "Seleccione un bloque")}" data-ops-reception-supplier></label>
          <label class="compact-inline-field ops-reception-observation"><span>Observacion de la entrega</span><input value="${utils.esc(draft.observation)}" data-ops-bind="receptionDraft" data-field="observation" placeholder="Opcional"></label>
        </div>

        <div class="compact-table-wrap ops-reception-items-wrap"><table class="compact-table ops-reception-items-table">
          <thead><tr><th>#</th><th>Variedad</th><th>Tipo tallo</th><th>Calidad</th><th>Numero mallas</th><th>Tallos/malla</th><th>Tallos extras</th><th>Total</th><th>Acciones</th></tr></thead>
          <tbody>
            <tr class="ops-reception-editor-row">
              <td>${itemDraft.id ? itemIndex + 1 : (draft.items || []).length + 1}</td>
              <td><select aria-label="Variedad" data-ops-bind="receptionItemDraft" data-field="variety"><option value="" ${itemDraft.variety ? "" : "selected"} disabled>VARIEDAD</option>${optionList(store.catalogs.varieties, itemDraft.variety)}</select></td>
              <td><select data-ops-bind="receptionItemDraft" data-field="stemType">${optionList(store.catalogs.stemTypes, itemDraft.stemType)}</select></td>
              <td><label class="ops-quality-inline"><span>${utils.esc(BlessERP.flowerQuality.label(itemDraft.quality))}</span><span class="ops-quality-checkbox-control"><input type="checkbox" data-ops-reception-tipo-b ${BlessERP.flowerQuality.isTipoB(itemDraft.quality) ? "checked" : ""}> TIPO B</span></label></td>
              <td><input type="number" min="1" value="${utils.esc(itemDraft.meshCount)}" data-ops-bind="receptionItemDraft" data-field="meshCount"></td>
              <td><input type="number" min="1" value="${utils.esc(itemDraft.stemsPerMesh)}" data-ops-bind="receptionItemDraft" data-field="stemsPerMesh"></td>
              <td><input type="number" min="0" value="${utils.esc(itemDraft.extraStems)}" data-ops-bind="receptionItemDraft" data-field="extraStems"></td>
              <td><strong data-ops-reception-item-total>${utils.number(itemDraft.totalStems)}</strong></td>
              <td><div class="table-actions-inline ops-reception-row-actions"><button class="primary-button" data-ops-action="reception-item-save">${itemDraft.id ? "Actualizar" : "Agregar item"}</button><button class="secondary-button" data-ops-action="reception-item-reset">Limpiar</button></div></td>
            </tr>
            ${renderReceptionItems(draft.items || [], itemDraft)}
          </tbody>
          <tfoot><tr><td colspan="7"><strong>Total de la recepcion</strong></td><td><strong data-ops-reception-total>${utils.number(draft.totalDeclared)}</strong></td><td>${(draft.items || []).length} item(s)</td></tr></tfoot>
        </table></div>
        <div class="ops-reception-sheet-footer">
          <p class="panel-note">Registrar la recepcion solo crea el saldo pendiente. La flor pasa a EN CLASIFICACION unicamente cuando se registra su entrega al clasificador.</p>
          <div class="table-actions-inline">
            <button class="primary-button" data-ops-action="save-reception">${editing ? "Actualizar recepcion" : "Registrar recepcion"}</button>
            <button class="secondary-button" data-ops-action="clear-reception">${editing ? "Cancelar edicion" : "Limpiar recepcion"}</button>
          </div>
        </div>
      </section>

    `;
  }

  BlessERP.operacionesRecepcion = {
    aggregateBySupplier,
    aggregateByVariety,
    filterReceptions,
    normalizePublicStatus,
    pendingMeshCount,
    progressPercent,
    publicStatus,
    render
  };
})();
