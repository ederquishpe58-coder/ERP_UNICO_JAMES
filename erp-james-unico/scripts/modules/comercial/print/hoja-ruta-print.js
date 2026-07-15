(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateRouteSheet(context) {
    const { order, agency, boxGroups } = context;
    const errors = [];
    const warnings = [];

    if (!agency) errors.push("Falta agencia de carga.");
    if (!order.flightDate) errors.push("Falta fecha de vuelo.");
    if (!boxGroups.length) errors.push("Faltan cajas en el pedido.");
    if (!order.coldRoom) warnings.push("Falta cuarto frio.");

    return { errors, warnings };
  }

  function renderRouteSheet(context) {
    const { order, brand, agency, airline, metrics, boxGroups } = context;
    const rows = boxGroups.map(group => `
      <tr>
        <td>${utils.esc(group.boxNumber)}</td>
        <td>${utils.esc(group.boxType)}</td>
        <td>${utils.esc(brand?.name || "-")}</td>
        <td>${utils.esc([...group.poValues].join(", ") || order.generalPo || "")}</td>
        <td>${utils.esc(order.destination || "-")}</td>
        <td>${utils.esc(printUtils.describeBoxContent(group) || "-")}</td>
        <td class="numeric">${utils.esc(utils.number(group.totalBunches))}</td>
        <td class="numeric">${utils.esc(utils.number(group.totalStems))}</td>
        <td>${utils.esc(printUtils.resolveBoxState(group.lines))}</td>
      </tr>
    `).join("");

    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Despacho operativo</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">HR / HOJA DE RUTA</h2>
            <p class="doc-subtitle">Documento operativo para despacho comercial demo.</p>
          </div>
          <div class="doc-box">
            <h4>Cabecera logistica</h4>
            ${printUtils.renderInfoRows([
              ["Fecha", utils.dateLabel(order.issuedAt)],
              ["Fecha vuelo", utils.dateLabel(order.flightDate)],
              ["Agencia", agency?.name || "-"],
              ["Cuarto frio", order.coldRoom || "-"],
              ["Transportista", "Placeholder demo"],
              ["Marca", brand?.name || "-"],
              ["Destino", order.destination || "-"],
              ["DAE", order.daeNumber || "-"],
              ["AWB / HAWB", [order.awb || "-", order.hawb || "-"].join(" / ")]
            ])}
          </div>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Pedido", value: order.number },
          { label: "Carrier", value: airline?.name || "-" },
          { label: "Vuelo", value: order.flightNumber || "-" },
          { label: "Total cajas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Estado", value: order.status || "BORRADOR" }
        ])}

        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Caja numero</th>
                <th>Tipo caja</th>
                <th>Marca</th>
                <th>PO</th>
                <th>Destino</th>
                <th>Contenido resumido</th>
                <th>Total ramos</th>
                <th>Total tallos</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="9">Sin cajas para hoja de ruta.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Observaciones logisticas</h4>
            <ul class="doc-list">
              <li>Control de despacho visual demo, sin integracion con Operaciones reales.</li>
              <li>Usar este formato para revision antes de mover logica pesada de Parte 1.</li>
              <li>La disponibilidad real y la salida fisica siguen pendientes de integracion aprobada.</li>
            </ul>
          </section>
          <section class="doc-box">
            <h4>Control rapido</h4>
            ${printUtils.renderInfoRows([
              ["Total ramos", utils.number(metrics.totalBunches)],
              ["Total tallos", utils.number(metrics.totalStems)],
              ["Agencia", agency?.name || "-"],
              ["Carrier / vuelo", [airline?.name || "-", order.flightNumber || "-"].join(" / ")]
            ])}
          </section>
        </div>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.HR = {
    code: "HR",
    name: "HR / Hoja de Ruta",
    description: "Hoja operativa de despacho construida desde las cajas del pedido.",
    validate: validateRouteSheet,
    render: renderRouteSheet
  };
})();
