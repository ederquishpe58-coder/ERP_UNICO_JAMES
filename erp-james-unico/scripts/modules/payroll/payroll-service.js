(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.payrollData;
  const rules = BlessERP.payrollRules;

  if (!data || !rules) {
    throw new Error("Rol de pagos requiere payroll-data.js y payroll-rules.js antes de payroll-service.js.");
  }

  function clone(value) {
    const cloneApi = BlessERP.utils?.clone;
    return cloneApi ? cloneApi(value) : JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    const uidApi = BlessERP.utils?.uid;
    return uidApi
      ? uidApi(prefix)
      : `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function firstDefined(source, keys, fallback) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source || {}, key) && source[key] !== undefined) return source[key];
    }
    return fallback;
  }

  function database() {
    const liveDb = BlessERP.state?.state?.db;
    if (liveDb) return liveDb;
    BlessERP.__payrollLocalDb = BlessERP.__payrollLocalDb || {};
    return BlessERP.__payrollLocalDb;
  }

  function persist() {
    BlessERP.state?.saveDb?.();
  }

  function activeUser() {
    const adminApi = BlessERP.adminConfig || BlessERP.services?.adminConfig;
    const configuredUser = adminApi?.activeUser?.();
    const sessionUser = database()?.session?.activeUser;
    const source = configuredUser || sessionUser || {};
    return {
      id: String(source.id || "USR-LOCAL-DEMO"),
      name: String(source.name || source.fullName || "Usuario local/demo")
    };
  }

  function audit(payload = {}) {
    const adminApi = BlessERP.adminConfig || BlessERP.services?.adminConfig;
    if (!adminApi?.addAuditLog) return { ok: true, skipped: true };
    return adminApi.addAuditLog({
      module: "ROL_PAGOS",
      result: "exitoso",
      ...payload
    });
  }

  function employeeCompatibilityView(employee = {}) {
    const salaryCalculation = employee.salary_payment_mode === "PROPORCIONAL" ? "PROPORTIONAL" : "FULL";
    return {
      ...clone(employee),
      id: employee.employee_id,
      employeeId: employee.employee_id,
      companyId: employee.company_id,
      userId: employee.user_id,
      sellerId: employee.seller_id,
      fullName: employee.full_name,
      hireDate: employee.hire_date,
      calculationMode: employee.calculation_mode,
      salaryCalculation,
      monthlySalary: employee.monthly_salary,
      hourlyRate: employee.hourly_rate,
      performanceRate: employee.performance_rate,
      performanceUnit: employee.performance_unit,
      accountCode: employee.account_code
    };
  }

  function syncHourEntryAliases(entry = {}) {
    entry.id = entry.hour_entry_id || entry.id || "";
    entry.hourEntryId = entry.hour_entry_id || entry.id;
    entry.employeeId = entry.employee_id || entry.employeeId || "";
    entry.companyId = entry.company_id || entry.companyId || "";
    entry.periodId = entry.period_id || entry.periodId || "";
    entry.normalHours = rules.number(entry.normal_hours ?? entry.normalHours);
    entry.additionalHours = rules.number(entry.additional_hours ?? entry.additionalHours);
    entry.hours = rules.number(entry.total_hours ?? entry.hours ?? (entry.normalHours + entry.additionalHours));
    entry.hourType = entry.hour_type || entry.hourType || "NORMAL";
    entry.hourlyRate = rules.number(entry.hourly_rate ?? entry.hourlyRate);
    entry.ratePerHour = entry.hourlyRate;
    entry.sourceId = entry.source_id || entry.sourceId || "";
    return entry;
  }

  function syncPerformanceEntryAliases(entry = {}) {
    entry.id = entry.performance_entry_id || entry.id || "";
    entry.performanceId = entry.performance_entry_id || entry.id;
    entry.employeeId = entry.employee_id || entry.employeeId || "";
    entry.companyId = entry.company_id || entry.companyId || "";
    entry.periodId = entry.period_id || entry.periodId || "";
    entry.appliedRate = rules.number(entry.tariff ?? entry.appliedRate);
    entry.rate = entry.appliedRate;
    entry.total = rules.number(entry.total_generated ?? entry.total);
    entry.sourceId = entry.source_id || entry.sourceId || "";
    return entry;
  }

  function normalizeExistingStore(rawStore) {
    const base = data.createPayrollStore(rawStore?.default_company_id || data.DEFAULT_COMPANY_ID);
    const store = rawStore && typeof rawStore === "object" ? rawStore : {};
    store.schema_version = data.SCHEMA_VERSION;
    store.default_company_id = String(store.default_company_id || base.default_company_id);
    [
      "employees",
      "rate_rules",
      "hour_entries",
      "performance_entries",
      "obligation_settings",
      "parameters_by_company"
    ].forEach(key => {
      if (!Array.isArray(store[key])) store[key] = clone(base[key]);
    });

    const legacyHourRows = [
      ...(Array.isArray(store.timeEntries) ? store.timeEntries : []),
      ...(Array.isArray(store.workTimeEntries) ? store.workTimeEntries : [])
    ];
    const knownHourIds = new Set(store.hour_entries.map(item => item.hour_entry_id || item.id).filter(Boolean));
    legacyHourRows.forEach(item => {
      const itemId = item.hour_entry_id || item.hourEntryId || item.id;
      if (itemId && knownHourIds.has(itemId)) return;
      if (itemId) knownHourIds.add(itemId);
      store.hour_entries.push(syncHourEntryAliases({
        ...item,
        hour_entry_id: itemId || uid("HOUR"),
        company_id: item.company_id || item.companyId || store.default_company_id,
        employee_id: item.employee_id || item.employeeId || "",
        period_id: item.period_id || item.periodId || "",
        normal_hours: rules.number(item.normal_hours ?? item.normalHours),
        additional_hours: rules.number(item.additional_hours ?? item.additionalHours),
        total_hours: rules.number(item.total_hours ?? item.hours),
        hour_type: item.hour_type || item.hourType || "NORMAL",
        hourly_rate: rules.number(item.hourly_rate ?? item.hourlyRate ?? item.ratePerHour),
        source_id: item.source_id || item.sourceId || ""
      }));
    });
    const legacyPerformanceRows = Array.isArray(store.performanceEntries) ? store.performanceEntries : [];
    const knownPerformanceIds = new Set(store.performance_entries.map(item => item.performance_entry_id || item.id).filter(Boolean));
    legacyPerformanceRows.forEach(item => {
      const itemId = item.performance_entry_id || item.performanceEntryId || item.performanceId || item.id;
      if (itemId && knownPerformanceIds.has(itemId)) return;
      if (itemId) knownPerformanceIds.add(itemId);
      store.performance_entries.push(syncPerformanceEntryAliases({
        ...item,
        performance_entry_id: itemId || uid("PERF"),
        company_id: item.company_id || item.companyId || store.default_company_id,
        employee_id: item.employee_id || item.employeeId || "",
        period_id: item.period_id || item.periodId || "",
        tariff: rules.number(item.tariff ?? item.appliedRate ?? item.rate),
        total_generated: rules.number(item.total_generated ?? item.total),
        source_id: item.source_id || item.sourceId || ""
      }));
    });

    const existingEmployeeIds = new Set(store.employees.map(item => item.employee_id));
    data.createDemoEmployees(store.default_company_id)
      .filter(item => !existingEmployeeIds.has(item.employee_id))
      .forEach(item => store.employees.push(item));
    if (!store.parameters_by_company.some(item => item.company_id === store.default_company_id)) {
      store.parameters_by_company.push(data.createDefaultParameters(store.default_company_id));
    }
    store.parameters_by_company = store.parameters_by_company.map(item => {
      const defaults = data.createDefaultParameters(item.company_id || store.default_company_id);
      const performance = {
        ...defaults.performance_calculation,
        ...(item.performance_calculation || item.performanceCalculation || {})
      };
      performance.precision = Math.min(8, Math.max(7, Number(performance.precision || 8)));
      return {
        ...defaults,
        ...item,
        performance_calculation: performance
      };
    });
    store.hour_entries.forEach(syncHourEntryAliases);
    store.performance_entries.forEach(syncPerformanceEntryAliases);
    store.timeEntries = store.hour_entries;
    store.workTimeEntries = [];
    store.performanceEntries = store.performance_entries;
    const defaultParameters = store.parameters_by_company.find(item => item.company_id === store.default_company_id);
    store.parameters = {
      ...(store.parameters || {}),
      hourDivisor: rules.number(defaultParameters?.hour_divisor, 240),
      hourMultipliers: clone(defaultParameters?.hour_multipliers || data.DEFAULT_HOUR_MULTIPLIERS)
    };
    return store;
  }

  function ensureStore() {
    const db = database();
    const original = db.payroll;
    db.payroll = normalizeExistingStore(original);
    if (!original) persist();
    return db.payroll;
  }

  function companyIdOrDefault(companyId) {
    return String(companyId || ensureStore().default_company_id || data.DEFAULT_COMPANY_ID);
  }

  function normalizeEmployee(payload = {}, existing = null) {
    const source = { ...(existing || {}), ...(payload || {}) };
    const user = activeUser();
    const timestamp = nowIso();
    const employeeId = existing?.employee_id
      || firstDefined(payload, ["employee_id", "employeeId", "id"], "")
      || uid("EMP");
    return {
      employee_id: String(employeeId),
      company_id: String(firstDefined(payload, ["company_id", "companyId"], existing?.company_id || data.DEFAULT_COMPANY_ID)),
      user_id: String(firstDefined(payload, ["user_id", "userId"], existing?.user_id || "")),
      seller_id: String(firstDefined(payload, ["seller_id", "sellerId", "vendedor_id"], existing?.seller_id || "")),
      code: rules.normalizeCode(firstDefined(payload, ["code", "internal_code", "internalCode"], existing?.code || "")),
      identification: rules.normalizeText(firstDefined(payload, ["identification", "cedula"], existing?.identification || "")),
      full_name: rules.normalizeText(firstDefined(payload, ["full_name", "fullName", "name"], existing?.full_name || "")),
      hire_date: String(firstDefined(payload, ["hire_date", "hireDate"], existing?.hire_date || "")),
      area: rules.normalizeCode(firstDefined(payload, ["area"], existing?.area || "")),
      position: rules.normalizeText(firstDefined(payload, ["position", "cargo", "activity"], existing?.position || "")),
      status: rules.normalizeCode(firstDefined(payload, ["status"], existing?.status || "ACTIVO")),
      calculation_mode: rules.normalizeCode(firstDefined(payload, ["calculation_mode", "calculationMode"], existing?.calculation_mode || "SUELDO_MENSUAL")),
      salary_payment_mode: rules.normalizeCode(firstDefined(payload, ["salary_payment_mode", "salaryPaymentMode"], existing?.salary_payment_mode || "COMPLETO")),
      monthly_salary: rules.round(firstDefined(payload, ["monthly_salary", "monthlySalary", "base_salary"], existing?.monthly_salary || 0), 2),
      hourly_rate: rules.round(firstDefined(payload, ["hourly_rate", "hourlyRate"], existing?.hourly_rate || 0), 6),
      performance_rate: rules.round(firstDefined(payload, ["performance_rate", "performanceRate"], existing?.performance_rate || 0), 8),
      performance_unit: rules.normalizeCode(firstDefined(payload, ["performance_unit", "performanceUnit"], existing?.performance_unit || "OTRA")),
      goal: rules.round(firstDefined(payload, ["goal", "meta"], existing?.goal || 0), 4),
      probation_period: Boolean(firstDefined(payload, ["probation_period", "probationPeriod"], existing?.probation_period || false)),
      probation_end_date: String(firstDefined(payload, ["probation_end_date", "probationEndDate"], existing?.probation_end_date || "")),
      account_code: rules.normalizeText(firstDefined(payload, ["account_code", "accountCode"], existing?.account_code || "")),
      notes: rules.normalizeText(firstDefined(payload, ["notes", "notas"], existing?.notes || "")),
      external_refs: clone(firstDefined(payload, ["external_refs", "externalRefs"], existing?.external_refs || {})),
      inactive_date: String(firstDefined(payload, ["inactive_date", "inactiveDate"], existing?.inactive_date || "")),
      created_at: existing?.created_at || timestamp,
      created_by: existing?.created_by || user.id,
      updated_at: timestamp,
      updated_by: user.id
    };
  }

  function employeeFilters(item, filters = {}) {
    if (filters.company_id || filters.companyId) {
      if (item.company_id !== String(filters.company_id || filters.companyId)) return false;
    }
    if (filters.area && item.area !== rules.normalizeCode(filters.area)) return false;
    if (filters.status && item.status !== rules.normalizeCode(filters.status)) return false;
    if (filters.calculation_mode || filters.calculationMode) {
      if (item.calculation_mode !== rules.normalizeCode(filters.calculation_mode || filters.calculationMode)) return false;
    }
    if (filters.seller_id || filters.sellerId) {
      if (item.seller_id !== String(filters.seller_id || filters.sellerId)) return false;
    }
    const search = rules.normalizeText(filters.search).toLowerCase();
    if (search) {
      const haystack = [
        item.code,
        item.identification,
        item.full_name,
        item.position,
        item.area,
        item.user_id,
        item.seller_id
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }

  function listEmployees(filters = {}) {
    return clone(ensureStore().employees)
      .filter(item => employeeFilters(item, filters))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"));
  }

  function employees(filters = {}) {
    return listEmployees(filters).map(employeeCompatibilityView);
  }

  function findEmployee(employeeId) {
    const found = ensureStore().employees.find(item => item.employee_id === String(employeeId || ""));
    return found ? clone(found) : null;
  }

  function findEmployeeBySellerId(sellerId, companyId = "") {
    const normalizedCompanyId = companyId ? companyIdOrDefault(companyId) : "";
    const found = ensureStore().employees.find(item =>
      item.seller_id === String(sellerId || "")
      && (!normalizedCompanyId || item.company_id === normalizedCompanyId)
    );
    return found ? clone(found) : null;
  }

  function saveEmployee(payload = {}) {
    const store = ensureStore();
    const requestedId = String(payload.employee_id || payload.employeeId || payload.id || "");
    const index = requestedId ? store.employees.findIndex(item => item.employee_id === requestedId) : -1;
    const before = index >= 0 ? clone(store.employees[index]) : null;
    if (before && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación es obligatorio."] };
    }
    const candidate = normalizeEmployee(payload, before);
    const validation = rules.validateEmployee(candidate, store.employees, candidate.employee_id);
    if (!validation.ok) return validation;
    if (index >= 0) store.employees[index] = candidate;
    else store.employees.push(candidate);
    persist();
    audit({
      action: index >= 0 ? "EDITAR_EMPLEADO" : "CREAR_EMPLEADO",
      entityType: "payroll_employee",
      entityId: candidate.employee_id,
      entityLabel: candidate.code,
      documentLabel: candidate.full_name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizó" : "Se creó"} el trabajador ${candidate.full_name}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason),
      before,
      after: candidate
    });
    return { ok: true, employee: clone(candidate), created: index < 0 };
  }

  function deactivateEmployee(employeeId, reason) {
    const employee = findEmployee(employeeId);
    if (!employee) return { ok: false, errors: ["Trabajador no encontrado."] };
    if (!rules.normalizeText(reason)) return { ok: false, errors: ["El motivo de inactivación es obligatorio."] };
    return saveEmployee({
      ...employee,
      status: "INACTIVO",
      inactive_date: new Date().toISOString().slice(0, 10),
      change_reason: reason
    });
  }

  function employeeUsage(employeeId) {
    const normalizedId = String(employeeId || "");
    const store = ensureStore();
    const usage = [];
    const references = [
      ["tarifas", store.rate_rules, ["employee_id", "employeeId"]],
      ["horas", store.hour_entries, ["employee_id", "employeeId"]],
      ["horas", store.timeEntries, ["employee_id", "employeeId"]],
      ["horas", store.workTimeEntries, ["employee_id", "employeeId"]],
      ["rendimientos", store.performance_entries, ["employee_id", "employeeId"]],
      ["rendimientos", store.performanceEntries, ["employee_id", "employeeId"]],
      ["roles calculados", store.employeeItems, ["employee_id", "employeeId"]],
      ["anticipos", store.advances, ["employee_id", "employeeId"]],
      ["pagos", store.payments, ["employee_id", "employeeId"]]
    ];
    references.forEach(([label, rows, keys]) => {
      if (!Array.isArray(rows)) return;
      if (rows.some(row => keys.some(key => String(row?.[key] || "") === normalizedId))) usage.push(label);
    });

    const masterData = database()?.operations?.masterData || {};
    const operationalCatalogs = [
      ["clasificadores", masterData.classifiers],
      ["embonchadores", masterData.bunchers],
      ["recepción", masterData.receptionists],
      ["responsables", masterData.responsibles]
    ];
    operationalCatalogs.forEach(([label, rows]) => {
      if ((rows || []).some(row => String(row.employee_id || row.employeeId || "") === normalizedId)) {
        usage.push(`Poscosecha: ${label}`);
      }
    });
    return [...new Set(usage)];
  }

  function deleteEmployee(employeeId, reason) {
    const store = ensureStore();
    const normalizedId = String(employeeId || "");
    const index = store.employees.findIndex(item => item.employee_id === normalizedId);
    if (index < 0) return { ok: false, errors: ["Trabajador no encontrado."] };
    if (!rules.normalizeText(reason)) return { ok: false, errors: ["El motivo de eliminación es obligatorio."] };
    const usage = employeeUsage(normalizedId);
    if (usage.length) {
      return {
        ok: false,
        errors: [`No se puede eliminar porque tiene información relacionada (${usage.join(", ")}). Edítelo y cambie su estado a INACTIVO para conservar el historial.`],
        usage
      };
    }
    const before = clone(store.employees[index]);
    store.employees.splice(index, 1);
    if (Array.isArray(store.salespeople)) {
      store.salespeople = store.salespeople.filter(item => String(item.employeeId || item.employee_id || "") !== normalizedId);
    }
    persist();
    audit({
      action: "ELIMINAR_EMPLEADO_NUEVO",
      entityType: "payroll_employee",
      entityId: normalizedId,
      entityLabel: before.code,
      documentLabel: before.full_name,
      previousStatus: before.status,
      nextStatus: "ELIMINADO",
      description: `Se eliminó el trabajador nuevo ${before.full_name}, sin movimientos asociados.`,
      reason: rules.normalizeText(reason),
      before,
      after: null
    });
    return { ok: true, employee: before, deleted: true };
  }

  function getParameters(companyId = "") {
    const store = ensureStore();
    const normalizedCompanyId = companyIdOrDefault(companyId);
    let found = store.parameters_by_company.find(item => item.company_id === normalizedCompanyId);
    if (!found) {
      found = data.createDefaultParameters(normalizedCompanyId);
      store.parameters_by_company.push(found);
      persist();
    }
    return clone(found);
  }

  function validateParameters(candidate) {
    const errors = [];
    if (rules.number(candidate.hour_divisor) <= 0) errors.push("El divisor de la hora debe ser mayor que cero.");
    const performance = candidate.performance_calculation || {};
    if (rules.number(performance.workday_hours) <= 0) errors.push("Las horas de la jornada de rendimiento deben ser mayores que cero.");
    if (rules.number(performance.reference_working_days) <= 0) errors.push("Los días referenciales del rendimiento deben ser mayores que cero.");
    if (![7, 8].includes(Number(performance.precision))) errors.push("La precisión del rendimiento debe mantenerse en 7 u 8 decimales.");
    if (rules.number(performance.classifier_reference_salary) <= 0) errors.push("El sueldo referencial del clasificador debe ser mayor que cero.");
    if (rules.number(performance.classifier_daily_stem_target) <= 0) errors.push("La meta diaria de tallos clasificados debe ser mayor que cero.");
    if (rules.number(performance.buncher_reference_salary) <= 0) errors.push("El sueldo referencial del embonchador debe ser mayor que cero.");
    if (rules.number(performance.buncher_daily_bunch_target) <= 0) errors.push("La meta diaria de embonche debe ser mayor que cero.");
    if (rules.number(performance.buncher_stems_per_bunch) <= 0) errors.push("Los tallos referenciales por bonche deben ser mayores que cero.");
    if (rules.number(performance.seller_reference_salary) <= 0) errors.push("El sueldo referencial del vendedor debe ser mayor que cero.");
    if (rules.number(performance.seller_daily_stem_target) <= 0) errors.push("La meta diaria de tallos vendidos debe ser mayor que cero.");
    if (!Array.isArray(performance.working_days) || !performance.working_days.length) errors.push("Debe existir al menos un día laborable para el rendimiento.");
    const multiplierCodes = new Set();
    (candidate.hour_multipliers || []).forEach(item => {
      if (!item.code) errors.push("Todo tipo de hora debe tener código.");
      if (multiplierCodes.has(item.code)) errors.push(`El tipo de hora ${item.code} está duplicado.`);
      multiplierCodes.add(item.code);
      if (rules.number(item.multiplier) <= 0) errors.push(`El multiplicador de ${item.code || "tipo de hora"} debe ser mayor que cero.`);
    });
    if (!multiplierCodes.has("NORMAL")) errors.push("Debe existir el tipo de hora NORMAL.");
    const activityCodes = new Set();
    (candidate.activities || []).forEach(item => {
      if (!item.code) errors.push("Toda actividad debe tener código.");
      if (activityCodes.has(item.code)) errors.push(`La actividad ${item.code} está duplicada.`);
      activityCodes.add(item.code);
    });
    return { ok: errors.length === 0, errors };
  }

  function saveParameters(payload = {}) {
    const store = ensureStore();
    const companyId = companyIdOrDefault(payload.company_id || payload.companyId);
    const index = store.parameters_by_company.findIndex(item => item.company_id === companyId);
    const before = index >= 0 ? clone(store.parameters_by_company[index]) : data.createDefaultParameters(companyId);
    const user = activeUser();
    const candidate = {
      company_id: companyId,
      hour_divisor: rules.number(firstDefined(payload, ["hour_divisor", "hourDivisor"], before.hour_divisor), 240),
      hour_multipliers: clone(firstDefined(payload, ["hour_multipliers", "hourMultipliers"], before.hour_multipliers))
        .map(item => ({
          code: rules.normalizeCode(item.code),
          label: rules.normalizeText(item.label || item.code),
          multiplier: rules.round(item.multiplier, 4),
          active: item.active !== false
        })),
      performance_calculation: (() => {
        const source = {
          ...(before.performance_calculation || data.createDefaultParameters(companyId).performance_calculation),
          ...firstDefined(payload, ["performance_calculation", "performanceCalculation"], {})
        };
        return {
          workday_hours: rules.round(source.workday_hours, 2),
          reference_working_days: rules.round(source.reference_working_days || 21, 2),
          precision: [7, 8].includes(Number(source.precision)) ? Number(source.precision) : 8,
          working_days: Array.isArray(source.working_days) && source.working_days.length
            ? [...new Set(source.working_days.map(Number).filter(day => day >= 0 && day <= 6))]
            : [1, 2, 3, 4, 5, 6],
          classifier_reference_salary: rules.round(source.classifier_reference_salary, 2),
          classifier_daily_stem_target: rules.round(source.classifier_daily_stem_target, 4),
          classifier_daily_mesh_target: rules.round(source.classifier_daily_mesh_target, 4),
          classifier_stems_per_mesh: rules.round(source.classifier_stems_per_mesh, 4),
          buncher_reference_salary: rules.round(source.buncher_reference_salary, 2),
          buncher_daily_bunch_target: rules.round(source.buncher_daily_bunch_target, 4),
          buncher_stems_per_bunch: rules.round(source.buncher_stems_per_bunch, 4),
          seller_reference_salary: rules.round(source.seller_reference_salary, 2),
          seller_daily_stem_target: rules.round(source.seller_daily_stem_target, 4),
          seller_sales_basis: rules.normalizeCode(source.seller_sales_basis || "GENERATED")
        };
      })(),
      performance_units: clone(firstDefined(payload, ["performance_units", "performanceUnits"], before.performance_units)),
      activities: clone(firstDefined(payload, ["activities"], before.activities)).map(item => ({
        code: rules.normalizeCode(item.code),
        label: rules.normalizeText(item.label || item.code),
        area: rules.normalizeCode(item.area),
        active: item.active !== false
      })),
      updated_at: nowIso(),
      updated_by: user.id
    };
    const validation = validateParameters(candidate);
    if (!validation.ok) return validation;
    if (index >= 0 && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación de parámetros es obligatorio."] };
    }
    if (index >= 0) store.parameters_by_company[index] = candidate;
    else store.parameters_by_company.push(candidate);
    persist();
    audit({
      action: "ACTUALIZAR_PARAMETROS_ROL",
      entityType: "payroll_parameters",
      entityId: companyId,
      entityLabel: companyId,
      description: `Se actualizaron los parámetros del rol para ${companyId}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason),
      before,
      after: candidate
    });
    return { ok: true, parameters: clone(candidate) };
  }

  function getObligationSettings(companyId = "", periodId = "") {
    const store = ensureStore();
    const normalizedCompanyId = companyIdOrDefault(companyId);
    const normalizedPeriodId = String(periodId || "");
    const found = store.obligation_settings.find(item =>
      item.company_id === normalizedCompanyId && item.period_id === normalizedPeriodId
    );
    return clone(found || data.createDefaultObligationSettings(normalizedCompanyId, normalizedPeriodId));
  }

  function saveObligationSettings(payload = {}) {
    const store = ensureStore();
    const companyId = companyIdOrDefault(payload.company_id || payload.companyId);
    const periodId = String(payload.period_id || payload.periodId || "");
    if (!periodId) return { ok: false, errors: ["El periodo es obligatorio para configurar obligaciones laborales."] };
    const index = store.obligation_settings.findIndex(item =>
      item.company_id === companyId && item.period_id === periodId
    );
    const before = index >= 0
      ? clone(store.obligation_settings[index])
      : data.createDefaultObligationSettings(companyId, periodId);
    const submitted = new Map((payload.obligations || []).map(item => [rules.normalizeCode(item.code), item]));
    const user = activeUser();
    const candidate = {
      company_id: companyId,
      period_id: periodId,
      obligations: data.LABOR_OBLIGATIONS.map(definition => ({
        code: definition.code,
        label: definition.label,
        active: submitted.get(definition.code)?.active === true
      })),
      updated_at: nowIso(),
      updated_by: user.id
    };
    if (index >= 0 && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación de obligaciones es obligatorio."] };
    }
    if (index >= 0) store.obligation_settings[index] = candidate;
    else store.obligation_settings.push(candidate);
    persist();
    audit({
      action: "CONFIGURAR_OBLIGACIONES_LABORALES",
      entityType: "payroll_obligation_settings",
      entityId: `${companyId}:${periodId}`,
      entityLabel: periodId,
      documentLabel: `Obligaciones ${periodId}`,
      description: `Se configuraron las obligaciones laborales del periodo ${periodId}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason),
      before,
      after: candidate
    });
    return { ok: true, settings: clone(candidate) };
  }

  function normalizeRateRule(payload, existing = null) {
    const user = activeUser();
    const timestamp = nowIso();
    return {
      rate_id: existing?.rate_id || String(payload.rate_id || payload.rateId || payload.id || uid("RATE")),
      company_id: companyIdOrDefault(payload.company_id || payload.companyId || existing?.company_id),
      employee_id: String(payload.employee_id || payload.employeeId || existing?.employee_id || ""),
      pay_type: rules.normalizeCode(payload.pay_type || payload.payType || existing?.pay_type || ""),
      activity: rules.normalizeCode(firstDefined(payload, ["activity"], existing?.activity || "")),
      unit: rules.normalizeCode(firstDefined(payload, ["unit"], existing?.unit || "")),
      amount: rules.round(firstDefined(payload, ["amount", "tariff", "rate"], existing?.amount || 0), 8),
      valid_from: String(payload.valid_from || payload.validFrom || existing?.valid_from || ""),
      valid_to: String(firstDefined(payload, ["valid_to", "validTo"], existing?.valid_to || "")),
      season: rules.normalizeCode(firstDefined(payload, ["season", "temporada"], existing?.season || "")),
      period_id: String(firstDefined(payload, ["period_id", "periodId"], existing?.period_id || "")),
      priority: Math.max(0, Math.trunc(rules.number(firstDefined(payload, ["priority"], existing?.priority || 0)))),
      active: firstDefined(payload, ["active"], existing?.active ?? true) !== false,
      notes: rules.normalizeText(firstDefined(payload, ["notes", "observation"], existing?.notes || "")),
      created_at: existing?.created_at || timestamp,
      created_by: existing?.created_by || user.id,
      updated_at: timestamp,
      updated_by: user.id
    };
  }

  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    const normalizedATo = aTo || "9999-12-31";
    const normalizedBTo = bTo || "9999-12-31";
    return aFrom <= normalizedBTo && bFrom <= normalizedATo;
  }

  function saveRateRule(payload = {}) {
    const store = ensureStore();
    const requestedId = String(payload.rate_id || payload.rateId || payload.id || "");
    const index = requestedId ? store.rate_rules.findIndex(item => item.rate_id === requestedId) : -1;
    const before = index >= 0 ? clone(store.rate_rules[index]) : null;
    if (before && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación de la tarifa es obligatorio."] };
    }
    const candidate = normalizeRateRule(payload, before);
    const validation = rules.validateRateRule(candidate, store.employees);
    if (!validation.ok) return validation;
    const ambiguous = store.rate_rules.find(item =>
      item.rate_id !== candidate.rate_id
      && item.active !== false
      && candidate.active !== false
      && item.company_id === candidate.company_id
      && item.employee_id === candidate.employee_id
      && item.pay_type === candidate.pay_type
      && (item.activity || "") === (candidate.activity || "")
      && (item.unit || "") === (candidate.unit || "")
      && (item.season || "") === (candidate.season || "")
      && (item.period_id || "") === (candidate.period_id || "")
      && rules.number(item.priority) === rules.number(candidate.priority)
      && rangesOverlap(item.valid_from, item.valid_to, candidate.valid_from, candidate.valid_to)
    );
    if (ambiguous) {
      return { ok: false, errors: ["Existe otra tarifa activa con el mismo alcance, prioridad y fechas superpuestas."] };
    }
    if (index >= 0) store.rate_rules[index] = candidate;
    else store.rate_rules.push(candidate);
    persist();
    const employee = store.employees.find(item => item.employee_id === candidate.employee_id);
    audit({
      action: index >= 0 ? "EDITAR_TARIFA_EMPLEADO" : "CREAR_TARIFA_EMPLEADO",
      entityType: "payroll_rate_rule",
      entityId: candidate.rate_id,
      entityLabel: employee?.full_name || candidate.employee_id,
      documentLabel: `${candidate.pay_type} ${candidate.activity || "GENERAL"}`,
      description: `${index >= 0 ? "Se actualizó" : "Se creó"} una tarifa efectiva de ${employee?.full_name || candidate.employee_id}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason || candidate.notes),
      before,
      after: candidate
    });
    return { ok: true, rate_rule: clone(candidate), created: index < 0 };
  }

  function listRateRules(filters = {}) {
    return clone(ensureStore().rate_rules)
      .filter(item => {
        if ((filters.company_id || filters.companyId) && item.company_id !== String(filters.company_id || filters.companyId)) return false;
        if ((filters.employee_id || filters.employeeId) && item.employee_id !== String(filters.employee_id || filters.employeeId)) return false;
        if ((filters.pay_type || filters.payType) && item.pay_type !== rules.normalizeCode(filters.pay_type || filters.payType)) return false;
        if (filters.activity && item.activity !== rules.normalizeCode(filters.activity)) return false;
        if (filters.active !== undefined && item.active !== Boolean(filters.active)) return false;
        return true;
      })
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.priority - a.priority);
  }

  function deactivateRateRule(rateId, reason) {
    const found = ensureStore().rate_rules.find(item => item.rate_id === String(rateId || ""));
    if (!found) return { ok: false, errors: ["Tarifa no encontrada."] };
    if (!rules.normalizeText(reason)) return { ok: false, errors: ["El motivo de inactivación es obligatorio."] };
    return saveRateRule({ ...found, active: false, change_reason: reason });
  }

  function resolveRate(context = {}) {
    const store = ensureStore();
    return clone(rules.resolveEffectiveRate(store.rate_rules, {
      company_id: companyIdOrDefault(context.company_id || context.companyId),
      employee_id: String(context.employee_id || context.employeeId || ""),
      pay_type: rules.normalizeCode(context.pay_type || context.payType),
      date: String(context.date || ""),
      activity: rules.normalizeCode(context.activity),
      unit: rules.normalizeCode(context.unit),
      season: rules.normalizeCode(context.season),
      period_id: String(context.period_id || context.periodId || "")
    }));
  }

  function rateForHours(employee, payload, parameters) {
    const context = {
      company_id: employee.company_id,
      employee_id: employee.employee_id,
      pay_type: "HORA",
      date: String(payload.date || ""),
      activity: rules.normalizeCode(payload.activity),
      season: rules.normalizeCode(payload.season),
      period_id: String(payload.period_id || payload.periodId || "")
    };
    const rateRule = rules.resolveEffectiveRate(ensureStore().rate_rules, context);
    if (rateRule) return { amount: rateRule.amount, source: "REGLA_TARIFA", rate_id: rateRule.rate_id };
    if (rules.number(employee.hourly_rate) > 0) return { amount: employee.hourly_rate, source: "EMPLEADO", rate_id: "" };
    return {
      amount: rules.calculateHourlyRate(employee.monthly_salary, parameters.hour_divisor),
      source: "SUELDO_DIVISOR",
      rate_id: ""
    };
  }

  function multiplierForType(parameters, hourType) {
    return (parameters.hour_multipliers || []).find(item => item.code === hourType && item.active !== false) || null;
  }

  function normalizeHourEntry(payload, existing = null) {
    const employeeId = String(payload.employee_id || payload.employeeId || existing?.employee_id || "");
    const employee = findEmployee(employeeId);
    const companyId = companyIdOrDefault(payload.company_id || payload.companyId || existing?.company_id || employee?.company_id);
    const parameters = getParameters(companyId);
    const hourType = rules.normalizeCode(payload.hour_type || payload.hourType || existing?.hour_type || "NORMAL");
    const configuredMultiplier = multiplierForType(parameters, hourType);
    const rateResolution = employee
      ? rateForHours(employee, { ...existing, ...payload }, parameters)
      : { amount: 0, source: "", rate_id: "" };
    const explicitRate = firstDefined(payload, ["hourly_rate", "hourlyRate"], undefined);
    const appliedRate = explicitRate === undefined
      ? rateResolution.amount
      : rules.number(explicitRate);
    const explicitMultiplier = firstDefined(payload, ["multiplier"], undefined);
    const appliedMultiplier = explicitMultiplier === undefined
      ? rules.number(configuredMultiplier?.multiplier, 1)
      : rules.number(explicitMultiplier, 1);
    const genericHours = firstDefined(payload, ["hours", "quantity_hours", "quantityHours"], undefined);
    const sourceNormalHours = firstDefined(payload, ["normal_hours", "normalHours"], existing?.normal_hours || 0);
    const sourceAdditionalHours = firstDefined(payload, ["additional_hours", "additionalHours"], existing?.additional_hours || 0);
    const normalHours = genericHours !== undefined
      ? (hourType === "NORMAL" ? genericHours : 0)
      : sourceNormalHours;
    const additionalHours = genericHours !== undefined
      ? (hourType === "NORMAL" ? 0 : genericHours)
      : sourceAdditionalHours;
    const calculation = rules.calculateHourComponents(normalHours, additionalHours, appliedRate, appliedMultiplier);
    const user = activeUser();
    const timestamp = nowIso();
    return {
      hour_entry_id: existing?.hour_entry_id || String(payload.hour_entry_id || payload.hourEntryId || payload.id || uid("HOUR")),
      company_id: companyId,
      employee_id: employeeId,
      period_id: String(firstDefined(payload, ["period_id", "periodId"], existing?.period_id || "")),
      date: String(firstDefined(payload, ["date"], existing?.date || "")),
      activity: rules.normalizeCode(firstDefined(payload, ["activity"], existing?.activity || "")),
      normal_hours: calculation.normal_hours,
      additional_hours: calculation.additional_hours,
      total_hours: calculation.total_hours,
      hour_type: hourType,
      hourly_rate: calculation.hourly_rate,
      expected_hourly_rate: rules.round(rateResolution.amount, 6),
      rate_source: rateResolution.source,
      rate_id: rateResolution.rate_id,
      multiplier: calculation.multiplier,
      expected_multiplier: rules.round(configuredMultiplier?.multiplier || 0, 4),
      normal_total: calculation.normal_total,
      additional_total: calculation.additional_total,
      total: calculation.total,
      season: rules.normalizeCode(firstDefined(payload, ["season"], existing?.season || "")),
      origin: rules.normalizeCode(firstDefined(payload, ["origin"], existing?.origin || "MANUAL")),
      source_id: String(firstDefined(payload, ["source_id", "sourceId"], existing?.source_id || "")),
      observation: rules.normalizeText(firstDefined(payload, ["observation", "notes"], existing?.observation || "")),
      rate_override_reason: rules.normalizeText(firstDefined(payload, ["rate_override_reason", "rateOverrideReason"], existing?.rate_override_reason || "")),
      multiplier_override_reason: rules.normalizeText(firstDefined(payload, ["multiplier_override_reason", "multiplierOverrideReason"], existing?.multiplier_override_reason || "")),
      status: existing?.status || "ACTIVO",
      created_at: existing?.created_at || timestamp,
      created_by: existing?.created_by || user.id,
      updated_at: timestamp,
      updated_by: user.id
    };
  }

  function saveHourEntry(payload = {}) {
    const store = ensureStore();
    const requestedId = String(payload.hour_entry_id || payload.hourEntryId || payload.id || "");
    const index = requestedId ? store.hour_entries.findIndex(item => item.hour_entry_id === requestedId) : -1;
    const before = index >= 0 ? clone(store.hour_entries[index]) : null;
    if (before && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación del registro de horas es obligatorio."] };
    }
    const candidate = normalizeHourEntry(payload, before);
    const employee = store.employees.find(item => item.employee_id === candidate.employee_id);
    const validation = rules.validateHourEntry(candidate, employee, getParameters(candidate.company_id));
    if (!validation.ok) return validation;
    if (employee?.status !== "ACTIVO" && !before) return { ok: false, errors: ["No se pueden registrar horas nuevas a un trabajador inactivo."] };
    if (Math.abs(candidate.hourly_rate - candidate.expected_hourly_rate) > 0.000001 && !candidate.rate_override_reason) {
      return { ok: false, errors: ["Debe justificar la modificación de la tarifa por hora."] };
    }
    if (Math.abs(candidate.multiplier - candidate.expected_multiplier) > 0.000001 && !candidate.multiplier_override_reason) {
      return { ok: false, errors: ["Debe justificar la modificación del multiplicador de horas."] };
    }
    const duplicateSource = candidate.source_id && store.hour_entries.find(item =>
      item.hour_entry_id !== candidate.hour_entry_id
      && item.status !== "ANULADO"
      && item.company_id === candidate.company_id
      && item.employee_id === candidate.employee_id
      && item.origin === candidate.origin
      && item.source_id === candidate.source_id
    );
    if (duplicateSource) return { ok: false, errors: ["Ese registro de origen ya fue incorporado a las horas del trabajador."] };
    if (index >= 0) store.hour_entries[index] = candidate;
    else store.hour_entries.push(candidate);
    syncHourEntryAliases(candidate);
    persist();
    audit({
      action: index >= 0 ? "EDITAR_HORAS" : "REGISTRAR_HORAS",
      entityType: "payroll_hour_entry",
      entityId: candidate.hour_entry_id,
      entityLabel: employee?.full_name || candidate.employee_id,
      documentLabel: `${candidate.date} ${candidate.activity}`,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se modificó" : "Se registró"} trabajo por horas de ${employee?.full_name || candidate.employee_id}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason || candidate.rate_override_reason || candidate.multiplier_override_reason),
      before,
      after: candidate
    });
    return { ok: true, hour_entry: clone(candidate), created: index < 0 };
  }

  function listHourEntries(filters = {}) {
    const from = String(filters.from || filters.date_from || "");
    const to = String(filters.to || filters.date_to || "");
    return clone(ensureStore().hour_entries)
      .filter(item => {
        if ((filters.company_id || filters.companyId) && item.company_id !== String(filters.company_id || filters.companyId)) return false;
        if ((filters.employee_id || filters.employeeId) && item.employee_id !== String(filters.employee_id || filters.employeeId)) return false;
        if (filters.period_id && item.period_id !== String(filters.period_id)) return false;
        if (filters.activity && item.activity !== rules.normalizeCode(filters.activity)) return false;
        if (filters.status && item.status !== rules.normalizeCode(filters.status)) return false;
        if (from && item.date < from) return false;
        if (to && item.date > to) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  }

  function voidHourEntry(hourEntryId, reason) {
    const store = ensureStore();
    const index = store.hour_entries.findIndex(item => item.hour_entry_id === String(hourEntryId || ""));
    if (index < 0) return { ok: false, errors: ["Registro de horas no encontrado."] };
    if (!rules.normalizeText(reason)) return { ok: false, errors: ["El motivo de anulación es obligatorio."] };
    if (store.hour_entries[index].status === "ANULADO") return { ok: false, errors: ["El registro de horas ya está anulado."] };
    const before = clone(store.hour_entries[index]);
    const user = activeUser();
    store.hour_entries[index] = {
      ...store.hour_entries[index],
      status: "ANULADO",
      void_reason: rules.normalizeText(reason),
      voided_at: nowIso(),
      voided_by: user.id,
      updated_at: nowIso(),
      updated_by: user.id
    };
    persist();
    audit({
      action: "ANULAR_HORAS",
      entityType: "payroll_hour_entry",
      entityId: before.hour_entry_id,
      entityLabel: before.employee_id,
      documentLabel: `${before.date} ${before.activity}`,
      previousStatus: before.status,
      nextStatus: "ANULADO",
      description: "Se anuló un registro de horas.",
      reason,
      before,
      after: store.hour_entries[index]
    });
    return { ok: true, hour_entry: clone(store.hour_entries[index]) };
  }

  function rateForPerformance(employee, payload) {
    const context = {
      company_id: employee.company_id,
      employee_id: employee.employee_id,
      pay_type: "RENDIMIENTO",
      date: String(payload.date || ""),
      activity: rules.normalizeCode(payload.activity),
      unit: rules.normalizeCode(payload.unit || employee.performance_unit),
      season: rules.normalizeCode(payload.season),
      period_id: String(payload.period_id || payload.periodId || "")
    };
    const rateRule = rules.resolveEffectiveRate(ensureStore().rate_rules, context);
    if (rateRule) return { amount: rateRule.amount, source: "REGLA_TARIFA", rate_id: rateRule.rate_id };
    return { amount: employee.performance_rate, source: "EMPLEADO", rate_id: "" };
  }

  function normalizePerformanceEntry(payload, existing = null) {
    const employeeId = String(payload.employee_id || payload.employeeId || existing?.employee_id || "");
    const employee = findEmployee(employeeId);
    const companyId = companyIdOrDefault(payload.company_id || payload.companyId || existing?.company_id || employee?.company_id);
    const mergedPayload = { ...(existing || {}), ...(payload || {}) };
    const rateResolution = employee
      ? rateForPerformance(employee, mergedPayload)
      : { amount: 0, source: "", rate_id: "" };
    const explicitTariff = firstDefined(payload, ["tariff", "applied_tariff", "appliedTariff"], undefined);
    const appliedTariff = explicitTariff === undefined ? rateResolution.amount : rules.number(explicitTariff);
    const quantity = rules.round(firstDefined(payload, ["quantity", "quantity_done", "quantityDone"], existing?.quantity || 0), 4);
    const user = activeUser();
    const timestamp = nowIso();
    return {
      performance_entry_id: existing?.performance_entry_id || String(payload.performance_entry_id || payload.performanceEntryId || payload.id || uid("PERF")),
      company_id: companyId,
      employee_id: employeeId,
      period_id: String(firstDefined(payload, ["period_id", "periodId"], existing?.period_id || "")),
      date: String(firstDefined(payload, ["date"], existing?.date || "")),
      area: employee?.area || rules.normalizeCode(firstDefined(payload, ["area"], existing?.area || "")),
      activity: rules.normalizeCode(firstDefined(payload, ["activity"], existing?.activity || "")),
      pay_type: "RENDIMIENTO",
      unit: rules.normalizeCode(firstDefined(payload, ["unit"], existing?.unit || employee?.performance_unit || "OTRA")),
      quantity,
      tariff: rules.round(appliedTariff, 8),
      expected_tariff: rules.round(rateResolution.amount, 8),
      tariff_source: rateResolution.source,
      rate_id: rateResolution.rate_id,
      total_generated: rules.calculatePerformance(quantity, appliedTariff),
      origin: rules.normalizeCode(firstDefined(payload, ["origin"], existing?.origin || "MANUAL")),
      source_id: String(firstDefined(payload, ["source_id", "sourceId"], existing?.source_id || "")),
      observation: rules.normalizeText(firstDefined(payload, ["observation", "notes"], existing?.observation || "")),
      season: rules.normalizeCode(firstDefined(payload, ["season"], existing?.season || "")),
      tariff_override_reason: rules.normalizeText(firstDefined(payload, ["tariff_override_reason", "tariffOverrideReason"], existing?.tariff_override_reason || "")),
      status: existing?.status || "ACTIVO",
      registered_by: existing?.registered_by || user.id,
      registered_at: existing?.registered_at || timestamp,
      created_at: existing?.created_at || timestamp,
      created_by: existing?.created_by || user.id,
      updated_at: timestamp,
      updated_by: user.id
    };
  }

  function savePerformanceEntry(payload = {}) {
    const store = ensureStore();
    const requestedId = String(payload.performance_entry_id || payload.performanceEntryId || payload.id || "");
    const index = requestedId ? store.performance_entries.findIndex(item => item.performance_entry_id === requestedId) : -1;
    const before = index >= 0 ? clone(store.performance_entries[index]) : null;
    if (before && !rules.normalizeText(payload.change_reason || payload.changeReason)) {
      return { ok: false, errors: ["El motivo de modificación del rendimiento es obligatorio."] };
    }
    const candidate = normalizePerformanceEntry(payload, before);
    const employee = store.employees.find(item => item.employee_id === candidate.employee_id);
    const validation = rules.validatePerformanceEntry(candidate, employee);
    if (!validation.ok) return validation;
    if (employee?.status !== "ACTIVO" && !before) return { ok: false, errors: ["No se puede registrar rendimiento nuevo a un trabajador inactivo."] };
    if (Math.abs(candidate.tariff - candidate.expected_tariff) > 0.00000001 && !candidate.tariff_override_reason) {
      return { ok: false, errors: ["Debe justificar la modificación de la tarifa de rendimiento."] };
    }
    const duplicateSource = candidate.source_id && store.performance_entries.find(item =>
      item.performance_entry_id !== candidate.performance_entry_id
      && item.status !== "ANULADO"
      && item.company_id === candidate.company_id
      && item.employee_id === candidate.employee_id
      && item.origin === candidate.origin
      && item.source_id === candidate.source_id
    );
    if (duplicateSource) return { ok: false, errors: ["Ese rendimiento de origen ya fue incorporado al rol."] };
    if (index >= 0) store.performance_entries[index] = candidate;
    else store.performance_entries.push(candidate);
    syncPerformanceEntryAliases(candidate);
    persist();
    audit({
      action: index >= 0 ? "EDITAR_RENDIMIENTO" : "REGISTRAR_RENDIMIENTO",
      entityType: "payroll_performance_entry",
      entityId: candidate.performance_entry_id,
      entityLabel: employee?.full_name || candidate.employee_id,
      documentLabel: `${candidate.date} ${candidate.activity}`,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se modificó" : "Se registró"} rendimiento de ${employee?.full_name || candidate.employee_id}.`,
      reason: rules.normalizeText(payload.change_reason || payload.changeReason || candidate.tariff_override_reason),
      before,
      after: candidate
    });
    return { ok: true, performance_entry: clone(candidate), created: index < 0 };
  }

  function listPerformanceEntries(filters = {}) {
    const from = String(filters.from || filters.date_from || "");
    const to = String(filters.to || filters.date_to || "");
    return clone(ensureStore().performance_entries)
      .filter(item => {
        if ((filters.company_id || filters.companyId) && item.company_id !== String(filters.company_id || filters.companyId)) return false;
        if ((filters.employee_id || filters.employeeId) && item.employee_id !== String(filters.employee_id || filters.employeeId)) return false;
        if (filters.period_id && item.period_id !== String(filters.period_id)) return false;
        if (filters.activity && item.activity !== rules.normalizeCode(filters.activity)) return false;
        if (filters.unit && item.unit !== rules.normalizeCode(filters.unit)) return false;
        if (filters.origin && item.origin !== rules.normalizeCode(filters.origin)) return false;
        if (filters.status && item.status !== rules.normalizeCode(filters.status)) return false;
        if (from && item.date < from) return false;
        if (to && item.date > to) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  }

  function voidPerformanceEntry(performanceEntryId, reason) {
    const store = ensureStore();
    const index = store.performance_entries.findIndex(item => item.performance_entry_id === String(performanceEntryId || ""));
    if (index < 0) return { ok: false, errors: ["Registro de rendimiento no encontrado."] };
    if (!rules.normalizeText(reason)) return { ok: false, errors: ["El motivo de anulación es obligatorio."] };
    if (store.performance_entries[index].status === "ANULADO") return { ok: false, errors: ["El rendimiento ya está anulado."] };
    const before = clone(store.performance_entries[index]);
    const user = activeUser();
    store.performance_entries[index] = {
      ...store.performance_entries[index],
      status: "ANULADO",
      void_reason: rules.normalizeText(reason),
      voided_at: nowIso(),
      voided_by: user.id,
      updated_at: nowIso(),
      updated_by: user.id
    };
    persist();
    audit({
      action: "ANULAR_RENDIMIENTO",
      entityType: "payroll_performance_entry",
      entityId: before.performance_entry_id,
      entityLabel: before.employee_id,
      documentLabel: `${before.date} ${before.activity}`,
      previousStatus: before.status,
      nextStatus: "ANULADO",
      description: "Se anuló un registro de rendimiento.",
      reason,
      before,
      after: store.performance_entries[index]
    });
    return { ok: true, performance_entry: clone(store.performance_entries[index]) };
  }

  function accumulateHours(filters = {}) {
    const rows = listHourEntries({ ...filters, status: "ACTIVO" });
    const byEmployee = new Map();
    rows.forEach(item => {
      const current = byEmployee.get(item.employee_id) || {
        employee_id: item.employee_id,
        normal_hours: 0,
        additional_hours: 0,
        total_hours: 0,
        normal_total: 0,
        additional_total: 0,
        total: 0,
        entry_count: 0
      };
      current.normal_hours = rules.round(current.normal_hours + item.normal_hours, 4);
      current.additional_hours = rules.round(current.additional_hours + item.additional_hours, 4);
      current.total_hours = rules.round(current.total_hours + item.total_hours, 4);
      current.normal_total = rules.round(current.normal_total + item.normal_total, 2);
      current.additional_total = rules.round(current.additional_total + item.additional_total, 2);
      current.total = rules.round(current.total + item.total, 2);
      current.entry_count += 1;
      byEmployee.set(item.employee_id, current);
    });
    const employees = [...byEmployee.values()];
    return {
      from: String(filters.from || filters.date_from || ""),
      to: String(filters.to || filters.date_to || ""),
      rows,
      employees,
      totals: employees.reduce((total, item) => ({
        normal_hours: rules.round(total.normal_hours + item.normal_hours, 4),
        additional_hours: rules.round(total.additional_hours + item.additional_hours, 4),
        total_hours: rules.round(total.total_hours + item.total_hours, 4),
        normal_total: rules.round(total.normal_total + item.normal_total, 2),
        additional_total: rules.round(total.additional_total + item.additional_total, 2),
        total: rules.round(total.total + item.total, 2),
        entry_count: total.entry_count + item.entry_count
      }), { normal_hours: 0, additional_hours: 0, total_hours: 0, normal_total: 0, additional_total: 0, total: 0, entry_count: 0 })
    };
  }

  function accumulatePerformance(filters = {}) {
    const rows = listPerformanceEntries({ ...filters, status: "ACTIVO" });
    const byEmployee = new Map();
    rows.forEach(item => {
      const current = byEmployee.get(item.employee_id) || {
        employee_id: item.employee_id,
        quantity: 0,
        total: 0,
        entry_count: 0,
        breakdown: {}
      };
      current.quantity = rules.round(current.quantity + item.quantity, 4);
      current.total = rules.round(current.total + item.total_generated, 2);
      current.entry_count += 1;
      const key = `${item.activity}:${item.unit}`;
      const part = current.breakdown[key] || {
        activity: item.activity,
        unit: item.unit,
        quantity: 0,
        total: 0,
        entry_count: 0
      };
      part.quantity = rules.round(part.quantity + item.quantity, 4);
      part.total = rules.round(part.total + item.total_generated, 2);
      part.entry_count += 1;
      current.breakdown[key] = part;
      byEmployee.set(item.employee_id, current);
    });
    const employees = [...byEmployee.values()].map(item => ({
      ...item,
      breakdown: Object.values(item.breakdown)
    }));
    return {
      from: String(filters.from || filters.date_from || ""),
      to: String(filters.to || filters.date_to || ""),
      rows,
      employees,
      totals: employees.reduce((total, item) => ({
        quantity: rules.round(total.quantity + item.quantity, 4),
        total: rules.round(total.total + item.total, 2),
        entry_count: total.entry_count + item.entry_count
      }), { quantity: 0, total: 0, entry_count: 0 })
    };
  }

  function buildPeriodInputs(filters = {}) {
    const companyId = companyIdOrDefault(filters.company_id || filters.companyId);
    const employees = listEmployees({
      company_id: companyId,
      area: filters.area,
      status: filters.include_inactive ? "" : "ACTIVO",
      calculation_mode: filters.calculation_mode || filters.calculationMode
    });
    const sourceFilters = { ...filters, company_id: companyId };
    delete sourceFilters.period_id;
    delete sourceFilters.periodId;
    const hours = accumulateHours(sourceFilters);
    const performance = accumulatePerformance(sourceFilters);
    const hoursByEmployee = new Map(hours.employees.map(item => [item.employee_id, item]));
    const performanceByEmployee = new Map(performance.employees.map(item => [item.employee_id, item]));
    return {
      company_id: companyId,
      period_id: String(filters.period_id || filters.periodId || ""),
      from: String(filters.from || filters.date_from || ""),
      to: String(filters.to || filters.date_to || ""),
      employees: employees.map(employee => ({
        employee,
        hours: hoursByEmployee.get(employee.employee_id) || {
          employee_id: employee.employee_id,
          normal_hours: 0,
          additional_hours: 0,
          total_hours: 0,
          normal_total: 0,
          additional_total: 0,
          total: 0,
          entry_count: 0
        },
        performance: performanceByEmployee.get(employee.employee_id) || {
          employee_id: employee.employee_id,
          quantity: 0,
          total: 0,
          entry_count: 0,
          breakdown: []
        }
      })),
      totals: {
        hours: hours.totals,
        performance: performance.totals
      }
    };
  }

  function resetLocalDemoData() {
    const db = database();
    const before = clone(db.payroll || null);
    db.payroll = data.createPayrollStore();
    persist();
    audit({
      action: "RESTABLECER_DEMO_ROL",
      entityType: "payroll_store",
      entityId: db.payroll.default_company_id,
      entityLabel: "Rol de pagos local/demo",
      description: "Se restablecieron únicamente los datos locales/demo del rol de pagos.",
      before,
      after: db.payroll
    });
    return clone(db.payroll);
  }

  const service = {
    ensureStore,
    getStoreSnapshot: () => clone(ensureStore()),
    resetLocalDemoData,
    listEmployees,
    employees,
    findEmployee,
    findEmployeeBySellerId,
    saveEmployee,
    deactivateEmployee,
    employeeUsage,
    deleteEmployee,
    getParameters,
    saveParameters,
    getObligationSettings,
    saveObligationSettings,
    listRateRules,
    saveRateRule,
    deactivateRateRule,
    resolveRate,
    listHourEntries,
    saveHourEntry,
    voidHourEntry,
    listPerformanceEntries,
    savePerformanceEntry,
    voidPerformanceEntry,
    accumulateHours,
    accumulatePerformance,
    buildPeriodInputs
  };

  BlessERP.payrollService = service;
  BlessERP.payroll = {
    data,
    rules,
    service
  };
})();
