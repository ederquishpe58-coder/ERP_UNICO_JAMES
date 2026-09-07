import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COMPANY_ID = "20000000-0000-4000-8000-000000000002";

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function evaluate(relativePath, context) {
  vm.runInContext(await read(relativePath), context, { filename: relativePath });
}

function canonicalDocument(index, commerceType, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    company_id: COMPANY_ID,
    document_type: "01",
    status: "AUTORIZADO",
    full_number: `001-003-${String(index).padStart(9, "0")}`,
    issue_date: index === 2 ? "2026-08-21" : "2026-08-20",
    authorized_at: "2026-08-21T01:30:00Z",
    authorization_number: `AUT-${index}`,
    access_key: `CLAVE-${index}`,
    subtotal: 100,
    tax_total: 15,
    grand_total: 115,
    buyer_snapshot: { legalName: `CLIENTE ${index}`, identification: `1790012345${String(index).padStart(3, "0")}` },
    source_snapshot: {
      invoice: { commerceType, destinationCountryCode: commerceType === "LOCAL" ? "EC" : "US" },
      erpEmission: { sourceOrderId: null, sourceOrderNumber: "" },
      additionalInformation: { "Marca cliente": "MARCA", Piezas: "1 cajas" },
      lines: [{ variety: "EXPLORER", measure: "60", unit: "RAMO", quantity: 10, unitPrice: 10, subtotal: 100 }]
    },
    ...overrides
  };
}

const indexHtml = await read("index.html");
const xlsxDescriptors = [...indexHtml.matchAll(/<script\b([^>]*data-jaeder-lazy-group="[^"]*commercial-senae-xlsx[^"]*"[^>]*)><\/script>/gi)]
  .map(match => match[1].match(/\bsrc="([^"]+)"/i)?.[1])
  .filter(Boolean)
  .map(source => source.split("?", 1)[0]);
assert.deepEqual(xlsxDescriptors, [
  "scripts/modules/operaciones/ramos-report-xlsx.js",
  "scripts/modules/reports-financial-xlsx.js"
], "La ruta fría SENAE debe cargar explícitamente constructor y generador XLSX.");
assert.ok(!xlsxDescriptors.includes("scripts/services/reports.js"));
assert.match(indexHtml, /commercial-senae[^\n]+senae-liquidation-v2-repository\.js/);

const reportSource = await read("scripts/modules/reports-financial-xlsx.js");
const uiSource = await read("scripts/modules/comercial/sri-authorization.js");
const repositorySource = await read("scripts/repositories/comercial/senae-liquidation-v2-repository.js");
const migrationSource = await read("supabase/migrations/202608230001_senae_liquidation_v2_read_model.sql");
for (const source of [reportSource, uiSource, repositorySource]) {
  assert.doesNotMatch(source, /services\.reports\.salesReport\s*\(/);
  assert.doesNotMatch(source, /comercialState\.getOrders\s*\(/);
  assert.doesNotMatch(source, /state\.db\.(?:orders|commercial)/);
}
assert.match(repositorySource, /erp_sri_v2_senae_liquidation/);
assert.match(repositorySource, /deriveSenaeCommerceType/);
assert.match(uiSource, /data-sri-query-senae/);
assert.match(uiSource, /ui\.senaeAppliedFilters/);
assert.match(uiSource, /Al abrir esta pantalla no se descargan documentos/);
assert.match(migrationSource, /document\.company_id = p_company_id/);
assert.match(migrationSource, /document\.document_type = '01'/);
assert.match(migrationSource, /document\.status = 'AUTORIZADO'/);
assert.match(migrationSource, /document\.issue_date >= p_date_from/);
assert.match(migrationSource, /document\.issue_date <= p_date_to/);
assert.match(migrationSource, /source_snapshot #>> '\{invoice,commerceType\}'/);
assert.match(migrationSource, /erp_is_company_member\(p_company_id, auth\.uid\(\)\)/);
assert.doesNotMatch(migrationSource, /\b(?:insert|update|delete)\s+(?:into|public\.)/i);

let reportCompanyId = COMPANY_ID;
const BlessERP = {
  services: {
    companyBranding: { resolve: () => ({ id: reportCompanyId, commercialName: reportCompanyId === COMPANY_ID ? "BLESS FLOWER" : "IMPERIO FLOWERS" }) },
    companyContext: { activeCompanyId: () => "COMP-BLESS-FLOWER" }
  }
};
const context = vm.createContext({
  window: { BlessERP }, document: undefined, console, Intl, Date, Map, Set, URL,
  Uint8Array, TextEncoder, atob, structuredClone, setTimeout, clearTimeout, AbortController
});
context.globalThis = context;
for (const descriptor of xlsxDescriptors) await evaluate(descriptor, context);
assert.equal(typeof BlessERP.operacionesRamosReportXlsx?.buildWorkbookArchive, "function");
assert.equal(typeof BlessERP.reportFinancialXlsx?.exportSenae, "function");
assert.equal(BlessERP.services.reports, undefined);

const documents = [
  canonicalDocument(1, "LOCAL"),
  canonicalDocument(2, "EXPORTADOR"),
  canonicalDocument(3, "DESCONOCIDO"),
  canonicalDocument(4, "LOCAL", { document_type: "07" }),
  canonicalDocument(5, "LOCAL", { status: "DEVUELTO" }),
  canonicalDocument(6, "LOCAL", { document_type: "04" }),
  canonicalDocument(7, "LOCAL", { company_id: OTHER_COMPANY_ID })
];
const logoBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), char => char.charCodeAt(0));
const result = await BlessERP.reportFinancialXlsx.exportSenae({ dateFrom: "2026-08-20", dateTo: "2026-08-21", commerceType: "TODOS" }, {
  documents: documents.filter(document => document.company_id === COMPANY_ID), download: false, logoBytes
});
assert.equal(result.ok, true, result.message);
assert.ok(result.archive.byteLength > 1000);
assert.deepEqual([result.report.counts.total, result.report.counts.local, result.report.counts.export, result.report.counts.unclassified], [3, 1, 1, 1]);
assert.equal(result.report.rows.find(row => row.commerceType === "EXPORTADOR")?.orderId, "", "Una factura sin pedido fue excluida.");
assert.equal(result.report.rows.some(row => row.documentType === "07" || row.documentType === "04"), false);
assert.equal(result.report.rows.some(row => row.status !== "AUTORIZADO"), false);
assert.equal(result.report.rows.some(row => row.issueDate === "2026-08-21"), true, "El último día no fue incluido.");
const senaeMainSheet = result.sheets.find(sheet => sheet.name === "Liquidacion SENAE");
const invoiceNumberColumn = senaeMainSheet?.headers.indexOf("Factura") ?? -1;
assert.notEqual(invoiceNumberColumn, -1, "Liquidación SENAE no incluye Factura.");
assert.equal(senaeMainSheet.headers.filter(header => header === "Factura").length, 1, "Liquidación SENAE duplicó la columna de factura.");
assert.equal(senaeMainSheet.widths.length, senaeMainSheet.headers.length, "Los anchos SENAE no coinciden con sus columnas.");
assert.ok(senaeMainSheet.rows.every(row => row.length === senaeMainSheet.headers.length), "Una fila SENAE perdió alineación al agregar la factura.");
assert.equal(senaeMainSheet.totals.length, senaeMainSheet.headers.length, "Los totales SENAE perdieron alineación.");
assert.ok(senaeMainSheet.rows.every(row => row[invoiceNumberColumn]?.xlsxType === "text"), "El número de factura SENAE no se preserva como texto.");
assert.deepEqual(
  senaeMainSheet.rows.map(row => row[invoiceNumberColumn].value),
  result.report.rows.map(row => row.documentNumber),
  "El XLSX SENAE no usa electronic_documents.full_number como número de factura."
);
assert.ok(senaeMainSheet.rows.every(row => !/undefined|\[object Object\]/.test(row[invoiceNumberColumn].value)), "El número de factura SENAE contiene texto inválido.");
assert.equal(JSON.stringify(result.report.totals), JSON.stringify({ subtotal: 300, taxTotal: 45, total: 345, boxes: 3, bunches: 30, stems: 0, fulls: 0 }), "Agregar el número de factura alteró los totales SENAE.");

// Canonical company header selects only its own authorized invoices, never legacy order numbers.
for (const company of [COMPANY_ID, OTHER_COMPANY_ID]) {
 reportCompanyId=company;
 const own=canonicalDocument(80,'EXPORTADOR',{company_id:company,full_number:'001-002-900000080'});
 const foreign=canonicalDocument(81,'EXPORTADOR',{company_id:company===COMPANY_ID?OTHER_COMPANY_ID:COMPANY_ID,full_number:'001-002-900000081'});
 const out=BlessERP.reportFinancialXlsx.senaeSheets([own,foreign],{dateFrom:'2026-08-01',dateTo:'2026-08-31',commerceType:'EXPORTADOR'});
 assert.equal(out.report.rows.length,1);assert.equal(out.report.rows[0].documentNumber,own.full_number);
 assert.equal(out.sheets[0].rows[0][out.sheets[0].headers.indexOf('Factura')].value,own.full_number);
}
reportCompanyId=COMPANY_ID;
const localOnly = BlessERP.reportFinancialXlsx.senaeSheets(documents, { dateFrom: "2026-08-20", dateTo: "2026-08-21", commerceType: "LOCAL" });
assert.equal(localOnly.report.rows.length, 1);
assert.equal(localOnly.report.rows[0].saleType, "LOCAL");

const rpcCalls = [];
const canonicalUniverse = Array.from({ length: 405 }, (_, index) => canonicalDocument(index + 100, index % 2 ? "LOCAL" : "EXPORTADOR"));
const repositoryBlessERP = {
  authAccess: { activeAccess: () => ({ activeCompany: { id: COMPANY_ID } }) },
  getSupabaseClient: () => ({
    rpc: async (name, parameters) => {
      rpcCalls.push({ name, parameters });
      const commerceType = String(parameters.p_commerce_type ?? "").trim().toUpperCase();
      if (!["TODOS", "LOCAL", "EXPORTADOR"].includes(commerceType)) {
        return { data: null, error: { code: "22023", message: "SENAE_LIQUIDATION_COMMERCE_TYPE_INVALID" } };
      }
      let filtered = canonicalUniverse.filter(document => document.company_id === parameters.p_company_id);
      if (commerceType !== "TODOS") filtered = filtered.filter(document => document.source_snapshot.invoice.commerceType === commerceType);
      const start = (parameters.p_page - 1) * parameters.p_page_size;
      const items = filtered.slice(start, start + parameters.p_page_size);
      return { data: { ok: true, items, total: filtered.length, page: parameters.p_page, pageSize: parameters.p_page_size, totalPages: Math.max(1, Math.ceil(filtered.length / parameters.p_page_size)), summary: { totalDocuments: filtered.length } }, error: null };
    }
  })
};
const repositoryContext = vm.createContext({ window: { BlessERP: repositoryBlessERP }, console, Date, Set, Map });
repositoryContext.globalThis = repositoryContext;
await evaluate("scripts/repositories/comercial/senae-liquidation-v2-repository.js", repositoryContext);
const repository = repositoryBlessERP.getSenaeLiquidationV2Repository();
const page = await repository.queryPage({ dateFrom: "2026-08-15", dateTo: "2026-08-21", commerceType: "LOCAL", page: 2, pageSize: 25 });
assert.equal(page.items.length, 25);
assert.equal(rpcCalls[0].parameters.p_company_id, COMPANY_ID);
assert.equal(rpcCalls[0].parameters.p_commerce_type, "LOCAL");
assert.equal(rpcCalls[0].parameters.p_date_from, "2026-08-15");
assert.equal(rpcCalls[0].parameters.p_date_to, "2026-08-21");
const exported = await repository.exportAll({ dateFrom: "2026-08-01", dateTo: "2026-08-31", commerceType: "TODOS" });
assert.equal(exported.documents.length, 405);
assert.ok(rpcCalls.slice(1).every(call => call.parameters.p_commerce_type === "TODOS"), "El filtro TODOS volvió a degradarse a null antes del RPC.");
assert.deepEqual(rpcCalls.slice(1).map(call => call.parameters.p_page), [1, 2, 3]);

let initialQueries = 0;
const uiBlessERP = {
  comercialUtils: { esc: value => String(value ?? ""), money: value => `$${Number(value || 0).toFixed(2)}` },
  comercialState: {}, comercialSriOrderQueueCore: {},
  services: { companyContext: { activeCompanyId: () => "COMP-BLESS-FLOWER" } },
  sriApi: {
    activeCompanyKey: () => "BLESS_FLOWER", activeCompany: () => ({ commercialName: "BLESS FLOWER" }),
    companyKeyForReference: () => "BLESS_FLOWER", selectCompany: () => {}
  },
  getSenaeLiquidationV2Repository: () => ({ queryPage: async () => { initialQueries += 1; } })
};
const uiContext = vm.createContext({ window: { BlessERP: uiBlessERP }, console, Date, Intl, Map, Set, AbortController, setTimeout, clearTimeout });
uiContext.globalThis = uiContext;
await evaluate("scripts/modules/comercial/sri-authorization.js", uiContext);
const initialHtml = uiBlessERP.comercialSriAuthorization.renderSenae({ db: { activeCompanyId: "COMP-BLESS-FLOWER" } });
assert.equal(initialQueries, 0, "Abrir/renderizar Liquidación SENAE ejecutó una consulta histórica.");
assert.match(initialHtml, /Consultar/);
assert.match(initialHtml, /Consulta bajo demanda/);

console.log("OK: Liquidación SENAE V2 search-first, company-scoped, paginada y con número canónico de factura.");
