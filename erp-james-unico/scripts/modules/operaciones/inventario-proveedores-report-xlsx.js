(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const REPORT_LOGO_PATH = "scripts/assets/bless-flower-logo-official-transparent.png?v=20260730";

  function excelText(value) {
    return { xlsxType: "text", value: String(value ?? "") };
  }

  function excelDateTime(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return value || "";
    const milliseconds = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    return { xlsxType: "dateTime", value: (milliseconds / 86400000) + 25569 };
  }

  function compactBlockCode(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized || normalized === "SIN BLOQUE") return "";
    const match = normalized.match(/^(?:B|BQ|BLOQUE)\s*[-_#:]?\s*0*(\d+)$/i);
    return match ? `B${Number(match[1])}` : normalized.replace(/[^A-Z0-9]/g, "");
  }

  function supplierBlockSheetName(rows = [], fallback = "SIN BLOQUE") {
    const blocks = [...new Set(rows.flatMap(item => {
      const rawValue = item?.block || item?.blocks || "";
      const source = typeof rawValue === "string"
        ? rawValue.split("+")
        : rawValue && typeof rawValue[Symbol.iterator] === "function"
          ? Array.from(rawValue)
          : [rawValue];
      return source.map(compactBlockCode).filter(Boolean);
    }))];
    return blocks.join("+") || compactBlockCode(fallback) || "SIN BLOQUE";
  }

  function buildSupplierReport(appState) {
    const reportApi = BlessERP.operacionesRamosReportXlsx;
    const source = reportApi.getReportData(appState);
    const supplierGroups = new Map();

    source.records.forEach(record => {
      const partsBySupplier = new Map();
      (record.composition || []).forEach(part => {
        const supplier = String(part.supplier || record.printedSupplier || "SIN PROVEEDOR").trim() || "SIN PROVEEDOR";
        const current = partsBySupplier.get(supplier) || { blocks: new Set(), stems: 0 };
        current.blocks.add(String(part.block || "SIN BLOQUE").trim() || "SIN BLOQUE");
        current.stems += Number(part.stems || 0);
        partsBySupplier.set(supplier, current);
      });

      partsBySupplier.forEach((part, supplier) => {
        if (!supplierGroups.has(supplier)) supplierGroups.set(supplier, []);
        supplierGroups.get(supplier).push({
          admittedAt: record.admittedAt,
          code: record.code,
          blocks: [...part.blocks].sort((left, right) => left.localeCompare(right)).join(" + "),
          variety: record.variety,
          buncher: record.buncher,
          length: record.length,
          stems: part.stems
        });
      });
    });

    const groups = [...supplierGroups.entries()]
      .map(([supplier, rows]) => ({
        supplier,
        rows: rows.sort((left, right) => `${left.admittedAt}|${left.code}`.localeCompare(`${right.admittedAt}|${right.code}`))
      }))
      .sort((left, right) => left.supplier.localeCompare(right.supplier));
    const dates = source.records.map(item => String(item.admittedAt || "").slice(0, 10)).filter(Boolean).sort();
    const from = dates[0] || "";
    const to = dates[dates.length - 1] || "";
    const period = reportApi.reportPeriod(from, to);
    const summary = groups.map(group => ({
      supplier: group.supplier,
      blocks: [...new Set(group.rows.flatMap(item => item.blocks.split(" + ")).filter(Boolean))].sort((left, right) => left.localeCompare(right)).join(" + "),
      varieties: [...new Set(group.rows.map(item => item.variety).filter(Boolean))].sort((left, right) => left.localeCompare(right)).join(" + "),
      labels: group.rows.length,
      stems: group.rows.reduce((sum, item) => sum + Number(item.stems || 0), 0),
      lastAdmission: group.rows.reduce((latest, item) => String(item.admittedAt || "") > latest ? String(item.admittedAt || "") : latest, "")
    }));
    const sourceStems = source.records.reduce((sum, item) => sum + Number(item.stems || 0), 0);
    const supplierStems = summary.reduce((sum, item) => sum + item.stems, 0);

    return {
      from,
      to,
      ...period,
      source,
      groups,
      summary,
      validation: {
        ok: source.records.length > 0 && sourceStems === supplierStems,
        sourceStems,
        supplierStems,
        suppliers: groups.length
      }
    };
  }

  function buildSupplierSheets(report) {
    const sheets = [{
      name: "Resumen proveedores",
      title: "REPORTE BLESS FLOWER - RESUMEN POR PROVEEDOR",
      widths: [30, 30, 38, 18, 20, 24],
      headers: ["Proveedor", "Bloques", "Variedades", "Etiquetas relacionadas", "Total tallos", "Ultimo ingreso"],
      rows: report.summary.map(item => [item.supplier, item.blocks, item.varieties, item.labels, item.stems, excelDateTime(item.lastAdmission)]),
      totals: ["TOTAL", "", "", report.summary.reduce((sum, item) => sum + item.labels, 0), report.summary.reduce((sum, item) => sum + item.stems, 0), ""]
    }];

    report.groups.forEach(group => {
      const blockSheetName = supplierBlockSheetName(group.rows);
      sheets.push({
        name: blockSheetName,
        title: `REPORTE BLESS FLOWER - BLOQUE ${blockSheetName} - ${group.supplier}`,
        widths: [22, 28, 26, 24, 16, 20, 24],
        headers: ["Codigo de etiqueta", "Bloques", "Variedad", "Embonchador", "Medida (cm)", "Numero de tallos", "Fecha de ingreso de ramos"],
        rows: group.rows.map(item => [excelText(item.code), item.blocks, item.variety, item.buncher, item.length, item.stems, excelDateTime(item.admittedAt)]),
        totals: ["TOTAL", "", "", "", "", group.rows.reduce((sum, item) => sum + Number(item.stems || 0), 0), ""]
      });
    });
    return sheets;
  }

  async function loadReferenceLogoBytes() {
    if (typeof document === "undefined" || typeof fetch !== "function") return undefined;
    const response = await fetch(new URL(REPORT_LOGO_PATH, document.baseURI));
    if (!response.ok) throw new Error("No se pudo cargar el logo del reporte.");
    return new Uint8Array(await response.arrayBuffer());
  }

  async function exportSupplierInventoryXlsx(appState, options = {}) {
    const report = buildSupplierReport(appState);
    if (!report.source.records.length) return { ok: false, message: "No existen ramos escaneados para generar el reporte.", report };
    if (!report.validation.ok) return { ok: false, message: "Los tallos del resumen no coinciden con el inventario escaneado.", report };

    const sheets = buildSupplierSheets(report);
    const logoBytes = options.logoBytes || await loadReferenceLogoBytes().catch(() => undefined);
    const archive = BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive(sheets, report, logoBytes);
    const fileName = `reporte-inventario-proveedores-${report.from || "inicio"}-${report.to || "fin"}.xlsx`;

    if (options.download !== false) {
      const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    }

    return { ok: true, report, sheets, archive, fileName };
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function hasRegisteredNationalStatus(assignment) {
    const status = String(assignment?.status || "").trim().toUpperCase();
    return status === "COMPLETADO" || status === "ENTREGADO + REGISTRADO NACIONAL";
  }

  function reportClassificationType(assignment, exportedStems, nationalStems) {
    if (!hasRegisteredNationalStatus(assignment)) return "PENDIENTE";
    if (nationalStems > 0 && exportedStems > 0) return "MIXTA";
    if (nationalStems > 0) return "NACIONAL";
    return "EXPORTACION";
  }

  function resolveAssignmentLength(store, assignment) {
    const directLength = Number(assignment.length || 0);
    if (directLength > 0) return directLength;
    const relatedRows = (store.classifications || []).filter(item => (
      item.receptionId === assignment.receptionId &&
      item.variety === assignment.variety
    ));
    const related = relatedRows.find(item => !assignment.classifier || item.classifier === assignment.classifier) || relatedRows[0];
    const relatedLength = Number(related?.length || 0);
    if (relatedLength > 0) return relatedLength;
    return normalizeText(assignment.stemType) || "SIN MEDIDA";
  }

  function formatReportLength(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? `${numeric} cm` : (normalizeText(value) || "SIN MEDIDA");
  }

  function formatReportDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : (value || "-");
  }

  function buildSupplierClassificationSourceRows(appState) {
    const store = BlessERP.operacionesState.getStore(appState);
    const classificationRows = (store.classifierAssignments || [])
      .filter(item => String(item.status || "").toUpperCase() !== "ANULADO")
      .map(item => {
        const classifiedStems = Number(item.totalStems || 0);
        const nationalStems = Number(item.nationalStems || 0);
        const isCompleted = hasRegisteredNationalStatus(item);
        const classifiedExportableStems = isCompleted ? Math.max(0, Number(item.exportableStems ?? (classifiedStems - nationalStems))) : 0;
        return {
          id: item.id,
          sourceType: "CLASIFICACION",
          dateTime: normalizeText(item.dateTime),
          date: normalizeText(item.dateTime).slice(0, 10),
          supplier: normalizeText(item.supplier) || "SIN PROVEEDOR",
          block: normalizeText(item.block) || "SIN BLOQUE",
          variety: normalizeText(item.variety) || "SIN VARIEDAD",
          length: resolveAssignmentLength(store, item),
          classification: reportClassificationType(item, classifiedExportableStems, nationalStems),
          classificationPending: !isCompleted,
          classifiedStems,
          inventoryStems: 0,
          exportedStems: 0,
          nationalStems,
          mismatch: nationalStems - classifiedStems,
          utilization: 0,
          responsible: normalizeText(item.classifier) || "SIN RESPONSABLE"
        };
      });

    const labelsById = new Map((store.labelBatches || []).map(item => [item.id, item]));
    const labelsByCode = new Map((store.labelBatches || []).map(item => [item.code, item]));
    const scannedBunchRows = (store.roseInventory || [])
      .filter(item => item.sourceType === "ESCANEO_ETIQUETA")
      .flatMap(item => {
        const label = labelsById.get(item.sourceLabelId) || labelsByCode.get(item.labelCode) || {};
        const admittedAt = normalizeText(item.admittedAt || item.date);
        const bunchStems = Number(item.stemsPerBunch || item.stems || label.stemsPerBunch || 0);
        const composition = Array.isArray(item.composition) && item.composition.length
          ? item.composition
          : [{
              block: item.block || label.block || "SIN BLOQUE",
              supplier: item.supplier || label.supplier || "SIN PROVEEDOR",
              stems: bunchStems
            }];
        return composition.map((part, index) => {
          const inventoryStems = Number(part.stems || 0);
          return {
            id: `${item.inventoryId || item.labelCode || "RAMO"}-${index + 1}`,
            sourceType: "INVENTARIO_BONCHES",
            inventoryState: normalizeText(item.state),
            labelCode: normalizeText(item.labelCode || label.code),
            dateTime: admittedAt,
            date: admittedAt.slice(0, 10),
            supplier: normalizeText(part.supplier || item.supplier || label.supplier) || "SIN PROVEEDOR",
            block: normalizeText(part.block || item.block || label.block) || "SIN BLOQUE",
            variety: normalizeText(item.variety || label.variety) || "SIN VARIEDAD",
            length: Number(item.length || label.length || 0),
            classification: "EXPORTACION",
            classificationPending: false,
            classifiedStems: 0,
            inventoryStems,
            exportedStems: inventoryStems,
            nationalStems: 0,
            mismatch: inventoryStems,
            utilization: 0,
            responsible: normalizeText(item.buncher || label.buncher) || "SIN RESPONSABLE"
          };
        });
      });

    return [...classificationRows, ...scannedBunchRows];
  }

  function filterSupplierClassificationRows(rows, filters = {}) {
    return rows.filter(item => {
      if (filters.from && item.date < filters.from) return false;
      if (filters.to && item.date > filters.to) return false;
      if (filters.supplier && item.supplier !== filters.supplier) return false;
      if (filters.variety && item.variety !== filters.variety) return false;
      if (filters.length) {
        const lengthField = `length${Number(filters.length)}`;
        const hasAggregatedLength = Object.hasOwn(item, lengthField);
        if (hasAggregatedLength ? Number(item[lengthField] || 0) <= 0 : String(item.length) !== String(filters.length)) return false;
      }
      if (filters.classificationType && item.classification !== filters.classificationType) return false;
      return true;
    });
  }

  const SUPPLIER_REPORT_LENGTHS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130];
  const emptySupplierTotals = () => ({
    records: 0, suppliers: 0, varieties: 0, classifiedStems: 0, exportedStems: 0,
    nationalStems: 0, mismatch: 0,
    ...Object.fromEntries(SUPPLIER_REPORT_LENGTHS.map(length => [`length${length}`, 0]))
  });

  function ecuadorToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  }

  function defaultSupplierFilters() {
    const today = ecuadorToday();
    return { from: today, to: today, supplier: "", block: "", variety: "", length: "", classificationType: "", search: "" };
  }

  const supplierReportState = {
    open: false,
    queried: false,
    loading: false,
    error: "",
    rows: [],
    totals: emptySupplierTotals(),
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    filters: defaultSupplierFilters(),
    appliedFilters: null,
    sort: { field: "dateTime", direction: "desc" },
    elapsedMs: 0,
    payloadBytes: 0
  };

  function openSupplierReport() {
    supplierReportState.open = true;
    supplierReportState.queried = false;
    supplierReportState.rows = [];
    supplierReportState.total = 0;
    supplierReportState.totals = emptySupplierTotals();
    supplierReportState.error = "";
    supplierReportState.filters = defaultSupplierFilters();
    supplierReportState.appliedFilters = null;
  }

  function closeSupplierReport() {
    supplierReportState.open = false;
  }

  function setSupplierReportFilter(field, value) {
    if (field === "pageSize") {
      supplierReportState.pageSize = [25, 50].includes(Number(value)) ? Number(value) : 25;
      return;
    }
    if (Object.hasOwn(supplierReportState.filters, field)) supplierReportState.filters[field] = value;
  }

  function clearSupplierReport() {
    supplierReportState.filters = defaultSupplierFilters();
    supplierReportState.appliedFilters = null;
    supplierReportState.queried = false;
    supplierReportState.rows = [];
    supplierReportState.total = 0;
    supplierReportState.totals = emptySupplierTotals();
    supplierReportState.error = "";
  }

  async function querySupplierReportPage(page = 1, options = {}) {
    if (supplierReportState.loading) return { ok: false, busy: true };
    supplierReportState.loading = true;
    supplierReportState.error = "";
    const filters = options.reuseApplied === true && supplierReportState.appliedFilters
      ? { ...supplierReportState.appliedFilters }
      : { ...supplierReportState.filters };
    try {
      const repository = BlessERP.getSupplierInventoryReportQueryRepository?.();
      if (!repository) throw new Error("El repository search-first del reporte no está disponible.");
      const result = await repository.queryPage(filters, {
        page,
        pageSize: supplierReportState.pageSize,
        sort: supplierReportState.sort
      });
      supplierReportState.rows = result.items;
      supplierReportState.totals = { ...emptySupplierTotals(), ...result.totals };
      supplierReportState.total = Number(result.total || 0);
      supplierReportState.page = Number(result.page || page);
      supplierReportState.totalPages = Number(result.totalPages || 1);
      supplierReportState.pageSize = Number(result.pageSize || supplierReportState.pageSize);
      supplierReportState.elapsedMs = Number(result.elapsedMs || 0);
      supplierReportState.payloadBytes = Number(result.payloadBytes || 0);
      supplierReportState.appliedFilters = { ...result.filters };
      supplierReportState.queried = true;
      return { ok: true, result };
    } catch (error) {
      supplierReportState.rows = [];
      supplierReportState.total = 0;
      supplierReportState.totals = emptySupplierTotals();
      supplierReportState.error = error?.message || "No se pudo consultar el Reporte de Proveedores.";
      supplierReportState.queried = true;
      return { ok: false, error, message: supplierReportState.error };
    } finally {
      supplierReportState.loading = false;
    }
  }

  async function sortSupplierReport(field) {
    const allowed = new Set(["dateTime", "supplier", "variety", "nationalStems", "exportedStems", "classifiedStems", "mismatch"]);
    const nextField = allowed.has(field) ? field : "dateTime";
    supplierReportState.sort = {
      field: nextField,
      direction: supplierReportState.sort.field === nextField && supplierReportState.sort.direction === "asc" ? "desc" : "asc"
    };
    if (supplierReportState.queried) return querySupplierReportPage(1, { reuseApplied: true });
    return { ok: true, queried: false };
  }

  async function resetSupplierReportSort() {
    supplierReportState.sort = { field: "dateTime", direction: "desc" };
    if (supplierReportState.queried) return querySupplierReportPage(1, { reuseApplied: true });
    return { ok: true, queried: false };
  }

  function aggregateSupplierClassificationRows(rows) {
    const groups = new Map();
    rows.forEach(item => {
      const key = [item.date, item.supplier, item.variety].join("|");
      const current = groups.get(key) || {
        id: `PROVIDER-REPORT-${key}`,
        dateTime: item.dateTime,
        date: item.date,
        supplier: item.supplier,
        blocks: new Set(),
        variety: item.variety,
        classifiedStems: 0,
        exportedStems: 0,
        nationalStems: 0,
        mismatch: 0,
        classification: "EXPORTACION",
        classificationPending: false,
        responsibles: new Set(),
        ...Object.fromEntries(SUPPLIER_REPORT_LENGTHS.map(length => [`length${length}`, 0]))
      };
      current.dateTime = current.dateTime > item.dateTime ? current.dateTime : item.dateTime;
      const numericLength = Number(item.length || 0);
      if (item.sourceType === "INVENTARIO_BONCHES" && SUPPLIER_REPORT_LENGTHS.includes(numericLength)) {
        current[`length${numericLength}`] += item.inventoryStems;
      }
      current.classifiedStems += item.classifiedStems;
      current.exportedStems += item.inventoryStems;
      current.nationalStems += item.nationalStems;
      current.classificationPending = current.classificationPending || item.classificationPending;
      if (item.block) current.blocks.add(item.block);
      if (item.responsible) current.responsibles.add(item.responsible);
      groups.set(key, current);
    });
    return [...groups.values()].map(item => {
      const mismatch = item.exportedStems + item.nationalStems - item.classifiedStems;
      const classification = item.classificationPending
        ? "PENDIENTE"
        : item.nationalStems > 0 && item.exportedStems > 0
          ? "MIXTA"
          : item.nationalStems > 0
            ? "NACIONAL"
            : "EXPORTACION";
      const { blocks, responsibles, ...baseItem } = item;
      return {
        ...baseItem,
        block: [...blocks].map(compactBlockCode).filter(Boolean).sort((left, right) => left.localeCompare(right, "es", { numeric: true })).join("+") || "SIN BLOQUE",
        classification,
        mismatch,
        utilization: item.classifiedStems > 0 ? (item.exportedStems / item.classifiedStems) * 100 : 0,
        responsible: [...responsibles].sort((left, right) => left.localeCompare(right, "es")).join(" + ") || "SIN RESPONSABLE"
      };
    });
  }

  const REPORT_SORT_FIELDS = new Set([
    "dateTime", "supplier", "variety", "classifiedStems", "exportedStems", "nationalStems", "mismatch",
    ...SUPPLIER_REPORT_LENGTHS.map(length => `length${length}`)
  ]);

  function sortSupplierClassificationRows(rows, sort = {}) {
    const field = REPORT_SORT_FIELDS.has(sort.field) ? sort.field : "dateTime";
    const direction = sort.direction === "asc" ? 1 : -1;
    return rows.slice().sort((left, right) => {
      const leftValue = left[field] ?? "";
      const rightValue = right[field] ?? "";
      if (typeof leftValue === "number" && typeof rightValue === "number") return (leftValue - rightValue) * direction;
      return String(leftValue).localeCompare(String(rightValue), "es", { numeric: true, sensitivity: "base" }) * direction;
    });
  }

  function supplierClassificationTotals(rows) {
    const totals = rows.reduce((summary, item) => {
      SUPPLIER_REPORT_LENGTHS.forEach(length => {
        summary[`length${length}`] += Number(item[`length${length}`] || 0);
      });
      summary.classifiedStems += Number(item.classifiedStems || 0);
      summary.exportedStems += Number(item.exportedStems || 0);
      summary.nationalStems += Number(item.nationalStems || 0);
      summary.mismatch += Number(item.mismatch || 0);
      return summary;
    }, {
      classifiedStems: 0,
      exportedStems: 0,
      nationalStems: 0,
      mismatch: 0,
      ...Object.fromEntries(SUPPLIER_REPORT_LENGTHS.map(length => [`length${length}`, 0]))
    });
    totals.records = rows.length;
    totals.suppliers = new Set(rows.flatMap(item => String(item.supplier || "").split(" + ")).filter(Boolean)).size;
    totals.varieties = new Set(rows.flatMap(item => String(item.variety || "").split(" + ")).filter(Boolean)).size;
    return totals;
  }

  function getSupplierClassificationReport(appState, options = {}) {
    const ui = BlessERP.operacionesState.getUi(appState);
    const filters = { ...(options.filters || ui.inventorySupplierReportAppliedFilters || {}) };
    const sourceRows = buildSupplierClassificationSourceRows(appState);
    const aggregatedRows = aggregateSupplierClassificationRows(sourceRows);
    const filteredRows = filterSupplierClassificationRows(aggregatedRows, filters);
    const rows = sortSupplierClassificationRows(
      filteredRows,
      options.sort || ui.inventorySupplierReportSort
    );
    return {
      filters,
      sourceRows,
      rows,
      totals: supplierClassificationTotals(rows),
      from: filters.from || filteredRows.map(item => item.date).filter(Boolean).sort()[0] || "",
      to: filters.to || filteredRows.map(item => item.date).filter(Boolean).sort().at(-1) || ""
    };
  }

  function uniqueValues(rows, field, numeric = false) {
    return [...new Set(rows.map(item => item[field]).filter(value => numeric ? Number(value) > 0 : Boolean(value)))]
      .sort((left, right) => numeric ? Number(left) - Number(right) : String(left).localeCompare(String(right), "es"));
  }

  function optionList(values, selected, labeler = value => value) {
    return values.map(value => `<option value="${BlessERP.operacionesUtils.esc(value)}" ${String(selected) === String(value) ? "selected" : ""}>${BlessERP.operacionesUtils.esc(labeler(value))}</option>`).join("");
  }

  function sortHeading(label, field, sort) {
    const active = sort.field === field;
    const mark = active ? (sort.direction === "asc" ? " &#9650;" : " &#9660;") : "";
    return `<button type="button" data-ops-action="inventory-supplier-report-sort" data-sort-field="${field}" aria-label="Ordenar por ${label}">${label}${mark}</button>`;
  }

  function supplierQualityTypeLabel(value) {
    if (typeof value !== "string") return "";
    const quality = value.trim();
    if (!quality) return "";
    if (quality === "PREMIUM") return "EXPORTACION";
    if (quality === "TIPO_B") return "TIPO B";
    if (quality === "EXPORTACION") return "EXPORTACION";
    return quality;
  }

  function renderSupplierClassificationReport(appState) {
    const utils = BlessERP.operacionesUtils;
    const report = supplierReportState;
    report.open = true;
    const draft = report.filters;
    const sort = report.sort;
    const start = report.total ? (report.page - 1) * report.pageSize + 1 : 0;
    const end = Math.min(report.total, report.page * report.pageSize);
    const emptyMessage = !report.queried
      ? "Selecciona filtros y pulsa Consultar."
      : report.error || "No existen registros para los filtros seleccionados.";
    return `
      <section class="panel-card ops-supplier-report-panel" aria-labelledby="ops-supplier-report-title">
        <div class="ops-supplier-report-heading">
          <div>
            <p class="section-kicker">INVENTARIO DE ROSAS</p>
            <h3 id="ops-supplier-report-title">Reporte de proveedores</h3>
            <p>Comparación por fecha operativa entre tallos entregados, nacional/rechazo e ingreso físico confirmado.</p>
          </div>
          <span>${report.queried ? `${utils.esc(utils.number(report.total))} resultado(s)` : "Consulta bajo demanda"}</span>
        </div>
        <div class="ops-supplier-report-toolbar">
          <div class="ops-supplier-report-filters">
            <label><span>Desde</span><input type="date" data-ops-supplier-report-field="from" value="${utils.esc(draft.from)}"></label>
            <label><span>Hasta</span><input type="date" data-ops-supplier-report-field="to" value="${utils.esc(draft.to)}"></label>
            <label><span>Proveedor</span><input type="search" data-ops-supplier-report-field="supplier" value="${utils.esc(draft.supplier)}" placeholder="Nombre o parte del nombre"></label>
            <label><span>Bloque</span><input type="search" data-ops-supplier-report-field="block" value="${utils.esc(draft.block)}" placeholder="Bloque"></label>
            <label><span>Variedad</span><input type="search" data-ops-supplier-report-field="variety" value="${utils.esc(draft.variety)}" placeholder="Variedad"></label>
            <label><span>Longitud</span><select data-ops-supplier-report-field="length"><option value="">Todas</option>${optionList(SUPPLIER_REPORT_LENGTHS, draft.length, formatReportLength)}</select></label>
            <label><span>Clasificaci&oacute;n</span><select data-ops-supplier-report-field="classificationType"><option value="">Todas</option>${optionList(["EXPORTACION", "NACIONAL", "MIXTA", "PENDIENTE"], draft.classificationType)}</select></label>
            <label><span>Buscar</span><input type="search" data-ops-supplier-report-field="search" value="${utils.esc(draft.search)}" placeholder="Responsable o referencia"></label>
            <label><span>Filas</span><select data-ops-supplier-report-field="pageSize"><option value="25" ${report.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${report.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          </div>
          <div class="ops-supplier-report-actions">
            <button class="primary-button" type="button" data-ops-action="inventory-supplier-report-generate" ${report.loading ? "disabled" : ""}>${report.loading ? "Consultando..." : "Consultar"}</button>
            <button class="secondary-button" type="button" data-ops-action="inventory-supplier-report-export" ${report.queried && report.total ? "" : "disabled"}>Exportar a Excel</button>
            <details class="ops-supplier-report-options">
              <summary>Opciones</summary>
              <div><button type="button" data-ops-action="inventory-supplier-report-clear">Limpiar filtros</button><button type="button" data-ops-action="inventory-supplier-report-reset-sort">Restablecer orden</button></div>
            </details>
          </div>
        </div>
        <div class="compact-table-wrap ops-supplier-report-table-wrap">
          <table class="compact-table ops-supplier-report-table" aria-label="Reporte de inventario por proveedores">
            <thead><tr>
              <th>${sortHeading("Fecha", "dateTime", sort)}</th>
              <th>${sortHeading("Proveedor", "supplier", sort)}</th>
              <th>Bloque</th>
              <th>${sortHeading("Variedad", "variety", sort)}</th>
              <th>TIPO</th>
              ${SUPPLIER_REPORT_LENGTHS.map(length => `<th>${length} cm</th>`).join("")}
              <th>${sortHeading("Nacional / rechazo", "nationalStems", sort)}</th>
              <th>${sortHeading("Ingreso f&iacute;sico", "exportedStems", sort)}</th>
              <th>${sortHeading("Tallos entregados", "classifiedStems", sort)}</th>
              <th>${sortHeading("Desfase", "mismatch", sort)}</th>
            </tr></thead>
            <tbody>${report.rows.map(item => `<tr>
              <td>${utils.esc(formatReportDate(item.date))}</td>
              <td><strong>${utils.esc(item.supplier)}</strong></td>
              <td>${utils.esc(item.block || "SIN BLOQUE")}</td>
              <td>${utils.esc(item.variety)}</td>
              <td>${utils.esc(supplierQualityTypeLabel(item.quality))}</td>
              ${SUPPLIER_REPORT_LENGTHS.map(length => `<td>${utils.esc(utils.number(item[`length${length}`]))}</td>`).join("")}
              <td>${utils.esc(utils.number(item.nationalStems))}</td>
              <td><strong>${utils.esc(utils.number(item.exportedStems))}</strong></td>
              <td><strong>${utils.esc(utils.number(item.classifiedStems))}</strong></td>
              <td class="${item.mismatch ? "ops-report-mismatch" : ""}">${utils.esc(utils.number(item.mismatch))}</td>
            </tr>`).join("") || `<tr><td colspan="19"><div class="empty-inline">${utils.esc(emptyMessage)}</div></td></tr>`}</tbody>
            ${report.queried && report.total ? `<tfoot><tr><th colspan="5">TOTALES DEL FILTRO</th>${SUPPLIER_REPORT_LENGTHS.map(length => `<th>${utils.esc(utils.number(report.totals[`length${length}`]))}</th>`).join("")}<th>${utils.esc(utils.number(report.totals.nationalStems))}</th><th>${utils.esc(utils.number(report.totals.exportedStems))}</th><th>${utils.esc(utils.number(report.totals.classifiedStems))}</th><th>${utils.esc(utils.number(report.totals.mismatch))}</th></tr></tfoot>` : ""}
          </table>
        </div>
        ${report.queried ? `<div class="ops-search-first-pager"><span>Mostrando ${start}–${end} de ${report.total} · Página ${report.page}/${report.totalPages}</span><div class="table-actions-inline"><button class="secondary-button" data-ops-action="inventory-supplier-report-page" data-page="${report.page - 1}" ${report.page <= 1 ? "disabled" : ""}>Anterior</button><button class="secondary-button" data-ops-action="inventory-supplier-report-page" data-page="${report.page + 1}" ${report.page >= report.totalPages ? "disabled" : ""}>Siguiente</button></div></div>` : ""}
        ${report.queried ? `<div class="ops-supplier-report-summary-band" aria-label="Resumen general del reporte">
          <div><span>Registros</span><strong>${utils.esc(utils.number(report.totals.records))}</strong></div>
          <div><span>Proveedores</span><strong>${utils.esc(utils.number(report.totals.suppliers))}</strong></div>
          <div><span>Variedades</span><strong>${utils.esc(utils.number(report.totals.varieties))}</strong></div>
          <div><span>Ingreso físico</span><strong>${utils.esc(utils.number(report.totals.exportedStems))}</strong></div>
          <div><span>Tallos entregados</span><strong>${utils.esc(utils.number(report.totals.classifiedStems))}</strong></div>
          <div><span>Nacional / rechazo</span><strong>${utils.esc(utils.number(report.totals.nationalStems))}</strong></div>
          <div><span>Desfase</span><strong>${utils.esc(utils.number(report.totals.mismatch))}</strong></div>
        </div>` : ""}
      </section>`;
  }

  function buildSupplierClassificationSheets(report) {
    const headers = [
      "Fecha",
      "Proveedor",
      "Bloque",
      "Variedad",
      "TIPO",
      ...SUPPLIER_REPORT_LENGTHS.map(length => `${length} cm`),
      "Nacional / rechazo",
      "Ingreso fisico confirmado",
      "Tallos entregados a clasificacion",
      "Desfase"
    ];
    const widths = [14, 30, 18, 25, 16, ...SUPPLIER_REPORT_LENGTHS.map(() => 10), 18, 24, 30, 14];
    const toSheetRow = item => [
      excelDateTime(item.date),
      item.supplier,
      item.block || "SIN BLOQUE",
      item.variety,
      supplierQualityTypeLabel(item.quality),
      ...SUPPLIER_REPORT_LENGTHS.map(length => item[`length${length}`]),
      item.nationalStems,
      item.exportedStems,
      item.classifiedStems,
      item.mismatch
    ];
    const totalsRow = totals => [
      "TOTAL",
      "",
      "",
      "",
      "",
      ...SUPPLIER_REPORT_LENGTHS.map(length => totals[`length${length}`]),
      totals.nationalStems,
      totals.exportedStems,
      totals.classifiedStems,
      totals.mismatch
    ];
    const sheets = [{
      name: "Reporte proveedores",
      title: "BLESS FLOWER - REPORTE DE PROVEEDORES",
      widths,
      headers,
      rows: report.rows.map(toSheetRow),
      totals: totalsRow(report.totals)
    }];
    uniqueValues(report.rows, "supplier").forEach(supplier => {
      const rows = report.rows.filter(item => item.supplier === supplier);
      const supplierTotals = supplierClassificationTotals(rows);
      const blockSheetName = supplierBlockSheetName(rows);
      sheets.push({
        name: blockSheetName,
        title: `BLESS FLOWER - BLOQUE ${blockSheetName} - ${supplier}`,
        widths,
        headers,
        rows: rows.map(toSheetRow),
        totals: totalsRow(supplierTotals)
      });
    });
    return sheets;
  }

  async function exportSupplierClassificationXlsx(appState, options = {}) {
    if (!supplierReportState.queried || !supplierReportState.appliedFilters) {
      return { ok: false, message: "Primero consulta el reporte con el rango y filtros que deseas descargar." };
    }
    const repository = BlessERP.getSupplierInventoryReportQueryRepository?.();
    if (!repository) return { ok: false, message: "El repository search-first del reporte no está disponible." };
    const appliedFilters = { ...supplierReportState.appliedFilters };
    const result = await repository.exportReport(appliedFilters, { sort: { ...supplierReportState.sort } });
    const report = {
      filters: appliedFilters,
      rows: result.items || [],
      totals: { ...emptySupplierTotals(), ...(result.totals || {}) },
      from: appliedFilters.from,
      to: appliedFilters.to,
      total: Number(result.total || 0)
    };
    if (!report.rows.length) return { ok: false, message: "No existen registros para exportar con los filtros aplicados.", report };
    const calculatedTotals = supplierClassificationTotals(report.rows);
    const numericKeys = ["classifiedStems", "exportedStems", "nationalStems", "mismatch", ...SUPPLIER_REPORT_LENGTHS.map(length => `length${length}`)];
    const totalsMatch = report.rows.length === report.total && numericKeys.every(key => Number(calculatedTotals[key] || 0) === Number(report.totals[key] || 0));
    if (!totalsMatch) {
      return { ok: false, message: "La descarga no coincide con el universo consultado. Vuelve a consultar antes de exportar.", report };
    }
    const period = BlessERP.operacionesRamosReportXlsx.reportPeriod(report.from, report.to);
    const workbookReport = { ...report, ...period, validation: { ok: true, filters: appliedFilters, rows: report.rows.length } };
    const sheets = buildSupplierClassificationSheets(workbookReport);
    const logoBytes = options.logoBytes || await loadReferenceLogoBytes().catch(() => undefined);
    const archive = BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive(sheets, workbookReport, logoBytes);
    const fileName = `reporte-proveedores-clasificacion-${report.from || "inicio"}-${report.to || "fin"}.xlsx`;
    if (options.download !== false) {
      const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    }
    return { ok: true, report: workbookReport, sheets, archive, fileName };
  }

  let supplierRealtimeTimer = 0;
  window.addEventListener("erp:canonical-record-updated", event => {
    if (!supplierReportState.open || !supplierReportState.queried || !supplierReportState.appliedFilters) return;
    if (BlessERP.state?.currentRoute?.()?.id !== "operations-roses-inventory") return;
    const entity = String(event?.detail?.record?.entity || event?.detail?.entity || "").trim();
    if (!["operations_receptions", "operations_classifier_assignments", "operations_classification_results", "operations_rose_inventory"].includes(entity)) return;
    event.preventDefault?.();
    window.clearTimeout(supplierRealtimeTimer);
    supplierRealtimeTimer = window.setTimeout(async () => {
      const result = await querySupplierReportPage(supplierReportState.page, { reuseApplied: true });
      if (result.ok && supplierReportState.open) BlessERP.layout?.renderPage?.();
    }, 180);
  });

  BlessERP.operacionesInventarioProveedoresReport = {
    REPORT_LOGO_PATH,
    compactBlockCode,
    supplierBlockSheetName,
    buildSupplierReport,
    buildSupplierSheets,
    exportSupplierInventoryXlsx,
    buildSupplierClassificationSourceRows,
    filterSupplierClassificationRows,
    aggregateSupplierClassificationRows,
    sortSupplierClassificationRows,
    supplierClassificationTotals,
    supplierQualityTypeLabel,
    getSupplierClassificationReport,
    openSupplierReport,
    closeSupplierReport,
    setSupplierReportFilter,
    clearSupplierReport,
    querySupplierReportPage,
    sortSupplierReport,
    resetSupplierReportSort,
    getSupplierReportState: () => ({
      ...supplierReportState,
      filters: { ...supplierReportState.filters },
      appliedFilters: supplierReportState.appliedFilters ? { ...supplierReportState.appliedFilters } : null,
      rows: [...supplierReportState.rows]
    }),
    renderSupplierClassificationReport,
    buildSupplierClassificationSheets,
    exportSupplierClassificationXlsx
  };
})();
