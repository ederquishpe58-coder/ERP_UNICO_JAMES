(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function optionList(values, current) {
    return values.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(current) ? "selected" : ""}>${utils.esc(item)}</option>`).join("");
  }

  const CODE128_PATTERNS = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"
  ];

  function barcodeSvg(code) {
    const numericCode = String(code || "").padStart(10, "0").slice(-10);
    const values = numericCode.match(/\d{2}/g).map(Number);
    const checksum = (105 + values.reduce((sum, value, index) => sum + (value * (index + 1)), 0)) % 103;
    const sequence = [105, ...values, checksum, 106];
    let x = 10;
    const bars = [];
    sequence.forEach(value => {
      [...CODE128_PATTERNS[value]].forEach((width, index) => {
        const size = Number(width);
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${size}" height="30"/>`);
        x += size;
      });
    });
    return `<svg class="ops-bunch-barcode-svg" viewBox="0 0 ${x + 10} 30" preserveAspectRatio="none" role="img" aria-label="Codigo de barras ${utils.esc(numericCode)}">${bars.join("")}</svg>`;
  }

  function labelMarkup(label, preview = false) {
    return `<article class="ops-bunch-label${preview ? " is-preview" : ""}">
      <div class="ops-bunch-label-brand" aria-hidden="true"><span>BF</span></div>
      <div class="ops-bunch-label-title">${utils.esc(String(label.variety || "VARIEDAD").toUpperCase())} ${utils.number(label.stemsPerBunch)} STEMS</div>
      <div class="ops-bunch-label-meta"><strong>${utils.esc(label.labelType === "MIXTA" ? "BLESS FL" : (label.block || "SIN BLOQUE"))}</strong><strong>${utils.esc(label.length)} CM</strong><strong>${utils.esc(String(label.buncher || "SIN EMBONCHADOR").toUpperCase())}</strong></div>
      <div class="ops-bunch-label-bars">${barcodeSvg(label.code)}</div>
      <div class="ops-bunch-label-footer"><strong>${utils.esc(label.code)}</strong><strong>PRODUCT GROWN IN ECUADOR</strong></div>
    </article>`;
  }

  function printLabels(labels) {
    if (!Array.isArray(labels) || !labels.length) return false;
    const popup = window.open("", "_blank", "width=900,height=650");
    if (!popup) {
      BlessERP.layout.toast("El navegador bloqueo la ventana de impresion. Habilite ventanas emergentes para el ERP.");
      return false;
    }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de ramos</title><style>
      @page{size:58mm 23mm;margin:0}
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
      .ops-bunch-label{position:relative;width:58mm;height:23mm;padding:1mm 1.35mm .8mm;border:.25mm solid #000;overflow:hidden;break-after:page;page-break-after:always;background:#fff}
      .ops-bunch-label:last-child{break-after:auto;page-break-after:auto}
      .ops-bunch-label-brand{position:absolute;left:1.3mm;top:1mm;width:5.5mm;height:3.4mm;display:grid;place-items:center;border:.25mm solid #111;border-radius:50%;font-size:5.5pt;font-weight:900;font-style:italic}
      .ops-bunch-label-title{height:3.5mm;padding:0 6mm;text-align:center;font-size:8.5pt;line-height:3.5mm;font-weight:900;text-decoration:underline;white-space:nowrap;overflow:hidden}
      .ops-bunch-label-meta{height:3mm;display:flex;align-items:center;justify-content:center;gap:3.2mm;font-size:6.5pt;line-height:3mm;white-space:nowrap;overflow:hidden}
      .ops-bunch-label-bars{height:10.4mm;padding:.5mm 1mm .2mm}
      .ops-bunch-barcode-svg{display:block;width:100%;height:100%;fill:#000}
      .ops-bunch-label-footer{height:3.1mm;display:flex;align-items:end;justify-content:space-between;padding:0 .8mm;font-size:6pt;line-height:2.6mm;white-space:nowrap}
      @media screen{body{padding:12px;background:#e8edf4}.ops-bunch-label{margin:0 auto 12px;box-shadow:0 5px 18px rgba(15,23,42,.18)}}
      @media print{body{width:58mm}.ops-bunch-label{margin:0;box-shadow:none}}
    </style></head><body>${labels.map(label => labelMarkup(label)).join("")}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),180));<\/script></body></html>`);
    popup.document.close();
    return true;
  }

  function render(appState, route) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.labelDraft;
    const rows = store.labelBatches || [];
    const nextCode = utils.buildLabelCode({ sequence: store.sequences.bunchLabel });
    const suppliers = (store.masterData?.suppliers || []).filter(item => item.active !== false && item.assignedBlock);
    const blocks = [...new Set(suppliers.map(item => item.assignedBlock))];
    const recognizedSupplier = suppliers.find(item => String(item.assignedBlock).trim().toUpperCase() === String(draft.block).trim().toUpperCase());
    const previewLabel = { ...draft, supplier: recognizedSupplier?.name || draft.supplier, code: nextCode };
    const scanned = rows.filter(item => item.state === "ESCANEADA").length;
    const available = rows.filter(item => ["GENERADA", "IMPRESA"].includes(item.state)).length;

    return `
      ${utils.renderPageHeader(route, "Etiquetas operativas activas demo", "authorized", "Genera identificadores individuales. Imprimir una etiqueta no crea inventario.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner"><div><strong>Etiqueta = identificador, no inventario</strong><span>La fecha de creacion o impresion nunca sera la fecha de ingreso. El ramo existira solo despues de su primer escaneo valido.</span></div></section>
      ${utils.renderSummaryCards([
        { label: "Etiquetas creadas", value: utils.number(rows.length), help: "Una fila por codigo" },
        { label: "Disponibles para uso", value: utils.number(available), help: "Generadas o impresas" },
        { label: "Ya escaneadas", value: utils.number(scanned), help: "Con ramo en inventario" },
        { label: "Proximo codigo", value: nextCode, help: "Secuencial numerico unico" }
      ])}
      <section class="placeholder-grid ops-label-workspace">
        <article class="panel-card ops-label-editor">
          <div class="panel-card-head"><div><p class="section-kicker">GENERAR E IMPRIMIR</p><h3>Etiquetas de ramos</h3></div><span class="status-badge partial">Impresion demo</span></div>
          <div class="ops-form-grid">
            <label class="compact-inline-field"><span>Numero de bloque</span><input list="ops-label-blocks" autocomplete="off" value="${utils.esc(draft.block)}" data-ops-bind="labelDraft" data-field="block"><datalist id="ops-label-blocks">${blocks.map(block => `<option value="${utils.esc(block)}"></option>`).join("")}</datalist></label>
            <label class="compact-inline-field"><span>Proveedor impreso</span><input readonly value="${utils.esc(draft.labelType === "MIXTA" ? "BLESS FL" : (recognizedSupplier?.name || draft.supplier || "Seleccione un bloque"))}"></label>
            <label class="compact-inline-field"><span>Variedad</span><select data-ops-bind="labelDraft" data-field="variety">${optionList(store.catalogs.varieties, draft.variety)}</select></label>
            <label class="compact-inline-field"><span>Longitud</span><select data-ops-bind="labelDraft" data-field="length">${optionList(store.catalogs.lengths, draft.length)}</select></label>
            <label class="compact-inline-field"><span>Embonchador</span><select data-ops-bind="labelDraft" data-field="buncher">${optionList(store.catalogs.bunchers, draft.buncher)}</select></label>
            <label class="compact-inline-field"><span>Tallos por ramo</span><input type="number" min="1" value="${utils.esc(draft.stemsPerBunch)}" data-ops-bind="labelDraft" data-field="stemsPerBunch"></label>
            <label class="compact-inline-field"><span>Cantidad etiquetas</span><input type="number" min="1" max="500" value="${utils.esc(draft.quantity)}" data-ops-bind="labelDraft" data-field="quantity"></label>
            <label class="compact-inline-field"><span>Tipo de etiqueta</span><select data-ops-bind="labelDraft" data-field="labelType">${optionList(store.catalogs.labelTypes, draft.labelType)}</select></label>
          </div>
          <div class="ops-inline-metrics">
            <div class="base-ready-item"><strong>Primer codigo</strong><span data-ops-label-code-preview>${nextCode}</span></div>
            <div class="base-ready-item"><strong>Formato fisico</strong><span>58 mm × 23 mm · Code 128</span></div>
            <div class="base-ready-item"><strong>Inventario creado</strong><span>0 ramos</span></div>
          </div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="generate-labels">Generar e imprimir etiquetas</button><button class="secondary-button" data-ops-action="clear-label-draft">Limpiar</button></div>
        </article>
        <article class="panel-card ops-label-preview-card">
          <div class="panel-card-head"><div><p class="section-kicker">VISTA PREVIA</p><h3>Etiqueta 58 × 23 mm</h3></div><span class="status-badge authorized">CODE 128</span></div>
          <div class="ops-bunch-label-preview">${labelMarkup(previewLabel, true)}</div>
          <p class="panel-note">La escala en pantalla es ampliada para revision. La impresion usa exactamente 58 mm de ancho por 23 mm de alto.</p>
          <ul class="checklist-list"><li>La etiqueta no crea inventario.</li><li>La reimpresion conserva el mismo codigo.</li><li>El primer escaneo valido registra el ingreso real del ramo.</li></ul>
        </article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">HISTORIAL</p><h3>Etiquetas individuales generadas</h3></div><button class="secondary-button" data-route-link="operations-bunch-intake">Abrir ingreso por escaner</button></div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Codigo</th><th>Creacion</th><th>Bloque</th><th>Embonchador</th><th>Proveedor</th><th>Variedad</th><th>Longitud</th><th>Tallos</th><th>Estado</th><th>Ingreso inventario</th><th>Acciones</th></tr></thead>
          <tbody>${rows.map(item => `<tr>
            <td><strong>${utils.esc(item.code)}</strong>${item.legacyCode ? "<br><small>Codigo legado demo</small>" : ""}</td><td>${utils.esc(item.createdAt || item.date)}</td>
            <td>${utils.esc(item.block || "-")}</td><td>${utils.esc(item.buncher || "-")}</td><td>${utils.esc(item.supplier)}</td><td>${utils.esc(item.variety)}</td><td>${utils.esc(item.length)} cm</td><td>${utils.number(item.stemsPerBunch)}</td>
            <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td><td>${utils.esc(item.scannedAt || "NO INGRESADO")}</td>
            <td><div class="table-actions-inline">
              ${item.state !== "ESCANEADA" && !item.legacyCode ? `<button class="row-action-button" data-ops-action="label-open-intake" data-code="${utils.esc(item.code)}">Usar en escaner</button>` : ""}
              ${item.state !== "ESCANEADA" ? `<button class="row-action-button" data-ops-action="label-state" data-id="${utils.esc(item.id)}" data-status="REIMPRESA">Reimprimir</button><button class="row-action-button" data-ops-action="label-state" data-id="${utils.esc(item.id)}" data-status="ANULADA">Anular</button>` : ""}
            </div></td>
          </tr>`).join("") || `<tr><td colspan="11">Sin etiquetas generadas.</td></tr>`}</tbody>
        </table></div>
      </section>
    `;
  }

  BlessERP.operacionesEtiquetas = { render, printLabels, barcodeSvg };
})();
