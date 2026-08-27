(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function text(value) {
    return String(value ?? "").trim();
  }

  function upper(value) {
    return text(value).toUpperCase();
  }

  function agencyIdOf(order) {
    return text(order?.cargoAgencyId || order?.cargo_agency_id || order?.agencyId || order?.agency_id);
  }

  function transportOf(order) {
    return upper(BlessERP.comercialUtils?.normalizeTransportType?.(order?.transportType || order?.transport_type) || order?.transportType || order?.transport_type || "AEREO");
  }

  function agencyCatalog(appState) {
    const fromFlow = BlessERP.commercialFlowV2?.catalogs?.(appState)?.agencies;
    if (Array.isArray(fromFlow)) return fromFlow;
    const fromState = BlessERP.comercialState?.getAgencyCatalog?.(appState);
    if (Array.isArray(fromState)) return fromState;
    return Array.isArray(BlessERP.comercialData?.agencies) ? BlessERP.comercialData.agencies : [];
  }

  function orderDate(order) {
    return text(order?.issuedAt || order?.issueDate || order?.date).slice(0, 10);
  }

  function isEligible(order, options = {}) {
    if (!order || upper(order.status) === "ANULADO") return false;
    if (options.date && orderDate(order) !== text(options.date).slice(0, 10)) return false;
    return ["AEREO", "MARITIMO"].includes(transportOf(order));
  }

  function build(orders, appState, options = {}) {
    const agencies = agencyCatalog(appState);
    const agencyById = new Map(agencies.map(agency => [text(agency.id || agency.record_id), agency]));
    const normalizedRows = (Array.isArray(orders) ? orders : [])
      .filter(order => isEligible(order, options))
      .map(sourceOrder => {
        const order = BlessERP.comercialUtils?.normalizeOrder
          ? BlessERP.comercialUtils.normalizeOrder(sourceOrder)
          : { ...sourceOrder };
        const agencyId = agencyIdOf(sourceOrder) || agencyIdOf(order);
        if (agencyId) {
          order.agencyId = agencyId;
          order.cargoAgencyId = agencyId;
        }
        const agency = agencyId ? agencyById.get(agencyId) || BlessERP.comercialUtils?.findAgency?.(agencyId) || null : null;
        const agencyValid = Boolean(agencyId && agency);
        const transportType = transportOf(order);
        return {
          order,
          orderId: text(order.id || order.order_id),
          agency,
          agencyId,
          agencyValid,
          agencyKey: agencyValid ? `AGENCY:${agencyId}` : "NO_AGENCY",
          agencyName: agencyValid ? text(agency.name || agency.legalName || agency.commercialName) : "SIN AGENCIA / PENDIENTE",
          transportType,
          transportLabel: transportType === "MARITIMO" ? "MARITIMO" : "AEREO",
          motherGuide: text(order.awb || order.mawb || order.masterGuide || order.motherGuide),
          destination: text(order.destination || order.destinationCountry || order.country) || "PENDIENTE"
        };
      })
      .sort((left, right) => {
        if (left.agencyValid !== right.agencyValid) return left.agencyValid ? -1 : 1;
        const byAgency = left.agencyName.localeCompare(right.agencyName, "es", { sensitivity: "base" });
        if (byAgency) return byAgency;
        // El orden histórico dentro de una agencia era el número de pedido ascendente.
        return text(left.order.number || left.orderId).localeCompare(text(right.order.number || right.orderId), "es", { numeric: true, sensitivity: "base" });
      });

    const groups = [];
    normalizedRows.forEach(row => {
      let group = groups[groups.length - 1];
      if (!group || group.key !== row.agencyKey) {
        group = {
          key: row.agencyKey,
          agencyId: row.agencyId,
          agency: row.agency,
          agencyName: row.agencyName,
          agencyValid: row.agencyValid,
          rows: []
        };
        groups.push(group);
      }
      group.rows.push(row);
    });

    return { rows: normalizedRows, groups };
  }

  BlessERP.comercialRouteSheetModel = {
    agencyIdOf,
    build,
    isEligible,
    orderDate,
    transportOf
  };
})();
