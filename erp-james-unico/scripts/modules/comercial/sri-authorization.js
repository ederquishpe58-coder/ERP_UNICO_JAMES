(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const stateApi = BlessERP.comercialState;
  const queueCore = BlessERP.comercialSriOrderQueueCore;

  const ui = {
    companyKey: BlessERP.sriApi?.activeCompanyKey?.() || "BLESS_FLOWER",
    search: "",
    status: "TODOS",
    documentType: "TODOS",
    salesScope: "TODOS",
    transportScope: "TODOS",
    daeScope: "TODOS",
    dateFrom: "",
    dateTo: "",
    sortMode: "DATE_DESC",
    issueYear: String(new Date().getFullYear()),
    issueMonth: "",
    remoteDocuments: [],
    configuration: null,
    loading: false,
    loaded: false,
    error: "",
    selectedIds: new Set(),
    processing: false,
    batchMessage: "",
    batchTone: "info",
    emissionPointIdByCompany: {},
    senaeDateFrom: "",
    senaeDateTo: "",
    senaeCommerceType: "TODOS",
    senaePageSize: 25,
    senaeResult: null,
    senaeAppliedFilters: null,
    senaeFiltersDirty: false,
    senaeLoading: false,
    senaeSummary: null,
    creditSearch: "",
    creditStatus: "TODOS",
    creditNoteDraft: null,
    annulmentDraft: null,
    diagnostic: null,
    processErrors: new Map()
  };
  let searchTimer = null;
  let creditSearchTimer = null;
  let senaeBindController = null;
  let senaeRealtimeStarted = false;
  let senaeRealtimeTimer = null;

  function workspaceCompanyKey(appState) {
    const companyId = BlessERP.services?.companyContext?.activeCompanyId?.()
      || appState?.db?.activeCompanyId
      || "COMP-BLESS-FLOWER";
    return BlessERP.sriApi?.companyKeyForReference?.(companyId, "BLESS_FLOWER")
      || (String(companyId).includes("IMPERIO") ? "IMPERIO_FLOWERS" : "BLESS_FLOWER");
  }

  function syncWorkspaceCompany(appState) {
    const companyKey = workspaceCompanyKey(appState);
    if (ui.companyKey === companyKey && BlessERP.sriApi?.activeCompanyKey?.() === companyKey) return companyKey;
    ui.companyKey = companyKey;
    BlessERP.sriApi?.selectCompany?.(companyKey);
    if (senaeRealtimeStarted) {
      BlessERP.getSenaeLiquidationV2Repository?.()?.unsubscribe?.();
      senaeRealtimeStarted = false;
    }
    ui.remoteDocuments = [];
    ui.configuration = null;
    ui.selectedIds.clear();
    ui.issueMonth = "";
    ui.loaded = false;
    ui.error = "";
    ui.batchMessage = "";
    ui.senaeResult = null;
    ui.senaeAppliedFilters = null;
    ui.senaeFiltersDirty = false;
    ui.senaeLoading = false;
    ui.senaeSummary = null;
    ui.creditNoteDraft = null;
    ui.annulmentDraft = null;
    ui.diagnostic = null;
    ui.processErrors.clear();
    return companyKey;
  }

  function ecuadorToday(now = new Date()) {
    return BlessERP.sriFiscalDate.ecuadorDate(now);
  }

  const ISSUE_MONTHS = Object.freeze([
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ]);

  function selectedIssueMonthRange() {
    const year = Number(ui.issueYear || 0);
    const month = Number(ui.issueMonth || 0);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      year,
      month,
      from,
      to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      label: `${ISSUE_MONTHS[month - 1]} ${year}`
    };
  }

  function resetDocumentsEntry() {
    resetDocumentListFilters();
    ui.issueMonth = "";
    ui.remoteDocuments = [];
    ui.configuration = null;
    ui.selectedIds.clear();
    ui.loading = false;
    ui.loaded = false;
    ui.error = "";
    ui.batchMessage = "";
    ui.senaeResult = null;
    ui.senaeAppliedFilters = null;
    ui.senaeFiltersDirty = false;
    ui.senaeLoading = false;
    ui.senaeSummary = null;
    ui.diagnostic = null;
    ui.processErrors.clear();
  }

  function resetDocumentListFilters() {
    ui.search = "";
    ui.status = "TODOS";
    ui.documentType = "TODOS";
    ui.salesScope = "TODOS";
    ui.transportScope = "TODOS";
    ui.daeScope = "TODOS";
    ui.dateFrom = "";
    ui.dateTo = "";
    ui.sortMode = "DATE_DESC";
    return currentDocumentListFilters();
  }

  function currentDocumentListFilters() {
    return {
      search: ui.search,
      status: ui.status,
      documentType: ui.documentType,
      salesScope: ui.salesScope,
      transportScope: ui.transportScope,
      daeScope: ui.daeScope,
      dateFrom: ui.dateFrom,
      dateTo: ui.dateTo,
      sortMode: ui.sortMode
    };
  }

  async function listCommercialSriDocuments(filters = {}) {
    const pageSize = 200;
    const documentTypes = ["01", "04"];
    const batches = await Promise.all(documentTypes.map(async documentType => {
      const documents = [];
      let offset = 0;
      while (true) {
        const page = await BlessERP.sriApi.list({
          ...filters,
          documentType,
          limit: pageSize,
          offset
        });
        const rows = Array.isArray(page) ? page : [];
        documents.push(...rows);
        if (rows.length < pageSize) break;
        offset += rows.length;
      }
      return documents;
    }));
    const byId = new Map();
    batches.flat().forEach(document => {
      if (document?.id) byId.set(String(document.id), document);
    });
    return [...byId.values()].sort((left, right) => (
      String(right.created_at || right.issue_date || "").localeCompare(String(left.created_at || left.issue_date || ""))
    ));
  }

  function renderIssueMonthSelector() {
    const selected = selectedIssueMonthRange();
    return `
      <section class="panel-card sri-month-filter" aria-label="Filtro mensual por fecha de emisión">
        <div class="panel-card-head">
          <div><p class="section-kicker">FECHA DE EMISIÓN</p><h2>Seleccione el mes a consultar</h2><p>La bandeja permanece sin datos y sin consultas hasta elegir un mes.</p></div>
          <label class="compact-field sri-month-year"><span>Año</span><input type="number" min="2000" max="2100" step="1" value="${utils.esc(ui.issueYear)}" data-sri-issue-year></label>
        </div>
        <div class="sri-month-grid">
          ${ISSUE_MONTHS.map((label, index) => {
            const month = index + 1;
            return `<button class="${selected?.month === month ? "primary-button" : "secondary-button"}" type="button" data-sri-issue-month="${month}" aria-pressed="${selected?.month === month ? "true" : "false"}">${month}. ${utils.esc(label)}</button>`;
          }).join("")}
        </div>
        ${selected ? `<p class="table-footer-note">Mostrando documentos con fecha de emisión entre ${utils.esc(utils.dateLabel(selected.from))} y ${utils.esc(utils.dateLabel(selected.to))}.</p>` : ""}
      </section>
    `;
  }

  function issueDateFromAccessKey(accessKey) {
    const digits = String(accessKey || "").replace(/\D+/g, "");
    if (digits.length !== 49) return "";
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }

  function sourceOrderIssueDate(order = {}) {
    return String(order.sriOriginalIssueDate || order.issuedAt || order.createdAt || order.date || "").slice(0, 10);
  }

  function effectiveSriIssueDate(order = {}, brand = null, today = ecuadorToday()) {
    return queueCore.isLocalSale(order, brand)
      ? String(today || ecuadorToday()).slice(0, 10)
      : sourceOrderIssueDate(order);
  }

  function orderForSriEmission(order = {}, brand = null, today = ecuadorToday()) {
    const issueDate = effectiveSriIssueDate(order, brand, today);
    if (!queueCore.isLocalSale(order, brand)) return order;
    return {
      ...order,
      issuedAt: issueDate,
      sriIssueDate: issueDate
    };
  }

  function dateTimeLabel(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function compactList(values) {
    return [...new Set(values.flatMap(value => String(value || "").split(/[,;|/]+/)).map(value => value.trim()).filter(Boolean))].join(" / ");
  }

  function invoiceLastNine(documentNumber, accessKey = "") {
    const numberDigits = String(documentNumber || "").replace(/\D+/g, "");
    if (numberDigits.length >= 9) return numberDigits.slice(-9);
    const keyDigits = String(accessKey || "").replace(/\D+/g, "");
    return keyDigits.length === 49 ? keyDigits.slice(30, 39) : "Pendiente";
  }

  function guideValues({ motherGuide = "", childGuide = "", combined = "" } = {}) {
    const combinedParts = compactList([combined]).split(" / ").filter(Boolean);
    return {
      motherGuide: String(motherGuide || combinedParts[0] || "").trim(),
      childGuide: String(childGuide || combinedParts[1] || "").trim()
    };
  }

  function matchesSalesScope(row, scope = ui.salesScope) {
    if (scope === "NOTAS_CREDITO") return row.documentType === "04";
    if (scope === "LOCALES") return row.documentType === "01" && !row.isExport;
    if (scope === "EXPORTACIONES") return row.documentType === "01" && row.isExport;
    return true;
  }

  function catalogIndexes(appState) {
    return {
      customers: new Map((stateApi.getCustomerCatalog?.(appState) || []).map(item => [String(item.id || ""), item])),
      brands: new Map((stateApi.getBrandCatalog?.(appState) || []).map(item => [String(item.id || ""), item]))
    };
  }

  function localRows(appState) {
    const api = BlessERP.sriApi;
    const indexes = catalogIndexes(appState);
    return stateApi.getOrders(appState)
      // Un borrador de digitación todavía no es una factura ni un documento
      // tributario. Si una pestaña quedó abierta durante un error de red, nunca
      // debe aparecer como "Pendiente / Sin cliente / $0" en esta bandeja.
      .filter(order => order?.unsavedDraft !== true && order?.numberPending !== true && String(order?.number || "").trim())
      .filter(order => (api?.orderCompanyKey?.(order) || "BLESS_FLOWER") === ui.companyKey)
      .filter(order => (
        String(order.status || "").toUpperCase() !== "ANULADO"
        || Boolean(stateApi.hasSriElectronicArtifact?.(order))
      ))
      .map(order => {
      const customer = indexes.customers.get(String(order.customerId || ""));
      const brand = indexes.brands.get(String(order.brandId || ""));
      const metrics = utils.getOrderMetrics(order);
      const orderIsAnnulled = String(order.status || "").toUpperCase() === "ANULADO";
      const canonicalRemoteDocument = linkedRemoteDocument(order);
      const authorizationStatus = canonicalRemoteDocument
        ? String(canonicalRemoteDocument.status || "PENDIENTE").toUpperCase()
        : orderIsAnnulled
          ? "ANULADO"
          : String(order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
      const isExport = queueCore.isExportOrder(order, brand);
      const storedIssueDate = order.sriIssueDate || issueDateFromAccessKey(order.sriAccessKey) || String(order.issuedAt || "").slice(0, 10);
      const issueDate = !isExport && !order.sriRemoteDocumentId && !order.sriAccessKey
        ? effectiveSriIssueDate(order, brand)
        : storedIssueDate;
      const processable = !orderIsAnnulled && queueCore.isSelectableStatus(authorizationStatus);
      const guides = guideValues({ motherGuide: order.awb, childGuide: order.hawb, combined: order.sriGuides });
      return {
        id: `order:${order.id}`,
        companyKey: ui.companyKey,
        sourceType: "local",
        documentType: "01",
        documentLabel: "FACTURA",
        orderId: order.id,
        orderNumber: order.number || "",
        remoteDocumentId: order.sriRemoteDocumentId || "",
        customer: customer?.legalName || customer?.commercialName || "Sin cliente",
        brand: brand?.name || "-",
        transportType: isExport ? queueCore.transportType(order) : "LOCAL",
        isExport,
        dae: queueCore.sriDae(order, brand),
        issueDate,
        flightDate: String(order.flightDate || "").slice(0, 10),
        orderDate: sourceOrderIssueDate(order) || String(order.createdAt || order.date || order.flightDate || "").slice(0, 10),
        authorizationStatus,
        authorizationNumber: order.sriAuthorizationNumber || "",
        authorizedAt: order.sriAuthorizedAt || "",
        total: Number(metrics.totalUsd || 0),
        guides: compactList([order.sriGuides, order.awb, order.hawb]),
        motherGuide: guides.motherGuide,
        childGuide: guides.childGuide,
        accessKey: order.sriAccessKey || "",
        documentNumber: order.sriInvoiceNumber || order.number || "",
        processable,
        selectable: processable || authorizationStatus === "AUTORIZADO",
        editableLogistics: !orderIsAnnulled && !order.sriRemoteDocumentId && authorizationStatus === "PENDIENTE"
      };
      });
  }

  function intercompanyRows(appState) {
    if (!BlessERP.comercialIntercompany?.billingEnabled || ui.companyKey !== "BLESS_FLOWER") return [];
    return (BlessERP.comercialIntercompany?.getInvoices?.(appState) || [])
      .filter(invoice => String(invoice.status || "").toUpperCase() !== "ANULADA_INTERNA")
      .map(invoice => ({
        id: `intercompany:${invoice.id}`,
        companyKey: "BLESS_FLOWER",
        sourceType: "intercompany",
        documentType: "01",
        documentLabel: "FACTURA",
        intercompanyInvoiceId: invoice.id,
        orderId: "",
        orderNumber: invoice.settlementNumber || invoice.number || "",
        remoteDocumentId: invoice.sriDocumentId || "",
        customer: invoice.buyerCompanyName || "Imperio Flowers",
        brand: "Liquidación semanal",
        transportType: "LOCAL",
        isExport: false,
        dae: "",
        issueDate: invoice.issueDate || "",
        flightDate: "",
        orderDate: invoice.dateTo || invoice.issueDate || "",
        authorizationStatus: String(invoice.sriStatus || "PENDIENTE_CONFIGURACION").toUpperCase(),
        authorizationNumber: invoice.sriAuthorizationNumber || "",
        authorizedAt: invoice.sriAuthorizedAt || "",
        total: Number(invoice.totals?.transferTotal || 0),
        guides: "",
        motherGuide: "",
        childGuide: "",
        accessKey: invoice.sriAccessKey || "",
        documentNumber: invoice.sriFullNumber || invoice.number || "",
        processable: false,
        selectable: false,
        editableLogistics: false,
        canCreateSriDraft: Boolean(invoice.sriDraftReady && !invoice.sriDocumentId),
        configurationErrors: invoice.sriDraftErrors || []
      }));
  }

  function remoteRows(appState) {
    const orders = stateApi.getOrders(appState);
    const indexes = catalogIndexes(appState);
    const orderByRemoteDocumentId = new Map();
    const orderById = new Map();
    const orderByNumber = new Map();
    orders.forEach(order => {
      if (order.sriRemoteDocumentId) orderByRemoteDocumentId.set(String(order.sriRemoteDocumentId), order);
      if (order.id) orderById.set(String(order.id), order);
      if (order.number) orderByNumber.set(String(order.number), order);
    });
    return ui.remoteDocuments
      .filter(document => ["01", "04"].includes(String(document.document_type || "")))
      .map(document => {
      const source = document.source_snapshot || {};
      const buyer = document.buyer_snapshot || {};
      const additional = document.additional_information || source.additionalInformation || {};
      const documentType = String(document.document_type || "01");
      const sourceOrderNumber = queueCore.sourceOrderNumber(document);
      const explicitOrderId = source.originalOrderId || source.erpEmission?.sourceOrderId || "";
      const linkedOrder = orderByRemoteDocumentId.get(String(document.id || ""))
        || orderById.get(String(document.source_order_id || ""))
        || orderById.get(String(explicitOrderId || ""))
        || (sourceOrderNumber ? orderByNumber.get(String(sourceOrderNumber)) : null);
      const principalCustomer = linkedOrder
        ? indexes.customers.get(String(linkedOrder.customerId || ""))
        : null;
      const authorizationStatus = String(document.status || "BORRADOR").toUpperCase();
      const transport = String(source.erpEmission?.transportType || source.transportType || additional.Transporte || linkedOrder?.transportType || "AEREO").toUpperCase();
      const isExport = transport !== "LOCAL" && (linkedOrder
        ? queueCore.isExportOrder(linkedOrder, indexes.brands.get(String(linkedOrder.brandId || "")))
        : Boolean(additional.DAE || additional.DAES || source.sriDaeNumber || source.daeNumber || transport !== "TERRESTRE"));
      const processable = queueCore.isSelectableStatus(authorizationStatus);
      const guides = guideValues({
        motherGuide: linkedOrder?.awb || source.awb || additional["Guia madre"] || additional["Guía madre"] || additional.GUIA_MADRE,
        childGuide: linkedOrder?.hawb || source.hawb || additional["Guia hija"] || additional["Guía hija"] || additional.GUIA_HIJA,
        combined: additional.Guias || additional.GUIAS
      });
      return {
        id: `sri:${document.id}`,
        companyKey: ui.companyKey,
        sourceType: "remote",
        documentType,
        documentLabel: sriDocumentLabel(documentType),
        remoteDocumentId: document.id,
        parentDocumentId: document.parent_document_id || "",
        orderId: linkedOrder?.id || "",
        orderNumber: sourceOrderNumber || linkedOrder?.number || "",
        customer: principalCustomer?.legalName
          || principalCustomer?.commercialName
          || buyer.legalName
          || buyer.razonSocial
          || buyer.name
          || "Sin cliente",
        brand: additional["Marca cliente"] || additional.Marca || source.brand?.name || source.brandName || "-",
        transportType: isExport ? transport : "LOCAL",
        isExport,
        dae: isExport ? (additional.DAE || additional.DAES || source.sriDaeNumber || (transport === "AEREO" ? source.daeNumber : "") || "") : "",
        issueDate: document.issue_date || "",
        flightDate: String(linkedOrder?.flightDate || source.flightDate || source.erpEmission?.flightDate || additional["Fecha vuelo"] || additional["Fecha de vuelo"] || "").slice(0, 10),
        orderDate: source.erpEmission?.sourceOrderDate || source.orderDate || "",
        authorizationStatus,
        authorizationNumber: document.authorization_number || "",
        authorizedAt: document.authorized_at || "",
        total: Number(document.grand_total || 0),
        creditedTotal: Number(document.credited_total || 0),
        creditReason: source.creditNote?.reason || additional.Motivo || "",
        originalDocumentNumber: source.creditNote?.modifiedDocumentNumber || source.originalInvoice?.fullNumber || "",
        guides: compactList([guides.motherGuide, guides.childGuide]),
        motherGuide: guides.motherGuide,
        childGuide: guides.childGuide,
        accessKey: document.access_key || "",
        documentNumber: document.full_number || "",
        processable,
        selectable: processable || authorizationStatus === "AUTORIZADO",
        editableLogistics: false
      };
    });
  }

  function allRows(appState) {
    const remote = remoteRows(appState);
    const remoteOrderIds = new Set(remote.map(item => String(item.orderId || "")).filter(Boolean));
    const remoteOrderNumbers = new Set(remote.map(item => String(item.orderNumber || "")).filter(Boolean));
    const remoteDocumentIds = new Set(remote.map(item => String(item.remoteDocumentId || "")).filter(Boolean));
    const local = [...localRows(appState), ...intercompanyRows(appState)];
    return [...remote, ...local.filter(item => (
      !remoteOrderIds.has(String(item.orderId || ""))
      && !remoteOrderNumbers.has(String(item.orderNumber || ""))
      && !remoteDocumentIds.has(String(item.remoteDocumentId || ""))
    ))];
  }

  function normalizedTransport(value) {
    return String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function hasDae(row) {
    return Boolean(String(row?.dae || "").trim());
  }

  function isMaritimeExportWithoutDae(row) {
    return Boolean(row?.isExport)
      && normalizedTransport(row?.transportType) === "MARITIMO"
      && !hasDae(row);
  }

  function rowIssueDate(row) {
    return String(row?.issueDate || "").slice(0, 10);
  }

  function rowSortDate(row) {
    return rowIssueDate(row) || String(row?.orderDate || "").slice(0, 10);
  }

  function stableRowIdentity(row) {
    return [row?.id, row?.documentNumber, row?.orderNumber].map(value => String(value || "")).join("|");
  }

  function compareRecent(left, right) {
    return rowSortDate(right).localeCompare(rowSortDate(left))
      || stableRowIdentity(left).localeCompare(stableRowIdentity(right));
  }

  function compareDocumentRows(left, right, sortMode = "DATE_DESC") {
    if (sortMode === "DATE_ASC") {
      return rowSortDate(left).localeCompare(rowSortDate(right))
        || stableRowIdentity(left).localeCompare(stableRowIdentity(right));
    }
    if (sortMode === "DAE_MISSING_FIRST") {
      const priorityDifference = Number(isMaritimeExportWithoutDae(right)) - Number(isMaritimeExportWithoutDae(left));
      return priorityDifference || compareRecent(left, right);
    }
    if (sortMode === "VALUE_DESC") {
      return Number(right?.total || 0) - Number(left?.total || 0) || compareRecent(left, right);
    }
    if (sortMode === "VALUE_ASC") {
      return Number(left?.total || 0) - Number(right?.total || 0) || compareRecent(left, right);
    }
    return compareRecent(left, right);
  }

  function filterAndSortDocumentRows(all, filters, issueRange) {
    const term = String(filters.search || "").trim().toLowerCase();
    return all.filter(row => {
      if (!issueRange) return false;
      const issueDate = rowIssueDate(row);
      if (!issueDate || issueDate < issueRange.from || issueDate > issueRange.to) return false;
      if (filters.dateFrom && issueDate < filters.dateFrom) return false;
      if (filters.dateTo && issueDate > filters.dateTo) return false;
      if (filters.status !== "TODOS" && row.authorizationStatus !== filters.status) return false;
      if (filters.documentType !== "TODOS" && row.documentType !== filters.documentType) return false;
      if (!matchesSalesScope(row, filters.salesScope)) return false;
      if (filters.transportScope !== "TODOS" && normalizedTransport(row.transportType) !== filters.transportScope) return false;
      if (filters.daeScope === "CON_DAE" && !hasDae(row)) return false;
      if (filters.daeScope === "SIN_DAE" && hasDae(row)) return false;
      return !term || [row.customer, row.brand, row.dae, row.motherGuide, row.childGuide, row.guides, row.accessKey, row.documentNumber, row.orderNumber, row.authorizationStatus]
        .join(" ").toLowerCase().includes(term);
    }).sort((left, right) => compareDocumentRows(left, right, filters.sortMode));
  }

  function rows(appState, sourceRows = null) {
    const all = sourceRows || allRows(appState);
    const issueRange = selectedIssueMonthRange();
    return filterAndSortDocumentRows(all, currentDocumentListFilters(), issueRange);
  }

  function badgeClass(status) {
    if (status === "AUTORIZADO") return "authorized";
    if (status === "ANULADO") return "annulled";
    if (["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(status)) return "cancelled";
    if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "XML_GENERADO", "VALIDADO", "BORRADOR_LOCAL", "PENDIENTE_CONFIGURACION"].includes(status)) return "partial";
    return "pending";
  }

  function documentNumberStatusClass(status) {
    const normalized = String(status || "PENDIENTE").toUpperCase();
    if (normalized === "AUTORIZADO") return "is-authorized";
    if (normalized === "ANULADO") return "is-annulled";
    if (["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(normalized)) return "is-error";
    return "is-pending";
  }

  function sriDocumentLabel(documentType) {
    const normalized = String(documentType || "").padStart(2, "0");
    if (normalized === "01") return "FACTURA";
    if (normalized === "04") return "NOTA DE CREDITO";
    if (normalized === "06") return "GUIA DE REMISION";
    if (normalized === "07") return "COMPROBANTE DE RETENCION";
    return "COMPROBANTE SRI";
  }

  function renderArtifactActions(row, appState) {
    if (row.authorizationStatus !== "AUTORIZADO") return "<small>Disponible al autorizar.</small>";
    if (row.sourceType !== "remote" && row.orderId) {
      const order = localOrder(appState, row.orderId);
      const hasAuthorizedXml = Boolean(String(order?.sriAuthorizedXml || "").trim());
      return `
        <div class="table-actions-inline sri-file-actions">
          <button class="secondary-button" type="button"
            data-sri-local-xml="${utils.esc(row.orderId)}"
            ${hasAuthorizedXml ? "" : "disabled"}
            title="${hasAuthorizedXml ? "Descargar XML autorizado almacenado" : "El XML autorizado real todavía no está almacenado localmente"}">XML autorizado</button>
          <button class="secondary-button" type="button"
            data-sri-local-pdf="${utils.esc(row.orderId)}">PDF RIDE</button>
        </div>
        ${hasAuthorizedXml ? "" : "<small>PDF disponible; falta sincronizar el XML autorizado real.</small>"}
      `;
    }
    if (row.sourceType !== "remote") return "<small>Documento autorizado sin pedido local relacionado.</small>";
    return `
      <div class="table-actions-inline sri-file-actions">
        <button class="secondary-button" type="button"
          data-sri-download-artifact="${utils.esc(row.remoteDocumentId)}"
          data-sri-artifact-type="AUTHORIZED_XML">XML autorizado</button>
        <button class="secondary-button" type="button"
          data-sri-download-artifact="${utils.esc(row.remoteDocumentId)}"
          data-sri-artifact-type="RIDE_PDF">PDF RIDE</button>
        ${row.documentType === "01" ? `<button class="row-action-button" type="button"
          data-sri-create-credit-note="${utils.esc(row.remoteDocumentId)}">Nota de credito</button>` : ""}
      </div>
    `;
  }

  function renderDocumentInlineActions(row) {
    const actions = [];
    if (row.canCreateSriDraft) {
      actions.push(`<button class="row-action-button" type="button" data-sri-create-intercompany-draft="${utils.esc(row.intercompanyInvoiceId)}" ${ui.processing ? "disabled" : ""}>Crear borrador SRI</button>`);
    } else if (row.configurationErrors?.length) {
      actions.push(`<small>${utils.esc(row.configurationErrors[0])}</small>`);
    }
    if (row.authorizationStatus === "AUTORIZADO" && row.sourceType === "remote" && row.documentType === "01") {
      actions.push(`<button class="row-action-button" type="button" data-sri-create-credit-note="${utils.esc(row.remoteDocumentId)}">Nota de crédito</button>`);
      actions.push(`<button class="secondary-button" type="button" data-sri-register-annulment="${utils.esc(row.remoteDocumentId)}">Registrar anulación realizada en SRI</button>`);
    }
    if (queueCore.isDiagnosticStatus?.(row.authorizationStatus)) {
      actions.push(`<button class="secondary-button" type="button" data-sri-diagnostic="${utils.esc(row.id)}">Ver error SRI</button>`);
    }
    return actions.length ? `
      <details class="sri-row-actions-menu">
        <summary>Acciones &#9662;</summary>
        <div class="sri-row-actions-popover">${actions.join("")}</div>
      </details>
    ` : `<span class="sri-no-row-actions">-</span>`;
  }

  function renderAnnulmentModal() {
    const draft = ui.annulmentDraft;
    if (!draft) return "";
    return `
      <div class="erp-modal-backdrop sri-annulment-backdrop" role="presentation">
        <section class="erp-modal-card sri-annulment-modal" role="dialog" aria-modal="true" aria-labelledby="sri-annulment-title">
          <header class="erp-modal-header">
            <div>
              <p class="section-kicker">REGISTRO CONTROLADO</p>
              <h2 id="sri-annulment-title">Registrar anulación realizada en SRI</h2>
              <p>Esta acción no anula el comprobante en el portal SRI. Registra una anulación que ya fue realizada y verificada por el usuario.</p>
            </div>
            <button class="secondary-button" type="button" data-sri-annulment-close>Cerrar</button>
          </header>
          <div class="sri-credit-note-summary">
            <div><span>Factura</span><strong>${utils.esc(draft.fullNumber || "-")}</strong></div>
            <div><span>Estado anterior</span><strong><span class="status-badge authorized">AUTORIZADO</span></strong></div>
            <div><span>Clave de acceso</span><strong>${utils.esc(draft.accessKey || "-")}</strong></div>
            <div><span>Estado nuevo</span><strong><span class="status-badge annulled">ANULADO</span></strong></div>
          </div>
          <div class="sri-annulment-form">
            <label class="compact-field"><span>Fecha de anulación en SRI</span><input type="date" max="${utils.esc(ecuadorToday())}" value="${utils.esc(draft.annulmentDate || "")}" data-sri-annulment-date></label>
            <label class="compact-field"><span>Motivo</span><textarea rows="3" maxlength="500" data-sri-annulment-reason placeholder="Motivo registrado por el usuario">${utils.esc(draft.reason || "")}</textarea></label>
            <label class="compact-field"><span>Referencia / evidencia (opcional)</span><input type="text" maxlength="500" value="${utils.esc(draft.evidenceReference || "")}" data-sri-annulment-evidence placeholder="Número de trámite, observación o referencia"></label>
          </div>
          <div class="inline-message warning"><strong>Importante:</strong> XML, autorización, respuestas, intentos, clave y secuencial permanecerán intactos.</div>
          <footer class="erp-modal-actions">
            <button class="secondary-button" type="button" data-sri-annulment-close>Cancelar</button>
            <button class="primary-button" type="button" data-sri-annulment-save ${ui.processing ? "disabled" : ""}>${ui.processing ? "Registrando..." : "Confirmar registro de anulación"}</button>
          </footer>
        </section>
      </div>`;
  }

  function renderLogisticsField(row, field, value) {
    if (!row.isExport) return '<span class="status-badge authorized">NO APLICA</span>';
    if (!row.editableLogistics) return utils.esc(value || "-");
    const labels = {
      sriDaeNumber: "DAE",
      awb: "Guía madre",
      hawb: "Guía hija",
      sriGuides: "Guías"
    };
    const label = labels[field] || "Dato logístico";
    return `<label class="sri-inline-logistics-field">
      <span class="sr-only">${utils.esc(label)} de ${utils.esc(row.orderNumber || row.customer)}</span>
      <input type="text" value="${utils.esc(value || "")}" placeholder="${utils.esc(label)}" data-sri-logistics-field="${field}" data-sri-order-id="${utils.esc(row.orderId)}">
    </label>`;
  }

  function technicalReadiness() {
    return ui.configuration?.readiness || {
      readyForXml: false,
      readyForSignature: false,
      blockers: ["Falta cargar la configuracion canonica SRI."],
      signatureBlockers: ["Falta integrar un certificado P12/PFX activo."],
      warnings: [],
        baseline: { technicalSpecVersion: "2.34", technicalSpecDate: "2026-07-27", invoiceXmlVersion: "1.1.0", withholdingXmlVersion: "2.0.0" }
    };
  }

  function selectedEnvironmentLabel() {
    try { return BlessERP.sriApi.environmentDefinition(ui.configuration?.settings?.environment).label; }
    catch { return "SIN CONFIGURAR"; }
  }

  function currentEnvironmentPoints() {
    const settings = ui.configuration?.settings;
    const company = BlessERP.sriApi?.activeCompany?.();
    if (!settings || company?.key !== ui.companyKey || !company.companyId || settings.company_id !== company.companyId
      || !["TEST", "PRODUCTION"].includes(settings.environment)) return [];
    return (ui.configuration?.emissionPoints || []).filter(point => point.active === true
      && point.company_id === company.companyId && point.environment === settings.environment);
  }

  function renderReadiness() {
    const readiness = technicalReadiness();
    const baseline = readiness.baseline || {};
    const messages = [...(readiness.blockers || []), ...(readiness.signatureBlockers || []), ...(readiness.warnings || [])];
    return `
      <section class="sri-readiness-panel" aria-label="Validacion tecnica SRI">
        <div class="sri-readiness-head">
          <div><p class="section-kicker">VALIDACION TECNICA</p><h2>Preparacion para firma electronica</h2></div>
          <div class="table-actions-inline"><span class="status-badge ${readiness.readyForXml ? "authorized" : "cancelled"}">${readiness.readyForXml ? "XML / XSD listo" : "Configuracion incompleta"}</span><span class="status-badge ${readiness.readyForSignature ? "authorized" : "pending"}">${readiness.readyForSignature ? "Firma P12 lista" : "P12 pendiente"}</span></div>
        </div>
        <div class="sri-parameter-grid">
            <div><span>Ficha tecnica</span><strong>${utils.esc(baseline.technicalSpecVersion || "2.34")}</strong><small>${utils.esc(baseline.technicalSpecDate || "2026-07-27")}</small></div>
          <div><span>Ambiente</span><strong>${utils.esc(selectedEnvironmentLabel())}</strong><small>Configuracion canonica por empresa</small></div>
          <div><span>Factura exportacion</span><strong>XML ${utils.esc(baseline.invoiceXmlVersion || "1.1.0")}</strong><small>XSD oficial versionado</small></div>
          <div><span>Firma</span><strong>XAdES-BES 1.3.2</strong><small>Enveloped, UTF-8, RSA-SHA1</small></div>
          <div><span>Certificado</span><strong>PKCS12</strong><small>P12/PFX solo en backend privado</small></div>
        </div>
        ${messages.length ? `<p class="sri-readiness-message">${utils.esc(messages.join(" "))}</p>` : ""}
      </section>
    `;
  }

  function renderCompanyContext() {
    const api = BlessERP.sriApi;
    const profiles = api?.companyProfiles?.() || [];
    const company = api?.activeCompany?.() || profiles.find(profile => profile.key === ui.companyKey) || {};
    const validation = ui.configuration
      ? api?.validateCompanyConfiguration?.(ui.configuration, ui.companyKey)
      : null;
    const point = activeEmissionPoint() || validation?.activePoint;
    const points = currentEnvironmentPoints();
    const signer = validation?.signer || null;
    return `
      <section class="panel-card sri-readiness-panel" aria-label="Empresa emisora SRI">
        <div class="sri-readiness-head">
          <div><p class="section-kicker">EMPRESA EMISORA</p><h2>${utils.esc(company.commercialName || "Empresa no seleccionada")}</h2></div>
          <div class="table-actions-inline">
            <span class="status-badge ${validation?.readyForInvoice ? "authorized" : "pending"}">AMBIENTE ${utils.esc(company.environmentCode || "-")} · ${utils.esc(selectedEnvironmentLabel())}</span>
            <span class="status-badge ${validation?.readyForSignature ? "authorized" : "pending"}">${validation?.readyForSignature ? "Firmante validado" : "Firma pendiente"}</span>
          </div>
        </div>
        <div class="sri-parameter-grid">
          <div><span>Razon social</span><strong>${utils.esc(company.legalName || "-")}</strong><small>Identidad separada por empresa</small></div>
          <div><span>RUC emisor</span><strong>${utils.esc(company.ruc || "-")}</strong><small>Debe coincidir con el certificado</small></div>
          <div><span>Calificacion tributaria</span><strong>${utils.esc(company.habitualExporterLegend || "SIN LEYENDA ESPECIAL")}</strong><small>${company.habitualExporterLegend ? "Se incorpora al XML y al RIDE" : "No configurada para esta empresa"}</small></div>
          <div><span>Establecimiento / punto</span>${points.length ? `<select data-sri-emission-point>${points.map(item => `<option value="${utils.esc(item.id)}" ${item.id === point?.id ? "selected" : ""}>${utils.esc(`${item.establishment_code}-${item.emission_point_code} · ${item.name || "Emision"}`)}</option>`).join("")}</select>` : `<strong>${utils.esc(`${company.defaultEstablishment || "001"}-${company.defaultEmissionPoint || "001"}`)}</strong>`}<small>Las facturas se enrutan automáticamente: exportación 001-002 y venta local 001-003 en Bless Flower.</small></div>
          <div><span>Guias de remision SRI</span><strong>DESHABILITADAS</strong><small>El sistema no emite documentos tipo 06</small></div>
          <div><span>Secuencial compartido</span><strong>Factura · cliente · Packing</strong><small>Una sola numeracion documental dentro de la empresa</small></div>
          <div><span>Certificado activo</span><strong>${utils.esc(signer?.alias || "Pendiente de backend")}</strong><small>${utils.esc(signer?.validUntil ? `Vigente hasta ${dateTimeLabel(signer.validUntil)}` : "P12/PFX nunca se guarda en el navegador")}</small></div>
        </div>
        ${validation?.errors?.length ? `<p class="sri-readiness-message">${utils.esc(validation.errors.join(" "))}</p>` : ""}
      </section>
    `;
  }

  function creditNoteTotals(draft = ui.creditNoteDraft) {
    const lines = (draft?.lines || []).filter(line => Number(line.affectedQuantity || 0) > 0);
    const totalWithoutTax = lines.reduce((sum, line) => (
      sum + (Number(line.affectedQuantity || 0) * Number(line.unitPrice || 0))
    ), 0);
    const taxTotal = lines.reduce((sum, line) => sum + (line.taxes || []).reduce((taxSum, tax) => (
      taxSum + (Number(line.affectedQuantity || 0) * Number(line.unitPrice || 0) * Number(tax.rate || 0) / 100)
    ), 0), 0);
    return {
      totalWithoutTax: Number(totalWithoutTax.toFixed(6)),
      taxTotal: Number(taxTotal.toFixed(6)),
      total: Number((totalWithoutTax + taxTotal).toFixed(6))
    };
  }

  function renderCreditNoteModal() {
    const draft = ui.creditNoteDraft;
    if (!draft) return "";
    const totals = creditNoteTotals(draft);
    const remaining = Math.max(0, Number(draft.grandTotal || 0) - Number(draft.creditedTotal || 0));
    return `
      <div class="erp-modal-backdrop sri-credit-note-backdrop" role="presentation">
        <section class="erp-modal-card sri-credit-note-modal" role="dialog" aria-modal="true" aria-labelledby="sri-credit-note-title">
          <header class="erp-modal-header">
            <div><p class="section-kicker">DOCUMENTO ELECTRONICO SRI · TIPO 04</p><h2 id="sri-credit-note-title">Nueva nota de credito</h2><p>Factura ${utils.esc(draft.fullNumber)} · ${utils.esc(draft.customer)}</p></div>
            <button class="secondary-button" type="button" data-sri-credit-note-close>Cerrar</button>
          </header>
          <div class="sri-credit-note-summary">
            <div><span>Total factura</span><strong>${utils.esc(utils.money(draft.grandTotal))}</strong></div>
            <div><span>Notas autorizadas</span><strong>${utils.esc(utils.money(draft.creditedTotal))}</strong></div>
            <div><span>Saldo máximo</span><strong>${utils.esc(utils.money(remaining))}</strong></div>
            <div><span>Nota actual</span><strong>${utils.esc(utils.money(totals.total))}</strong></div>
          </div>
          <label class="compact-field sri-credit-note-reason"><span>Motivo de la nota de credito</span><input type="text" value="${utils.esc(draft.reason || "")}" maxlength="300" placeholder="Ej. Reclamo por calidad, devolución parcial o anulación total" data-sri-credit-note-reason></label>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Variedad</th><th>Medida</th><th class="numeric">Cantidad facturada</th><th class="numeric">Cantidad a dar de baja</th><th class="numeric">Precio</th><th class="numeric">Subtotal</th></tr></thead>
              <tbody>${draft.lines.map((line, index) => `
                <tr>
                  <td><strong>${utils.esc(line.variety || line.description)}</strong><small>${utils.esc(line.description)}</small></td>
                  <td>${utils.esc(line.measure || "-")}</td>
                  <td class="numeric">${utils.esc(line.quantity)}</td>
                  <td class="numeric"><input class="sri-credit-note-quantity" type="number" min="0" max="${utils.esc(line.quantity)}" step="0.000001" value="${utils.esc(line.affectedQuantity || "")}" data-sri-credit-note-quantity="${index}"></td>
                  <td class="numeric">${utils.esc(utils.money(line.unitPrice))}</td>
                  <td class="numeric">${utils.esc(utils.money(Number(line.affectedQuantity || 0) * Number(line.unitPrice || 0)))}</td>
                </tr>`).join("")}</tbody>
            </table>
          </div>
          <p class="table-footer-note">Puede dar de baja todos los ramos o únicamente las variedades y cantidades afectadas. El backend SRI impide superar el saldo de la factura original.</p>
          <footer class="erp-modal-footer">
            <button class="secondary-button" type="button" data-sri-credit-note-full>Dar de baja todo</button>
            <button class="sri-authorize-button" type="button" data-sri-credit-note-save ${ui.processing ? "disabled" : ""}>${ui.processing ? "Creando..." : "Crear borrador de nota de credito"}</button>
          </footer>
        </section>
      </div>
    `;
  }

  function sriStageLabel(value) {
    const labels = {
      VALIDATION: "Validación del comprobante",
      XML: "Generación del XML",
      SIGNATURE: "Firma electrónica",
      RECEPTION: "Recepción SRI",
      AUTHORIZATION: "Autorización SRI",
      RIDE: "Generación del RIDE",
    PROCESSING: "Procesamiento de JAEDER SYSTEMS"
    };
    const normalized = String(value || "").toUpperCase();
    return labels[normalized] || normalized || "Sin etapa registrada";
  }

  function sriStatusExplanation(status) {
    const normalized = String(status || "PENDIENTE").toUpperCase();
    const explanations = {
      PENDIENTE: "El pedido todavía no tiene un comprobante creado en el backend SRI.",
      BORRADOR: "Existe el borrador, pero todavía no se generó el XML.",
      VALIDADO: "Los datos fueron validados; todavía no se generó ni envió el XML.",
      XML_GENERADO: "El XML fue generado, pero todavía no está firmado ni enviado.",
      FIRMADO: "El XML está firmado y listo para enviarse; el SRI todavía no confirma recepción.",
    ENVIADO_SRI: "JAEDER SYSTEMS transmitió el comprobante; falta confirmar si el SRI lo recibió.",
      RECIBIDO_SRI: "El SRI confirmó la recepción y está pendiente la respuesta de autorización.",
      PENDIENTE_REINTENTO: "Hubo un problema temporal. El backend programó o permite un nuevo intento.",
      AUTORIZADO: "El SRI autorizó el comprobante. La emisión terminó correctamente.",
      DEVUELTO: "El SRI recibió el comprobante, encontró errores y lo devolvió.",
      NO_AUTORIZADO: "El SRI procesó el comprobante, pero negó la autorización.",
      ERROR_ENVIO: "El comprobante no pudo completar la transmisión por un error técnico.",
      ANULADO: "El comprobante fue anulado y no debe reenviarse."
    };
    return explanations[normalized] || "Revise los mensajes e intentos registrados para conocer el resultado.";
  }

  function sriCorrectiveGuidance(status, hasMessages, hasRemoteDocument) {
    const normalized = String(status || "PENDIENTE").toUpperCase();
    if (!hasRemoteDocument) return "Corrija los datos indicados en el pedido y vuelva a procesarlo; todavía no llegó al SRI.";
    if (normalized === "AUTORIZADO") return "No requiere corrección ni reenvío.";
    if (["DEVUELTO", "NO_AUTORIZADO"].includes(normalized)) {
      return hasMessages
        ? "Corrija los campos descritos por el SRI antes de generar y enviar nuevamente el comprobante."
        : "Consulte nuevamente el detalle; el SRI rechazó el comprobante, pero no devolvió un mensaje descriptivo.";
    }
    if (["ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(normalized)) {
      return "Revise conexión, certificado, ambiente y servicio SRI. Después use Procesar en SRI para reintentar.";
    }
    if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI"].includes(normalized)) {
      return "Puede usar Procesar en SRI para continuar o consultar nuevamente el estado sin crear otra factura.";
    }
    return "Complete la etapa pendiente desde Procesar en SRI.";
  }

  function renderSriDiagnosticModal() {
    const diagnostic = ui.diagnostic;
    if (!diagnostic) return "";
    const row = diagnostic.row || {};
    const detail = diagnostic.detail || {};
    const document = detail.document || {};
    const status = String(document.status || row.authorizationStatus || "PENDIENTE").toUpperCase();
    const messages = Array.isArray(detail.errors) ? detail.errors : [];
    const attempts = Array.isArray(detail.transmissionAttempts) ? detail.transmissionAttempts : [];
    const transmissions = Array.isArray(detail.transmissions) ? detail.transmissions : [];
    const latestAttempt = attempts[0] || {};
    const latestTransmission = transmissions[0] || {};
    const localError = diagnostic.localError || {};
    const recovery = detail.recoveryPolicy || {};
    const mainIdentifier = String(messages[0]?.identifier || recovery.diagnostic?.identifier || "").trim();
    const mainMessage = messages[0]?.message
      || latestAttempt.error_message
      || latestTransmission.error_message
      || document.last_error
      || localError.message
      || diagnostic.error
      || "";
    const mainError = [mainIdentifier, mainMessage].filter(Boolean).join(" — ");
    const reachedSri = ["RECIBIDO_SRI", "AUTORIZADO", "DEVUELTO", "NO_AUTORIZADO"].includes(status);
    const sentToSri = reachedSri || ["ENVIADO_SRI", "PENDIENTE_REINTENTO"].includes(status);
    const lastStage = messages[0]?.stage
      || latestTransmission.transmission_type
      || localError.stage
      || (status === "AUTORIZADO" || status === "NO_AUTORIZADO" ? "AUTHORIZATION" : "");
    const nextAttempt = latestTransmission.next_attempt_at || "";

    return `
      <div class="erp-modal-backdrop sri-diagnostic-backdrop" role="presentation">
        <section class="erp-modal-card sri-diagnostic-modal" role="dialog" aria-modal="true" aria-labelledby="sri-diagnostic-title">
          <header class="erp-modal-header">
            <div>
              <p class="section-kicker">SEGUIMIENTO DEL COMPROBANTE</p>
              <h2 id="sri-diagnostic-title">Detalle y errores SRI</h2>
              <p>${utils.esc(row.documentLabel || "FACTURA")} ${utils.esc(row.documentNumber || row.orderNumber || "sin secuencial")} · ${utils.esc(row.customer || "Sin cliente")}</p>
            </div>
            <button class="secondary-button" type="button" data-sri-diagnostic-close>Cerrar</button>
          </header>
          ${diagnostic.loading ? `<div class="empty-state"><strong>Consultando trazabilidad...</strong><span>Recuperando respuestas e intentos registrados en el backend SRI.</span></div>` : `
            <div class="sri-credit-note-summary">
              <div><span>Estado actual</span><strong><span class="status-badge ${badgeClass(status)}">${utils.esc(status)}</span></strong></div>
              <div><span>¿Se intentó enviar?</span><strong>${sentToSri ? "SÍ" : "NO"}</strong></div>
              <div><span>¿El SRI lo recibió?</span><strong>${reachedSri ? "SÍ" : "NO / PENDIENTE"}</strong></div>
              <div><span>Última etapa</span><strong>${utils.esc(sriStageLabel(lastStage))}</strong></div>
              <div><span>Factura</span><strong>${utils.esc(document.full_number || row.documentNumber || "-")}</strong></div>
              <div><span>Clave de acceso</span><strong>${utils.esc(document.access_key || row.accessKey || "-")}</strong></div>
              <div><span>Intento</span><strong>${utils.esc(latestAttempt.id || "-")}</strong></div>
              <div><span>Transmisión</span><strong>${utils.esc(messages[0]?.transmission_id || latestAttempt.transmission_id || latestTransmission.id || "-")}</strong></div>
            </div>
            <section class="sri-diagnostic-result ${mainError ? "has-error" : ""}">
              <h3>${mainError ? "Mensaje que debe revisar" : "Resultado del proceso"}</h3>
              <p>${utils.esc(mainError || sriStatusExplanation(status))}</p>
              <small>${utils.esc(sriStatusExplanation(status))}</small>
            </section>
            <section class="sri-diagnostic-guidance">
              <strong>Qué hacer ahora</strong>
              <span>${utils.esc(recovery.reason || sriCorrectiveGuidance(status, Boolean(messages.length), Boolean(row.remoteDocumentId)))}</span>
              ${nextAttempt ? `<small>Próximo reintento programado: ${utils.esc(dateTimeLabel(nextAttempt))}</small>` : ""}
            </section>
            <div class="panel-card-head sri-diagnostic-section-head"><div><p class="section-kicker">RESPUESTA OFICIAL</p><h3>Mensajes del SRI</h3></div><span class="status-badge ${messages.length ? "cancelled" : "authorized"}">${utils.esc(messages.length)} mensaje(s)</span></div>
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Fecha</th><th>Etapa</th><th>Código</th><th>Tipo</th><th>Mensaje</th><th>Información adicional</th></tr></thead>
                <tbody>${messages.length ? messages.map(message => `
                  <tr>
                    <td>${utils.esc(dateTimeLabel(message.created_at))}</td>
                    <td>${utils.esc(sriStageLabel(message.stage))}</td>
                    <td><strong>${utils.esc(message.identifier || "-")}</strong></td>
                    <td>${utils.esc(message.message_type || "-")}</td>
                    <td>${utils.esc(message.message || "Mensaje SRI")}</td>
                    <td>${utils.esc(message.additional_information || "-")}</td>
                  </tr>`).join("") : `<tr><td colspan="6">El SRI no ha registrado mensajes de rechazo para este comprobante.</td></tr>`}</tbody>
              </table>
            </div>
            <div class="panel-card-head sri-diagnostic-section-head"><div><p class="section-kicker">TRAZABILIDAD</p><h3>Intentos de transmisión</h3></div><span class="status-badge pending">${utils.esc(attempts.length)} intento(s)</span></div>
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Intento</th><th>Fecha</th><th>Estado</th><th>HTTP</th><th>Clase de error</th><th>Detalle técnico</th></tr></thead>
                <tbody>${attempts.length ? attempts.map(attempt => `
                  <tr>
                    <td><strong>${utils.esc(attempt.attempt_number || "-")}</strong></td>
                    <td>${utils.esc(dateTimeLabel(attempt.finished_at || attempt.created_at))}</td>
                    <td>${utils.esc(attempt.status || "-")}</td>
                    <td>${utils.esc(attempt.http_status || "-")}</td>
                    <td>${utils.esc(attempt.error_class || "-")}</td>
                    <td>${utils.esc(attempt.error_message || "Sin error técnico")}</td>
                  </tr>`).join("") : `<tr><td colspan="6">${row.remoteDocumentId ? "Todavía no existen intentos de transmisión." : "El comprobante aún no fue creado en el backend SRI."}</td></tr>`}</tbody>
              </table>
            </div>
          `}
          <footer class="erp-modal-footer">
            <button class="secondary-button" type="button" data-sri-diagnostic-close>Cerrar detalle</button>
            ${recovery.action && recovery.action !== "NONE"
              ? `<button class="sri-authorize-button" type="button" data-sri-recovery-action="${utils.esc(recovery.action)}" data-sri-recovery-row="${utils.esc(row.id)}" ${ui.processing ? "disabled" : ""}>${utils.esc(recovery.actionLabel || "Continuar")}</button>`
              : (!queueCore.isDiagnosticStatus?.(status) && row.processable
                ? `<button class="sri-authorize-button" type="button" data-sri-diagnostic-retry="${utils.esc(row.id)}" ${ui.processing ? "disabled" : ""}>Continuar proceso</button>`
                : "")}
          </footer>
        </section>
      </div>
    `;
  }

  function renderSriDiagnosticButton(row) {
    return `<button class="secondary-button" type="button" data-sri-diagnostic="${utils.esc(row.id)}">Ver detalle SRI</button>`;
  }

  function creditWorkspaceRows(appState) {
    const term = ui.creditSearch.trim().toLowerCase();
    const remote = remoteRows(appState);
    const invoices = remote
      .filter(row => row.documentType === "01" && row.authorizationStatus === "AUTORIZADO")
      .filter(row => !term || [
        row.documentNumber, row.customer, row.brand, row.orderNumber, row.authorizationNumber
      ].join(" ").toLowerCase().includes(term))
      .sort((left, right) => String(right.issueDate || "").localeCompare(String(left.issueDate || "")));
    const invoiceById = new Map(invoices.map(row => [String(row.remoteDocumentId), row]));
    const notes = remote
      .filter(row => row.documentType === "04")
      .filter(row => ui.creditStatus === "TODOS" || row.authorizationStatus === ui.creditStatus)
      .filter(row => !term || [
        row.documentNumber, row.customer, row.creditReason, row.authorizationStatus,
        row.originalDocumentNumber, invoiceById.get(String(row.parentDocumentId))?.documentNumber
      ].join(" ").toLowerCase().includes(term))
      .map(row => ({
        ...row,
        originalDocumentNumber: row.originalDocumentNumber
          || invoiceById.get(String(row.parentDocumentId))?.documentNumber
          || "-"
      }))
      .sort((left, right) => String(right.issueDate || "").localeCompare(String(left.issueDate || "")));
    return { invoices, notes };
  }

  function renderCreditNoteFiles(row) {
    if (row.authorizationStatus === "AUTORIZADO") {
      return `
        <div class="table-actions-inline sri-file-actions">
          <button class="secondary-button" type="button" data-credit-download="${utils.esc(row.remoteDocumentId)}" data-credit-file-type="AUTHORIZED_XML">XML</button>
          <button class="secondary-button" type="button" data-credit-download="${utils.esc(row.remoteDocumentId)}" data-credit-file-type="RIDE_PDF">RIDE PDF</button>
          ${renderSriDiagnosticButton(row)}
        </div>
      `;
    }
    if (row.selectable) {
      return `<div class="table-actions-inline sri-file-actions">
        <button class="sri-authorize-button" type="button" data-credit-process="${utils.esc(row.id)}" ${ui.processing ? "disabled" : ""}>Procesar en SRI</button>
        ${renderSriDiagnosticButton(row)}
      </div>`;
    }
    return renderSriDiagnosticButton(row);
  }

  function renderCreditNotes(appState) {
    syncWorkspaceCompany(appState);
    const { invoices, notes } = creditWorkspaceRows(appState);
    const connection = BlessERP.sriApi?.status?.() || { ready: false };
    const activeCompany = BlessERP.sriApi?.activeCompany?.() || {};
    const authorizedNotes = notes.filter(row => row.authorizationStatus === "AUTORIZADO");
    const invoicePage = BlessERP.performance?.paginate?.(invoices, "commercial-credit-invoices", { pageSize: 25 })
      || { items: invoices.slice(0, 25), total: invoices.length, pageSize: 25 };
    const notesPage = BlessERP.performance?.paginate?.(notes, "commercial-credit-notes", { pageSize: 25 })
      || { items: notes.slice(0, 25), total: notes.length, pageSize: 25 };
    const availableTotal = invoices.reduce((sum, row) => (
      sum + Math.max(0, Number(row.total || 0) - Number(row.creditedTotal || 0))
    ), 0);
    const statuses = ["TODOS", "BORRADOR", "VALIDADO", "XML_GENERADO", "FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO", "DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"];

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Notas de crédito</h1>
          <p>Correcciones totales o parciales vinculadas exclusivamente a facturas SRI autorizadas de ${utils.esc(activeCompany.commercialName || "la empresa activa")}.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${connection.ready ? "authorized" : "partial"}">${connection.ready ? `SRI ${utils.esc(selectedEnvironmentLabel())} conectado` : "Preparación local"}</span>
          <button class="secondary-button" type="button" data-route-link="commercial-sri-authorization">Documentos SRI</button>
        </div>
      </section>

      <section class="summary-grid">
        <article class="summary-card"><span>Facturas autorizadas</span><strong>${utils.esc(invoices.length)}</strong><small>Disponibles como documento origen</small></article>
        <article class="summary-card"><span>Saldo acreditable</span><strong>${utils.esc(utils.money(availableTotal))}</strong><small>No permite superar el saldo original</small></article>
        <article class="summary-card"><span>Notas registradas</span><strong>${utils.esc(notes.length)}</strong><small>Borradores y documentos procesados</small></article>
        <article class="summary-card"><span>Notas autorizadas</span><strong>${utils.esc(authorizedNotes.length)}</strong><small>Aplicadas a cartera al sincronizar</small></article>
      </section>

      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">NUEVA NOTA DE CRÉDITO</p><h3>Seleccione la factura autorizada</h3></div>
          <button class="secondary-button" type="button" data-credit-refresh ${ui.loading ? "disabled" : ""}>${ui.loading ? "Actualizando..." : "Actualizar SRI"}</button>
        </div>
        <div class="sri-document-toolbar">
          <label class="compact-field sri-document-search"><span>Buscar factura o cliente</span><input type="search" value="${utils.esc(ui.creditSearch)}" placeholder="Factura, cliente, marca o autorización" data-credit-search></label>
        </div>
        ${ui.error ? `<p class="sri-readiness-message">${utils.esc(ui.error)}</p>` : ""}
        ${ui.batchMessage ? `<p class="sri-batch-message ${utils.esc(ui.batchTone)}">${utils.esc(ui.batchMessage)}</p>` : ""}
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Factura</th><th>Cliente</th><th>Marca</th><th>Fecha</th><th class="numeric">Total</th><th class="numeric">Notas aplicadas</th><th class="numeric">Saldo máximo</th><th>Acción</th></tr></thead>
            <tbody>
              ${invoicePage.items.length ? invoicePage.items.map(row => {
                const remaining = Math.max(0, Number(row.total || 0) - Number(row.creditedTotal || 0));
                return `
                  <tr>
                    <td><strong>${utils.esc(row.documentNumber || "-")}</strong><small>${utils.esc(row.authorizationNumber || "Sin autorización")}</small></td>
                    <td>${utils.esc(row.customer)}</td>
                    <td>${utils.esc(row.brand || "-")}</td>
                    <td>${utils.esc(utils.dateLabel(row.issueDate))}</td>
                    <td class="numeric">${utils.esc(utils.money(row.total))}</td>
                    <td class="numeric">${utils.esc(utils.money(row.creditedTotal))}</td>
                    <td class="numeric"><strong>${utils.esc(utils.money(remaining))}</strong></td>
                    <td><button class="primary-button" type="button" data-credit-create="${utils.esc(row.remoteDocumentId)}" ${remaining > 0 && !ui.processing ? "" : "disabled"}>${remaining > 0 ? "Crear nota" : "Sin saldo"}</button></td>
                  </tr>
                `;
              }).join("") : `<tr><td colspan="8">${connection.ready ? "No existen facturas autorizadas para la búsqueda actual." : "Conecte el backend SRI para consultar facturas autorizadas."}</td></tr>`}
            </tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(invoicePage) || ""}
      </section>

      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">HISTORIAL</p><h3>Notas de crédito registradas</h3></div>
          <label class="compact-field"><span>Estado</span><select data-credit-status>${statuses.map(value => `<option value="${value}" ${ui.creditStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Nota de crédito</th><th>Factura modificada</th><th>Cliente</th><th>Motivo</th><th>Fecha</th><th class="numeric">Valor</th><th>Estado</th><th>Archivos / acción</th></tr></thead>
            <tbody>
              ${notesPage.items.length ? notesPage.items.map(row => `
                <tr>
                  <td><strong>${utils.esc(row.documentNumber || "Se asigna al procesar")}</strong><small>Documento SRI tipo 04</small></td>
                  <td>${utils.esc(row.originalDocumentNumber || "-")}</td>
                  <td>${utils.esc(row.customer)}</td>
                  <td>${utils.esc(row.creditReason || "-")}</td>
                  <td>${utils.esc(utils.dateLabel(row.issueDate))}</td>
                  <td class="numeric"><strong>${utils.esc(utils.money(row.total))}</strong></td>
                  <td><span class="status-badge ${badgeClass(row.authorizationStatus)}">${utils.esc(row.authorizationStatus)}</span></td>
                  <td>${renderCreditNoteFiles(row)}</td>
                </tr>
              `).join("") : `<tr><td colspan="8">No existen notas de crédito para el filtro actual.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(notesPage) || ""}
      </section>

          <p class="sri-date-policy"><strong>Regla:</strong> la nota se prepara en JAEDER SYSTEMS, pero cartera y contabilidad se actualizan únicamente cuando el SRI devuelve el estado AUTORIZADO.</p>
      ${renderCreditNoteModal()}
      ${renderSriDiagnosticModal()}
    `;
  }

  function render(appState) {
    syncWorkspaceCompany(appState);
    const issueRange = selectedIssueMonthRange();
    const sourceRows = issueRange ? allRows(appState) : [];
    const filteredRows = rows(appState, sourceRows);
    const pagination = BlessERP.performance?.paginate?.(filteredRows, "commercial-sri-documents", { pageSize: 50 })
      || { items: filteredRows.slice(0, 50), total: filteredRows.length, pageSize: 50 };
    const visibleRows = pagination.items;
    const validIds = new Set(sourceRows.map(row => row.id));
    [...ui.selectedIds].forEach(id => { if (!validIds.has(id)) ui.selectedIds.delete(id); });
    const selectableVisible = visibleRows.filter(row => row.selectable);
    const allVisibleSelected = Boolean(selectableVisible.length) && selectableVisible.every(row => ui.selectedIds.has(row.id));
    const selectedRows = sourceRows.filter(row => ui.selectedIds.has(row.id));
    const selectedCount = selectedRows.length;
    const selectedProcessable = selectedRows.filter(row => row.processable).length;
    const selectedAuthorized = selectedRows.filter(row => row.authorizationStatus === "AUTORIZADO").length;
    const connection = BlessERP.sriApi?.status?.() || { ready: false };
    const activeCompany = BlessERP.sriApi?.activeCompany?.() || {};
    const statuses = ["TODOS", "PENDIENTE", "PENDIENTE_CONFIGURACION", "BORRADOR_LOCAL", "BORRADOR", "VALIDADO", "XML_GENERADO", "FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO", "DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO", "PENDIENTE_REINTENTO", "ANULADO"];
    return `
      <section class="page-header compact-page-header">
        <div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>Documentos electronicos SRI</h1><p>Facturacion separada de ${utils.esc(activeCompany.commercialName || "la empresa")} en ambiente ${utils.esc(selectedEnvironmentLabel())}.</p></div>
        <div class="page-header-side"><span class="status-badge ${connection.ready ? "authorized" : "partial"}">${connection.ready ? `SRI ${utils.esc(selectedEnvironmentLabel())} conectado` : "Preparacion local"}</span></div>
      </section>
      ${renderIssueMonthSelector()}
      ${!issueRange ? `<section class="panel-card"><div class="empty-state"><strong>Seleccione un mes</strong><span>No se consultarán ni cargarán documentos hasta elegir uno de los doce meses.</span></div></section>` : `
      ${renderCompanyContext()}
      <section class="panel-card sri-document-panel">
        <div class="sri-document-toolbar">
          <div class="compact-field sri-locked-company"><span>Empresa emisora</span><strong>${utils.esc(activeCompany.commercialName || "Empresa activa")}</strong><small>Fijada por la pestaña y el permiso del usuario</small></div>
          <label class="compact-field sri-document-search"><span>Buscar documento</span><input type="search" value="${utils.esc(ui.search)}" placeholder="Factura, cliente, DAE o guía" data-sri-list-search></label>
          <label class="compact-field"><span>Venta / comprobante</span><select data-sri-list-sales-scope><option value="TODOS" ${ui.salesScope === "TODOS" ? "selected" : ""}>TODOS</option><option value="LOCALES" ${ui.salesScope === "LOCALES" ? "selected" : ""}>VENTAS LOCALES</option><option value="EXPORTACIONES" ${ui.salesScope === "EXPORTACIONES" ? "selected" : ""}>EXPORTACIONES</option><option value="NOTAS_CREDITO" ${ui.salesScope === "NOTAS_CREDITO" ? "selected" : ""}>NOTAS DE CRÉDITO</option></select></label>
          <label class="compact-field"><span>Transporte</span><select data-sri-list-transport><option value="TODOS" ${ui.transportScope === "TODOS" ? "selected" : ""}>TODOS</option><option value="AEREO" ${ui.transportScope === "AEREO" ? "selected" : ""}>AÉREO</option><option value="MARITIMO" ${ui.transportScope === "MARITIMO" ? "selected" : ""}>MARÍTIMO</option></select></label>
          <label class="compact-field"><span>Estado</span><select data-sri-list-status>${statuses.map(value => `<option value="${value}" ${ui.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label class="compact-field"><span>DAE</span><select data-sri-list-dae><option value="TODOS" ${ui.daeScope === "TODOS" ? "selected" : ""}>TODOS</option><option value="CON_DAE" ${ui.daeScope === "CON_DAE" ? "selected" : ""}>CON DAE</option><option value="SIN_DAE" ${ui.daeScope === "SIN_DAE" ? "selected" : ""}>SIN DAE</option></select></label>
          <label class="compact-field"><span>Desde</span><input type="date" value="${utils.esc(ui.dateFrom)}" data-sri-list-date-from></label>
          <label class="compact-field"><span>Hasta</span><input type="date" value="${utils.esc(ui.dateTo)}" data-sri-list-date-to></label>
          <label class="compact-field sri-document-sort"><span>Ordenar por</span><select data-sri-list-sort><option value="DATE_DESC" ${ui.sortMode === "DATE_DESC" ? "selected" : ""}>MÁS RECIENTES</option><option value="DATE_ASC" ${ui.sortMode === "DATE_ASC" ? "selected" : ""}>MÁS ANTIGUOS</option><option value="DAE_MISSING_FIRST" ${ui.sortMode === "DAE_MISSING_FIRST" ? "selected" : ""}>SIN DAE PRIMERO</option><option value="VALUE_DESC" ${ui.sortMode === "VALUE_DESC" ? "selected" : ""}>MAYOR VALOR</option><option value="VALUE_ASC" ${ui.sortMode === "VALUE_ASC" ? "selected" : ""}>MENOR VALOR</option></select></label>
          <button class="secondary-button sri-filter-clear" type="button" data-sri-list-clear>LIMPIAR</button>
          <button class="secondary-button" type="button" data-sri-list-refresh ${ui.loading ? "disabled" : ""}>${ui.loading ? "Actualizando..." : "Actualizar"}</button>
        </div>
        ${ui.error ? `<div class="inline-message warning">${utils.esc(ui.error)}</div>` : ""}
        ${ui.batchMessage ? `<div class="inline-message ${utils.esc(ui.batchTone)}">${utils.esc(ui.batchMessage)}</div>` : ""}
        <div class="sri-batch-toolbar">
          <div class="sri-batch-selection">
            <button class="secondary-button" type="button" data-sri-select-visible ${!selectableVisible.length || ui.processing ? "disabled" : ""}>Seleccionar visibles</button>
            <button class="secondary-button" type="button" data-sri-clear-selection ${!selectedCount || ui.processing ? "disabled" : ""}>Deseleccionar</button>
            <strong data-sri-selection-count>${utils.esc(selectedCount)} seleccionados</strong>
          </div>
          <div class="table-actions-inline">
            <button class="sri-authorize-button" type="button" data-sri-authorize-selected ${!selectedProcessable || ui.processing ? "disabled" : ""}>${ui.processing ? "Procesando..." : `Procesar pendientes (${selectedProcessable})`}</button>
            <button class="secondary-button" type="button" data-sri-download-selected="AUTHORIZED_XML" ${!selectedAuthorized || ui.processing ? "disabled" : ""}>Descargar XML (${selectedAuthorized})</button>
            <button class="secondary-button" type="button" data-sri-download-selected="RIDE_PDF" ${!selectedAuthorized || ui.processing ? "disabled" : ""}>Descargar RIDE (${selectedAuthorized})</button>
            <button class="secondary-button" type="button" data-sri-view-selected ${selectedCount !== 1 || ui.processing ? "disabled" : ""}>Ver detalle SRI</button>
          </div>
        </div>
        <div class="table-wrapper sri-document-table-wrap">
          <table class="data-table sri-document-table">
            <thead><tr><th class="sri-select-column"><input type="checkbox" aria-label="Seleccionar documentos visibles" data-sri-select-visible-check ${allVisibleSelected ? "checked" : ""} ${!selectableVisible.length || ui.processing ? "disabled" : ""}></th><th>Fecha de emisión</th><th>Fecha de vuelo</th><th>Comprobante</th><th class="numeric">Valor</th><th>Cliente</th><th>Cliente final</th><th>DAE</th><th>Guía madre</th><th>Guía hija</th><th>Fecha de autorización</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${visibleRows.map(row => `
              <tr>
                <td class="sri-select-column"><input type="checkbox" aria-label="Seleccionar ${utils.esc(row.documentNumber || row.orderNumber || row.customer)}" data-sri-row-select="${utils.esc(row.id)}" data-processable="${row.processable ? "1" : "0"}" data-authorized="${row.authorizationStatus === "AUTORIZADO" ? "1" : "0"}" ${ui.selectedIds.has(row.id) ? "checked" : ""} ${!row.selectable || ui.processing ? "disabled" : ""}></td>
                <td><strong>${utils.esc(row.issueDate ? utils.dateLabel(row.issueDate) : "Pendiente")}</strong></td>
                <td>${utils.esc(row.flightDate ? utils.dateLabel(row.flightDate) : "-")}</td>
                <td class="sri-document-identity"><strong class="sri-document-number ${documentNumberStatusClass(row.authorizationStatus)}">${utils.esc(invoiceLastNine(row.documentNumber, row.accessKey))}</strong><small>${utils.esc(row.documentLabel || "FACTURA")} · ${utils.esc(row.transportType || "LOCAL")}</small></td>
                <td class="numeric"><strong>${utils.esc(utils.money(row.total))}</strong></td>
                <td><strong>${utils.esc(row.customer || "-")}</strong></td>
                <td>${utils.esc(row.brand || "-")}</td>
                <td>${renderLogisticsField(row, "sriDaeNumber", row.dae)}</td>
                <td>${renderLogisticsField(row, "awb", row.motherGuide)}</td>
                <td>${renderLogisticsField(row, "hawb", row.childGuide)}</td>
                <td>${row.authorizedAt ? `<strong>${utils.esc(dateTimeLabel(row.authorizedAt))}</strong>` : "-"}</td>
                <td><span class="status-badge ${badgeClass(row.authorizationStatus)}">${utils.esc(row.authorizationStatus)}</span></td>
                <td class="sri-row-actions-cell">${renderDocumentInlineActions(row)}</td>
              </tr>`).join("") || `<tr><td colspan="13"><div class="empty-state"><strong>Sin documentos</strong><span>No existen registros con los filtros seleccionados.</span></div></td></tr>`}</tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(pagination) || ""}
        <p class="table-footer-note">${utils.esc(visibleRows.length)} de ${utils.esc(filteredRows.length)} documentos. La clave contiene fecha, tipo 01 para factura o 04 para nota de credito, RUC, ambiente, serie, secuencial, codigo numerico, emision 1 y modulo 11.</p>
      </section>
      `}
      ${renderCreditNoteModal()}
      ${renderSriDiagnosticModal()}
      ${renderAnnulmentModal()}
    `;
  }

  const routeByViewMode = {
    documents: "commercial-sri-authorization",
    "credit-notes": "commercial-credit-notes",
    senae: "commercial-senae-liquidation"
  };

  function isActiveView(container, viewMode = "documents") {
    const expectedRoute = routeByViewMode[viewMode] || routeByViewMode.documents;
    const currentRoute = BlessERP.state?.currentRoute?.()?.id || "";
    return Boolean(container?.isConnected)
      && container.id === "page-root"
      && currentRoute === expectedRoute;
  }

  function rerender(container, appState) {
    // Las consultas SRI pueden terminar despues de que el usuario haya abierto
    // otro modulo. El contenedor #page-root se reutiliza para todas las rutas,
    // por lo que una respuesta atrasada nunca debe volver a dibujar el SRI.
    if (!isActiveView(container, "documents")) return;
    container.innerHTML = render(appState);
    bind(container, appState);
  }

  function rerenderCreditNotes(container, appState) {
    if (!isActiveView(container, "credit-notes")) return;
    container.innerHTML = renderCreditNotes(appState);
    bindCreditNotes(container, appState);
  }

  function senaeRepository() {
    const repository = BlessERP.getSenaeLiquidationV2Repository?.();
    if (!repository) throw new Error("El repositorio Liquidación SENAE V2 no está disponible.");
    return repository;
  }

  function senaeDraftFilters(page = 1) {
    return {
      dateFrom: ui.senaeDateFrom,
      dateTo: ui.senaeDateTo,
      commerceType: ui.senaeCommerceType,
      page,
      pageSize: ui.senaePageSize
    };
  }

  function senaeBuyer(document = {}) {
    const buyer = document.buyer_snapshot && typeof document.buyer_snapshot === "object" ? document.buyer_snapshot : {};
    return {
      name: String(buyer.legalName || buyer.legal_name || buyer.name || "SIN COMPRADOR"),
      taxId: String(buyer.identification || buyer.taxId || buyer.tax_id || "")
    };
  }

  function senaeMoney(value) {
    return typeof utils.money === "function" ? utils.money(Number(value || 0)) : `$${Number(value || 0).toFixed(2)}`;
  }

  function rerenderSenae(container, appState) {
    if (!isActiveView(container, "senae")) return;
    container.innerHTML = renderSenae(appState);
    bindSenae(container, appState);
  }

  function renderSenae(appState) {
    syncWorkspaceCompany(appState);
    const activeCompany = BlessERP.sriApi?.activeCompany?.() || {};
    const result = ui.senaeResult;
    const summary = result?.summary || null;
    const rows = Array.isArray(result?.items) ? result.items : [];
    const applied = ui.senaeAppliedFilters;
    return `
      <section class="page-header compact-page-header">
        <div><p class="section-kicker">REPORTES / SRI V2</p><h1>Liquidación SENAE</h1><p>Consulta fiscal de facturas electrónicas autorizadas, sin depender de pedidos o proyecciones comerciales.</p></div>
        <div class="page-header-side"><span class="status-badge authorized">${utils.esc(activeCompany.commercialName || "Empresa activa")}</span></div>
      </section>
      <section class="panel-card">
        <div class="sri-document-toolbar">
          <label class="compact-field"><span>Desde</span><input type="date" value="${utils.esc(ui.senaeDateFrom)}" data-sri-senae-date-from></label>
          <label class="compact-field"><span>Hasta</span><input type="date" value="${utils.esc(ui.senaeDateTo)}" data-sri-senae-date-to></label>
          <label class="compact-field"><span>Tipo de comercio</span><select data-sri-senae-commerce-type>
            <option value="TODOS" ${ui.senaeCommerceType === "TODOS" ? "selected" : ""}>Todos</option>
            <option value="LOCAL" ${ui.senaeCommerceType === "LOCAL" ? "selected" : ""}>Local</option>
            <option value="EXPORTADOR" ${ui.senaeCommerceType === "EXPORTADOR" ? "selected" : ""}>Exportador</option>
          </select></label>
          <button class="primary-button" type="button" data-sri-query-senae ${ui.senaeLoading || ui.processing ? "disabled" : ""}>${ui.senaeLoading ? "Consultando..." : "Consultar"}</button>
          <button class="secondary-button" type="button" data-sri-export-senae ${!applied || ui.senaeFiltersDirty || ui.processing || ui.senaeLoading ? "disabled" : ""}>${ui.processing ? "Generando..." : "Descargar XLSX"}</button>
        </div>
        <p class="sri-date-policy"><strong>Criterio fiscal:</strong> empresa activa, tipo 01, estado AUTORIZADO y rango inclusivo sobre <code>issue_date</code>. Las notas de crédito tipo 04 todavía no compensan este reporte.</p>
        ${ui.senaeFiltersDirty && applied ? `<div class="inline-message warning">Los filtros cambiaron. Pulse Consultar para aplicar el nuevo rango antes de descargar.</div>` : ""}
        ${ui.batchMessage ? `<div class="inline-message ${utils.esc(ui.batchTone)}">${utils.esc(ui.batchMessage)}</div>` : ""}
      </section>
      ${summary ? `
        <section class="summary-grid">
          <article class="summary-card"><span>Total documentos</span><strong>${utils.esc(summary.totalDocuments || 0)}</strong><small>Facturas autorizadas tipo 01</small></article>
          <article class="summary-card"><span>Facturas locales</span><strong>${utils.esc(summary.localDocuments || 0)}</strong><small>${utils.esc(senaeMoney(summary.localSales))}</small></article>
          <article class="summary-card"><span>Facturas exportación</span><strong>${utils.esc(summary.exportDocuments || 0)}</strong><small>${utils.esc(senaeMoney(summary.exportSales))}</small></article>
          <article class="summary-card"><span>Total general</span><strong>${utils.esc(senaeMoney(summary.grandTotal))}</strong><small>Importe canónico autorizado</small></article>
          ${Number(summary.unclassifiedDocuments || 0) ? `<article class="summary-card"><span>Sin clasificar</span><strong>${utils.esc(summary.unclassifiedDocuments)}</strong><small>Snapshot requiere revisión</small></article>` : ""}
        </section>` : ""}
      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">DETALLE CANÓNICO</p><h3>Facturas autorizadas</h3></div>
          ${applied ? `<span class="status-badge authorized">${utils.esc(applied.dateFrom)} a ${utils.esc(applied.dateTo)}</span>` : ""}
        </div>
        ${!result ? `<div class="senae-v2-empty"><strong>Consulta bajo demanda</strong><span>Seleccione el rango y pulse Consultar. Al abrir esta pantalla no se descargan documentos.</span></div>` : rows.length ? `
          <div class="senae-v2-table-wrap"><table class="senae-v2-table"><thead><tr><th>Fecha emisión</th><th>Factura</th><th>Clave acceso</th><th>Comprador</th><th>Identificación</th><th>Comercio</th><th>Subtotal</th><th>IVA</th><th>Total</th><th>Estado</th></tr></thead><tbody>
            ${rows.map(document => {
              const buyer = senaeBuyer(document);
              const commerceType = senaeRepository().deriveSenaeCommerceType(document);
              return `<tr><td>${utils.esc(document.issue_date || "-")}</td><td>${utils.esc(document.full_number || "-")}</td><td class="senae-v2-key">${utils.esc(document.access_key || "-")}</td><td>${utils.esc(buyer.name)}</td><td>${utils.esc(buyer.taxId || "-")}</td><td>${utils.esc(commerceType === "EXPORTADOR" ? "EXPORTACIÓN" : commerceType.replace("_", " "))}</td><td class="senae-v2-number">${utils.esc(senaeMoney(document.subtotal))}</td><td class="senae-v2-number">${utils.esc(senaeMoney(document.tax_total))}</td><td class="senae-v2-number"><strong>${utils.esc(senaeMoney(document.grand_total))}</strong></td><td><span class="status-badge authorized">AUTORIZADO</span></td></tr>`;
            }).join("")}
          </tbody></table></div>
          <div class="senae-v2-pagination">
            <label class="compact-field"><span>Filas</span><select data-sri-senae-page-size><option value="25" ${result.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${result.pageSize === 50 ? "selected" : ""}>50</option></select></label>
            <span>Mostrando ${utils.esc((result.page - 1) * result.pageSize + 1)}–${utils.esc(Math.min(result.page * result.pageSize, result.total))} de ${utils.esc(result.total)} · Página ${utils.esc(result.page)} de ${utils.esc(result.totalPages)}</span>
            <div><button class="secondary-button" type="button" data-sri-senae-page="${result.page - 1}" ${result.page <= 1 || ui.senaeLoading ? "disabled" : ""}>Anterior</button> <button class="secondary-button" type="button" data-sri-senae-page="${result.page + 1}" ${result.page >= result.totalPages || ui.senaeLoading ? "disabled" : ""}>Siguiente</button></div>
          </div>` : `<div class="senae-v2-empty"><strong>Sin resultados</strong><span>No existen facturas tipo 01 AUTORIZADAS para los filtros aplicados.</span></div>`}
      </section>`;
  }

  async function querySenae(container, appState, options = {}) {
    if (ui.senaeLoading) return;
    const setApplied = options.setApplied !== false;
    const filters = options.filters || senaeDraftFilters(1);
    try {
      ui.senaeLoading = true;
      ui.batchMessage = options.silent ? "Actualizando resultados canónicos..." : "Consultando documentos SRI autorizados...";
      ui.batchTone = "info";
      rerenderSenae(container, appState);
      const result = await senaeRepository().queryPage(filters);
      if (!isActiveView(container, "senae")) return;
      ui.senaeResult = result;
      ui.senaeSummary = result.summary;
      if (setApplied) {
        ui.senaeAppliedFilters = { ...result.filters, page: undefined };
        delete ui.senaeAppliedFilters.page;
        ui.senaeDateFrom = result.filters.dateFrom;
        ui.senaeDateTo = result.filters.dateTo;
        ui.senaeCommerceType = result.filters.commerceType;
        ui.senaePageSize = result.pageSize;
        ui.senaeFiltersDirty = false;
      }
      ui.batchMessage = result.total
        ? `${result.total} factura(s) autorizada(s) encontradas.`
        : "No existen facturas autorizadas para los filtros aplicados.";
      ui.batchTone = result.total ? "success" : "info";
    } catch (error) {
      if (!isActiveView(container, "senae")) return;
      ui.batchMessage = error.message || "No fue posible consultar Liquidación SENAE V2.";
      ui.batchTone = "warning";
      if (setApplied) {
        ui.senaeResult = null;
        ui.senaeSummary = null;
        ui.senaeAppliedFilters = null;
      }
    } finally {
      ui.senaeLoading = false;
      rerenderSenae(container, appState);
    }
  }

  async function exportSenae(container, appState) {
    if (ui.processing || !ui.senaeAppliedFilters) return;
    if (ui.senaeFiltersDirty) {
      ui.batchMessage = "Los filtros cambiaron. Consulte nuevamente antes de descargar.";
      ui.batchTone = "warning";
      rerenderSenae(container, appState);
      return;
    }
    try {
      ui.processing = true;
      ui.batchMessage = "Recuperando todo el universo consultado y preparando el XLSX...";
      ui.batchTone = "info";
      rerenderSenae(container, appState);
      const exported = await senaeRepository().exportAll(ui.senaeAppliedFilters);
      await BlessERP.moduleLoader?.loadGroup?.("commercial-senae-xlsx");
      const result = await BlessERP.reportFinancialXlsx?.exportSenae?.(ui.senaeAppliedFilters, {
        documents: exported.documents
      }) || { ok: false, message: "El exportador XLSX no está disponible." };
      if (!result.ok) throw new Error(result.message || "No fue posible generar el reporte SENAE.");
      ui.batchMessage = `Reporte generado: ${result.fileName}. ${exported.documents.length} documento(s) exportado(s) con los filtros aplicados.`;
      ui.batchTone = "success";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible generar el reporte SENAE.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerenderSenae(container, appState);
    }
  }

  function realtimeTouchesAppliedSenae(payload = {}) {
    if (!ui.senaeAppliedFilters) return false;
    const document = payload.new || payload.old || {};
    const type = String(document.document_type || "");
    if (type && type !== "01") return false;
    const issueDate = String(document.issue_date || "");
    if (issueDate && (issueDate < ui.senaeAppliedFilters.dateFrom || issueDate > ui.senaeAppliedFilters.dateTo)) return false;
    const commerce = senaeRepository().deriveSenaeCommerceType(document);
    return ui.senaeAppliedFilters.commerceType === "TODOS" || commerce === ui.senaeAppliedFilters.commerceType;
  }

  function ensureSenaeRealtime(container, appState) {
    if (senaeRealtimeStarted) return;
    senaeRealtimeStarted = true;
    senaeRepository().subscribe(payload => {
      if (!isActiveView(container, "senae") || !realtimeTouchesAppliedSenae(payload)) return;
      clearTimeout(senaeRealtimeTimer);
      senaeRealtimeTimer = setTimeout(() => {
        if (!ui.senaeResult || !ui.senaeAppliedFilters) return;
        querySenae(container, appState, {
          setApplied: false,
          silent: true,
          filters: { ...ui.senaeAppliedFilters, page: ui.senaeResult.page, pageSize: ui.senaeResult.pageSize }
        });
      }, 250);
    }).catch(error => {
      senaeRealtimeStarted = false;
      console.warn("[SENAE_V2][REALTIME]", error);
    });
  }

  function unmountSenae() {
    senaeBindController?.abort();
    senaeBindController = null;
    clearTimeout(senaeRealtimeTimer);
    senaeRealtimeTimer = null;
    if (senaeRealtimeStarted) senaeRepository().unsubscribe();
    senaeRealtimeStarted = false;
  }

  function bindSenae(container, appState) {
    senaeBindController?.abort();
    senaeBindController = new AbortController();
    const signal = senaeBindController.signal;
    const dirty = () => { ui.senaeFiltersDirty = Boolean(ui.senaeAppliedFilters); };
    container.querySelector("[data-sri-senae-date-from]")?.addEventListener("change", event => { ui.senaeDateFrom = event.target.value; dirty(); rerenderSenae(container, appState); }, { signal });
    container.querySelector("[data-sri-senae-date-to]")?.addEventListener("change", event => { ui.senaeDateTo = event.target.value; dirty(); rerenderSenae(container, appState); }, { signal });
    container.querySelector("[data-sri-senae-commerce-type]")?.addEventListener("change", event => { ui.senaeCommerceType = event.target.value; dirty(); rerenderSenae(container, appState); }, { signal });
    container.querySelector("[data-sri-query-senae]")?.addEventListener("click", () => querySenae(container, appState), { signal });
    container.querySelector("[data-sri-export-senae]")?.addEventListener("click", () => exportSenae(container, appState), { signal });
    container.querySelector("[data-sri-senae-page-size]")?.addEventListener("change", event => {
      ui.senaePageSize = Number(event.target.value || 25);
      querySenae(container, appState, { setApplied: false, filters: { ...ui.senaeAppliedFilters, page: 1, pageSize: ui.senaePageSize } });
    }, { signal });
    container.querySelectorAll("[data-sri-senae-page]").forEach(button => button.addEventListener("click", () => {
      querySenae(container, appState, { setApplied: false, filters: { ...ui.senaeAppliedFilters, page: Number(button.dataset.sriSenaePage), pageSize: ui.senaeResult?.pageSize || ui.senaePageSize } });
    }, { signal }));
    ensureSenaeRealtime(container, appState);
  }

  function rerenderFor(container, appState, viewMode = "documents") {
    if (viewMode === "credit-notes") rerenderCreditNotes(container, appState);
    else rerender(container, appState);
  }

  async function openSriDiagnostic(container, appState, rowId, viewMode = "documents") {
    const row = allRows(appState).find(item => String(item.id) === String(rowId));
    if (!row) {
      ui.batchMessage = "No se encontró el comprobante seleccionado para consultar su trazabilidad.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
      return;
    }
    ui.creditNoteDraft = null;
    ui.diagnostic = {
      row,
      detail: null,
      loading: Boolean(row.remoteDocumentId),
      error: "",
      localError: ui.processErrors.get(row.id) || null
    };
    rerenderFor(container, appState, viewMode);
    if (!row.remoteDocumentId) return;
    try {
      ui.diagnostic.detail = await BlessERP.sriApi.detail(row.remoteDocumentId);
    } catch (error) {
      ui.diagnostic.error = error.message || "No fue posible consultar el detalle del comprobante.";
    } finally {
      ui.diagnostic.loading = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  async function runSriRecoveryAction(container, appState, rowId, action, viewMode = "documents") {
    if (ui.processing) return;
    const row = allRows(appState).find(item => String(item.id) === String(rowId));
    if (!row?.remoteDocumentId) {
      ui.batchMessage = "La recuperación requiere un comprobante registrado en el backend SRI.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
      return;
    }
    ui.processing = true;
    rerenderFor(container, appState, viewMode);
    try {
      let detail;
      if (action === "QUERY_AUTHORIZATION") {
        detail = await BlessERP.sriApi.post("query-status", { documentId: row.remoteDocumentId });
      } else if (action === "RETRY_TRANSMISSION") {
        detail = await BlessERP.sriApi.post("transmit", { documentId: row.remoteDocumentId, force: true });
      } else if (action === "PREPARE_CORRECTION") {
        detail = await BlessERP.sriApi.post("prepare-correction", {
          documentId: row.remoteDocumentId,
          operationId: crypto.randomUUID()
        });
      } else {
        throw new Error("La acción de recuperación SRI no está soportada.");
      }
      const order = localOrder(appState, row.orderId);
      if (order) await syncLocalOrder(appState, order, detail);
      const remoteIndex = ui.remoteDocuments.findIndex(item => String(item.id) === String(detail?.document?.id));
      if (remoteIndex >= 0 && detail?.document) ui.remoteDocuments[remoteIndex] = detail.document;
      ui.diagnostic = {
        row: { ...row, authorizationStatus: detail?.document?.status || row.authorizationStatus },
        detail,
        loading: false,
        error: "",
        localError: null
      };
      ui.batchMessage = action === "PREPARE_CORRECTION"
        ? "La preparación de corrección quedó auditada. No se reenvió, no se regeneró la clave y no se reservó otro secuencial."
        : "La operación de recuperación SRI terminó con respuesta canónica del servidor.";
      ui.batchTone = "success";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible ejecutar la recuperación SRI.";
      ui.batchTone = "warning";
      if (ui.diagnostic) ui.diagnostic.error = ui.batchMessage;
    } finally {
      ui.processing = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  function bindSriDiagnostics(container, appState, viewMode = "documents") {
    container.querySelectorAll("[data-sri-diagnostic]").forEach(button => button.addEventListener("click", () => (
      openSriDiagnostic(container, appState, button.dataset.sriDiagnostic, viewMode)
    )));
    container.querySelectorAll("[data-sri-diagnostic-close]").forEach(button => button.addEventListener("click", () => {
      ui.diagnostic = null;
      rerenderFor(container, appState, viewMode);
    }));
    container.querySelectorAll("[data-sri-diagnostic-retry]").forEach(button => button.addEventListener("click", () => {
      const rowId = button.dataset.sriDiagnosticRetry;
      ui.diagnostic = null;
      ui.selectedIds.clear();
      ui.selectedIds.add(rowId);
      authorizeSelected(container, appState, viewMode);
    }));
    container.querySelectorAll("[data-sri-recovery-action]").forEach(button => button.addEventListener("click", () => (
      runSriRecoveryAction(
        container,
        appState,
        button.dataset.sriRecoveryRow,
        button.dataset.sriRecoveryAction,
        viewMode
      )
    )));
  }

  function openSelectedSriDiagnostic(container, appState, viewMode = "documents") {
    const selected = allRows(appState).filter(row => ui.selectedIds.has(row.id));
    if (selected.length !== 1) {
      ui.batchMessage = "Seleccione solamente un comprobante para consultar su detalle SRI.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
      return;
    }
    openSriDiagnostic(container, appState, selected[0].id, viewMode);
  }

  function activeEmissionPoint() {
    const points = currentEnvironmentPoints();
    const selectedId = ui.emissionPointIdByCompany[ui.companyKey] || "";
    return points.find(point => String(point.id) === String(selectedId)) || points[0] || null;
  }

  function emissionPointForOrder(order) {
    if (!order) return null;
    const api = BlessERP.sriApi;
    const activeCompany = api?.activeCompany?.();
    const companyReference = order.sellingCompanyId || order.selling_company_id || order.companyId || order.company_id || "";
    let orderCompany;
    try { orderCompany = companyReference ? api?.companyIdentity?.(companyReference) : null; }
    catch { return null; }
    if (!activeCompany?.companyId || activeCompany.key !== ui.companyKey || !companyReference
        || orderCompany?.key !== ui.companyKey) return null;
    return BlessERP.comercialInvoiceSequence?.resolveEmissionPoint?.(ui.configuration || {}, {
      companyId: activeCompany.companyId,
      saleType: order.saleType || order.sale_type,
      transportType: order.transportType || order.transport_type
    }) || null;
  }

  function localOrder(appState, orderId) {
    return orderId ? stateApi.getOrders(appState).find(order => String(order.id) === String(orderId)) || null : null;
  }

  function localContext(appState, order) {
    const identity = BlessERP.sriApi?.companyIdentity?.(ui.companyKey) || {};
    return {
      ...BlessERP.orderCountryCatalog?.fiscalContext?.(appState),
      order,
      customer: utils.findCustomer(order?.customerId),
      brand: utils.findBrand(order?.brandId),
      agency: utils.findAgency(order?.agencyId),
      company: {
        ...BlessERP.comercialData.company,
        commercialName: identity.commercialName || BlessERP.comercialData.company.commercialName,
        legalName: identity.legalName || BlessERP.comercialData.company.legalName,
        ruc: identity.ruc || BlessERP.comercialData.company.ruc
      },
      metrics: utils.getOrderMetrics(order || { lines: [] })
    };
  }

  function linkedRemoteDocument(order) {
    if (!order) return null;
    return ui.remoteDocuments.find(document => (
      String(document.document_type || "01") === "01"
      && (
        String(document.id) === String(order.sriRemoteDocumentId || "")
        || String(document.source_order_id || "") === String(order.id)
        || queueCore.sourceOrderNumber(document) === String(order.number || "")
      )
    )) || null;
  }

  async function syncLocalOrder(appState, order, detail) {
    if (!order || !detail) return;
    const document = detail.document || detail;
    if (String(document.document_type || "01") === "04") {
      stateApi.syncSriCreditNote?.(appState, order.id, detail);
      return;
    }
    const context = localContext(appState, order);
    if (queueCore.isLocalSale(order, context.brand)
        && String(document.status || "").toUpperCase() === "BORRADOR"
        && document.issue_date) {
      await stateApi.applyLocalSriIssueDate?.(appState, order.id, document.issue_date, {
        documentId: document.id
      });
    }
    stateApi.syncSriDocument(appState, order.id, detail);
  }

  async function openCreditNote(container, appState, documentId, viewMode = "documents") {
    try {
      ui.processing = true;
      ui.diagnostic = null;
      const detail = await BlessERP.sriApi.detail(documentId);
      const document = detail.document || {};
      if (String(document.document_type || "") !== "01" || String(document.status || "").toUpperCase() !== "AUTORIZADO") {
        throw new Error("La nota de credito solo puede crearse desde una factura SRI autorizada.");
      }
      const source = document.source_snapshot || {};
      const lineTaxes = new Map();
      (detail.taxes || []).forEach(tax => {
        if (!tax.document_line_id) return;
        const list = lineTaxes.get(String(tax.document_line_id)) || [];
        list.push({
          code: String(tax.tax_code || "2"),
          percentageCode: String(tax.percentage_code || "0"),
          rate: Number(tax.rate || 0)
        });
        lineTaxes.set(String(tax.document_line_id), list);
      });
      const linkedRow = allRows(appState).find(row => String(row.remoteDocumentId) === String(document.id));
      ui.creditNoteDraft = {
        originalDocumentId: document.id,
        orderId: linkedRow?.orderId || source.originalOrderId || source.erpEmission?.sourceOrderId || "",
        emissionPointId: document.emission_point_id || "",
        fullNumber: document.full_number || "",
        issueDate: document.issue_date || "",
        customer: document.buyer_snapshot?.legalName || document.buyer_snapshot?.razonSocial || "Cliente",
        buyer: document.buyer_snapshot || {},
        currency: document.currency || "USD",
        grandTotal: Number(document.grand_total || 0),
        creditedTotal: Number(document.credited_total || 0),
        reason: "",
        source,
        lines: (detail.lines || []).map(line => ({
          originalLineId: line.id,
          sourceLineId: line.source_line_id || "",
          mainCode: line.main_code || "",
          auxiliaryCode: line.auxiliary_code || "",
          description: line.description || "Flores",
          variety: line.variety || "",
          measure: line.measure || "",
          unit: line.unit || "RAMO",
          quantity: Number(line.quantity || 0),
          affectedQuantity: 0,
          unitPrice: Number(line.unit_price || 0),
          discount: Number(line.discount || 0),
          additionalDetails: line.additional_details || {},
          taxes: lineTaxes.get(String(line.id)) || [{ code: "2", percentageCode: "0", rate: 0 }]
        }))
      };
      ui.batchMessage = "";
      ui.batchTone = "info";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible cargar la factura para la nota de credito.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  async function openAnnulment(container, appState, documentId) {
    if (ui.processing) return;
    try {
      ui.processing = true;
      ui.creditNoteDraft = null;
      ui.diagnostic = null;
      const detail = await BlessERP.sriApi.detail(documentId);
      const document = detail.document || {};
      if (String(document.document_type || "") !== "01" || String(document.status || "").toUpperCase() !== "AUTORIZADO") {
        throw new Error("Solo una factura SRI canónica en estado AUTORIZADO puede registrar una anulación.");
      }
      ui.annulmentDraft = {
        documentId: document.id,
        operationId: crypto.randomUUID(),
        fullNumber: document.full_number || "",
        accessKey: document.access_key || "",
        annulmentDate: ecuadorToday(),
        reason: "",
        evidenceReference: ""
      };
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible preparar el registro de anulación.";
      ui.batchTone = "warning";
      ui.annulmentDraft = null;
    } finally {
      ui.processing = false;
      rerender(container, appState);
    }
  }

  async function registerAnnulment(container, appState) {
    const draft = ui.annulmentDraft;
    if (!draft || ui.processing) return;
    const reason = String(draft.reason || "").trim();
    if (!draft.annulmentDate || reason.length < 3) {
      ui.batchMessage = "Ingrese la fecha y un motivo válido para registrar la anulación.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    if (!window.confirm(`Confirma que la factura ${draft.fullNumber} ya fue anulada previamente en el portal SRI? Esta operación solo registrará AUTORIZADO → ANULADO en el ERP.`)) return;
    try {
      ui.processing = true;
      rerender(container, appState);
      const detail = await BlessERP.sriApi.post("register-annulment", {
        documentId: draft.documentId,
        operationId: draft.operationId,
        annulmentDate: draft.annulmentDate,
        reason,
        accessKey: draft.accessKey,
        evidenceReference: String(draft.evidenceReference || "").trim()
      });
      const remoteIndex = ui.remoteDocuments.findIndex(item => String(item.id) === String(detail?.document?.id));
      if (remoteIndex >= 0 && detail?.document) ui.remoteDocuments[remoteIndex] = detail.document;
      ui.annulmentDraft = null;
      ui.selectedIds.delete(`sri:${draft.documentId}`);
      ui.batchMessage = "Anulación registrada y auditada. Los artefactos fiscales y el secuencial se conservaron intactos.";
      ui.batchTone = "success";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible registrar la anulación SRI.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerender(container, appState);
    }
  }

  function creditNotePayload(draft) {
    const selected = (draft.lines || []).filter(line => Number(line.affectedQuantity || 0) > 0);
    if (!selected.length) throw new Error("Seleccione al menos una variedad o cantidad para dar de baja.");
    const reason = String(draft.reason || "").trim();
    if (!reason) throw new Error("Ingrese el motivo de la nota de credito.");
    const lines = selected.map(line => {
      const quantity = Number(line.affectedQuantity || 0);
      if (quantity > Number(line.quantity || 0)) throw new Error(`La cantidad de ${line.variety || line.description} supera lo facturado.`);
      const subtotal = Number((quantity * Number(line.unitPrice || 0)).toFixed(6));
      const taxes = (line.taxes || []).map(tax => ({
        code: tax.code,
        percentageCode: tax.percentageCode,
        rate: Number(tax.rate || 0),
        taxableBase: subtotal,
        value: Number((subtotal * Number(tax.rate || 0) / 100).toFixed(6))
      }));
      return {
        sourceLineId: line.sourceLineId || null,
        mainCode: line.mainCode || "FLOR",
        auxiliaryCode: line.auxiliaryCode || "",
        description: line.description,
        variety: line.variety,
        measure: line.measure,
        unit: line.unit,
        quantity,
        affectedQuantity: quantity,
        affectedAmount: subtotal,
        unitPrice: Number(line.unitPrice || 0),
        discount: 0,
        subtotal,
        additionalDetails: line.additionalDetails || {},
        taxes
      };
    });
    const taxMap = new Map();
    lines.forEach(line => line.taxes.forEach(tax => {
      const key = `${tax.code}|${tax.percentageCode}|${tax.rate}`;
      const current = taxMap.get(key) || { ...tax, taxableBase: 0, value: 0 };
      current.taxableBase += Number(tax.taxableBase || 0);
      current.value += Number(tax.value || 0);
      taxMap.set(key, current);
    }));
    const totalWithoutTax = lines.reduce((sum, line) => sum + Number(line.subtotal || 0), 0);
    const taxes = [...taxMap.values()].map(tax => ({
      ...tax,
      taxableBase: Number(tax.taxableBase.toFixed(6)),
      value: Number(tax.value.toFixed(6))
    }));
    const taxTotal = taxes.reduce((sum, tax) => sum + tax.value, 0);
    const modificationValue = Number((totalWithoutTax + taxTotal).toFixed(6));
    const remaining = Math.max(0, Number(draft.grandTotal || 0) - Number(draft.creditedTotal || 0));
    if (modificationValue > remaining + 0.000001) throw new Error("El valor de la nota de credito supera el saldo disponible de la factura.");
    return {
      buyer: draft.buyer,
      creditNote: {
        currency: draft.currency || "USD",
        totalWithoutTax: Number(totalWithoutTax.toFixed(6)),
        modificationValue,
        reason
      },
      lines,
      taxes,
      originalInvoice: {
        id: draft.originalDocumentId,
        status: "AUTORIZADO",
        fullNumber: draft.fullNumber,
        issueDate: draft.issueDate,
        grandTotal: Number(draft.grandTotal || 0),
        creditedTotal: Number(draft.creditedTotal || 0)
      },
      originalOrderId: draft.orderId || "",
      erpEmission: {
        sourceType: "CREDIT_NOTE",
        sourceOrderId: draft.orderId || "",
        sourceOrderNumber: draft.source?.erpEmission?.sourceOrderNumber || draft.source?.orderNumber || ""
      },
      additionalInformation: BlessERP.softwareProvider?.mergeAdditionalInformation?.({}) || {}
    };
  }

  async function createCreditNoteDraft(container, appState, viewMode = "documents") {
    const draft = ui.creditNoteDraft;
    if (!draft || ui.processing) return;
    try {
      const payload = creditNotePayload(draft);
      if (!window.confirm(`Se creara un borrador de nota de credito por ${utils.money(payload.creditNote.modificationValue)}. Todavia no se firmara ni enviara al SRI. Deseas continuar?`)) return;
      ui.processing = true;
      rerenderFor(container, appState, viewMode);
      const detail = await BlessERP.sriApi.post("create-draft", {
        documentType: "04",
        emissionPointId: draft.emissionPointId,
        issueDate: ecuadorToday(),
        sourceOrderDate: draft.issueDate,
        parentDocumentId: draft.originalDocumentId,
        sourcePayload: payload
      });
      const order = localOrder(appState, draft.orderId);
      await syncLocalOrder(appState, order, detail);
      ui.creditNoteDraft = null;
      const issueRange = viewMode === "documents" ? selectedIssueMonthRange() : null;
      ui.remoteDocuments = await listCommercialSriDocuments(issueRange ? { from: issueRange.from, to: issueRange.to, limit: 200 } : { limit: 200 });
      ui.batchMessage = "Borrador de nota de credito creado. Revise las variedades y cantidades; luego seleccionelo para procesarlo en SRI.";
      ui.batchTone = "success";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible crear la nota de credito.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  async function syncAuthorizedRemoteDocuments(appState) {
    const candidates = remoteRows(appState).filter(row => {
      if (row.authorizationStatus !== "AUTORIZADO" || !row.orderId) return false;
      const order = localOrder(appState, row.orderId);
      if (!order) return false;
      if (row.documentType === "04") {
        return !(order.sriCreditNotes || []).some(note => String(note.remoteDocumentId || "") === String(row.remoteDocumentId));
      }
      return String(order.sriAuthorizationStatus || "").toUpperCase() !== "AUTORIZADO" || !order.receivableId;
    });
    const queue = [...candidates];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        try {
          const detail = await BlessERP.sriApi.detail(row.remoteDocumentId);
          await syncLocalOrder(appState, localOrder(appState, row.orderId), detail);
        } catch {
          // La bandeja debe seguir disponible aunque un documento antiguo no pueda resincronizarse.
        }
      }
      });
    await Promise.all(workers);
  }

  async function processRow(appState, row, emissionPoint) {
    const api = BlessERP.sriApi;
    const order = localOrder(appState, row.orderId);
    const linked = row.remoteDocumentId
      ? ui.remoteDocuments.find(document => String(document.id) === String(row.remoteDocumentId))
      : linkedRemoteDocument(order);
    const remoteDocumentId = row.remoteDocumentId || linked?.id || order?.sriRemoteDocumentId || "";
    let detail = remoteDocumentId ? await api.detail(remoteDocumentId) : null;

    if (!detail) {
    if (!order) throw new Error("No se encontro el pedido relacionado en Crear pedido.");
      if (queueCore.isExportOrder(order)) await BlessERP.orderCountryCatalog.loadFiscal(appState);
      const context = localContext(appState, order);
      const sourceOrderDate = sourceOrderIssueDate(order);
      const emissionOrder = orderForSriEmission(order, context.brand);
      const issueDate = effectiveSriIssueDate(order, context.brand);
      const result = queueCore.buildInvoicePayload({ ...context, order: emissionOrder, today: ecuadorToday() });
      if (!result.ok) throw new Error(result.errors.join(" "));
      result.payload.erpEmission.sourceOrderId = order.id;
      result.payload.erpEmission.sourceOrderDate = sourceOrderDate;
      detail = await api.post("create-draft", {
        documentType: "01",
        emissionPointId: emissionPoint.id,
        sourceOrderId: order.id,
        customerId: order.customerId,
        issueDate,
        sourceOrderDate,
        sourcePayload: result.payload
      });
      await syncLocalOrder(appState, order, detail);
    }

    for (let stage = 0; stage < 4; stage += 1) {
      const document = detail?.document || detail;
      const action = queueCore.nextAction(document?.status, true);
      if (!action || action === "create-draft") break;
      detail = await api.post(action, { documentId: document.id });
      await syncLocalOrder(appState, order, detail);
      if (action === "transmit") break;
    }
    return detail;
  }

  async function authorizeSelected(container, appState, viewMode = "documents") {
    const api = BlessERP.sriApi;
    const selected = allRows(appState).filter(row => ui.selectedIds.has(row.id) && row.processable);
    if (ui.processing) return;
    if (!selected.length) {
      ui.batchMessage = "Los documentos seleccionados no tienen procesos SRI pendientes. Para los autorizados use Descargar XML o Descargar RIDE.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
      return;
    }
    if (!api?.status?.().ready) {
      ui.batchMessage = "No se inicio la autorizacion. Se requiere conexion y una sesion autenticada en el backend SRI.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
      return;
    }

    try {
      if (!ui.configuration) ui.configuration = await api.configuration();
      const readiness = technicalReadiness();
      const existingDocumentId = row => row.remoteDocumentId || localOrder(appState, row.orderId)?.sriRemoteDocumentId
        || linkedRemoteDocument(localOrder(appState, row.orderId))?.id;
      // The backend validates historical documents against their persisted environment.
      const createsDocument = selected.some(row => !existingDocumentId(row));
      if (createsDocument && !readiness.readyForXml) throw new Error((readiness.blockers || []).join(" ") || "La configuracion XML/XSD esta incompleta.");
      if (createsDocument && !readiness.readyForSignature) throw new Error((readiness.signatureBlockers || []).join(" ") || "Falta un certificado P12/PFX activo.");
      const missingPoint = selected.find(row => {
        const order = localOrder(appState, row.orderId);
        return order && !existingDocumentId(row) && !emissionPointForOrder(order);
      });
      if (missingPoint) {
        const order = localOrder(appState, missingPoint.orderId);
        const expected = BlessERP.comercialInvoiceSequence?.saleSeries?.(
          order?.sellingCompanyId || order?.companyId,
          order?.saleType || order?.sale_type,
          order?.transportType || order?.transport_type
        ) || {};
        throw new Error(`No existe el punto de emision ${expected.establishment || "001"}-${expected.emissionPoint || "001"} activo en ${selectedEnvironmentLabel()} para ${order?.number || "el pedido"}.`);
      }

      if (selected.some(row => {
        const order = localOrder(appState, row.orderId);
        return order && !existingDocumentId(row) && queueCore.isExportOrder(order);
      })) await BlessERP.orderCountryCatalog.loadFiscal(appState);
      const invalid = selected.flatMap(row => {
        const order = localOrder(appState, row.orderId);
        if (!order || row.sourceType === "remote" || existingDocumentId(row)) return [];
        const context = localContext(appState, order);
        const emissionOrder = orderForSriEmission(order, context.brand);
        const errors = queueCore.validateOrder({ ...context, order: emissionOrder, today: ecuadorToday() });
        return errors.length ? [`${order.number}: ${errors[0]}`] : [];
      });
      if (invalid.length) throw new Error(`Corrija los pedidos antes de emitir. ${invalid.join(" ")}`);
      const company = api.activeCompany?.() || {};
      const environments = [...new Set(selected.map(row => {
        const documentId = existingDocumentId(row);
        const document = ui.remoteDocuments.find(item => String(item.id) === String(documentId));
        if (documentId && !document) throw new Error("Actualice la bandeja para verificar el ambiente del comprobante existente.");
        return api.environmentDefinition(document ? document.environment : ui.configuration.settings.environment).label;
      }))];
      if (!window.confirm(`Se procesaran ${selected.length} comprobante(s) de ${company.commercialName || "la empresa"}. Ambiente SRI: ${environments.join(" / ")}. Cada documento conserva su ambiente. Deseas continuar?`)) return;

      ui.processing = true;
      ui.error = "";
      ui.batchMessage = `Procesando 0 de ${selected.length} comprobantes...`;
      ui.batchTone = "info";
      rerenderFor(container, appState, viewMode);

      const results = [];
      for (let index = 0; index < selected.length; index += 1) {
        const row = selected[index];
        ui.batchMessage = `Procesando ${index + 1} de ${selected.length}: ${row.documentNumber || row.orderNumber}.`;
        rerenderFor(container, appState, viewMode);
        try {
          const order = localOrder(appState, row.orderId);
          const emissionPoint = order ? emissionPointForOrder(order) : activeEmissionPoint();
          if (!existingDocumentId(row) && !emissionPoint) throw new Error("No existe un punto de emision SRI activo para el ambiente seleccionado.");
          const detail = await processRow(appState, row, emissionPoint);
          const document = detail?.document || detail || {};
          ui.processErrors.delete(row.id);
          results.push({ ok: true, status: String(document.status || "PROCESADO").toUpperCase() });
        } catch (error) {
          const message = error.message || "Error SRI";
          ui.processErrors.set(row.id, {
            message,
            stage: "PROCESSING",
            createdAt: new Date().toISOString()
          });
          results.push({ ok: false, status: "ERROR", message });
        }
      }

      try {
        const issueRange = selectedIssueMonthRange();
        const documents = await listCommercialSriDocuments(issueRange ? { from: issueRange.from, to: issueRange.to, limit: 200 } : { limit: 200 });
        ui.remoteDocuments = Array.isArray(documents) ? documents : [];
      } catch (error) {
        ui.error = error.message || "El lote termino, pero no se pudo actualizar la bandeja.";
      }
      const authorized = results.filter(result => result.status === "AUTORIZADO").length;
      const failed = results.filter(result => !result.ok).length;
      const pending = results.length - authorized - failed;
      const firstFailure = results.find(result => !result.ok);
      ui.batchMessage = `Lote finalizado: ${authorized} autorizado(s), ${pending} con estado pendiente o devuelto y ${failed} con error.${firstFailure?.message ? ` Primer error: ${firstFailure.message}` : ""}`;
      ui.batchTone = failed || pending ? "warning" : "success";
      ui.selectedIds.clear();
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible iniciar la autorizacion por lote.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  async function refresh(container, appState, viewMode = "documents") {
    const api = BlessERP.sriApi;
    const issueRange = viewMode === "documents" ? selectedIssueMonthRange() : null;
    if (viewMode === "documents" && !issueRange) {
      ui.remoteDocuments = [];
      ui.selectedIds.clear();
      ui.loaded = false;
      ui.loading = false;
      rerenderFor(container, appState, viewMode);
      return;
    }
    if (!api?.status?.().ready) {
      ui.loaded = true;
      ui.error = "La bandeja muestra los pedidos locales. Active Supabase, autenticacion y SRI para consultar documentos emitidos.";
      rerenderFor(container, appState, viewMode);
      return;
    }
    ui.loading = true;
    ui.error = "";
    rerenderFor(container, appState, viewMode);
    try {
      const [documents, configuration] = await Promise.all([
        listCommercialSriDocuments(issueRange ? { from: issueRange.from, to: issueRange.to, limit: 200 } : { limit: 200 }),
        ui.configuration ? Promise.resolve(ui.configuration) : api.configuration()
      ]);
      ui.remoteDocuments = Array.isArray(documents) ? documents : [];
      ui.configuration = configuration || null;
      await syncAuthorizedRemoteDocuments(appState);
      ui.loaded = true;
    } catch (error) {
      ui.error = error.message || "No fue posible actualizar la bandeja SRI.";
    } finally {
      ui.loading = false;
      rerenderFor(container, appState, viewMode);
    }
  }

  async function createIntercompanyDraft(container, appState, invoiceId) {
    const api = BlessERP.sriApi;
    if (ui.companyKey !== "BLESS_FLOWER") {
      ui.batchMessage = "La factura intercompany debe ser emitida por Bless Flower.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    if (!api?.status?.().ready) {
      ui.batchMessage = "Se requiere conexion y una sesion autenticada en el backend SRI para crear el borrador remoto.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    try {
      ui.processing = true;
      if (!ui.configuration) ui.configuration = await api.configuration();
      const emissionPoint = activeEmissionPoint();
      if (!emissionPoint) throw new Error("No existe un establecimiento y punto de emision activo en el ambiente seleccionado para Bless Flower.");
      const draft = BlessERP.comercialIntercompany?.refreshSriDraft?.(appState, invoiceId);
      if (!draft?.ok) throw new Error((draft?.errors || ["No se pudo preparar el borrador."]).join(" "));
      if (!window.confirm("Se creará únicamente el BORRADOR SRI de la factura semanal Bless → Imperio. Todavía no se firmará ni enviará. ¿Continuar?")) return;
      const invoice = draft.invoice;
      const detail = await api.post("create-draft", {
        documentType: "01",
        emissionPointId: emissionPoint.id,
        issueDate: invoice.issueDate,
        sourceOrderDate: invoice.issueDate,
        sourcePayload: draft.payload
      });
      BlessERP.comercialIntercompany.syncSriInvoice(appState, invoiceId, detail);
      const issueRange = selectedIssueMonthRange();
      const documents = await listCommercialSriDocuments(issueRange ? { from: issueRange.from, to: issueRange.to, limit: 200 } : { limit: 200 });
      ui.remoteDocuments = Array.isArray(documents) ? documents : [];
      ui.batchMessage = "Borrador SRI intercompany creado. Revíselo antes de seleccionarlo para generar XML, firmar y transmitir.";
      ui.batchTone = "success";
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible crear el borrador SRI intercompany.";
      ui.batchTone = "warning";
    } finally {
      ui.processing = false;
      rerender(container, appState);
    }
  }

  async function downloadArtifact(container, appState, documentId, fileType, viewMode = "documents") {
    const api = BlessERP.sriApi;
    const labels = { AUTHORIZED_XML: "XML autorizado", RIDE_PDF: "PDF RIDE" };
    try {
      const detail = await api.detail(documentId);
      const file = (detail.files || []).find(item => item.file_type === fileType);
      if (!file) throw new Error(`El ${labels[fileType] || "archivo"} todavía no fue generado.`);
      const fileName = await api.download(file.id);
      BlessERP.layout.toast(`Descarga iniciada: ${fileName}`);
    } catch (error) {
      ui.batchMessage = error.message || "No fue posible descargar el archivo SRI.";
      ui.batchTone = "warning";
      rerenderFor(container, appState, viewMode);
    }
  }

  async function ensureSriPrintGroup() {
    await BlessERP.moduleLoader.loadGroup("commercial-sri-print");
  }

  async function downloadLocalXml(container, appState, orderId) {
    try {
      await ensureSriPrintGroup();
    } catch (error) {
      ui.batchMessage = error?.message || "No se pudo preparar la descarga del XML.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    const order = localOrder(appState, orderId);
    const result = BlessERP.comercialSriDocuments?.downloadXml?.(order, appState);
    if (!result?.ok) {
      ui.batchMessage = result?.errors?.[0] || "No fue posible descargar el XML autorizado.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    BlessERP.layout.toast(`XML autorizado descargado: ${result.fileName}`);
  }

  async function downloadLocalRide(container, appState, orderId) {
    try {
      await ensureSriPrintGroup();
    } catch (error) {
      ui.batchMessage = error?.message || "No se pudo preparar el PDF RIDE.";
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }
    const order = localOrder(appState, orderId);
    const opened = BlessERP.comercialPrintSystem?.openDocuments?.("SRI_RIDE", [order], appState, {
      autoPrint: true,
      saveAsPdf: true,
      pageSize: "A4"
    });
    if (!opened) {
      ui.batchMessage = "Revise los datos de autorización antes de generar el PDF RIDE.";
      ui.batchTone = "warning";
      rerender(container, appState);
    }
  }

  async function downloadSelectedArtifacts(container, appState, fileType) {
    if (ui.processing) return;
    const labels = { AUTHORIZED_XML: "XML", RIDE_PDF: "RIDE" };
    const selected = allRows(appState).filter(row => (
      ui.selectedIds.has(row.id)
      && row.authorizationStatus === "AUTORIZADO"
    ));
    if (!selected.length) {
      ui.batchMessage = `Seleccione al menos un documento autorizado para descargar ${labels[fileType] || "el archivo"}.`;
      ui.batchTone = "warning";
      rerender(container, appState);
      return;
    }

    ui.processing = true;
    ui.batchMessage = `Preparando ${labels[fileType] || "archivos"} de ${selected.length} documento(s)...`;
    ui.batchTone = "info";
    rerender(container, appState);
    const failedIds = new Set();
    const localRideOrders = [];
    let downloaded = 0;
    const errors = [];

    if (selected.some(row => row.sourceType !== "remote")) {
      try {
        await ensureSriPrintGroup();
      } catch (error) {
        ui.processing = false;
        ui.batchMessage = error?.message || "No se pudieron preparar los documentos locales.";
        ui.batchTone = "warning";
        rerender(container, appState);
        return;
      }
    }

    for (const row of selected) {
      try {
        if (row.sourceType === "remote" && row.remoteDocumentId) {
          const detail = await BlessERP.sriApi.detail(row.remoteDocumentId);
          const file = (detail.files || []).find(item => item.file_type === fileType);
          if (!file) throw new Error(`El ${labels[fileType] || "archivo"} de la factura ${invoiceLastNine(row.documentNumber, row.accessKey)} todavía no fue generado.`);
          await BlessERP.sriApi.download(file.id);
          downloaded += 1;
          continue;
        }
        const order = localOrder(appState, row.orderId);
        if (!order) throw new Error(`No se encontró el pedido relacionado con la factura ${invoiceLastNine(row.documentNumber, row.accessKey)}.`);
        if (fileType === "AUTHORIZED_XML") {
          const result = BlessERP.comercialSriDocuments?.downloadXml?.(order, appState);
          if (!result?.ok) throw new Error(result?.errors?.[0] || "El XML autorizado no está disponible.");
          downloaded += 1;
        } else {
          localRideOrders.push(order);
        }
      } catch (error) {
        failedIds.add(row.id);
        errors.push(error.message || "No fue posible descargar un archivo.");
      }
    }

    if (fileType === "RIDE_PDF" && localRideOrders.length) {
      const opened = BlessERP.comercialPrintSystem?.openDocuments?.("SRI_RIDE", localRideOrders, appState, {
        autoPrint: true,
        saveAsPdf: true,
        pageSize: "A4"
      });
      if (opened) downloaded += localRideOrders.length;
      else {
        localRideOrders.forEach(order => failedIds.add(`order:${order.id}`));
        errors.push("No se pudo abrir el PDF RIDE local. Revise los datos de autorización.");
      }
    }

    selected.forEach(row => {
      if (!failedIds.has(row.id)) ui.selectedIds.delete(row.id);
    });
    ui.processing = false;
    ui.batchMessage = errors.length
      ? `${downloaded} archivo(s) preparados y ${errors.length} con error. ${errors[0]}`
      : `${downloaded} ${labels[fileType] || "archivo(s)"} preparado(s) correctamente.`;
    ui.batchTone = errors.length ? "warning" : "success";
    rerender(container, appState);
  }

  function bindCreditNotes(container, appState) {
    syncWorkspaceCompany(appState);
    bindSriDiagnostics(container, appState, "credit-notes");
    container.querySelector("[data-credit-search]")?.addEventListener("input", event => {
      window.clearTimeout(creditSearchTimer);
      const value = event.currentTarget.value;
      creditSearchTimer = window.setTimeout(() => {
        ui.creditSearch = value;
        BlessERP.performance?.resetPage?.("commercial-credit-invoices");
        BlessERP.performance?.resetPage?.("commercial-credit-notes");
        rerenderCreditNotes(container, appState);
        const search = container.querySelector("[data-credit-search]");
        search?.focus();
        search?.setSelectionRange(ui.creditSearch.length, ui.creditSearch.length);
      }, 180);
    });
    container.querySelector("[data-credit-status]")?.addEventListener("change", event => {
      ui.creditStatus = event.currentTarget.value;
      BlessERP.performance?.resetPage?.("commercial-credit-notes");
      rerenderCreditNotes(container, appState);
    });
    container.querySelector("[data-credit-refresh]")?.addEventListener("click", () => (
      refresh(container, appState, "credit-notes")
    ));
    container.querySelectorAll("[data-credit-create]").forEach(button => button.addEventListener("click", () => (
      openCreditNote(container, appState, button.dataset.creditCreate, "credit-notes")
    )));
    container.querySelectorAll("[data-credit-process]").forEach(button => button.addEventListener("click", () => {
      ui.selectedIds.clear();
      ui.selectedIds.add(button.dataset.creditProcess);
      authorizeSelected(container, appState, "credit-notes");
    }));
    container.querySelectorAll("[data-credit-download]").forEach(button => button.addEventListener("click", () => (
      downloadArtifact(
        container,
        appState,
        button.dataset.creditDownload,
        button.dataset.creditFileType,
        "credit-notes"
      )
    )));
    container.querySelector("[data-sri-credit-note-close]")?.addEventListener("click", () => {
      ui.creditNoteDraft = null;
      rerenderCreditNotes(container, appState);
    });
    container.querySelector("[data-sri-credit-note-reason]")?.addEventListener("input", event => {
      if (ui.creditNoteDraft) ui.creditNoteDraft.reason = event.target.value;
    });
    container.querySelectorAll("[data-sri-credit-note-quantity]").forEach(input => input.addEventListener("change", event => {
      const line = ui.creditNoteDraft?.lines?.[Number(event.currentTarget.dataset.sriCreditNoteQuantity)];
      if (!line) return;
      line.affectedQuantity = Math.max(0, Math.min(Number(line.quantity || 0), Number(event.currentTarget.value || 0)));
      rerenderCreditNotes(container, appState);
    }));
    container.querySelector("[data-sri-credit-note-full]")?.addEventListener("click", () => {
      (ui.creditNoteDraft?.lines || []).forEach(line => { line.affectedQuantity = Number(line.quantity || 0); });
      rerenderCreditNotes(container, appState);
    });
    container.querySelector("[data-sri-credit-note-save]")?.addEventListener("click", () => (
      createCreditNoteDraft(container, appState, "credit-notes")
    ));
    if (!ui.loaded && !ui.loading) refresh(container, appState, "credit-notes");
  }

  function refreshSelectionUi(container, appState) {
    const sourceRows = allRows(appState);
    const selectedRows = sourceRows.filter(row => ui.selectedIds.has(row.id));
    const selectedCount = selectedRows.length;
    const processable = selectedRows.filter(row => row.processable).length;
    const authorized = selectedRows.filter(row => row.authorizationStatus === "AUTORIZADO").length;
    const visibleFields = [...container.querySelectorAll("[data-sri-row-select]")];
    visibleFields.forEach(field => {
      field.checked = ui.selectedIds.has(field.dataset.sriRowSelect);
      field.closest("tr")?.classList.toggle("is-selected", field.checked);
    });
    const selectable = visibleFields.filter(field => !field.disabled);
    const visibleCheck = container.querySelector("[data-sri-select-visible-check]");
    if (visibleCheck) {
      const checked = selectable.filter(field => field.checked).length;
      visibleCheck.checked = Boolean(selectable.length && checked === selectable.length);
      visibleCheck.indeterminate = checked > 0 && checked < selectable.length;
    }
    const counter = container.querySelector("[data-sri-selection-count]");
    if (counter) counter.textContent = `${selectedCount} seleccionados`;
    const authorize = container.querySelector("[data-sri-authorize-selected]");
    if (authorize) {
      authorize.disabled = !processable || ui.processing;
      authorize.textContent = ui.processing ? "Procesando..." : `Procesar pendientes (${processable})`;
    }
    container.querySelectorAll("[data-sri-download-selected]").forEach(button => {
      button.disabled = !authorized || ui.processing;
      button.textContent = `${button.dataset.sriDownloadSelected === "RIDE_PDF" ? "Descargar RIDE" : "Descargar XML"} (${authorized})`;
    });
    const detail = container.querySelector("[data-sri-view-selected]");
    if (detail) detail.disabled = selectedCount !== 1 || ui.processing;
    const clear = container.querySelector("[data-sri-clear-selection]");
    if (clear) clear.disabled = !selectedCount || ui.processing;
  }

  function bind(container, appState) {
    syncWorkspaceCompany(appState);
    bindSriDiagnostics(container, appState);
    container.querySelector("[data-sri-issue-year]")?.addEventListener("change", event => {
      const year = Math.max(2000, Math.min(2100, Number(event.currentTarget.value || new Date().getFullYear())));
      ui.issueYear = String(year);
      ui.issueMonth = "";
      ui.remoteDocuments = [];
      ui.selectedIds.clear();
      ui.loaded = false;
      BlessERP.performance?.resetPage?.("commercial-sri-documents");
      rerender(container, appState);
    });
    container.querySelectorAll("[data-sri-issue-month]").forEach(button => button.addEventListener("click", () => {
      ui.issueMonth = String(button.dataset.sriIssueMonth || "");
      ui.remoteDocuments = [];
      ui.selectedIds.clear();
      ui.loaded = false;
      ui.error = "";
      BlessERP.performance?.resetPage?.("commercial-sri-documents");
      rerender(container, appState);
    }));
    container.querySelector("[data-sri-emission-point]")?.addEventListener("change", event => {
      ui.emissionPointIdByCompany[ui.companyKey] = event.currentTarget.value;
      ui.batchMessage = "Establecimiento y punto de emision seleccionados para la empresa activa.";
      ui.batchTone = "success";
      rerender(container, appState);
    });
    container.querySelectorAll("[data-sri-logistics-field]").forEach(input => input.addEventListener("change", event => {
      const result = stateApi.updateSriLogistics(
        appState,
        event.currentTarget.dataset.sriOrderId,
        event.currentTarget.dataset.sriLogisticsField,
        event.currentTarget.value
      );
      ui.batchMessage = result?.message || "No fue posible actualizar el dato logistico.";
      ui.batchTone = result?.ok ? "success" : "warning";
      rerender(container, appState);
    }));
    container.querySelector("[data-sri-list-search]")?.addEventListener("input", event => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => {
        ui.search = value;
        BlessERP.performance?.resetPage?.("commercial-sri-documents");
        rerender(container, appState);
        const search = container.querySelector("[data-sri-list-search]");
        search?.focus();
        search?.setSelectionRange(ui.search.length, ui.search.length);
      }, 180);
    });
    container.querySelector("[data-sri-list-status]")?.addEventListener("change", event => { ui.status = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-document-type]")?.addEventListener("change", event => { ui.documentType = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-sales-scope]")?.addEventListener("change", event => { ui.salesScope = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-transport]")?.addEventListener("change", event => { ui.transportScope = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-dae]")?.addEventListener("change", event => { ui.daeScope = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-date-from]")?.addEventListener("change", event => { ui.dateFrom = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-date-to]")?.addEventListener("change", event => { ui.dateTo = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-sort]")?.addEventListener("change", event => { ui.sortMode = event.target.value; BlessERP.performance?.resetPage?.("commercial-sri-documents"); rerender(container, appState); });
    container.querySelector("[data-sri-list-clear]")?.addEventListener("click", () => {
      window.clearTimeout(searchTimer);
      resetDocumentListFilters();
      BlessERP.performance?.resetPage?.("commercial-sri-documents");
      rerender(container, appState);
    });
    container.querySelector("[data-sri-list-refresh]")?.addEventListener("click", () => refresh(container, appState));
    container.querySelector("[data-sri-senae-date-from]")?.addEventListener("change", event => { ui.senaeDateFrom = event.target.value; });
    container.querySelector("[data-sri-senae-date-to]")?.addEventListener("change", event => { ui.senaeDateTo = event.target.value; });
    container.querySelectorAll("[data-sri-row-select]").forEach(input => input.addEventListener("change", event => {
      const id = event.currentTarget.dataset.sriRowSelect;
      if (event.currentTarget.checked) ui.selectedIds.add(id);
      else ui.selectedIds.delete(id);
      refreshSelectionUi(container, appState);
    }));
    const selectVisible = () => {
      container.querySelectorAll("[data-sri-row-select]:not(:disabled)").forEach(field => ui.selectedIds.add(field.dataset.sriRowSelect));
      refreshSelectionUi(container, appState);
    };
    container.querySelector("[data-sri-select-visible]")?.addEventListener("click", selectVisible);
    container.querySelector("[data-sri-select-visible-check]")?.addEventListener("change", event => {
      container.querySelectorAll("[data-sri-row-select]:not(:disabled)").forEach(field => {
        if (event.currentTarget.checked) ui.selectedIds.add(field.dataset.sriRowSelect);
        else ui.selectedIds.delete(field.dataset.sriRowSelect);
      });
      refreshSelectionUi(container, appState);
    });
    container.querySelector("[data-sri-clear-selection]")?.addEventListener("click", () => {
      ui.selectedIds.clear();
      refreshSelectionUi(container, appState);
    });
    container.querySelector("[data-sri-authorize-selected]")?.addEventListener("click", () => authorizeSelected(container, appState));
    container.querySelector("[data-sri-view-selected]")?.addEventListener("click", () => openSelectedSriDiagnostic(container, appState));
    container.querySelectorAll("[data-sri-download-selected]").forEach(button => button.addEventListener("click", () => (
      downloadSelectedArtifacts(container, appState, button.dataset.sriDownloadSelected)
    )));
    container.querySelectorAll("[data-sri-create-intercompany-draft]").forEach(button => button.addEventListener("click", () => (
      createIntercompanyDraft(container, appState, button.dataset.sriCreateIntercompanyDraft)
    )));
    container.querySelectorAll("[data-sri-download-artifact]").forEach(button => button.addEventListener("click", () => (
      downloadArtifact(
        container,
        appState,
        button.dataset.sriDownloadArtifact,
        button.dataset.sriArtifactType
      )
    )));
    container.querySelectorAll("[data-sri-local-xml]").forEach(button => button.addEventListener("click", () => (
      downloadLocalXml(container, appState, button.dataset.sriLocalXml)
    )));
    container.querySelectorAll("[data-sri-local-pdf]").forEach(button => button.addEventListener("click", () => (
      downloadLocalRide(container, appState, button.dataset.sriLocalPdf)
    )));
    container.querySelectorAll("[data-sri-create-credit-note]").forEach(button => button.addEventListener("click", () => (
      openCreditNote(container, appState, button.dataset.sriCreateCreditNote)
    )));
    container.querySelectorAll("[data-sri-register-annulment]").forEach(button => button.addEventListener("click", () => (
      openAnnulment(container, appState, button.dataset.sriRegisterAnnulment)
    )));
    container.querySelectorAll("[data-sri-annulment-close]").forEach(button => button.addEventListener("click", () => {
      ui.annulmentDraft = null;
      rerender(container, appState);
    }));
    container.querySelector("[data-sri-annulment-date]")?.addEventListener("change", event => {
      if (ui.annulmentDraft) ui.annulmentDraft.annulmentDate = event.currentTarget.value;
    });
    container.querySelector("[data-sri-annulment-reason]")?.addEventListener("input", event => {
      if (ui.annulmentDraft) ui.annulmentDraft.reason = event.currentTarget.value;
    });
    container.querySelector("[data-sri-annulment-evidence]")?.addEventListener("input", event => {
      if (ui.annulmentDraft) ui.annulmentDraft.evidenceReference = event.currentTarget.value;
    });
    container.querySelector("[data-sri-annulment-save]")?.addEventListener("click", () => registerAnnulment(container, appState));
    container.querySelector("[data-sri-credit-note-close]")?.addEventListener("click", () => {
      ui.creditNoteDraft = null;
      rerender(container, appState);
    });
    container.querySelector("[data-sri-credit-note-reason]")?.addEventListener("input", event => {
      if (ui.creditNoteDraft) ui.creditNoteDraft.reason = event.target.value;
    });
    container.querySelectorAll("[data-sri-credit-note-quantity]").forEach(input => input.addEventListener("change", event => {
      const line = ui.creditNoteDraft?.lines?.[Number(event.currentTarget.dataset.sriCreditNoteQuantity)];
      if (!line) return;
      line.affectedQuantity = Math.max(0, Math.min(Number(line.quantity || 0), Number(event.currentTarget.value || 0)));
      rerender(container, appState);
    }));
    container.querySelector("[data-sri-credit-note-full]")?.addEventListener("click", () => {
      (ui.creditNoteDraft?.lines || []).forEach(line => { line.affectedQuantity = Number(line.quantity || 0); });
      rerender(container, appState);
    });
    container.querySelector("[data-sri-credit-note-save]")?.addEventListener("click", () => createCreditNoteDraft(container, appState));
    if (selectedIssueMonthRange() && !ui.loaded && !ui.loading) refresh(container, appState);
  }

  BlessERP.comercialSriAuthorization = {
    render,
    bind,
    renderCreditNotes,
    bindCreditNotes,
    renderSenae,
    bindSenae,
    unmountSenae,
    ecuadorToday,
    effectiveSriIssueDate,
    issueDateFromAccessKey,
    orderForSriEmission,
    invoiceLastNine,
    guideValues,
    matchesSalesScope,
    normalizedTransport,
    hasDae,
    isMaritimeExportWithoutDae,
    compareDocumentRows,
    filterAndSortDocumentRows,
    listCommercialSriDocuments,
    selectedIssueMonthRange,
    resetDocumentsEntry,
    resetDocumentListFilters,
    currentDocumentListFilters,
    sourceOrderIssueDate,
    authorizeSelected,
    openCreditNote,
    openSriDiagnostic,
    openSelectedSriDiagnostic,
    refresh,
    createIntercompanyDraft,
    creditNotePayload,
    creditNoteTotals,
    createCreditNoteDraft,
    downloadSelectedArtifacts,
    syncWorkspaceCompany,
    workspaceCompanyKey
  };
})();
