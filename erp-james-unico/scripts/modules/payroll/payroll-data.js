(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const SCHEMA_VERSION = 1;
  const DEFAULT_COMPANY_ID = "COMP-BLESS-FLOWER";

  const AREAS = Object.freeze([
    { code: "ADMINISTRATIVA", label: "Administrativa" },
    { code: "POSCOSECHA", label: "Poscosecha" },
    { code: "VENTAS", label: "Ventas" }
  ]);

  const CALCULATION_MODES = Object.freeze([
    { code: "SUELDO_MENSUAL", label: "Sueldo mensual" },
    { code: "PAGO_POR_HORA", label: "Pago por hora" },
    { code: "PAGO_POR_RENDIMIENTO", label: "Pago por rendimiento" },
    { code: "COMISION_POR_VENTAS", label: "Comisión por ventas" },
    { code: "MIXTA", label: "Modalidad mixta" }
  ]);

  const EMPLOYEE_STATUSES = Object.freeze([
    { code: "ACTIVO", label: "Activo" },
    { code: "INACTIVO", label: "Inactivo" }
  ]);

  const SALARY_PAYMENT_MODES = Object.freeze([
    { code: "COMPLETO", label: "Sueldo mensual completo" },
    { code: "PROPORCIONAL", label: "Sueldo proporcional" }
  ]);

  const PERFORMANCE_UNITS = Object.freeze([
    { code: "TALLOS", label: "Tallos" },
    { code: "BONCHES", label: "Bonches" },
    { code: "MALLAS", label: "Mallas" },
    { code: "CAJAS", label: "Cajas" },
    { code: "HORAS", label: "Horas" },
    { code: "OTRA", label: "Otra unidad" }
  ]);

  const PAY_TYPES = Object.freeze([
    { code: "HORA", label: "Pago por hora" },
    { code: "RENDIMIENTO", label: "Pago por rendimiento" }
  ]);

  const DEFAULT_ACTIVITIES = Object.freeze([
    { code: "ADMINISTRACION", label: "Administración", area: "ADMINISTRATIVA", active: true },
    { code: "RECEPCION_FLOR", label: "Recepción de flor", area: "POSCOSECHA", active: true },
    { code: "CLASIFICACION", label: "Clasificación", area: "POSCOSECHA", active: true },
    { code: "EMBONCHE", label: "Embonche", area: "POSCOSECHA", active: true },
    { code: "EMPAQUE", label: "Apoyo en empaque", area: "POSCOSECHA", active: true },
    { code: "BODEGA", label: "Apoyo en bodega", area: "POSCOSECHA", active: true },
    { code: "LIMPIEZA", label: "Limpieza", area: "POSCOSECHA", active: true },
    { code: "VENTAS", label: "Ventas", area: "VENTAS", active: true },
    { code: "OTRA", label: "Otra actividad", area: "", active: true }
  ]);

  const LABOR_OBLIGATIONS = Object.freeze([
    { code: "IESS_PERSONAL", label: "Aporte personal al IESS", activeByDefault: false },
    { code: "IESS_PATRONAL", label: "Aporte patronal al IESS", activeByDefault: false },
    { code: "DECIMO_TERCERO", label: "Décimo tercero", activeByDefault: false },
    { code: "DECIMO_CUARTO", label: "Décimo cuarto", activeByDefault: false },
    { code: "FONDOS_RESERVA", label: "Fondos de reserva", activeByDefault: false },
    { code: "VACACIONES_PROVISIONADAS", label: "Vacaciones provisionadas", activeByDefault: false },
    { code: "UTILIDADES", label: "Utilidades", activeByDefault: false },
    { code: "PRESTAMO_QUIROGRAFARIO", label: "Préstamo quirografario", activeByDefault: false },
    { code: "PRESTAMO_HIPOTECARIO", label: "Préstamo hipotecario", activeByDefault: false }
  ]);

  const DEFAULT_HOUR_MULTIPLIERS = Object.freeze([
    { code: "NORMAL", label: "Hora normal", multiplier: 1, active: true },
    { code: "SUPLEMENTARIA_50", label: "Hora suplementaria 50 %", multiplier: 1.5, active: true },
    { code: "EXTRAORDINARIA_100", label: "Hora extraordinaria 100 %", multiplier: 2, active: true }
  ]);

  const DEMO_EMPLOYEE_IDS = Object.freeze({
    ROCIO: "EMP-BLF-OPS-001",
    DANIELA: "EMP-BLF-OPS-002",
    CAMILA: "EMP-BLF-OPS-003",
    PEDRO: "EMP-BLF-OPS-004",
    EDER: "EMP-BLF-OPS-005",
    MATEO: "EMP-BLF-OPS-006",
    JUAN: "EMP-BLF-OPS-007",
    ANDREA: "EMP-BLF-OPS-008",
    MARCO: "EMP-BLF-OPS-009",
    JAMES_VENTAS: "EMP-BLF-VEN-001",
    VENDEDOR_EXPORTACIONES: "EMP-BLF-VEN-002"
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultObligationSettings(companyId = DEFAULT_COMPANY_ID, periodId = "") {
    return {
      company_id: String(companyId || DEFAULT_COMPANY_ID),
      period_id: String(periodId || ""),
      obligations: LABOR_OBLIGATIONS.map(item => ({
        code: item.code,
        label: item.label,
        active: false
      })),
      updated_at: "",
      updated_by: ""
    };
  }

  function createDefaultParameters(companyId = DEFAULT_COMPANY_ID) {
    return {
      company_id: String(companyId || DEFAULT_COMPANY_ID),
      hour_divisor: 240,
      hour_multipliers: clone(DEFAULT_HOUR_MULTIPLIERS),
      performance_calculation: {
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
        seller_sales_basis: "GENERATED"
      },
      performance_units: clone(PERFORMANCE_UNITS),
      activities: clone(DEFAULT_ACTIVITIES),
      updated_at: "",
      updated_by: ""
    };
  }

  function isOperationalDeployment() {
    const configured = typeof BlessERP.getAppMode === "function"
      ? BlessERP.getAppMode()
      : window.__ERP_ENV__?.VITE_APP_ENV;
    return String(configured || "").trim().toLowerCase() !== "demo";
  }

  function createDemoEmployees(companyId = DEFAULT_COMPANY_ID) {
    if (isOperationalDeployment()) return [];
    const now = "2026-07-01T00:00:00.000Z";
    const base = {
      company_id: String(companyId || DEFAULT_COMPANY_ID),
      user_id: "",
      seller_id: "",
      hire_date: "2026-01-01",
      area: "POSCOSECHA",
      status: "ACTIVO",
      salary_payment_mode: "COMPLETO",
      monthly_salary: 0,
      hourly_rate: 0,
      performance_rate: 0,
      performance_unit: "OTRA",
      goal: 0,
      probation_period: false,
      probation_end_date: "",
      account_code: "5.6.01",
      notes: "Trabajador local/demo vinculado por employee_id; reemplazar sus datos antes de producción.",
      external_refs: {},
      created_at: now,
      created_by: "SYSTEM-DEMO",
      updated_at: now,
      updated_by: "SYSTEM-DEMO"
    };
    const row = seed => ({ ...base, ...seed });
    return [
      row({ employee_id: DEMO_EMPLOYEE_IDS.ROCIO, code: "POS-001", identification: "DEMO-BLF-OPS-001", full_name: "Rocio T.", position: "Clasificadora", calculation_mode: "PAGO_POR_RENDIMIENTO", performance_rate: 0.01, performance_unit: "TALLOS", goal: 264, external_refs: { classifier_id: "CLA-001" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.DANIELA, code: "POS-002", identification: "DEMO-BLF-OPS-002", full_name: "Daniela C.", position: "Clasificadora", calculation_mode: "PAGO_POR_RENDIMIENTO", performance_rate: 0.01, performance_unit: "TALLOS", goal: 264, external_refs: { classifier_id: "CLA-002" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.CAMILA, code: "POS-003", identification: "DEMO-BLF-OPS-003", full_name: "Camila V.", position: "Clasificadora", calculation_mode: "PAGO_POR_RENDIMIENTO", performance_rate: 0.01, performance_unit: "TALLOS", goal: 264, external_refs: { classifier_id: "CLA-003" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.PEDRO, code: "POS-004", identification: "DEMO-BLF-OPS-004", full_name: "Pedro M.", position: "Embonchador", calculation_mode: "PAGO_POR_RENDIMIENTO", performance_rate: 0.14, performance_unit: "BONCHES", goal: 200, external_refs: { buncher_id: "EMB-001" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.EDER, code: "POS-005", identification: "DEMO-BLF-OPS-005", full_name: "Eder Q.", position: "Embonchador", calculation_mode: "PAGO_POR_RENDIMIENTO", performance_rate: 0.14, performance_unit: "BONCHES", goal: 200, external_refs: { buncher_id: "EMB-002" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.MATEO, code: "POS-006", identification: "DEMO-BLF-OPS-006", full_name: "Mateo G.", position: "Embonchador y apoyo en recepción", calculation_mode: "MIXTA", monthly_salary: 482, performance_rate: 0.14, performance_unit: "BONCHES", goal: 200, external_refs: { buncher_id: "EMB-003", receptionist_id: "REC-003" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.JUAN, code: "POS-007", identification: "DEMO-BLF-OPS-007", full_name: "Juan S.", position: "Recepción y bodega", calculation_mode: "PAGO_POR_HORA", monthly_salary: 482, performance_unit: "HORAS", external_refs: { receptionist_id: "REC-001", responsible_id: "RSP-001" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.ANDREA, code: "POS-008", identification: "DEMO-BLF-OPS-008", full_name: "Andrea P.", position: "Recepción", calculation_mode: "PAGO_POR_HORA", monthly_salary: 482, performance_unit: "HORAS", external_refs: { receptionist_id: "REC-002", responsible_id: "RSP-002" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.MARCO, code: "POS-009", identification: "DEMO-BLF-OPS-009", full_name: "Marco A.", position: "Responsable de despacho", calculation_mode: "PAGO_POR_HORA", monthly_salary: 482, performance_unit: "HORAS", external_refs: { responsible_id: "RSP-003" } }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.JAMES_VENTAS, company_id: String(companyId || DEFAULT_COMPANY_ID), user_id: "USR-ADMIN-001", seller_id: "SELL-BLF-001", code: "VEN-001", identification: "DEMO-BLF-VEN-001", full_name: "James Lanchimba", hire_date: "2026-01-01", area: "VENTAS", position: "Vendedor", status: "ACTIVO", calculation_mode: "MIXTA", salary_payment_mode: "COMPLETO", monthly_salary: 482, hourly_rate: 0, performance_rate: 0, performance_unit: "OTRA", goal: 0, probation_period: false, probation_end_date: "", account_code: "5.6.03", notes: "Vendedor local/demo vinculado por seller_id; reemplazar sus datos antes de producción.", external_refs: {}, created_at: now, created_by: "SYSTEM-DEMO", updated_at: now, updated_by: "SYSTEM-DEMO" }),
      row({ employee_id: DEMO_EMPLOYEE_IDS.VENDEDOR_EXPORTACIONES, company_id: String(companyId || DEFAULT_COMPANY_ID), user_id: "", seller_id: "SELL-BLF-002", code: "VEN-002", identification: "DEMO-BLF-VEN-002", full_name: "Vendedor Exportaciones", hire_date: "2026-01-01", area: "VENTAS", position: "Vendedor de exportaciones", status: "ACTIVO", calculation_mode: "COMISION_POR_VENTAS", salary_payment_mode: "COMPLETO", monthly_salary: 0, hourly_rate: 0, performance_rate: 0, performance_unit: "OTRA", goal: 0, probation_period: false, probation_end_date: "", account_code: "5.6.03", notes: "Vendedor local/demo vinculado por seller_id; reemplazar sus datos antes de producción.", external_refs: {}, created_at: now, created_by: "SYSTEM-DEMO", updated_at: now, updated_by: "SYSTEM-DEMO" })
    ];
  }

  function createPayrollStore(companyId = DEFAULT_COMPANY_ID) {
    return {
      schema_version: SCHEMA_VERSION,
      default_company_id: String(companyId || DEFAULT_COMPANY_ID),
      employees: createDemoEmployees(companyId),
      rate_rules: [],
      hour_entries: [],
      performance_entries: [],
      obligation_settings: [],
      parameters_by_company: [createDefaultParameters(companyId)]
    };
  }

  BlessERP.payrollData = {
    SCHEMA_VERSION,
    DEFAULT_COMPANY_ID,
    AREAS,
    CALCULATION_MODES,
    EMPLOYEE_STATUSES,
    SALARY_PAYMENT_MODES,
    PERFORMANCE_UNITS,
    PAY_TYPES,
    DEFAULT_ACTIVITIES,
    LABOR_OBLIGATIONS,
    DEFAULT_HOUR_MULTIPLIERS,
    DEMO_EMPLOYEE_IDS,
    createDefaultObligationSettings,
    createDefaultParameters,
    createDemoEmployees,
    createPayrollStore
  };
})();
