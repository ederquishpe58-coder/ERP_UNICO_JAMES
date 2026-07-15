(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const journalService = BlessERP.services.journal;
  const taxConfigService = BlessERP.services.taxConfig;
  const receivablesService = BlessERP.services.receivables;
  const adminService = BlessERP.services.adminConfig;

  const xmlImportStatuses = ["LEIDO", "VALIDO", "DUPLICADO", "ERROR_XML", "IMPORTADO", "PENDIENTE_RELACION", "APLICADO", "ANULADO"];
  const receivedStatuses = ["IMPORTADO", "PENDIENTE_RELACION", "APLICADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, rows) {
    stateApi.state.db[key] = rows;
    stateApi.saveDb();
  }

  function pad3(value) {
    return String(value || "").replace(/\D/g, "").padStart(3, "0").slice(-3);
  }

  function pad9(value) {
    return String(value || "").replace(/\D/g, "").padStart(9, "0").slice(-9);
  }

  function normalizedText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseDateValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [day, month, year] = raw.split("/");
      return `${year}-${month}-${day}`;
    }
    return raw;
  }

  function pickText(scope, selectors = []) {
    for (const selector of selectors) {
      const node = typeof selector === "string"
        ? scope.querySelector(selector)
        : null;
      if (node?.textContent?.trim()) return node.textContent.trim();
    }
    return "";
  }

  function firstNumber(values = []) {
    for (const value of values) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && numeric !== 0) return round2(numeric);
    }
    return 0;
  }

  function taxTypeFromXmlCode(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (["2", "IVA", "IVA"].includes(normalized)) return "IVA";
    return "RENTA";
  }

  function normalizeRetentionLine(line = {}) {
    const parameter = line.code ? taxConfigService.findRetentionByCode(line.code) : null;
    return {
      id: line.id || uid("RRL"),
      taxType: taxTypeFromXmlCode(line.taxType || line.taxCode || line.codeType),
      code: String(line.code || line.sriCode || "").trim(),
      sriCode: String(line.sriCode || line.code || "").trim(),
      description: String(parameter?.description || line.description || "").trim(),
      baseAmount: round2(line.baseAmount || 0),
      percentage: round2(line.percentage || 0),
      retainedAmount: round2(line.retainedAmount || 0)
    };
  }

  function duplicateKey(record) {
    const issuer = String(record.issuerTaxId || "").trim();
    const estab = pad3(record.estab);
    const ptoEmi = pad3(record.ptoEmi);
    const sequential = pad9(record.sequential);
    const auth = String(record.authorizationNumber || record.accessKey || "").trim();
    if (!issuer || !estab || !ptoEmi || !sequential || !auth) return "";
    return [issuer, "07", estab, ptoEmi, sequential, auth].join("|");
  }

  function emptyReceivedWithholding() {
    return {
      id: "",
      fileName: "",
      source: "XML",
      importStatus: "LEIDO",
      status: "IMPORTADO",
      issuerTaxId: "",
      issuerName: "",
      issueDate: today(),
      fiscalPeriod: "",
      estab: "001",
      ptoEmi: "001",
      sequential: "000000001",
      documentNumber: "001-001-000000001",
      authorizationNumber: "",
      accessKey: "",
      supportDocumentNumber: "",
      supportDocumentDate: "",
      totalRetained: 0,
      lines: [],
      suggestedReceivableId: "",
      suggestedReceivableNumber: "",
      suggestedCustomerId: "",
      relatedReceivableId: "",
      relatedReceivableNumber: "",
      relatedCustomerId: "",
      journalEntryId: "",
      journalEntryNumber: "",
      reverseEntryId: "",
      reverseEntryNumber: "",
      createdAt: new Date().toISOString(),
      appliedAt: "",
      observation: ""
    };
  }

  function normalizeReceivedWithholding(raw = {}) {
    const current = {
      ...emptyReceivedWithholding(),
      ...clone(raw || {})
    };
    const lines = (current.lines || []).map(normalizeRetentionLine);
    const totalRetained = round2(
      current.totalRetained
      || lines.reduce((sum, item) => sum + Number(item.retainedAmount || 0), 0)
    );
    const supportDocumentNumber = String(current.supportDocumentNumber || current.documentNumberRelated || "").trim();
    const issueDate = parseDateValue(current.issueDate || current.emissionDate || today());
    const supportDocumentDate = parseDateValue(current.supportDocumentDate || current.documentDate || "");
    const documentNumber = [
      pad3(current.estab || "001"),
      pad3(current.ptoEmi || "001"),
      pad9(current.sequential || "1")
    ].join("-");
    const normalized = {
      id: current.id || uid("RRX"),
      fileName: String(current.fileName || "").trim(),
      source: String(current.source || "XML").trim().toUpperCase(),
      importStatus: xmlImportStatuses.includes(String(current.importStatus || "").trim().toUpperCase())
        ? String(current.importStatus || "").trim().toUpperCase()
        : "LEIDO",
      status: receivedStatuses.includes(String(current.status || "").trim().toUpperCase())
        ? String(current.status || "").trim().toUpperCase()
        : "IMPORTADO",
      issuerTaxId: String(current.issuerTaxId || current.clientTaxId || "").trim(),
      issuerName: String(current.issuerName || current.clientName || "").trim(),
      issueDate,
      fiscalPeriod: String(current.fiscalPeriod || "").trim(),
      estab: pad3(current.estab || "001"),
      ptoEmi: pad3(current.ptoEmi || "001"),
      sequential: pad9(current.sequential || "1"),
      documentNumber,
      authorizationNumber: String(current.authorizationNumber || "").trim(),
      accessKey: String(current.accessKey || "").trim(),
      supportDocumentNumber,
      supportDocumentDate,
      totalRetained,
      lines,
      suggestedReceivableId: String(current.suggestedReceivableId || "").trim(),
      suggestedReceivableNumber: String(current.suggestedReceivableNumber || "").trim(),
      suggestedCustomerId: String(current.suggestedCustomerId || "").trim(),
      relatedReceivableId: String(current.relatedReceivableId || "").trim(),
      relatedReceivableNumber: String(current.relatedReceivableNumber || "").trim(),
      relatedCustomerId: String(current.relatedCustomerId || "").trim(),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      reverseEntryId: String(current.reverseEntryId || "").trim(),
      reverseEntryNumber: String(current.reverseEntryNumber || "").trim(),
      createdAt: current.createdAt || new Date().toISOString(),
      appliedAt: String(current.appliedAt || "").trim(),
      observation: String(current.observation || "").trim()
    };
    normalized.duplicateKey = duplicateKey(normalized);
    normalized.totalRent = round2(lines.filter(item => item.taxType === "RENTA").reduce((sum, item) => sum + Number(item.retainedAmount || 0), 0));
    normalized.totalVat = round2(lines.filter(item => item.taxType === "IVA").reduce((sum, item) => sum + Number(item.retainedAmount || 0), 0));
    return normalized;
  }

  function receivedWithholdings(filters = {}) {
    const search = normalizedText(filters.search);
    return cloneList("receivedWithholdings")
      .map(normalizeReceivedWithholding)
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.importStatus && item.importStatus !== filters.importStatus) return false;
        if (filters.customerId && item.relatedCustomerId !== filters.customerId && item.suggestedCustomerId !== filters.customerId) return false;
        if (!search) return true;
        const haystack = normalizedText([
          item.issuerName,
          item.issuerTaxId,
          item.documentNumber,
          item.supportDocumentNumber,
          item.authorizationNumber,
          item.accessKey
        ].join(" "));
        return haystack.includes(search);
      })
      .sort((a, b) => `${b.issueDate}|${b.documentNumber}`.localeCompare(`${a.issueDate}|${a.documentNumber}`, "es"));
  }

  function findReceivedWithholdingById(id) {
    return receivedWithholdings().find(item => item.id === id) || null;
  }

  function findDuplicate(record, excludeId = "") {
    const key = duplicateKey(record);
    if (!key) return null;
    return receivedWithholdings().find(item => item.id !== excludeId && item.duplicateKey === key) || null;
  }

  function suggestReceivable(record) {
    const candidate = normalizeReceivedWithholding(record);
    const docs = receivablesService.receivables({})
      .filter(item => !["ANULADO", "COBRADO"].includes(item.status));
    const targetAmount = round2(candidate.totalRetained || 0);
    const supportDoc = String(candidate.supportDocumentNumber || "").trim();
    const issuerTaxId = String(candidate.issuerTaxId || "").trim();
    const supportDate = parseDateValue(candidate.supportDocumentDate || "");
    const exactByDocument = docs.find(item =>
      item.customerTaxId === issuerTaxId
      && supportDoc
      && String(item.documentNumber || "").trim() === supportDoc
    );
    if (exactByDocument) {
      return {
        matchType: "MATCH_EXACTO",
        receivableId: exactByDocument.id,
        documentNumber: exactByDocument.documentNumber,
        customerId: exactByDocument.customerId,
        confidence: 200
      };
    }

    const ranked = docs
      .map(item => {
        let score = 0;
        if (issuerTaxId && item.customerTaxId === issuerTaxId) score += 90;
        if (supportDoc && item.documentNumber === supportDoc) score += 70;
        if (supportDate && item.issueDate === supportDate) score += 20;
        if (supportDate && item.dueDate === supportDate) score += 10;
        if (Math.abs(Number(item.total || 0) - targetAmount) <= 1) score += 25;
        if (Math.abs(Number(item.balance || 0) - targetAmount) <= 1) score += 35;
        if (candidate.issuerName && normalizedText(item.customerName) === normalizedText(candidate.issuerName)) score += 40;
        return {
          item,
          score
        };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) return null;
    return {
      matchType: best.score >= 120 ? "MATCH_EXACTO" : "MATCH_POSIBLE",
      receivableId: best.item.id,
      documentNumber: best.item.documentNumber,
      customerId: best.item.customerId,
      confidence: best.score
    };
  }

  function parseRetentionXmlString(xmlText, fileName = "") {
    try {
      const parser = new DOMParser();
      const outer = parser.parseFromString(String(xmlText || ""), "application/xml");
      if (outer.querySelector("parsererror")) {
        return { ok: false, fileName, importStatus: "ERROR_XML", error: "No se pudo leer el XML de retencion." };
      }

      let doc = outer;
      let authorizationNumber = "";
      const authorizationNode = outer.querySelector("autorizacion");
      if (authorizationNode) {
        authorizationNumber = pickText(outer, ["numeroAutorizacion"]);
        const cdataXml = pickText(outer, ["comprobante"]);
        if (cdataXml) {
          const inner = parser.parseFromString(cdataXml, "application/xml");
          if (!inner.querySelector("parsererror")) doc = inner;
        }
      }

      const retentionNodes = Array.from(doc.querySelectorAll("docsSustento docSustento retenciones retencion"));
      const lines = retentionNodes.map(node => {
        const baseAmount = firstNumber([
          pickText(node, ["baseImponible"]),
          pickText(node, ["baseImpGrav"]),
          pickText(node, ["baseNoGraIva"]),
          0
        ]);
        return normalizeRetentionLine({
          taxType: taxTypeFromXmlCode(pickText(node, ["codigo"])),
          code: pickText(node, ["codigoRetencion"]),
          sriCode: pickText(node, ["codigoRetencion"]),
          baseAmount,
          percentage: firstNumber([pickText(node, ["porcentajeRetener"]), 0]),
          retainedAmount: firstNumber([pickText(node, ["valorRetenido"]), 0])
        });
      });

      const candidate = normalizeReceivedWithholding({
        fileName,
        source: "XML",
        importStatus: "VALIDO",
        status: "IMPORTADO",
        issuerTaxId: pickText(doc, ["infoTributaria > ruc", "ruc"]),
        issuerName: pickText(doc, ["infoTributaria > razonSocial", "razonSocial"]),
        issueDate: parseDateValue(pickText(doc, ["infoCompRetencion > fechaEmision", "fechaEmision"])),
        fiscalPeriod: pickText(doc, ["periodoFiscal"]),
        estab: pickText(doc, ["infoTributaria > estab", "estab"]),
        ptoEmi: pickText(doc, ["infoTributaria > ptoEmi", "ptoEmi"]),
        sequential: pickText(doc, ["infoTributaria > secuencial", "secuencial"]),
        authorizationNumber,
        accessKey: pickText(doc, ["infoTributaria > claveAcceso", "claveAcceso"]),
        supportDocumentNumber: pickText(doc, ["docsSustento > docSustento > numDocSustento", "numDocSustento"]),
        supportDocumentDate: parseDateValue(pickText(doc, ["docsSustento > docSustento > fechaEmisionDocSustento", "fechaEmisionDocSustento"])),
        lines
      });

      if (!candidate.issuerTaxId || !candidate.documentNumber) {
        return { ok: false, fileName, importStatus: "ERROR_XML", error: "El XML no contiene datos suficientes de la retencion." };
      }

      const duplicate = findDuplicate(candidate);
      if (duplicate) {
        return { ok: true, fileName, importStatus: "DUPLICADO", received: candidate, duplicateId: duplicate.id };
      }

      const suggestion = suggestReceivable(candidate);
      if (suggestion) {
        candidate.suggestedReceivableId = suggestion.receivableId;
        candidate.suggestedReceivableNumber = suggestion.documentNumber;
        candidate.suggestedCustomerId = suggestion.customerId;
      }
      candidate.importStatus = "VALIDO";
      candidate.status = suggestion ? "IMPORTADO" : "PENDIENTE_RELACION";
      return { ok: true, fileName, importStatus: candidate.importStatus, received: candidate, suggestion };
    } catch (error) {
      return { ok: false, fileName, importStatus: "ERROR_XML", error: error?.message || "Error no controlado al leer XML de retencion." };
    }
  }

  async function parseRetentionXmlFile(file) {
    const text = await file.text();
    return parseRetentionXmlString(text, file.name);
  }

  function importReceivedXmlBatch(batch = []) {
    const rows = receivedWithholdings();
    const results = [];
    batch.forEach(item => {
      if (!item?.received || !["VALIDO", "LEIDO"].includes(item.importStatus)) {
        results.push({ fileName: item?.fileName || "", imported: false });
        return;
      }
      const candidate = normalizeReceivedWithholding(item.received);
      if (findDuplicate(candidate, candidate.id)) {
        results.push({ fileName: item.fileName, imported: false, reason: "duplicado" });
        return;
      }
      candidate.importStatus = "IMPORTADO";
      if (!candidate.suggestedReceivableId && !candidate.relatedReceivableId) candidate.status = "PENDIENTE_RELACION";
      rows.unshift(candidate);
      results.push({ fileName: item.fileName, imported: true, receivedId: candidate.id });
    });
    saveList("receivedWithholdings", rows);
    const importedCount = results.filter(item => item.imported).length;
    if (importedCount) {
      adminService.addAuditLog({
        module: "TRIBUTARIO",
        action: "IMPORTAR_XML_RETENCIONES_RECIBIDAS",
        entityType: "RETENCION_RECIBIDA_XML",
        entityId: batch.map(item => item?.received?.id).filter(Boolean).join(",") || `LOTE-${Date.now()}`,
        entityLabel: `${importedCount} retencion(es) recibida(s) importada(s)`,
        description: `Se importaron ${importedCount} retencion(es) recibida(s) XML para revision y aplicacion posterior.`,
        after: {
          imported: importedCount,
          results
        }
      });
    }
    return {
      ok: true,
      results,
      imported: importedCount
    };
  }

  function validateMovementAccount(code, label) {
    const errors = [];
    const account = code ? chartService.findByCode(code) : null;
    if (!code) errors.push(`Debe configurar la cuenta ${label}.`);
    else if (!account) errors.push(`La cuenta ${label} no existe.`);
    else {
      if (account.status !== "Activa") errors.push(`La cuenta ${label} esta inactiva.`);
      if (!account.isMovement) errors.push(`La cuenta ${label} debe ser de movimiento.`);
    }
    return { errors, account };
  }

  function buildApplicationEntry(record, receivable) {
    const defaults = companyService.settings().defaultAccounts || {};
    const debitValidation = validateMovementAccount(defaults.withholdingReceivable, "Retenciones recibidas por cobrar");
    const creditValidation = validateMovementAccount(receivable.receivableAccountCode || defaults.accountsReceivableCustomers, `CxC del documento ${receivable.documentNumber}`);
    const errors = [...debitValidation.errors, ...creditValidation.errors];
    if (round2(record.totalRetained) <= 0) errors.push("El valor retenido debe ser mayor que cero.");
    if (errors.length) return { ok: false, errors };

    const entry = journalService.emptyEntry();
    entry.accountingDate = record.issueDate || today();
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
    entry.concept = `Retencion recibida ${record.documentNumber} - ${record.issuerName}`;
    entry.originModule = "RETENCIONES_RECIBIDAS";
    entry.sourceDocument = record.documentNumber;
    entry.externalReference = record.authorizationNumber || record.accessKey || "";
    entry.observation = record.observation || `Aplicacion sobre ${receivable.documentNumber}`;
    entry.lines = [
      {
        id: uid("JLN"),
        accountCode: debitValidation.account.code,
        accountName: debitValidation.account.name,
        debit: round2(record.totalRetained),
        credit: 0,
        costCenter: "",
        auxiliary: record.issuerTaxId || record.issuerName,
        lineDescription: `Retencion recibida ${record.documentNumber}`,
        documentReference: record.documentNumber
      },
      {
        id: uid("JLN"),
        accountCode: creditValidation.account.code,
        accountName: creditValidation.account.name,
        debit: 0,
        credit: round2(record.totalRetained),
        costCenter: "",
        auxiliary: receivable.customerTaxId || receivable.customerName,
        lineDescription: `Aplicacion a ${receivable.documentNumber}`,
        documentReference: receivable.documentNumber
      }
    ];
    return { ok: true, entry };
  }

  function applyReceivedWithholding(receivedId, receivableId = "") {
    const rows = receivedWithholdings();
    const index = rows.findIndex(item => item.id === receivedId);
    if (index < 0) return { ok: false, errors: ["Retencion recibida no encontrada."] };
    const target = rows[index];
    if (target.status === "APLICADO") return { ok: false, errors: ["La retencion ya fue aplicada."] };
    if (target.status === "ANULADO") return { ok: false, errors: ["La retencion esta anulada."] };

    const relatedId = receivableId || target.suggestedReceivableId || target.relatedReceivableId;
    const receivable = relatedId ? receivablesService.findReceivableById(relatedId) : null;
    if (!receivable) return { ok: false, errors: ["Debe relacionar la retencion con un documento de cartera valido."] };
    if (["ANULADO", "COBRADO"].includes(receivable.status)) return { ok: false, errors: ["El documento de cartera ya no puede recibir esta retencion."] };
    if (Number(receivable.balance || 0) < Number(target.totalRetained || 0)) {
      return { ok: false, errors: ["El valor retenido excede el saldo disponible del documento."] };
    }

    const entryBuild = buildApplicationEntry(target, receivable);
    if (!entryBuild.ok) return entryBuild;
    const saved = journalService.saveDraft(entryBuild.entry);
    if (!saved.ok) return { ok: false, errors: saved.errors || ["No se pudo guardar el asiento de aplicacion."] };
    const posted = journalService.postEntry(saved.entry.id);
    if (!posted.ok) return { ok: false, errors: posted.errors || ["No se pudo contabilizar la aplicacion."] };

    target.status = "APLICADO";
    target.relatedReceivableId = receivable.id;
    target.relatedReceivableNumber = receivable.documentNumber;
    target.relatedCustomerId = receivable.customerId;
    target.journalEntryId = posted.entry.id;
    target.journalEntryNumber = posted.entry.entryNumber;
    target.appliedAt = new Date().toISOString();
    rows[index] = normalizeReceivedWithholding(target);
    saveList("receivedWithholdings", rows);
    adminService.addAuditLog({
      module: "TRIBUTARIO",
      action: "APLICAR_RETENCION_RECIBIDA",
      entityType: "RETENCION_RECIBIDA_XML",
      entityId: target.id,
      entityLabel: target.documentNumber,
      description: `Se aplico la retencion recibida ${target.documentNumber} al documento ${receivable.documentNumber}.`,
      before: {
        status: "PENDIENTE_RELACION",
        relatedReceivableId: target.relatedReceivableId || ""
      },
      after: {
        status: rows[index].status,
        relatedReceivableId: rows[index].relatedReceivableId,
        journalEntryNumber: rows[index].journalEntryNumber || ""
      }
    });
    return { ok: true, received: clone(rows[index]), receivable: clone(receivable), entry: clone(posted.entry) };
  }

  function annulReceivedWithholding(receivedId) {
    const rows = receivedWithholdings();
    const index = rows.findIndex(item => item.id === receivedId);
    if (index < 0) return { ok: false, message: "Retencion recibida no encontrada." };
    const target = rows[index];
    if (target.status === "ANULADO") return { ok: false, message: "La retencion ya esta anulada." };
    const previousStatus = target.status;
    if (target.status === "APLICADO" && target.journalEntryId) {
      const reversed = journalService.reverseEntry(target.journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar la retencion recibida." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADO";
    rows[index] = normalizeReceivedWithholding(target);
    saveList("receivedWithholdings", rows);
    adminService.addAuditLog({
      module: "TRIBUTARIO",
      action: "ANULAR_RETENCION_RECIBIDA",
      entityType: "RETENCION_RECIBIDA_XML",
      entityId: target.id,
      entityLabel: target.documentNumber,
      description: `Se anulo la retencion recibida ${target.documentNumber}.`,
      before: {
        status: previousStatus,
        journalEntryNumber: target.journalEntryNumber || ""
      },
      after: {
        status: rows[index].status,
        reverseEntryNumber: rows[index].reverseEntryNumber || ""
      }
    });
    return { ok: true, received: clone(rows[index]) };
  }

  function receivedSummary() {
    const rows = receivedWithholdings();
    return {
      pendingRelation: rows.filter(item => item.status === "PENDIENTE_RELACION").length,
      imported: rows.filter(item => item.status === "IMPORTADO").length,
      applied: rows.filter(item => item.status === "APLICADO").length,
      totalRent: round2(rows.reduce((sum, item) => sum + Number(item.totalRent || 0), 0)),
      totalVat: round2(rows.reduce((sum, item) => sum + Number(item.totalVat || 0), 0))
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.taxWithholdings = {
    xmlImportStatuses,
    receivedStatuses,
    emptyReceivedWithholding,
    receivedWithholdings,
    findReceivedWithholdingById,
    findDuplicate,
    suggestReceivable,
    parseRetentionXmlString,
    parseRetentionXmlFile,
    importReceivedXmlBatch,
    applyReceivedWithholding,
    annulReceivedWithholding,
    receivedSummary
  };
})();
