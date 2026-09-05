(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;

  const runStates = ["BORRADOR", "CALCULADO", "APROBADO", "CONTABILIZADO", "PARCIALMENTE_PAGADO", "PAGADO", "ANULADO"];
  const lockedStates = ["APROBADO", "CONTABILIZADO", "PARCIALMENTE_PAGADO", "PAGADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function round4(value) {
    return Math.round(Number(value || 0) * 10000) / 10000;
  }

  function round8(value) {
    return Math.round(Number(value || 0) * 100000000) / 100000000;
  }

  function roundPerformance(value, precision = 8) {
    const safePrecision = Math.min(8, Math.max(7, Number(precision || 8)));
    const factor = 10 ** safePrecision;
    return Math.round(Number(value || 0) * factor) / factor;
  }

  function payrollStore() {
    const current = BlessERP.payrollService?.ensureStore?.() || stateApi.state.db.payroll || {};
    const listKeys = [
      "employees", "timeEntries", "workTimeEntries", "performanceEntries", "salespeople",
      "advances", "advanceMovements", "runs", "employeeItems", "components",
      "commissionSources", "manualAdjustments", "statusHistory", "payments",
      "paymentSplits", "checkDetails", "journalLinks", "documents"
    ];
    listKeys.forEach(key => { current[key] = Array.isArray(current[key]) ? current[key] : []; });
    const canonical = stateApi.state.db.payrollV2 || {};
    const mergeCanonical = (legacyKey, canonicalKey) => {
      const remoteRows = Array.isArray(canonical[canonicalKey]) ? canonical[canonicalKey] : [];
      if (!remoteRows.length) return;
      const remoteLegacyIds = new Set(remoteRows.map(item => String(item.legacyId || "")).filter(Boolean));
      const localRows = current[legacyKey].filter(item => !remoteLegacyIds.has(String(item.id || item.employee_id || "")));
      const byId = new Map(localRows.map(item => [String(item.id || item.employee_id || ""), item]));
      remoteRows.forEach(item => byId.set(String(item.id || item.employee_id || ""), clone(item)));
      current[legacyKey] = [...byId.values()];
    };
    mergeCanonical("employees", "employees");
    mergeCanonical("runs", "roles");
    mergeCanonical("employeeItems", "roleItems");
    mergeCanonical("components", "roleLines");
    mergeCanonical("payments", "payments");
    mergeCanonical("paymentSplits", "paymentSplits");
    mergeCanonical("statusHistory", "events");
    current.accountSettingsByCompany = current.accountSettingsByCompany && typeof current.accountSettingsByCompany === "object"
      ? current.accountSettingsByCompany
      : {};
    const sellerIds = new Set(current.salespeople.map(item => item.id));
    (current.employees || []).filter(item => item.seller_id).forEach(employee => {
      if (sellerIds.has(employee.seller_id)) return;
      current.salespeople.push({
        id: employee.seller_id,
        companyId: employee.company_id,
        employeeId: employee.employee_id,
        userId: employee.user_id || "",
        name: employee.full_name,
        status: employee.status === "ACTIVO" ? "ACTIVE" : "INACTIVE"
      });
      sellerIds.add(employee.seller_id);
    });
    stateApi.state.db.payroll = current;
    return current;
  }

  function currentUser() {
    return BlessERP.services.adminConfig?.activeUser?.()
      || stateApi.state.db.session?.activeUser
      || { id: "USR-DEMO", name: "Usuario demo" };
  }

  function employeeRows() {
    const apiRows = BlessERP.payrollService?.listEmployees?.();
    return clone(Array.isArray(apiRows) ? apiRows : payrollStore().employees);
  }

  function findEmployee(employeeId) {
    return employeeRows().find(item => String(item.employee_id || item.id || item.employeeId) === String(employeeId || "")) || null;
  }

  function employeeName(employee = {}) {
    return String(employee.full_name || employee.fullName || employee.names || employee.name || [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "").trim();
  }

  function activeEmployee(employee = {}) {
    return !["INACTIVO", "INACTIVE", "ANULADO"].includes(String(employee.status || "ACTIVO").toUpperCase());
  }

  function employeeCompanyId(employee = {}) {
    return String(employee.company_id || employee.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
  }

  function dateDiffInclusive(from, to) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
    return Math.floor((end - start) / 86400000) + 1;
  }

  function daysWorkedFor(employee, run, override = {}) {
    if (override.daysWorked !== undefined && override.daysWorked !== "") {
      return Math.max(0, Math.min(30, Number(override.daysWorked || 0)));
    }
    const employmentStart = String(employee.hire_date || employee.entryDate || employee.hireDate || run.dateFrom);
    const effectiveStart = employmentStart && employmentStart > run.dateFrom ? employmentStart : run.dateFrom;
    return Math.max(0, Math.min(30, dateDiffInclusive(effectiveStart, run.dateTo)));
  }

  function getMonthlySalary(employee = {}) {
    return Number(employee.monthly_salary ?? employee.monthlySalary ?? employee.baseSalary ?? employee.salary ?? 0);
  }

  function getHourlyRate(employee = {}) {
    const explicit = Number(employee.hourly_rate ?? employee.hourlyRate ?? employee.ratePerHour ?? 0);
    if (explicit > 0) return explicit;
    const divisor = Number(BlessERP.payrollService?.getParameters?.(employee.company_id)?.hour_divisor || payrollStore().parameters?.hourDivisor || payrollStore().parameterSet?.hourDivisor || 240);
    return divisor > 0 ? getMonthlySalary(employee) / divisor : 0;
  }

  function normalTimeEntries(employeeId, run) {
    const current = payrollStore();
    const serviceRows = BlessERP.payrollService?.listHourEntries?.({
      employee_id: employeeId,
      from: run.dateFrom,
      to: run.dateTo,
      status: "ACTIVO"
    }) || [];
    const rows = [...serviceRows, ...current.timeEntries, ...current.workTimeEntries];
    const seen = new Set();
    return rows.filter(entry => {
      const id = String(entry.hour_entry_id || entry.id || "");
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      const date = String(entry.date || entry.workDate || "");
      return String(entry.employee_id || entry.employeeId || "") === String(employeeId)
        && date >= run.dateFrom && date <= run.dateTo;
    });
  }

  function performanceRole(employeeId) {
    const operations = stateApi.state.db.operations || {};
    const operationalStore = BlessERP.operacionesState?.getStore?.(stateApi.state) || operations;
    const roleCatalogs = operationalStore.masterData || {};
    const linkedTo = type => (roleCatalogs[type] || []).some(item =>
      item.active !== false
      && String(item.employee_id || item.employeeId || "") === String(employeeId)
    );
    if (linkedTo("classifiers")) return "CLASSIFIER";
    if (linkedTo("bunchers")) return "BUNCHER";
    const employee = findEmployee(employeeId) || {};
    if (String(employee.company_id || employee.companyId || "") === "COMP-IMPERIO-FLOWERS") return "";
    const position = String(employee.position || employee.activity || "").toUpperCase();
    if (position.includes("CLASIFIC")) return "CLASSIFIER";
    if (position.includes("EMBONCH")) return "BUNCHER";
    const mode = String(employee.calculation_mode || employee.calculationMode || "").toUpperCase();
    const salesperson = payrollStore().salespeople.find(item => (
      String(item.employeeId || item.employee_id || "") === String(employeeId)
      && String(item.status || "ACTIVE").toUpperCase() !== "INACTIVE"
    ));
    if ((employee.seller_id || employee.sellerId || salesperson?.id)
      && ["PAGO_POR_RENDIMIENTO", "MIXTA"].includes(mode)) return "SELLER";
    return "";
  }

  function performanceEntries(employeeId, run) {
    const current = payrollStore();
    const operations = stateApi.state.db.operations || {};
    const role = performanceRole(employeeId);
    if (!role) return [];
    if (role === "SELLER") {
      const employee = findEmployee(employeeId) || {};
      const salesperson = current.salespeople.find(item => (
        String(item.employeeId || item.employee_id || "") === String(employeeId)
        && String(item.status || "ACTIVE").toUpperCase() !== "INACTIVE"
      ));
      const sellerId = String(employee.seller_id || employee.sellerId || salesperson?.id || "");
      const parameters = performanceParameters(run.companyId);
      const basis = String(parameters.seller_sales_basis || "GENERATED").toUpperCase();
      const orders = [
        ...(stateApi.state.db.commercial?.orders || []),
        ...(stateApi.state.db.sales || [])
      ];
      const seenSales = new Set();
      return orders.filter(order => {
        const orderId = String(order.id || order.number || "");
        if (orderId && seenSales.has(orderId)) return false;
        const linkedSeller = String(order.seller_id || order.sellerId || order.vendedorId || "");
        const companyId = String(order.company_id || order.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
        const date = String(order.issuedAt || order.issueDate || order.date || order.createdAt || "").slice(0, 10);
        const active = String(order.status || "").toUpperCase() !== "ANULADO";
        const applies = BlessERP.payrollCommissions?.appliesToBasis?.(order, basis) ?? active;
        const matches = linkedSeller === sellerId
          && companyId === String(run.companyId)
          && date >= run.dateFrom
          && date <= run.dateTo
          && active
          && applies;
        if (matches && orderId) seenSales.add(orderId);
        return matches;
      }).map(order => {
        const metrics = BlessERP.payrollCommissions?.orderMetrics?.(order)
          || BlessERP.comercialUtils?.getOrderMetrics?.(order)
          || {};
        return {
          id: `SALE:${order.id || order.number}`,
          performance_entry_id: `SALE:${order.id || order.number}`,
          employee_id: employeeId,
          date: String(order.issuedAt || order.issueDate || order.date || order.createdAt || "").slice(0, 10),
          activity: "VENTA",
          unit: "TALLOS",
          quantity: Number(metrics.totalStems || 0),
          source: "VENTAS",
          orderId: order.id || "",
          orderNumber: order.number || order.invoiceNumber || ""
        };
      }).filter(entry => entry.quantity > 0);
    }
    const serviceRows = BlessERP.payrollService?.listPerformanceEntries?.({
      employee_id: employeeId,
      from: run.dateFrom,
      to: run.dateTo,
      status: "ACTIVO"
    }) || [];
    const rows = [...serviceRows, ...current.performanceEntries, ...(operations.payrollPerformanceEntries || [])];
    const seen = new Set();
    return rows.filter(entry => {
      const activity = String(entry.activity || "").toUpperCase();
      const unit = String(entry.unit || "").toUpperCase();
      const isClassification = activity.includes("CLASIFIC") && unit === "TALLOS";
      const isBunching = activity.includes("EMBONCH") && unit === "BONCHES";
      if (!((role === "CLASSIFIER" && isClassification) || (role === "BUNCHER" && isBunching))) return false;
      const id = String(entry.performance_entry_id || entry.id || entry.performanceId || "");
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      const date = String(entry.date || entry.workDate || "");
      return String(entry.employee_id || entry.employeeId || "") === String(employeeId)
        && date >= run.dateFrom && date <= run.dateTo;
    });
  }

  function isoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
  }

  function dateAtUtc(value) {
    const normalized = isoDate(value);
    return normalized ? new Date(`${normalized}T00:00:00Z`) : null;
  }

  function workingDaysInRange(from, to, configuredDays = [1, 2, 3, 4, 5, 6]) {
    const start = dateAtUtc(from);
    const end = dateAtUtc(to);
    if (!start || !end || start > end) return 0;
    const allowed = new Set((configuredDays || []).map(Number));
    let count = 0;
    for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (allowed.has(cursor.getUTCDay())) count += 1;
    }
    return count;
  }

  function workingDaysInMonth(date, configuredDays) {
    const parsed = dateAtUtc(date);
    if (!parsed) return 0;
    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth();
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return workingDaysInRange(from, to, configuredDays);
  }

  function performanceParameters(companyId) {
    const configured = BlessERP.payrollService?.getParameters?.(companyId)?.performance_calculation;
    return {
      workday_hours: 8,
      reference_working_days: 21,
      precision: 8,
      working_days: [1, 2, 3, 4, 5, 6],
      classifier_reference_salary: 482,
      classifier_daily_stem_target: 5750,
      classifier_daily_mesh_target: 230,
      classifier_stems_per_mesh: 25,
      buncher_reference_salary: 482,
      buncher_daily_bunch_target: 200,
      buncher_stems_per_bunch: 25,
      seller_reference_salary: 482,
      seller_daily_stem_target: 320000,
      seller_sales_basis: "GENERATED",
      ...(configured || {})
    };
  }

  function performanceReferenceSalary(role, parameters) {
    if (role === "CLASSIFIER") return Number(parameters.classifier_reference_salary || 0);
    if (role === "BUNCHER") return Number(parameters.buncher_reference_salary || 0);
    if (role === "SELLER") return Number(parameters.seller_reference_salary || 0);
    return 0;
  }

  function performanceDailyTarget(role, parameters) {
    if (role === "CLASSIFIER") return Number(parameters.classifier_daily_stem_target || 0);
    if (role === "BUNCHER") return Number(parameters.buncher_daily_bunch_target || 0);
    if (role === "SELLER") return Number(parameters.seller_daily_stem_target || 0);
    return 0;
  }

  function performanceRateForDays(role, workingDays, parameters) {
    const denominator = Number(workingDays || 0) * performanceDailyTarget(role, parameters);
    return denominator > 0
      ? roundPerformance(performanceReferenceSalary(role, parameters) / denominator, parameters.precision)
      : 0;
  }

  function automaticPerformanceRate(role, date, companyId) {
    const parameters = performanceParameters(companyId);
    return performanceRateForDays(role, Number(parameters.reference_working_days || 21), parameters);
  }

  function performanceSummary(employeeId, run, rows = []) {
    const role = performanceRole(employeeId);
    const parameters = performanceParameters(run.companyId);
    if (!role) return {
      role: "", unit: "", quantity: 0, total: 0, rate: 0, targetQuantity: 0,
      workingDays: 0, referenceSalary: 0, efficiency: 0, details: []
    };
    const unit = role === "BUNCHER" ? "BONCHES" : "TALLOS";
    const dailyTarget = performanceDailyTarget(role, parameters);
    const workingDays = workingDaysInRange(run.dateFrom, run.dateTo, parameters.working_days);
    const periodRate = performanceRateForDays(role, Number(parameters.reference_working_days || 21), parameters);
    const details = rows.map(entry => {
      const quantity = Number(entry.quantity ?? entry.completedQuantity ?? entry.bunches ?? entry.stems ?? 0);
      const date = isoDate(entry.date || entry.workDate) || run.dateTo;
      const rate = periodRate;
      return { entryId: entry.performance_entry_id || entry.id || "", date, quantity, rate, amount: quantity * rate };
    });
    const quantity = details.reduce((sum, row) => sum + row.quantity, 0);
    const rawTotal = details.reduce((sum, row) => sum + row.amount, 0);
    const targetQuantity = workingDays * dailyTarget;
    const referenceSalary = performanceReferenceSalary(role, parameters);
    return {
      role,
      unit,
      quantity: round4(quantity),
      total: round2(rawTotal),
      rate: periodRate,
      targetQuantity: round4(targetQuantity),
      dailyTarget: round4(dailyTarget),
      workingDays,
      workdayHours: Number(parameters.workday_hours || 8),
      referenceSalary,
      precision: Number(parameters.precision || 8),
      stemEquivalentRate: role === "BUNCHER"
        ? roundPerformance(periodRate / Number(parameters.buncher_stems_per_bunch || 25), parameters.precision)
        : periodRate,
      efficiency: targetQuantity > 0 ? round2(quantity / targetQuantity * 100) : 0,
      parameters: clone(parameters),
      details
    };
  }

  function timeEntryTotal(entry, employee, additional = false) {
    const hours = Number(additional
      ? entry.additional_hours ?? entry.additionalHours ?? entry.overtimeHours ?? (String(entry.hour_type || entry.hourType || entry.type || "").toUpperCase() === "NORMAL" ? 0 : entry.hours || 0)
      : entry.normal_hours ?? entry.normalHours ?? (String(entry.hour_type || entry.hourType || entry.type || "NORMAL").toUpperCase() === "NORMAL" ? entry.hours || 0 : 0));
    const rate = Number(entry.hourly_rate ?? entry.hourlyRate ?? entry.ratePerHour ?? getHourlyRate(employee));
    const multiplier = additional ? Number(entry.multiplier || 1) : 1;
    return round2(hours * rate * multiplier);
  }

  function advanceBalance(employeeId) {
    const current = payrollStore();
    return round2(current.advances
      .filter(item => String(item.employeeId || "") === String(employeeId) && String(item.status || "ACTIVE").toUpperCase() !== "ANULADO")
      .reduce((sum, advance) => {
        if (advance.balance !== undefined) return sum + Number(advance.balance || 0);
        const movements = current.advanceMovements.filter(item => item.advanceId === advance.id && String(item.status || "CONFIRMED").toUpperCase() !== "ANULADO");
        const movementBalance = movements.reduce((total, movement) => {
          const type = String(movement.type || "").toUpperCase();
          return total + (["ISSUE", "ENTREGA", "ADJUST_DEBIT"].includes(type) ? Number(movement.amount || 0) : -Number(movement.amount || 0));
        }, 0);
        return sum + (movements.length ? movementBalance : Number(advance.originalAmount || advance.amount || 0));
      }, 0));
  }

  function component(code, type, label, amount, accountKey, sourceType, sourceId = "", snapshot = {}) {
    return {
      id: uid("PCO"),
      code,
      type,
      label,
      calculatedAmount: round2(amount),
      amount: round2(amount),
      accountKey,
      sourceType,
      sourceId,
      snapshot: clone(snapshot)
    };
  }

  function calculateEmployee(run, employee, override = {}) {
    const employeeId = employee.employee_id || employee.id || employee.employeeId;
    const performanceRoleCode = performanceRole(employeeId);
    const performanceStart = String(employee.hire_date || employee.entryDate || employee.hireDate || run.dateFrom) > run.dateFrom
      ? String(employee.hire_date || employee.entryDate || employee.hireDate)
      : run.dateFrom;
    const daysWorked = override.daysWorked !== undefined && override.daysWorked !== ""
      ? Math.max(0, Math.min(30, Number(override.daysWorked || 0)))
      : performanceRoleCode
        ? workingDaysInRange(performanceStart, run.dateTo, performanceParameters(run.companyId).working_days)
        : daysWorkedFor(employee, run, override);
    const salaryModeSource = String(override.salaryCalculation || employee.salary_payment_mode || employee.salaryCalculation || "FULL").toUpperCase();
    const salaryMode = salaryModeSource === "PROPORCIONAL" ? "PROPORTIONAL" : salaryModeSource === "COMPLETO" ? "FULL" : salaryModeSource;
    const monthlySalary = getMonthlySalary(employee);
    const salary = performanceRoleCode
      ? 0
      : salaryMode === "PROPORTIONAL"
        ? round2(monthlySalary / 30 * daysWorked)
        : round2(monthlySalary);
    const timeRows = normalTimeEntries(employeeId, run);
    const normalHoursPay = round2(timeRows.reduce((sum, entry) => sum + timeEntryTotal(entry, employee, false), 0));
    const overtimePay = round2(timeRows.reduce((sum, entry) => sum + timeEntryTotal(entry, employee, true), 0));
    const performanceRows = performanceEntries(employeeId, run);
    const calculatedPerformance = performanceSummary(employeeId, run, performanceRows);
    const performancePay = calculatedPerformance.total;
    const salesperson = payrollStore().salespeople.find(item => String(item.employeeId || "") === String(employeeId) && String(item.status || "ACTIVE").toUpperCase() !== "INACTIVE");
    const sellerId = override.sellerId || employee.seller_id || employee.sellerId || salesperson?.id || "";
    const commission = sellerId
      ? BlessERP.payrollCommissions.calculate({
          sellerId,
          companyId: run.companyId,
          period: { id: run.periodId, companyId: run.companyId, from: run.dateFrom, to: run.dateTo },
          exclusions: override.commissionExclusions || []
        })
      : { total: 0, details: [], rule: null, manualBonus: 0 };
    const pass = Number(override.transport ?? override.pasajes ?? 0);
    const bonus = Number(override.bonuses ?? override.bonificaciones ?? 0);
    const otherIncome = Number(override.otherIncome ?? 0);
    const food = Number(override.foodDeduction ?? override.alimentacion ?? 0);
    const fines = Number(override.fines ?? override.multas ?? 0);
    const otherDiscounts = Number(override.otherDiscounts ?? 0);
    const requestedAdvance = Number(override.advanceDeduction ?? override.anticipos ?? 0);
    const availableAdvance = advanceBalance(employeeId);
    const advanceDeduction = round2(Math.min(Math.max(0, requestedAdvance), availableAdvance));

    const components = [
      component("SALARY", "EARNING", "Sueldo", salary, "payrollSalaries", "EMPLOYEE_PROFILE", employeeId, {
        monthlySalary,
        daysWorked,
        salaryMode,
        referenceOnly: Boolean(performanceRoleCode),
        performanceRole: performanceRoleCode
      }),
      component("NORMAL_HOURS", "EARNING", "Pago por horas", normalHoursPay, "payrollSalaries", "TIME_ENTRIES", "", { entries: clone(timeRows) }),
      component("PERFORMANCE", "EARNING", "Pago por rendimiento", performancePay, "payrollPiecework", "PERFORMANCE_ENTRIES", "", {
        entries: clone(performanceRows),
        performanceSummary: calculatedPerformance
      }),
      component("OVERTIME", "EARNING", "Horas adicionales", overtimePay, "payrollOvertime", "TIME_ENTRIES", "", { entries: clone(timeRows) }),
      component("TRANSPORT", "EARNING", "Pasajes", pass, "payrollTransport", "MANUAL"),
      component("BONUS", "EARNING", "Bonificaciones", bonus, "payrollBonuses", "MANUAL"),
      component("COMMISSION", "EARNING", "Comisiones", commission.total, "payrollCommissions", "SALES_SNAPSHOT", "", { rule: commission.rule, details: commission.details }),
      component("OTHER_INCOME", "EARNING", "Otros ingresos", otherIncome, "payrollOtherIncome", "MANUAL"),
      component("FOOD", "DEDUCTION", "Alimentación", food, "payrollFoodRecovery", "MANUAL"),
      component("FINES", "DEDUCTION", "Multas", fines, "payrollFinesRecovery", "MANUAL"),
      component("ADVANCE", "DEDUCTION", "Anticipos", advanceDeduction, "employeeAdvances", "ADVANCE_BALANCE", "", { availableAdvance }),
      component("OTHER_DISCOUNTS", "DEDUCTION", "Otros descuentos", otherDiscounts, "payrollOtherDiscounts", "MANUAL")
    ];
    const totalIncome = round2(components.filter(item => item.type === "EARNING").reduce((sum, item) => sum + item.amount, 0));
    const totalDiscounts = round2(components.filter(item => item.type === "DEDUCTION").reduce((sum, item) => sum + item.amount, 0));
    return {
      item: {
        id: uid("PEI"),
        runId: run.id,
        periodId: run.periodId,
        companyId: run.companyId,
        employeeId,
        employeeCode: employee.code || employee.internalCode || "",
        identification: employee.identification || employee.documentNumber || "",
        employeeName: employeeName(employee),
        area: employee.area || "",
        position: employee.position || employee.activity || employee.jobTitle || "",
        calculationMode: employee.calculation_mode || employee.calculationMode || employee.mode || "MIXED",
        daysWorked,
        salaryCalculation: salaryMode,
        totalIncome,
        totalDiscounts,
        netPay: round2(totalIncome - totalDiscounts),
        paidAmount: 0,
        pendingBalance: round2(totalIncome - totalDiscounts),
        paymentStatus: "PENDIENTE",
        paymentMethod: "",
        status: "CALCULADO",
        snapshot: {
          employee: clone(employee),
          calculatedAt: new Date().toISOString(),
          timeEntryIds: timeRows.map(item => item.hour_entry_id || item.id),
          performanceEntryIds: performanceRows.map(item => item.performance_entry_id || item.id),
          sellerId,
          commissionRule: commission.rule
        }
      },
      components,
      commissionSources: commission.details
    };
  }

  function createRun(payload = {}) {
    const current = payrollStore();
    const companyId = String(payload.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
    const dateFrom = String(payload.dateFrom || payload.from || "");
    const dateTo = String(payload.dateTo || payload.to || "");
    const errors = [];
    if (!dateFrom || !dateTo) errors.push("El periodo desde y hasta es obligatorio.");
    if (dateFrom && dateTo && dateFrom > dateTo) errors.push("La fecha inicial no puede ser posterior a la final.");
    const duplicate = current.runs.find(item => item.companyId === companyId && item.dateFrom === dateFrom && item.dateTo === dateTo && item.status !== "ANULADO");
    if (duplicate) errors.push("Ya existe un rol activo para la misma empresa y periodo.");
    if (errors.length) return { ok: false, errors };
    const user = currentUser();
    const sequence = current.runs.reduce((max, item) => Math.max(max, Number(String(item.number || "").split("-").pop() || 0)), 0) + 1;
    const run = {
      id: uid("PAYRUN"),
      number: `ROL-${dateFrom.slice(0, 4) || new Date().getFullYear()}-${String(sequence).padStart(5, "0")}`,
      companyId,
      periodId: payload.periodId || `${companyId}-${dateFrom}-${dateTo}`,
      dateFrom,
      dateTo,
      generatedAt: payload.generatedAt || today(),
      area: payload.area || "TODAS",
      status: "BORRADOR",
      selectedEmployeeIds: Array.isArray(payload.employeeIds) ? [...new Set(payload.employeeIds)] : [],
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: user.name,
      notes: payload.notes || "",
      totals: { employees: 0, income: 0, discounts: 0, net: 0, paid: 0, pending: 0 }
    };
    current.runs.unshift(run);
    current.statusHistory.unshift({
      id: uid("PSH"), runId: run.id, previousStatus: "", nextStatus: "BORRADOR",
      reason: "Creación del periodo de rol", userId: user.id, userName: user.name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    return { ok: true, run: clone(run) };
  }

  function buildCalculatedRun(payload = {}) {
    const current = payrollStore();
    const companyId = String(payload.companyId || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER");
    const dateFrom = String(payload.dateFrom || payload.from || "");
    const dateTo = String(payload.dateTo || payload.to || "");
    const errors = [];
    if (!dateFrom || !dateTo) errors.push("El periodo desde y hasta es obligatorio.");
    if (dateFrom && dateTo && dateFrom > dateTo) errors.push("La fecha inicial no puede ser posterior a la final.");
    const duplicate = current.runs.find(item => String(item.id || "") !== String(payload.ignoreRoleId || "")
      && String(item.companyId || item.company_id || "") === companyId
      && String(item.dateFrom || item.date_from || "") === dateFrom && String(item.dateTo || item.date_to || "") === dateTo
      && !["ANULADO","REVERSED"].includes(String(item.status || "").toUpperCase()));
    if (duplicate) errors.push("Ya existe un rol activo para la misma empresa y periodo.");
    if (errors.length) return { ok:false, errors };
    const selectedIds = Array.isArray(payload.employeeIds) ? [...new Set(payload.employeeIds.map(String))] : [];
    let selected = employeeRows().filter(activeEmployee).filter(item => employeeCompanyId(item) === companyId);
    if (selectedIds.length) selected = selected.filter(item => selectedIds.includes(String(item.employee_id || item.id || item.employeeId)));
    if (payload.area && payload.area !== "TODAS") selected = selected.filter(item => String(item.area || "").toUpperCase() === String(payload.area).toUpperCase());
    if (!selected.length) return { ok:false, errors:["No existen trabajadores seleccionados para calcular."] };
    const user = currentUser();
    const roleId = globalThis.crypto?.randomUUID?.() || uid("PAYRUN");
    const run = {
      id:roleId, number:"", companyId, periodId:`${companyId}-${dateFrom}-${dateTo}`, dateFrom, dateTo,
      generatedAt:String(payload.generatedAt || today()), area:payload.area || "TODAS", status:"CALCULATED",
      selectedEmployeeIds:selected.map(item => String(item.employee_id || item.id || item.employeeId)),
      createdBy:user.id, createdByName:user.name, notes:String(payload.notes || ""),
      totals:{ employees:0,income:0,discounts:0,net:0,paid:0,pending:0 }
    };
    const items=[]; const components=[]; const commissionSources=[];
    selected.forEach(employee => {
      const employeeId = String(employee.employee_id || employee.id || employee.employeeId);
      const result = calculateEmployee(run,employee,payload.employeeOverrides?.[employeeId] || {});
      items.push(result.item);
      result.components.forEach(item => components.push({ ...item,runId:roleId,employeeItemId:result.item.id,employeeId }));
      result.commissionSources.forEach(item => commissionSources.push({ ...item,runId:roleId,employeeItemId:result.item.id,employeeId }));
    });
    run.totals = {
      employees:items.length,
      income:round2(items.reduce((sum,item)=>sum+Number(item.totalIncome || 0),0)),
      discounts:round2(items.reduce((sum,item)=>sum+Number(item.totalDiscounts || 0),0)),
      net:round2(items.reduce((sum,item)=>sum+Number(item.netPay || 0),0)), paid:0,
      pending:round2(items.reduce((sum,item)=>sum+Number(item.netPay || 0),0))
    };
    return { ok:true,run,items,components,commissionSources,employees:selected };
  }

  function recalculateRunTotals(runId) {
    const current = payrollStore();
    const run = current.runs.find(item => item.id === runId);
    if (!run) return null;
    const items = current.employeeItems.filter(item => item.runId === runId && item.status !== "ANULADO");
    run.totals = {
      employees: items.length,
      income: round2(items.reduce((sum, item) => sum + Number(item.totalIncome || 0), 0)),
      discounts: round2(items.reduce((sum, item) => sum + Number(item.totalDiscounts || 0), 0)),
      net: round2(items.reduce((sum, item) => sum + Number(item.netPay || 0), 0)),
      paid: round2(items.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0)),
      pending: round2(items.reduce((sum, item) => sum + Number(item.pendingBalance || 0), 0))
    };
    return run.totals;
  }

  function calculateRun(runId, options = {}) {
    const current = payrollStore();
    const run = current.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    if (lockedStates.includes(run.status)) return { ok: false, errors: ["El rol está bloqueado y no se puede recalcular."] };
    let selected = employeeRows()
      .filter(activeEmployee)
      .filter(item => employeeCompanyId(item) === String(run.companyId || ""));
    if (run.selectedEmployeeIds.length) {
      selected = selected.filter(item => run.selectedEmployeeIds.includes(item.employee_id || item.id || item.employeeId));
    }
    if (run.area && run.area !== "TODAS") selected = selected.filter(item => String(item.area || "").toUpperCase() === run.area);
    if (!selected.length) return { ok: false, errors: ["No existen trabajadores seleccionados para calcular."] };
    current.employeeItems = current.employeeItems.filter(item => item.runId !== runId);
    current.components = current.components.filter(item => item.runId !== runId);
    current.commissionSources = current.commissionSources.filter(item => item.runId !== runId);
    selected.forEach(employee => {
      const employeeId = employee.employee_id || employee.id || employee.employeeId;
      const result = calculateEmployee(run, employee, options.employeeOverrides?.[employeeId] || {});
      current.employeeItems.push(result.item);
      result.components.forEach(item => current.components.push({ ...item, runId, employeeItemId: result.item.id, employeeId }));
      result.commissionSources.forEach(item => current.commissionSources.push({ ...item, runId, employeeItemId: result.item.id, employeeId, snapshotAt: new Date().toISOString() }));
    });
    const previousStatus = run.status;
    run.status = "CALCULADO";
    run.calculatedAt = new Date().toISOString();
    run.calculatedBy = currentUser().id;
    recalculateRunTotals(runId);
    current.statusHistory.unshift({
      id: uid("PSH"), runId, previousStatus, nextStatus: run.status, reason: "Cálculo integral del rol",
      userId: currentUser().id, userName: currentUser().name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "CALCULAR_ROL", entityType: "payroll_run", entityId: run.id,
      entityLabel: run.number, previousStatus, nextStatus: run.status,
      description: `Rol ${run.number} calculado para ${run.totals.employees} trabajador(es).`, after: run, result: "exitoso"
    });
    return { ok: true, run: clone(run), items: clone(current.employeeItems.filter(item => item.runId === runId)) };
  }

  function recalculateItem(itemId) {
    const current = payrollStore();
    const item = current.employeeItems.find(row => row.id === itemId);
    if (!item) return null;
    const components = current.components.filter(row => row.employeeItemId === itemId);
    item.totalIncome = round2(components.filter(row => row.type === "EARNING").reduce((sum, row) => sum + Number(row.amount || 0), 0));
    item.totalDiscounts = round2(components.filter(row => row.type === "DEDUCTION").reduce((sum, row) => sum + Number(row.amount || 0), 0));
    item.netPay = round2(item.totalIncome - item.totalDiscounts);
    item.pendingBalance = round2(item.netPay - Number(item.paidAmount || 0));
    recalculateRunTotals(item.runId);
    return item;
  }

  function adjustEmployeeItem(employeeItemId, payload = {}) {
    const current = payrollStore();
    const item = current.employeeItems.find(row => row.id === String(employeeItemId || ""));
    if (!item) return { ok: false, errors: ["Detalle del trabajador no encontrado."] };
    const run = current.runs.find(row => row.id === item.runId);
    if (!run || lockedStates.includes(run.status)) return { ok: false, errors: ["Solo se puede ajustar antes de aprobar."] };
    const reason = String(payload.reason || "").trim();
    if (!reason) return { ok: false, errors: ["El motivo de modificación es obligatorio."] };

    const requestedComponents = Array.isArray(payload.components) ? payload.components : [];
    const componentRows = current.components.filter(row => row.employeeItemId === item.id);
    const changes = [];
    const errors = [];
    requestedComponents.forEach(request => {
      const componentRow = componentRows.find(row => row.id === String(request.componentId || request.id || ""));
      if (!componentRow) {
        errors.push("Uno de los conceptos a modificar no pertenece al trabajador.");
        return;
      }
      const newValue = Number(request.value);
      if (!Number.isFinite(newValue) || newValue < 0) {
        errors.push(`${componentRow.label}: el valor debe ser un número igual o mayor que cero.`);
        return;
      }
      if (componentRow.code === "ADVANCE") {
        const available = Number(componentRow.snapshot?.availableAdvance || 0);
        if (newValue > available) errors.push(`Anticipos: el valor no puede superar el saldo disponible de ${available.toFixed(2)}.`);
      }
      const normalizedValue = round2(newValue);
      if (normalizedValue !== Number(componentRow.amount || 0)) changes.push({ componentRow, newValue: normalizedValue });
    });

    const requestedDays = payload.daysWorked;
    let daysChange = null;
    if (requestedDays !== undefined && requestedDays !== "") {
      const newDays = Number(requestedDays);
      if (!Number.isFinite(newDays) || newDays < 0 || newDays > 30) {
        errors.push("Los días laborados deben estar entre 0 y 30.");
      } else if (round2(newDays) !== Number(item.daysWorked || 0)) {
        daysChange = { previousValue: Number(item.daysWorked || 0), newValue: round2(newDays) };
      }
    }
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    if (daysChange && item.salaryCalculation === "PROPORTIONAL") {
      const salaryRow = componentRows.find(row => row.code === "SALARY");
      const requestedSalary = requestedComponents.find(row => String(row.componentId || row.id || "") === salaryRow?.id);
      const salaryAlreadyChanged = changes.some(row => row.componentRow.id === salaryRow?.id);
      if (salaryRow && !salaryAlreadyChanged && Number(requestedSalary?.value) === Number(salaryRow.amount || 0)) {
        changes.push({
          componentRow: salaryRow,
          newValue: round2(Number(salaryRow.snapshot?.monthlySalary || 0) / 30 * daysChange.newValue)
        });
      }
    }
    if (!changes.length && !daysChange) return { ok: false, errors: ["No existen cambios para guardar."] };

    const timestamp = new Date().toISOString();
    const user = currentUser();
    const adjustments = [];
    changes.forEach(({ componentRow, newValue }) => {
      const previousValue = Number(componentRow.amount || 0);
      componentRow.amount = newValue;
      componentRow.manualOverride = true;
      componentRow.overrideReason = reason;
      componentRow.modifiedAt = timestamp;
      componentRow.modifiedBy = user.id;
      adjustments.push({
        id: uid("PADJ"), runId: componentRow.runId, employeeItemId: componentRow.employeeItemId,
        employeeId: componentRow.employeeId, componentId: componentRow.id, componentCode: componentRow.code,
        previousValue, newValue, reason, userId: user.id, userName: user.name, createdAt: timestamp
      });
    });
    if (daysChange) {
      item.daysWorked = daysChange.newValue;
      adjustments.push({
        id: uid("PADJ"), runId: item.runId, employeeItemId: item.id, employeeId: item.employeeId,
        componentId: "", componentCode: "DAYS_WORKED", previousValue: daysChange.previousValue,
        newValue: daysChange.newValue, reason, userId: user.id, userName: user.name, createdAt: timestamp
      });
    }
    current.manualAdjustments.unshift(...adjustments);
    const recalculatedItem = recalculateItem(item.id);
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "AJUSTAR_DETALLE_ROL", entityType: "payroll_employee_item",
      entityId: item.id, entityLabel: item.employeeName,
      description: `Se guardaron ${adjustments.length} ajuste(s) del rol para ${item.employeeName}.`,
      reason,
      before: adjustments.map(row => ({ componentCode: row.componentCode, value: row.previousValue })),
      after: adjustments.map(row => ({ componentCode: row.componentCode, value: row.newValue })),
      result: "exitoso"
    });
    return { ok: true, item: clone(recalculatedItem), adjustments: clone(adjustments) };
  }

  function adjustComponent(componentId, newValue, reason) {
    const current = payrollStore();
    const componentRow = current.components.find(item => item.id === componentId);
    if (!componentRow) return { ok: false, errors: ["Componente no encontrado."] };
    const result = adjustEmployeeItem(componentRow.employeeItemId, {
      reason,
      components: [{ componentId, value: newValue }]
    });
    if (!result.ok) return result;
    return {
      ...result,
      component: clone(current.components.find(item => item.id === componentId)),
      adjustment: clone(result.adjustments[0])
    };
  }

  function approveRun(runId) {
    const current = payrollStore();
    const run = current.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    if (run.status !== "CALCULADO") return { ok: false, errors: ["Solo se puede aprobar un rol calculado."] };
    const items = current.employeeItems.filter(item => item.runId === runId);
    const errors = [];
    if (!items.length) errors.push("El rol no contiene trabajadores.");
    items.forEach(item => {
      if (item.netPay < 0) errors.push(`${item.employeeName}: el neto no puede ser negativo.`);
      const duplicate = current.employeeItems.find(other => other.id !== item.id && other.employeeId === item.employeeId && other.periodId === item.periodId && other.status !== "ANULADO");
      if (duplicate) errors.push(`${item.employeeName}: ya tiene otro rol activo en el periodo.`);
    });
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };
    const previousStatus = run.status;
    run.status = "APROBADO";
    run.approvedAt = new Date().toISOString();
    run.approvedBy = currentUser().id;
    run.approvedByName = currentUser().name;
    run.snapshot = {
      items: clone(items),
      components: clone(current.components.filter(item => item.runId === runId)),
      commissions: clone(current.commissionSources.filter(item => item.runId === runId)),
      approvedAt: run.approvedAt
    };
    items.forEach(item => { item.status = "APROBADO"; });
    current.statusHistory.unshift({
      id: uid("PSH"), runId, previousStatus, nextStatus: run.status, reason: "Aprobación y bloqueo de snapshots",
      userId: currentUser().id, userName: currentUser().name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "APROBAR_ROL", entityType: "payroll_run", entityId: run.id,
      entityLabel: run.number, previousStatus, nextStatus: run.status,
      description: `Rol ${run.number} aprobado y bloqueado.`, after: run, result: "exitoso"
    });
    return { ok: true, run: clone(run) };
  }

  function cancelRun(runId, reason) {
    const current = payrollStore();
    const run = current.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    if (run.status === "ANULADO") return { ok: false, errors: ["El rol ya está anulado."] };
    if (!String(reason || "").trim()) return { ok: false, errors: ["El motivo de anulación es obligatorio."] };
    if (["CONTABILIZADO", "PARCIALMENTE_PAGADO", "PAGADO"].includes(run.status)) {
      return BlessERP.payrollAccounting?.reverseAndCancel?.(runId, reason)
        || { ok: false, errors: ["Debe reversar los movimientos contables antes de anular."] };
    }
    const previousStatus = run.status;
    run.status = "ANULADO";
    run.cancelledAt = new Date().toISOString();
    run.cancelledBy = currentUser().id;
    run.cancelReason = String(reason);
    current.employeeItems.filter(item => item.runId === runId).forEach(item => { item.status = "ANULADO"; });
    current.statusHistory.unshift({
      id: uid("PSH"), runId, previousStatus, nextStatus: "ANULADO", reason,
      userId: currentUser().id, userName: currentUser().name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    return { ok: true, run: clone(run) };
  }

  function runs(filters = {}) {
    return clone(payrollStore().runs).filter(run => {
      if (filters.status && run.status !== filters.status) return false;
      if (filters.companyId && run.companyId !== filters.companyId) return false;
      return true;
    });
  }

  function getRun(runId) {
    return clone(payrollStore().runs.find(item => item.id === runId) || null);
  }

  function items(runId) {
    return clone(payrollStore().employeeItems.filter(item => !runId || item.runId === runId));
  }

  function components(employeeItemId) {
    return clone(payrollStore().components.filter(item => !employeeItemId || item.employeeItemId === employeeItemId));
  }

  BlessERP.payrollEngine = {
    runStates,
    lockedStates,
    payrollStore,
    buildCalculatedRun,
    createRun,
    calculateRun,
    calculateEmployee,
    performanceRole,
    performanceSummary,
    automaticPerformanceRate,
    performanceRateForDays,
    roundPerformance,
    round8,
    workingDaysInRange,
    adjustEmployeeItem,
    adjustComponent,
    approveRun,
    cancelRun,
    recalculateItem,
    recalculateRunTotals,
    advanceBalance,
    runs,
    getRun,
    items,
    components,
    findEmployee
  };
})();
