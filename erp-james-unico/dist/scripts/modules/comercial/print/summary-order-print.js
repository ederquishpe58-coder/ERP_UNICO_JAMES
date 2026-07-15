(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateSummary(context) {
    return {
      errors: [...context.validation.errors],
      warnings: [...context.validation.warnings]
    };
  }

  function renderSummary(context) {
    const { order, customer, brand, agency, metrics, materials, validation } = context;
    const materialRows = materials.map(item => [
      item.name,
      utils.number(item.required),
      utils.number(item.available),
      utils.number(item.missing),
      item.state
    ]);

    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Resumen interno</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">RESUMEN DEL PEDIDO</h2>
            <p class="doc-subtitle">Resumen comercial interno con validaciones y materiales demo.</p>
          </div>
          <div class="doc-box">
            <h4>Estado general</h4>
            ${printUtils.renderInfoRows([
              ["Pedido", order.number],
              ["Estado", order.status || "BORRADOR"],
              ["Cliente principal", customer?.commercialName || "-"],
              ["Marca / cliente final", brand?.name || "-"],
              ["Destino", order.destination || "-"],
              ["DAE", order.daeNumber || "-"]
            ])}
          </div>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Fecha emision", value: utils.dateLabel(order.issuedAt) },
          { label: "Fecha vuelo", value: utils.dateLabel(order.flightDate) },
          { label: "Agencia", value: agency?.name || "-" },
          { label: "AWB / HAWB", value: [order.awb || "-", order.hawb || "-"].join(" / ") },
          { label: "Total cajas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Total ramos", value: utils.number(metrics.totalBunches) },
          { label: "Total tallos", value: utils.number(metrics.totalStems) },
          { label: "Total USD", value: utils.money(metrics.totalUsd) }
        ])}

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Validaciones</h4>
            <strong>Errores criticos</strong>
            ${printUtils.renderValidationList(validation.errors, "Sin errores criticos.")}
            <strong>Advertencias</strong>
            ${printUtils.renderValidationList(validation.warnings, "Sin advertencias.")}
          </section>
          <section class="doc-box">
            <h4>Materiales de bodega requeridos demo</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Material", "Requerido", "Disponible", "Faltante", "Estado"],
              materialRows,
              [1, 2, 3]
            )}
          </section>
        </div>

        <p class="doc-legal-note">Factura cliente y facturacion SRI se implementaran en una fase posterior. Los documentos actuales son comerciales, logisticos y de revision interna.</p>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.RESUMEN = {
    code: "RESUMEN",
    name: "Resumen pedido",
    description: "Resumen interno del pedido con validaciones y materiales demo.",
    validate: validateSummary,
    render: renderSummary
  };
})();
