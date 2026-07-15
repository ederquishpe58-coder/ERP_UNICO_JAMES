(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateDaeControl(context) {
    const { order, dae } = context;
    const errors = [];
    const warnings = [];

    if (!order.daeNumber) errors.push("Falta DAE asignada.");
    if (!order.destination) errors.push("Falta destino del pedido.");
    if (!order.flightDate) errors.push("Falta fecha de vuelo.");
    if (order.daeNumber && !dae) errors.push("La DAE asignada no existe en el catalogo demo.");
    if (order.daeExpirationDate && order.flightDate && order.flightDate > order.daeExpirationDate) {
      errors.push("La fecha de vuelo supera la caducidad de la DAE.");
    }
    if (dae && dae.destination !== order.destination) warnings.push("La DAE no coincide con el destino del pedido.");
    if (dae && utils.isDaeNearExpiry(dae)) warnings.push("La DAE esta proxima a caducar.");

    return { errors, warnings };
  }

  function daeState(context) {
    const { order, dae } = context;
    if (!order.daeNumber || !dae) return "error";
    if (order.daeExpirationDate && order.flightDate && order.flightDate > order.daeExpirationDate) return "error";
    if (utils.isDaeExpired(dae)) return "caducada";
    if (utils.isDaeNearExpiry(dae)) return "proxima a caducar";
    return "vigente";
  }

  function renderDaeControl(context) {
    const { order, brand, dae, relatedOrders } = context;
    const state = daeState(context);
    const relatedRows = relatedOrders.map(item => {
      const relatedBrand = utils.findBrand(item.brandId);
      return [
        item.number,
        utils.dateLabel(item.flightDate),
        relatedBrand?.name || "-",
        item.destination || "-",
        item.status || "BORRADOR"
      ];
    });

    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Control interno</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">CONTROL DAE</h2>
            <p class="doc-subtitle">Revision interna de vigencia, destino y pedidos vinculados demo.</p>
          </div>
          <div class="doc-box">
            <h4>Estado DAE</h4>
            ${printUtils.renderInfoRows([
              ["Estado", state],
              ["Marca / cliente final", brand?.name || "-"],
              ["Destino pedido", order.destination || "-"],
              ["Fecha emision", utils.dateLabel(order.issuedAt)],
              ["Fecha vuelo", utils.dateLabel(order.flightDate)]
            ])}
          </div>
        </div>

        ${printUtils.renderMetricPills([
          { label: "DAE asignada", value: order.daeNumber || "-" },
          { label: "Destino DAE", value: order.daeDestination || dae?.destination || "-" },
          { label: "Caducidad", value: utils.dateLabel(order.daeExpirationDate || dae?.expirationDate) },
          { label: "Autoasignada", value: order.daeAssignedAutomatically ? "Si" : "No" },
          { label: "Modificada manual", value: order.daeModifiedManual ? "Si" : "No" },
          { label: "Pedidos vinculados", value: String(relatedOrders.length) }
        ])}

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Advertencias</h4>
            ${printUtils.renderValidationList(
              [
                state === "error" ? "Revisar DAE antes de validar el pedido." : "",
                !order.daeNumber ? "No se puede usar este pedido para vuelo internacional sin DAE." : "",
                dae && dae.destination !== order.destination ? "La DAE y el destino no coinciden." : ""
              ].filter(Boolean),
              "Sin advertencias manuales."
            )}
          </section>
          <section class="doc-box">
            <h4>Pedidos vinculados demo</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Pedido", "Fecha vuelo", "Marca", "Destino", "Estado"],
              relatedRows,
              []
            )}
          </section>
        </div>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.CONTROL_DAE = {
    code: "CONTROL_DAE",
    name: "Control DAE",
    description: "Control interno de vigencia y destino de la DAE del pedido.",
    validate: validateDaeControl,
    render: renderDaeControl
  };
})();
