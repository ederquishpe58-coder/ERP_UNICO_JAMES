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
      if (!employeeId) return;
      const key = `${dateTime.date}::${employeeId}`;
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

  function canonicalItems(role,store,options={}) {
    const workdayId=options.scope==='all'?'':String(options.workdayId||getVisibleWorkday(store)?.id||'');
    if(options.scope!=='all'&&!workdayId)return [];
    return (BlessERP.operationsPerformanceV2?.rows(role,workdayId)||[]).map(r=>({
      id:r.source_record_id,workdayId:r.workday_id,date:r.event_date,
      registeredAt:r.event_date+' '+new Intl.DateTimeFormat('en-GB',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(r.event_at)),
      employeeId:r.operational_worker_id,employee_id:r.operational_worker_id,
      classifier:r.worker_name,buncher:r.worker_name,meshCount:Number(r.quantity),bunches:Number(r.quantity),
      totalStems:Number(r.stems),stemsPerBunch:Number(r.stems),payrollLinked:r.payroll_linked
    }));
  }
  function canonicalHourly(role,store,options={}) {
    const classifier=role==='CLASSIFIER',daily=classifier?260:200;
    return buildHourlyWorkerRows(canonicalItems(role,store,options),{
      worker:item=>item.classifier,employeeId:item=>item.employeeId,dateTime:item=>item.registeredAt,date:item=>item.date,
      quantity:item=>item.bunches,startHour:workdayStartHour(getVisibleWorkday(store)),workdayHours:8,
      hourlyGoal:daily/8,dailyGoal:daily
    });
  }
  function buildClassifierHourlyPerformance(store,options={}) {return canonicalHourly('CLASSIFIER',store,options);}
  function buildBuncherHourlyPerformance(store,options={}) {return canonicalHourly('BUNCHER',store,options);}
  function buildProductionScreenRanking(store,mode) {
    const classifier=mode==='classifiers',dailyGoal=classifier?260:200,workday=getVisibleWorkday(store);
    const source=canonicalItems(classifier?'CLASSIFIER':'BUNCHER',store),date=source.map(r=>r.date).sort().at(-1)||'';
    const grouped=new Map();
    for(const row of source.filter(r=>r.date===date)){
      const key=row.employeeId;if(!key)continue;
      const entry=grouped.get(key)||{worker:row.classifier,employeeId:key,employee_id:key,primary:0,stems:0,bunches:0};
      entry.primary+=row.bunches;entry.bunches+=row.bunches;entry.stems+=row.totalStems;grouped.set(key,entry);
    }
    const hours=workdayActiveHours(workday);
    return {date,mode,dailyGoal,hourlyGoal:dailyGoal/8,rows:[...grouped.values()].map(r=>({...r,
      perHour:Number((r.primary/hours).toFixed(1)),progress:Number((r.primary/dailyGoal*100).toFixed(1))}))
      .sort((a,b)=>b.primary-a.primary||a.employeeId.localeCompare(b.employeeId)).map((r,index)=>({...r,position:index+1}))};
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
