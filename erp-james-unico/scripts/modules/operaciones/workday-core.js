(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    const BlessERP = root.BlessERP = root.BlessERP || {};
    BlessERP.operacionesWorkdayCore = api;
  }
})(typeof window !== "undefined" ? window : null, function(){
  const ACTIVE_STATUS = "ACTIVA";
  const PAUSED_STATUS = "PAUSADA";
  const FINISHED_STATUS = "FINALIZADA";

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseDateTime(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return 0;
    const parsed = Date.parse(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeStatus(status) {
    const value = String(status || "SIN_INICIAR").trim().toUpperCase();
    if (["EN_CURSO", "EN_CURSO_DEMO", "REANUDADA_DEMO"].includes(value)) return ACTIVE_STATUS;
    if (value === "PAUSADA_DEMO") return PAUSED_STATUS;
    if (["CERRADA", "CERRADA_DEMO"].includes(value)) return FINISHED_STATUS;
    return ["SIN_INICIAR", ACTIVE_STATUS, PAUSED_STATUS, FINISHED_STATUS].includes(value)
      ? value
      : "SIN_INICIAR";
  }

  function canRegister(workday) {
    return Boolean(workday?.id && normalizeStatus(workday.status) === ACTIVE_STATUS);
  }

  function pauseDurationMs(pause, nowMs = Date.now()) {
    const started = parseDateTime(pause?.pausedAt);
    if (!started) return 0;
    const ended = parseDateTime(pause?.resumedAt) || Math.max(started, parseNumber(nowMs, Date.now()));
    return Math.max(0, ended - started);
  }

  function totalPausedMs(workday, nowMs = Date.now()) {
    return (workday?.pauses || []).reduce((sum, pause) => sum + pauseDurationMs(pause, nowMs), 0);
  }

  function elapsedMs(workday, nowMs = Date.now()) {
    const started = parseDateTime(workday?.startedAt);
    if (!started) return 0;
    const ended = parseDateTime(workday?.endedAt) || Math.max(started, parseNumber(nowMs, Date.now()));
    return Math.max(0, ended - started - totalPausedMs(workday, ended));
  }

  function recordBelongsToWorkday(record, workdayId) {
    return Boolean(workdayId && String(record?.workdayId || "") === String(workdayId));
  }

  function summarizeByWorker(rows, workerField, quantityField, stemsField) {
    const grouped = new Map();
    (rows || []).forEach(row => {
      if (String(row?.state || row?.status || "").toUpperCase() === "ANULADO") return;
      const worker = String(row?.[workerField] || "SIN ASIGNAR").trim() || "SIN ASIGNAR";
      const current = grouped.get(worker) || { worker, quantity: 0, stems: 0 };
      current.quantity += quantityField ? parseNumber(row?.[quantityField]) : 1;
      current.stems += parseNumber(row?.[stemsField]);
      grouped.set(worker, current);
    });
    return [...grouped.values()].sort((left, right) => right.quantity - left.quantity || left.worker.localeCompare(right.worker));
  }

  function buildSummary(workday, meshRows, bunchRows, nowMs = Date.now()) {
    const id = workday?.id || "";
    const meshes = (meshRows || []).filter(row => recordBelongsToWorkday(row, id));
    const bunches = (bunchRows || []).filter(row => recordBelongsToWorkday(row, id));
    const classifierBreakdown = summarizeByWorker(meshes, "classifier", "meshCount", "totalStems");
    const buncherBreakdown = summarizeByWorker(bunches, "buncher", "", "stemsPerBunch");
    return {
      workdayId: id,
      date: workday?.date || "",
      startedAt: workday?.startedAt || "",
      endedAt: workday?.endedAt || "",
      activeDurationMs: elapsedMs(workday, nowMs),
      pausedDurationMs: totalPausedMs(workday, nowMs),
      totalMeshes: classifierBreakdown.reduce((sum, row) => sum + row.quantity, 0),
      totalClassifierStems: classifierBreakdown.reduce((sum, row) => sum + row.stems, 0),
      totalBunches: buncherBreakdown.reduce((sum, row) => sum + row.quantity, 0),
      totalBunchStems: buncherBreakdown.reduce((sum, row) => sum + row.stems, 0),
      classifierWorkers: classifierBreakdown.length,
      buncherWorkers: buncherBreakdown.length,
      classifierBreakdown,
      buncherBreakdown
    };
  }

  return {
    ACTIVE_STATUS,
    FINISHED_STATUS,
    PAUSED_STATUS,
    buildSummary,
    canRegister,
    elapsedMs,
    normalizeStatus,
    parseDateTime,
    recordBelongsToWorkday,
    totalPausedMs
  };
});
