import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/migrations/202608270001_commercial_profitability_search_first.sql");
const rangePatch = read("supabase/migrations/202608270002_commercial_profitability_unrestricted_range.sql");
const repositorySource = read("scripts/repositories/contabilidad/financial-v2-repository.js");
const serviceSource = read("scripts/services/financial-v2.js");
const reportSource = read("scripts/modules/comercial/reportes-comerciales.js");
const exporterSource = read("scripts/modules/comercial/commercial-profitability-report-xlsx.js");
const domainLoader = read("scripts/services/sync/domain-loader.js");
const capabilityPolicy = read("scripts/config/capability-policy.js");

assert(migration.includes("function public.erp_commercial_profitability_report("), "Falta el RPC de rentabilidad comercial acotada.");
assert(migration.includes("security definer") && migration.includes("set search_path = public, pg_temp"), "El RPC no conserva SECURITY DEFINER con search_path restringido.");
const capabilityGuard = migration.indexOf("erp_security_assert_capability(p_company_id, 'reports.commercial.view')");
const firstBusinessRead = migration.indexOf("from public.erp_entity_records");
assert(capabilityGuard >= 0 && firstBusinessRead > capabilityGuard, "La capability debe validarse antes de toda lectura de negocio.");
assert(migration.includes("record.company_id = p_company_id"), "Falta aislamiento explícito por empresa.");
assert(migration.includes("filtered_orders as materialized"), "Los pedidos no se acotan antes de agregar finanzas.");
for (const source of [
  "erp_financial_receivables receivable",
  "erp_financial_order_cost_components component",
  "erp_financial_cost_allocations allocation"
]) {
  assert(migration.includes(`join filtered_orders orders on orders.order_id = ${source.split(" ").at(-1)}.order_id`), `La fuente ${source} no está limitada por pedidos filtrados.`);
}
assert(migration.includes("p_date_from is null or p_date_to is null"), "El rango de fechas no es obligatorio.");
assert(!rangePatch.includes("DATE_RANGE_TOO_WIDE") && !rangePatch.includes("> 366"), "La migración aditiva conserva el límite de rango inventado.");
assert(!repositorySource.includes("máximo 366 días") && !repositorySource.includes("COMMERCIAL_PROFITABILITY_MAX_PAGES"), "El cliente conserva límites funcionales inventados.");
assert(migration.includes("least(100, greatest(10"), "La página no está limitada a 100 filas.");
assert(migration.includes("limit v_page_size offset v_offset"), "Falta paginación server-side.");
assert(migration.includes("report_totals as") && migration.includes("'summary', jsonb_build_object("), "Falta agregación server-side de totales.");
assert(!migration.includes("erp_financial_v2_order_profitability"), "El RPC vuelve a usar la vista company-wide sin acotar.");
assert(migration.includes("grant execute on function public.erp_commercial_profitability_report") && migration.includes("to authenticated"), "El grant público del RPC es incorrecto.");
assert(migration.includes("values ('erp_commercial_profitability_report', 'reports.commercial.view')"), "Falta registrar el read RPC con su capability exacta.");
assert(migration.includes("notify pgrst, 'reload schema'"), "Falta recargar el schema cache de PostgREST.");
assert(!/\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:erp_entity_records|erp_financial_receivables|erp_financial_order_cost_components|erp_financial_cost_allocations|erp_financial_shipment_expenses)\b/i.test(migration), "La migración contiene una mutación de negocio.");

const renderBody = reportSource.slice(reportSource.indexOf("function render("), reportSource.indexOf("function rerender("));
assert(reportSource.includes("data-commercial-report-query") && reportSource.includes('? "Consultando..." : "Consultar"'), "Falta la acción explícita Consultar.");
assert(!renderBody.includes("queryFinancialProfitability()"), "Abrir/renderizar la ruta aún dispara la consulta histórica.");
assert(reportSource.includes('querySelector("[data-commercial-report-query]")') && reportSource.includes("queryFinancialProfitability();"), "Consultar no está enlazado a la lectura acotada.");
assert(reportSource.includes("if (!ui.queried) return []"), "La pantalla puede mostrar filas antes de Consultar.");
assert(reportSource.includes("resetQueryResult();") && reportSource.includes("No se carga historial al abrir la ruta"), "Cambiar filtros no invalida el resultado o falta el estado Search-First.");
assert(!reportSource.includes("allOrderProfitability") && !serviceSource.includes("allOrderProfitability") && !repositorySource.includes("allOrderProfitability"), "Permanece expuesto el pull histórico company-wide.");
assert(serviceSource.includes("commercialProfitabilityReport: filters => repository()?.commercialProfitabilityReport(filters)"), "El servicio no usa el nuevo contrato.");
assert(reportSource.includes("orders,") && exporterSource.includes("Array.isArray(options.orders)"), "El XLSX no consume los pedidos canónicos acotados devueltos por el RPC.");
assert(capabilityPolicy.includes('"reports-commercial": "reports.commercial.view"'), "La ruta perdió su capability aprobada.");

const reportDomains = domainLoader.match(/"reports-commercial":\s*\[([^\]]*)\]/)?.[1] || "";
const domains = [...reportDomains.matchAll(/"([^"]+)"/g)].map(match => match[1]);
assert(JSON.stringify(domains) === JSON.stringify(["commercial-catalog", "operations-workspace"]), `Dependencias de dominio inesperadas: ${domains.join(", ")}`);
assert(exporterSource.includes("activeCatalogs(appState, companyId)"), "commercial-catalog ya no tiene consumidor real en el XLSX.");
assert(exporterSource.includes("inventoryIndexes(appState)"), "operations-workspace ya no tiene consumidor real en el XLSX.");
assert(!reportDomains.includes("commercial-workspace") && !reportDomains.includes("operations-catalog"), "Persisten domains sin consumidor activo en Reportes Comerciales.");

const requiredHealth = [
  "sequenceTable", "journalTable", "journalLinesTable", "receivablesTable", "creditNotesTable",
  "collectionsTable", "applicationsTable", "costsTable", "expensesTable", "allocationsTable", "eventsTable",
  "orderProfitabilityView", "shipmentProfitabilityView", "operationsDependency", "exportDependency",
  "postJournalRpc", "postInvoiceRpc", "postCreditNoteRpc", "reverseJournalRpc", "registerCollectionRpc",
  "reverseCollectionRpc", "recordCostRpc", "recordShipmentExpenseRpc"
];
const healthResult = Object.fromEntries(requiredHealth.map(key => [key, true]));
Object.assign(healthResult, { ok: true, component: "FINANCIAL_V2", migration: "202608150009" });
const repositoryCalls = [];
const reportItems = Array.from({ length: 205 }, (_, index) => ({
  order_id: `ORDER-${index + 1}`,
  order: { id: `ORDER-${index + 1}`, issuedAt: "2026-08-01", lines: [] },
  revenue: 1,
  direct_cost: 0.5,
  allocated_cost: 0.25,
  margin: 0.25
}));
const reportSummary = { officialRevenue: 205, officialCosts: 153.75, officialMargin: 51.25 };
const client = {
  async rpc(name, parameters) {
    repositoryCalls.push({ name, parameters });
    if (name === "erp_financial_v2_health") return { data: healthResult, error: null };
    if (name === "erp_commercial_profitability_report") {
      const page = Number(parameters.p_page || 1);
      const pageSize = Number(parameters.p_page_size || 100);
      const offset = (page - 1) * pageSize;
      return {
        data: {
          ok: true,
          total: reportItems.length,
          totalPages: Math.ceil(reportItems.length / pageSize),
          summary: reportSummary,
          items: reportItems.slice(offset, offset + pageSize)
        },
        error: null
      };
    }
    throw new Error(`RPC inesperado en validator: ${name}`);
  }
};
const repositoryContext = {
  window: {
    location: { protocol: "https:" },
    BlessERP: {
      authAccess: { activeAccess: () => ({ activeCompany: { id: "11111111-1111-4111-8111-111111111111" } }) },
      getEnvConfig: () => ({ supabaseEnabled: true, financialV2CaptureEnabled: true }),
      getSupabaseClient: () => client
    }
  },
  console,
  Date,
  Math,
  JSON,
  Number,
  String,
  globalThis: {}
};
vm.runInNewContext(repositorySource, repositoryContext);
const repository = repositoryContext.window.BlessERP.getFinancialV2Repository();
assert(repositoryCalls.length === 0, "Inicializar el repositorio ejecutó una consulta.");
const invalid = await repository.commercialProfitabilityReport({ dateFrom: "2026-02-31", dateTo: "2026-03-01" });
assert(!invalid.ok && repositoryCalls.length === 0, "Un rango inválido llegó a Supabase.");
const wide = await repository.commercialProfitabilityReport({ dateFrom: "2024-01-01", dateTo: "2026-08-01", pageSize: 100 });
assert(wide.ok, "Un rango mayor a 366 días fue bloqueado por una regla inexistente.");
repositoryCalls.length = 0;
const result = await repository.commercialProfitabilityReport({
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
  includeAnnulled: false,
  pageSize: 100
});
const boundedCalls = repositoryCalls.filter(call => call.name === "erp_commercial_profitability_report");
assert(result.ok && result.rows.length === 205 && result.orders.length === 205, "El repositorio/XLSX quedó truncado a la primera página.");
assert(result.requestCount === 3 && boundedCalls.length === 3, "El request count no coincide con todas las páginas server-side.");
assert(boundedCalls.map(call => call.parameters.p_page).join(",") === "1,2,3", "Las páginas no se solicitan en orden.");
assert(boundedCalls.every(call => call.parameters.p_page_size === 100), "El repositorio excede o altera el page size acotado.");
assert(boundedCalls.every(call => call.parameters.p_date_from === "2026-08-01" && call.parameters.p_date_to === "2026-08-31"), "El rango no llega al servidor.");

const uiCalls = [];
const listeners = new Map();
const container = {
  innerHTML: "",
  querySelector(selector) {
    return {
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); }
    };
  }
};
const reportContext = {
  window: {
    BlessERP: {
      utils: { today: () => "2026-08-27" },
      comercialUtils: {
        esc: value => String(value ?? ""),
        number: value => String(Number(value || 0)),
        money: value => `$${Number(value || 0).toFixed(2)}`,
        getOrderMetrics: () => ({ totalBoxes: 0, totalStems: 0, totalUsd: 0 })
      },
      getFinancialV2Repository: () => ({ activeCompanyUuid: () => "11111111-1111-4111-8111-111111111111" }),
      services: {
        financialV2: {
          async commercialProfitabilityReport(filters) {
            uiCalls.push(filters);
            return { ok: true, rows: [], orders: [], summary: {}, total: 0, totalPages: 1, requestCount: 1 };
          }
        }
      },
      layout: { renderPage() {} }
    }
  },
  console,
  Date,
  Number,
  String,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(reportSource, reportContext);
reportContext.window.BlessERP.modules.commercialReports.render(container, { id: "reports-commercial" }, { db: {} });
assert(uiCalls.length === 0, "Abrir Reportes Comerciales ejecutó rentabilidad histórica.");
assert(container.innerHTML.includes("Consultar") && container.innerHTML.includes("No se carga historial al abrir"), "La apertura no presenta estado Search-First.");
listeners.get('[data-commercial-report-date-from]:change')?.({ currentTarget: { value: "2026-08-02" } });
await Promise.resolve();
assert(uiCalls.length === 0, "Cambiar filtros ejecutó automáticamente la consulta histórica.");
listeners.get('[data-commercial-report-query]:click')?.();
await new Promise(resolve => setTimeout(resolve, 0));
assert(uiCalls.length === 1 && uiCalls[0].dateFrom === "2026-08-02", "Consultar no ejecuta exactamente una lectura con los filtros vigentes.");

const exporterContext = {
  window: {
    BlessERP: {
      companyCapabilities: {
        COMPANY_IDS: { BLESS: "COMP-BLESS-FLOWER", IMPERIO: "COMP-IMPERIO-FLOWERS" },
        companyIdOf: value => String(value || ""),
        getCompany: id => ({ id, commercialName: "TEST COMPANY" })
      },
      services: { companyContext: { activeCompanyId: () => "COMP-BLESS-FLOWER" } },
      comercialIntercompany: {
        getCommercialStore: appState => appState.db.commercial,
        getAvailabilitySourceState: appState => appState
      },
      comercialUtils: { getOrderMetrics: order => ({ lines: order.lines }) },
      operacionesRamosReportXlsx: { reportPeriod: (from, to) => ({ period: "TEST", range: `${from} A ${to}` }) }
    }
  },
  console,
  Date,
  Number,
  String,
  Math,
  Set,
  Map
};
vm.runInNewContext(exporterSource, exporterContext);
const cleanState = {
  db: {
    activeCompanyId: "COMP-BLESS-FLOWER",
    commercial: { customerCatalog: [], brandCatalog: [] },
    operations: { roseInventory: [], availabilityDemo: [] }
  }
};
const exportOrders = reportItems.map((item, index) => ({
  ...item.order,
  number: `PED-${index + 1}`,
  companyId: "COMP-BLESS-FLOWER",
  lines: [{ boxNumber: 1, bunches: 1, stemsPerBunch: 1, unitPrice: 1 }]
}));
const cleanReport = exporterContext.window.BlessERP.comercialProfitabilityReportXlsx.buildReport(cleanState, {
  companyId: "COMP-BLESS-FLOWER",
  orders: exportOrders,
  financialRows: reportItems
});
assert(cleanReport.orders.length === 205 && cleanReport.rows.length === 205, "El XLSX limpio depende del cache commercial-workspace o trunca páginas.");
assert(cleanReport.validation.ok, "El XLSX no puede construirse con solo commercial-catalog + operations-workspace.");

const officialRows = reportItems;
const legacyTotals = officialRows.reduce((totals, row) => ({
  officialRevenue: totals.officialRevenue + Number(row.revenue || 0),
  officialCosts: totals.officialCosts + Number(row.direct_cost || 0) + Number(row.allocated_cost || 0),
  officialMargin: totals.officialMargin + Number(row.margin || 0)
}), { officialRevenue: 0, officialCosts: 0, officialMargin: 0 });
assert(JSON.stringify(legacyTotals) === JSON.stringify(result.summary), "Los totales financieros cambiaron respecto de la fórmula vigente.");
assert(reportSource.includes("utils.getOrderMetrics(order)"), "Las fórmulas comerciales de cajas/tallos/ventas fueron reemplazadas.");

console.log("COMMERCIAL_PROFITABILITY_SEARCH_FIRST_VALIDATION_OK");
console.log(JSON.stringify({
  routeOpenProfitabilityRequests: 0,
  filterChangeProfitabilityRequests: 0,
  queryProfitabilityRequests: 1,
  serverSideDateFilter: true,
  unboundedProfitabilitySelects: 0,
  pagination: { pageSizeMax: 100, pagesValidated: 3, rowsComposed: 205, xlsxTruncated: false },
  aggregation: "SERVER_SUMMARY_PLUS_BOUNDED_ORDER_DETAIL",
  totalsEquivalent: true,
  routeDomains: domains,
  cleanSessionDomainDependencies: true,
  businessMutations: 0
}, null, 2));
