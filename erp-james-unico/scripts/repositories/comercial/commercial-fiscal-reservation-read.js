(function(){
  const B = window.BlessERP = window.BlessERP || {};
  const text = value => String(value ?? "").trim();
  const fields = "id,company_id,record_id,environment,document_type,establishment_code,emission_point_code,sequential,full_number,status,consumed_document_id,created_at";
  const environments = ["TEST", "PRODUCTION"];
  function client(companyId) {
    const active = text(B.authAccess?.activeAccess?.()?.activeCompany?.id);
    if (!active || active !== companyId) throw new Error("La empresa cambio durante la lectura de reservas.");
    const db = B.getSupabaseClient?.();
    if (!db) throw new Error("La lectura canonica de reservas no esta disponible.");
    return db;
  }
  async function read(query, companyId) {
    const { data, error } = await query;
    client(companyId);
    if (error) throw new Error(error.message || "No se pudieron consultar las reservas fiscales.");
    if (!Array.isArray(data) || data.some(row => row.company_id !== companyId)) throw new Error("Respuesta de reservas fuera del ambito solicitado.");
    return data;
  }
  async function list({ companyId, orderIds, environment, from, to, activeOnly = false }) {
    client(companyId);
    if (environment != null && !environments.includes(environment)) throw new Error("Ambiente de reserva no valido.");
    if (orderIds && !orderIds.length) return [];
    if (!orderIds && (!environment || !/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || ""))) throw new Error("La consulta de reservas requiere ambiente y periodo.");
    const ids = orderIds ? [...new Set(orderIds.map(text).filter(Boolean))] : null;
    const batches = ids ? Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100)) : [null];
    const result = new Map();
    for (const batch of batches) {
      for (let offset = 0; ; offset += 200) {
        let query = client(companyId).from("commercial_invoice_reservations").select(fields)
          .eq("company_id", companyId).eq("document_type", "01")
          .in("status", activeOnly ? ["ACTIVE"] : ["ACTIVE", "CONSUMED"]);
        if (environment) query = query.eq("environment", environment);
        if (batch) query = query.in("record_id", batch);
        if (from) query = query.gte("created_at", `${from}T00:00:00-05:00`);
        if (to) query = query.lte("created_at", `${to}T23:59:59.999999-05:00`);
        const rows = await read(query.order("id", { ascending: true }).range(offset, offset + 199), companyId);
        for (const row of rows) {
          if (!row.id || !row.record_id || !environments.includes(row.environment) || row.document_type !== "01"
              || (environment && row.environment !== environment) || (batch && !batch.includes(row.record_id))
              || !(activeOnly ? ["ACTIVE"] : ["ACTIVE", "CONSUMED"]).includes(row.status)) throw new Error("Reserva fiscal incompatible con la consulta.");
          result.set(row.id, row);
        }
        if (rows.length < 200) break;
      }
    }
    return [...result.values()];
  }
  async function entities(companyId, entity, ids) {
    const result = new Map(), unique = [...new Set(ids.map(text).filter(Boolean))];
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const rows = await read(client(companyId).from("erp_entity_records")
        .select("company_id,entity,record_id,payload,deleted_at").eq("company_id", companyId)
        .eq("entity", entity).in("record_id", batch).is("deleted_at", null), companyId);
      for (const row of rows) {
        if (row.entity !== entity || !batch.includes(row.record_id) || row.deleted_at || result.has(row.record_id)) throw new Error("Relacion comercial ambigua en la reserva.");
        result.set(row.record_id, { ...row.payload, id: row.record_id });
      }
    }
    return result;
  }
  function cycleKey(row) {
    return JSON.stringify([row.company_id, row.environment, row.document_type, row.record_id]);
  }
  async function pending(options) {
    const reservations = await list({ ...options, activeOnly: true });
    const orders = await entities(options.companyId, "commercial_orders", reservations.map(row => row.record_id));
    const customers = await entities(options.companyId, "commercial_customers", [...orders.values()].map(order => order.customerId));
    const brands = await entities(options.companyId, "commercial_brands", [...orders.values()].map(order => order.brandId));
    const counts = new Map();
    reservations.forEach(row => counts.set(cycleKey(row), (counts.get(cycleKey(row)) || 0) + 1));
    return reservations.map(reservation => {
      const order = orders.get(reservation.record_id);
      return { ...reservation, order: order || null, customer: customers.get(order?.customerId) || null,
        brand: brands.get(order?.brandId) || null,
        requiresReview: !order || Boolean(reservation.consumed_document_id) || counts.get(cycleKey(reservation)) !== 1 };
    });
  }
  function historyLabel(reservations) {
    const groups = new Map();
    for (const row of reservations || []) {
      const key = cycleKey(row), group = groups.get(key) || new Map();
      group.set(row.id, row); groups.set(key, group);
    }
    return [...groups.values()].map(group => [...group.values()].map(row =>
      `${row.full_number} (${row.environment}; ${group.size > 1 ? "REQUIERE REVISION" : row.status === "ACTIVE" ? "RESERVADO" : "CONSUMED"})`
    ).join(" / ")).join(" / ");
  }
  B.commercialFiscalReservationRead = { list, pending, historyLabel, cycleKey };
})();
