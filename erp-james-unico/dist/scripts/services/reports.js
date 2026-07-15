(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const companyService = BlessERP.services.companySettings;
  const chartService = BlessERP.services.chartOfAccounts;
  const journalService = BlessERP.services.journal;
  const purchaseService = BlessERP.services.purchases;
  const portfolioService = BlessERP.services.portfolios;
  const bankService = BlessERP.services.banks;
  const reconciliationService = BlessERP.services.bankReconciliation;
  const receivableService = BlessERP.services.receivables;
  const taxWithholdingService = BlessERP.services.taxWithholdings;
  const inventoryService = BlessERP.services.inventory;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function num(value) {
    return round2(Number(value || 0));
  }

  function defaultFilters() {
    const settings = companyService.settings();
    return {
      period: settings.activePeriod || "",
      dateFrom: settings.periodStart || "",
      dateTo: settings.periodEnd || ""
    };
  }

  function periodRange(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return { dateFrom: "", dateTo: "" };
    const [year, month] = String(period).split("-").map(Number);
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0);
    const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return { dateFrom, dateTo };
  }

  function resolveFilters(filters = {}) {
    const base = defaultFilters();
    const current = { ...base, ...filters };
    if ((!current.dateFrom || !current.dateTo) && current.period) {
      const range = periodRange(current.period);
      current.dateFrom = current.dateFrom || range.dateFrom;
      current.dateTo = current.dateTo || range.dateTo;
    }
    return current;
  }

  function matchesDate(value, dateFrom = "", dateTo = "") {
    if (!value) return false;
    if (dateFrom && value < dateFrom) return false;
    if (dateTo && value > dateTo) return false;
    return true;
  }

  function withinTree(code, selectedCode = "") {
    if (!selectedCode) return true;
    return code === selectedCode || String(code || "").startsWith(`${selectedCode}.`);
  }

  function lineSignedForAccount(account, line) {
    return account.nature === "Acreedora"
      ? round2(Number(line.credit || 0) - Number(line.debit || 0))
      : round2(Number(line.debit || 0) - Number(line.credit || 0));
  }

  function accumulateAccountMetrics(filters = {}) {
    const resolved = resolveFilters(filters);
    const accounts = chartService.sortAccounts(chartService.all());
    const accountMap = new Map(accounts.map(account => [account.code, account]));
    const metrics = new Map(accounts.map(account => [account.code, {
      initialSigned: 0,
      debit: 0,
      credit: 0
    }]));
    const entries = journalService.impactedEntries({ dateTo: resolved.dateTo || "" });

    entries.forEach(entry => {
      const isBefore = resolved.dateFrom && entry.accountingDate < resolved.dateFrom;
      const isInRange = matchesDate(entry.accountingDate, resolved.dateFrom, resolved.dateTo);
      if (!isBefore && !isInRange) return;
      entry.lines.forEach(line => {
        let cursor = accountMap.get(line.accountCode);
        while (cursor) {
          const bucket = metrics.get(cursor.code);
          if (isBefore) bucket.initialSigned = round2(bucket.initialSigned + lineSignedForAccount(cursor, line));
          if (isInRange) {
            bucket.debit = round2(bucket.debit + Number(line.debit || 0));
            bucket.credit = round2(bucket.credit + Number(line.credit || 0));
          }
          cursor = cursor.parentCode ? accountMap.get(cursor.parentCode) : null;
        }
      });
    });

    const rows = accounts.map(account => {
      const bucket = metrics.get(account.code);
      const periodSigned = lineSignedForAccount(account, { debit: bucket.debit, credit: bucket.credit });
      const finalSigned = round2(bucket.initialSigned + periodSigned);
      const saldoDeudor = account.nature === "Deudora"
        ? round2(finalSigned >= 0 ? finalSigned : 0)
        : round2(finalSigned < 0 ? Math.abs(finalSigned) : 0);
      const saldoAcreedor = account.nature === "Acreedora"
        ? round2(finalSigned >= 0 ? finalSigned : 0)
        : round2(finalSigned < 0 ? Math.abs(finalSigned) : 0);
      return {
        ...account,
        initialSigned: round2(bucket.initialSigned),
        debit: round2(bucket.debit),
        credit: round2(bucket.credit),
        finalSigned,
        saldoDeudor,
        saldoAcreedor,
        hasActivity: Boolean(bucket.initialSigned || bucket.debit || bucket.credit || finalSigned)
      };
    }).filter(account => {
      if (!withinTree(account.code, resolved.accountCode || "")) return false;
      if (resolved.accountType && account.type !== resolved.accountType) return false;
      if (resolved.onlyActive && account.status !== "Activa") return false;
      return resolved.includeZeroRows ? true : account.hasActivity;
    });

    return { filters: resolved, rows, accounts };
  }

  function trialBalance(filters = {}) {
    const report = accumulateAccountMetrics(filters);
    const movementTotals = report.rows
      .filter(item => item.isMovement)
      .reduce((acc, item) => {
        acc.debit = round2(acc.debit + item.debit);
        acc.credit = round2(acc.credit + item.credit);
        return acc;
      }, { debit: 0, credit: 0 });
    return {
      ...report,
      totals: {
        debit: movementTotals.debit,
        credit: movementTotals.credit
      }
    };
  }

  function rootsByType(rows, type) {
    return rows.filter(item =>
      item.type === type
      && !rows.some(parent => parent.code === item.parentCode && parent.type === type)
    );
  }

  function incomeStatement(filters = {}) {
    const base = accumulateAccountMetrics(filters);
    const sectionTypes = [
      { key: "Ingreso", label: "Ingresos" },
      { key: "Costo", label: "Costos" },
      { key: "Gasto", label: "Gastos" }
    ];
    const sections = sectionTypes.map(section => {
      const rows = base.rows.filter(item => item.type === section.key && item.hasActivity);
      const total = round2(rootsByType(rows, section.key).reduce((sum, item) => sum + item.finalSigned, 0));
      return { ...section, total, rows };
    });
    const totalIncome = sections.find(item => item.key === "Ingreso")?.total || 0;
    const totalCost = sections.find(item => item.key === "Costo")?.total || 0;
    const totalExpense = sections.find(item => item.key === "Gasto")?.total || 0;
    return {
      filters: base.filters,
      sections,
      totalIncome,
      totalCost,
      totalExpense,
      resultPeriod: round2(totalIncome - totalCost - totalExpense)
    };
  }

  function balanceSheet(filters = {}) {
    const base = accumulateAccountMetrics(filters);
    const result = incomeStatement(filters);
    const sectionTypes = [
      { key: "Activo", label: "Activos" },
      { key: "Pasivo", label: "Pasivos" },
      { key: "Patrimonio", label: "Patrimonio" }
    ];
    const sections = sectionTypes.map(section => {
      const rows = base.rows.filter(item => item.type === section.key && item.hasActivity);
      const total = round2(rootsByType(rows, section.key).reduce((sum, item) => sum + item.finalSigned, 0));
      return { ...section, total, rows };
    });
    return {
      filters: base.filters,
      sections,
      totalAssets: sections.find(item => item.key === "Activo")?.total || 0,
      totalLiabilities: sections.find(item => item.key === "Pasivo")?.total || 0,
      totalPatrimony: sections.find(item => item.key === "Patrimonio")?.total || 0,
      resultPeriod: result.resultPeriod,
      patrimonyWithResult: round2((sections.find(item => item.key === "Patrimonio")?.total || 0) + result.resultPeriod)
    };
  }

  function accountMovementReport(filters = {}) {
    const resolved = resolveFilters(filters);
    if (!resolved.accountCode) {
      return {
        filters: resolved,
        ledger: null
      };
    }
    return {
      filters: resolved,
      ledger: journalService.ledgerByAccount(resolved.accountCode, {
        dateFrom: resolved.dateFrom,
        dateTo: resolved.dateTo,
        status: resolved.status || ""
      })
    };
  }

  function filteredPurchases(filters = {}) {
    const resolved = resolveFilters(filters);
    return purchaseService.purchases().filter(item => {
      const rowDate = item.accountingDate || item.issueDate || "";
      if (!matchesDate(rowDate, resolved.dateFrom, resolved.dateTo)) return false;
      if (resolved.providerId && item.supplierId !== resolved.providerId) return false;
      if (resolved.providerRuc && item.supplierRuc !== resolved.providerRuc) return false;
      if (resolved.status && item.status !== resolved.status) return false;
      if (!resolved.status && item.status === "ANULADO" && !resolved.includeAnnulled) return false;
      if (resolved.taxSupportCode && item.taxSupportCode !== resolved.taxSupportCode) return false;
      if (resolved.purchaseType && item.purchaseType !== resolved.purchaseType) return false;
      return true;
    });
  }

  function issuedWithholdingTotalsByPurchase() {
    const map = new Map();
    purchaseService.issuedWithholdings().forEach(item => {
      if (item.status === "ANULADA") return;
      const current = map.get(item.purchaseId) || { rent: 0, vat: 0, total: 0 };
      current.rent = round2(current.rent + Number(item.rentRetainedAmount || 0));
      current.vat = round2(current.vat + Number(item.vatRetainedAmount || 0));
      current.total = round2(current.total + Number(item.totalRetained || 0));
      map.set(item.purchaseId, current);
    });
    return map;
  }

  function purchasesByTaxSupport(filters = {}) {
    const rows = filteredPurchases(filters);
    const retentionMap = issuedWithholdingTotalsByPurchase();
    const supportMap = new Map();
    rows.forEach(item => {
      const support = purchaseService.taxSupportByCode(item.taxSupportCode) || { code: item.taxSupportCode || "SIN", description: "Sin sustento" };
      const current = supportMap.get(support.code) || {
        code: support.code,
        supportName: support.description,
        base0: 0,
        baseIva: 0,
        iva: 0,
        total: 0,
        retentionRent: 0,
        retentionVat: 0
      };
      const retentions = retentionMap.get(item.id) || { rent: 0, vat: 0 };
      current.base0 = round2(current.base0 + Number(item.totals?.base0 || 0));
      current.baseIva = round2(current.baseIva + Number(item.totals?.baseIva || 0));
      current.iva = round2(current.iva + Number(item.totals?.iva || 0));
      current.total = round2(current.total + Number(item.totals?.total || 0));
      current.retentionRent = round2(current.retentionRent + retentions.rent);
      current.retentionVat = round2(current.retentionVat + retentions.vat);
      supportMap.set(support.code, current);
    });
    return {
      filters: resolveFilters(filters),
      rows: Array.from(supportMap.values()).sort((a, b) => String(a.code).localeCompare(String(b.code), "es"))
    };
  }

  function purchasesBySupplier(filters = {}) {
    const rows = filteredPurchases(filters);
    const retentionMap = issuedWithholdingTotalsByPurchase();
    const supplierMap = new Map();
    rows.forEach(item => {
      const key = item.supplierId || item.supplierRuc || item.supplierName;
      const current = supplierMap.get(key) || {
        providerId: item.supplierId || "",
        providerName: item.supplierName || "Sin proveedor",
        providerRuc: item.supplierRuc || "",
        documents: 0,
        base0: 0,
        baseIva: 0,
        iva: 0,
        total: 0,
        retentions: 0
      };
      const retentions = retentionMap.get(item.id) || { total: 0 };
      current.documents += 1;
      current.base0 = round2(current.base0 + Number(item.totals?.base0 || 0));
      current.baseIva = round2(current.baseIva + Number(item.totals?.baseIva || 0));
      current.iva = round2(current.iva + Number(item.totals?.iva || 0));
      current.total = round2(current.total + Number(item.totals?.total || 0));
      current.retentions = round2(current.retentions + Number(retentions.total || 0));
      supplierMap.set(key, current);
    });
    return {
      filters: resolveFilters(filters),
      rows: Array.from(supplierMap.values()).sort((a, b) => String(a.providerName).localeCompare(String(b.providerName), "es"))
    };
  }

  function issuedWithholdingsReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = purchaseService.issuedWithholdings()
      .filter(item => {
        const rowDate = item.retentionDate || "";
        if (!matchesDate(rowDate, resolved.dateFrom, resolved.dateTo)) return false;
        if (resolved.providerId && item.providerId !== resolved.providerId && item.supplierId !== resolved.providerId) return false;
        if (resolved.status && item.status !== resolved.status) return false;
        return true;
      })
      .flatMap(item => {
        const result = [];
        if (Number(item.rentBaseAmount || 0) > 0 || item.rentCode || item.rentSriCode) {
          result.push({
            date: item.retentionDate,
            providerName: item.supplierName || "",
            providerRuc: item.supplierRuc || "",
            relatedDocument: item.purchaseDocumentNumber || "",
            retentionCode: item.rentSriCode || item.rentCode || "",
            taxType: "RENTA",
            baseAmount: num(item.rentBaseAmount),
            percentage: num(item.rentPercentage),
            retainedAmount: num(item.rentRetainedAmount),
            status: item.status,
            draftNumber: item.draftNumber || "",
            journalEntryNumber: item.journalEntryNumber || ""
          });
        }
        if (Number(item.vatBaseAmount || 0) > 0 || item.vatCode || item.vatSriCode) {
          result.push({
            date: item.retentionDate,
            providerName: item.supplierName || "",
            providerRuc: item.supplierRuc || "",
            relatedDocument: item.purchaseDocumentNumber || "",
            retentionCode: item.vatSriCode || item.vatCode || "",
            taxType: "IVA",
            baseAmount: num(item.vatBaseAmount),
            percentage: num(item.vatPercentage),
            retainedAmount: num(item.vatRetainedAmount),
            status: item.status,
            draftNumber: item.draftNumber || "",
            journalEntryNumber: item.journalEntryNumber || ""
          });
        }
        return result;
      });
    return { filters: resolved, rows };
  }

  function receivedWithholdingsReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = taxWithholdingService.receivedWithholdings()
      .filter(item => {
        const rowDate = item.issueDate || item.createdAt?.slice(0, 10) || "";
        if (!matchesDate(rowDate, resolved.dateFrom, resolved.dateTo)) return false;
        if (resolved.customerId && item.relatedCustomerId !== resolved.customerId && item.customerId !== resolved.customerId) return false;
        if (resolved.status && item.status !== resolved.status) return false;
        return true;
      })
      .flatMap(item => (item.lines || []).map(line => ({
        date: item.issueDate || "",
        customerName: item.issuerName || "",
        customerTaxId: item.issuerTaxId || "",
        supportDocument: item.supportDocumentNumber || item.relatedReceivableNumber || "",
        retentionCode: line.sriCode || line.code || "",
        taxType: line.taxType || "",
        baseAmount: num(line.baseAmount),
        percentage: num(line.percentage),
        retainedAmount: num(line.retainedAmount),
        status: item.status,
        documentNumber: item.documentNumber || "",
        journalEntryNumber: item.journalEntryNumber || ""
      })));
    return { filters: resolved, rows };
  }

  function flattenPaymentRows(filters = {}) {
    const resolved = resolveFilters(filters);
    const single = portfolioService.payments().flatMap(item =>
      (item.applications || []).map(application => ({
        date: item.paymentDate,
        providerId: item.providerId || application.providerId || "",
        providerName: item.providerName || application.supplierName || "",
        documentNumber: application.documentNumber || application.purchaseDocumentNumber || "",
        paymentMethod: item.paymentMethod || "",
        paymentAccount: item.paymentAccountName || item.paymentAccountCode || "",
        value: num(application.amount),
        status: item.status,
        entryNumber: item.entryNumber || "",
        source: "PAGO",
        paymentNumber: item.paymentNumber || ""
      }))
    );
    const batches = portfolioService.paymentBatches().flatMap(item =>
      (item.applications || []).map(application => ({
        date: item.paymentDate,
        providerId: application.providerId || item.providerId || "",
        providerName: application.supplierName || item.providerName || "",
        documentNumber: application.documentNumber || application.purchaseDocumentNumber || "",
        paymentMethod: item.paymentMethod || "",
        paymentAccount: item.paymentAccountName || item.paymentAccountCode || "",
        value: num(application.amount),
        status: item.status,
        entryNumber: item.entryNumber || "",
        source: "LOTE",
        paymentNumber: item.batchNumber || ""
      }))
    );
    return [...single, ...batches].filter(item => {
      if (!matchesDate(item.date, resolved.dateFrom, resolved.dateTo)) return false;
      if (resolved.providerId && item.providerId !== resolved.providerId) return false;
      if (resolved.status && item.status !== resolved.status) return false;
      return true;
    });
  }

  function flattenCollectionRows(filters = {}) {
    const resolved = resolveFilters(filters);
    const single = receivableService.collections().flatMap(item =>
      (item.applications || []).map(application => ({
        date: item.collectionDate,
        customerId: item.customerId || application.customerId || "",
        customerName: item.customerName || application.customerName || "",
        documentNumber: application.documentNumber || "",
        collectionMethod: item.collectionMethod || "",
        collectionAccount: item.collectionAccountName || item.collectionAccountCode || "",
        value: num(application.amount),
        status: item.status,
        entryNumber: item.entryNumber || "",
        source: "COBRO",
        collectionNumber: item.collectionNumber || ""
      }))
    );
    const batches = receivableService.collectionBatches().flatMap(item =>
      (item.applications || []).map(application => ({
        date: item.collectionDate,
        customerId: application.customerId || item.customerId || "",
        customerName: application.customerName || item.customerName || "",
        documentNumber: application.documentNumber || "",
        collectionMethod: item.collectionMethod || "",
        collectionAccount: item.collectionAccountName || item.collectionAccountCode || "",
        value: num(application.amount),
        status: item.status,
        entryNumber: item.entryNumber || "",
        source: "LOTE",
        collectionNumber: item.batchNumber || ""
      }))
    );
    return [...single, ...batches].filter(item => {
      if (!matchesDate(item.date, resolved.dateFrom, resolved.dateTo)) return false;
      if (resolved.customerId && item.customerId !== resolved.customerId) return false;
      if (resolved.status && item.status !== resolved.status) return false;
      return true;
    });
  }

  function payablesReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = portfolioService.payables({
      providerId: resolved.providerId || "",
      status: resolved.status || ""
    }).filter(item => {
      const rowDate = item.accountingDate || item.issueDate || "";
      return matchesDate(rowDate, resolved.dateFrom, resolved.dateTo);
    });
    const paymentRows = flattenPaymentRows(resolved);
    return {
      filters: resolved,
      rows,
      summary: {
        totalPending: round2(rows.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.state)).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalOverdue: round2(rows.filter(item => item.state === "VENCIDO").reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalUpcoming: round2(rows.filter(item => ["PENDIENTE", "PARCIAL"].includes(item.state) && Number(item.overdueDays || 0) === 0).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalPaidPeriod: round2(paymentRows.filter(item => item.status === "CONFIRMADO").reduce((sum, item) => sum + Number(item.value || 0), 0))
      }
    };
  }

  function receivablesReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = receivableService.receivables({
      customerId: resolved.customerId || "",
      status: resolved.status || ""
    }).filter(item => matchesDate(item.issueDate || "", resolved.dateFrom, resolved.dateTo));
    const collectionRows = flattenCollectionRows(resolved);
    return {
      filters: resolved,
      rows,
      summary: {
        totalPending: round2(rows.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.status)).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalOverdue: round2(rows.filter(item => item.status === "VENCIDO").reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalUpcoming: round2(rows.filter(item => ["PENDIENTE", "PARCIAL"].includes(item.status) && Number(item.overdueDays || 0) === 0).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
        totalCollectedPeriod: round2(collectionRows.filter(item => item.status === "CONFIRMADO").reduce((sum, item) => sum + Number(item.value || 0), 0))
      }
    };
  }

  function supplierPaymentsReport(filters = {}) {
    return {
      filters: resolveFilters(filters),
      rows: flattenPaymentRows(filters)
    };
  }

  function customerCollectionsReport(filters = {}) {
    return {
      filters: resolveFilters(filters),
      rows: flattenCollectionRows(filters)
    };
  }

  function openingBalanceBefore(account, dateFrom = "") {
    const priorRows = bankService.movements({ bankAccountId: account.id, dateTo: dateFrom ? new Date(new Date(dateFrom).getTime() - 86400000).toISOString().slice(0, 10) : "" });
    return round2(Number(account.openingBalance || 0) + priorRows
      .filter(item => item.status === "CONTABILIZADO")
      .reduce((sum, item) => sum + Number(item.incomeValue || 0) - Number(item.expenseValue || 0), 0));
  }

  function bankMovementsReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = bankService.movements({
      bankAccountId: resolved.bankAccountId || "",
      status: resolved.status || "",
      originModule: resolved.originModule || "",
      dateFrom: resolved.dateFrom || "",
      dateTo: resolved.dateTo || ""
    }).sort((a, b) => `${a.movementDate}|${a.movementNumber || ""}|${a.reference || ""}`.localeCompare(`${b.movementDate}|${b.movementNumber || ""}|${b.reference || ""}`, "es"));
    const accountMap = new Map(bankService.bankAccounts().map(account => [account.id, account]));
    const runningMap = new Map();
    const data = rows.map(item => {
      if (!runningMap.has(item.bankAccountId)) {
        const account = accountMap.get(item.bankAccountId);
        runningMap.set(item.bankAccountId, openingBalanceBefore(account || { openingBalance: 0, id: item.bankAccountId }, resolved.dateFrom));
      }
      let running = runningMap.get(item.bankAccountId) || 0;
      if (item.status === "CONTABILIZADO") {
        running = round2(running + Number(item.incomeValue || 0) - Number(item.expenseValue || 0));
        runningMap.set(item.bankAccountId, running);
      }
      return {
        ...item,
        auxiliaryBalance: running
      };
    });
    return { filters: resolved, rows: data };
  }

  function bankBalancesReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = bankService.accountsWithSummary().filter(item => {
      if (resolved.bankAccountId && item.id !== resolved.bankAccountId) return false;
      if (resolved.status && item.status !== resolved.status) return false;
      return true;
    }).map(item => ({
      bankName: item.bankName,
      code: item.code,
      linkedAccountCode: item.linkedAccountCode || "",
      openingBalance: num(item.summary?.openingBalance),
      incomes: num(item.summary?.incomes),
      expenses: num(item.summary?.expenses),
      currentBalance: num(item.summary?.currentBalance),
      status: item.status
    }));
    return { filters: resolved, rows };
  }

  function bankReconciliationsReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = reconciliationService.reconciliations()
      .filter(item => {
        if (resolved.bankAccountId && item.bankAccountId !== resolved.bankAccountId) return false;
        if (resolved.status && item.status !== resolved.status) return false;
        if (resolved.period && item.period !== resolved.period) return false;
        return true;
      })
      .map(item => {
        const context = reconciliationService.context(item);
        return {
          id: item.id,
          bankAccount: context.report.bankAccount,
          period: item.period,
          openingBalance: num(item.openingBankBalance),
          closingBankBalance: num(item.closingBankBalance),
          systemBalance: num(context.report.systemBalance),
          difference: num(context.report.difference),
          status: item.status,
          closeDate: item.closeDate || "",
          notes: item.notes || item.differenceJustification || ""
        };
      });
    return { filters: resolved, rows };
  }

  function inventoryStockReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = inventoryService.stockSummary({
      warehouseId: resolved.warehouseId || "",
      category: resolved.category || ""
    }).filter(item => {
      if (resolved.productId && item.itemId !== resolved.productId) return false;
      if (resolved.status && item.status !== resolved.status) return false;
      return true;
    });
    return { filters: resolved, rows };
  }

  function inventoryKardexReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = inventoryService.kardex({
      itemId: resolved.productId || "",
      category: resolved.category || "",
      warehouseId: resolved.warehouseId || "",
      movementType: resolved.movementType || "",
      dateFrom: resolved.dateFrom || "",
      dateTo: resolved.dateTo || ""
    });
    return { filters: resolved, rows };
  }

  function inventoryPurchaseEntriesReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = inventoryService.purchasesPendingInventory({ includeAnnulled: true })
      .filter(item => {
        if (resolved.dateFrom && String(item.accountingDate || "") < resolved.dateFrom) return false;
        if (resolved.dateTo && String(item.accountingDate || "") > resolved.dateTo) return false;
        if (resolved.status && item.inventoryStatus !== resolved.status) return false;
        if (resolved.providerId && item.supplierId !== resolved.providerId) return false;
        if (resolved.search) {
          const haystack = [
            item.documentNumber,
            item.supplierName,
            item.supplierRuc,
            item.authorizationNumber
          ].join(" ").toLowerCase();
          if (!haystack.includes(String(resolved.search || "").toLowerCase())) return false;
        }
        return true;
      })
      .map(item => ({
        date: item.accountingDate || item.issueDate || "",
        supplierName: item.supplierName || "",
        supplierRuc: item.supplierRuc || "",
        documentNumber: item.documentNumber || "",
        authorizationNumber: item.authorizationNumber || item.accessKey || "",
        totalInvoice: num(item.totalInvoice),
        inventoryLinesTotal: num(item.inventoryLinesTotal),
        totalEntered: num(item.totalEntered),
        difference: num(item.difference),
        inventoryStatus: item.inventoryStatus,
        movements: (item.movementRefs || []).map(ref => ref.movementNumber).join(", ")
      }));
    return { filters: resolved, rows };
  }

  function inventoryConsumptionsReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = inventoryService.movements({
      dateFrom: resolved.dateFrom || "",
      dateTo: resolved.dateTo || "",
      warehouseId: resolved.warehouseId || "",
      status: resolved.status || "CONFIRMADO"
    }).filter(item =>
      item.status === "CONFIRMADO"
      && item.movementType !== "SALIDA_PROVEEDOR"
      && String(item.movementType || "").startsWith("SALIDA_")
    ).flatMap(item => (item.lines || []).map(line => ({
      date: item.movementDate,
      movementNumber: item.movementNumber,
      productCode: line.itemCode || "",
      productName: line.itemName || "",
      category: inventoryService.findItemById(line.itemId)?.category || "",
      costCenter: line.costCenter || item.costCenter || "",
      quantity: num(line.quantity),
      unitCost: num(line.costUnit),
      totalCost: num(line.costTotal),
      expenseAccountCode: line.expenseAccountCode || "",
      expenseAccountName: chartService.findByCode(line.expenseAccountCode || "")?.name || "",
      journalEntryNumber: item.journalEntryNumber || ""
    }))).filter(item => {
      if (resolved.productId && item.productCode !== inventoryService.findItemById(resolved.productId)?.code) return false;
      if (resolved.category && item.category !== resolved.category) return false;
      if (resolved.costCenter && item.costCenter !== resolved.costCenter) return false;
      return true;
    });
    return { filters: resolved, rows };
  }

  function inventorySupplierDeliveriesReport(filters = {}) {
    const resolved = resolveFilters(filters);
    const rows = inventoryService.movements({
      dateFrom: resolved.dateFrom || "",
      dateTo: resolved.dateTo || "",
      status: resolved.status || ""
    }).filter(item => item.movementType === "SALIDA_PROVEEDOR" && item.status !== "ANULADO")
      .flatMap(item => (item.lines || []).map(line => ({
        date: item.movementDate,
        providerName: item.supplierName || "",
        block: item.costCenter || "",
        productCode: line.itemCode || "",
        productName: line.itemName || "",
        quantity: num(line.quantity),
        cost: num(line.costTotal),
        settlementStatus: item.settlementStatus || "pendiente de descontar",
        observation: line.observation || item.observation || ""
      })))
      .filter(item => {
        if (resolved.status && item.settlementStatus !== resolved.status) return false;
        return true;
      });
    return { filters: resolved, rows };
  }

  function dashboardSummary(filters = {}) {
    const resolved = resolveFilters(filters);
    const purchases = filteredPurchases(resolved);
    const payables = portfolioService.payables().filter(item => item.state !== "ANULADO");
    const receivables = receivableService.receivables().filter(item => item.status !== "ANULADO");
    const journal = journalService.journalSummaries(resolved.period || companyService.settings().activePeriod || "");
    const bankSummary = bankService.dashboardSummary();
    const issuedSummary = purchaseService.issuedWithholdingSummary();
    const receivedSummary = taxWithholdingService.receivedSummary();
    const inventoryAlerts = inventoryService.inventoryAlerts();
    const reconciliations = reconciliationService.reconciliations();
    const inventoryValue = inventoryService.stockSummary().reduce((sum, item) => sum + Number(item.value || 0), 0);

    return {
      filters: resolved,
      totalPurchases: round2(purchases.reduce((sum, item) => sum + Number(item.totals?.total || 0), 0)),
      pendingPayables: round2(payables.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.state)).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
      pendingReceivables: round2(receivables.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.status)).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
      totalBankAuxiliary: round2(bankSummary.totalAuxiliaryBalance),
      journalPosted: Number(journal.contabilized || 0),
      journalDrafts: Number(journal.drafts || 0),
      pendingIssuedWithholdings: Number(issuedSummary.drafts || 0) + Number(issuedSummary.pendingAuthorization || 0),
      pendingReceivedWithholdings: Number(receivedSummary.pendingRelation || 0) + Number(receivedSummary.imported || 0),
      lowStockProducts: Number(inventoryAlerts.lowStock.length || 0),
      openReconciliations: reconciliations.filter(item => ["BORRADOR", "EN_REVISION", "REABIERTA"].includes(item.status)).length,
      closedReconciliations: reconciliations.filter(item => item.status === "CERRADA").length,
      inventoryValue: round2(inventoryValue),
      accountingAlerts: Number(journal.outOfBalance || 0)
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.reports = {
    defaultFilters,
    dashboardSummary,
    trialBalance,
    incomeStatement,
    balanceSheet,
    accountMovementReport,
    purchasesByTaxSupport,
    purchasesBySupplier,
    issuedWithholdingsReport,
    receivedWithholdingsReport,
    payablesReport,
    receivablesReport,
    supplierPaymentsReport,
    customerCollectionsReport,
    bankMovementsReport,
    bankBalancesReport,
    bankReconciliationsReport,
    inventoryStockReport,
    inventoryKardexReport,
    inventoryPurchaseEntriesReport,
    inventoryConsumptionsReport,
    inventorySupplierDeliveriesReport
  };
})();
