(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validatePacking(context) {
    const { brand, metrics } = context;
    const errors = [];
    const warnings = [];

    if (!brand) errors.push("Falta marca / cliente final.");
    if (!metrics.lines.length) errors.push("Falta detalle de cajas.");

    return { errors, warnings };
  }

  function renderPacking(context, options = {}) {
    const { company, order, brand, agency, metrics, boxGroups } = context;
    const showPrices = Boolean(options.showPrices);
    const rows = boxGroups.map((group, groupIndex) => (
      group.lines.map((line, lineIndex) => `
        <tr class="${groupIndex > 0 && lineIndex === 0 ? "box-divider" : ""}">
          <td>${lineIndex === 0 ? utils.esc(group.boxNumber) : ""}</td>
          <td>${lineIndex === 0 ? utils.esc(group.boxType) : ""}</td>
          <td>${utils.esc(line.variety)}</td>
          <td>${utils.esc(`${line.length} cm`)}</td>
          <td class="numeric">${utils.esc(utils.number(line.bunches))}</td>
          <td class="numeric">${utils.esc(utils.number(line.stemsPerBunch))}</td>
          <td class="numeric">${utils.esc(utils.number(line.totalStems))}</td>
          <td>${utils.esc(line.po || order.generalPo || "")}</td>
          <td>${utils.esc(order.notes || "-")}</td>
          ${showPrices ? `<td class="numeric">${utils.esc(Number(line.unitPrice || 0).toFixed(3))}</td>` : ""}
          ${showPrices ? `<td class="numeric">${utils.esc(Number(line.totalLine || 0).toFixed(2))}</td>` : ""}
        </tr>
      `).join(""))
    ).join("");

    const boxTypeRows = Object.entries(boxGroups.reduce((accumulator, group) => {
      accumulator[group.boxType] = (accumulator[group.boxType] || 0) + 1;
      return accumulator;
    }, {}))
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, value]) => [label, utils.number(value)]);

    const byVariety = printUtils.summarizeMap(metrics.byVariety, value => utils.number(value), "label");
    const byLength = printUtils.summarizeMap(metrics.byLength, value => utils.number(value), "numeric");

    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Centro de impresion</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">PACKING LIST</h2>
            <p class="doc-subtitle">Salida de packing separada del invoice. ${showPrices ? "Modo con valores." : "Modo sin valores."}</p>
          </div>
          <div class="doc-box">
            <h4>Cabecera</h4>
            ${printUtils.renderInfoRows([
              ["Pedido", order.number],
              ["Fecha vuelo", utils.dateLabel(order.flightDate)],
              ["Cliente final / marca", brand?.name || "-"],
              ["Destino", order.destination || "-"],
              ["Agencia", agency?.name || "-"],
              ["AWB / HAWB", [order.awb || "-", order.hawb || "-"].join(" / ")],
              ["DAE", order.daeNumber || "-"]
            ])}
          </div>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Total cajas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Total ramos", value: utils.number(metrics.totalBunches) },
          { label: "Total tallos", value: utils.number(metrics.totalStems) },
          { label: "Modo", value: showPrices ? "Packing con valores" : "Packing sin valores" },
          { label: "Empresa", value: company.commercialName }
        ])}

        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Caja numero</th>
                <th>Tipo caja</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Ramos</th>
                <th>Tallos por ramo</th>
                <th>Total tallos</th>
                <th>PO / marca adicional</th>
                <th>Observacion</th>
                ${showPrices ? "<th>Precio</th>" : ""}
                ${showPrices ? "<th>Total</th>" : ""}
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="${showPrices ? 11 : 9}">Sin lineas cargadas.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Totales por tipo de caja</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Tipo", "Cajas"],
              boxTypeRows,
              [1]
            )}
          </section>
          <section class="doc-box">
            <h4>Resumen operativo</h4>
            ${printUtils.renderInfoRows([
              ["Total ramos", utils.number(metrics.totalBunches)],
              ["Total tallos", utils.number(metrics.totalStems)],
              ["Total fulls", metrics.totalFulls.toFixed(2)],
              ["Packing con valores", showPrices ? "Si" : "No"]
            ])}
          </section>
          <section class="doc-box">
            <h4>Resumen por variedad</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Variedad", "Tallos"],
              byVariety.map(item => [item.label, item.value]),
              [1]
            )}
          </section>
          <section class="doc-box">
            <h4>Resumen por longitud</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Longitud", "Tallos"],
              byLength.map(item => [`${item.label} cm`, item.value]),
              [1]
            )}
          </section>
        </div>

        <p class="doc-legal-note">Por defecto este packing sale sin valores. La activacion visual de precios es solo demo y no representa una factura cliente ni un documento SRI.</p>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.PACKING_LIST = {
    code: "PACKING_LIST",
    name: "Packing List",
    description: "Packing list operativo y comercial generado desde el detalle de cajas del pedido.",
    validate: validatePacking,
    render: renderPacking
  };
})();
