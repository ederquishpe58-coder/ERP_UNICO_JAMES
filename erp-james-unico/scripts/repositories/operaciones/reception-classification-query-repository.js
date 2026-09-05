(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const PAGE_SIZES = new Set([25, 50]);

  function activeCompanyId() {
    return String(
      BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
  }

  function pageSize(value) {
    const parsed = Number(value || 25);
    return PAGE_SIZES.has(parsed) ? parsed : 25;
  }

  function filters(value = {}) {
    return {
      p_date_from: value.dateFrom || null,
      p_date_to: value.dateTo || null,
      p_supplier: String(value.supplier || "").trim() || null,
      p_block: String(value.block || "").trim() || null,
      p_variety: String(value.variety || "").trim() || null,
      p_status: String(value.status || "").trim() || null,
      p_search: String(value.search || "").trim() || null
    };
  }

  async function call(name, params) {
    const companyId = activeCompanyId();
    const client = BlessERP.getSupabaseClient?.();
    if (!companyId) throw new Error("Seleccione una empresa activa para consultar Poscosecha.");
    if (!client?.rpc) throw new Error("La consulta canónica de Poscosecha no está disponible.");
    const startedAt = performance.now();
    const { data, error } = await client.rpc(name, { p_company_id: companyId, ...params });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return {
      ...(result || {}),
      items: Array.isArray(result?.items) ? result.items : [],
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      payloadBytes: new TextEncoder().encode(JSON.stringify(result || {})).length
    };
  }

  function listReceptionLines(value = {}) {
    const size = pageSize(value.pageSize);
    return call("erp_operations_v2_list_reception_lines", {
      ...filters(value),
      p_only_pending: value.onlyPending === true,
      p_page: Math.max(1, Number(value.page || 1)),
      p_page_size: size
    });
  }

  function listDeliveries(value = {}) {
    const size = pageSize(value.pageSize);
    return call("erp_operations_v2_list_classification_deliveries", {
      ...filters(value),
      p_classifier: String(value.classifier || "").trim() || null,
      p_page: Math.max(1, Number(value.page || 1)),
      p_page_size: size
    });
  }

  async function exportDeliveries(value = {}) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await listDeliveries({ ...value, page, pageSize: 50 });
      items.push(...result.items);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      page += 1;
    } while (page <= totalPages);
    return items;
  }

  const repository = Object.freeze({ exportDeliveries, listDeliveries, listReceptionLines });
  BlessERP.getReceptionClassificationQueryRepository = () => repository;
})();
