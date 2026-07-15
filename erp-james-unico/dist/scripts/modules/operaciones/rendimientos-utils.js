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

  function buildYieldSummary(store) {
    const meshRows = store.meshProcessingRecords || [];
    const bunchRows = store.bunchEntries || [];
    const settings = store.yieldSettings || {};
    const classifierWorkers = new Set(meshRows.map(item => item.classifier).filter(Boolean));
    const buncherWorkers = new Set(bunchRows.map(item => item.buncher).filter(Boolean));
    const totalMeshes = meshRows.reduce((sum, item) => sum + parseNumber(item.meshCount), 0);
    const totalMeshStems = meshRows.reduce((sum, item) => sum + parseNumber(item.totalStems), 0);
    const totalBunches = bunchRows.length;
    const totalBunchStems = bunchRows.reduce((sum, item) => sum + parseNumber(item.stemsPerBunch), 0);
    const duplicateEvents = (store.scannerEvents || []).filter(item => String(item.result || item.resultado || "").toUpperCase() === "DUPLICADO").length;
    const classifierDailyGoal = parseNumber(settings.classifierDailyGoal, 233);
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
    const dailyGoal = parseNumber(settings.classifierDailyGoal, 233) || 233;
    (store.meshProcessingRecords || []).forEach(item => {
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
    (store.bunchEntries || []).forEach(item => {
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
      observation: workday.observation || "Sin observacion.",
      workdayHours: parseNumber(settings.workdayHours, 8),
      classifierHourlyGoal: parseNumber(settings.classifierHourlyGoal, 29.1),
      classifierDailyGoal: parseNumber(settings.classifierDailyGoal, 233),
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
    buildBuncherRanking,
    buildClassifierRanking,
    buildInventoryRelationRows,
    buildTransitionRows,
    buildWorkdayStatus,
    buildYieldSummary,
    esc,
    getYieldsView,
    number,
    parseNumber,
    renderRankingTable
  };
})();
