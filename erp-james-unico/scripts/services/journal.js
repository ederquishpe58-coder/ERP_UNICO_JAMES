(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const adminService = BlessERP.services.adminConfig;
  const accountingRules = BlessERP.accountingRules;
  const { clone, uid } = BlessERP.utils;

  const originModules = [
    "Manual",
    "Compras",
    "Ventas",
    "Bancos",
    "Inventario",
    "Retenciones",
    "Rol de pagos",
    "Pagos",
    "Cobros",
    "Ajustes",
    "RETENCIONES_RECIBIDAS",
    "RETENCIONES_EMITIDAS"
  ];
  const statuses = ["BORRADOR", "CONTABILIZADO", "ANULADO", "REVERSADO"];

  function currentUser() {
    return adminService?.activeUser?.() || {
      id: stateApi.state.db.session?.activeUser?.id || "USR-DEMO",
      name: stateApi.state.db.session?.activeUser?.name || "Usuario demo",
      role: stateApi.state.db.session?.activeUser?.role || "",
      area: stateApi.state.db.session?.activeUser?.area || ""
    };
  }

  function all() {
    const legacy = clone(stateApi.state.db.journalEntries || []);
    const confirmed = BlessERP.services?.financialV2?.journalEntries?.() || [];
    const replacedDrafts = new Set(confirmed.map(entry => String(entry.legacyDraftId || "")).filter(Boolean));
    const byId = new Map();
    legacy.filter(entry => !replacedDrafts.has(String(entry.id || ""))).forEach(entry => byId.set(String(entry.id || ""), entry));
    confirmed.forEach(entry => byId.set(String(entry.id || ""), entry));
    return clone(Array.from(byId.values()));
  }

  function sortEntries(entries = all(), direction = "desc") {
    return [...entries].sort((a, b) => {
      const aKey = `${a.accountingDate || ""}|${a.entryNumber || ""}|${a.createdAt || ""}`;
      const bKey = `${b.accountingDate || ""}|${b.entryNumber || ""}|${b.createdAt || ""}`;
      return direction === "asc" ? aKey.localeCompare(bKey, "es") : bKey.localeCompare(aKey, "es");
    });
  }

  function currentPeriod() {
    const settings = companyService.settings();
    return settings.activePeriod || `${new Date().getFullYear()}-01`;
  }

  function linesTotal(lines = []) {
    const totals = accountingRules.entryTotals(lines);
    return { debit: totals.debit, credit: totals.credit };
  }

  function round2(value) {
    return accountingRules.round2(value);
  }

  function accountingPeriodForDate(accountingDate = "", fallbackPeriod = currentPeriod()) {
    const match = String(accountingDate || "").trim().match(/^(\d{4})-(0[1-9]|1[0-2])/);
    return match ? `${match[1]}-${match[2]}` : String(fallbackPeriod || "").trim();
  }

  function difference(lines = []) {
    const totals = linesTotal(lines);
    return round2(totals.debit - totals.credit);
  }

  function nextEntryNumber(accountingDate = "", accountingPeriod = currentPeriod()) {
    const year = String(accountingDate || accountingPeriod || new Date().toISOString().slice(0, 10)).slice(0, 4) || String(new Date().getFullYear());
    const prefix = `ASI-${year}-`;
    const max = all().reduce((highest, entry) => {
      if (!String(entry.entryNumber || "").startsWith(prefix)) return highest;
      const sequence = Number(String(entry.entryNumber).split("-").pop() || 0);
      return Math.max(highest, sequence);
    }, 0);
    return `${prefix}${String(max + 1).padStart(6, "0")}`;
  }

  function emptyEntry() {
    const settings = companyService.settings();
    return {
      id: "",
      entryNumber: nextEntryNumber(settings.periodStart || "", settings.activePeriod || currentPeriod()),
      accountingDate: settings.periodStart || new Date().toISOString().slice(0, 10),
      accountingPeriod: settings.activePeriod || currentPeriod(),
      concept: "",
      originModule: "Manual",
      sourceDocument: "",
      externalReference: "",
      status: "BORRADOR",
      createdBy: currentUser().name,
      createdById: currentUser().id,
      createdAt: new Date().toISOString(),
      observation: "",
      postedBy: "",
      postedAt: "",
      cancelledBy: "",
      cancelledAt: "",
      reversedAt: "",
      reversedById: "",
      reverseOfId: "",
      lines: [
        emptyLine(),
        emptyLine()
      ]
    };
  }

  function emptyLine() {
    return {
      id: uid("JLN"),
      accountCode: "",
      accountName: "",
      debit: 0,
      credit: 0,
      costCenter: "",
      auxiliary: "",
      lineDescription: "",
      documentReference: ""
    };
  }

  function normalizeLine(line = {}) {
    const account = chartService.findByCode(line.accountCode);
    return {
      id: line.id || uid("JLN"),
      accountCode: String(line.accountCode || "").trim(),
      accountName: account?.name || String(line.accountName || "").trim(),
      debit: round2(line.debit),
      credit: round2(line.credit),
      costCenter: String(line.costCenter || "").trim(),
      auxiliary: String(line.auxiliary || "").trim(),
      lineDescription: String(line.lineDescription || "").trim(),
      documentReference: String(line.documentReference || "").trim()
    };
  }

  function normalizeEntry(entry = {}) {
    const date = entry.accountingDate || new Date().toISOString().slice(0, 10);
    const period = accountingPeriodForDate(date, entry.accountingPeriod || currentPeriod());
    return {
      id: entry.id || uid("JNL"),
      entryNumber: String(entry.entryNumber || nextEntryNumber(date, period)).trim(),
      accountingDate: date,
      accountingPeriod: period,
      concept: String(entry.concept || "").trim(),
      originModule: originModules.includes(entry.originModule) ? entry.originModule : "Manual",
      sourceDocument: String(entry.sourceDocument || "").trim(),
      externalReference: String(entry.externalReference || "").trim(),
      status: statuses.includes(entry.status) ? entry.status : "BORRADOR",
      createdBy: String(entry.createdBy || currentUser().name).trim(),
      createdById: String(entry.createdById || currentUser().id || "").trim(),
      createdAt: entry.createdAt || new Date().toISOString(),
      observation: String(entry.observation || "").trim(),
      postedBy: String(entry.postedBy || "").trim(),
      postedAt: String(entry.postedAt || "").trim(),
      cancelledBy: String(entry.cancelledBy || "").trim(),
      cancelledAt: String(entry.cancelledAt || "").trim(),
      reversedAt: String(entry.reversedAt || "").trim(),
      reversedById: String(entry.reversedById || "").trim(),
      reverseOfId: String(entry.reverseOfId || "").trim(),
      lines: (entry.lines || []).map(normalizeLine)
    };
  }

  function validateEntry(entry) {
    const candidate = normalizeEntry(entry);
    const errors = [];

    if (!candidate.accountingDate) errors.push("La fecha contable es obligatoria.");
    if (!candidate.concept) errors.push("El concepto es obligatorio.");
    if (!candidate.accountingPeriod) errors.push("El periodo contable es obligatorio.");
    if (candidate.accountingDate && candidate.accountingPeriod && candidate.accountingDate.slice(0, 7) !== candidate.accountingPeriod) {
      errors.push("La fecha contable debe pertenecer al periodo seleccionado.");
    }
    const duplicateNumber = all().find(item => item.entryNumber === candidate.entryNumber && item.id !== candidate.id);
    if (duplicateNumber) errors.push("El numero de asiento ya existe.");

    const lineValidation = accountingRules.validateEntryLines(candidate.lines, chartService.all());
    errors.push(...lineValidation.errors);
    return { entry: candidate, errors: [...new Set(errors)], totals: lineValidation.totals };
  }

  function saveDraft(entry) {
    const { entry: normalized, errors } = validateEntry(entry);
    const contentErrors = errors.filter(error => !/total debe.*total haber/i.test(error));
    if (!normalized.accountingDate) contentErrors.push("La fecha contable es obligatoria.");
    if (!normalized.concept) contentErrors.push("El concepto es obligatorio.");
    if (contentErrors.length) return { ok: false, errors: [...new Set(contentErrors)] };

    normalized.status = normalized.status === "ANULADO" ? "ANULADO" : "BORRADOR";
    const entries = all();
    const index = entries.findIndex(item => item.id === normalized.id);
    const user = currentUser();
    const isNew = index < 0;
    normalized.createdBy = normalized.createdBy || user.name;
    normalized.createdById = normalized.createdById || user.id;
    if (index >= 0) entries[index] = normalized;
    else entries.unshift(normalized);
    stateApi.state.db.journalEntries = sortEntries(entries);
    stateApi.saveDb();
    adminService?.addAuditLog?.({
      module: "CONTABILIDAD",
      action: isNew ? "CREAR_ASIENTO" : "EDITAR_ASIENTO",
      entityType: "journal_entry",
      entityId: normalized.id,
      entityLabel: normalized.entryNumber,
      documentLabel: normalized.entryNumber,
      previousStatus: isNew ? "" : entries[index]?.status || "BORRADOR",
      nextStatus: normalized.status,
      description: `${isNew ? "Se creo" : "Se actualizo"} el asiento ${normalized.entryNumber} en borrador.`,
      after: normalized,
      result: "exitoso"
    });
    return { ok: true, entry: clone(normalized) };
  }

  function postEntry(entryId) {
    const entries = all();
    const index = entries.findIndex(item => item.id === entryId);
    if (index < 0) return { ok: false, errors: ["Asiento no encontrado."] };
    const current = entries[index];
    if (current.status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden contabilizar asientos en borrador."] };
    const { entry: normalized, errors } = validateEntry(current);
    if (errors.length) {
      adminService?.logFailure?.({
        module: "CONTABILIDAD",
        action: "CONTABILIZAR_ASIENTO",
        entityType: "journal_entry",
        entityId: current.id,
        entityLabel: current.entryNumber,
        documentLabel: current.entryNumber,
        previousStatus: current.status,
        nextStatus: current.status,
        description: "No se pudo contabilizar el asiento por errores de validacion.",
        reason: errors.join(" | ")
      }, "error");
      return { ok: false, errors };
    }
    normalized.status = "CONTABILIZADO";
    normalized.postedBy = currentUser().name;
    normalized.postedAt = new Date().toISOString();
    entries[index] = normalized;
    stateApi.state.db.journalEntries = sortEntries(entries);
    stateApi.saveDb();
    adminService?.addAuditLog?.({
      module: "CONTABILIDAD",
      action: "CONTABILIZAR_ASIENTO",
      entityType: "journal_entry",
      entityId: normalized.id,
      entityLabel: normalized.entryNumber,
      documentLabel: normalized.entryNumber,
      previousStatus: current.status,
      nextStatus: normalized.status,
      description: `Asiento ${normalized.entryNumber} contabilizado correctamente.`,
      before: current,
      after: normalized,
      result: "exitoso"
    });
    return { ok: true, entry: clone(normalized) };
  }

  function cancelDraft(entryId) {
    const entries = all();
    const index = entries.findIndex(item => item.id === entryId);
    if (index < 0) return { ok: false, message: "Asiento no encontrado." };
    if (entries[index].status !== "BORRADOR") return { ok: false, message: "Solo se pueden anular borradores desde esta accion." };
    const previous = clone(entries[index]);
    entries[index].status = "ANULADO";
    entries[index].cancelledBy = currentUser().name;
    entries[index].cancelledAt = new Date().toISOString();
    stateApi.state.db.journalEntries = sortEntries(entries);
    stateApi.saveDb();
    adminService?.addAuditLog?.({
      module: "CONTABILIDAD",
      action: "ANULAR_ASIENTO",
      entityType: "journal_entry",
      entityId: entries[index].id,
      entityLabel: entries[index].entryNumber,
      documentLabel: entries[index].entryNumber,
      previousStatus: previous.status,
      nextStatus: entries[index].status,
      description: `Borrador ${entries[index].entryNumber} marcado como anulado.`,
      before: previous,
      after: entries[index],
      result: "exitoso"
    });
    return { ok: true, entry: clone(entries[index]) };
  }

  function deleteDraft(entryId) {
    const entries = all();
    const target = entries.find(item => item.id === entryId);
    if (!target) return { ok: false, message: "Asiento no encontrado." };
    if (target.status !== "BORRADOR") return { ok: false, message: "Solo se pueden eliminar borradores." };
    stateApi.state.db.journalEntries = sortEntries(entries.filter(item => item.id !== entryId));
    stateApi.saveDb();
    adminService?.addAuditLog?.({
      module: "CONTABILIDAD",
      action: "ELIMINAR_BORRADOR_ASIENTO",
      entityType: "journal_entry",
      entityId: target.id,
      entityLabel: target.entryNumber,
      documentLabel: target.entryNumber,
      previousStatus: target.status,
      nextStatus: "ELIMINADO",
      description: `Se elimino el borrador ${target.entryNumber}.`,
      before: target,
      result: "exitoso"
    });
    return { ok: true };
  }

  function reverseEntry(entryId) {
    const entries = all();
    const index = entries.findIndex(item => item.id === entryId);
    if (index < 0) return { ok: false, message: "Asiento no encontrado." };
    const target = entries[index];
    if (target.status !== "CONTABILIZADO") return { ok: false, message: "Solo se pueden reversar asientos contabilizados." };
    const reverse = normalizeEntry({
      accountingDate: target.accountingDate,
      accountingPeriod: target.accountingPeriod,
      concept: `Reverso de ${target.entryNumber} - ${target.concept}`,
      originModule: "Ajustes",
      sourceDocument: target.sourceDocument,
      externalReference: target.entryNumber,
      status: "CONTABILIZADO",
      createdBy: currentUser().name,
      createdById: currentUser().id,
      createdAt: new Date().toISOString(),
      postedBy: currentUser().name,
      postedAt: new Date().toISOString(),
      observation: `Asiento reverso generado desde ${target.entryNumber}`,
      reverseOfId: target.id,
      lines: target.lines.map(line => ({
        ...line,
        id: uid("JLN"),
        debit: line.credit,
        credit: line.debit
      }))
    });
    const reverseValidation = validateEntry(reverse);
    if (reverseValidation.errors.length) {
      return { ok: false, message: reverseValidation.errors.join(" "), errors: reverseValidation.errors };
    }
    target.status = "REVERSADO";
    target.reversedById = reverse.id;
    target.reversedAt = new Date().toISOString();
    entries[index] = target;
    entries.unshift(reverse);
    stateApi.state.db.journalEntries = sortEntries(entries);
    stateApi.saveDb();
    adminService?.addAuditLog?.({
      module: "CONTABILIDAD",
      action: "REVERSAR_ASIENTO",
      entityType: "journal_entry",
      entityId: reverse.id,
      entityLabel: reverse.entryNumber,
      documentLabel: target.entryNumber,
      previousStatus: "CONTABILIZADO",
      nextStatus: "REVERSADO",
      description: `Se genero el reverso ${reverse.entryNumber} para el asiento ${target.entryNumber}.`,
      before: target,
      after: reverse,
      result: "exitoso"
    });
    return { ok: true, entry: clone(reverse), source: clone(target) };
  }

  async function postEntryV2(entryOrId, options = {}) {
    const candidate = typeof entryOrId === "string"
      ? all().find(item => item.id === entryOrId)
      : entryOrId;
    if (!candidate) return { ok: false, errors: ["Asiento no encontrado."] };
    if (String(candidate.syncFlow || "") === "FINANCIAL_V2" && candidate.status === "CONTABILIZADO") {
      return { ok: true, entry: clone(candidate), reused: true, confirmed: true };
    }
    const validation = validateEntry(candidate);
    if (validation.errors.length) return { ok: false, errors: validation.errors };
    const result = await BlessERP.services?.financialV2?.postJournal?.(validation.entry, options);
    if (!result) return { ok: false, errors: ["Servicio financiero V2 no disponible."] };
    return result.ok ? result : { ...result, errors: result.errors || [result.message || "Supabase no confirmó el asiento."] };
  }

  async function reverseEntryV2(entryId, reason, options = {}) {
    const candidate = all().find(item => item.id === entryId);
    if (!candidate) return { ok: false, message: "Asiento no encontrado." };
    if (String(candidate.syncFlow || "") !== "FINANCIAL_V2") {
      return { ok: false, message: "El asiento histórico aún usa el flujo anterior; no se modificó automáticamente." };
    }
    const result = await BlessERP.services?.financialV2?.reverseJournal?.(entryId, reason, options);
    return result || { ok: false, message: "Servicio financiero V2 no disponible." };
  }

  function impactedEntries(filters = {}) {
    const from = filters.dateFrom || "";
    const to = filters.dateTo || "";
    const accountCode = filters.accountCode || "";
    const originModule = filters.originModule || "";
    const statusFilter = filters.status || "";
    const search = String(filters.search || "").trim().toLowerCase();

    return sortEntries(all(), "asc").filter(entry => {
      if (!["CONTABILIZADO", "REVERSADO"].includes(entry.status)) return false;
      if (from && entry.accountingDate < from) return false;
      if (to && entry.accountingDate > to) return false;
      if (originModule && entry.originModule !== originModule) return false;
      if (statusFilter && entry.status !== statusFilter) return false;
      const byAccount = !accountCode || entry.lines.some(line => line.accountCode === accountCode);
      if (!byAccount) return false;
      if (!search) return true;
      const haystack = [
        entry.entryNumber,
        entry.concept,
        entry.originModule,
        entry.sourceDocument,
        entry.externalReference,
        ...entry.lines.map(line => `${line.accountCode} ${line.accountName} ${line.lineDescription}`)
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  function journalSummaries(period = currentPeriod()) {
    const entries = all().filter(entry => entry.accountingPeriod === period);
    const contabilized = entries.filter(entry => entry.status === "CONTABILIZADO").length;
    const drafts = entries.filter(entry => entry.status === "BORRADOR").length;
    const outOfBalance = entries.filter(entry => round2(difference(entry.lines)) !== 0).length;
    const latest = sortEntries(entries)[0] || null;
    const totals = impactedEntries({}).filter(entry => entry.accountingPeriod === period).reduce((acc, entry) => {
      const sum = linesTotal(entry.lines);
      acc.debit += sum.debit;
      acc.credit += sum.credit;
      return acc;
    }, { debit: 0, credit: 0 });
    return {
      drafts,
      contabilized,
      outOfBalance,
      latest,
      totalDebit: round2(totals.debit),
      totalCredit: round2(totals.credit)
    };
  }

  function auditEntries(filters = {}) {
    return accountingRules.auditEntries(
      impactedEntries(filters),
      chartService.all(),
      { deferredSourceModules: accountingRules.DEFERRED_SOURCE_MODULES }
    );
  }

  function ledgerByAccount(accountCode, filters = {}) {
    const account = chartService.findByCode(accountCode);
    if (!account) return null;
    const allEntries = impactedEntries({
      ...filters,
      accountCode,
      dateFrom: ""
    });
    const from = filters.dateFrom || "";
    const beforeRange = from ? allEntries.filter(entry => entry.accountingDate < from) : [];
    const inRange = from ? allEntries.filter(entry => entry.accountingDate >= from) : allEntries;

    const signed = line => account.nature === "Acreedora"
      ? round2(Number(line.credit || 0) - Number(line.debit || 0))
      : round2(Number(line.debit || 0) - Number(line.credit || 0));

    const initialBalance = round2(beforeRange.flatMap(entry => entry.lines.filter(line => line.accountCode === accountCode)).reduce((sum, line) => sum + signed(line), 0));

    let running = initialBalance;
    const rows = [];
    inRange.forEach(entry => {
      entry.lines.filter(line => line.accountCode === accountCode).forEach(line => {
        running = round2(running + signed(line));
        rows.push({
          date: entry.accountingDate,
          entryNumber: entry.entryNumber,
          concept: entry.concept,
          sourceDocument: entry.sourceDocument,
          debit: round2(line.debit),
          credit: round2(line.credit),
          balance: running,
          originModule: entry.originModule,
          status: entry.status,
          costCenter: line.costCenter,
          auxiliary: line.auxiliary
        });
      });
    });

    const totals = rows.reduce((acc, row) => {
      acc.debit += row.debit;
      acc.credit += row.credit;
      return acc;
    }, { debit: 0, credit: 0 });

    return {
      account,
      initialBalance,
      rows,
      finalBalance: running,
      totals: { debit: round2(totals.debit), credit: round2(totals.credit) }
    };
  }

  function ledgerSummary(filters = {}) {
    const map = new Map();
    impactedEntries(filters).forEach(entry => {
      entry.lines.forEach(line => {
        const account = chartService.findByCode(line.accountCode);
        if (!account) return;
        const current = map.get(line.accountCode) || {
          accountCode: line.accountCode,
          accountName: line.accountName || account.name,
          nature: account.nature,
          debit: 0,
          credit: 0
        };
        current.debit = round2(current.debit + Number(line.debit || 0));
        current.credit = round2(current.credit + Number(line.credit || 0));
        map.set(line.accountCode, current);
      });
    });
    return chartService.sortAccounts(Array.from(map.values()).map(item => ({
      code: item.accountCode,
      ...item
    }))).map(item => ({
      ...item,
      balance: item.nature === "Acreedora"
        ? round2(item.credit - item.debit)
        : round2(item.debit - item.credit)
    }));
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.journal = {
    originModules,
    statuses,
    all,
    sortEntries,
    emptyEntry,
    emptyLine,
    linesTotal,
    difference,
    saveDraft,
    postEntry,
    postEntryV2,
    cancelDraft,
    deleteDraft,
    reverseEntry,
    reverseEntryV2,
    validateEntry,
    journalSummaries,
    auditEntries,
    impactedEntries,
    ledgerByAccount,
    ledgerSummary,
    nextEntryNumber,
    accountingPeriodForDate
  };
})();
