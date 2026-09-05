(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.operacionesUtils;
  const sequence = [
    { mode: "bunchers", stage: "top3" },
    { mode: "bunchers", stage: "top5" },
    { mode: "bunchers", stage: "rest" },
    { mode: "classifiers", stage: "top3" },
    { mode: "classifiers", stage: "top5" },
    { mode: "classifiers", stage: "rest" }
  ];
  let phaseIndex = 0;
  let paused = false;
  let transitionSeconds = 10;
  let transitionTimer = 0;
  let clockTimer = 0;
  let refreshTimer = 0;
  let storageHandler = null;
  let fullscreenHandler = null;
  let mountedRoot = null;
  let mountedAppState = null;
  let rankings = { bunchers: null, classifiers: null };
  let lastUpdated = new Date();

  function currentPhase() {
    return sequence[phaseIndex] || sequence[0];
  }

  function refreshRankings() {
    if (!mountedAppState) return;
    const latestDb = mountedRoot ? BlessERP.storage?.load?.() : null;
    if (latestDb?.operations) mountedAppState.db = latestDb;
    const store = BlessERP.operacionesState.getStore(mountedAppState);
    rankings = {
      bunchers: BlessERP.operacionesRendimientosUtils.buildProductionScreenRanking(store, "bunchers"),
      classifiers: BlessERP.operacionesRendimientosUtils.buildProductionScreenRanking(store, "classifiers")
    };
    lastUpdated = new Date();
  }

  function phaseTitle(phase) {
    const group = phase.mode === "classifiers" ? "Clasificadores" : "Embonchadores";
    if (phase.stage === "top3") return `Top 3 de ${group}`;
    if (phase.stage === "top5") return `Top 5 de ${group}`;
    return `${group} desde la posici&oacute;n 6`;
  }

  function metricLabels(mode) {
    return mode === "classifiers"
      ? { primary: "Mallas", stems: "Tallos clasificados", bunches: "Ramos procesados", perHour: "Mallas / hora" }
      : { primary: "Ramos", stems: "Tallos procesados", bunches: "Ramos realizados", perHour: "Ramos / hora" };
  }

  function renderProgress(row) {
    const width = Math.min(100, Math.max(0, row.progress));
    return `
      <div class="yield-tv-progress">
        <div><span style="width:${utils.esc(width)}%"></span></div>
        <strong>${utils.esc(row.progress.toFixed(1))}%</strong>
      </div>
    `;
  }

  function renderPodiumCard(row, mode) {
    const labels = metricLabels(mode);
    return `
      <article class="yield-tv-podium-card place-${row.position}">
        <span class="yield-tv-position">${utils.esc(row.position)}</span>
        <h3>${utils.esc(row.worker)}</h3>
        <div class="yield-tv-primary-value"><strong>${utils.esc(utils.number(row.primary))}</strong><span>${utils.esc(labels.primary)}</span></div>
        <div class="yield-tv-metrics">
          <span>${utils.esc(labels.stems)} <strong>${utils.esc(utils.number(row.stems))}</strong></span>
          <span>${utils.esc(labels.bunches)} <strong>${utils.esc(utils.number(row.bunches))}</strong></span>
          <span>${utils.esc(labels.perHour)} <strong>${utils.esc(row.perHour.toFixed(1))}</strong></span>
          <span>Meta <strong>${utils.esc(utils.number(row.dailyGoal || (mode === "classifiers" ? 264 : 200)))}</strong></span>
        </div>
        ${renderProgress(row)}
      </article>
    `;
  }

  function renderListRow(row, mode) {
    const labels = metricLabels(mode);
    return `
      <article class="yield-tv-list-row">
        <span class="yield-tv-list-position">${utils.esc(row.position)}</span>
        <strong class="yield-tv-worker">${utils.esc(row.worker)}</strong>
        <span><small>${utils.esc(labels.primary)}</small><strong>${utils.esc(utils.number(row.primary))}</strong></span>
        <span><small>Tallos</small><strong>${utils.esc(utils.number(row.stems))}</strong></span>
        <span><small>${utils.esc(labels.perHour)}</small><strong>${utils.esc(row.perHour.toFixed(1))}</strong></span>
        <span><small>Meta</small><strong>${utils.esc(utils.number(row.dailyGoal || (mode === "classifiers" ? 264 : 200)))}</strong></span>
        ${renderProgress(row)}
      </article>
    `;
  }

  function renderPhase() {
    const phase = currentPhase();
    const ranking = rankings[phase.mode] || { date: "", rows: [] };
    const rows = phase.stage === "top3"
      ? ranking.rows.slice(0, 3)
      : phase.stage === "top5"
        ? ranking.rows.slice(0, 5)
        : ranking.rows.slice(5);
    const emptyText = phase.stage === "rest"
      ? "No existen m&aacute;s trabajadores despu&eacute;s del Top 5."
      : "Todav&iacute;a no existen registros productivos para esta fecha.";
    return `
      <div class="yield-tv-phase-head">
        <div><span>${phase.mode === "classifiers" ? "CLASIFICACI&Oacute;N" : "EMBONCHADO"}</span><h2>${phaseTitle(phase)}</h2></div>
        <strong>${utils.esc(ranking.date ? utils.dateLabel(ranking.date) : "-")}</strong>
      </div>
      ${phase.stage === "top3"
        ? `<div class="yield-tv-podium">${rows.map(row => renderPodiumCard(row, phase.mode)).join("") || `<p class="yield-tv-empty">${emptyText}</p>`}</div>`
        : `<div class="yield-tv-ranking-list ${phase.stage === "rest" ? "auto-scroll" : ""}" data-yield-tv-scroll>${rows.map(row => renderListRow(row, phase.mode)).join("") || `<p class="yield-tv-empty">${emptyText}</p>`}</div>`}
    `;
  }

  function render(appState) {
    mountedAppState = appState;
    refreshRankings();
    return `
      <section class="yield-tv-screen" data-yield-tv-screen>
        <header class="yield-tv-header">
          <div class="yield-tv-brand"><span>BF</span><div><strong>BLESS FLOWERS</strong><small>RENDIMIENTOS DE PRODUCCI&Oacute;N</small></div></div>
          <div class="yield-tv-clock-block"><span data-yield-tv-date>${utils.esc(new Intl.DateTimeFormat("es-EC", { dateStyle: "full" }).format(new Date()))}</span><strong data-yield-live-clock>--:--:--</strong><small>&Uacute;ltima actualizaci&oacute;n: <b data-yield-last-update>--:--:--</b></small></div>
        </header>
        <main class="yield-tv-stage" data-yield-tv-stage>${renderPhase()}</main>
        <footer class="yield-tv-controls">
          <button type="button" data-yield-screen-action="pause">Pausar</button>
          <button type="button" data-yield-screen-action="resume" hidden>Reanudar</button>
          <button type="button" data-yield-screen-action="bunchers">Embonchadores</button>
          <button type="button" data-yield-screen-action="classifiers">Clasificadores</button>
          <label>Transici&oacute;n <select data-yield-screen-interval><option value="10">10 s</option><option value="15">15 s</option><option value="20">20 s</option><option value="30">30 s</option></select></label>
          <button type="button" data-yield-screen-action="fullscreen">Pantalla completa</button>
          <button type="button" data-yield-screen-action="new-tab">Nueva pesta&ntilde;a</button>
          <button type="button" data-yield-screen-action="back">Volver a JAEDER SYSTEMS</button>
        </footer>
      </section>
    `;
  }

  function configureAutoScroll() {
    const list = mountedRoot?.querySelector("[data-yield-tv-scroll].auto-scroll");
    if (!list) return;
    const distance = Math.max(0, list.scrollHeight - list.clientHeight);
    list.style.setProperty("--yield-scroll-distance", `${distance}px`);
    list.style.setProperty("--yield-scroll-duration", `${Math.max(22, distance / 18)}s`);
    list.classList.toggle("is-scrolling", distance > 0);
  }

  function updateClock() {
    if (!mountedRoot) return;
    const now = new Date();
    const clock = mountedRoot.querySelector("[data-yield-live-clock]");
    const date = mountedRoot.querySelector("[data-yield-tv-date]");
    const updated = mountedRoot.querySelector("[data-yield-last-update]");
    if (clock) clock.textContent = now.toLocaleTimeString("es-EC", { hour12: false });
    if (date) date.textContent = new Intl.DateTimeFormat("es-EC", { dateStyle: "full" }).format(now);
    if (updated) updated.textContent = lastUpdated.toLocaleTimeString("es-EC", { hour12: false });
  }

  function updatePhase(animate = true) {
    const stage = mountedRoot?.querySelector("[data-yield-tv-stage]");
    if (!stage) return;
    if (animate) stage.classList.add("is-leaving");
    setTimeout(() => {
      if (!mountedRoot?.isConnected) return;
      stage.innerHTML = renderPhase();
      stage.classList.remove("is-leaving");
      stage.classList.add("is-entering");
      setTimeout(() => stage.classList.remove("is-entering"), 420);
      configureAutoScroll();
    }, animate ? 220 : 0);
  }

  function restartTransitionTimer() {
    clearInterval(transitionTimer);
    transitionTimer = setInterval(() => {
      if (paused) return;
      advancePhase(true);
    }, transitionSeconds * 1000);
  }

  function advancePhase(animate = true) {
    phaseIndex = (phaseIndex + 1) % sequence.length;
    if (mountedRoot) updatePhase(animate);
    return currentPhase();
  }

  function selectMode(mode) {
    phaseIndex = mode === "classifiers" ? 3 : 0;
    updatePhase(true);
    restartTransitionTimer();
  }

  function openPresentationTab() {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "operations-yield-screen");
    window.open(url.toString(), "_blank", "noopener");
  }

  function bindControls() {
    function syncFullscreenButton() {
      const button = mountedRoot?.querySelector('[data-yield-screen-action="fullscreen"]');
      if (!button) return;
      const active = Boolean(document.fullscreenElement) || mountedRoot.classList.contains("is-fullscreen-fallback");
      button.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
    }

    fullscreenHandler = syncFullscreenButton;
    document.addEventListener("fullscreenchange", fullscreenHandler);
    mountedRoot.addEventListener("click", async event => {
      const button = event.target.closest("[data-yield-screen-action]");
      if (!button) return;
      const action = button.dataset.yieldScreenAction;
      if (action === "pause") {
        paused = true;
        button.hidden = true;
        mountedRoot.querySelector('[data-yield-screen-action="resume"]').hidden = false;
      } else if (action === "resume") {
        paused = false;
        button.hidden = true;
        mountedRoot.querySelector('[data-yield-screen-action="pause"]').hidden = false;
      } else if (action === "bunchers" || action === "classifiers") {
        selectMode(action);
      } else if (action === "fullscreen") {
        try {
          if (document.fullscreenElement) await document.exitFullscreen?.();
          else if (mountedRoot.requestFullscreen) await mountedRoot.requestFullscreen();
          else mountedRoot.classList.toggle("is-fullscreen-fallback");
        } catch (error) {
          mountedRoot.classList.toggle("is-fullscreen-fallback");
        }
        syncFullscreenButton();
      } else if (action === "new-tab") {
        openPresentationTab();
      } else if (action === "back") {
        BlessERP.state.setRoute("operations-yields");
        BlessERP.layout.renderApp();
      }
    });
    mountedRoot.addEventListener("change", event => {
      const select = event.target.closest("[data-yield-screen-interval]");
      if (!select) return;
      transitionSeconds = Number(select.value) || 10;
      restartTransitionTimer();
    });
  }

  function mount(container, appState) {
    unmount();
    mountedRoot = container.querySelector("[data-yield-tv-screen]");
    mountedAppState = appState;
    if (!mountedRoot) return;
    bindControls();
    updateClock();
    configureAutoScroll();
    clockTimer = setInterval(updateClock, 1000);
    refreshTimer = setInterval(() => {
      refreshRankings();
      updatePhase(false);
      updateClock();
    }, 15000);
    storageHandler = () => {
      refreshRankings();
      updatePhase(false);
      updateClock();
    };
    window.addEventListener("storage", storageHandler);
    restartTransitionTimer();
  }

  function unmount() {
    clearInterval(transitionTimer);
    clearInterval(clockTimer);
    clearInterval(refreshTimer);
    if (storageHandler) window.removeEventListener("storage", storageHandler);
    if (fullscreenHandler) document.removeEventListener("fullscreenchange", fullscreenHandler);
    transitionTimer = 0;
    clockTimer = 0;
    refreshTimer = 0;
    storageHandler = null;
    fullscreenHandler = null;
    mountedRoot = null;
  }

  function getState() {
    return { phaseIndex, phase: currentPhase(), paused, transitionSeconds, rankings };
  }

  function getPhaseSnapshot() {
    const phase = currentPhase();
    const ranking = rankings[phase.mode] || { rows: [] };
    const rows = phase.stage === "top3" ? ranking.rows.slice(0, 3) : phase.stage === "top5" ? ranking.rows.slice(0, 5) : ranking.rows.slice(5);
    return { phase: { ...phase }, rows };
  }

  BlessERP.operacionesPantallaRendimientos = { advancePhase, getPhaseSnapshot, getState, mount, refreshRankings, render, selectMode, unmount };
})();
