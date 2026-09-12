(function(){
  const ERP = window.BlessERP = window.BlessERP || {};
  const repository = () => ERP.getFinancialV2Repository?.();
  const pending = new Set();
  const cancelled = value => ["ANULADO", "ANULADA", "CANCELLED", "CANCELADO", "CANCELADA", "VOIDED"].includes(String(value || "").toUpperCase());

  function prepare(row, snapshot) {
    const fail = message => ({ ok: false, message });
    const d = row.document;
    if (row.companyId !== snapshot.companyId || row.environment !== "PRODUCTION") return fail("Ambito no valido.");
    if (row.linkIssue) return fail(`Revision de vinculos: ${row.linkIssue}.`);
    if (!d) return fail(row.reservationState === "ACTIVE" ? "Reserva activa sin factura. No contabilizable." : `Reserva ${row.reservationState}. No contabilizable.`);
    if (d.company_id !== row.companyId || d.environment !== row.environment) return fail("Documento fuera del ambito solicitado.");
    if (row.accountingState !== "PENDING") return fail(`Estado contable: ${row.accountingState}.`);
    if (cancelled(row.orderState) || row.orderDeleted) return fail("Pedido cancelado/eliminado. Requiere revision; no equivale a anulacion fiscal.");
    if (d.status !== "AUTORIZADO") return fail(`Estado fiscal: ${d.status}. Pendiente de autorizacion.`);
    if (!["01", "04"].includes(d.document_type)) return fail("Tipo documental no admitido.");
    if (!["USD", "DOLAR"].includes(d.currency)) return fail("Moneda sin contrato de conversion verificado. Requiere revision.");
    const invoice = d.document_type === "04" ? row.parentDocument : d;
    if (!invoice || invoice.company_id !== row.companyId || invoice.environment !== "PRODUCTION") return fail("Factura original no resuelta en el mismo ambito.");
    const market = invoice.source_snapshot?.invoice?.commerceType;
    if (!["LOCAL", "EXPORTADOR"].includes(market)) return fail("Tipo de venta no disponible en snapshot. Requiere revision.");
    if (d.document_type === "01" && ((d.full_number?.startsWith("001-002-") && market !== "EXPORTADOR")
      || (d.full_number?.startsWith("001-003-") && market !== "LOCAL"))) return fail("Serie y tipo de venta contradictorios. Revisar configuracion.");
    if (Number(snapshot.settingsCount) !== 1) return fail("Configuracion contable ausente o ambigua para esta empresa.");
    const settings = snapshot.defaultAccounts || {};
    const receivableAccountCode = (market === "LOCAL" ? settings.accountsReceivableCustomersLocal : settings.accountsReceivableCustomersExport) || settings.accountsReceivableCustomers;
    const counterAccountCode = market === "LOCAL" ? settings.localSales : settings.exportSales;
    const taxAccountCode = Number(d.tax_total) > 0 ? settings.vatSales : "";
    const missing = [!receivableAccountCode && "CxC", !counterAccountCode && "Ventas", Number(d.tax_total)>0 && !taxAccountCode && "IVA ventas"].filter(Boolean);
    if (missing.length) return fail(`Configuracion contable incompleta de esta empresa: ${missing.join(", ")}.`);
    const accounts = { receivableAccountCode, counterAccountCode, taxAccountCode };
    if (d.document_type === "04") {
      const parent = row.parentReceivable;
      if (!parent || parent.journalStatus !== "POSTED" || parent.status === "CANCELLED" || invoice.status !== "AUTORIZADO") return fail("Factura original sin CxC V2 vigente y contabilizada.");
      return { ok: true, kind: "CREDIT_NOTE", payload: {
        ...accounts, revenueAccountCode: counterAccountCode, receivableId: parent.id, sourceId: d.id, electronicDocumentId: d.id,
        documentNumber: d.full_number, issueDate: d.issue_date, subtotal: d.subtotal, taxTotal: d.tax_total,
        total: d.grand_total, accessKey: d.access_key, authorizationNumber: d.authorization_number,
        reason: d.source_snapshot?.creditNote?.reason || ""
      } };
    }
    const service = ERP.services.receivables;
    const customers = (row.customers || []).filter(customer => customer.companyId === row.companyId
      && customer.taxId && customer.taxId === d.buyer_snapshot?.identification);
    if (customers.length !== 1) return fail("Cliente contable ausente o ambiguo. Revisar vinculacion antes de contabilizar.");
    const customer = customers[0];
    if (customer.status !== "activo") return fail("Cliente contable inactivo. Revisar configuracion.");
    const raw = (service.rawReceivableDocuments?.() || []).filter(item => item.sourceDocumentId === d.id);
    const fields = ["id", "sourceDocumentId", "sourceOrderId", "documentNumber", "customerId", "journalEntryId", "postingStatus", "dueDate", "status"];
    const existing = [...new Map(raw.map((item, index) => [item.id
      ? JSON.stringify(fields.map(field => item[field] ?? null)) : `unresolved:${index}`, item])).values()];
    if (existing.length > 1) return fail("Vinculo local de CxC ambiguo. Requiere revision.");
    if (existing[0]?.journalEntryId) return fail("Existe un asiento local no conciliado con la autoridad V2. Requiere revision.");
    // Phase A must not choose when changing customer terms become frozen (AUD-01).
    const dueDate = row.accountingEvidence?.dueDate;
    if (row.accountingEvidence?.dueDateIssue === "SALES_DUE_DATE_INVALID") return fail("Vencimiento persistido invalido. Requiere revision.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || "")) || !Number.isFinite(Date.parse(dueDate))) {
      return fail("Vencimiento no fijado en pedido/CxC existente. Revisar condiciones antes de contabilizar.");
    }
    return { ok: true, kind: "INVOICE", payload: {
      ...accounts, id: d.id, customerId: customer.id,
      customerName: d.buyer_snapshot?.legalName, customerTaxId: d.buyer_snapshot?.identification,
      documentType: "factura sri", documentNumber: d.full_number, issueDate: d.issue_date,
      dueDate,
      concept: `Factura SRI ${d.full_number}`, marketType: market === "LOCAL" ? "LOCAL" : "EXPORTACION",
      subtotal: d.subtotal, taxTotal: d.tax_total, total: d.grand_total, source: "SRI_AUTORIZADO",
      sourceDocumentId: d.id, sourceOrderId: row.orderId || "", authorizationNumber: d.authorization_number, accessKey: d.access_key
    } };
  }

  async function post(companyId, documentId, confirmed) {
    if (confirmed !== true) return { ok: false, message: "Se requiere confirmacion contable explicita." };
    const key = `${companyId}:${documentId}`;
    if (pending.has(key)) return { ok: false, message: "Confirmacion contable en curso." };
    if (repository()?.activeCompanyUuid() !== companyId) return { ok: false, message: "La empresa activa cambio." };
    pending.add(key);
    try {
      const fresh = await repository().salesInbox({ documentId });
      if (fresh.companyId !== companyId || fresh.rows.length !== 1 || fresh.rows[0].document?.id !== documentId) return { ok: false, message: "No se pudo resolver el documento canonico." };
      const action = prepare(fresh.rows[0], fresh);
      if (!action.ok) return action;
      if (repository().activeCompanyUuid() !== companyId) return { ok: false, message: "La empresa activa cambio." };
      return action.kind === "INVOICE"
        ? await ERP.services.receivables.postReceivableV2(action.payload)
        : await repository().postCreditNote(action.payload);
    } catch (error) {
      return { ok: false, message: error.message || "No se recibio confirmacion contable. Verifique la bandeja antes de reintentar." };
    } finally { pending.delete(key); }
  }
  ERP.services = ERP.services || {};
  ERP.services.salesInbox = Object.freeze({ prepare, post, list: filters => repository().salesInbox(filters) });
})();
