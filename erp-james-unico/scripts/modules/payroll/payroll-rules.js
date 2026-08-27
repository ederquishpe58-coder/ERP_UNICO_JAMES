(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.payrollData;

  function number(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    const normalized = number(value);
    const tolerance = normalized === 0 ? 0 : Math.sign(normalized) * 1e-9;
    return Math.round((normalized + tolerance) * factor) / factor;
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeCode(value) {
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
  }

  function isIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value))) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function isDateWithin(date, from, to) {
    if (!isIsoDate(date)) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  function calculateHourlyRate(monthlySalary, divisor = 240) {
    const salary = number(monthlySalary);
    const normalizedDivisor = number(divisor);
    if (salary < 0 || normalizedDivisor <= 0) return 0;
    return round(salary / normalizedDivisor, 10);
  }

  function calculateHours(hours, hourlyRate, multiplier = 1) {
    const quantity = number(hours);
    const rate = number(hourlyRate);
    const factor = number(multiplier, 1);
    if (quantity < 0 || rate < 0 || factor <= 0) return 0;
    return round(quantity * rate * factor, 2);
  }

  function calculateHourComponents(normalHours, additionalHours, hourlyRate, additionalMultiplier = 1) {
    const normal = Math.max(0, number(normalHours));
    const additional = Math.max(0, number(additionalHours));
    const rate = Math.max(0, number(hourlyRate));
    const multiplier = number(additionalMultiplier, 1);
    const normalTotal = calculateHours(normal, rate, 1);
    const additionalTotal = calculateHours(additional, rate, multiplier);
    return {
      normal_hours: round(normal, 4),
      additional_hours: round(additional, 4),
      total_hours: round(normal + additional, 4),
      hourly_rate: round(rate, 6),
      multiplier: round(multiplier, 4),
      normal_total: normalTotal,
      additional_total: additionalTotal,
      total: round(normalTotal + additionalTotal, 2)
    };
  }

  function calculatePerformance(quantity, tariff) {
    const normalizedQuantity = number(quantity);
    const normalizedTariff = number(tariff);
    if (normalizedQuantity < 0 || normalizedTariff < 0) return 0;
    return round(normalizedQuantity * normalizedTariff, 2);
  }

  function calculateProportionalSalary(monthlySalary, workedDays) {
    const salary = number(monthlySalary);
    const days = number(workedDays);
    if (salary < 0 || days < 0 || days > 30) return 0;
    return round((salary / 30) * days, 2);
  }

  function validateEmployee(employee = {}, existingEmployees = [], currentEmployeeId = "") {
    const errors = [];
    const areaCodes = new Set((data?.AREAS || []).map(item => item.code));
    const modeCodes = new Set((data?.CALCULATION_MODES || []).map(item => item.code));
    const statusCodes = new Set((data?.EMPLOYEE_STATUSES || []).map(item => item.code));
    const unitCodes = new Set((data?.PERFORMANCE_UNITS || []).map(item => item.code));
    const salaryModes = new Set((data?.SALARY_PAYMENT_MODES || []).map(item => item.code));

    if (!normalizeText(employee.employee_id)) errors.push("El empleado_id estable es obligatorio.");
    if (!normalizeText(employee.company_id)) errors.push("La empresa es obligatoria.");
    if (!normalizeText(employee.code)) errors.push("El código interno es obligatorio.");
    if (!normalizeText(employee.identification)) errors.push("La identificación o cédula es obligatoria.");
    if (!normalizeText(employee.full_name)) errors.push("Los nombres y apellidos son obligatorios.");
    if (!isIsoDate(employee.hire_date)) errors.push("La fecha de ingreso debe ser una fecha válida.");
    if (!areaCodes.has(employee.area)) errors.push("El área del trabajador no es válida.");
    if (!normalizeText(employee.position)) errors.push("El cargo o actividad es obligatorio.");
    if (!statusCodes.has(employee.status)) errors.push("El estado del trabajador no es válido.");
    if (!modeCodes.has(employee.calculation_mode)) errors.push("La modalidad de cálculo no es válida.");
    if (!salaryModes.has(employee.salary_payment_mode)) errors.push("La forma de cálculo del sueldo no es válida.");
    if (number(employee.monthly_salary) < 0) errors.push("El sueldo base no puede ser negativo.");
    if (number(employee.hourly_rate) < 0) errors.push("La tarifa por hora no puede ser negativa.");
    if (number(employee.performance_rate) < 0) errors.push("La tarifa por rendimiento no puede ser negativa.");
    if (!unitCodes.has(employee.performance_unit)) errors.push("La unidad de rendimiento no es válida.");
    if (number(employee.goal) < 0) errors.push("La meta no puede ser negativa.");
    if (!normalizeText(employee.account_code)) errors.push("La cuenta contable del trabajador es obligatoria.");

    const modesWithSalary = ["SUELDO_MENSUAL", "MIXTA"];
    const modesWithHours = ["PAGO_POR_HORA", "MIXTA"];
    const modesWithPerformance = ["PAGO_POR_RENDIMIENTO", "MIXTA"];
    if (modesWithSalary.includes(employee.calculation_mode) && number(employee.monthly_salary) <= 0
      && employee.calculation_mode !== "MIXTA") {
      errors.push("La modalidad mensual requiere un sueldo base mayor que cero.");
    }
    if (modesWithHours.includes(employee.calculation_mode)
      && number(employee.hourly_rate) <= 0
      && number(employee.monthly_salary) <= 0) {
      errors.push("La modalidad por hora requiere una tarifa o un sueldo base para calcularla.");
    }
    if (modesWithPerformance.includes(employee.calculation_mode)
      && number(employee.performance_rate) <= 0
      && employee.calculation_mode !== "MIXTA") {
      errors.push("La modalidad por rendimiento requiere una tarifa mayor que cero.");
    }
    if (employee.calculation_mode === "COMISION_POR_VENTAS" && !normalizeText(employee.seller_id)) {
      errors.push("La modalidad de comisión requiere vendedor_id.");
    }
    if (employee.calculation_mode === "MIXTA"
      && [employee.monthly_salary, employee.hourly_rate, employee.performance_rate].every(value => number(value) <= 0)
      && !normalizeText(employee.seller_id)) {
      errors.push("La modalidad mixta requiere al menos una fuente de pago configurada.");
    }

    const companyId = normalizeText(employee.company_id);
    const employeeId = normalizeText(currentEmployeeId || employee.employee_id);
    const duplicateCode = existingEmployees.find(item =>
      normalizeText(item.employee_id) !== employeeId
      && normalizeText(item.company_id) === companyId
      && normalizeCode(item.code) === normalizeCode(employee.code)
    );
    if (duplicateCode) errors.push("El código interno ya está asignado a otro trabajador de la empresa.");
    const duplicateIdentification = existingEmployees.find(item =>
      normalizeText(item.employee_id) !== employeeId
      && normalizeText(item.company_id) === companyId
      && normalizeText(item.identification) === normalizeText(employee.identification)
    );
    if (duplicateIdentification) errors.push("La identificación ya está asignada a otro trabajador de la empresa.");

    return { ok: errors.length === 0, errors };
  }

  function validateRateRule(rule = {}, employees = []) {
    const errors = [];
    const employee = employees.find(item => item.employee_id === rule.employee_id);
    const payTypes = new Set((data?.PAY_TYPES || []).map(item => item.code));
    const units = new Set((data?.PERFORMANCE_UNITS || []).map(item => item.code));
    if (!normalizeText(rule.rate_id)) errors.push("El rate_id es obligatorio.");
    if (!normalizeText(rule.company_id)) errors.push("La empresa es obligatoria.");
    if (!employee) errors.push("El empleado indicado no existe.");
    if (employee && employee.company_id !== rule.company_id) errors.push("El empleado no pertenece a la empresa de la tarifa.");
    if (!payTypes.has(rule.pay_type)) errors.push("El tipo de tarifa no es válido.");
    if (rule.pay_type === "RENDIMIENTO" && !units.has(rule.unit)) errors.push("La unidad de rendimiento no es válida.");
    if (number(rule.amount) <= 0) errors.push("La tarifa debe ser mayor que cero.");
    if (!isIsoDate(rule.valid_from)) errors.push("La fecha inicial de la tarifa no es válida.");
    if (rule.valid_to && !isIsoDate(rule.valid_to)) errors.push("La fecha final de la tarifa no es válida.");
    if (rule.valid_to && rule.valid_to < rule.valid_from) errors.push("La fecha final no puede ser anterior a la fecha inicial.");
    return { ok: errors.length === 0, errors };
  }

  function validateHourEntry(entry = {}, employee, parameters = {}) {
    const errors = [];
    if (!employee) errors.push("El empleado indicado no existe.");
    if (employee && employee.company_id !== entry.company_id) errors.push("El empleado no pertenece a la empresa del registro.");
    if (!isIsoDate(entry.date)) errors.push("La fecha del registro de horas no es válida.");
    if (!normalizeText(entry.activity)) errors.push("La actividad es obligatoria.");
    if (number(entry.normal_hours) < 0 || number(entry.additional_hours) < 0) errors.push("Las horas no pueden ser negativas.");
    if (number(entry.normal_hours) + number(entry.additional_hours) <= 0) errors.push("Debe registrar al menos una hora.");
    if (number(entry.hourly_rate) <= 0) errors.push("El valor por hora debe ser mayor que cero.");
    if (number(entry.multiplier) <= 0) errors.push("El multiplicador debe ser mayor que cero.");
    const configuredTypes = new Set((parameters.hour_multipliers || []).filter(item => item.active !== false).map(item => item.code));
    if (!configuredTypes.has(entry.hour_type)) errors.push("El tipo de hora no está activo en los parámetros.");
    return { ok: errors.length === 0, errors };
  }

  function validatePerformanceEntry(entry = {}, employee) {
    const errors = [];
    const units = new Set((data?.PERFORMANCE_UNITS || []).map(item => item.code));
    if (!employee) errors.push("El empleado indicado no existe.");
    if (employee && employee.company_id !== entry.company_id) errors.push("El empleado no pertenece a la empresa del registro.");
    if (!isIsoDate(entry.date)) errors.push("La fecha del rendimiento no es válida.");
    if (!normalizeText(entry.activity)) errors.push("La actividad es obligatoria.");
    if (!units.has(entry.unit)) errors.push("La unidad de rendimiento no es válida.");
    if (number(entry.quantity) <= 0) errors.push("La cantidad realizada debe ser mayor que cero.");
    if (number(entry.tariff) <= 0) errors.push("La tarifa aplicada debe ser mayor que cero.");
    if (!normalizeText(entry.origin)) errors.push("El origen del registro es obligatorio.");
    return { ok: errors.length === 0, errors };
  }

  function rateSpecificity(rule, context) {
    let score = 0;
    if (rule.activity && rule.activity === context.activity) score += 16;
    if (rule.period_id && rule.period_id === context.period_id) score += 8;
    if (rule.season && rule.season === context.season) score += 4;
    if (rule.unit && rule.unit === context.unit) score += 2;
    score += Math.max(0, number(rule.priority)) / 1000;
    return score;
  }

  function resolveEffectiveRate(rules = [], context = {}) {
    const date = context.date;
    const candidates = rules
      .filter(rule => rule.active !== false)
      .filter(rule => rule.company_id === context.company_id)
      .filter(rule => rule.employee_id === context.employee_id)
      .filter(rule => rule.pay_type === context.pay_type)
      .filter(rule => isDateWithin(date, rule.valid_from, rule.valid_to))
      .filter(rule => !rule.activity || rule.activity === context.activity)
      .filter(rule => !rule.period_id || rule.period_id === context.period_id)
      .filter(rule => !rule.season || rule.season === context.season)
      .filter(rule => !rule.unit || rule.unit === context.unit)
      .sort((a, b) => (
        rateSpecificity(b, context) - rateSpecificity(a, context)
        || String(b.valid_from).localeCompare(String(a.valid_from))
        || number(b.priority) - number(a.priority)
        || String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
      ));
    return candidates[0] || null;
  }

  BlessERP.payrollRules = {
    number,
    round,
    normalizeText,
    normalizeCode,
    isIsoDate,
    isDateWithin,
    calculateHourlyRate,
    calculateHours,
    calculateHourComponents,
    calculatePerformance,
    calculateProportionalSalary,
    validateEmployee,
    validateRateRule,
    validateHourEntry,
    validatePerformanceEntry,
    resolveEffectiveRate
  };
})();
