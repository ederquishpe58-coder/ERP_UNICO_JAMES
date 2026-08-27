import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = process.cwd();
const sandbox = {
  Blob,
  URL,
  console,
  document: {},
  navigator: {},
  setTimeout,
  Uint8Array,
  window: {}
};
sandbox.window.window = sandbox.window;
sandbox.window.BlessERP = {};
vm.createContext(sandbox);

for (const relativePath of [
  "scripts/shared/code128.js",
  "scripts/services/label-pdf.js"
]) {
  const source = readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, sandbox, { filename: relativePath });
}

const labelPdf = sandbox.window.BlessERP.labelPdf;
assert.ok(labelPdf, "El servicio BlessERP.labelPdf debe quedar registrado.");
assert.deepEqual(
  JSON.parse(JSON.stringify(labelPdf.BOX_PAGE_MM)),
  { width: 100, height: 160 },
  "La etiqueta de caja debe conservar el formato vertical 100 x 160 mm."
);
assert.deepEqual(
  JSON.parse(JSON.stringify(labelPdf.BUNCH_PAGE_MM)),
  { width: 76.2, height: 58 },
  "La etiqueta de ramo debe usar la medida fisica horizontal 76,2 x 58 mm."
);
assert.equal(labelPdf.BUNCH_BOTTOM_CLEARANCE_MM, 20, "La etiqueta de ramo debe dejar 20 mm libres en la parte inferior.");
assert.equal(labelPdf.BUNCH_CONTENT_SCALE, 0.8, "El contenido general de la etiqueta debe imprimirse al 80 %.");
assert.equal(labelPdf.BUNCH_BARCODE_SCALE, 0.9, "El codigo de barras debe reducirse ligeramente de forma adicional.");

const bunchBytes = labelPdf.buildBunchPdfBytes([
  {
    block: "B-01",
    buncher: "OPERARIO UNO",
    code: "0000001234",
    labelType: "NORMAL",
    length: 50,
    printHeightMm: 58,
    printWidthMm: 23,
    stemsPerBunch: 25,
    variety: "FREEDOM"
  },
  {
    block: "B-02",
    buncher: "OPERARIO DOS",
    code: "0000001235",
    labelType: "MIXTA",
    length: 60,
    printHeightMm: 23,
    printWidthMm: 58,
    stemsPerBunch: 25,
    variety: "MONDIAL"
  },
  {
    block: "B4",
    code: "BF|MON|60|RJ|P001:B4:25|T25|UABC123",
    colorDay: "ROJO",
    componentCount: 1,
    labelType: "NORMAL",
    length: 60,
    provider: "P001",
    stemsPerBunch: 25,
    type: "INDIVIDUAL",
    variety: "MONDIAL"
  }
]);
if (process.env.LABEL_BUNCH_PDF_QA_OUTPUT) {
  writeFileSync(path.resolve(process.env.LABEL_BUNCH_PDF_QA_OUTPUT), bunchBytes);
}

sandbox.window.BlessERP.comercialLabelsUtils = {
  buildDocumentData() {
    return {
      selectedRows: [{
        agencia_carga: "AGENCIA PRUEBA",
        awb: "123-12345678",
        contenido_lineas: [
          { bunches: 5, length: 50, totalStems: 125, variety: "FREEDOM" },
          { bunches: 4, length: 60, totalStems: 100, variety: "MONDIAL" }
        ],
        cuarto_frio: "CUARTO 1",
        dae: "0282026072512345678901234567890123456789012345678",
        dae_barcode: "0282026072512345678901234567890123456789012345678",
        destino: "MIAMI",
        hawb: "HAWB1234567",
        invoice_no: "001-003-000000675",
        marca: "CLIENTE PRUEBA",
        numero_caja: 1,
        packing_list_no: "PL-000001",
        pais: "ESTADOS UNIDOS",
        pedido_numero: "PED-000001",
        po: "PO-001",
        total_cajas: 1,
        total_ramos: 9,
        total_tallos: 225
      }]
    };
  }
};
sandbox.window.BlessERP.services = {
  companyBranding: {
    resolveForOrder() {
      return {
        commercialName: "BLESS FLOWER",
        legalName: "MANUEL CLEMENTE LANCHIMBA TUTILLO",
        ruc: "1717637084001"
      };
    }
  }
};

const boxBytes = labelPdf.buildBoxPdfBytes([{ id: "order-1", number: "PED-000001" }], {}, {});
const boxPdfSource = Buffer.from(boxBytes).toString("latin1");
assert.match(
  boxPdfSource,
  /\(ADUANA\).*?\(DEL\).*?\(ECUADOR\)/s,
  "La etiqueta PDF debe incluir el logotipo ADUANA DEL ECUADOR encima del codigo de barras."
);
assert.match(boxPdfSource, /\(BOX #: 1\)/, "La etiqueta debe mostrar el numero individual de caja.");
assert.doesNotMatch(boxPdfSource, /\(BOX #: 1 \/ 1\)/, "La etiqueta no debe imprimir el total como 1/1.");
assert.match(boxPdfSource, /\(INVOICE: 001-003-000000675\)/, "La etiqueta debe mostrar INVOICE y el numero de factura.");
assert.doesNotMatch(boxPdfSource, /PACKING LIST/, "La etiqueta ya no debe mostrar ni exigir Packing List.");
if (process.env.LABEL_PDF_QA_OUTPUT) {
  writeFileSync(path.resolve(process.env.LABEL_PDF_QA_OUTPUT), boxBytes);
}

function resolvePdfInfo() {
  const where = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pdfinfo"], {
    encoding: "utf8"
  });
  const detected = String(where.stdout || "").split(/\r?\n/).find(Boolean);
  if (!detected) return null;
  if (!detected.toLowerCase().endsWith(".cmd")) return detected;
  const nativeCandidate = path.resolve(
    path.dirname(detected),
    "..",
    "..",
    "native",
    "poppler",
    "Library",
    "bin",
    "pdfinfo.exe"
  );
  return existsSync(nativeCandidate) ? nativeCandidate : null;
}

function mediaBoxes(bytes) {
  const source = Buffer.from(bytes).toString("latin1");
  return [...source.matchAll(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/g)]
    .map(match => ({ width: Number(match[1]), height: Number(match[2]) }));
}

function assertPageSize(actual, widthMm, heightMm, label) {
  const expectedWidth = labelPdf.mmToPt(widthMm);
  const expectedHeight = labelPdf.mmToPt(heightMm);
  assert.ok(Math.abs(actual.width - expectedWidth) < 0.01, `${label}: ancho PDF incorrecto.`);
  assert.ok(Math.abs(actual.height - expectedHeight) < 0.01, `${label}: alto PDF incorrecto.`);
}

const bunchPages = mediaBoxes(bunchBytes);
const boxPages = mediaBoxes(boxBytes);
assert.equal(bunchPages.length, 3, "El PDF de ramos debe tener una pagina por etiqueta.");
assert.equal(boxPages.length, 1, "El PDF de caja debe tener una pagina por caja.");
bunchPages.forEach((page, index) => assertPageSize(page, 76.2, 58, `Ramo ${index + 1}`));
assertPageSize(boxPages[0], 100, 160, "Caja");

const tempRoot = mkdtempSync(path.join(tmpdir(), "bless-label-pdf-"));
try {
  const bunchPath = path.join(tempRoot, "ramo.pdf");
  const boxPath = path.join(tempRoot, "caja.pdf");
  writeFileSync(bunchPath, bunchBytes);
  writeFileSync(boxPath, boxBytes);

  const pdfInfo = resolvePdfInfo();
  assert.ok(pdfInfo, "No se encontro un lector PDF para la validacion.");
  for (const [label, pdfPath, expectedPages] of [
    ["Ramo", bunchPath, 3],
    ["Caja", boxPath, 1]
  ]) {
    const result = spawnSync(pdfInfo, [pdfPath], { encoding: "utf8" });
    assert.equal(result.status, 0, `${label}: Adobe/Poppler no pudo leer el PDF.\n${result.stderr || ""}`);
    const pages = Number(result.stdout.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    assert.equal(pages, expectedPages, `${label}: cantidad de paginas no reconocida.`);
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("VALIDACION_ETIQUETAS_PDF_ADOBE_OK");
console.log(`Ramo horizontal nuevo: 76.2 x 58 mm, ${bunchPages.length} paginas`);
console.log(`Caja vertical: 100 x 160 mm, ${boxPages.length} pagina`);
