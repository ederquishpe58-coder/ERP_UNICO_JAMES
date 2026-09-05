(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { today } = BlessERP.utils;

  const TEMPLATE_HEADERS = Object.freeze([
    "FECHA",
    "DETALLE",
    "CREDITO",
    "DEBITO",
    "CODIGO_UNICO",
    "REFERENCIA",
    "TIPO_MOVIMIENTO",
    "OBSERVACION",
    "SALDO"
  ]);

  const HEADER_ALIASES = Object.freeze({
    FECHA: ["FECHA", "DATE", "MOVEMENT_DATE", "FECHA_MOVIMIENTO"],
    DETALLE: ["DETALLE", "DESCRIPCION", "CONCEPTO", "DESCRIPTION"],
    CREDITO: ["CREDITO", "CREDIT", "INGRESO", "DEPOSITO"],
    DEBITO: ["DEBITO", "DEBIT", "EGRESO", "RETIRO"],
    CODIGO_UNICO: ["CODIGO_UNICO", "CODIGO", "ID_MOVIMIENTO", "UNIQUE_CODE"],
    REFERENCIA: ["REFERENCIA", "REFERENCE", "NUMERO_DOCUMENTO", "DOCUMENTO"],
    TIPO_MOVIMIENTO: ["TIPO_MOVIMIENTO", "TIPO", "MOVEMENT_TYPE"],
    OBSERVACION: ["OBSERVACION", "NOTA", "NOTAS", "OBSERVATION"],
    SALDO: ["SALDO", "BALANCE", "SALDO_DISPONIBLE"]
  });

  function normalizeHeader(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function headerKey(value) {
    const normalized = normalizeHeader(value);
    return Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || "";
  }

  function numberValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(/\$/g, "")
      .replace(/,/g, "");
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function excelSerialToDate(value) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < 1) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
    return date.toISOString().slice(0, 10);
  }

  function normalizeDate(value) {
    if (typeof value === "number" || /^\d{5}(?:\.\d+)?$/.test(String(value || "").trim())) {
      return excelSerialToDate(value);
    }
    const text = String(value || "").trim();
    let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
    return "";
  }

  function tabularRowsToMovements(table, options = {}) {
    const rows = Array.isArray(table) ? table : [];
    if (!rows.length) return { movements: [], errors: ["El archivo no contiene filas."] };
    const headerIndex = rows.findIndex(row => (row || []).some(cell => headerKey(cell)));
    if (headerIndex < 0) return { movements: [], errors: ["No se encontró la fila de encabezados de la plantilla."] };
    const headerMap = {};
    (rows[headerIndex] || []).forEach((header, index) => {
      const key = headerKey(header);
      if (key && headerMap[key] === undefined) headerMap[key] = index;
    });
    const missing = ["FECHA", "DETALLE", "CREDITO", "DEBITO", "CODIGO_UNICO"]
      .filter(key => headerMap[key] === undefined);
    if (missing.length) {
      return { movements: [], errors: [`Faltan columnas obligatorias: ${missing.join(", ")}.`] };
    }

    const movements = [];
    const errors = [];
    const seenCodes = new Set();
    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const rowNumber = headerIndex + offset + 2;
      const values = row || [];
      const raw = key => values[headerMap[key]] ?? "";
      const hasContent = values.some(value => String(value ?? "").trim() !== "");
      if (!hasContent) return;
      const date = normalizeDate(raw("FECHA"));
      const description = String(raw("DETALLE") || "").trim();
      const incomeValue = numberValue(raw("CREDITO"));
      const expenseValue = numberValue(raw("DEBITO"));
      const externalUniqueCode = String(raw("CODIGO_UNICO") || "").trim();
      const reference = String(raw("REFERENCIA") || externalUniqueCode).trim();
      const transactionType = String(raw("TIPO_MOVIMIENTO") || "").trim();
      const observation = String(raw("OBSERVACION") || "").trim();
      const reportedBalance = numberValue(raw("SALDO"));
      const rowErrors = [];
      if (!date) rowErrors.push("fecha inválida");
      if (!description) rowErrors.push("detalle vacío");
      if (!externalUniqueCode) rowErrors.push("código único vacío");
      if (!Number.isFinite(incomeValue) || !Number.isFinite(expenseValue)) rowErrors.push("crédito o débito no numérico");
      if (Number(incomeValue || 0) > 0 && Number(expenseValue || 0) > 0) rowErrors.push("no puede tener crédito y débito simultáneamente");
      if (Number(incomeValue || 0) <= 0 && Number(expenseValue || 0) <= 0) rowErrors.push("debe tener un crédito o débito mayor que cero");
      if (externalUniqueCode && seenCodes.has(externalUniqueCode.toUpperCase())) rowErrors.push("código único repetido dentro del archivo");
      if (rowErrors.length) {
        errors.push(`Fila ${rowNumber}: ${rowErrors.join("; ")}.`);
        return;
      }
      seenCodes.add(externalUniqueCode.toUpperCase());
      movements.push({
        bankAccountId: String(options.bankAccountId || ""),
        movementDate: date,
        reference,
        description,
        incomeValue: Number(incomeValue || 0),
        expenseValue: Number(expenseValue || 0),
        externalUniqueCode,
        transactionType,
        observation,
        reportedBalance: Number.isFinite(reportedBalance) ? Number(reportedBalance || 0) : 0,
        source: "XLSX_IMPORT",
        sourceFile: String(options.fileName || ""),
        importedAt: new Date().toISOString(),
        importRowNumber: rowNumber
      });
    });
    if (!movements.length && !errors.length) errors.push("La hoja no contiene movimientos para importar.");
    return { movements, errors, headerMap, headerRowNumber: headerIndex + 1 };
  }

  function columnIndex(reference) {
    const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
    return [...letters].reduce((value, letter) => (value * 26) + letter.charCodeAt(0) - 64, 0) - 1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Este navegador no permite descomprimir archivos XLSX. Use Edge o Chrome actualizado.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
      if (view.getUint32(index, true) === 0x06054b50) {
        eocd = index;
        break;
      }
    }
    if (eocd < 0) throw new Error("El archivo no es un XLSX válido.");
    const totalEntries = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder("utf-8");
    const entries = new Map();
    for (let index = 0; index < totalEntries; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("La estructura interna del XLSX está incompleta.");
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const fileNameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength)).replace(/\\/g, "/");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      let content;
      if (method === 0) content = compressed;
      else if (method === 8) content = await inflateRaw(compressed);
      else throw new Error(`El XLSX usa un método de compresión no compatible (${method}).`);
      entries.set(name.replace(/^\//, ""), content);
      cursor += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  function xmlDocument(bytes) {
    const text = new TextDecoder("utf-8").decode(bytes || new Uint8Array());
    const documentXml = new DOMParser().parseFromString(text, "application/xml");
    if (documentXml.querySelector("parsererror")) throw new Error("No se pudo leer una de las hojas del XLSX.");
    return documentXml;
  }

  function sharedStrings(entries) {
    const bytes = entries.get("xl/sharedStrings.xml");
    if (!bytes) return [];
    const documentXml = xmlDocument(bytes);
    return [...documentXml.getElementsByTagName("si")].map(item => (
      [...item.getElementsByTagName("t")].map(node => node.textContent || "").join("")
    ));
  }

  function firstWorksheetPath(entries) {
    const workbookBytes = entries.get("xl/workbook.xml");
    const relationshipsBytes = entries.get("xl/_rels/workbook.xml.rels");
    if (!workbookBytes || !relationshipsBytes) return "xl/worksheets/sheet1.xml";
    const workbook = xmlDocument(workbookBytes);
    const relationships = xmlDocument(relationshipsBytes);
    const firstSheet = workbook.getElementsByTagName("sheet")[0];
    const relationshipId = firstSheet?.getAttribute("r:id")
      || firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relationship = [...relationships.getElementsByTagName("Relationship")]
      .find(item => item.getAttribute("Id") === relationshipId);
    const target = String(relationship?.getAttribute("Target") || "worksheets/sheet1.xml").replace(/^\/+/, "");
    return target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
  }

  function worksheetTable(entries) {
    const path = firstWorksheetPath(entries);
    const bytes = entries.get(path) || entries.get("xl/worksheets/sheet1.xml");
    if (!bytes) throw new Error("El XLSX no contiene una hoja de movimientos.");
    const strings = sharedStrings(entries);
    const worksheet = xmlDocument(bytes);
    return [...worksheet.getElementsByTagName("row")].map(row => {
      const values = [];
      [...row.getElementsByTagName("c")].forEach(cell => {
        const index = columnIndex(cell.getAttribute("r"));
        const type = cell.getAttribute("t");
        const inline = cell.getElementsByTagName("is")[0];
        const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        let value = raw;
        if (type === "s") value = strings[Number(raw)] ?? "";
        else if (type === "inlineStr") value = [...(inline?.getElementsByTagName("t") || [])].map(node => node.textContent || "").join("");
        else if (type === "b") value = raw === "1";
        else if (raw !== "" && Number.isFinite(Number(raw))) value = Number(raw);
        values[index] = value;
      });
      return values;
    });
  }

  async function parseXlsx(file, options = {}) {
    if (!file) return { movements: [], errors: ["Debe seleccionar un archivo XLSX."] };
    if (!/\.xlsx$/i.test(file.name || "")) return { movements: [], errors: ["El archivo debe estar en formato .xlsx."] };
    try {
      const entries = await zipEntries(await file.arrayBuffer());
      return tabularRowsToMovements(worksheetTable(entries), {
        ...options,
        fileName: file.name
      });
    } catch (error) {
      return { movements: [], errors: [error.message || "No se pudo leer el archivo XLSX."] };
    }
  }

  async function readWorkbookTable(file) {
    if (!file) throw new Error("Debe seleccionar un archivo XLSX.");
    if (!/\.xlsx$/i.test(file.name || "")) throw new Error("El archivo debe estar en formato .xlsx.");
    const entries = await zipEntries(await file.arrayBuffer());
    return worksheetTable(entries);
  }

  function templateSheets() {
    return [
      {
        name: "MOVIMIENTOS",
        title: "PLANTILLA DE ESTADO DE CUENTA BANCARIO",
        widths: [16, 48, 16, 16, 24, 24, 24, 38, 18],
        headers: [...TEMPLATE_HEADERS],
        rows: Array.from({ length: 250 }, () => Array(TEMPLATE_HEADERS.length).fill(""))
      },
      {
        name: "EJEMPLO",
        title: "EJEMPLOS - NO IMPORTAR ESTA HOJA",
        widths: [16, 48, 16, 16, 24, 24, 24, 38, 18],
        headers: [...TEMPLATE_HEADERS],
        rows: [
          ["2026-07-01", "TRANSFERENCIA RECIBIDA CLIENTE", 1250.50, 0, "BANCO-000001", "TRX-45821", "TRANSFERENCIA", "Cobro de factura", 6250.50],
          ["2026-07-02", "COMISION SERVICIO BANCARIO", 0, 4.35, "BANCO-000002", "COM-77810", "COMISION", "Cargo bancario", 6246.15]
        ]
      },
      {
        name: "INSTRUCCIONES",
        title: "INSTRUCCIONES DE IMPORTACION",
        widths: [25, 85],
        headers: ["CAMPO", "REGLA"],
        rows: [
          ["FECHA", "Obligatoria. Use AAAA-MM-DD o DD/MM/AAAA."],
          ["DETALLE", "Obligatorio. Descripcion visible del movimiento bancario."],
          ["CREDITO", "Ingreso de dinero. Use numeros, sin simbolo de moneda."],
          ["DEBITO", "Salida de dinero. Use numeros, sin simbolo de moneda."],
          ["CODIGO_UNICO", "Obligatorio. Codigo irrepetible entregado por el banco; evita duplicados."],
          ["REFERENCIA", "Opcional. Numero de transferencia, cheque, deposito u otro documento."],
          ["TIPO_MOVIMIENTO", "Opcional. Ej.: TRANSFERENCIA, DEPOSITO, CHEQUE, COMISION, IMPUESTO."],
          ["OBSERVACION", "Opcional. Nota interna para facilitar la conciliacion."],
          ["SALDO", "Opcional e informativo. Saldo mostrado por el banco despues del movimiento."],
          ["IMPORTANTE", "Cada fila debe tener credito o debito, nunca ambos. La cuenta bancaria se selecciona en JAEDER SYSTEMS antes de importar."]
        ]
      }
    ];
  }

  function downloadArchive(archive, fileName) {
    const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  }

  async function generateTemplate(options = {}) {
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) {
      return { ok: false, errors: ["El generador XLSX compartido no está disponible."] };
    }
    const logoBytes = options.logoBytes
      || await BlessERP.reportFinancialXlsx?.companyLogoBytes?.().catch(() => undefined);
    const archive = workbookApi.buildWorkbookArchive(templateSheets(), {
      period: "PLANTILLA",
      range: "FORMATO PARA IMPORTAR ESTADOS DE CUENTA",
      from: "",
      to: today()
    }, logoBytes);
    const fileName = "plantilla-importacion-estado-cuenta.xlsx";
    if (options.download !== false) downloadArchive(archive, fileName);
    return { ok: true, archive, fileName, headers: [...TEMPLATE_HEADERS] };
  }

  async function importFile(file, options = {}) {
    const parsed = await parseXlsx(file, options);
    if (parsed.errors.length) return { ok: false, ...parsed };
    const reconciliationService = BlessERP.services?.bankReconciliation;
    if (!reconciliationService?.saveStatementMovementsBatch) {
      return { ok: false, movements: [], errors: ["El servicio de conciliación bancaria no admite importación masiva."] };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = globalThis.crypto?.subtle
      ? new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))
      : bytes.slice(0, 32);
    const fileFingerprint = [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
    return reconciliationService.saveStatementMovementsBatch(parsed.movements, {
      sourceFile: file.name || "",
      bankAccountId: options.bankAccountId || "",
      fileFingerprint
    });
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.bankStatementXlsx = {
    TEMPLATE_HEADERS,
    normalizeHeader,
    normalizeDate,
    tabularRowsToMovements,
    readWorkbookTable,
    parseXlsx,
    templateSheets,
    generateTemplate,
    importFile
  };
})();
