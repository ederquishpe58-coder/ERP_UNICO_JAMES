(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;
  let clockTimer = 0;
  let mountedRoot = null;
  let mountedAppState = null;

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDateTime(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "-";
    const date = new Date(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return normalized;
    return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "medium" }).format(date);
  }

  function renderWorkdayControl(store) {
    const workday = store.yieldWorkday || {};
    const status = workday.status || "SIN_INICIAR";
    const isOpen = ["ACTIVA", "PAUSADA"].includes(status);
    const statusLabel = {
      SIN_INICIAR: "Sin iniciar",
      ACTIVA: "Activa",
      PAUSADA: "Pausada",
      FINALIZADA: "Finalizada"
    }[status] || status;
    const statusMessage = status === "ACTIVA"
      ? `Jornada activa desde: ${formatDateTime(workday.startedAt)}`
      : status === "PAUSADA"
        ? `Jornada pausada. Inicio: ${formatDateTime(workday.startedAt)}`
        : status === "FINALIZADA"
          ? `Ultima jornada finalizada: ${formatDateTime(workday.endedAt)}`
          : "Inicie la jornada para habilitar los registros de rendimiento.";
    const primaryAction = status === "ACTIVA"
      ? { action: "yield-workday-pause", label: "Pausar jornada" }
      : status === "PAUSADA"
        ? { action: "yield-workday-resume", label: "Reanudar jornada" }
        : { action: "yield-workday-start", label: "Iniciar jornada" };
    const summary = workday.summary;
    const canManageWorkday = BlessERP.capabilityRuntime?.can?.("operations.yield_workday.manage") === true;
    return `
      <section class="ops-workday-control" data-yield-workday-control aria-label="Control de jornada laboral">
        <div class="ops-workday-title">
          <span class="ops-workday-status ${utils.esc(status.toLowerCase())}">${utils.esc(statusLabel)}</span>
          <div><strong>Control de jornada laboral</strong><small>${utils.esc(statusMessage)}</small></div>
        </div>
        <div class="ops-workday-time-block">
          <span data-yield-workday-date>${utils.esc(new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" }).format(new Date()))}</span>
          <strong data-yield-workday-clock>${utils.esc(new Intl.DateTimeFormat("es-EC", { timeStyle: "medium" }).format(new Date()))}</strong>
          <small>Tiempo laborado <b data-yield-workday-time>${utils.esc(formatDuration(BlessERP.operacionesWorkdayCore.elapsedMs(workday)))}</b></small>
        </div>
        <div class="ops-workday-actions">
          ${canManageWorkday ? `<button class="primary-button" type="button" data-ops-action="${utils.esc(primaryAction.action)}">${utils.esc(primaryAction.label)}</button>` : ""}
          ${canManageWorkday && isOpen ? `<button class="danger-button" type="button" data-ops-action="yield-workday-close">Finalizar</button>` : ""}
          <button class="secondary-button" type="button" data-ops-action="yield-view-screen" title="Abrir presentacion de rendimientos">Pantalla completa</button>
        </div>
        ${summary ? `<div class="ops-workday-summary" aria-label="Resumen de la jornada finalizada"><span><b>${utils.esc(utils.number(summary.totalBunches))}</b> ramos</span><span><b>${utils.esc(utils.number(summary.totalMeshes))}</b> mallas</span><span><b>${utils.esc(formatDuration(summary.activeDurationMs))}</b> efectivos</span></div>` : ""}
      </section>
    `;
  }

  function renderProgress(row) {
    const width = Math.min(100, Math.max(0, row.progress));
    const tone = row.progress >= 100 ? "complete" : row.progress >= 60 ? "steady" : "starting";
    return `
      <div class="ops-yield-progress ${tone}" aria-label="Avance ${utils.esc(row.progress.toFixed(1))}%">
        <div class="ops-yield-progress-track"><span style="width:${utils.esc(width)}%"></span></div>
        <strong>${utils.esc(row.progress.toFixed(1))}%</strong>
      </div>
    `;
  }

  function renderWorkerPanel(options) {
    const hourLabels = options.hourLabels;
    return `
      <article class="panel-card ops-worker-yield-panel ${utils.esc(options.mode)}" data-yield-panel="${utils.esc(options.mode)}">
        <div class="ops-worker-yield-head">
          <div>
            <p class="section-kicker">${utils.esc(options.eyebrow)}</p>
            <h3>${utils.esc(options.title)}</h3>
          </div>
          <div class="ops-worker-yield-goals" aria-label="Metas de rendimiento">
            <span>Meta por hora <strong>${utils.esc(utils.number(options.hourlyGoal))} ${utils.esc(options.unit)}</strong></span>
            <span>Meta diaria <strong>${utils.esc(utils.number(options.dailyGoal))} ${utils.esc(options.unit)}</strong></span>
            <span>Jornada <strong>8 horas</strong></span>
          </div>
        </div>
        <div class="compact-table-wrap ops-worker-yield-table-wrap">
          <table class="compact-table ops-worker-yield-table">
            <caption class="sr-only">${utils.esc(options.title)}</caption>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>${utils.esc(options.workerLabel)}</th>
                ${hourLabels.map((label, index) => `<th><span>H${index + 1}</span><small>${utils.esc(label.replace(":00", "").replace(":00", ""))}</small></th>`).join("")}
                <th>Total del d&iacute;a</th>
                <th>Avance</th>
              </tr>
            </thead>
            <tbody>
              ${options.rows.map(row => `
                <tr>
                  <td>${utils.esc(row.date === "SIN_FECHA" ? "-" : utils.dateLabel(row.date))}</td>
                  <td><strong>${utils.esc(row.worker)}</strong></td>
                  ${row.hourly.map(value => `<td class="ops-yield-hour-value">${utils.esc(utils.number(value))}</td>`).join("")}
                  <td class="ops-yield-day-total"><strong>${utils.esc(utils.number(row.total))}</strong><span>de ${utils.esc(utils.number(row.dailyGoal))}</span></td>
                  <td>${renderProgress(row)}</td>
                </tr>
              `).join("") || `<tr><td colspan="12" class="empty-row">Sin registros de rendimiento todav&iacute;a.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function render(appState) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const notice = BlessERP.operationsPerformanceV2?.notice?.() ?? "Rendimiento canónico no disponible.";
    const classifierRows = yieldUtils.buildClassifierHourlyPerformance(store);
    const buncherRows = yieldUtils.buildBuncherHourlyPerformance(store);
    const activeView = ui.yieldsView === "records" ? "records" : "rendimientos";
    const workday = yieldUtils.getVisibleWorkday(store);
    const hourLabels = yieldUtils.buildWorkHourLabels(yieldUtils.workdayStartHour(workday));

    return `
      ${notice ? `<p role="status">${utils.esc(notice)} <button type="button" data-performance-refresh>Reintentar</button></p>` : ""}
      <div class="ops-yield-command-row">
        <div class="ops-yield-options-bar">
          <details class="ops-yield-options-menu">
            <summary>Opciones</summary>
            <div>
              <button type="button" data-ops-action="yield-view-rendimientos">1. Rendimientos</button>
              <button type="button" data-ops-action="yield-view-screen">2. Pantalla de presentaci&oacute;n completa</button>
              <button type="button" data-ops-action="yield-view-records">3. Registros de rendimientos</button>
            </div>
          </details>
        </div>
        ${renderWorkdayControl(store)}
      </div>
      ${activeView === "records" ? BlessERP.operacionesRegistrosRendimientos.render(appState) : `
        <section class="ops-yield-panels" aria-label="Rendimientos de trabajadores">
          ${renderWorkerPanel({
          mode: "classifiers",
          eyebrow: "CLASIFICADORES",
          title: "Rendimiento de clasificadores",
          workerLabel: "Clasificador",
          unit: "mallas",
          hourlyGoal: 32.5,
          dailyGoal: 260,
          hourLabels,
          rows: classifierRows
          })}
          ${renderWorkerPanel({
          mode: "bunchers",
          eyebrow: "EMBONCHADORES",
          title: "Rendimiento de embonchadores",
          workerLabel: "Embonchador",
          unit: "ramos",
          hourlyGoal: 25,
          dailyGoal: 200,
          hourLabels,
          rows: buncherRows
          })}
        </section>
      `}
    `;
  }

  function updateLiveTime() {
    if (!mountedRoot || !mountedAppState) return;
    const store = stateApi.getStore(mountedAppState);
    const now = new Date();
    const clock = mountedRoot.querySelector("[data-yield-workday-clock]");
    const date = mountedRoot.querySelector("[data-yield-workday-date]");
    const elapsed = mountedRoot.querySelector("[data-yield-workday-time]");
    if (clock) clock.textContent = new Intl.DateTimeFormat("es-EC", { timeStyle: "medium" }).format(now);
    if (date) date.textContent = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" }).format(now);
    if (elapsed) elapsed.textContent = formatDuration(BlessERP.operacionesWorkdayCore.elapsedMs(store.yieldWorkday));
  }

  function mount(container, appState) {
    unmount();
    mountedRoot = container;
    container.querySelector("[data-performance-refresh]")?.addEventListener("click",()=>BlessERP.operationsPerformanceV2?.refresh(true));
    mountedAppState = appState;
    updateLiveTime();
    clockTimer = window.setInterval(updateLiveTime, 1000);
  }

  function unmount() {
    window.clearInterval(clockTimer);
    clockTimer = 0;
    mountedRoot = null;
    mountedAppState = null;
  }

  BlessERP.operacionesRendimientos = { formatDuration, mount, render, unmount, updateLiveTime };
})();
