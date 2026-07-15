(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateMasterPacking(context) {
    const errors = [];
    if (!context.boxGroups.length) errors.push("Falta detalle de cajas.");
    return { errors, warnings: [] };
  }

  function renderMasterPacking(context) {
    const { order, brand, agency, metrics, boxGroups } = context;
    const byType = Object.entries(boxGroups.reduce((accumulator, group) => {
      const current = accumulator[group.boxType] || { boxes: 0, fullEquivalent: 0 };
      current.boxes += 1;
      current.fullEquivalent += Number(utils.findBoxType(group.boxType)?.fullEquivalent || 0);
      accumulator[group.boxType] = current;
      return accumulator;
    }, {}))
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, value]) => [label, utils.number(value.boxes), value.fullEquivalent.toFixed(2)]);

    const byVarietyMap = {};
    metrics.lines.forEach(line => {
      const entry = byVarietyMap[line.variety] || { bunches: 0, stems: 0, boxes: new Set() };
      entry.bunches += Number(line.bunches || 0);
      entry.stems += Number(line.totalStems || 0);
      entry.boxes.add(line.boxNumber);
      byVarietyMap[line.variety] = entry;
    });
    const byVariety = Object.entries(byVarietyMap)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, value]) => [label, utils.number(value.bunches), utils.number(value.stems), utils.number(value.boxes.size)]);

    const byLength = Object.entries(metrics.lines.reduce((accumulator, line) => {
      const key = `${line.length}`;
      const entry = accumulator[key] || { bunches: 0, stems: 0 };
      entry.bunches += Number(line.bunches || 0);
      entry.stems += Number(line.totalStems || 0);
      accumulator[key] = entry;
      return accumulator;
    }, {}))
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([label, value]) => [`${label} cm`, utils.number(value.bunches), utils.number(value.stems)]);

    const byPo = printUtils.summarizeByPo(metrics.lines)
      .map(item => [item.label, utils.number(item.boxes), utils.number(item.bunches), utils.number(item.stems)]);

    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Reporte interno</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">MP / MASTER PACKING</h2>
            <p class="doc-subtitle">Consolidado interno del pedido para revision comercial y logistica demo.</p>
          </div>
          <div class="doc-box">
            <h4>Resumen cabecera</h4>
            ${printUtils.renderInfoRows([
              ["Pedido", order.number],
              ["Fecha", utils.dateLabel(order.issuedAt)],
              ["Marca", brand?.name || "-"],
              ["Destino", order.destination || "-"],
              ["Agencia", agency?.name || "-"],
              ["DAE", order.daeNumber || "-"],
              ["AWB / HAWB", [order.awb || "-", order.hawb || "-"].join(" / ")]
            ])}
          </div>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Total cajas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Total ramos", value: utils.number(metrics.totalBunches) },
          { label: "Total tallos", value: utils.number(metrics.totalStems) },
          { label: "Total USD", value: utils.money(metrics.totalUsd) },
          { label: "Estado pedido", value: order.status || "BORRADOR" }
        ])}

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Resumen por tipo de caja</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Tipo", "Cajas", "Full equivalente"],
              byType,
              [1, 2]
            )}
          </section>
          <section class="doc-box">
            <h4>Resumen por variedad</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Variedad", "Ramos", "Tallos", "Cajas"],
              byVariety,
              [1, 2, 3]
            )}
          </section>
          <section class="doc-box">
            <h4>Resumen por longitud</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Longitud", "Ramos", "Tallos"],
              byLength,
              [1, 2]
            )}
          </section>
          <section class="doc-box">
            <h4>Resumen por PO</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["PO", "Cajas", "Ramos", "Tallos"],
              byPo,
              [1, 2, 3]
            )}
          </section>
        </div>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.MP = {
    code: "MP",
    name: "MP / Master Packing",
    description: "Consolidado maestro del pedido para control interno.",
    validate: validateMasterPacking,
    render: renderMasterPacking
  };
})();
