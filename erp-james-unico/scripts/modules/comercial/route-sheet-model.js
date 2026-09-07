(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function text(value) {
    return String(value ?? "").trim();
  }

  function upper(value) {
    return text(value).toUpperCase();
  }

  function isCurrentCompanyOrder(order, appState) {
    const active = BlessERP.authAccess?.activeAccess?.()?.activeCompany;
    const workspaceId = text(BlessERP.commercialFlowV2?.activeCompanyId?.(appState) || appState?.db?.activeCompanyId);
    const activeAliases = [active?.id, active?.company_key, active?.companyKey].map(text).filter(Boolean);
    if (active?.id && workspaceId && !activeAliases.includes(workspaceId)) return false;
    const aliases = new Set([...activeAliases, workspaceId].filter(Boolean));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const canonicalId = text(order?.company_id || order?.__companyId);
    if (uuid.test(canonicalId)) return canonicalId === text(active?.id);
    const references = [order?.sellingCompanyId, order?.companyId, order?.company_id, order?.__companyId].map(text).filter(Boolean);
    return references.length > 0 && references.every(id => aliases.has(id));
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

  function isEligible(order, options = {}, appState) {
    if (!order || upper(order.status) === "ANULADO") return false;
    if (options.date && orderDate(order) !== text(options.date).slice(0, 10)) return false;
    return BlessERP.commercialFlowV2?.isLocalOrder?.(order, appState) === true
      || ["AEREO", "MARITIMO"].includes(transportOf(order));
  }

  function build(orders, appState, options = {}) {
    const agencies = agencyCatalog(appState);
    const agencyById = new Map(agencies.map(agency => [text(agency.id || agency.record_id), agency]));
    const normalizedRows = (Array.isArray(orders) ? orders : [])
      .filter(order => isEligible(order, options, appState))
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
        const isLocal = BlessERP.commercialFlowV2?.isLocalOrder?.(sourceOrder, appState) === true;
        const transportType = transportOf(order);
        return {
          order,
          orderId: text(order.id || order.order_id),
          agency,
          agencyId,
          agencyValid,
          isLocal,
          printable: isLocal || agencyValid,
          agencyKey: isLocal ? "LOCAL" : agencyValid ? `AGENCY:${agencyId}` : "NO_AGENCY",
          agencyName: isLocal ? "ENTREGA LOCAL" : agencyValid ? text(agency.name || agency.legalName || agency.commercialName) : "SIN AGENCIA / PENDIENTE",
          transportType,
          transportLabel: isLocal ? "LOCAL" : transportType === "MARITIMO" ? "MARITIMO" : "AEREO",
          motherGuide: text(order.awb || order.mawb || order.masterGuide || order.motherGuide),
          destination: text((isLocal && (sourceOrder.deliveryAddress || sourceOrder.shippingAddress || sourceOrder.destination)) || order.destination || order.destinationCountry || order.country) || "PENDIENTE"
        };
      })
      .sort((left, right) => {
        if (left.isLocal !== right.isLocal) return left.isLocal ? 1 : -1;
        if (!left.isLocal && left.agencyValid !== right.agencyValid) return left.agencyValid ? -1 : 1;
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
          isLocal: row.isLocal,
          printable: row.printable,
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
    isCurrentCompanyOrder,
    build,
    isEligible,
    orderDate,
    transportOf
  };
})();
