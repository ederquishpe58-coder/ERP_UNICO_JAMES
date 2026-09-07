(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const purchaseDetails = new Map();
  const runtime = {
    error: "",
    initializing: null,
    subscribed: false,
    onChange: null,
    realtimeTimer: 0,
    selected: null,
    queue: { loading: false, loaded: false, items: [], pending: [], actionable: [], total: 0, page: 1, pageSize: 50 },
    history: { loading: false, loaded: false, visible: false, dirty: false, items: [], total: 0, page: 1, pageSize: 25, appliedFilters: null }
  };

  const upper = value => String(value || "").trim().toUpperCase();
  const digits = value => String(value || "").replace(/\D+/g, "");
  const round2 = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const uuid = () => BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.();

  function repository() { return BlessERP.purchaseWithholdingV2Repository; }

  function providerName(provider = {}) {
    return String(provider.legal_name || provider.commercial_name || provider.supplier_name || "Proveedor sin nombre");
  }

  function normalizePurchase(row = {}, provider = {}, lines = []) {
    const normalizedProvider = Object.keys(provider || {}).length ? provider : {
      provider_id: row.provider_id,
      legal_name: row.supplier_name,
      tax_id: row.supplier_ruc
    };
    return {
      id: row.purchase_document_id,
      purchaseDocumentId: row.purchase_document_id,
      documentCode: row.document_code || "",
      documentNumber: row.external_document_number || row.purchase_document_number || "",
      documentType: row.document_type || "INVOICE",
      providerId: row.provider_id,
      supplierName: providerName(normalizedProvider),
      supplierRuc: String(normalizedProvider.tax_id || row.supplier_ruc || ""),
      supplierAddress: String(normalizedProvider.address || ""),
      issueDate: row.issue_date || row.purchase_issue_date || "",
      accountingDate: row.accounting_date || row.issue_date || row.purchase_issue_date || "",
      currencyCode: row.currency_code || "USD",
      exchangeRate: Number(row.exchange_rate || 1),
      subtotal: Number(row.subtotal || 0),
      iva: Number(row.tax_total || 0),
      total: Number(row.total ?? row.purchase_total ?? 0),
      retentionDecision: row.retention_decision || "APLICAR",
      retentionStatus: row.retention_status || "PENDING_ISSUANCE",
      sourcePayload: clone(row.source_payload || {}),
      lines: (lines || []).map(line => ({
        lineNumber: line.line_number,
        description: line.description,
        productCode: line.product_code,
        taxableBase: Number(line.taxable_base || line.line_total || 0),
        vatRate: Number(line.tax_rate || 0),
        vatCode: (row.source_payload?.vatLines || []).find(tax => tax.lineNumber === line.line_number)?.vatCode || "",
        vatCategory: (row.source_payload?.vatLines || []).find(tax => tax.lineNumber === line.line_number)?.vatCategory || "TARIFA",
        vatValue: Number(line.tax_value || 0),
        amount: Number(line.line_total || line.taxable_base || 0)
      })),
      raw: row,
      provider: normalizedProvider
    };
  }

  function retentionLines(document = {}) {
    const source = clone(document.source_snapshot || {});
    return (source.withholding?.supportingDocuments || [])
      .flatMap(item => item.retentions || [])
      .map((line, index) => ({
        id: `${document.id || "retention"}-${index}`,
        taxType: String(line.code) === "2" ? "IVA" : "RENTA",
        code: String(line.retentionCode || ""),
        sriCode: String(line.retentionCode || ""),
        baseAmount: Number(line.taxableBase || 0),
        percentage: Number(line.rate || 0),
        retainedAmount: Number(line.value || 0)
      }));
  }

  function normalizeRetention(row = {}, context = {}) {
    const purchase = context.purchase || normalizePurchase(row);
    const document = context.document || {
      id: row.electronic_document_id,
      document_type: "07",
      status: row.status,
      issue_date: row.retention_date,
      full_number: row.full_number,
      access_key: row.access_key,
      authorization_number: row.authorization_number,
      authorized_at: row.authorized_at,
      updated_at: row.updated_at
    };
    const lines = context.retentionLines || retentionLines(document);
    return {
      id: document.id || row.electronic_document_id,
      electronicDocumentId: document.id || row.electronic_document_id,
      purchaseId: purchase.id || row.purchase_document_id,
      purchase,
      document,
      retentionDate: document.issue_date || row.retention_date || "",
      fullNumber: document.full_number || row.full_number || "",
      supplierName: purchase.supplierName,
      supplierRuc: purchase.supplierRuc,
      purchaseDocumentNumber: purchase.documentNumber,
      status: document.status || row.status || "BORRADOR",
      accessKey: document.access_key || row.access_key || "",
      authorizationNumber: document.authorization_number || row.authorization_number || "",
      authorizedAt: document.authorized_at || row.authorized_at || "",
      totalRetained: lines.length
        ? round2(lines.reduce((sum, line) => sum + line.retainedAmount, 0))
        : Number(row.total_retained || 0),
      retentionLines: lines,
      journalEntryId: context.link?.journal_entry_id || row.journal_entry_id || "",
      journalEntryNumber: context.journal?.entry_number || row.journal_entry_number || "",
      link: context.link || null
    };
  }

  function normalizeContext(raw = {}) {
    const purchase = normalizePurchase(raw.purchase || {}, raw.provider || {}, raw.lines || []);
    purchaseDetails.set(purchase.id, purchase);
    const document = raw.document || null;
    const retention = document ? normalizeRetention({}, {
      purchase,
      document,
      link: raw.link || null,
      journal: raw.journal || null,
      retentionLines: retentionLines(document)
    }) : null;
    return {
      purchase,
      document,
      retention,
      link: raw.link || null,
      journal: raw.journal || null,
      journalLines: raw.journalLines || []
    };
  }

  function normalizeQueue(result = {}) {
    const items = (result.items || []).map(row => row.row_kind === "PURCHASE"
      ? { kind: "PURCHASE", purchase: normalizePurchase(row), raw: row }
      : { kind: "RETENTION", retention: normalizeRetention(row), raw: row });
    return {
      items,
      pending: items.filter(item => item.kind === "PURCHASE").map(item => item.purchase),
      actionable: items.filter(item => item.kind === "RETENTION").map(item => item.retention),
      total: Number(result.total || 0)
    };
  }

  async function refreshQueue(options = {}) {
    if (runtime.queue.loading && !options.force) return snapshot();
    runtime.queue.loading = true;
    runtime.error = "";
    const page = Math.max(1, Number(options.page || runtime.queue.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : runtime.queue.pageSize;
    try {
      const result = await repository()?.pendingPage?.({ limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar la cola de Retenciones V2.");
      const normalized = normalizeQueue(result);
      Object.assign(runtime.queue, normalized, { loaded: true, page, pageSize });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.queue.loading = false;
    }
  }

  async function queryHistory(filters, options = {}) {
    if (runtime.history.loading && !options.force) return snapshot();
    const appliedFilters = clone(filters || runtime.history.appliedFilters || {});
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : runtime.history.pageSize;
    runtime.history.loading = true;
    runtime.error = "";
    try {
      const result = await repository()?.historyPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el historial de Retenciones V2.");
      Object.assign(runtime.history, {
        loaded: true,
        dirty: false,
        items: (result.items || []).map(row => normalizeRetention(row)),
        total: Number(result.total || 0),
        page,
        pageSize,
        appliedFilters
      });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.history.loading = false;
    }
  }

  async function handleRealtime() {
    const jobs = [refreshQueue({ force: true })];
    if (runtime.history.visible && runtime.history.loaded && runtime.history.appliedFilters) {
      jobs.push(queryHistory(runtime.history.appliedFilters, {
        force: true,
        page: runtime.history.page,
        pageSize: runtime.history.pageSize
      }));
    } else {
      runtime.history.dirty = runtime.history.loaded;
    }
    await Promise.allSettled(jobs);
    runtime.onChange?.();
  }

  async function start(onChange) {
    runtime.onChange = onChange;
    if (!runtime.subscribed) {
      repository()?.subscribe?.(() => {
        clearTimeout(runtime.realtimeTimer);
        runtime.realtimeTimer = setTimeout(handleRealtime, 160);
      });
      runtime.subscribed = true;
    }
    if (runtime.queue.loaded) return snapshot();
    if (runtime.initializing) return runtime.initializing;
    runtime.initializing = (async () => {
      const backend = await repository()?.probeBackend?.();
      if (!backend?.ok) throw new Error(backend?.message || "El backend de Retenciones V2 no está disponible.");
      await refreshQueue({ page: 1, pageSize: 50 });
      return snapshot();
    })().catch(error => {
      runtime.error = error.message;
      return snapshot();
    }).finally(() => {
      runtime.initializing = null;
      runtime.onChange?.();
    });
    return runtime.initializing;
  }

  function setHistoryVisible(visible) { runtime.history.visible = visible === true; }

  function snapshot() {
    return {
      loading: runtime.queue.loading,
      loaded: runtime.queue.loaded,
      error: runtime.error,
      pending: clone(runtime.queue.pending),
      actionable: clone(runtime.queue.actionable),
      queue: clone(runtime.queue),
      issued: clone(runtime.history.items),
      history: clone(runtime.history),
      selected: clone(runtime.selected)
    };
  }

  function purchaseById(id) {
    return purchaseDetails.get(id)
      || runtime.queue.pending.find(row => row.id === id)
      || runtime.queue.actionable.find(row => row.purchaseId === id)?.purchase
      || runtime.history.items.find(row => row.purchaseId === id)?.purchase
      || null;
  }

  async function loadContext(options = {}) {
    const result = await repository()?.detailContext?.(options);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle canónico de la retención.");
    return normalizeContext(result);
  }

  async function ensurePurchaseDetail(purchaseId) {
    const cached = purchaseDetails.get(purchaseId);
    if (cached?.lines?.length || Object.keys(cached?.sourcePayload || {}).length) return cached;
    return (await loadContext({ purchaseId })).purchase;
  }

  async function prepareDraft(purchaseId) {
    await ensurePurchaseDetail(purchaseId);
    return defaultDraft(purchaseId);
  }

  function defaultDraft(purchaseId) {
    const purchase = purchaseById(purchaseId);
    if (!purchase) throw new Error("La compra V2 ya no está pendiente o no existe.");
    return {
      purchaseId: purchase.id,
      retentionDate: new Date().toISOString().slice(0, 10),
      retentionLines: [
        { id: `rent-${uuid()}`, taxType: "RENTA", code: "", sriCode: "", description: "", baseAmount: round2(purchase.subtotal), percentage: 0, retainedAmount: 0, payableAccountCode: "" },
        { id: `iva-${uuid()}`, taxType: "IVA", code: "", sriCode: "", description: "", baseAmount: round2(purchase.iva), percentage: 0, retainedAmount: 0, payableAccountCode: "" }
      ]
    };
  }

  function selectedLines(draft) {
    return (draft.retentionLines || []).filter(line => line.code).map(line =>
      BlessERP.services.taxConfig.resolveRetentionPayable({
      ...line,
      taxType: upper(line.taxType) === "IVA" ? "IVA" : "RENTA",
      baseAmount: round2(line.baseAmount),
      percentage: round2(line.percentage),
      retainedAmount: round2(Number(line.baseAmount || 0) * Number(line.percentage || 0) / 100)
    }, draft.retentionDate)).filter(line => !line.noLiability);
  }

  function journalPayload(purchase, draft, lines) {
    const defaults = BlessERP.services?.companySettings?.settings?.()?.defaultAccounts || {};
    const contract = BlessERP.services?.purchaseAccountContract;
    const debitAccount = String(contract?.enabled() ? contract.payableForDocument(purchase) : (defaults.accountsPayableSuppliers || "")).trim();
    const accountingLines = [{
      accountCode: debitAccount,
      debit: round2(lines.reduce((sum, line) => sum + line.retainedAmount, 0)),
      credit: 0,
      auxiliary: purchase.supplierRuc,
      lineDescription: `Retención sobre ${purchase.documentNumber}`,
      documentReference: purchase.documentNumber
    }];
    lines.forEach(line => accountingLines.push({
      accountCode: String(line.payableAccountCode || "").trim(),
      debit: 0,
      credit: line.retainedAmount,
      auxiliary: purchase.supplierRuc,
      lineDescription: `Retención ${line.taxType} ${line.sriCode || line.code}`,
      documentReference: purchase.documentNumber
    }));
    if (accountingLines.some(line => !line.accountCode)) throw new Error("Configure las cuentas contables de CxP y retenciones antes de crear el comprobante.");
    return {
      accountingDate: draft.retentionDate,
      concept: `Retención emitida sobre compra ${purchase.documentNumber}`,
      originModule: "RETENCIONES_COMPRAS_V2",
      sourceDocument: purchase.documentNumber,
      externalReference: purchase.sourcePayload.authorizationNumber || purchase.sourcePayload.accessKey || purchase.documentNumber,
      currencyCode: purchase.currencyCode || "USD",
      exchangeRate: purchase.exchangeRate || 1,
      observation: `Retención SRI tipo 07 sobre compra ${purchase.documentNumber}`,
      lines: accountingLines
    };
  }

  function sriPayload(purchase, draft, lines, operationId, deviceId) {
    const identification = digits(purchase.supplierRuc) || purchase.supplierRuc;
    const identificationType = identification.length === 13 ? "04" : identification.length === 10 ? "05" : "06";
    const source = purchase.sourcePayload || {};
    const taxes = purchase.lines.map(line => BlessERP.purchaseVatCore.supportingTax(line, purchase.issueDate)).filter(item => item.taxableBase > 0 || item.value > 0);
    const [year, month] = String(draft.retentionDate || "").split("-");
    return {
      buyer: { identificationType, identification, legalName: purchase.supplierName, address: purchase.supplierAddress },
      withholding: {
        subject: { identificationType, identification, legalName: purchase.supplierName, address: purchase.supplierAddress },
        relatedParty: false,
        fiscalPeriod: `${month || ""}/${year || ""}`,
        supportingDocuments: [{
          supportCode: source.taxSupportCode || "01",
          documentCode: purchase.documentType === "CREDIT_NOTE" ? "04" : purchase.documentType === "PURCHASE_SETTLEMENT" ? "03" : "01",
          documentNumber: digits(purchase.documentNumber),
          issueDate: purchase.issueDate,
          accountingDate: purchase.accountingDate || purchase.issueDate,
          authorizationNumber: digits(source.authorizationNumber || source.accessKey),
          paymentLocation: "01",
          totalWithoutTax: purchase.subtotal,
          grandTotal: purchase.total,
          taxes,
          retentions: lines.map(line => ({
            code: line.taxType === "IVA" ? "2" : "1",
            retentionCode: String(line.sriCode || line.code),
            taxableBase: line.baseAmount,
            rate: line.percentage,
            value: line.retainedAmount
          })),
          payments: [{ method: source.paymentMethod || "20", total: purchase.total }]
        }]
      },
      additionalInformation: BlessERP.softwareProvider?.mergeAdditionalInformation?.({}) || {},
      erpPurchase: {
        purchaseDocumentId: purchase.id,
        operationId,
        deviceId,
        retentionAccounts: lines.map(line => ({ parameterId: line.parameterId,
          parameterVersion: line.parameterVersion, code: line.sriCode || line.code,
          taxType: line.taxType, percentage: line.percentage, payableAccountCode: line.payableAccountCode })),
        journal: journalPayload(purchase, draft, lines)
      }
    };
  }

  async function reteEmissionPoint() {
    const api = BlessERP.sriApi;
    if (!api?.status?.().ready) throw new Error("El backend SRI TEST no está disponible.");
    const configuration = await api.configuration();
    const sequence = BlessERP.services?.adminConfig?.findSequenceByCode?.("RETE") || {};
    const establishment = String(sequence.establishmentCode || "").padStart(3, "0");
    const point = String(sequence.emissionPointCode || "").padStart(3, "0");
    if (!/^\d{3}$/.test(establishment) || !/^\d{3}$/.test(point)) throw new Error("Configure el punto RETE antes de emitir retenciones.");
    const emissionPoint = (configuration.emissionPoints || []).find(row => row.active !== false
      && upper(row.environment || "TEST") === "TEST"
      && String(row.establishment_code || "").padStart(3, "0") === establishment
      && String(row.emission_point_code || "").padStart(3, "0") === point);
    if (!emissionPoint?.id) throw new Error(`No existe el punto RETE ${establishment}-${point} activo en SRI TEST.`);
    return emissionPoint;
  }

  async function refreshAfterMutation() {
    await refreshQueue({ force: true, page: runtime.queue.page, pageSize: runtime.queue.pageSize });
    if (runtime.history.visible && runtime.history.loaded && runtime.history.appliedFilters) {
      await queryHistory(runtime.history.appliedFilters, {
        force: true,
        page: runtime.history.page,
        pageSize: runtime.history.pageSize
      });
    } else {
      runtime.history.dirty = runtime.history.loaded;
    }
  }

  async function createOrGet(draft) {
    const purchase = await ensurePurchaseDetail(draft.purchaseId);
    const lines = selectedLines(draft);
    if (!lines.length || lines.some(line => line.baseAmount <= 0 || line.retainedAmount <= 0)) {
      throw new Error("Seleccione al menos una retención con base y valor mayores que cero.");
    }
    const operationId = uuid();
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    const emissionPoint = await reteEmissionPoint();
    const detail = await BlessERP.sriApi.post("create-draft", {
      documentType: "07",
      emissionPointId: emissionPoint.id,
      issueDate: draft.retentionDate,
      sourceOrderDate: purchase.issueDate,
      sourcePayload: sriPayload(purchase, draft, lines, operationId, deviceId)
    });
    purchaseDetails.delete(purchase.id);
    await refreshAfterMutation();
    const retention = normalizeRetention({}, { purchase, document: detail.document || {} });
    runtime.selected = retention;
    return { detail, retention: clone(retention) };
  }

  function nextAction(status) {
    const value = upper(status);
    if (["BORRADOR", "VALIDADO"].includes(value)) return "generate-xml";
    if (value === "XML_GENERADO") return "sign";
    if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(value)) return "transmit";
    return "";
  }

  async function process(documentId) {
    const api = BlessERP.sriApi;
    let detailValue = await api.detail(documentId);
    for (let stage = 0; stage < 4; stage += 1) {
      const action = nextAction(detailValue.document?.status);
      if (!action) break;
      detailValue = await api.post(action, { documentId, ...(action === "transmit" ? { force: true } : {}) });
      if (action === "transmit") break;
    }
    await refreshAfterMutation();
    return detailValue;
  }

  async function detail(documentId) {
    const [sriDetail, context] = await Promise.all([
      BlessERP.sriApi.detail(documentId),
      loadContext({ documentId })
    ]);
    const document = sriDetail.document || context.document || {};
    const retention = normalizeRetention({}, { ...context, document, retentionLines: retentionLines(document) });
    runtime.selected = retention;
    return { ...sriDetail, context, purchase: context.purchase, journal: context.journal, journalLines: context.journalLines, retention };
  }

  async function recover(documentId) {
    const current = await BlessERP.sriApi.detail(documentId);
    const policy = current.recoveryPolicy || {};
    if (policy.action !== "QUERY_AUTHORIZATION") throw new Error(policy.reason || "Este error no permite una consulta automática.");
    await BlessERP.sriApi.post("query-status", { documentId });
    await refreshAfterMutation();
    return detail(documentId);
  }

  async function downloadArtifact(documentId, fileType) {
    const current = await BlessERP.sriApi.detail(documentId);
    const file = (current.files || []).find(item => item.file_type === fileType);
    if (!file?.id) throw new Error(`No existe artefacto ${fileType} para este comprobante.`);
    return BlessERP.sriApi.download(file.id);
  }

  function select(documentId) {
    runtime.selected = runtime.queue.actionable.find(row => row.id === documentId)
      || runtime.history.items.find(row => row.id === documentId) || null;
    return clone(runtime.selected);
  }

  async function stop() {
    clearTimeout(runtime.realtimeTimer);
    runtime.realtimeTimer = 0;
    runtime.onChange = null;
    if (runtime.subscribed) await repository()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.purchaseWithholdingV2 = Object.freeze({
    createOrGet,
    defaultDraft,
    detail,
    downloadArtifact,
    nextAction,
    prepareDraft,
    process,
    purchaseById,
    queryHistory,
    recover,
    refresh: refreshQueue,
    refreshQueue,
    select,
    setHistoryVisible,
    snapshot,
    start,
    stop
  });
})();
