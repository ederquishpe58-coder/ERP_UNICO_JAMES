(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const RPC_NAME = "erp_sri_v2_senae_liquidation";
  const ALLOWED_PAGE_SIZES = new Set([25, 50, 200]);
  const ALLOWED_COMMERCE_TYPES = new Set(["TODOS", "LOCAL", "EXPORTADOR"]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let realtimeChannel = null;

  function deriveSenaeCommerceType(document = {}) {
    const value = String(document?.source_snapshot?.invoice?.commerceType || document?.commerce_type || "").trim().toUpperCase();
    if (value === "LOCAL") return "LOCAL";
    if (value === "EXPORTADOR") return "EXPORTADOR";
    return "SIN_CLASIFICAR";
  }

  function validateFilters(filters = {}) {
    const dateFrom = String(filters.dateFrom || "").trim();
    const dateTo = String(filters.dateTo || "").trim();
    const commerceType = String(filters.commerceType || "TODOS").trim().toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      throw new Error("Seleccione las fechas Desde y Hasta para consultar la Liquidación SENAE.");
    }
    if (dateFrom > dateTo) throw new Error("La fecha Desde no puede ser posterior a la fecha Hasta.");
    if (!ALLOWED_COMMERCE_TYPES.has(commerceType)) throw new Error("El tipo de comercio seleccionado no es válido.");
    const page = Math.max(1, Number(filters.page || 1));
    const requestedPageSize = Number(filters.pageSize || 25);
    const pageSize = ALLOWED_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    return { dateFrom, dateTo, commerceType, page, pageSize };
  }

  async function activeCompanyUuid() {
    const accessId = String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id || "").trim();
    if (UUID_PATTERN.test(accessId)) return accessId;
    if (typeof BlessERP.sriApi?.discoverCompanies === "function") await BlessERP.sriApi.discoverCompanies();
    const sriCompanyId = String(BlessERP.sriApi?.activeCompany?.()?.companyId || "").trim();
    if (!UUID_PATTERN.test(sriCompanyId)) throw new Error("La empresa activa no tiene una vinculación SRI V2 válida.");
    return sriCompanyId;
  }

  function normalizeResult(data, filters) {
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || !Array.isArray(result.items)) throw new Error("El read-model SENAE V2 devolvió una respuesta inválida.");
    return {
      ok: true,
      items: result.items,
      total: Number(result.total || 0),
      page: Number(result.page || filters.page),
      pageSize: Number(result.pageSize || filters.pageSize),
      totalPages: Number(result.totalPages || 1),
      summary: result.summary || {},
      serverTime: String(result.serverTime || "")
    };
  }

  function functionalError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)) {
      return new Error("El read-model Liquidación SENAE V2 todavía no está disponible en este entorno.");
    }
    if (code === "42501" || /SENAE_LIQUIDATION_FORBIDDEN/.test(message)) {
      return new Error("No tiene acceso a los documentos SRI de la empresa activa.");
    }
    return new Error(message || "No fue posible consultar Liquidación SENAE V2.");
  }

  async function queryPage(filters = {}) {
    const normalized = validateFilters(filters);
    const client = BlessERP.getSupabaseClient?.();
    if (!client?.rpc) throw new Error("Supabase no está disponible para consultar Liquidación SENAE V2.");
    const companyId = await activeCompanyUuid();
    const { data, error } = await client.rpc(RPC_NAME, {
      p_company_id: companyId,
      p_date_from: normalized.dateFrom,
      p_date_to: normalized.dateTo,
      p_commerce_type: normalized.commerceType === "TODOS" ? null : normalized.commerceType,
      p_page: normalized.page,
      p_page_size: normalized.pageSize
    });
    if (error) throw functionalError(error);
    return { ...normalizeResult(data, normalized), filters: normalized, companyId };
  }

  async function exportAll(filters = {}) {
    const normalized = validateFilters({ ...filters, page: 1, pageSize: 200 });
    const documents = [];
    const seen = new Set();
    let page = 1;
    let summary = null;
    let companyId = "";
    while (page <= 10000) {
      const result = await queryPage({ ...normalized, page, pageSize: 200 });
      summary ||= result.summary;
      companyId ||= result.companyId;
      result.items.forEach(document => {
        const id = String(document?.id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        documents.push(document);
      });
      if (page >= result.totalPages) break;
      if (!result.items.length) throw new Error("La exportación SENAE fue detenida porque la paginación no avanzó.");
      page += 1;
    }
    return { documents, summary: summary || {}, companyId, filters: normalized };
  }

  async function subscribe(onChange) {
    unsubscribe();
    const client = BlessERP.getSupabaseClient?.();
    if (!client?.channel || typeof onChange !== "function") return null;
    const companyId = await activeCompanyUuid();
    realtimeChannel = client
      .channel(`senae-liquidation-v2-${companyId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${companyId}`
      }, onChange)
      .subscribe();
    return realtimeChannel;
  }

  function unsubscribe() {
    const client = BlessERP.getSupabaseClient?.();
    if (realtimeChannel && client?.removeChannel) client.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  const repository = Object.freeze({
    RPC_NAME,
    activeCompanyUuid,
    deriveSenaeCommerceType,
    exportAll,
    queryPage,
    subscribe,
    unsubscribe,
    validateFilters
  });

  BlessERP.getSenaeLiquidationV2Repository = function() { return repository; };
})();
