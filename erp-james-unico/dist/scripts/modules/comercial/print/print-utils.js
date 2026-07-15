(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;

  function absoluteUrl(relativePath) {
    try {
      return new URL(relativePath, document.baseURI).href;
    } catch (error) {
      return relativePath;
    }
  }

  function normalizePageSize(pageSize) {
    const value = String(pageSize || "A4").trim().toUpperCase();
    return value === "LETTER" || value === "CARTA"
      ? "Letter portrait"
      : "A4 portrait";
  }

  function previewStylesheetTags(pageSize) {
    const inlineStyles = [...document.querySelectorAll("style")]
      .map(node => node.textContent || "")
      .join("\n")
      .trim();

    if (inlineStyles) {
      return `
        <style>${inlineStyles}</style>
        <style>@page{size:${normalizePageSize(pageSize)};margin:10mm;}</style>
      `;
    }

    return `
      <link rel="stylesheet" href="${utils.esc(absoluteUrl("styles.css"))}">
      <link rel="stylesheet" href="${utils.esc(absoluteUrl("styles/print.css"))}">
      <style>@page{size:${normalizePageSize(pageSize)};margin:10mm;}</style>
    `;
  }

  function groupLinesByBox(lines) {
    const groups = [];
    const groupMap = new Map();
    (lines || []).forEach(line => {
      const key = `${line.boxNumber}|${line.boxType}`;
      if (!groupMap.has(key)) {
        const group = {
          boxNumber: line.boxNumber,
          boxType: line.boxType,
          lines: [],
          totalBunches: 0,
          totalStems: 0,
          totalUsd: 0,
          poValues: new Set()
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      const group = groupMap.get(key);
      group.lines.push(line);
      group.totalBunches += Number(line.bunches || 0);
      group.totalStems += Number(line.totalStems || 0);
      group.totalUsd += Number(line.totalLine || 0);
      if (String(line.po || "").trim()) {
        group.poValues.add(String(line.po).trim());
      }
    });

    return groups.sort((left, right) => left.boxNumber - right.boxNumber);
  }

  function summarizeMap(map, formatter = value => value, sort = "label") {
    const rows = Object.entries(map || {}).map(([label, value]) => ({
      label,
      value: formatter(value)
    }));

    if (sort === "numeric") {
      rows.sort((left, right) => Number(left.label) - Number(right.label));
      return rows;
    }

    rows.sort((left, right) => String(left.label).localeCompare(String(right.label)));
    return rows;
  }

  function summarizeByPo(lines) {
    const poMap = new Map();
    (lines || []).forEach(line => {
      const key = String(line.po || "").trim() || "Sin PO";
      if (!poMap.has(key)) {
        poMap.set(key, {
          label: key,
          boxes: new Set(),
          bunches: 0,
          stems: 0
        });
      }
      const entry = poMap.get(key);
      entry.boxes.add(line.boxNumber);
      entry.bunches += Number(line.bunches || 0);
      entry.stems += Number(line.totalStems || 0);
    });

    return [...poMap.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(entry => ({
        label: entry.label,
        boxes: entry.boxes.size,
        bunches: entry.bunches,
        stems: entry.stems
      }));
  }

  function describeBoxContent(group) {
    return (group?.lines || [])
      .map(line => `${line.variety} ${line.length} cm · ${utils.number(line.bunches)} r`)
      .join(" / ");
  }

  function resolveBoxState(lines) {
    const states = (lines || []).map(line => String(line.state || "").toLowerCase());
    if (!states.length) return "pendiente";
    if (states.every(state => state === "confirmado")) return "listo";
    if (states.includes("reservado")) return "pendiente";
    return "pendiente";
  }

  function filterBoxGroups(boxGroups, options = {}) {
    const singleBox = Number(options.singleBox || 0);
    if (singleBox > 0) {
      return boxGroups.filter(group => Number(group.boxNumber) === singleBox);
    }
    const fromBox = Number(options.fromBox || 0);
    const toBox = Number(options.toBox || 0);
    if (!fromBox && !toBox) return boxGroups;
    const start = fromBox || toBox;
    const end = toBox || fromBox || start;
    return boxGroups.filter(group => group.boxNumber >= start && group.boxNumber <= end);
  }

  function buildContext(order, appState, options = {}) {
    const sourceState = appState || BlessERP.state?.state || null;
    const sourceOrder = order || data.createOrder();
    const normalizedOrder = utils.normalizeOrder(sourceOrder);
    const reservations = BlessERP.comercialState?.getReservations
      ? BlessERP.comercialState.getReservations(sourceState)
      : [];
    const validation = utils.getValidationState(normalizedOrder, reservations);
    const metrics = validation.metrics || utils.getOrderMetrics(normalizedOrder);
    const materials = validation.materials || utils.getEstimatedMaterials(normalizedOrder);
    const customer = utils.findCustomer(normalizedOrder.customerId);
    const brand = utils.findBrand(normalizedOrder.brandId);
    const agency = utils.findAgency(normalizedOrder.agencyId);
    const airline = utils.findAirline(normalizedOrder.airlineId);
    const dae = utils.findDae(normalizedOrder.daeNumber);
    const boxGroups = groupLinesByBox(metrics.lines);
    const relatedOrders = BlessERP.comercialState?.getOrders
      ? BlessERP.comercialState.getOrders(sourceState)
        .filter(item => normalizedOrder.daeNumber && item.daeNumber === normalizedOrder.daeNumber)
        .map(item => utils.normalizeOrder(item))
      : [];

    return {
      order: normalizedOrder,
      appState: sourceState,
      company: data.company,
      customer,
      brand,
      agency,
      airline,
      dae,
      metrics,
      materials,
      validation,
      reservations,
      boxGroups,
      relatedOrders,
      options
    };
  }

  function buildDocumentStatus(errors = [], warnings = []) {
    if (errors.length) {
      return {
        label: "bloqueado por errores",
        tone: "cancelled",
        missing: errors,
        warnings
      };
    }
    if (warnings.length) {
      return {
        label: "con advertencias",
        tone: "pending",
        missing: [],
        warnings
      };
    }
    return {
      label: "listo",
      tone: "authorized",
      missing: [],
      warnings: []
    };
  }

  function renderInfoRows(rows) {
    return (rows || [])
      .filter(row => row && (row[0] || row[1]))
      .map(([label, value]) => `
        <div class="doc-row">
          <span>${utils.esc(label)}</span>
          <span>${utils.esc(value || "-")}</span>
        </div>
      `)
      .join("");
  }

  function renderMetricPills(items) {
    return `
      <div class="doc-meta">
        ${(items || []).map(item => `
          <div class="doc-pill">
            <span>${utils.esc(item.label)}</span>
            <strong>${utils.esc(item.value || "-")}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderSimpleSummaryTable(headers, rows, numericColumns = []) {
    return `
      <table class="doc-summary-table">
        <thead>
          <tr>
            ${headers.map(header => `<th>${utils.esc(header)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr>
              ${row.map((cell, index) => `<td class="${numericColumns.includes(index) ? "numeric" : ""}">${utils.esc(cell)}</td>`).join("")}
            </tr>
          `).join("") : `<tr><td colspan="${headers.length}">Sin datos.</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderValidationList(items, emptyLabel, className = "doc-warning-list") {
    const content = items && items.length
      ? items.map(item => `<li>${utils.esc(item)}</li>`).join("")
      : `<li>${utils.esc(emptyLabel)}</li>`;
    return `<ul class="${className}">${content}</ul>`;
  }

  BlessERP.comercialPrintUtils = {
    absoluteUrl,
    buildContext,
    buildDocumentStatus,
    describeBoxContent,
    filterBoxGroups,
    groupLinesByBox,
    normalizePageSize,
    previewStylesheetTags,
    renderInfoRows,
    renderMetricPills,
    renderSimpleSummaryTable,
    renderValidationList,
    resolveBoxState,
    summarizeByPo,
    summarizeMap
  };
})();
