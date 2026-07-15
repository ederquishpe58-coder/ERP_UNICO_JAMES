(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

  function xml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function dateParts(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
  }

  function reportPeriod(from, to) {
    const start = dateParts(from);
    const end = dateParts(to);
    if (!start || !end) return { period: "PERIODO SIN DEFINIR", range: "RANGO DE FECHAS SIN DEFINIR" };
    const period = start.year === end.year ? `PERIODO ${start.year}` : `PERIODO ${start.year} - ${end.year}`;
    const startYear = start.year === end.year ? "" : ` ${start.year}`;
    return {
      period,
      range: `FECHA DEL ${start.day} DE ${MONTHS[start.month - 1]}${startYear} AL ${end.day} DE ${MONTHS[end.month - 1]} ${end.year}`
    };
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

  function excelText(value) {
    return { xlsxType: "text", value: String(value ?? "") };
  }

  function getReportData(appState, filters = {}) {
    const store = BlessERP.operacionesState.getStore(appState);
    const from = filters.from || "";
    const to = filters.to || "";
    const labelsById = new Map((store.labelBatches || []).map(item => [item.id, item]));
    const labelsByCode = new Map((store.labelBatches || []).map(item => [item.code, item]));
    const records = (store.roseInventory || [])
      .filter(item => item.sourceType === "ESCANEO_ETIQUETA")
      .filter(item => {
        const date = String(item.admittedAt || item.date || "").slice(0, 10);
        return (!from || date >= from) && (!to || date <= to);
      })
      .map(item => {
        const label = labelsById.get(item.sourceLabelId) || labelsByCode.get(item.labelCode) || {};
        const composition = Array.isArray(item.composition) && item.composition.length
          ? item.composition.map(part => ({ block: part.block || "SIN BLOQUE", supplier: part.supplier || "SIN PROVEEDOR", stems: Number(part.stems || 0) }))
          : [{ block: item.block || label.block || "SIN BLOQUE", supplier: item.supplier || label.supplier || "SIN PROVEEDOR", stems: Number(item.stemsPerBunch || item.stems || 0) }];
        const type = label.labelType === "MIXTA" || composition.length > 1 ? "MIXTA" : "NORMAL";
        return {
          admittedAt: item.admittedAt || item.date || "",
          code: item.labelCode || label.code || "",
          type,
          printedSupplier: type === "MIXTA" ? "BLESS FL" : (label.supplier || item.supplier || ""),
          blocks: composition.map(part => part.block).join(" + "),
          variety: item.variety || label.variety || "",
          length: Number(item.length || label.length || 0),
          stems: Number(item.stemsPerBunch || item.stems || label.stemsPerBunch || 0),
          buncher: item.buncher || label.buncher || "",
          state: item.state || "",
          inventoryId: item.inventoryId || "",
          composition
        };
      })
      .sort((left, right) => `${left.admittedAt}|${left.code}`.localeCompare(`${right.admittedAt}|${right.code}`));

    const byBlock = new Map();
    const summary = new Map();
    records.forEach(record => {
      record.composition.forEach((part, index) => {
        const detail = {
          admittedAt: record.admittedAt,
          code: record.code,
          type: record.type,
          component: index + 1,
          block: part.block,
          supplier: part.supplier,
          variety: record.variety,
          length: record.length,
          bunchStems: record.stems,
          contributedStems: part.stems,
          buncher: record.buncher
        };
        if (!byBlock.has(part.block)) byBlock.set(part.block, []);
        byBlock.get(part.block).push(detail);
        const key = `${part.block}|${part.supplier}`;
        const current = summary.get(key) || { block: part.block, supplier: part.supplier, normalBunches: 0, mixedParticipations: 0, normalStems: 0, mixedStems: 0, totalStems: 0 };
        if (record.type === "MIXTA") {
          current.mixedParticipations += 1;
          current.mixedStems += part.stems;
        } else {
          current.normalBunches += 1;
          current.normalStems += part.stems;
        }
        current.totalStems += part.stems;
        summary.set(key, current);
      });
    });

    const report = {
      from,
      to,
      validationError: from && to && from > to ? "La fecha inicial no puede ser posterior a la fecha final." : "",
      ...reportPeriod(from, to),
      records,
      summary: [...summary.values()].sort((left, right) => `${left.block}|${left.supplier}`.localeCompare(`${right.block}|${right.supplier}`)),
      byBlock
    };
    report.contentValidation = validateReportContent(report);
    return report;
  }

  function validateReportContent(report) {
    const errors = [];
    const warnings = [];
    const codes = new Set();
    let recordStems = 0;

    (report.records || []).forEach((record, index) => {
      const row = index + 6;
      const code = String(record.code || "").trim();
      const stems = Number(record.stems || 0);
      const contributedStems = (record.composition || []).reduce((sum, part) => sum + Number(part.stems || 0), 0);
      if (!code) errors.push(`Fila ${row}: falta el codigo de etiqueta.`);
      if (code && codes.has(code)) errors.push(`Fila ${row}: el codigo ${code} esta duplicado.`);
      if (code) codes.add(code);
      if (!String(record.admittedAt || "").trim()) errors.push(`Fila ${row}: falta la fecha y hora de escaneo.`);
      if (!String(record.variety || "").trim()) errors.push(`Fila ${row}: falta la variedad.`);
      if (!Number.isFinite(stems) || stems <= 0) errors.push(`Fila ${row}: el total de tallos del bonche no es valido.`);
      if (contributedStems !== stems) {
        errors.push(`Fila ${row}: los tallos aportados (${contributedStems}) no cuadran con los tallos del bonche (${stems}).`);
      }
      if (record.type === "MIXTA" && !(record.composition || []).length) {
        errors.push(`Fila ${row}: el ramo mixto ${code || "sin codigo"} no tiene composicion confirmada.`);
      }
      recordStems += stems;
    });

    const summaryStems = (report.summary || []).reduce((sum, item) => sum + Number(item.totalStems || 0), 0);
    const blockStems = [...(report.byBlock || new Map()).values()]
      .flat()
      .reduce((sum, item) => sum + Number(item.contributedStems || 0), 0);
    if (summaryStems !== recordStems) errors.push(`El resumen de proveedores (${summaryStems}) no cuadra con los ramos escaneados (${recordStems}).`);
    if (blockStems !== recordStems) errors.push(`Las hojas por bloque (${blockStems}) no cuadran con los ramos escaneados (${recordStems}).`);
    if (!(report.records || []).length) warnings.push("No existen ramos escaneados dentro del rango seleccionado.");

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      totals: {
        scannedBunches: (report.records || []).length,
        uniqueCodes: codes.size,
        recordStems,
        summaryStems,
        blockStems,
        blocks: (report.byBlock || new Map()).size
      }
    };
  }

  function buildSheets(report) {
    const sheets = [
      {
        name: "Ramos escaneados",
        title: "REPORTE BLESS FLOWER - RAMOS ESCANEADOS",
        widths: [23, 18, 18, 24, 25, 24, 14, 15, 23, 18, 22],
        headers: ["Fecha y hora de escaneo", "Codigo etiqueta", "Tipo composicion", "Proveedor impreso", "Bloques origen", "Variedad", "Longitud (cm)", "Tallos bonche", "Embonchador", "Estado", "ID inventario"],
        rows: report.records.map(item => [excelDateTime(item.admittedAt), excelText(item.code), item.type, item.printedSupplier, item.blocks, item.variety, item.length, item.stems, item.buncher, item.state, item.inventoryId])
      },
      {
        name: "Resumen proveedores",
        title: "REPORTE BLESS FLOWER - RESUMEN PROVEEDORES",
        widths: [18, 28, 18, 22, 18, 19, 18],
        headers: ["Bloque", "Proveedor", "Bonches normales", "Participaciones mixtas", "Tallos normales", "Tallos mixtos", "Total tallos"],
        rows: report.summary.map(item => [item.block, item.supplier, item.normalBunches, item.mixedParticipations, item.normalStems, item.mixedStems, item.totalStems]),
        totals: ["TOTAL", "", report.summary.reduce((sum, item) => sum + item.normalBunches, 0), report.summary.reduce((sum, item) => sum + item.mixedParticipations, 0), report.summary.reduce((sum, item) => sum + item.normalStems, 0), report.summary.reduce((sum, item) => sum + item.mixedStems, 0), report.summary.reduce((sum, item) => sum + item.totalStems, 0)]
      }
    ];
    [...report.byBlock.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([block, rows]) => {
      const blockTitle = /^BLOQUE\b/i.test(block) ? block : `BLOQUE ${block}`;
      sheets.push({
        name: block,
        title: `REPORTE BLESS FLOWER - ${blockTitle}`,
        widths: [23, 18, 16, 14, 18, 28, 24, 14, 18, 18, 24],
        headers: ["Fecha y hora", "Codigo etiqueta", "Composicion", "Componente", "Bloque", "Proveedor real", "Variedad", "Longitud (cm)", "Tallos bonche", "Tallos aportados", "Embonchador"],
        rows: rows.map(item => [excelDateTime(item.admittedAt), excelText(item.code), item.type, item.component, item.block, item.supplier, item.variety, item.length, item.bunchStems, item.contributedStems, item.buncher]),
        totals: ["TOTAL", "", "", "", block, "", "", "", "", rows.reduce((sum, item) => sum + item.contributedStems, 0), ""]
      });
    });
    return sheets;
  }

  function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function uniqueSheetNames(sheets) {
    const used = new Set();
    return sheets.map(sheet => {
      const base = String(sheet.name || "Hoja").replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Hoja";
      let name = base;
      let suffix = 2;
      while (used.has(name.toUpperCase())) {
        const tail = `-${suffix++}`;
        name = `${base.slice(0, 31 - tail.length)}${tail}`;
      }
      used.add(name.toUpperCase());
      return { ...sheet, name };
    });
  }

  function cellXml(reference, value, style = 4) {
    if (value?.xlsxType === "dateTime" && Number.isFinite(value.value)) return `<c r="${reference}" s="6" t="n"><v>${value.value}</v></c>`;
    if (value?.xlsxType === "text") return `<c r="${reference}" s="7" t="inlineStr"><is><t xml:space="preserve">${xml(value.value)}</t></is></c>`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${style}" t="n"><v>${value}</v></c>`;
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function worksheetXml(sheet, report) {
    const lastColumn = columnName(sheet.headers.length - 1);
    const header = sheet.headers.map((value, index) => cellXml(`${columnName(index)}5`, value, 3)).join("");
    const rows = sheet.rows.map((row, rowIndex) => {
      const excelRow = rowIndex + 6;
      return `<row r="${excelRow}">${row.map((value, colIndex) => cellXml(`${columnName(colIndex)}${excelRow}`, value, 4)).join("")}</row>`;
    }).join("");
    const totalRowNumber = sheet.totals ? sheet.rows.length + 6 : 0;
    const totals = sheet.totals ? `<row r="${totalRowNumber}">${sheet.totals.map((value, index) => cellXml(`${columnName(index)}${totalRowNumber}`, value, 5)).join("")}</row>` : "";
    const filterEndRow = Math.max(5, sheet.rows.length + 5);
    const endRow = Math.max(filterEndRow, totalRowNumber);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <dimension ref="A1:${lastColumn}${endRow}"/>
        <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
        <sheetFormatPr defaultRowHeight="17"/>
        <cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
        <sheetData>
          <row r="1" ht="30" customHeight="1">${cellXml("C1", sheet.title, 1)}</row>
          <row r="2" ht="22" customHeight="1">${cellXml("C2", report.period, 2)}</row>
          <row r="3" ht="22" customHeight="1">${cellXml("C3", report.range, 2)}</row>
          <row r="4" ht="8" customHeight="1"/>
          <row r="5" ht="28" customHeight="1">${header}</row>
          ${rows}${totals}
        </sheetData>
        <autoFilter ref="A5:${lastColumn}${filterEndRow}"/>
        <mergeCells count="3"><mergeCell ref="C1:${lastColumn}1"/><mergeCell ref="C2:${lastColumn}2"/><mergeCell ref="C3:${lastColumn}3"/></mergeCells>
        <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/>
        <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
        <drawing r:id="rId1"/>
      </worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
        <fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF14532D"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font></fonts>
        <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills>
        <borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
        <cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs>
        <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
      </styleSheet>`;
  }

  function drawingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>80000</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>50000</xdr:rowOff></xdr:from><xdr:ext cx="1700000" cy="450000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo BLESS FLOWER"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1700000" cy="450000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
  }

  function logoPngBytes() {
    if (typeof document === "undefined") return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), char => char.charCodeAt(0));
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#16803a";
    context.lineWidth = 9;
    context.beginPath(); context.moveTo(75, 135); context.quadraticCurveTo(72, 85, 92, 40); context.stroke();
    context.fillStyle = "#22a447";
    context.beginPath(); context.ellipse(59, 91, 24, 11, -.55, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(101, 79, 23, 10, .55, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ec4f87";
    [[92,34],[74,43],[107,48],[84,58],[101,62]].forEach(([x,y]) => { context.beginPath(); context.arc(x, y, 18, 0, Math.PI * 2); context.fill(); });
    context.fillStyle = "#f7c948"; context.beginPath(); context.arc(91, 49, 10, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#14532d"; context.font = "bold 54px Arial"; context.fillText("BLESS FLOWER", 145, 76);
    context.fillStyle = "#64748b"; context.font = "bold 25px Arial"; context.fillText("CALIDAD QUE FLORECE", 148, 116);
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  }

  function zipArchive(files) {
    const encoder = new TextEncoder();
    const crcTable = Array.from({ length: 256 }, (_, number) => { let current = number; for (let bit = 0; bit < 8; bit++) current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1); return current >>> 0; });
    const crc32 = bytes => { let value = 0xffffffff; bytes.forEach(byte => { value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); }); return (value ^ 0xffffffff) >>> 0; };
    const u16 = value => new Uint8Array([value & 255, (value >>> 8) & 255]);
    const u32 = value => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
    const concat = arrays => { const output = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0)); let offset = 0; arrays.forEach(item => { output.set(item, offset); offset += item.length; }); return output; };
    const localFiles = [];
    const directoryEntries = [];
    let offset = 0;
    Object.entries(files).forEach(([name, source]) => {
      const nameBytes = encoder.encode(name);
      const data = source instanceof Uint8Array ? source : encoder.encode(source);
      const crc = crc32(data);
      const local = concat([new Uint8Array([80,75,3,4]),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),nameBytes,data]);
      localFiles.push(local);
      directoryEntries.push(concat([new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBytes]));
      offset += local.length;
    });
    const directory = concat(directoryEntries);
    const count = directoryEntries.length;
    const end = concat([new Uint8Array([80,75,5,6]),u16(0),u16(0),u16(count),u16(count),u32(directory.length),u32(offset),u16(0)]);
    return concat([...localFiles, directory, end]);
  }

  function buildWorkbookArchive(rawSheets, report, logoBytes = logoPngBytes()) {
    const sheets = uniqueSheetNames(rawSheets);
    const worksheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const drawingOverrides = sheets.map((_, index) => `<Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join("");
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheetOverrides}${drawingOverrides}</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": stylesXml(),
      "xl/media/bless-flower-logo.png": logoBytes
    };
    sheets.forEach((sheet, index) => {
      const number = index + 1;
      files[`xl/worksheets/sheet${number}.xml`] = worksheetXml(sheet, report);
      files[`xl/worksheets/_rels/sheet${number}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${number}.xml"/></Relationships>`;
      files[`xl/drawings/drawing${number}.xml`] = drawingXml();
      files[`xl/drawings/_rels/drawing${number}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bless-flower-logo.png"/></Relationships>`;
    });
    return zipArchive(files);
  }

  function exportBunchReportXlsx(appState, filters = {}) {
    const report = getReportData(appState, filters);
    if (report.validationError) return { ok: false, message: report.validationError, report };
    if (!report.records.length) return { ok: false, message: "No existen ramos escaneados dentro del rango seleccionado.", report };
    if (!report.contentValidation.ok) {
      return { ok: false, message: `El contenido del reporte no cuadra: ${report.contentValidation.errors.join(" ")}`, report };
    }
    const archive = buildWorkbookArchive(buildSheets(report), report);
    const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reporte-ramos-${report.from || "inicio"}-${report.to || "fin"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    return { ok: true, report, sheets: 2 + report.byBlock.size, fileName: link.download };
  }

  BlessERP.operacionesRamosReportXlsx = { getReportData, validateReportContent, buildSheets, buildWorkbookArchive, exportBunchReportXlsx, reportPeriod };
})();
