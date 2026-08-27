(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, number } = BlessERP.utils;

  function company(run = {}, item = {}) {
    const companyId = run.companyId || run.company_id || item.companyId || item.company_id || "";
    return BlessERP.services?.companyBranding?.resolve?.(companyId)
      || BlessERP.services.companySettings.settings();
  }

  function componentMap(itemId) {
    return Object.fromEntries(BlessERP.payrollEngine.components(itemId).map(item => [item.code, item]));
  }

  function formatDate(value) {
    const [year, month, day] = String(value || "").slice(0, 10).split("-");
    return year && month && day ? `${day}/${month}/${year}` : String(value || "");
  }

  function amount(value) {
    const numeric = Number(value || 0);
    return `<span class="payroll-amount-currency">$</span><span class="payroll-amount-value">${numeric ? esc(numeric.toFixed(2)) : "-"}</span>`;
  }

  function valueRow(label, value, options = {}) {
    if (options.optional && Number(value || 0) === 0) return "";
    return `<tr><th>${esc(label)}</th><td>${amount(value)}</td></tr>`;
  }

  function additionalDetail(components) {
    const timeEntries = components.NORMAL_HOURS?.snapshot?.entries || components.OVERTIME?.snapshot?.entries || [];
    const performance = components.PERFORMANCE?.snapshot?.entries || [];
    const performanceSummary = components.PERFORMANCE?.snapshot?.performanceSummary || {};
    const commissions = components.COMMISSION?.snapshot?.details || [];
    const weekdayHours = timeEntries.reduce((sum, row) => {
      const date = new Date(`${row.date || row.work_date || row.workDate}T00:00:00`);
      const day = Number.isNaN(date.getTime()) ? -1 : date.getDay();
      return sum + (day >= 1 && day <= 5 ? Number(row.normal_hours ?? row.normalHours ?? row.hours ?? 0) : 0);
    }, 0);
    const saturdayHours = timeEntries.reduce((sum, row) => {
      const date = new Date(`${row.date || row.work_date || row.workDate}T00:00:00`);
      return sum + (date.getDay() === 6 ? Number(row.normal_hours ?? row.normalHours ?? row.hours ?? 0) : 0);
    }, 0);
    const extraHours = timeEntries.reduce((sum, row) => sum + Number(row.additional_hours ?? row.additionalHours ?? row.overtimeHours ?? 0), 0);
    const classifiedStems = performance.filter(row => String(row.activity || "").toUpperCase().includes("CLASIFIC"))
      .reduce((sum, row) => sum + Number(row.quantity ?? row.completedQuantity ?? row.stems ?? 0), 0);
    const enteredBunches = performance.filter(row => String(row.activity || "").toUpperCase().includes("EMBONCH"))
      .reduce((sum, row) => sum + Number(row.quantity ?? row.completedQuantity ?? row.bunches ?? 0), 0);
    const soldStems = performance.filter(row => String(row.activity || "").toUpperCase().includes("VENTA"))
      .reduce((sum, row) => sum + Number(row.quantity ?? row.completedQuantity ?? row.stems ?? 0), 0);
    const rows = [
      ["Lunes a viernes", weekdayHours],
      ["Sábados", saturdayHours],
      ["Horas extras", extraHours],
      ["Tallos clasificados", classifiedStems],
      ["Bonches ingresados", enteredBunches],
      ["Tallos vendidos", soldStems],
      ["Ventas para comisión", commissions.length]
    ].filter(([, value]) => Number(value || 0) > 0)
      .map(([label, value]) => [label, number(value)]);
    if (performanceSummary.role) {
      rows.push(
        ["Tarifa rendimiento", `$ ${Number(performanceSummary.rate || 0).toFixed(Number(performanceSummary.precision || 8))} / ${String(performanceSummary.unit || "").toLowerCase()}`],
        ...(performanceSummary.role === "BUNCHER"
          ? [["Equivalente por tallo", `$ ${Number(performanceSummary.stemEquivalentRate || 0).toFixed(Number(performanceSummary.precision || 8))}`]]
          : []),
        ["Meta del rango", `${number(performanceSummary.targetQuantity)} ${String(performanceSummary.unit || "").toLowerCase()}`],
        ["Cumplimiento", `${Number(performanceSummary.efficiency || 0).toFixed(2)} %`]
      );
    }
    if (!rows.length) return `<p class="payroll-detail-empty">Sin detalle adicional en este periodo.</p>`;
    return `<table class="payroll-detail-table"><tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderSlip(run, item) {
    const settings = company(run, item);
    const components = componentMap(item.id);
    const watermark = ["BORRADOR", "CALCULADO"].includes(run.status) ? "BORRADOR" : item.paymentStatus === "PAGADO" ? "PAGADO" : "";
    const companyName = settings.commercialName || settings.legalName || "Empresa";
    const logo = settings.logoUrl || settings.logoPath || "scripts/assets/bless-flower-logo-official-transparent.png";
    return `
      <article class="doc-page payroll-slip-page">
        ${watermark === "BORRADOR" ? `<div class="payroll-watermark">${esc(watermark)}</div>` : ""}
        <header class="payroll-slip-header">
          <div class="payroll-company-logo"><img src="${esc(logo)}" alt="${esc(companyName)}"></div>
          <div class="payroll-company-data">
            <strong>${esc(companyName)}</strong>
            <b>${esc(settings.legalName || companyName)}</b>
            <span>RUC: ${esc(settings.ruc || "")}</span>
            <a>${esc(settings.email || "")}</a>
          </div>
        </header>
        <h1 class="payroll-slip-title">ROL DE PAGOS INDIVIDUAL</h1>

        <section class="payroll-meta-grid">
          <dl>
            <div><dt>DESDE:</dt><dd>${esc(formatDate(run.dateFrom))}</dd></div>
            <div><dt>NOMBRE:</dt><dd>${esc(item.employeeName)}</dd></div>
            <div><dt>CÉDULA:</dt><dd>${esc(item.identification)}</dd></div>
          </dl>
          <dl>
            <div><dt>HASTA:</dt><dd>${esc(formatDate(run.dateTo))}</dd></div>
            <div><dt>ÁREA:</dt><dd>${esc(item.area)}</dd></div>
            <div><dt>CARGO:</dt><dd>${esc(item.position)}</dd></div>
            <div><dt>DÍAS LAB:</dt><dd>${esc(number(item.daysWorked))}</dd></div>
          </dl>
        </section>
        <div class="payroll-green-band"></div>

        <section class="payroll-values-grid">
          <div>
            <h2>INGRESOS</h2>
            <table><tbody>
              ${valueRow("Sueldo", components.SALARY?.amount)}
              ${valueRow("Valor horas a cobrar", Number(components.NORMAL_HOURS?.amount || 0) + Number(components.OVERTIME?.amount || 0))}
              ${valueRow("Pasajes", components.TRANSPORT?.amount)}
              ${valueRow("Bonificaciones", components.BONUS?.amount)}
              ${valueRow("Rendimiento", components.PERFORMANCE?.amount, { optional: true })}
              ${valueRow("Comisiones", components.COMMISSION?.amount, { optional: true })}
              ${valueRow("Otros ingresos", components.OTHER_INCOME?.amount, { optional: true })}
            </tbody></table>
          </div>
          <div>
            <h2>DESCUENTO</h2>
            <table><tbody>
              ${valueRow("Almuerzo", components.FOOD?.amount)}
              ${valueRow("Multas", components.FINES?.amount)}
              ${valueRow("Anticipos", components.ADVANCE?.amount, { optional: true })}
              ${valueRow("Otros", components.OTHER_DISCOUNTS?.amount)}
            </tbody></table>
          </div>
        </section>
        <div class="payroll-green-band"></div>

        <section class="payroll-totals">
          <div><strong>TOTAL INGRESOS</strong>${amount(item.totalIncome)}</div>
          <div><strong>TOTAL DESCUENTO</strong>${amount(item.totalDiscounts)}</div>
        </section>

        <section class="payroll-result-grid">
          <div class="payroll-additional-detail">
            <h3>DETALLE ADICIONAL</h3>
            ${additionalDetail(components)}
          </div>
          <div class="payroll-net-result"><strong>NETO A RECIBIR</strong>${amount(item.netPay)}</div>
        </section>

        <footer class="payroll-signatures">
          <p>Certifico que he recibido a entera satisfacción los valores contenidos en el presente comprobante por pago de remuneraciones, por lo cual no tengo ningún cargo o reclamo posterior que perjudique a la empresa ${esc(companyName)}.</p>
          <div><span>FIRMA TRABAJADOR</span></div>
        </footer>
      </article>
    `;
  }

  function documentHtml(runId, itemIds = []) {
    const run = BlessERP.payrollEngine.getRun(runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    const items = BlessERP.payrollEngine.items(runId).filter(item => !itemIds.length || itemIds.includes(item.id));
    if (!items.length) return { ok: false, errors: ["No existen trabajadores seleccionados para imprimir."] };
    const sheets = items.map(item => renderSlip(run, item)).join("");
    const baseHref = document.baseURI;
    return {
      ok: true,
      title: `${run.number} - Rol de pagos`,
      html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${esc(baseHref)}"><title>${esc(run.number)}</title><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="styles/print.css"><link rel="stylesheet" href="styles/payroll-print.css"></head><body data-print-preview="true"><main class="print-shell payroll-print-shell">${sheets}</main></body></html>`,
      count: items.length
    };
  }

  function openOutput(runId, itemIds = [], { autoPrint = false } = {}) {
    const output = documentHtml(runId, itemIds);
    if (!output.ok) {
      BlessERP.layout.toast(output.errors.join(" "));
      return output;
    }
    const frame = document.createElement("iframe");
    frame.className = "commercial-print-output-frame payroll-print-output-frame";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);
    const frameDocument = frame.contentDocument;
    frameDocument.open();
    frameDocument.write(output.html);
    frameDocument.close();
    const launch = () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      frameWindow.focus();
      if (autoPrint) frameWindow.print();
    };
    if (frameDocument.readyState === "complete") setTimeout(launch, 80);
    else frame.addEventListener("load", () => setTimeout(launch, 80), { once: true });
    if (autoPrint) {
      frame.contentWindow?.addEventListener("afterprint", () => frame.remove(), { once: true });
    }
    return { ...output, frame };
  }

  function preview(runId, itemIds = []) {
    return openOutput(runId, itemIds, { autoPrint: false });
  }

  function print(runId, itemIds = []) {
    return openOutput(runId, itemIds, { autoPrint: true });
  }

  function downloadPdf(runId, itemIds = []) {
    BlessERP.layout.toast("Se abrirá el formato A4. En el diálogo seleccione Guardar como PDF.");
    return print(runId, itemIds);
  }

  BlessERP.payrollPrint = { renderSlip, documentHtml, preview, print, downloadPdf };
})();
