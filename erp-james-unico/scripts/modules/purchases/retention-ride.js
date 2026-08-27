(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function dateLabel(value) {
    const source = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : (source || "-");
  }

  function periodLabel(value) {
    const source = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})/.exec(source);
    return match ? `${match[2]}/${match[1]}` : "-";
  }

  function dateTimeLabel(value) {
    const source = String(value || "").trim();
    if (!source) return "-";
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) return source;
    return new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil",
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false
    }).format(parsed);
  }

  function documentTypeLabel(value) {
    return ({ "01": "FACTURA", "03": "LIQUIDACIÓN DE COMPRA", "04": "NOTA DE CRÉDITO", "05": "NOTA DE DÉBITO" })[String(value || "")]
      || String(value || "COMPROBANTE");
  }

  function documentNumberLabel(value) {
    const source = String(value || "").trim();
    const digits = source.replace(/\D+/g, "");
    return /^\d{15}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : (source || "-");
  }

  function issuerProfile() {
    const companyId = BlessERP.services?.companyContext?.activeCompanyId?.();
    return BlessERP.services?.companyBranding?.resolve?.(companyId)
      || BlessERP.services?.companySettings?.settings?.()
      || {};
  }

  function logoUrl(company) {
    const path = company.logoPath || "scripts/assets/bless-flower-logo-official-transparent.png";
    try {
      return new URL(path, window.location.href).href;
    } catch (_error) {
      return path;
    }
  }

  function retentionRows(retention, purchase) {
    const canonicalSupports = retention?.document?.source_snapshot?.withholding?.supportingDocuments || [];
    if (canonicalSupports.length) {
      const fiscalPeriod = retention.document.source_snapshot.withholding?.fiscalPeriod || periodLabel(retention.retentionDate);
      return canonicalSupports.flatMap(support => (support.retentions || []).map(line => {
        const taxName = String(line.code) === "2" ? "Impuesto al Valor Agregado" : String(line.code) === "1" ? "Impuesto a la Renta" : "Impuesto a la Salida de Divisas";
        return `<tr>
          <td>${esc(documentTypeLabel(support.documentCode))}</td>
          <td>${esc(documentNumberLabel(support.documentNumber))}</td>
          <td>${esc(dateLabel(support.issueDate))}</td>
          <td>${esc(fiscalPeriod)}</td>
          <td class="number">${money(line.taxableBase)}</td>
          <td>${esc(`${taxName}${line.retentionCode ? ` (${line.retentionCode})` : ""}`)}</td>
          <td class="number">${money(line.rate)}%</td>
          <td class="number">${money(line.value ?? line.retainedValue)}</td>
        </tr>`;
      })).join("");
    }
    const documentNumber = purchase?.documentNumber || retention.purchaseDocumentNumber || "-";
    const issueDate = dateLabel(purchase?.issueDate);
    const fiscalPeriod = periodLabel(purchase?.issueDate || retention.retentionDate);
    const detailLines = Array.isArray(retention.retentionLines)
      ? retention.retentionLines.filter(line => line.code)
      : [];
    const rows = detailLines.length
      ? detailLines.map(line => ({
        tax: line.taxType === "IVA" ? "Impuesto al Valor Agregado" : "Impuesto a la Renta",
        code: line.sriCode || line.code,
        base: line.baseAmount,
        percentage: line.percentage,
        retained: line.retainedAmount
      }))
      : [
        retention.rentCode ? {
          tax: "Impuesto a la Renta",
          code: retention.rentSriCode || retention.rentCode,
          base: retention.rentBaseAmount,
          percentage: retention.rentPercentage,
          retained: retention.rentRetainedAmount
        } : null,
        retention.vatCode ? {
          tax: "Impuesto al Valor Agregado",
          code: retention.vatSriCode || retention.vatCode,
          base: retention.vatBaseAmount,
          percentage: retention.vatPercentage,
          retained: retention.vatRetainedAmount
        } : null
      ].filter(Boolean);
    return rows.map(row => `
      <tr>
        <td>${esc(documentTypeLabel(purchase?.documentCode || "01"))}</td>
        <td>${esc(documentNumberLabel(documentNumber))}</td>
        <td>${esc(issueDate)}</td>
        <td>${esc(fiscalPeriod)}</td>
        <td class="number">${money(row.base)}</td>
        <td>${esc(`${row.tax}${row.code ? ` (${row.code})` : ""}`)}</td>
        <td class="number">${money(row.percentage)}%</td>
        <td class="number">${money(row.retained)}</td>
      </tr>
    `).join("");
  }

  function additionalRows(retention, purchase) {
    const document = retention?.document || {};
    const subject = document.buyer_snapshot || {};
    const extra = document.source_snapshot?.additionalInformation || {};
    const rows = [];
    const seen = new Set();
    const push = (label, value) => {
      const normalized = String(value ?? "").trim();
      const key = `${String(label).toUpperCase()}|${normalized.toUpperCase()}`;
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      rows.push([label, normalized]);
    };
    push("Dirección", subject.address || purchase?.supplierAddress);
    push("Email", subject.email || purchase?.provider?.email);
    push("Teléfono", subject.phone || purchase?.provider?.phone);
    Object.entries(extra).forEach(([label, value]) => {
      if (["string", "number", "boolean"].includes(typeof value)) push(label, value);
    });
    return rows;
  }

  function barcode(accessKey) {
    const digits = String(accessKey || "").replace(/\D+/g, "");
    if (!digits || !BlessERP.code128?.barcodeSvg) return `<div class="ride-empty-barcode">SIN CLAVE DE ACCESO</div>`;
    return BlessERP.code128.barcodeSvg(digits, {
      className: "ride-barcode-svg",
      height: 54,
      quietZone: 8
    });
  }

  function render(retention, purchase, options = {}) {
    const document = retention.document || {};
    const company = { ...issuerProfile(), ...(document.issuer_snapshot || {}) };
    const subject = document.buyer_snapshot || {};
    const status = String(document.status || retention.status || "").toUpperCase();
    const authorized = ["AUTORIZADO", "AUTORIZADA"].includes(status);
    const accessKey = String(document.access_key || retention.accessKey || "").replace(/\D+/g, "");
    const authorizationNumber = String(document.authorization_number || retention.authorizationNumber || "").replace(/\D+/g, "");
    const environment = String(document.environment || retention.environment || company.sriEnvironment || "PRUEBAS").toUpperCase() === "TEST" ? "PRUEBAS" : String(document.environment || retention.environment || company.sriEnvironment || "PRUEBAS");
    const number = document.full_number || retention.fullNumber || retention.retentionNumber || retention.draftNumber || "-";
    const accountingLabel = company.accountingRequired === false ? "NO" : "SI";
    const withholdingAgent = company.withholdingAgentNumber || company.agenteRetencion || "";
    const infoRows = additionalRows(retention, purchase);

    return `
      <article class="ride-sheet retention-ride-sheet">
        ${authorized ? "" : `<div class="ride-watermark">BORRADOR - NO AUTORIZADO</div>`}
        <section class="ride-top">
          <div class="ride-issuer-panel">
            <div class="ride-logo-wrap">
              <img src="${esc(logoUrl(company))}" alt="${esc(company.commercialName || company.legalName || "Empresa")}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
              <strong class="ride-logo-fallback" hidden>${esc(company.commercialName || company.legalName || "Empresa")}</strong>
            </div>
            <strong>${esc(company.legalName || company.commercialName || "BLESS FLOWER")}</strong>
            <span>${esc(company.commercialName || "")}</span>
            <dl>
              <dt>Dirección Matriz:</dt><dd>${esc(company.address || company.matrixAddress || "-")}</dd>
              <dt>Dirección Sucursal:</dt><dd>${esc(company.address2 || company.branchAddress || company.address || "-")}</dd>
              <dt>OBLIGADO A LLEVAR CONTABILIDAD</dt><dd>${esc(accountingLabel)}</dd>
              ${withholdingAgent ? `<dt>AGENTE DE RETENCIÓN</dt><dd>${esc(withholdingAgent)}</dd>` : ""}
            </dl>
          </div>
          <div class="ride-fiscal-panel">
            <div class="ride-ruc">R.U.C.: <strong>${esc(company.ruc || "-")}</strong></div>
            <h1>COMPROBANTE DE RETENCIÓN</h1>
            <div class="ride-number"><span>No.</span><strong>${esc(number)}</strong></div>
            <label>NÚMERO DE AUTORIZACIÓN</label>
            <strong class="ride-wrap">${esc(authorizationNumber || "-")}</strong>
            <div class="ride-fiscal-grid">
              <span>FECHA Y HORA DE AUTORIZACIÓN</span><strong>${esc(dateTimeLabel(document.authorized_at || retention.authorizedAt))}</strong>
              <span>AMBIENTE</span><strong>${esc(environment)}</strong>
              <span>EMISIÓN</span><strong>${esc(String(document.emission_type || retention.emissionType || "1") === "1" ? "NORMAL" : (document.emission_type || retention.emissionType))}</strong>
            </div>
            <label>CLAVE DE ACCESO</label>
            <div class="ride-barcode">${barcode(accessKey)}</div>
            <strong class="ride-access-key">${esc(accessKey || "-")}</strong>
          </div>
        </section>

        <section class="ride-recipient">
          <div><span>Razón Social / Nombres y Apellidos:</span><strong>${esc(subject.legalName || retention.supplierName || purchase?.supplierName || "-")}</strong></div>
          <div><span>Identificación:</span><strong>${esc(subject.identification || retention.supplierRuc || purchase?.supplierRuc || "-")}</strong></div>
          <div><span>Fecha:</span><strong>${esc(dateLabel(document.issue_date || retention.retentionDate))}</strong></div>
        </section>

        <table class="ride-detail retention-detail">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Número</th>
              <th>Fecha Emisión</th>
              <th>Ejercicio Fiscal</th>
              <th>Base Imponible para la Retención</th>
              <th>Impuesto</th>
              <th>Porcentaje Retención</th>
              <th>Valor Retenido</th>
            </tr>
          </thead>
          <tbody>${retentionRows(retention, purchase) || `<tr><td colspan="8">Sin detalle de retención.</td></tr>`}</tbody>
          <tfoot><tr><td colspan="7">TOTAL RETENIDO</td><td class="number">${money(retention.totalRetained)}</td></tr></tfoot>
        </table>

        ${infoRows.length ? `<section class="ride-additional">
          <h2>Información Adicional</h2>
          ${infoRows.map(([label, value]) => `<div><span>${esc(label)}:</span><strong>${esc(value)}</strong></div>`).join("")}
        </section>` : ""}
        ${options.note ? `<p class="ride-note">${esc(options.note)}</p>` : ""}
      </article>
    `;
  }

  function documentHtml(retention, purchase, options = {}) {
    const title = `RIDE retencion ${retention.fullNumber || retention.draftNumber || ""}`.trim();
    return `<!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>${esc(title)}</title>
          <style>
            @page{size:A4 portrait;margin:8mm}
            *{box-sizing:border-box}
            html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:9px}
            .ride-sheet{position:relative;width:194mm;min-height:281mm;margin:0 auto;background:#fff}
            .ride-top{display:grid;grid-template-columns:1.08fr .92fr;gap:2mm}
            .ride-issuer-panel,.ride-fiscal-panel{min-height:91mm;border:1px solid #111;border-radius:3mm;padding:3mm}
            .ride-logo-wrap{height:27mm;display:flex;align-items:center;justify-content:center;margin-bottom:1mm}
            .ride-logo-wrap img{max-width:76mm;max-height:25mm;object-fit:contain}
            .ride-logo-fallback{font-size:18px;text-align:center}
            .ride-issuer-panel>strong,.ride-issuer-panel>span{display:block;text-align:center;margin:1mm 0}
            .ride-issuer-panel dl{display:grid;grid-template-columns:34mm 1fr;gap:2mm;margin:7mm 0 0}
            .ride-issuer-panel dt{font-weight:700}.ride-issuer-panel dd{margin:0;overflow-wrap:anywhere}
            .ride-ruc{font-size:13px;letter-spacing:.5px}.ride-ruc strong{margin-left:6mm}
            .ride-fiscal-panel h1{font-size:15px;margin:5mm 0 4mm;font-weight:500}
            .ride-number{display:flex;gap:8mm;margin-bottom:5mm}.ride-fiscal-panel label{display:block;font-weight:700;margin:3mm 0 1.5mm}
            .ride-wrap,.ride-access-key{display:block;overflow-wrap:anywhere;font-size:8px}
            .ride-fiscal-grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm 2mm;margin:6mm 0}
            .ride-fiscal-grid span{font-weight:700}.ride-barcode{height:19mm;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
            .ride-barcode svg{width:100%;height:17mm}.ride-access-key{text-align:center;font-family:Consolas,monospace;font-size:7px}
            .ride-empty-barcode{width:100%;padding:6mm 0;border:1px dashed #777;text-align:center;color:#777}
            .ride-recipient{border:1px solid #111;margin-top:4mm;padding:2.5mm}
            .ride-recipient>div{display:grid;grid-template-columns:54mm 1fr;min-height:5mm}.ride-recipient span{font-weight:700}
            table{width:100%;border-collapse:collapse;table-layout:fixed}.ride-detail{margin-top:4mm}
            .ride-detail th:nth-child(1){width:10%}.ride-detail th:nth-child(2){width:15%}.ride-detail th:nth-child(3){width:11%}.ride-detail th:nth-child(4){width:10%}
            .ride-detail th:nth-child(5){width:14%}.ride-detail th:nth-child(6){width:17%}.ride-detail th:nth-child(7){width:11%}.ride-detail th:nth-child(8){width:12%}
            .ride-detail th,.ride-detail td{border:1px solid #111;padding:2mm 1mm;vertical-align:middle;overflow-wrap:anywhere}
            .ride-detail th{background:#eee;text-align:center;font-weight:700;font-size:7px}.ride-detail td{font-size:7.5px}
            .ride-detail tfoot td{font-weight:700}.ride-detail tfoot td:first-child{text-align:right}
            .number{text-align:right;white-space:nowrap}
            .ride-additional{width:68%;border:1px solid #111;margin-top:5mm;padding:3mm}
            .ride-additional h2{text-align:center;font-size:10px;font-weight:700;margin:0 0 3mm}
            .ride-additional>div{display:grid;grid-template-columns:35mm 1fr;border-top:1px solid #999;padding:1.5mm}
            .ride-additional span{font-weight:700}.ride-note{margin-top:4mm;font-size:8px}
            .ride-watermark{position:absolute;z-index:5;top:125mm;left:15mm;transform:rotate(-28deg);font-size:32px;font-weight:700;color:rgba(180,0,0,.14);pointer-events:none}
            @media print{.ride-sheet{margin:0;page-break-after:always}.ride-sheet:last-child{page-break-after:auto}}
          </style>
        </head>
        <body>${render(retention, purchase, options)}</body>
      </html>`;
  }

  function open(retention, purchase, options = {}) {
    if (!retention) return { ok: false, message: "No se encontró la retención." };
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return { ok: false, message: "El navegador bloqueó la ventana del RIDE." };
    popup.document.open();
    popup.document.write(documentHtml(retention, purchase, options));
    popup.document.close();
    if (options.print) {
      popup.addEventListener("load", () => {
        popup.focus();
        popup.print();
      }, { once: true });
    }
    return { ok: true, popup };
  }

  BlessERP.retentionRide = {
    documentHtml,
    open,
    render
  };
})();
