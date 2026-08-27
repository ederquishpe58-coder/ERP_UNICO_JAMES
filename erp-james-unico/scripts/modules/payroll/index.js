(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const utils = BlessERP.utils;

  function store() {
    const current = BlessERP.payrollEngine.payrollStore();
    current.ui = current.ui && typeof current.ui === "object" ? current.ui : {};
    current.ui.selectedPrintIds = Array.isArray(current.ui.selectedPrintIds) ? current.ui.selectedPrintIds : [];
    current.ui.currentRunId = current.ui.currentRunId || current.runs[0]?.id || "";
    current.ui.obligationPeriodId = current.ui.obligationPeriodId || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    current.ui.obligationCompanyId = current.ui.obligationCompanyId || current.default_company_id || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER";
    return current;
  }

  function refresh(options = {}) {
    if (options.persist !== false) stateApi.saveDb();
    BlessERP.layout.renderPage();
  }

  function toastResult(result, success) {
    if (result?.ok) BlessERP.layout.toast(success);
    else BlessERP.layout.toast((result?.errors || [result?.message || "No se pudo completar la operación."]).join(" "));
    return result?.ok;
  }

  function header(route, actions = "") {
    return `
      <section class="payroll-page-header">
        <div><p class="section-kicker">ADMINISTRACIÓN / ROL DE PAGOS</p><h1>${utils.esc(route.title)}</h1><p>${utils.esc(route.description)}</p></div>
        <div class="table-actions-inline">${actions}</div>
      </section>
    `;
  }

  function field(label, input) {
    return `<label class="compact-field"><span>${utils.esc(label)}</span>${input}</label>`;
  }

  function employeeRows() {
    return BlessERP.payrollService?.listEmployees?.() || (BlessERP.payrollEngine ? BlessERP.payrollEngine.payrollStore().employees : []);
  }

  function companyLabel(companyId) {
    const normalized = String(companyId || "");
    if (normalized === "COMP-BLESS-FLOWER") return "Bless Flower";
    if (normalized === "COMP-IMPERIO-FLOWERS") return "Imperio Flowers";
    return normalized || "Sin empresa";
  }

  function companyOptions(selected = "COMP-BLESS-FLOWER") {
    return [
      { id: "COMP-BLESS-FLOWER", name: "Bless Flower" },
      { id: "COMP-IMPERIO-FLOWERS", name: "Imperio Flowers" }
    ].map(company => `<option value="${utils.esc(company.id)}" ${company.id === selected ? "selected" : ""}>${utils.esc(company.name)}</option>`).join("");
  }

  function employeeOptions(selected = "") {
    return employeeRows().map(employee => `<option value="${utils.esc(employee.employee_id || employee.id || employee.employeeId)}" ${(employee.employee_id || employee.id || employee.employeeId) === selected ? "selected" : ""}>${utils.esc(`${companyLabel(employee.company_id || employee.companyId)} · ${employee.code || employee.internalCode || ""} · ${employee.full_name || employee.fullName || employee.names || employee.name || ""}`)}</option>`).join("");
  }

  function employeeName(employeeId) {
    const employee = employeeRows().find(item => (item.employee_id || item.id || item.employeeId) === employeeId);
    return employee?.full_name || employee?.fullName || employee?.names || employee?.name || employeeId || "";
  }

  function postharvestPeople() {
    const operations = BlessERP.operacionesState?.getStore?.(stateApi.state) || stateApi.state.db.operations || {};
    const masterData = operations.masterData || {};
    const typeLabels = {
      classifiers: "Clasificador",
      bunchers: "Embonchador",
      receptionists: "Recepción",
      responsibles: "Responsable"
    };
    const people = new Map();
    Object.entries(typeLabels).forEach(([type, role]) => {
      (masterData[type] || []).filter(item => item.active !== false).forEach(item => {
        const employeeId = String(item.employee_id || item.employeeId || "");
        const key = employeeId || `${type}:${item.id || item.name}`;
        const current = people.get(key) || {
          key,
          employeeId,
          name: item.name || employeeName(employeeId),
          roles: [],
          linked: Boolean(employeeId)
        };
        if (!current.roles.includes(role)) current.roles.push(role);
        people.set(key, current);
      });
    });
    return [...people.values()].map(person => ({
      ...person,
      performanceRole: person.roles.includes("Clasificador")
        ? "CLASIFICACION"
        : person.roles.includes("Embonchador")
          ? "EMBONCHE"
          : "",
      performanceUnit: person.roles.includes("Clasificador")
        ? "TALLOS"
        : person.roles.includes("Embonchador")
          ? "BONCHES"
          : ""
    }));
  }

  function saveEmployee(payload) {
    const service = BlessERP.payrollService;
    if (service?.saveEmployee) return service.saveEmployee(payload);
    const current = store();
    const candidate = {
      ...payload,
      id: payload.id || utils.uid("EMP"),
      employeeId: payload.id || utils.uid("EMP"),
      status: payload.status || "ACTIVO",
      createdAt: new Date().toISOString()
    };
    candidate.employeeId = candidate.id;
    const errors = [];
    if (!candidate.code) errors.push("El código interno es obligatorio.");
    if (!candidate.identification) errors.push("La identificación es obligatoria.");
    if (!candidate.fullName) errors.push("Los nombres y apellidos son obligatorios.");
    if (current.employees.some(item => item.id !== candidate.id && item.code === candidate.code)) errors.push("El código interno ya existe.");
    if (current.employees.some(item => item.id !== candidate.id && item.identification === candidate.identification)) errors.push("La identificación ya existe.");
    if (errors.length) return { ok: false, errors };
    current.employees.unshift(candidate);
    stateApi.saveDb();
    return { ok: true, employee: candidate };
  }

  function saveHours(payload) {
    const service = BlessERP.payrollService;
    if (service?.saveHourEntry) return service.saveHourEntry(payload);
    if (service?.saveTimeEntry) return service.saveTimeEntry(payload);
    if (service?.saveWorkTimeEntry) return service.saveWorkTimeEntry(payload);
    const current = store();
    const normalHours = Number(payload.normalHours || 0);
    const additionalHours = Number(payload.additionalHours || 0);
    const hourlyRate = Number(payload.hourlyRate || 0);
    const multiplier = Number(payload.multiplier || 1);
    const entry = {
      id: utils.uid("PTE"), ...payload, normalHours, additionalHours, hourlyRate, multiplier,
      normalTotal: Math.round(normalHours * hourlyRate * 100) / 100,
      additionalTotal: Math.round(additionalHours * hourlyRate * multiplier * 100) / 100,
      total: Math.round((normalHours * hourlyRate + additionalHours * hourlyRate * multiplier) * 100) / 100,
      createdAt: new Date().toISOString()
    };
    current.timeEntries.push(entry);
    stateApi.saveDb();
    return { ok: true, entry };
  }

  function savePerformance(payload) {
    const service = BlessERP.payrollService;
    if (service?.savePerformanceEntry) return service.savePerformanceEntry(payload);
    const current = store();
    const quantity = Number(payload.quantity || 0);
    const appliedRate = Number(payload.appliedRate || 0);
    const entry = {
      id: utils.uid("PPE"), ...payload, quantity, appliedRate,
      total: Math.round(quantity * appliedRate * 100) / 100,
      createdAt: new Date().toISOString()
    };
    current.performanceEntries.push(entry);
    stateApi.saveDb();
    return { ok: true, entry };
  }

  function nextEmployeeCode() {
    const used = new Set(employeeRows().map(item => String(item.code || "").toUpperCase()));
    let sequence = employeeRows().length + 1;
    let code = "";
    do {
      code = `PER-${String(sequence).padStart(3, "0")}`;
      sequence += 1;
    } while (used.has(code));
    return code;
  }

  function optionRows(rows, selected) {
    return (rows || []).map(item => `<option value="${utils.esc(item.code)}" ${item.code === selected ? "selected" : ""}>${utils.esc(item.label)}</option>`).join("");
  }

  function employeeModal() {
    const current = store();
    const editingId = current.ui.editingEmployeeId || "";
    const existing = editingId ? BlessERP.payrollService?.findEmployee?.(editingId) : null;
    const draft = !existing && current.ui.employeeDraft ? current.ui.employeeDraft : {};
    if (!current.ui.showEmployeeForm && !existing && !Object.keys(draft).length) return "";
    const source = { ...(draft || {}), ...(existing || {}) };
    const role = String(source.prefillRole || source.position || "");
    const isClassifier = /CLASIFIC/i.test(role);
    const isBuncher = /EMBONCH/i.test(role);
    const performanceUnit = source.performance_unit || source.performanceUnit || (isClassifier ? "TALLOS" : isBuncher ? "BONCHES" : "OTRA");
    const calculationMode = source.calculation_mode || source.calculationMode
      || (isClassifier || isBuncher ? "PAGO_POR_RENDIMIENTO" : "SUELDO_MENSUAL");
    const monthlySalary = source.monthly_salary ?? source.monthlySalary ?? (isClassifier || isBuncher ? 0 : 482);
    const performanceRate = source.performance_rate ?? source.performanceRate ?? (isClassifier ? .01 : isBuncher ? .14 : 0);
    const employeeId = source.employee_id || source.employeeId || "";
    return `
      <div class="payroll-detail-panel" data-payroll-employee-modal>
        <article class="payroll-detail-card payroll-employee-editor">
          <div class="payroll-detail-card-head">
            <div><p class="section-kicker">${existing ? "EDITAR PERSONAL" : "NUEVO PERSONAL"}</p><h2>${utils.esc(existing?.full_name || source.fullName || source.name || "Registrar trabajador")}</h2><p>Complete los datos que utilizará el rol de pagos.</p></div>
            <button class="secondary-button" type="button" data-payroll-close-employee>Cerrar</button>
          </div>
          <form class="payroll-employee-form" data-payroll-employee-form>
            <input type="hidden" name="employeeId" value="${utils.esc(employeeId)}">
            ${field("Empresa", `<select name="companyId" required>${companyOptions(source.company_id || source.companyId || current.ui.runCompanyId || "COMP-BLESS-FLOWER")}</select>`)}
            ${field("Código interno", `<input name="code" value="${utils.esc(source.code || "")}" placeholder="Se asigna al guardar">`)}
            ${field("Cédula / identificación", `<input name="identification" value="${utils.esc(source.identification || "")}" required>`)}
            ${field("Apellidos y nombres", `<input name="fullName" value="${utils.esc(source.full_name || source.fullName || source.name || "")}" required>`)}
            ${field("Fecha de ingreso", `<input name="hireDate" type="date" value="${utils.esc(source.hire_date || source.hireDate || utils.today())}" required>`)}
            ${field("Área", `<select name="area" required>${optionRows(BlessERP.payrollData?.AREAS, source.area || (employeeId ? "POSCOSECHA" : "ADMINISTRATIVA"))}</select>`)}
            ${field("Cargo", `<input name="position" value="${utils.esc(source.position || role)}" required>`)}
            ${field("Estado", `<select name="status">${optionRows(BlessERP.payrollData?.EMPLOYEE_STATUSES, source.status || "ACTIVO")}</select>`)}
            ${field("Forma de cálculo", `<select name="calculationMode">${optionRows(BlessERP.payrollData?.CALCULATION_MODES, calculationMode)}</select>`)}
            ${field("Cálculo del sueldo", `<select name="salaryPaymentMode">${optionRows(BlessERP.payrollData?.SALARY_PAYMENT_MODES, source.salary_payment_mode || source.salaryPaymentMode || "COMPLETO")}</select>`)}
            ${field("Sueldo mensual", `<input name="monthlySalary" type="number" min="0" step=".01" value="${utils.esc(monthlySalary)}">`)}
            ${field("Tarifa por hora", `<input name="hourlyRate" type="number" min="0" step=".000001" value="${utils.esc(source.hourly_rate ?? source.hourlyRate ?? 0)}">`)}
            ${field("Tarifa manual (no automática)", `<input name="performanceRate" type="number" min="0" step=".00000001" value="${utils.esc(performanceRate)}" title="Clasificadores, embonchadores y vendedores por rendimiento usan una tarifa automática de 7 u 8 decimales.">`)}
            ${field("Unidad rendimiento", `<select name="performanceUnit">${optionRows(BlessERP.payrollData?.PERFORMANCE_UNITS, performanceUnit)}</select>`)}
            ${field("Cuenta contable", `<input name="accountCode" value="${utils.esc(source.account_code || source.accountCode || (source.area === "VENTAS" ? "5.6.03" : "5.6.01"))}" required>`)}
        ${field("Vendedor ID (si aplica)", `<input name="sellerId" value="${utils.esc(source.seller_id || source.sellerId || "")}" placeholder="Rendimiento por ventas y/o comisiones">`)}
            <label class="compact-field payroll-form-wide"><span>Notas</span><textarea name="notes" rows="2">${utils.esc(source.notes || "")}</textarea></label>
            ${existing ? `<label class="compact-field payroll-form-wide"><span>Motivo de modificación</span><input name="changeReason" required placeholder="Ej. cambio de sueldo para julio"></label>` : ""}
            <div class="payroll-form-actions payroll-form-wide">
              <button class="secondary-button" type="button" data-payroll-close-employee>Cancelar</button>
              <button class="primary-button" type="submit">${existing ? "Guardar cambios" : "Crear personal"}</button>
            </div>
          </form>
        </article>
      </div>
    `;
  }

  function renderEmployees(route) {
    const current = store();
    const employees = employeeRows();
    const people = postharvestPeople();
    const otherEmployees = employees.filter(employee => !people.some(person => person.employeeId === (employee.employee_id || employee.employeeId || employee.id)));
    const payrollParameters = BlessERP.payrollService?.getParameters?.(current.ui.obligationCompanyId || current.default_company_id) || {};
    const performanceParameters = payrollParameters.performance_calculation || {};
    const performancePrecision = [7, 8].includes(Number(performanceParameters.precision))
      ? Number(performanceParameters.precision)
      : 8;
    const obligationSettings = BlessERP.payrollService?.getObligationSettings?.(current.ui.obligationCompanyId, current.ui.obligationPeriodId || "") || null;
    const obligations = obligationSettings?.obligations || current.obligations || current.laborObligations || [];
    return `
      <section class="payroll-page">
        ${header(route, `<button class="primary-button" data-payroll-new-employee>Agregar personal</button><button class="secondary-button" data-payroll-open-poscosecha>Ir a Parámetros de Poscosecha</button>`)}
        <div class="payroll-notice"><strong>Conexión automática:</strong> Poscosecha aporta los tallos clasificados y los bonches ingresados; Ventas aporta los tallos vendidos mediante el vendedor_id. Los proveedores no forman parte del rol y el vendedor solo calcula rendimiento cuando su modalidad es PAGO POR RENDIMIENTO o MIXTA.</div>

        <article class="panel-card payroll-table-wrap">
          <div class="panel-card-head"><div><p class="section-kicker">PERSONAL DE POSCOSECHA</p><h3>${utils.esc(people.length)} personas, sin proveedores</h3></div></div>
          <table class="compact-table payroll-table"><thead><tr><th>Persona</th><th>Cargo en Poscosecha</th><th>Vínculo al rol</th><th>Cálculo automático</th><th>Meta diaria</th><th>Tarifa automática</th><th>Acciones</th></tr></thead>
          <tbody>${people.map(person => {
            const employee = employees.find(item => (item.employee_id || item.employeeId || item.id) === person.employeeId);
            const calculation = person.performanceRole === "CLASIFICACION"
              ? "Tallos clasificados × tarifa"
              : person.performanceRole === "EMBONCHE"
                ? "Bonches ingresados × tarifa"
                : "Sueldo u horas configuradas";
            const linked = Boolean(employee);
            const action = linked
              ? `<button class="secondary-button" data-payroll-edit-employee="${utils.esc(person.employeeId)}">Editar</button>`
              : person.employeeId
                ? `<button class="primary-button" data-payroll-create-poscosecha="${utils.esc(person.employeeId)}" data-name="${utils.esc(person.name)}" data-role="${utils.esc(person.roles.join(" / "))}">Crear ficha</button>`
                : `<button class="secondary-button" data-payroll-open-poscosecha>Vincular</button>`;
            const engineRole = person.performanceRole === "CLASIFICACION" ? "CLASSIFIER" : person.performanceRole === "EMBONCHE" ? "BUNCHER" : "";
            const target = engineRole === "CLASSIFIER"
              ? `${utils.number(performanceParameters.classifier_daily_mesh_target || 230)} mallas × ${utils.number(performanceParameters.classifier_stems_per_mesh || 25)} tallos = ${utils.number(performanceParameters.classifier_daily_stem_target || 5750)} tallos / día`
              : engineRole === "BUNCHER"
                ? `${utils.number(performanceParameters.buncher_daily_bunch_target || 200)} bonches (${utils.number((performanceParameters.buncher_daily_bunch_target || 200) * (performanceParameters.buncher_stems_per_bunch || 25))} tallos) / 8 h`
                : "-";
            const rate = engineRole ? BlessERP.payrollEngine.automaticPerformanceRate(engineRole, utils.today(), employee?.company_id || current.default_company_id) : 0;
            const stemEquivalent = engineRole === "BUNCHER"
              ? Number(rate) / Number(performanceParameters.buncher_stems_per_bunch || 25)
              : rate;
            const rateLabel = engineRole === "BUNCHER"
              ? `$ ${Number(rate).toFixed(performancePrecision)} / bonche · $ ${Number(stemEquivalent).toFixed(performancePrecision)} / tallo`
              : `$ ${Number(rate).toFixed(performancePrecision)} / ${person.performanceUnit.toLowerCase()}`;
            return `<tr><td><strong>${utils.esc(person.name)}</strong></td><td>${utils.esc(person.roles.join(" / "))}</td><td><span class="payroll-status" data-state="${linked ? "ACTIVO" : "PENDIENTE"}">${linked ? "CONECTADO" : "FALTA FICHA"}</span></td><td>${utils.esc(calculation)}</td><td>${utils.esc(target)}</td><td>${engineRole ? utils.esc(rateLabel) : "-"}</td><td><div class="table-actions-inline">${action}</div></td></tr>`;
          }).join("") || `<tr><td colspan="7" class="empty-row">Configure primero el personal en Parámetros de Poscosecha.</td></tr>`}</tbody></table>
        </article>

        <form class="panel-card payroll-performance-parameters" data-payroll-performance-parameters>
          <div class="payroll-performance-intro"><p class="section-kicker">CÁLCULO AUTOMÁTICO DEL RENDIMIENTO</p><h3>Metas y sueldo referencial</h3><p>El sueldo de USD 482 y 21 días se usan únicamente para obtener la tarifa de 7 u 8 decimales. El pago real sale del rendimiento registrado dentro del rango del rol, aunque la persona no tenga días fijos.</p></div>
          ${field("Sueldo ref. clasificador", `<input name="classifierReferenceSalary" type="number" min=".01" step=".01" value="${utils.esc(performanceParameters.classifier_reference_salary || 482)}" required>`)}
          ${field("Meta mallas clasificador / día", `<input name="classifierDailyMeshTarget" type="number" min=".0001" step=".0001" value="${utils.esc(performanceParameters.classifier_daily_mesh_target || 230)}" required>`)}
          ${field("Tallos por malla", `<input name="classifierStemsPerMesh" type="number" min=".0001" step=".0001" value="${utils.esc(performanceParameters.classifier_stems_per_mesh || 25)}" required>`)}
          ${field("Sueldo ref. embonchador", `<input name="buncherReferenceSalary" type="number" min=".01" step=".01" value="${utils.esc(performanceParameters.buncher_reference_salary || 482)}" required>`)}
          ${field("Meta bonches / día", `<input name="buncherDailyBunchTarget" type="number" min=".0001" step=".0001" value="${utils.esc(performanceParameters.buncher_daily_bunch_target || 200)}" required>`)}
          ${field("Tallos referenciales / bonche", `<input name="buncherStemsPerBunch" type="number" min=".0001" step=".0001" value="${utils.esc(performanceParameters.buncher_stems_per_bunch || 25)}" required>`)}
          ${field("Sueldo ref. vendedor", `<input name="sellerReferenceSalary" type="number" min=".01" step=".01" value="${utils.esc(performanceParameters.seller_reference_salary || 482)}" required>`)}
          ${field("Meta tallos vendidos / día", `<input name="sellerDailyStemTarget" type="number" min=".0001" step=".0001" value="${utils.esc(performanceParameters.seller_daily_stem_target || 320000)}" required>`)}
          ${field("Horas de jornada", `<input name="workdayHours" type="number" min=".01" step=".01" value="${utils.esc(performanceParameters.workday_hours || 8)}" required>`)}
          ${field("Días referenciales", `<input name="referenceWorkingDays" type="number" min="1" step="1" value="${utils.esc(performanceParameters.reference_working_days || 21)}" required>`)}
          ${field("Decimales de tarifa", `<select name="precision"><option value="8" ${performancePrecision === 8 ? "selected" : ""}>8 decimales</option><option value="7" ${performancePrecision === 7 ? "selected" : ""}>7 decimales</option></select>`)}
          ${field("Motivo del cambio", `<input name="changeReason" required placeholder="Ej. parámetros de rendimiento 2026">`)}
          <div class="payroll-form-actions"><button class="primary-button" type="submit">Guardar parámetros</button></div>
        </form>

        <article class="panel-card payroll-table-wrap">
          <div class="panel-card-head"><div><p class="section-kicker">OTRAS ÁREAS</p><h3>Administración y ventas</h3></div></div>
          <table class="compact-table payroll-table"><thead><tr><th>Empleado</th><th>Área</th><th>Cargo</th><th>Estado</th><th>Forma de cálculo</th><th>Sueldo</th><th>Tarifa hora</th><th>Rendimiento conectado</th><th>Acciones</th></tr></thead>
          <tbody>${otherEmployees.map(employee => {
            const employeeId = employee.employee_id || employee.employeeId || employee.id;
            const engineRole = BlessERP.payrollEngine?.performanceRole?.(employeeId) || "";
            const performanceRate = engineRole === "SELLER"
              ? BlessERP.payrollEngine.automaticPerformanceRate("SELLER", utils.today(), employee.company_id || current.default_company_id)
              : 0;
            const performanceLink = engineRole === "SELLER"
              ? `Tallos vendidos × $ ${Number(performanceRate).toFixed(performancePrecision)}`
              : employee.seller_id
                ? "Vendedor por comisión"
                : "-";
            return `<tr><td>${utils.esc(employee.full_name || employee.fullName || employee.name)}</td><td>${utils.esc(employee.area)}</td><td>${utils.esc(employee.position)}</td><td><span class="payroll-status" data-state="${utils.esc(employee.status)}">${utils.esc(employee.status)}</span></td><td>${utils.esc(employee.calculation_mode || employee.calculationMode)}</td><td>${utils.esc(utils.money(employee.monthly_salary || employee.monthlySalary))}</td><td>${utils.esc(utils.money(employee.hourly_rate || employee.hourlyRate))}</td><td>${utils.esc(performanceLink)}</td><td><div class="table-actions-inline"><button class="secondary-button" data-payroll-edit-employee="${utils.esc(employeeId)}">Editar</button><button class="danger-button" data-payroll-delete-employee="${utils.esc(employeeId)}">Eliminar</button></div></td></tr>`;
          }).join("") || `<tr><td colspan="9" class="empty-row">Sin personal adicional.</td></tr>`}</tbody></table>
        </article>

        <details class="panel-card payroll-advanced-settings">
          <summary>Opciones laborales avanzadas</summary>
          <div class="panel-card-head"><div><p class="section-kicker">OPCIONAL</p><h3>Obligaciones laborales activas</h3></div><div class="table-actions-inline"><select data-payroll-obligation-company>${companyOptions(current.ui.obligationCompanyId)}</select><input data-payroll-obligation-period type="month" value="${utils.esc(current.ui.obligationPeriodId)}"></div></div>
          <div class="payroll-obligation-list">${(obligations || []).map(item => `<label class="payroll-obligation"><span>${utils.esc(item.label || item.code)}</span><input type="checkbox" data-payroll-obligation="${utils.esc(item.code || item.id)}" ${item.active || item.enabled ? "checked" : ""}></label>`).join("")}</div>
        </details>
        ${employeeModal()}
      </section>
    `;
  }

  function renderHours(route) {
    const current = store();
    const rows = BlessERP.payrollService?.listHourEntries?.() || [...(current.timeEntries || []), ...(current.workTimeEntries || [])];
    const divisor = BlessERP.payrollService?.getParameters?.(current.default_company_id)?.hour_divisor || current.parameters?.hourDivisor || current.parameterSet?.hourDivisor || 240;
    return `
      <section class="payroll-page">
        ${header(route)}
        <div class="payroll-notice">Fórmula validada: horas × valor por hora × multiplicador. Divisor normal configurado: ${utils.esc(divisor)}.</div>
        <form class="panel-card payroll-form-grid" data-payroll-hours-form>
          ${field("Fecha", `<input name="date" type="date" value="${utils.today()}" required>`)}
          ${field("Empleado", `<select name="employeeId" required><option value="">Seleccione</option>${employeeOptions()}</select>`)}
          ${field("Actividad", `<input name="activity" value="Trabajo normal" required>`)}
          ${field("Horas normales", `<input name="normalHours" type="number" min="0" step=".25" value="0">`)}
          ${field("Horas adicionales", `<input name="additionalHours" type="number" min="0" step=".25" value="0">`)}
          ${field("Tipo de hora", `<select name="hourType"><option value="SUPLEMENTARIA_50">SUPLEMENTARIA 50%</option><option value="EXTRAORDINARIA_100">EXTRAORDINARIA 100%</option><option value="NORMAL">NORMAL</option></select>`)}
          ${field("Valor por hora", `<input name="hourlyRate" type="number" min="0" step=".000001" placeholder="Automático desde sueldo / divisor">`)}
          ${field("Multiplicador", `<input name="multiplier" type="number" min="0" step=".01" value="1.5">`)}
          ${field("Justificación tarifa", `<input name="rateOverrideReason" placeholder="Solo si cambia la tarifa">`)}
          ${field("Justificación multiplicador", `<input name="multiplierOverrideReason" placeholder="Solo si cambia el multiplicador">`)}
          ${field("Observación", `<input name="observation">`)}
          <div class="table-actions-inline"><button class="primary-button" type="submit">Registrar horas</button></div>
        </form>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Actividad</th><th>Normales</th><th>Adicionales</th><th>Valor hora</th><th>Multiplicador</th><th>Total correcto</th><th>Observación</th></tr></thead>
        <tbody>${rows.map(row => {
          const normal = Number(row.normal_hours ?? row.normalHours ?? 0);
          const extra = Number(row.additional_hours ?? row.additionalHours ?? 0);
          const rate = Number(row.hourly_rate ?? row.hourlyRate ?? row.ratePerHour ?? 0);
          const multiplier = Number(row.multiplier || 1);
          return `<tr><td>${utils.esc(row.date || row.workDate)}</td><td>${utils.esc(employeeName(row.employee_id || row.employeeId))}</td><td>${utils.esc(row.activity)}</td><td class="numeric">${utils.esc(normal)}</td><td class="numeric">${utils.esc(extra)}</td><td class="numeric">${utils.esc(utils.money(rate))}</td><td class="numeric">${utils.esc(multiplier)}</td><td class="numeric"><strong>${utils.esc(utils.money(normal * rate + extra * rate * multiplier))}</strong></td><td>${utils.esc(row.observation)}</td></tr>`;
        }).join("") || `<tr><td colspan="9" class="empty-row">Sin horas registradas.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function renderPerformance(route) {
    const current = store();
    const rows = BlessERP.payrollService?.listPerformanceEntries?.() || current.performanceEntries || [];
    const performancePrecision = Math.min(
      8,
      Math.max(7, Number(BlessERP.payrollService?.getParameters?.(activeCompanyId())?.performance_calculation?.precision || 8))
    );
    return `
      <section class="payroll-page">
        ${header(route)}
        <form class="panel-card payroll-form-grid" data-payroll-performance-form>
          ${field("Fecha", `<input name="date" type="date" value="${utils.today()}" required>`)}
          ${field("Empleado", `<select name="employeeId" required><option value="">Seleccione</option>${employeeOptions()}</select>`)}
          ${field("Área", `<select name="area"><option>POSCOSECHA</option><option>ADMINISTRATIVA</option><option>VENTAS</option></select>`)}
          ${field("Actividad", `<select name="activity"><option>CLASIFICACION</option><option>EMBONCHE</option><option>EMPAQUE</option><option>BODEGA</option><option>LIMPIEZA</option><option>OTRA</option></select>`)}
          ${field("Tipo de pago", `<select name="paymentType"><option>RENDIMIENTO</option><option>HORA</option></select>`)}
          ${field("Unidad", `<select name="unit"><option>TALLOS</option><option>BONCHES</option><option>MALLAS</option><option>CAJAS</option><option>HORAS</option><option>OTRA</option></select>`)}
          ${field("Cantidad realizada", `<input name="quantity" type="number" min="0" step=".01" required>`)}
          ${field("Tarifa aplicada", `<input name="tariff" type="number" min="0" step=".00000001" placeholder="Automática desde empleado">`)}
          ${field("Justificación tarifa", `<input name="tariffOverrideReason" placeholder="Solo si cambia la tarifa">`)}
          ${field("Origen", `<select name="origin"><option>MANUAL</option><option>OPERACIONES_CLASIFICACION</option><option>OPERACIONES_EMBONCHE</option><option>ESCANER</option></select>`)}
          ${field("Observación", `<input name="observation">`)}
          <div class="table-actions-inline"><button class="primary-button" type="submit">Registrar rendimiento</button></div>
        </form>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Área</th><th>Actividad</th><th>Tipo</th><th>Unidad</th><th>Cantidad</th><th>Tarifa</th><th>Total</th><th>Origen</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${utils.esc(row.date || row.workDate)}</td><td>${utils.esc(employeeName(row.employee_id || row.employeeId))}</td><td>${utils.esc(row.area)}</td><td>${utils.esc(row.activity)}</td><td>${utils.esc(row.pay_type || row.paymentType)}</td><td>${utils.esc(row.unit)}</td><td class="numeric">${utils.esc(utils.number(row.quantity))}</td><td class="numeric">$ ${utils.esc(Number(row.tariff || row.appliedRate || row.rate || 0).toFixed(performancePrecision))}</td><td class="numeric"><strong>${utils.esc(utils.money(row.total_generated || Number(row.quantity || 0) * Number(row.tariff || row.appliedRate || row.rate || 0)))}</strong></td><td>${utils.esc(row.source || row.origin)}</td></tr>`).join("") || `<tr><td colspan="10" class="empty-row">Sin rendimiento registrado.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function sellerOptions(selected = "", companyId = "") {
    return (store().salespeople || [])
      .filter(seller => !companyId || String(seller.companyId || seller.company_id || "") === String(companyId))
      .map(seller => `<option value="${utils.esc(seller.id)}" ${seller.id === selected ? "selected" : ""}>${utils.esc(seller.name || employeeName(seller.employeeId || seller.employee_id) || seller.id)}</option>`)
      .join("");
  }

  function renderCommissions(route) {
    const rules = BlessERP.payrollCommissions.rules();
    const from = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    const companyId = store().default_company_id || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER";
    return `
      <section class="payroll-page">
        ${header(route)}
        <form class="panel-card payroll-form-grid" data-payroll-commission-form>
          ${field("Empresa", `<select name="companyId" data-payroll-commission-company required>${companyOptions(companyId)}</select>`)}
          ${field("Vendedor", `<select name="sellerId" required><option value="">Seleccione</option>${sellerOptions("", companyId)}</select>`)}
          ${field("Modalidad", `<select name="mode">${BlessERP.payrollCommissions.commissionModes.map(mode => `<option>${utils.esc(mode)}</option>`).join("")}</select>`)}
          ${field("Base", `<select name="basis">${BlessERP.payrollCommissions.calculationBases.map(base => `<option>${utils.esc(base)}</option>`).join("")}</select>`)}
          ${field("Porcentaje", `<input name="percentage" type="number" min="0" step=".01" value="0">`)}
          ${field("Fijo venta", `<input name="fixedPerSale" type="number" min="0" step=".01" value="0">`)}
          ${field("Fijo factura", `<input name="fixedPerInvoice" type="number" min="0" step=".01" value="0">`)}
          ${field("Por caja", `<input name="ratePerBox" type="number" min="0" step=".0001" value="0">`)}
          ${field("Por tallo", `<input name="ratePerStem" type="number" min="0" step=".0001" value="0">`)}
          ${field("Bonificación manual", `<input name="manualBonus" type="number" min="0" step=".01" value="0">`)}
          ${field("Vigente desde", `<input name="validFrom" type="date" value="${utils.esc(from)}">`)}
          ${field("Vigente hasta", `<input name="validTo" type="date">`)}
          <div class="table-actions-inline"><button class="primary-button" type="submit">Guardar regla</button></div>
        </form>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th>Vendedor</th><th>Modalidad</th><th>Base</th><th>%</th><th>Fijo venta</th><th>Fijo factura</th><th>Caja</th><th>Tallo</th><th>Bonificación</th><th>Vigencia</th></tr></thead>
        <tbody>${rules.map(rule => `<tr><td>${utils.esc((store().salespeople || []).find(item => item.id === rule.sellerId)?.name || rule.sellerId)}</td><td>${utils.esc(rule.mode)}</td><td>${utils.esc(rule.basis)}</td><td>${utils.esc(rule.percentage)}</td><td>${utils.esc(utils.money(rule.fixedPerSale))}</td><td>${utils.esc(utils.money(rule.fixedPerInvoice))}</td><td>${utils.esc(utils.money(rule.ratePerBox))}</td><td>${utils.esc(utils.money(rule.ratePerStem))}</td><td>${utils.esc(utils.money(rule.manualBonus))}</td><td>${utils.esc(`${rule.validFrom || "abierta"} — ${rule.validTo || "abierta"}`)}</td></tr>`).join("") || `<tr><td colspan="10" class="empty-row">Sin reglas de comisión.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function runOptions(selected = "") {
    return BlessERP.payrollEngine.runs().map(run => `<option value="${utils.esc(run.id)}" ${run.id === selected ? "selected" : ""}>${utils.esc(`${run.number} · ${run.dateFrom} a ${run.dateTo} · ${run.status}`)}</option>`).join("");
  }

  function runActionButtons(run) {
    if (!run) return "";
    return `
      <button class="secondary-button" data-payroll-calculate="${utils.esc(run.id)}" ${["BORRADOR","CALCULADO"].includes(run.status) ? "" : "disabled"}>Volver a calcular</button>
      ${run.status === "APROBADO"
        ? `<button class="primary-button" data-payroll-account="${utils.esc(run.id)}">Finalizar confirmación</button>`
        : `<button class="primary-button" data-payroll-approve-account="${utils.esc(run.id)}" ${run.status === "CALCULADO" ? "" : "disabled"}>Confirmar rol</button>`}
      <button class="secondary-button" data-payroll-preview-run="${utils.esc(run.id)}" ${run.status === "BORRADOR" ? "disabled" : ""}>Vista previa</button>
    `;
  }

  function renderRunTable(run) {
    if (!run) return `<article class="panel-card"><p class="empty-row">Cree o seleccione un periodo de rol.</p></article>`;
    const items = BlessERP.payrollEngine.items(run.id);
    const componentsByItem = itemId => Object.fromEntries(BlessERP.payrollEngine.components(itemId).map(row => [row.code, row]));
    return `
      <article class="panel-card payroll-table-wrap">
        <div class="panel-card-head"><div><p class="section-kicker">${utils.esc(run.number)}</p><h3>${utils.esc(run.dateFrom)} a ${utils.esc(run.dateTo)}</h3><p>Revise únicamente los valores principales. El detalle completo se abre por trabajador.</p></div><div class="table-actions-inline">${runActionButtons(run)}</div></div>
        <table class="compact-table payroll-table"><thead><tr><th>Empleado</th><th>Cargo</th><th>Días</th><th>Sueldo</th><th>Horas</th><th>Rendimiento</th><th>Comisión</th><th>Descuentos</th><th>Neto</th><th>Estado</th><th></th></tr></thead>
        <tbody>${items.map(item => {
          const map = componentsByItem(item.id);
          const hours = Number(map.NORMAL_HOURS?.amount || 0) + Number(map.OVERTIME?.amount || 0);
          return `<tr><td class="employee-cell"><strong>${utils.esc(item.employeeName)}</strong><small>${utils.esc(item.identification)}</small></td><td>${utils.esc(item.position)}</td><td class="numeric">${utils.esc(item.daysWorked)}</td><td class="numeric">${utils.esc(utils.money(map.SALARY?.amount))}</td><td class="numeric">${utils.esc(utils.money(hours))}</td><td class="numeric">${utils.esc(utils.money(map.PERFORMANCE?.amount))}</td><td class="numeric">${utils.esc(utils.money(map.COMMISSION?.amount))}</td><td class="numeric">${utils.esc(utils.money(item.totalDiscounts))}</td><td class="numeric"><strong>${utils.esc(utils.money(item.netPay))}</strong></td><td><span class="payroll-status" data-state="${utils.esc(item.paymentStatus)}">${utils.esc(item.paymentStatus)}</span></td><td><button class="secondary-button" data-payroll-detail="${utils.esc(item.id)}">Ver detalle</button></td></tr>`;
        }).join("") || `<tr><td colspan="11" class="empty-row">Use “Crear y calcular rol” para obtener los valores.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="7"><strong>TOTAL DEL ROL</strong></td><td class="numeric"><strong>${utils.esc(utils.money(run.totals?.discounts))}</strong></td><td class="numeric"><strong>${utils.esc(utils.money(run.totals?.net))}</strong></td><td colspan="2"><span class="payroll-status" data-state="${utils.esc(run.status)}">${utils.esc(run.status)}</span></td></tr></tfoot></table>
      </article>
    `;
  }

  function detailModal(itemId) {
    const item = store().employeeItems.find(row => row.id === itemId);
    if (!item) return "";
    const components = BlessERP.payrollEngine.components(itemId);
    const run = store().runs.find(row => row.id === item.runId);
    const locked = BlessERP.payrollEngine.lockedStates.includes(run?.status);
    const componentRows = type => components.filter(row => row.type === type).map(row => {
      const performance = row.code === "PERFORMANCE" ? row.snapshot?.performanceSummary : null;
      const calculatedDetail = row.code === "SALARY" && row.snapshot?.referenceOnly
        ? `USD ${utils.money(row.snapshot.monthlySalary)} se usa solo como base para la tarifa de rendimiento`
        : performance?.role
        ? `${utils.number(performance.quantity)} ${String(performance.unit || "").toLowerCase()} × $ ${Number(performance.rate || 0).toFixed(Number(performance.precision || 8))} · meta del rango ${utils.number(performance.targetQuantity)}`
        : `Calculado: ${utils.money(row.calculatedAmount)}`;
      return `
        <label class="payroll-adjust-row ${row.manualOverride ? "is-adjusted" : ""}">
          <span><strong>${utils.esc(row.label)}</strong><small>${row.manualOverride ? `Ajustado: ${utils.esc(row.overrideReason)}` : utils.esc(calculatedDetail)}</small></span>
          <span class="payroll-money-input"><b>$</b><input type="number" min="0" step=".01" value="${utils.esc(row.amount)}" data-payroll-component-value="${utils.esc(row.id)}" ${locked ? "disabled" : ""}></span>
        </label>
      `;
    }).join("");
    return `
      <div class="payroll-detail-panel" data-payroll-modal>
        <article class="payroll-detail-card">
          <div class="payroll-detail-card-head"><div><p class="section-kicker">DETALLE DEL TRABAJADOR</p><h2>${utils.esc(item.employeeName)}</h2><p>${utils.esc(`${item.area} · ${item.position} · Neto ${utils.money(item.netPay)}`)}</p></div><button class="secondary-button" data-payroll-close-detail>Cerrar</button></div>
          <div class="payroll-notice ${locked ? "error" : ""}">${locked ? "Este rol ya fue confirmado y conserva su fotografía histórica. Para corregirlo debe anularse o generarse un ajuste posterior." : "Puede modificar los valores de este trabajador antes de confirmar el rol. Todo cambio requiere un motivo y queda registrado en auditoría."}</div>
          <form class="payroll-adjust-form" data-payroll-adjust-form="${utils.esc(item.id)}">
            <div class="payroll-adjust-summary">
              ${field("Días laborados", `<input name="daysWorked" type="number" min="0" max="30" step="1" value="${utils.esc(item.daysWorked)}" ${locked ? "disabled" : ""}>`)}
              <div><span>Total ingresos</span><strong>${utils.esc(utils.money(item.totalIncome))}</strong></div>
              <div><span>Total descuentos</span><strong>${utils.esc(utils.money(item.totalDiscounts))}</strong></div>
              <div class="payroll-adjust-net"><span>Neto actual</span><strong>${utils.esc(utils.money(item.netPay))}</strong></div>
            </div>
            <div class="payroll-component-grid">
              <section><h3>Ingresos editables</h3><div class="payroll-component-list">${componentRows("EARNING")}</div></section>
              <section><h3>Descuentos editables</h3><div class="payroll-component-list">${componentRows("DEDUCTION")}</div></section>
            </div>
            <label class="compact-field payroll-adjust-reason"><span>Motivo del ajuste</span><input name="reason" required placeholder="Ej. bonificación especial del mes o descuento acordado" ${locked ? "disabled" : ""}></label>
            <div class="payroll-form-actions">
              <button class="secondary-button" type="button" data-payroll-close-detail>Cerrar</button>
              <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>Guardar ajustes</button>
            </div>
          </form>
        </article>
      </div>
    `;
  }

  function renderGeneration(route) {
    const current = store();
    const run = current.runs.find(item => item.id === current.ui.currentRunId) || current.runs[0] || null;
    const companyId = current.ui.runCompanyId || "COMP-BLESS-FLOWER";
    const area = current.ui.runArea || "TODAS";
    const eligibleEmployees = employeeRows()
      .filter(item => String(item.company_id || item.companyId || "") === companyId)
      .filter(item => String(item.status || "ACTIVO").toUpperCase() === "ACTIVO")
      .filter(item => area === "TODAS" || item.area === area);
    return `
      <section class="payroll-page">
        ${header(route)}
        <div class="payroll-simple-steps">
          <span><b>1</b> Elija periodo</span><span><b>2</b> Seleccione personal</span><span><b>3</b> Calcule y confirme</span>
        </div>
        <form class="panel-card payroll-guided-form" data-payroll-run-form>
          <section>
            <h3>1. Periodo y grupo</h3>
            <div class="payroll-form-grid">
              ${field("Empresa", `<select name="companyId" data-payroll-run-company>${companyOptions(companyId)}</select>`)}
              ${field("Desde", `<input name="dateFrom" type="date" value="${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-01" required>`)}
              ${field("Hasta", `<input name="dateTo" type="date" value="${utils.today()}" required>`)}
              ${field("¿Qué personal?", `<select name="area" data-payroll-run-area><option value="TODAS" ${area === "TODAS" ? "selected" : ""}>Todos</option><option value="ADMINISTRATIVA" ${area === "ADMINISTRATIVA" ? "selected" : ""}>Administración</option><option value="POSCOSECHA" ${area === "POSCOSECHA" ? "selected" : ""}>Poscosecha</option><option value="VENTAS" ${area === "VENTAS" ? "selected" : ""}>Ventas</option></select>`)}
              ${field("Ver un rol existente", `<select data-payroll-run-select><option value="">Ninguno</option>${runOptions(run?.id)}</select>`)}
            </div>
          </section>
          <section>
            <div class="payroll-selection-head"><div><h3>2. Trabajadores incluidos</h3><p>Puede quitar la selección de quien no corresponda.</p></div><label><input type="checkbox" data-payroll-check-all checked> Seleccionar todos</label></div>
            <div class="payroll-employee-choice-list">
              ${eligibleEmployees.map(employee => {
                const employeeId = employee.employee_id || employee.employeeId || employee.id;
                const person = postharvestPeople().find(item => item.employeeId === employeeId);
                const mode = person?.performanceRole === "CLASIFICACION"
                  ? "Rendimiento por tallos"
                  : person?.performanceRole === "EMBONCHE"
                    ? "Rendimiento por bonches"
                    : employee.area === "VENTAS"
                      ? "Sueldo / comisión"
                      : "Sueldo / horas";
                return `<label class="payroll-employee-choice"><input type="checkbox" name="employeeIds" value="${utils.esc(employeeId)}" checked><span><strong>${utils.esc(employee.full_name || employee.fullName || employee.name)}</strong><small>${utils.esc(`${employee.position || employee.area} · ${mode}`)}</small></span></label>`;
              }).join("") || `<p class="empty-row">No hay trabajadores activos para esta selección.</p>`}
            </div>
          </section>
          <section class="payroll-guided-submit">
            <div><h3>3. Crear el rol</h3><p>El sistema tomará horas, tallos clasificados, bonches ingresados y ventas del periodo.</p></div>
            <button class="primary-button" type="submit" ${eligibleEmployees.length ? "" : "disabled"}>Crear y calcular rol</button>
          </section>
        </form>
        ${renderRunTable(run)}
        ${detailModal(current.ui.detailItemId)}
      </section>
    `;
  }

  function renderApproved(route) {
    const runs = BlessERP.payrollEngine.runs().filter(run => !["BORRADOR"].includes(run.status));
    return `
      <section class="payroll-page">
        ${header(route)}
        <div class="payroll-notice">Seleccione un trabajador para imprimir únicamente su comprobante, o use “Imprimir todos”. El formato de salida usa la identidad de la empresa activa.</div>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th>Rol y periodo</th><th>Estado</th><th>Trabajadores</th><th>Neto</th><th>Pagado</th><th>Saldo</th><th>Seleccione para imprimir</th><th>Acciones</th></tr></thead>
        <tbody>${runs.map(run => {
          const items = BlessERP.payrollEngine.items(run.id);
          return `<tr><td class="employee-cell"><strong>${utils.esc(run.number)}</strong><small>${utils.esc(`${run.dateFrom} — ${run.dateTo}`)}</small></td><td><span class="payroll-status" data-state="${utils.esc(run.status)}">${utils.esc(run.status)}</span></td><td class="numeric">${utils.esc(run.totals?.employees)}</td><td class="numeric"><strong>${utils.esc(utils.money(run.totals?.net))}</strong></td><td class="numeric">${utils.esc(utils.money(run.totals?.paid))}</td><td class="numeric">${utils.esc(utils.money(run.totals?.pending))}</td><td><select data-payroll-history-item="${utils.esc(run.id)}"><option value="">Seleccione</option>${items.map(item => `<option value="${utils.esc(item.id)}">${utils.esc(item.employeeName)}</option>`).join("")}</select></td><td><div class="table-actions-inline"><button class="secondary-button" data-payroll-history-preview="${utils.esc(run.id)}">Vista previa</button><button class="secondary-button" data-payroll-history-print-one="${utils.esc(run.id)}">Imprimir persona</button><button class="primary-button" data-payroll-history-print-all="${utils.esc(run.id)}">Imprimir todos</button><button class="secondary-button" data-payroll-open-payments>Registrar pago</button><button class="secondary-button" data-payroll-cancel="${utils.esc(run.id)}" ${run.status === "ANULADO" ? "disabled" : ""}>Anular</button></div></td></tr>`;
        }).join("") || `<tr><td colspan="8" class="empty-row">No existen roles calculados.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function payableItemOptions() {
    return store().employeeItems.filter(item => ["CONTABILIZADO","PARCIALMENTE_PAGADO"].includes(item.status) && item.pendingBalance > 0)
      .map(item => `<option value="${utils.esc(item.id)}">${utils.esc(`${item.employeeName} · saldo ${utils.money(item.pendingBalance)}`)}</option>`).join("");
  }

  function bankOptions() {
    return BlessERP.services.banks.bankAccounts().filter(item => String(item.status || "").toLowerCase() === "activa").map(item => `<option value="${utils.esc(item.id)}">${utils.esc(`${item.bankName} · ${item.accountNumber}`)}</option>`).join("");
  }

  function renderPayments(route) {
    const payments = BlessERP.payrollPayments.payments();
    return `
      <section class="payroll-page">
        ${header(route)}
        <form class="panel-card payroll-form-grid" data-payroll-payment-form>
          ${field("Trabajador / saldo", `<select name="employeeItemId" required><option value="">Seleccione</option>${payableItemOptions()}</select>`)}
          ${field("Fecha", `<input name="date" type="date" value="${utils.today()}" required>`)}
          ${field("Efectivo", `<input name="cashAmount" type="number" min="0" step=".01" value="0">`)}
          ${field("Transferencia", `<input name="transferAmount" type="number" min="0" step=".01" value="0">`)}
          ${field("Cheque", `<input name="checkAmount" type="number" min="0" step=".01" value="0">`)}
          ${field("Banco", `<select name="bankAccountId"><option value="">Seleccione</option>${bankOptions()}</select>`)}
          ${field("Referencia transferencia", `<input name="transferReference">`)}
          ${field("Número de cheque", `<input name="checkNumber">`)}
          ${field("Beneficiario", `<input name="beneficiary">`)}
          ${field("Observación", `<input name="observation">`)}
          <div class="table-actions-inline"><button class="primary-button" type="submit">Registrar pago</button></div>
        </form>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th>Número</th><th>Fecha</th><th>Empleado</th><th>Valor</th><th>Estado</th><th>Asiento</th><th>Observación</th><th>Acción</th></tr></thead>
        <tbody>${payments.map(payment => `<tr><td>${utils.esc(payment.number)}</td><td>${utils.esc(payment.date)}</td><td>${utils.esc(payment.employeeName)}</td><td class="numeric">${utils.esc(utils.money(payment.amount))}</td><td><span class="payroll-status" data-state="${utils.esc(payment.status)}">${utils.esc(payment.status)}</span></td><td>${utils.esc(payment.journalEntryNumber)}</td><td>${utils.esc(payment.observation)}</td><td><button class="secondary-button" data-payroll-cancel-payment="${utils.esc(payment.id)}" ${payment.status === "ANULADO" ? "disabled" : ""}>Anular</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty-row">No existen pagos.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function renderAudit(route) {
    const current = store();
    const logs = BlessERP.services.adminConfig.auditLogs({ module: "ROL_PAGOS" });
    return `
      <section class="payroll-page">
        ${header(route)}
        <article class="panel-card payroll-table-wrap"><div class="panel-card-head"><div><p class="section-kicker">AUDITORÍA TRANSVERSAL</p><h3>${utils.esc(logs.length)} eventos</h3></div></div><table class="compact-table payroll-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Documento</th><th>Estado anterior</th><th>Estado nuevo</th><th>Motivo</th><th>Descripción</th></tr></thead>
        <tbody>${logs.map(log => `<tr><td>${utils.esc(log.createdAt)}</td><td>${utils.esc(log.userName)}</td><td>${utils.esc(log.action)}</td><td>${utils.esc(log.documentLabel || log.entityLabel)}</td><td>${utils.esc(log.previousStatus)}</td><td>${utils.esc(log.nextStatus)}</td><td>${utils.esc(log.reason)}</td><td class="employee-cell">${utils.esc(log.description)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty-row">Sin eventos de rol.</td></tr>`}</tbody></table></article>
        <article class="panel-card payroll-table-wrap"><div class="panel-card-head"><div><p class="section-kicker">AJUSTES MANUALES</p><h3>Valores anteriores y nuevos</h3></div></div><table class="compact-table payroll-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Anterior</th><th>Nuevo</th><th>Motivo</th><th>Usuario</th></tr></thead>
        <tbody>${current.manualAdjustments.map(row => `<tr><td>${utils.esc(row.createdAt)}</td><td>${utils.esc(employeeName(row.employeeId))}</td><td>${utils.esc(utils.money(row.previousValue))}</td><td>${utils.esc(utils.money(row.newValue))}</td><td>${utils.esc(row.reason)}</td><td>${utils.esc(row.userName)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-row">Sin ajustes manuales.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function accountSelect(name, selected) {
    return `<select name="${utils.esc(name)}"><option value="">Seleccione</option>${BlessERP.services.chartOfAccounts.movementOptions().map(account => `<option value="${utils.esc(account.code)}" ${account.code === selected ? "selected" : ""}>${utils.esc(`${account.code} · ${account.name}`)}</option>`).join("")}</select>`;
  }

  function renderAccountingSettings(route) {
    const defaults = BlessERP.services.companySettings.settings().defaultAccounts || {};
    const fields = [
      ["payrollSalaries","Sueldos y salarios"],["payrollPiecework","Trabajo por destajo"],["payrollCommissions","Comisiones"],
      ["payrollBonuses","Bonificaciones"],["payrollTransport","Pasajes"],["payrollOvertime","Horas adicionales"],
      ["payrollOtherIncome","Otros ingresos"],["payrollPayable","Remuneraciones por pagar"],["employeeAdvances","Anticipos a empleados"],
      ["payrollFoodRecovery","Descuento de alimentación"],["payrollFinesRecovery","Multas"],["payrollOtherDiscounts","Otros descuentos"],
      ["cashGeneral","Caja"],["mainBank","Banco principal"]
    ];
    return `
      <section class="payroll-page">
        ${header(route)}
        <div class="payroll-notice">Los códigos no están quemados en el cálculo. Cada componente obtiene su cuenta desde esta configuración de empresa.</div>
        <form class="panel-card payroll-form-grid" data-payroll-account-settings>
          ${fields.map(([key,label]) => field(label, accountSelect(key, defaults[key]))).join("")}
          <div class="table-actions-inline"><button class="primary-button" type="submit">Guardar configuración</button></div>
        </form>
      </section>
    `;
  }

  function renderPrinting(route) {
    const current = store();
    const run = current.runs.find(item => item.id === current.ui.printRunId) || current.runs.find(item => item.status !== "BORRADOR") || current.runs[0] || null;
    const items = run ? BlessERP.payrollEngine.items(run.id) : [];
    return `
      <section class="payroll-page">
        ${header(route)}
        <article class="panel-card">
          <div class="payroll-toolbar">
            ${field("Rol", `<select data-payroll-print-run><option value="">Seleccione</option>${runOptions(run?.id)}</select>`)}
            <div class="table-actions-inline">
              <button class="secondary-button" data-payroll-preview ${run ? "" : "disabled"}>Vista previa</button>
              <button class="secondary-button" data-payroll-print-selected ${run ? "" : "disabled"}>Imprimir seleccionado</button>
              <button class="primary-button" data-payroll-print-all ${run ? "" : "disabled"}>Imprimir todos</button>
              <button class="secondary-button" data-payroll-download-selected ${run ? "" : "disabled"}>Descargar PDF individual</button>
              <button class="secondary-button" data-payroll-download-all ${run ? "" : "disabled"}>Descargar PDF combinado</button>
            </div>
          </div>
        </article>
        <article class="panel-card payroll-table-wrap"><table class="compact-table payroll-table"><thead><tr><th><input type="checkbox" data-payroll-print-check-all></th><th>Cédula</th><th>Empleado</th><th>Área</th><th>Neto</th><th>Pagado</th><th>Saldo</th><th>Estado</th></tr></thead>
        <tbody>${items.map(item => `<tr><td><input type="checkbox" data-payroll-print-item="${utils.esc(item.id)}"></td><td>${utils.esc(item.identification)}</td><td>${utils.esc(item.employeeName)}</td><td>${utils.esc(item.area)}</td><td>${utils.esc(utils.money(item.netPay))}</td><td>${utils.esc(utils.money(item.paidAmount))}</td><td>${utils.esc(utils.money(item.pendingBalance))}</td><td><span class="payroll-status" data-state="${utils.esc(item.paymentStatus)}">${utils.esc(item.paymentStatus)}</span></td></tr>`).join("") || `<tr><td colspan="8" class="empty-row">Sin comprobantes disponibles.</td></tr>`}</tbody></table></article>
      </section>
    `;
  }

  function render(container, route) {
    let html = "";
    if (route.id === "payroll-employees") html = renderEmployees(route);
    else if (route.id === "payroll-hours") html = renderHours(route);
    else if (route.id === "payroll-performance") html = renderPerformance(route);
    else if (route.id === "payroll-commissions") html = renderCommissions(route);
    else if (route.id === "payroll-generation") html = renderGeneration(route);
    else if (route.id === "payroll-approved") html = renderApproved(route);
    else if (route.id === "payroll-payments") html = renderPayments(route);
    else if (route.id === "payroll-audit") html = renderAudit(route);
    else if (route.id === "payroll-accounting-settings") html = renderAccountingSettings(route);
    else if (route.id === "payroll-printing") html = renderPrinting(route);
    container.innerHTML = html;
    bind(container, route);
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function selectedPrintIds(container) {
    return [...container.querySelectorAll("[data-payroll-print-item]:checked")].map(input => input.dataset.payrollPrintItem);
  }

  function bind(container, route) {
    container.querySelectorAll("[data-payroll-open-poscosecha]").forEach(button => button.addEventListener("click", () => {
      stateApi.setRoute("operations-parameters");
      BlessERP.layout.renderApp();
    }));
    container.querySelector("[data-payroll-new-employee]")?.addEventListener("click", () => {
      const current = store();
      current.ui.showEmployeeForm = true;
      current.ui.editingEmployeeId = "";
      current.ui.employeeDraft = {};
      refresh();
    });
    container.querySelectorAll("[data-payroll-edit-employee]").forEach(button => button.addEventListener("click", () => {
      const current = store();
      current.ui.showEmployeeForm = true;
      current.ui.editingEmployeeId = button.dataset.payrollEditEmployee;
      current.ui.employeeDraft = {};
      refresh();
    }));
    container.querySelectorAll("[data-payroll-create-poscosecha]").forEach(button => button.addEventListener("click", () => {
      const current = store();
      current.ui.showEmployeeForm = true;
      current.ui.editingEmployeeId = "";
      current.ui.employeeDraft = {
        employeeId: button.dataset.payrollCreatePoscosecha,
        name: button.dataset.name,
        prefillRole: button.dataset.role,
        area: "POSCOSECHA"
      };
      refresh();
    }));
    container.querySelectorAll("[data-payroll-close-employee]").forEach(button => button.addEventListener("click", () => {
      const current = store();
      current.ui.showEmployeeForm = false;
      current.ui.editingEmployeeId = "";
      current.ui.employeeDraft = {};
      refresh();
    }));
    container.querySelectorAll("[data-payroll-delete-employee]").forEach(button => button.addEventListener("click", async () => {
      const employee = BlessERP.payrollService?.findEmployee?.(button.dataset.payrollDeleteEmployee);
      if (!window.confirm(`¿Desactivar a ${employee?.full_name || "este trabajador"}? El historial de nómina se conservará.`)) return;
      const reason = window.prompt("Motivo obligatorio de la desactivación");
      if (!reason) return;
      const result=await BlessERP.services.payrollV2.upsertEmployee({ ...employee,status:"INACTIVO",changeReason:reason });
      if (toastResult(result, "Personal desactivado; el historial se conservó.")) refresh({ persist:false });
    }));
    container.querySelector("[data-payroll-performance-parameters]")?.addEventListener("submit", event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      const current = store();
      const parameters = BlessERP.payrollService.getParameters(current.ui.obligationCompanyId || current.default_company_id);
      const result = BlessERP.payrollService.saveParameters({
        ...parameters,
        performance_calculation: {
          ...(parameters.performance_calculation || {}),
          classifier_reference_salary: Number(payload.classifierReferenceSalary),
          classifier_daily_mesh_target: Number(payload.classifierDailyMeshTarget),
          classifier_stems_per_mesh: Number(payload.classifierStemsPerMesh),
          classifier_daily_stem_target: Number(payload.classifierDailyMeshTarget) * Number(payload.classifierStemsPerMesh),
          buncher_reference_salary: Number(payload.buncherReferenceSalary),
          buncher_daily_bunch_target: Number(payload.buncherDailyBunchTarget),
          buncher_stems_per_bunch: Number(payload.buncherStemsPerBunch),
          seller_reference_salary: Number(payload.sellerReferenceSalary),
          seller_daily_stem_target: Number(payload.sellerDailyStemTarget),
          seller_sales_basis: "GENERATED",
          workday_hours: Number(payload.workdayHours),
          reference_working_days: Number(payload.referenceWorkingDays),
          precision: Number(payload.precision),
          working_days: [1, 2, 3, 4, 5, 6]
        },
        change_reason: payload.changeReason
      });
      if (toastResult(result, "Parámetros de rendimiento guardados.")) refresh();
    });
    container.querySelector("[data-payroll-employee-form]")?.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      ["monthlySalary","hourlyRate","performanceRate","goal"].forEach(key => { payload[key] = Number(payload[key] || 0); });
      const result = await BlessERP.services.payrollV2.upsertEmployee(payload);
      if (toastResult(result, result?.created ? "Personal creado." : "Datos del personal actualizados.")) {
        const current = store();
        current.ui.showEmployeeForm = false;
        current.ui.editingEmployeeId = "";
        current.ui.employeeDraft = {};
        refresh({ persist:false });
      }
    });
    container.querySelectorAll("[data-payroll-obligation]").forEach(input => input.addEventListener("change", () => {
      const current = store();
      if (BlessERP.payrollService?.getObligationSettings && BlessERP.payrollService?.saveObligationSettings) {
        const settings = BlessERP.payrollService.getObligationSettings(current.ui.obligationCompanyId, current.ui.obligationPeriodId || "");
        const target = settings.obligations.find(item => item.code === input.dataset.payrollObligation);
        if (target) target.active = input.checked;
        const result = BlessERP.payrollService.saveObligationSettings({ ...settings, change_reason: "Actualización de obligaciones activas desde parámetros de rol" });
        toastResult(result, "Obligación actualizada para el periodo.");
      } else {
        const rows = current.obligations || current.laborObligations || [];
        const target = rows.find(item => (item.id || item.code) === input.dataset.payrollObligation);
        if (target) {
          target.enabled = input.checked;
          target.active = input.checked;
        } else rows.push({ id: input.dataset.payrollObligation, label: input.closest("label")?.innerText?.trim() || input.dataset.payrollObligation, enabled: input.checked });
        current.obligations = rows;
        stateApi.saveDb();
        BlessERP.layout.toast("Obligación actualizada para el periodo.");
      }
    }));
    container.querySelector("[data-payroll-obligation-company]")?.addEventListener("change", event => {
      store().ui.obligationCompanyId = event.currentTarget.value;
      refresh();
    });
    container.querySelector("[data-payroll-obligation-period]")?.addEventListener("change", event => {
      if (!event.currentTarget.value) return;
      store().ui.obligationPeriodId = event.currentTarget.value;
      refresh();
    });
    container.querySelector("[data-payroll-hours-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      ["normalHours","additionalHours","multiplier"].forEach(key => { payload[key] = Number(payload[key] || 0); });
      if (payload.hourlyRate === "") delete payload.hourlyRate;
      else payload.hourlyRate = Number(payload.hourlyRate);
      if (toastResult(saveHours(payload), "Horas registradas con fórmula multiplicativa.")) refresh();
    });
    container.querySelector("[data-payroll-hours-form] [name='hourType']")?.addEventListener("change", event => {
      const form = event.currentTarget.closest("form");
      const multiplierInput = form?.querySelector("[name='multiplier']");
      if (!multiplierInput) return;
      const current = store();
      const parameters = BlessERP.payrollService?.getParameters?.(current.default_company_id) || {};
      const configured = (parameters.hour_multipliers || []).find(item => item.code === event.currentTarget.value && item.active !== false);
      multiplierInput.value = String(configured?.multiplier ?? (event.currentTarget.value === "NORMAL" ? 1 : multiplierInput.value || 1));
    });
    container.querySelector("[data-payroll-performance-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      payload.quantity = Number(payload.quantity || 0);
      if (payload.tariff === "") delete payload.tariff;
      else payload.tariff = Number(payload.tariff);
      if (toastResult(savePerformance(payload), "Rendimiento registrado.")) refresh();
    });
    container.querySelector("[data-payroll-commission-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      payload.companyId = payload.companyId || store().default_company_id || BlessERP.payrollData?.DEFAULT_COMPANY_ID || "COMP-BLESS-FLOWER";
      ["percentage","fixedPerSale","fixedPerInvoice","ratePerBox","ratePerStem","manualBonus"].forEach(key => { payload[key] = Number(payload[key] || 0); });
      if (toastResult(BlessERP.payrollCommissions.saveRule(payload), "Regla de comisión guardada.")) refresh();
    });
    container.querySelector("[data-payroll-commission-company]")?.addEventListener("change", event => {
      const sellerSelect = event.currentTarget.form?.querySelector("[name='sellerId']");
      if (!sellerSelect) return;
      sellerSelect.innerHTML = `<option value="">Seleccione</option>${sellerOptions("", event.currentTarget.value)}`;
    });
    container.querySelector("[data-payroll-run-form]")?.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      const employees = [...event.currentTarget.querySelectorAll("[name='employeeIds']:checked")].map(input => input.value);
      if (!employees.length) {
        BlessERP.layout.toast("Seleccione al menos un trabajador.");
        return;
      }
      const result = await BlessERP.services.payrollV2.createRole({ ...payload, employeeIds: employees });
      if (!toastResult(result, "Rol confirmado y calculado. Revise los valores antes de aprobar.")) return;
      store().ui.currentRunId = result.role.id;
      refresh({ persist:false });
    });
    container.querySelector("[data-payroll-run-company]")?.addEventListener("change", event => {
      store().ui.runCompanyId = event.currentTarget.value;
      refresh();
    });
    container.querySelector("[data-payroll-run-area]")?.addEventListener("change", event => {
      store().ui.runArea = event.currentTarget.value;
      refresh();
    });
    container.querySelector("[data-payroll-check-all]")?.addEventListener("change", event => {
      container.querySelectorAll("[name='employeeIds']").forEach(input => { input.checked = event.currentTarget.checked; });
    });
    container.querySelector("[data-payroll-run-select]")?.addEventListener("change", event => {
      store().ui.currentRunId = event.target.value;
      refresh();
    });
    container.querySelectorAll("[data-payroll-calculate]").forEach(button => button.addEventListener("click", async () => {
      const hasManualAdjustments = store().manualAdjustments.some(item => item.runId === button.dataset.payrollCalculate);
      if (hasManualAdjustments && !window.confirm("Recalcular volverá a tomar los valores de origen y reemplazará los ajustes manuales de este rol. ¿Desea continuar?")) return;
      const result=await BlessERP.services.payrollV2.recalculateRole(button.dataset.payrollCalculate);
      if (toastResult(result, "Rol recalculado y confirmado.")) refresh({ persist:false });
    }));
    container.querySelectorAll("[data-payroll-approve]").forEach(button => button.addEventListener("click", async () => {
      const result=await BlessERP.services.payrollV2.approveRole(button.dataset.payrollApprove);
      if (toastResult(result, "Rol aprobado y bloqueado.")) refresh({ persist:false });
    }));
    container.querySelectorAll("[data-payroll-approve-account]").forEach(button => button.addEventListener("click", async () => {
      const approved = await BlessERP.services.payrollV2.approveRole(button.dataset.payrollApproveAccount);
      if (!toastResult(approved, "Rol confirmado.")) return;
      const built=BlessERP.payrollAccounting.buildAccrualEntry(button.dataset.payrollApproveAccount);
      if (!toastResult(built,"Asiento preparado.")) return;
      const accounted=await BlessERP.services.payrollV2.postRole(button.dataset.payrollApproveAccount,built.entry);
      if (toastResult(accounted, "Rol confirmado, contabilizado y pendiente de pago.")) refresh({ persist:false });
    }));
    container.querySelectorAll("[data-payroll-account]").forEach(button => button.addEventListener("click", async () => {
      const built=BlessERP.payrollAccounting.buildAccrualEntry(button.dataset.payrollAccount);
      if (!toastResult(built,"Asiento preparado.")) return;
      const result=await BlessERP.services.payrollV2.postRole(button.dataset.payrollAccount,built.entry);
      if (toastResult(result, "Rol contabilizado.")) refresh({ persist:false });
    }));
    container.querySelectorAll("[data-payroll-preview-run]").forEach(button => button.addEventListener("click", () => {
      BlessERP.payrollPrint.preview(button.dataset.payrollPreviewRun);
    }));
    container.querySelectorAll("[data-payroll-detail]").forEach(button => button.addEventListener("click", () => {
      store().ui.detailItemId = button.dataset.payrollDetail;
      refresh();
    }));
    container.querySelectorAll("[data-payroll-close-detail]").forEach(button => button.addEventListener("click", () => {
      store().ui.detailItemId = "";
      refresh();
    }));
    container.querySelector("[data-payroll-adjust-form]")?.addEventListener("submit", async event => {
      event.preventDefault();
      const components = [...event.currentTarget.querySelectorAll("[data-payroll-component-value]")].map(input => ({
        componentId: input.dataset.payrollComponentValue,
        value: Number(input.value)
      }));
      const result = await BlessERP.services.payrollV2.updateRoleItem(event.currentTarget.dataset.payrollAdjustForm, {
        daysWorked: event.currentTarget.elements.daysWorked?.value,
        reason: event.currentTarget.elements.reason?.value,
        components
      });
      if (toastResult(result, "Ajustes confirmados y total del rol actualizado.")) refresh({ persist:false });
    });
    container.querySelectorAll("[data-payroll-open-run]").forEach(button => button.addEventListener("click", () => {
      store().ui.currentRunId = button.dataset.payrollOpenRun;
      stateApi.setRoute("payroll-generation");
      BlessERP.layout.renderApp();
    }));
    container.querySelectorAll("[data-payroll-cancel]").forEach(button => button.addEventListener("click", async () => {
      const reason = window.prompt("Motivo obligatorio para anular el rol");
      if (!reason) return;
      const result=await BlessERP.services.payrollV2.reverseRole(button.dataset.payrollCancel,reason);
      if (toastResult(result, "Rol reversado con trazabilidad.")) refresh({ persist:false });
    }));
    container.querySelectorAll("[data-payroll-history-preview]").forEach(button => button.addEventListener("click", () => {
      const select = [...container.querySelectorAll("[data-payroll-history-item]")].find(item => item.dataset.payrollHistoryItem === button.dataset.payrollHistoryPreview);
      BlessERP.payrollPrint.preview(button.dataset.payrollHistoryPreview, select?.value ? [select.value] : []);
    }));
    container.querySelectorAll("[data-payroll-history-print-one]").forEach(button => button.addEventListener("click", () => {
      const select = [...container.querySelectorAll("[data-payroll-history-item]")].find(item => item.dataset.payrollHistoryItem === button.dataset.payrollHistoryPrintOne);
      if (!select?.value) return BlessERP.layout.toast("Seleccione un trabajador para imprimir.");
      BlessERP.payrollPrint.print(button.dataset.payrollHistoryPrintOne, [select.value]);
    }));
    container.querySelectorAll("[data-payroll-history-print-all]").forEach(button => button.addEventListener("click", () => {
      BlessERP.payrollPrint.print(button.dataset.payrollHistoryPrintAll);
    }));
    container.querySelectorAll("[data-payroll-open-payments]").forEach(button => button.addEventListener("click", () => {
      stateApi.setRoute("payroll-payments");
      BlessERP.layout.renderApp();
    }));
    container.querySelector("[data-payroll-payment-form]")?.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = formObject(event.currentTarget);
      const splits = [];
      if (Number(payload.cashAmount || 0) > 0) splits.push({ method:"CASH", amount:Number(payload.cashAmount), date:payload.date, observation:payload.observation });
      if (Number(payload.transferAmount || 0) > 0) splits.push({ method:"TRANSFER", amount:Number(payload.transferAmount), date:payload.date, bankAccountId:payload.bankAccountId, reference:payload.transferReference, observation:payload.observation });
      if (Number(payload.checkAmount || 0) > 0) splits.push({ method:"CHECK", amount:Number(payload.checkAmount), date:payload.date, bankAccountId:payload.bankAccountId, checkNumber:payload.checkNumber, beneficiary:payload.beneficiary, observation:payload.observation });
      const normalized=splits.map(BlessERP.payrollPayments.normalizeSplit);
      const current=store();
      const item=current.employeeItems.find(row=>String(row.id)===String(payload.employeeItemId));
      const run=item ? current.runs.find(row=>String(row.id)===String(item.runId)) : null;
      if (!item || !run) return BlessERP.layout.toast("Rol del trabajador no encontrado.");
      const paymentDraft={ date:payload.date,observation:payload.observation,number:"Se asigna al confirmar" };
      const built=BlessERP.payrollPayments.buildPaymentEntry(item,run,paymentDraft,normalized);
      if (!toastResult(built,"Pago preparado.")) return;
      const result=await BlessERP.services.payrollV2.payRole({ roleItemId:item.id,date:payload.date,observation:payload.observation,splits:normalized,journal:built.entry });
      if (toastResult(result, "Pago registrado y contabilizado.")) refresh({ persist:false });
    });
    container.querySelectorAll("[data-payroll-cancel-payment]").forEach(button => button.addEventListener("click", async () => {
      const reason = window.prompt("Motivo obligatorio para anular el pago");
      if (!reason) return;
      const result=await BlessERP.services.payrollV2.reversePayment(button.dataset.payrollCancelPayment,reason);
      if (toastResult(result, "Pago reversado con trazabilidad.")) refresh({ persist:false });
    }));
    container.querySelector("[data-payroll-account-settings]")?.addEventListener("submit", event => {
      event.preventDefault();
      const settings = BlessERP.services.companySettings.settings();
      settings.defaultAccounts = { ...(settings.defaultAccounts || {}), ...formObject(event.currentTarget) };
      BlessERP.services.companySettings.save(settings);
      BlessERP.layout.toast("Configuración contable del rol guardada.");
      refresh();
    });
    container.querySelector("[data-payroll-print-run]")?.addEventListener("change", event => {
      store().ui.printRunId = event.target.value;
      refresh();
    });
    container.querySelector("[data-payroll-print-check-all]")?.addEventListener("change", event => {
      container.querySelectorAll("[data-payroll-print-item]").forEach(input => { input.checked = event.target.checked; });
    });
    const printRun = () => store().ui.printRunId || store().runs.find(item => item.status !== "BORRADOR")?.id || store().runs[0]?.id;
    container.querySelector("[data-payroll-preview]")?.addEventListener("click", () => BlessERP.payrollPrint.preview(printRun(), selectedPrintIds(container)));
    container.querySelector("[data-payroll-print-selected]")?.addEventListener("click", () => {
      const selected = selectedPrintIds(container);
      if (!selected.length) return BlessERP.layout.toast("Seleccione al menos un trabajador.");
      BlessERP.payrollPrint.print(printRun(), selected);
    });
    container.querySelector("[data-payroll-print-all]")?.addEventListener("click", () => BlessERP.payrollPrint.print(printRun()));
    container.querySelector("[data-payroll-download-selected]")?.addEventListener("click", () => {
      const selected = selectedPrintIds(container);
      if (selected.length !== 1) return BlessERP.layout.toast("Seleccione exactamente un trabajador para el PDF individual.");
      BlessERP.payrollPrint.downloadPdf(printRun(), selected);
    });
    container.querySelector("[data-payroll-download-all]")?.addEventListener("click", () => BlessERP.payrollPrint.downloadPdf(printRun()));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.payroll = { render };
})();
