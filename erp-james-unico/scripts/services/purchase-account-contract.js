(function () {
  const erp = window.BlessERP = window.BlessERP || {};
  const BLESS = ["COMP-BLESS-FLOWER", "cf331b82-7ac3-4065-9e38-d0bbcde96cd5"];
  const AP = ["2.01.01.01", "2.01.01.02"];
  const round = n => Math.round(Number(n || 0) * 100) / 100;
  function enabled() {
    return BLESS.includes(erp.services?.companyContext?.activeCompanyId?.());
  }
  function account(code) {
    const a = erp.services?.chartOfAccounts?.findByCode?.(code);
    return a && !a.deleted_at && a.status === "Activa" && a.isMovement === true
      && (!a.company_id || BLESS.includes(a.company_id)) && (!a.companyId || BLESS.includes(a.companyId)) ? a : null;
  }
  function payable(purchase = {}) {
    const config = erp.services?.companySettings?.settings?.().purchaseAccounting || {};
    if (config.relatedPayableAccountCode !== AP[0] || config.nonRelatedPayableAccountCode !== AP[1]) return "";
    const provider = erp.services?.supplierFinanceV2?.findProvider?.({ providerId: purchase.supplierId, taxId: purchase.supplierRuc });
    const configured = String(provider?.payableAccountCode || "").trim();
    const selected = String(purchase.payableAccountCode || "").trim();
    if (configured && (!AP.includes(configured) || (selected && selected !== configured))) return "";
    const code = configured || selected;
    return AP.includes(code) && account(code)?.nature === "Acreedora" ? code : "";
  }
  function effectiveTaxes(date) {
    return (erp.state?.state?.db?.taxParameters || []).filter(t => !t.deleted_at
      && Number(t.__syncVersion || 0) > 0 && ["activa", "activo", "active"].includes(String(t.status).toLowerCase())
      && t.taxType === "IVA" && ["compras", "compra", "ambos"].includes(t.appliesTo)
      && t.effectiveFrom && t.effectiveFrom <= date && (!t.effectiveTo || t.effectiveTo >= date));
  }
  function payableForDocument(reference = {}) {
    // Posted purchases use the canonical payable fetched by ID, regardless of MANUAL/XML origin.
    if (Object.prototype.hasOwnProperty.call(reference, "canonicalPayable")) {
      const p = reference.canonicalPayable;
      const purchase = reference.raw || {};
      const provider = reference.provider || {};
      if (!enabled() || !p || !BLESS.includes(purchase.company_id) || p.company_id !== purchase.company_id
          || purchase.status !== "POSTED" || p.source_type !== "PURCHASE_DOCUMENT"
          || !purchase.payable_id || p.payable_id !== purchase.payable_id
          || p.source_id !== purchase.purchase_document_id || p.provider_id !== purchase.provider_id
          || !purchase.journal_entry_id || p.journal_entry_id !== purchase.journal_entry_id
          || !["OPEN", "PARTIALLY_PAID", "PAID"].includes(p.status)) return "";
      if (provider.provider_id !== p.provider_id || provider.company_id !== p.company_id
          || (provider.payable_account_code && provider.payable_account_code !== p.payable_account_code)) return "";
      const code = p.payable_account_code;
      return AP.includes(code) && account(code)?.nature === "Acreedora" ? code : "";
    }
    const rows = erp.services?.supplierFinanceV2?.payables?.() || [];
    const id = reference.payableId || "";
    const sourceId = reference.purchaseDocumentId || reference.purchaseId || reference.id || "";
    const matches = rows.filter(r => (id && [r.id, r.payableId].includes(id)) || (sourceId && r.sourceId === sourceId));
    const codes = [...new Set(matches.map(r => r.payableAccountCode).filter(Boolean))];
    return codes.length === 1 && AP.includes(codes[0]) && account(codes[0]) ? codes[0] : "";
  }
  function normalize(purchase) {
    if (!enabled()) return purchase;
    const date = purchase.issueDate || "";
    const xml = purchase.source === "XML";
    const taxes = effectiveTaxes(date);
    purchase.lines = (purchase.lines || []).map(line => {
      const next = { ...line };
      if (xml) {
        next.vatRateAuthority = "DOCUMENT";
      } else {
        const selected = taxes.filter(t => t.id === next.vatParameterId);
        const defaults = taxes.filter(t => t.defaultForManual === true);
        const candidates = next.vatParameterId ? selected : defaults;
        if (candidates.length === 1) {
          const parameter = candidates[0];
          try {
            const tax = erp.purchaseVatCore.resolve({ rate: parameter.rate, percentageCode: parameter.sriCode, issueDate: date });
            next.vatRate = tax.rate;
            next.vatCode = tax.percentageCode;
            next.vatCategory = tax.percentageCode === "6" ? "NO_OBJETO" : tax.percentageCode === "7" ? "EXENTO" : "TARIFA";
            next.vatParameterId = parameter.id;
            next.vatRateDate = date;
            next.vatRateAuthority = "EFFECTIVE_TABLE";
            next.vatValue = round(Number(next.taxableBase) * next.vatRate / 100);
            next.totalLine = round(Number(next.taxableBase) + next.vatValue);
          } catch (_) { next.vatRateAuthority = "UNRESOLVED"; }
        } else {
          next.vatRateAuthority = "UNRESOLVED";
        }
      }
      return next;
    });
    return purchase;
  }
  function supportsNoCredit(code) { return ["02", "04", "07"].includes(String(code || "")); }
  function validate(purchase) {
    if (!enabled()) return [];
    const errors = [];
    if (purchase.settlementMode !== "CONTADO" && !payable(purchase)) errors.push("PURCHASE_AP_ACCOUNT_REQUIRED: seleccione la CxP relacionada o no relacionada; debe coincidir con la cuenta canónica del proveedor si existe.");
    const positiveVat = (purchase.lines || []).some(l => Number(l.vatValue) > 0);
    const treatment = purchase.vatCreditTreatment;
    if (positiveVat && !["CREDIT", "NO_CREDIT"].includes(treatment)) errors.push("PURCHASE_VAT_TREATMENT_REQUIRED: confirme si el IVA tiene derecho a credito tributario.");
    if ((treatment === "NO_CREDIT" && !supportsNoCredit(purchase.taxSupportCode))
        || (treatment === "CREDIT" && supportsNoCredit(purchase.taxSupportCode))) errors.push("PURCHASE_VAT_SUPPORT_CONFLICT: el sustento y el tratamiento del IVA son incompatibles.");
    if (positiveVat && treatment === "CREDIT" && (account("1.01.08")?.nature !== "Deudora" || erp.services?.companySettings?.settings?.().purchaseAccounting?.vatCreditAccountCode !== "1.01.08")) errors.push("PURCHASE_VAT_ACCOUNT_REQUIRED: falta la cuenta canonica de credito tributario.");
    (purchase.lines || []).forEach((line, index) => {
      if (treatment === "NO_CREDIT" && line.accountCode === "1.01.08") errors.push("PURCHASE_LINE_ACCOUNT_REQUIRED: el IVA sin credito debe usar la cuenta economica de la linea.");
      if (!account(line.accountCode) || ["5.3", "5.5.04"].includes(line.accountCode)) errors.push(`PURCHASE_LINE_ACCOUNT_REQUIRED: línea ${index + 1}; seleccione una cuenta existente, activa y de movimiento para su propósito económico.`);
      if (line.vatRateAuthority === "UNRESOLVED" || !Number.isFinite(Number(line.vatRate)) || Number(line.vatRate) < 0) errors.push(`PURCHASE_VAT_RATE_REQUIRED: línea ${index + 1}; falta tarifa canónica efectiva para la fecha.`);
      if (purchase.source === "XML" && (!purchase.issueDate || !line.vatCode || line.vatRateAuthority !== "DOCUMENT")) errors.push(`PURCHASE_DOCUMENT_TAX_REQUIRED: línea ${index + 1}; falta fecha/código/tarifa del comprobante.`);
      if (purchase.source !== "XML" && !effectiveTaxes(purchase.issueDate).some(t => t.id === line.vatParameterId && Number(t.rate) === Number(line.vatRate))) errors.push(`PURCHASE_VAT_RATE_REQUIRED: línea ${index + 1}; la tarifa no corresponde al parámetro efectivo.`);
      try { erp.purchaseVatCore.supportingTax(line, purchase.issueDate); }
      catch (error) { errors.push(`Línea ${index + 1}: ${error.message}`); }
      if (Math.abs(round(Number(line.taxableBase) * Number(line.vatRate) / 100) - Number(line.vatValue)) > 0.02) errors.push(`PURCHASE_VAT_AMOUNT_MISMATCH: línea ${index + 1}; revise base, tarifa y valor del documento.`);
    });
    return errors;
  }
  erp.services = erp.services || {};
  erp.services.purchaseAccountContract = { enabled, account, payable, payableForDocument, effectiveTaxes, normalize, validate, supportsNoCredit, payableCodes: AP };
})();
