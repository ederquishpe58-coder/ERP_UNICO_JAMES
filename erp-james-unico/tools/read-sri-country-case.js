/* Run in the ERP browser session. Defines a reader; does not execute on load. */
(function(root) {
  "use strict";
  root.readSriCountryCase = async function({companyId, companyName, orderNumber}) {
    const ERP = root.BlessERP;
    const text = value => String(value ?? "").trim();
    const access = () => ERP?.authAccess?.activeAccess?.();
    const initial = access();
    const actor = initial?.session?.user?.id;
    if (!actor || !companyId || !companyName || !orderNumber
        || initial?.activeCompany?.id !== companyId) throw Error("Seleccione la empresa solicitada en su sesion ERP autenticada.");
    const client = ERP.getSupabaseClient();
    const user = await client.auth.getUser();
    if (user.error || user.data?.user?.id !== actor) throw Error("No se pudo verificar la sesion autenticada.");
    const check = () => {
      if (access()?.activeCompany?.id !== companyId || access()?.session?.user?.id !== actor) {
        throw Error("Cambio de empresa o sesion durante la lectura.");
      }
    };
    const read = async query => {
      check();
      const {data, error} = await query;
      check();
      if (error) throw Error("Lectura no autorizada o no disponible: " + text(error.code));
      return data;
    };
    const company = await read(client.from("companies").select("id,name").eq("id", companyId).single());
    if (text(company.name).toUpperCase() !== text(companyName).toUpperCase()) throw Error("La empresa canonica no coincide con el nombre solicitado.");
    const repo = ERP.getCommercialOrderRepository?.();
    if (!repo?.listPage) throw Error("Consulta canonica de pedidos no disponible.");
    const first = await repo.listPage({page: 1, pageSize: 100, filters: {search: orderNumber}});
    check();
    if (!first.ok || first.companyId !== companyId || first.mode !== "SUPABASE_ENTITY_RECORDS") throw Error("No se obtuvo historial canonico autorizado.");
    let matches = first.items.filter(row => row.number === orderNumber);
    for (let page = 2; page <= first.totalPages; page++) {
      const result = await repo.listPage({page, pageSize: 100, filters: {search: orderNumber}});
      check();
      if (!result.ok || result.companyId !== companyId) throw Error("Lectura incompleta del historial.");
      matches.push(...result.items.filter(row => row.number === orderNumber));
    }
    if (matches.length !== 1) throw Error(matches.length ? "Numero ambiguo dentro de la empresa." : "Pedido no visible mediante la consulta autorizada; no demuestra ausencia.");
    const records = await read(client.from("erp_entity_records").select("company_id,record_id,payload")
      .eq("company_id", companyId).eq("entity", "commercial_orders").eq("payload->>number", orderNumber).is("deleted_at", null));
    if (records?.length !== 1) throw Error("No se pudo resolver un unico ID canonico del pedido.");
    const record = records[0], order = record.payload;
    if (matches[0].id !== (order.id || record.record_id)) throw Error("El historial y el detalle no coinciden.");
    const countryId = order.destinationId || order.destination_id || order.destinationCountryId || order.destination_country_id || "";
    const savedName = order.destinationCountry || order.destination_country || "";
    const catalog = await read(client.rpc("erp_commercial_order_countries", {p_company_id: companyId}));
    if (catalog?.company_id !== companyId || catalog.read_only !== true || catalog.source !== "commercial_countries"
        || !Array.isArray(catalog.records)) throw Error("Catalogo canonico no verificado.");
    const fold = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const selected = catalog.records.filter(row => countryId ? row.id === countryId
      : savedName && [row.name, row.legacy_name].some(name => fold(name) === fold(savedName)));
    let codes = [], countryRead = countryId || savedName ? "COUNTRY_NOT_FOUND" : "COUNTRY_ABSENT";
    if (selected.length > 1) countryRead = "COUNTRY_AMBIGUOUS";
    if (selected.length === 1) {
      const rows = await read(client.from("erp_entity_records").select("record_id,payload")
        .eq("company_id", companyId).eq("entity", "commercial_countries").eq("record_id", selected[0].id));
      if (rows?.length !== 1) throw Error("Registro fiscal del pais no visible; no demuestra mapeo ausente.");
      const fields = ["sriCountryCode", "sri_country_code", "sriCode", "sri_code", "countrySriCode",
        "country_sri_code", "codigoSri", "codigo_sri", "codigoSriPais", "codigo_sri_pais"];
      codes = [...new Set(fields.map(field => text(rows[0].payload[field])).filter(Boolean))];
      countryRead = !codes.length ? "SRI_MAPPING_ABSENT" : codes.length !== 1 || !/^\d{3}$/.test(codes[0]) ? "SRI_MAPPING_INVALID" : "READ";
    }
    // A denied fiscal read is reported separately, never as an absent document.
    let fiscal;
    try {
      const reservations = await read(client.from("commercial_invoice_reservations")
        .select("id,status,consumed_document_id").eq("company_id", companyId).eq("record_id", record.record_id));
      const linked = new Map();
      const add = rows => (rows || []).forEach(row => linked.set(row.id, row));
      const projection = "id,status,source_snapshot";
      add(await read(client.from("electronic_documents").select(projection).eq("company_id", companyId)
        .eq("source_snapshot->erpEmission->>sourceOrderId", record.record_id)));
      if (/^[0-9a-f-]{36}$/i.test(record.record_id)) add(await read(client.from("electronic_documents")
        .select(projection).eq("company_id", companyId).eq("source_order_id", record.record_id)));
      const documentIds = [...new Set([order.sriRemoteDocumentId, ...(reservations || []).map(row => row.consumed_document_id)].filter(Boolean))];
      if (documentIds.length) add(await read(client.from("electronic_documents").select(projection)
        .eq("company_id", companyId).in("id", documentIds)));
      fiscal = {read: "READ_WITH_SESSION_RLS", reservations, documents: [...linked.values()].map(row => ({
        id: row.id, status: row.status, snapshotCountryCode: row.source_snapshot?.invoice?.destinationCountryCode ?? null
      }))};
    } catch (error) { fiscal = {read: "NOT_VERIFIED", diagnostic: error.message}; }
    check();
    return {company: {id: company.id, name: company.name}, orderId: record.record_id,
      transport: order.transportType ?? order.transport_type ?? null,
      savedDestination: {id: countryId || null, name: savedName || null,
        code: order.destinationCountryCode ?? order.destination_country_code ?? null},
      canonicalSriCountryCode: {read: countryRead, countryId: selected.length === 1 ? selected[0].id : null, codes},
      fiscal};
  };
})(typeof window === "undefined" ? globalThis : window);
