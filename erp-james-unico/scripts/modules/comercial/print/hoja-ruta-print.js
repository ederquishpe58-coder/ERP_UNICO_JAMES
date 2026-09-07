(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function routeOrdersFrom(context) {
    const { order, options = {} } = context;
    return Array.isArray(options.routeOrders) && options.routeOrders.length
      ? options.routeOrders
      : [order];
  }

  function preparedRouteRows(context) {
    const routeModel = BlessERP.comercialRouteSheetModel?.build?.(
      routeOrdersFrom(context),
      context.appState,
      { date: context.options?.routeDate || "" }
    );
    const modelRows = routeModel?.rows || routeOrdersFrom(context).map(order => ({ order, agency: null, agencyId: order?.agencyId || "", agencyValid: Boolean(order?.agencyId), agencyKey: String(order?.agencyId || "NO_AGENCY"), agencyName: order?.agencyName || "SIN AGENCIA / PENDIENTE", transportLabel: order?.transportType || "AEREO", motherGuide: order?.awb || "", destination: order?.destination || order?.destinationCountry || "PENDIENTE" }));
    const routeOrders = modelRows.map(row => row.order);
    const options = context.options || {};
    const key = routeOrders.map(order => [
      order?.id || order?.number || "",
      order?.__syncVersion || order?.version || order?.updatedAt || "",
      Array.isArray(order?.lines) ? order.lines.length : 0,
      order?.cargoAgencyId || order?.agencyId || "",
      order?.transportType || "",
      order?.awb || "",
      order?.company_id || order?.companyId || "",
      order?.sriInvoiceNumber || "",
      order?.invoiceReservationId || ""
    ].join(":" )).join("|");
    if (options.__routeSheetPrepared?.key === key) return options.__routeSheetPrepared.rows;
    const rows = modelRows.map(modelRow => {
      const sourceOrder = modelRow.order;
      const rowContext = printUtils.buildContext(sourceOrder, context.appState);
      const counts = { OCT: 0, SB: 0, QB: 0, HB: 0, FB: 0 };
      Object.entries(rowContext.metrics.byBoxType || {}).forEach(([code, count]) => {
        const normalizedCode = String(code || "").toUpperCase();
        if (["OCT", "EB"].includes(normalizedCode)) counts.OCT += Number(count || 0);
        else if (Object.hasOwn(counts, normalizedCode)) counts[normalizedCode] += Number(count || 0);
      });
      return {
        ...rowContext,
        agency: modelRow.agency || rowContext.agency,
        counts,
        routeAgencyId: modelRow.agencyId,
        routeAgencyKey: modelRow.agencyKey,
        routeAgencyName: modelRow.agencyName,
        routeAgencyValid: modelRow.agencyValid,
        routeIsLocal: modelRow.isLocal === true,
        routePrintable: modelRow.printable ?? modelRow.agencyValid,
        routeTransportLabel: modelRow.transportLabel,
        routeMotherGuide: modelRow.motherGuide,
        routeDestination: modelRow.destination
      };
    });
    options.__routeSheetPrepared = { key, rows };
    return rows;
  }

  function validateRouteSheet(context) {
    const errors = [];
    const warnings = [];

    preparedRouteRows(context).forEach(rowContext => {
      const sourceOrder = rowContext.order;
      const reference = sourceOrder.number || sourceOrder.id || "Pedido";
      if (!BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(sourceOrder)) {
        errors.push(`${reference}: falta numero de factura; no se pudo resolver la identidad canónica de factura.`);
      }
      if (!rowContext.routePrintable) errors.push(`${reference}: falta agencia de carga canónica.`);
      if (!sourceOrder.issuedAt) errors.push(`${reference}: falta fecha del pedido.`);
      if (!rowContext.boxGroups.length) errors.push(`${reference}: faltan cajas.`);
      if (!sourceOrder.coldRoom) warnings.push(`${reference}: falta cuarto frio.`);
    });

    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  function renderRouteSheet(context) {
    const { company, options = {} } = context;
    const routeRows = preparedRouteRows(context);
    const totals = routeRows.reduce((sum, row) => {
      sum.pieces += Number(row.metrics.totalBoxes || 0);
      sum.fulls += Number(row.metrics.totalFulls || 0);
      Object.keys(sum.types).forEach(code => { sum.types[code] += Number(row.counts[code] || 0); });
      return sum;
    }, { pieces: 0, fulls: 0, types: { OCT: 0, SB: 0, QB: 0, HB: 0, FB: 0 } });
    const first = routeRows[0] || context;
    const agencyGroups = [];
    routeRows.forEach(row => {
      let group = agencyGroups[agencyGroups.length - 1];
      if (!group || group.key !== row.routeAgencyKey) {
        group = { key: row.routeAgencyKey, name: row.routeAgencyName, valid: row.routePrintable, rows: [] };
        agencyGroups.push(group);
      }
      group.rows.push(row);
    });
    const routeDate = options.routeDate
      || first.order.issuedAt;
    const rows = agencyGroups.map(group => `
      <tr class="route-sheet-agency-group"><td colspan="11"><strong>${utils.esc(group.name)}</strong><span>${group.valid ? `${utils.esc(group.rows.length)} pedido(s)` : "PENDIENTE DE ASIGNAR"}</span></td></tr>
      ${group.rows.map(row => `
        <tr>
          <td><strong>${utils.esc(row.order.sriInvoiceNumber || "-")}</strong><br><small>${utils.esc(row.order.number || row.order.id || "-")}</small></td>
          <td><strong>${utils.esc(row.brand?.printedConsignee || "-")}</strong><br><small>${utils.esc(row.routeTransportLabel)} · ${utils.esc(row.routeIsLocal ? "" : row.routeMotherGuide || "GUIA PENDIENTE")} · ${utils.esc(row.routeDestination)}</small></td>
          <td>${utils.esc(row.routeAgencyName)}</td>
          <td>${utils.esc(row.order.coldRoom || "-")}</td>
          <td class="numeric">${utils.esc(utils.number(row.metrics.totalBoxes))}</td>
          <td class="numeric">${utils.esc(utils.number(row.counts.OCT))}</td>
          <td class="numeric">${utils.esc(utils.number(row.counts.SB))}</td>
          <td class="numeric">${utils.esc(utils.number(row.counts.QB))}</td>
          <td class="numeric">${utils.esc(utils.number(row.counts.HB))}</td>
          <td class="numeric">${utils.esc(utils.number(row.counts.FB))}</td>
          <td class="numeric">${utils.esc(Number(row.metrics.totalFulls || 0).toFixed(3))}</td>
        </tr>
      `).join("")}
    `).join("");

    return `
      <article class="doc-page route-sheet-page route-sheet-reference">
        <header class="route-sheet-header">
          <div class="route-sheet-brand">${printUtils.renderCompanyBrand(company)}</div>
          <div class="route-sheet-title"><h2>HOJA DE RUTA</h2><strong>LOCAL / EXPORTACION · FACTURAS</strong></div>
          <div class="route-sheet-dates">
            <span>Fecha generacion: <strong>${utils.esc(utils.dateLabel(new Date().toISOString()))}</strong></span>
            <span>Fecha del pedido: <strong>${utils.esc(utils.dateLabel(routeDate))}</strong></span>
          </div>
        </header>

        <section class="route-sheet-logistics">
          <div><span>Punto de origen</span><strong>${utils.esc(company?.address || company?.legalName || "Bless Flower")}</strong></div>
          <div><span>Punto de destino</span><strong>${utils.esc(agencyGroups.length === 1 ? agencyGroups[0].name : `${agencyGroups.length} grupos de entrega`)}</strong></div>
          <div><span>Transportista</span><strong>${utils.esc(first.order.transporter || first.order.carrierName || "Por asignar")}</strong></div>
          <div><span>Placa</span><strong>${utils.esc(first.order.vehiclePlate || first.order.plate || "Por asignar")}</strong></div>
        </section>

        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>FACT.</th>
                <th>CONSIGNATARIO</th>
                <th>AGENCIA CARGA</th>
                <th>CUARTO FRIO</th>
                <th>PIEZAS</th>
                <th>OCT</th>
                <th>SB</th>
                <th>QB</th>
                <th>HB</th>
                <th>FB</th>
                <th>FULLES</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="11">Sin cajas para hoja de ruta.</td></tr>`}
              <tr class="route-sheet-total"><td colspan="4">TOTAL</td><td>${utils.esc(utils.number(totals.pieces))}</td><td>${utils.esc(utils.number(totals.types.OCT))}</td><td>${utils.esc(utils.number(totals.types.SB))}</td><td>${utils.esc(utils.number(totals.types.QB))}</td><td>${utils.esc(utils.number(totals.types.HB))}</td><td>${utils.esc(utils.number(totals.types.FB))}</td><td>${utils.esc(totals.fulls.toFixed(3))}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="route-sheet-note"><strong>NOTA:</strong> Verificar que la cantidad de piezas entregadas coincida con el total indicado antes de firmar.</div>
        <div class="route-sheet-signatures">
          <div><span></span><strong>ENTREGA</strong><small>Nombre / firma</small></div>
          <div><span></span><strong>RECIBE</strong><small>Nombre / firma</small></div>
        </div>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.HR = {
    code: "HR",
    name: "HR / Hoja de Ruta",
    description: "Hoja consolidada por fecha del pedido con todas las facturas y piezas seleccionadas.",
    validate: validateRouteSheet,
    render: renderRouteSheet
  };
})();
