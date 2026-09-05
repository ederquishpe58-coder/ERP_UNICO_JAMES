(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function baseUtils() {
    return BlessERP.operacionesUtils;
  }

  function parseNumber(value, fallback = 0) {
    return baseUtils().parseNumber(value, fallback);
  }

  function esc(value) {
    return baseUtils().esc(value);
  }

  function number(value) {
    return baseUtils().number(value);
  }

  function getYieldsView(ui) {
    return String(ui?.yieldsView || "rendimientos").trim() || "rendimientos";
  }

  function getVisibleWorkday(store) {
    const current = store?.yieldWorkday || {};
    if (current.id) return current;
    return (store?.yieldWorkdayHistory || [])[0] || current;
  }

  function workdayStartHour(workday) {
    const parsed = String(workday?.startedAt || "").match(/(?:T|\s)(\d{1,2}):/);
    return parsed ? Number(parsed[1]) : 7;
  }

  function workdayActiveHours(workday) {
    const elapsed = BlessERP.operacionesWorkdayCore?.elapsedMs?.(workday) || 0;
    return Math.max(1, elapsed / 3600000);
  }

  function scopeRowsToWorkday(rows, store, options = {}) {
    if (options.scope === "all") return (rows || []).filter(item => Boolean(item.workdayId));
    const workdayId = options.workdayId || getVisibleWorkday(store)?.id || "";
    if (!workdayId) return [];
    return (rows || []).filter(item => String(item.workdayId || "") === String(workdayId));
  }

  function buildWorkHourLabels(startHour = 7, workdayHours = 8) {
    return Array.from({ length: workdayHours }, (_, index) => {
      const from = startHour + index;
      return `${String(from).padStart(2, "0")}:00-${String(from + 1).padStart(2, "0")}:00`;
    });
  }

  function parseOperationalDateTime(value, fallbackDate = "") {
    const normalized = String(value || "").trim().replace("T", " ");
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):\d{2})?/);
    return {
      date: match?.[1] || String(fallbackDate || "").slice(0, 10) || "SIN_FECHA",
      hour: match?.[2] === undefined ? 7 : Number(match[2])
    };
  }

  function buildHourlyWorkerRows(items, options) {
    const grouped = new Map();
    const workdayHours = Math.max(1, Math.round(parseNumber(options.workdayHours, 8)));
    const startHour = Number.isFinite(options.startHour) ? options.startHour : 7;
    (items || []).forEach(item => {
      const worker = String(options.worker(item) || "SIN ASIGNAR").trim() || "SIN ASIGNAR";
      const employeeId = String(options.employeeId?.(item) || item.employee_id || item.employeeId || "").trim();
      const dateTime = parseOperationalDateTime(options.dateTime(item), options.date(item));
      const key = `${dateTime.date}::${employeeId || worker}`;
      const current = grouped.get(key) || {
        date: dateTime.date,
        employeeId,
        employee_id: employeeId,
        worker,
        hourly: Array(workdayHours).fill(0),
        total: 0,
        hourlyGoal: options.hourlyGoal,
        dailyGoal: options.dailyGoal
      };
      const quantity = parseNumber(options.quantity(item));
      const hourIndex = dateTime.hour - startHour;
      if (hourIndex >= 0 && hourIndex < workdayHours) current.hourly[hourIndex] += quantity;
      current.total += quantity;
      grouped.set(key, current);
    });

    return [...grouped.values()].map(item => ({
      ...item,
      progress: item.dailyGoal ? Number(((item.total / item.dailyGoal) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total || a.worker.localeCompare(b.worker));
  }

  function buildClassifierHourlyPerformance(store, options = {}) {
    const workday = getVisibleWorkday(store);
    const settings = store.yieldSettings || {};
    return buildHourlyWorkerRows(scopeRowsToWorkday(store.meshProcessingRecords || [], store, options), {
      worker: item => item.classifier,
      employeeId: item => item.classifier_employee_id || item.classifierEmployeeId || item.employee_id || item.employeeId,
      dateTime: item => item.registeredAt,
      date: item => item.date,
      quantity: item => item.meshCount,
      startHour: workdayStartHour(workday),
      workdayHours: parseNumber(settings.workdayHours, 8),
      hourlyGoal: parseNumber(settings.classifierHourlyGoal, 33),
      dailyGoal: parseNumber(settings.classifierDailyGoal, 264)
    });
  }

  function buildBuncherHourlyPerformance(store, options = {}) {
    const settings = store.yieldSettings || {};
    const inventoryRows = store.roseInventory || [];
    const scannedEntries = scopeRowsToWorkday(store.bunchEntries || [], store, options).filter(entry => {
      const inventory = inventoryRows.find(item => item.inventoryId === entry.inventoryId || item.sourceBunchEntryId === entry.id);
      return inventory?.sourceType === "ESCANEO_ETIQUETA" && inventory.state !== "ANULADO" && entry.state !== "ANULADO";
    });
    const workday = getVisibleWorkday(store);
    return buildHourlyWorkerRows(scannedEntries, {
      worker: item => item.buncher,
      employeeId: item => item.buncher_employee_id || item.buncherEmployeeId || item.employee_id || item.employeeId,
      dateTime: item => item.registeredAt,
      date: item => item.date,
      quantity: () => 1,
      startHour: workdayStartHour(workday),
      workdayHours: parseNumber(settings.workdayHours, 8),
      hourlyGoal: parseNumber(settings.buncherHourlyGoal, 25),
      dailyGoal: parseNumber(settings.buncherDailyGoal, 200)
    });
  }

  function buildProductionScreenRanking(store, mode) {
    const isClassifier = mode === "classifiers";
    const settings = store.yieldSettings || {};
    const inventoryRows = store.roseInventory || [];
    const allSourceRows = isClassifier
      ? (store.meshProcessingRecords || [])
      : (store.bunchEntries || []).filter(entry => {
          const inventory = inventoryRows.find(item => item.inventoryId === entry.inventoryId || item.sourceBunchEntryId === entry.id);
          return inventory?.sourceType === "ESCANEO_ETIQUETA" && inventory.state !== "ANULADO" && entry.state !== "ANULADO";
        });
    const workday = getVisibleWorkday(store);
    const sourceRows = scopeRowsToWorkday(allSourceRows, store, { workdayId: workday?.id || "" });
    const rowDate = item => String(item.registeredAt || item.date || "").slice(0, 10);
    const latestDate = workday?.date || sourceRows.map(rowDate).filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10);
    const catalogType = isClassifier ? "classifiers" : "bunchers";
    const catalogWorkers = (store.masterData?.[catalogType] || [])
      .filter(item => item.active !== false)
      .map(item => ({
        worker: item.name,
        employeeId: item.employee_id || item.employeeId || ""
      }));
    const fallbackWorkers = isClassifier ? (store.catalogs?.classifiers || []) : (store.catalogs?.bunchers || []);
    const workers = catalogWorkers.length ? catalogWorkers : fallbackWorkers.map(worker => ({ worker, employeeId: "" }));
    const grouped = new Map(workers.map(item => [item.employeeId || item.worker, {
      worker: item.worker,
      employeeId: item.employeeId,
      employee_id: item.employeeId,
      primary: 0,
      stems: 0,
      bunches: 0
    }]));

    sourceRows.filter(item => rowDate(item) === latestDate).forEach(item => {
      const worker = String(isClassifier ? item.classifier : item.buncher || "SIN ASIGNAR").trim() || "SIN ASIGNAR";
      const employeeId = String(isClassifier
        ? item.classifier_employee_id || item.classifierEmployeeId || item.employee_id || item.employeeId
        : item.buncher_employee_id || item.buncherEmployeeId || item.employee_id || item.employeeId || "").trim();
      const key = employeeId || worker;
      const current = grouped.get(key) || { worker, employeeId, employee_id: employeeId, primary: 0, stems: 0, bunches: 0 };
      if (isClassifier) {
        current.primary += parseNumber(item.meshCount);
        current.stems += parseNumber(item.totalStems);
        current.bunches += Math.round(parseNumber(item.totalStems) / 25);
      } else {
        current.primary += 1;
        current.bunches += 1;
        current.stems += parseNumber(item.stemsPerBunch);
      }
      grouped.set(key, current);
    });

    const dailyGoal = isClassifier
      ? parseNumber(settings.classifierDailyGoal, 264)
      : parseNumber(settings.buncherDailyGoal, 200);
    const hourlyGoal = isClassifier
      ? parseNumber(settings.classifierHourlyGoal, 33)
      : parseNumber(settings.buncherHourlyGoal, 25);
    const activeHours = workdayActiveHours(workday);
    return {
      date: latestDate,
      mode,
      dailyGoal,
      hourlyGoal,
      rows: [...grouped.values()]
        .map(item => ({
          ...item,
          perHour: Number((item.primary / activeHours).toFixed(1)),
          progress: dailyGoal ? Number(((item.primary / dailyGoal) * 100).toFixed(1)) : 0
        }))
        .sort((left, right) => right.perHour - left.perHour || right.primary - left.primary || left.worker.localeCompare(right.worker))
        .map((item, index) => ({ ...item, position: index + 1 }))
    };
  }

  function buildYieldSummary(store) {
    const meshRows = scopeRowsToWorkday(store.meshProcessingRecords || [], store);
    const bunchRows = scopeRowsToWorkday(store.bunchEntries || [], store);
    const settings = store.yieldSettings || {};
    const classifierWorkers = new Set(meshRows.map(item => item.classifier).filter(Boolean));
    const buncherWorkers = new Set(bunchRows.map(item => item.buncher).filter(Boolean));
    const totalMeshes = meshRows.reduce((sum, item) => sum + parseNumber(item.meshCount), 0);
    const totalMeshStems = meshRows.reduce((sum, item) => sum + parseNumber(item.totalStems), 0);
    const totalBunches = bunchRows.length;
    const totalBunchStems = bunchRows.reduce((sum, item) => sum + parseNumber(item.stemsPerBunch), 0);
    const duplicateEvents = (store.scannerEvents || []).filter(item => String(item.result || item.resultado || "").toUpperCase() === "DUPLICADO").length;
    const classifierDailyGoal = parseNumber(settings.classifierDailyGoal, 264);
    const buncherDailyGoal = parseNumber(settings.buncherDailyGoal, parseNumber(settings.buncherHourlyGoal, 25) * parseNumber(settings.workdayHours, 8));

    return {
      totalMeshes,
      totalMeshStems,
      totalBunches,
      totalBunchStems,
      classifierWorkers: classifierWorkers.size,
      buncherWorkers: buncherWorkers.size,
      duplicateEvents,
      classifierDailyGoal,
      buncherDailyGoal,
      classifierProgress: classifierDailyGoal ? Math.min(100, Number(((totalMeshes / classifierDailyGoal) * 100).toFixed(1))) : 0,
      buncherProgress: buncherDailyGoal ? Math.min(100, Number(((totalBunches / buncherDailyGoal) * 100).toFixed(1))) : 0
    };
  }

  function buildClassifierRanking(store) {
    const grouped = new Map();
    const settings = store.yieldSettings || {};
    const workdayHours = parseNumber(settings.workdayHours, 8) || 8;
    const dailyGoal = parseNumber(settings.classifierDailyGoal, 264) || 264;
    scopeRowsToWorkday(store.meshProcessingRecords || [], store).forEach(item => {
      const key = `${item.date}::${item.classifier}`;
      const current = grouped.get(key) || {
        date: item.date,
        worker: item.classifier,
        supplier: item.supplier,
        variety: item.variety,
        meshes: 0,
        stems: 0
      };
      current.meshes += parseNumber(item.meshCount);
      current.stems += parseNumber(item.totalStems);
      grouped.set(key, current);
    });

    return [...grouped.values()].map(item => ({
      ...item,
      perHour: Number((item.meshes / workdayHours).toFixed(1)),
      bunchEstimate: Math.round(item.stems / 25),
      progress: Math.min(100, Number(((item.meshes / dailyGoal) * 100).toFixed(1))),
      goal: dailyGoal
    })).sort((a, b) => b.meshes - a.meshes);
  }

  function buildBuncherRanking(store) {
    const grouped = new Map();
    const settings = store.yieldSettings || {};
    const workdayHours = parseNumber(settings.workdayHours, 8) || 8;
    const dailyGoal = parseNumber(settings.buncherDailyGoal, parseNumber(settings.buncherHourlyGoal, 25) * workdayHours) || 200;
    scopeRowsToWorkday(store.bunchEntries || [], store).forEach(item => {
      const key = `${item.date}::${item.buncher}`;
      const current = grouped.get(key) || {
        date: item.date,
        worker: item.buncher,
        variety: item.variety,
        bunches: 0,
        stems: 0
      };
      current.bunches += 1;
      current.stems += parseNumber(item.stemsPerBunch);
      grouped.set(key, current);
    });

    return [...grouped.values()].map(item => ({
      ...item,
      perHour: Number((item.bunches / workdayHours).toFixed(1)),
      progress: Math.min(100, Number(((item.bunches / dailyGoal) * 100).toFixed(1))),
      goal: dailyGoal
    })).sort((a, b) => b.bunches - a.bunches);
  }

  function buildWorkdayStatus(store) {
    const workday = store.yieldWorkday || {};
    const settings = store.yieldSettings || {};
    return {
      date: workday.date || "-",
      status: workday.status || "SIN_INICIAR",
      startedAt: workday.startedAt || "-",
      pausedAt: workday.pausedAt || "-",
      resumedAt: workday.resumedAt || "-",
      endedAt: workday.endedAt || "-",
      elapsedMs: BlessERP.operacionesWorkdayCore?.elapsedMs?.(workday) || 0,
      pausedDurationMs: BlessERP.operacionesWorkdayCore?.totalPausedMs?.(workday) || 0,
      observation: workday.observation || "Sin observacion.",
      workdayHours: parseNumber(settings.workdayHours, 8),
      classifierHourlyGoal: parseNumber(settings.classifierHourlyGoal, 33),
      classifierDailyGoal: parseNumber(settings.classifierDailyGoal, 264),
      buncherHourlyGoal: parseNumber(settings.buncherHourlyGoal, 25),
      buncherDailyGoal: parseNumber(settings.buncherDailyGoal, 200)
    };
  }

  function buildInventoryRelationRows(store) {
    const inventoryRows = store.roseInventory || [];
    return (store.bunchEntries || []).map(item => {
      const inventory = inventoryRows.find(row => (
        row.inventoryId === item.inventoryId ||
        row.sourceBunchEntryId === item.id ||
        row.sourceLabelId === item.labelId
      ));
      return {
        code: item.code,
        variety: item.variety,
        length: item.length,
        buncher: item.buncher,
        inventoryId: inventory?.inventoryId || item.inventoryId || "PENDIENTE",
        warehouse: inventory?.warehouse || "PENDIENTE",
        location: inventory?.location || "PENDIENTE",
        state: inventory?.state || "PENDIENTE_INVENTARIO_DEMO",
        observation: inventory?.observation || "Pendiente de reflejo en inventario demo."
      };
    });
  }

  function buildTransitionRows(store) {
    const receptions = store.receptions || [];
    const meshRows = store.meshProcessingRecords || [];
    const bunchRows = store.bunchEntries || [];
    const inventoryRows = store.roseInventory || [];
    return [
      {
        step: "Recepcion",
        status: receptions.length ? "ACTIVO_DEMO" : "PENDIENTE",
        countLabel: `${number(receptions.length)} lotes`,
        detail: "Ingreso inicial de flor por proveedor y bloque."
      },
      {
        step: "Mallas procesadas",
        status: meshRows.length ? "ACTIVO_DEMO" : "PENDIENTE",
        countLabel: `${number(meshRows.reduce((sum, item) => sum + parseNumber(item.meshCount), 0))} mallas`,
        detail: "Entrega de mallas y tallos extras al clasificador."
      },
      {
        step: "Ramos ingresados",
        status: bunchRows.length ? "ACTIVO_DEMO" : "PENDIENTE",
        countLabel: `${number(bunchRows.length)} ramos`,
        detail: "Ramos creados exclusivamente por el primer escaneo valido de su etiqueta."
      },
      {
        step: "Inventario de rosas",
        status: inventoryRows.length ? "ACTIVO_DEMO" : "PENDIENTE",
        countLabel: `${number(inventoryRows.reduce((sum, item) => sum + parseNumber(item.bunches), 0))} ramos`,
        detail: "Una fila por ramo escaneado; independiente del inventario de materiales."
      }
    ];
  }

  function renderRankingTable(title, eyebrow, rows, mode) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">${esc(eyebrow)}</p>
            <h3>${esc(title)}</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>${mode === "classifier" ? "Clasificador" : "Embonchador"}</th>
                <th>Variedad</th>
                <th>${mode === "classifier" ? "Mallas hoy" : "Ramos hoy"}</th>
                <th>Tallos</th>
                <th>Meta dia</th>
                <th>${mode === "classifier" ? "Mallas/hora" : "Bonches/hora"}</th>
                <th>Avance</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(baseUtils().dateLabel(item.date))}</td>
                  <td>${esc(item.worker)}</td>
                  <td>${esc(item.variety || "-")}</td>
                  <td>${esc(number(mode === "classifier" ? item.meshes : item.bunches))}</td>
                  <td>${esc(number(item.stems))}</td>
                  <td>${esc(number(item.goal))}</td>
                  <td>${esc(item.perHour.toFixed(1))}</td>
                  <td>${esc(`${item.progress.toFixed(1)}%`)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8" class="empty-row">Sin registros demo todavia.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  BlessERP.operacionesRendimientosUtils = {
    buildBuncherHourlyPerformance,
    buildBuncherRanking,
    buildClassifierHourlyPerformance,
    buildClassifierRanking,
    buildProductionScreenRanking,
    buildInventoryRelationRows,
    buildTransitionRows,
    buildWorkdayStatus,
    buildYieldSummary,
    buildWorkHourLabels,
    getVisibleWorkday,
    esc,
    getYieldsView,
    number,
    parseNumber,
    scopeRowsToWorkday,
    workdayActiveHours,
    workdayStartHour,
    renderRankingTable
  };
})();
