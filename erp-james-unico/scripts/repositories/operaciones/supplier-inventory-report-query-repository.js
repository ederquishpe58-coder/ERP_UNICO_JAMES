(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const DISPLAY_PAGE_SIZES = new Set([25, 50]);

  function activeCompanyId() {
    return String(
      BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
  }

  function normalizeFilters(value = {}) {
    return {
      from: String(value.from || "").trim(),
      to: String(value.to || "").trim(),
      supplier: String(value.supplier || "").trim(),
      block: String(value.block || "").trim(),
      variety: String(value.variety || "").trim(),
      length: String(value.length || "").trim(),
      classificationType: String(value.classificationType || "").trim().toUpperCase(),
      search: String(value.search || "").trim()
    };
  }

  function assertRange(filters) {
    if (!filters.from || !filters.to) throw new Error("Desde y Hasta son obligatorios.");
    if (filters.from > filters.to) throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
  }

  async function queryPage(filtersValue, options = {}) {
    const filters = normalizeFilters(filtersValue);
    assertRange(filters);
    const companyId = activeCompanyId();
    const client = BlessERP.getSupabaseClient?.();
    if (!companyId) throw new Error("Seleccione una empresa activa para consultar el reporte.");
    if (!client?.rpc) throw new Error("El read-model de Reporte de Proveedores no está disponible.");
    const requestedSize = Number(options.pageSize || 25);
    const pageSize = options.exportMode === true ? 200 : (DISPLAY_PAGE_SIZES.has(requestedSize) ? requestedSize : 25);
    const startedAt = performance.now();
    const { data, error } = await client.rpc("erp_operations_v2_supplier_inventory_report", {
      p_company_id: companyId,
      p_date_from: filters.from,
      p_date_to: filters.to,
      p_supplier: filters.supplier || null,
      p_block: filters.block || null,
      p_variety: filters.variety || null,
      p_length: filters.length ? Number(filters.length) : null,
      p_classification_type: filters.classificationType || null,
      p_search: filters.search || null,
      p_sort_field: String(options.sort?.field || "dateTime"),
      p_sort_direction: options.sort?.direction === "asc" ? "asc" : "desc",
      p_page: Math.max(1, Number(options.page || 1)),
      p_page_size: pageSize
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return {
      ...(result || {}),
      items: Array.isArray(result?.items) ? result.items : [],
      totals: result?.totals && typeof result.totals === "object" ? result.totals : {},
      filters,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      payloadBytes: new TextEncoder().encode(JSON.stringify(result || {})).length
    };
  }

  async function exportReport(filters, options = {}) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    let firstResult = null;
    do {
      const result = await queryPage(filters, { ...options, page, exportMode: true });
      if (!firstResult) firstResult = result;
      items.push(...result.items);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      page += 1;
    } while (page <= totalPages);
    return { ...(firstResult || {}), items, total: Number(firstResult?.total || items.length) };
  }

  const repository = Object.freeze({ exportReport, normalizeFilters, queryPage });
  BlessERP.getSupplierInventoryReportQueryRepository = () => repository;
})();
