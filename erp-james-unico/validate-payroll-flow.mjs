import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(ROOT, "output");
const REPORT_JSON = path.join(OUTPUT_DIR, "payroll-validation-20-cases.json");
const REPORT_MD = path.join(OUTPUT_DIR, "payroll-validation-20-cases.md");
const PRINT_SAMPLE_HTML = path.join(OUTPUT_DIR, "payroll-print-sample.html");

const RUNTIME_SCRIPTS = [
  "scripts/core/utils.js",
  "scripts/core/accounting-rules.js",
  "scripts/data/demo.js",
  "scripts/modules/payroll/payroll-data.js",
  "scripts/modules/payroll/payroll-rules.js",
  "scripts/services/company-settings.js",
  "scripts/services/chart-of-accounts.js",
  "scripts/services/admin-config.js",
  "scripts/modules/payroll/payroll-service.js",
  "scripts/services/journal.js",
  "scripts/services/banks.js",
  "scripts/modules/comercial/invoice-sequence-core.js",
  "scripts/modules/comercial/comercial-data.js",
  "scripts/modules/comercial/comercial-utils.js",
  "scripts/modules/comercial/comercial-workflow.js",
  "scripts/modules/comercial/comercial-state.js",
  "scripts/modules/operaciones/operaciones-data.js",
  "scripts/modules/operaciones/operaciones-utils.js",
  "scripts/modules/operaciones/workday-core.js",
  "scripts/modules/operaciones/operaciones-state.js",
  "scripts/modules/comercial/order-fulfillment-demo.js",
  "scripts/modules/operaciones/despacho-service-demo.js",
  "scripts/modules/payroll/payroll-commissions.js",
  "scripts/modules/payroll/payroll-engine.js",
  "scripts/modules/payroll/payroll-accounting.js",
  "scripts/modules/payroll/payroll-payments.js",
  "scripts/modules/payroll/payroll-print.js"
];

const CLASSIFIERS = [
  { name: "Rocio T.", employeeId: "EMP-BLF-OPS-001" },
  { name: "Daniela C.", employeeId: "EMP-BLF-OPS-002" },
  { name: "Camila V.", employeeId: "EMP-BLF-OPS-003" }
];

const BUNCHERS = [
  { name: "Pedro M.", employeeId: "EMP-BLF-OPS-004" },
  { name: "Eder Q.", employeeId: "EMP-BLF-OPS-005" },
  { name: "Mateo G.", employeeId: "EMP-BLF-OPS-006" }
];

const SELLERS = [
  { name: "James Lanchimba", sellerId: "SELL-BLF-001", employeeId: "EMP-BLF-VEN-001" },
  { name: "Vendedor Exportaciones", sellerId: "SELL-BLF-002", employeeId: "EMP-BLF-VEN-002" }
];

const FLOW_VARIANTS = [
  { supplier: "FINCA CANGAHUA", block: "BQ-01", variety: "EXPLORER", length: 50 },
  { supplier: "BLOSSOM HILLS", block: "BQ-02", variety: "MONDIAL", length: 60 },
  { supplier: "SANTA ROSA FARMS", block: "BLOQUE A", variety: "PLAYA BLANCA", length: 50 },
  { supplier: "FINCA CANGAHUA", block: "BQ-01", variety: "PINK MONDIAL", length: 40 },
  { supplier: "BLOSSOM HILLS", block: "BQ-02", variety: "NINA", length: 60 }
];

const COMMISSION_VARIANTS = [
  { mode: "PERCENT_SALES", basis: "GENERATED", percentage: 2 },
  { mode: "PERCENT_COLLECTED", basis: "COLLECTED", percentage: 1.5 },
  { mode: "FIXED_SALE", basis: "SHIPPED", fixedPerSale: 4.25 },
  { mode: "FIXED_INVOICE", basis: "INVOICED", fixedPerInvoice: 5.5 },
  { mode: "PER_BOX", basis: "SHIPPED", ratePerBox: 3.25 },
  { mode: "PER_STEM", basis: "SHIPPED", ratePerStem: 0.012 },
  {
    mode: "MIXED",
    basis: "INVOICED",
    percentage: 0.75,
    fixedPerSale: 1,
    fixedPerInvoice: 1.5,
    ratePerBox: 0.5,
    ratePerStem: 0.002,
    manualBonus: 2
  }
];

const sourceCache = new Map();

class FlowValidationError extends Error {
  constructor(stage, message, evidence = null) {
    super(message);
    this.name = "FlowValidationError";
    this.stage = stage;
    this.evidence = evidence;
  }
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function round8(value) {
  return Math.round(Number(value || 0) * 100000000) / 100000000;
}

function requireCheck(condition, stage, message, evidence = null) {
  if (!condition) throw new FlowValidationError(stage, message, evidence);
}

async function sourceFor(relativePath) {
  if (!sourceCache.has(relativePath)) {
    sourceCache.set(relativePath, await readFile(path.join(ROOT, relativePath), "utf8"));
  }
  return sourceCache.get(relativePath);
}

async function loadScript(context, relativePath) {
  const source = await sourceFor(relativePath);
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

async function createRuntime() {
  const sandbox = {
    console,
    Date,
    Intl,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // Los 20 ejercicios crean y eliminan sus propios movimientos, pero necesitan
  // catálogos nominales de trabajadores para enlazar recepción, clasificación,
  // embonche y ventas. Se habilitan solo dentro de este VM de pruebas; la
  // aplicación operativa continúa sin datos demo precargados.
  sandbox.__ERP_ENV__ = { VITE_APP_ENV: "demo" };
  sandbox.location = {
    href: "http://127.0.0.1:8143/index.html",
    search: "",
    origin: "http://127.0.0.1:8143"
  };
  sandbox.document = {
    baseURI: "http://127.0.0.1:8143/index.html"
  };
  sandbox.navigator = { userAgent: "Node payroll flow validator" };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.open = () => null;

  const context = vm.createContext(sandbox);
  await loadScript(context, "scripts/core/utils.js");
  await loadScript(context, "scripts/core/accounting-rules.js");
  await loadScript(context, "scripts/data/demo.js");

  const BlessERP = context.BlessERP;
  const db = BlessERP.demo.createDemoDatabase();
  let saveCount = 0;
  BlessERP.state = {
    state: { db },
    saveDb() {
      saveCount += 1;
      return db;
    }
  };
  BlessERP.services = BlessERP.services || {};

  for (const relativePath of RUNTIME_SCRIPTS.slice(3)) {
    await loadScript(context, relativePath);
  }

  return {
    context,
    BlessERP,
    appState: BlessERP.state.state,
    db,
    getSaveCount: () => saveCount
  };
}

function resetOperationalTransactions(BlessERP, appState) {
  const store = BlessERP.operacionesState.getStore(appState);
  [
    "receptions",
    "classifierAssignments",
    "classificationResults",
    "classifications",
    "meshProcessingRecords",
    "processedMeshHistory",
    "processedMeshHistoryAudit",
    "labelBatches",
    "roseInventory",
    "bunchEntries",
    "scannerEvents",
    "performances",
    "payrollPerformanceEntries",
    "dispatches"
  ].forEach(key => {
    store[key] = [];
  });
  store.sequences = { ...(store.sequences || {}), bunchLabel: 1 };
  store.yieldWorkday = BlessERP.operacionesData.createYieldWorkday();
  store.yieldWorkdayHistory = [];
  store.ui.receptionDraft = BlessERP.operacionesData.createReceptionDraft();
  store.ui.receptionItemDraft = BlessERP.operacionesData.createReceptionItemDraft();
  store.ui.classificationAssignmentDraft = BlessERP.operacionesData.createClassificationAssignmentDraft();
  store.ui.classificationResultDraft = BlessERP.operacionesData.createClassificationResultDraft();
  store.ui.labelDraft = BlessERP.operacionesData.createLabelDraft();
  return store;
}

function commissionRuleFor(caseNumber, seller, periodId, date) {
  const variant = COMMISSION_VARIANTS[(caseNumber - 1) % COMMISSION_VARIANTS.length];
  return {
    id: `RULE-CASE-${String(caseNumber).padStart(2, "0")}`,
    companyId: "COMP-BLESS-FLOWER",
    sellerId: seller.sellerId,
    periodId,
    validFrom: date,
    validTo: date,
    status: "ACTIVE",
    notes: `Regla automática del ejercicio ${caseNumber}.`,
    ...variant
  };
}

function paymentMode(caseNumber) {
  return ["CASH", "TRANSFER", "CHECK", "MIXED"][(caseNumber - 1) % 4];
}

function paymentSplits(mode, amount, bankAccountId, date, suffix) {
  if (mode === "TRANSFER") {
    return [{
      method: "TRANSFER",
      amount,
      bankAccountId,
      date,
      reference: `TRF-${suffix}`,
      proof: `COMPROBANTE-${suffix}`
    }];
  }
  if (mode === "CHECK") {
    return [{
      method: "CHECK",
      amount,
      bankAccountId,
      date,
      checkNumber: `CHK-${suffix}`,
      beneficiary: `Beneficiario ${suffix}`,
      checkState: "EMITIDO"
    }];
  }
  if (mode === "MIXED") {
    const cash = Math.floor((amount / 2) * 100) / 100;
    const transfer = round2(amount - cash);
    return [
      { method: "CASH", amount: cash, date },
      {
        method: "TRANSFER",
        amount: transfer,
        bankAccountId,
        date,
        reference: `TRF-MIX-${suffix}`,
        proof: `COMPROBANTE-MIX-${suffix}`
      }
    ].filter(split => split.amount > 0);
  }
  return [{ method: "CASH", amount, date }];
}

function componentsByCode(BlessERP, item) {
  return Object.fromEntries(
    BlessERP.payrollEngine.components(item.id).map(component => [component.code, component])
  );
}

async function executeCase(caseNumber) {
  const startedAt = Date.now();
  const runtime = await createRuntime();
  const { BlessERP, appState, db } = runtime;
  const classifier = CLASSIFIERS[(caseNumber - 1) % CLASSIFIERS.length];
  const buncher = BUNCHERS[(caseNumber - 1) % BUNCHERS.length];
  const seller = SELLERS[(caseNumber - 1) % SELLERS.length];
  const variant = FLOW_VARIANTS[(caseNumber - 1) % FLOW_VARIANTS.length];
  const runDate = BlessERP.utils.today();
  const periodFrom = `${runDate.slice(0, 8)}01`;
  const periodId = `PAYROLL-E2E-${runDate}-CASE-${String(caseNumber).padStart(2, "0")}`;
  const meshCount = 2 + (caseNumber % 4);
  const stemsPerMesh = 25;
  const expectedClassifiedStems = meshCount * stemsPerMesh;
  const bunchCount = 2 + (caseNumber % 3);
  const stemsPerBunch = 25;
  const unitPrice = round2(0.35 + (caseNumber * 0.01));
  const orderId = `ORDER-PAYROLL-E2E-${String(caseNumber).padStart(2, "0")}`;
  const orderNumber = `PED-E2E-2026-${String(caseNumber).padStart(4, "0")}`;
  const checks = [];
  const check = (condition, stage, message, evidence = null) => {
    requireCheck(condition, stage, message, evidence);
    checks.push({ stage, message, evidence });
  };

  try {
    const temporaryEmployeeId = `EMP-E2E-TEMP-${String(caseNumber).padStart(2, "0")}`;
    const createdEmployee = BlessERP.payrollService.saveEmployee({
      employee_id: temporaryEmployeeId,
      company_id: "COMP-BLESS-FLOWER",
      code: `TMP-${String(caseNumber).padStart(3, "0")}`,
      identification: `TEMP-ID-${String(caseNumber).padStart(3, "0")}`,
      full_name: `Personal temporal ${caseNumber}`,
      hire_date: runDate,
      area: "ADMINISTRATIVA",
      position: "Apoyo temporal",
      status: "ACTIVO",
      calculation_mode: "SUELDO_MENSUAL",
      salary_payment_mode: "COMPLETO",
      monthly_salary: 500,
      hourly_rate: 0,
      performance_rate: 0,
      performance_unit: "OTRA",
      goal: 0,
      account_code: "5.6.01"
    });
    check(createdEmployee?.ok && createdEmployee.created, "personal", "Personal nuevo creado desde parámetros.", createdEmployee);
    const editedEmployee = BlessERP.payrollService.saveEmployee({
      ...createdEmployee.employee,
      monthly_salary: 525,
      change_reason: `Ajuste de prueba ${caseNumber}`
    });
    check(
      editedEmployee?.ok && editedEmployee.employee.monthly_salary === 525,
      "personal",
      "Personal nuevo editado con motivo y auditoría.",
      editedEmployee
    );
    const deletedEmployee = BlessERP.payrollService.deleteEmployee(temporaryEmployeeId, `Registro temporal de prueba ${caseNumber}`);
    check(
      deletedEmployee?.ok && !BlessERP.payrollService.findEmployee(temporaryEmployeeId),
      "personal",
      "Personal nuevo sin movimientos eliminado de forma segura.",
      deletedEmployee
    );
    const currentSellerEmployee = BlessERP.payrollService.findEmployee(seller.employeeId);
    const sellerPerformanceMode = BlessERP.payrollService.saveEmployee({
      ...currentSellerEmployee,
      calculation_mode: "MIXTA",
      monthly_salary: Number(currentSellerEmployee?.monthly_salary || 482),
      change_reason: `Validar rendimiento por tallos vendidos en ejercicio ${caseNumber}`
    });
    check(
      sellerPerformanceMode?.ok && sellerPerformanceMode.employee.calculation_mode === "MIXTA",
      "personal",
      "Vendedor configurado en modalidad mixta para calcular tallos vendidos y comisión.",
      sellerPerformanceMode
    );

    let operations = resetOperationalTransactions(BlessERP, appState);
    const started = BlessERP.operacionesState.updateYieldWorkday(appState, "START");
    check(started?.ok && started.workday?.status === "ACTIVA", "jornada", "Jornada operativa iniciada.", started);
    operations = BlessERP.operacionesState.getStore(appState);

    const receptionItem = BlessERP.operacionesData.createReceptionItemDraft({
      id: `REC-ITEM-E2E-${caseNumber}`,
      variety: variant.variety,
      stemType: "LARGO",
      meshCount,
      stemsPerMesh,
      extraStems: 0
    });
    operations.ui.receptionDraft = BlessERP.operacionesData.createReceptionDraft({
      supplier: variant.supplier,
      block: variant.block,
      receptionist: "Juan S.",
      receptionistEmployeeId: "EMP-BLF-OPS-007",
      responsible: "Juan S.",
      observation: `Recepción del ejercicio ${caseNumber}.`,
      items: [receptionItem]
    });
    const reception = BlessERP.operacionesState.registerReception(appState);
    operations = BlessERP.operacionesState.getStore(appState);
    check(Boolean(reception), "recepcion", "Recepción de flor registrada.", operations.ui.notice);
    check(
      reception.totalDeclared === expectedClassifiedStems
        && reception.employee_id === "EMP-BLF-OPS-007",
      "recepcion",
      "Recepción conserva tallos y vínculo employee_id.",
      { totalDeclared: reception.totalDeclared, employeeId: reception.employee_id }
    );

    operations.ui.classificationAssignmentDraft = BlessERP.operacionesData.createClassificationAssignmentDraft({
      receptionId: reception.id,
      receptionItemId: reception.items[0].id,
      supplier: variant.supplier,
      block: variant.block,
      variety: variant.variety,
      classifier: classifier.name,
      classifierEmployeeId: classifier.employeeId,
      meshCount,
      extraStems: 0,
      observation: `Clasificación del ejercicio ${caseNumber}.`
    });
    const assignment = BlessERP.operacionesState.registerClassifierAssignment(appState);
    operations = BlessERP.operacionesState.getStore(appState);
    check(Boolean(assignment), "clasificacion", "Flor asignada a clasificación.", operations.ui.notice);
    check(
      assignment.employee_id === classifier.employeeId
        && assignment.totalStems === expectedClassifiedStems,
      "clasificacion",
      "Clasificación vinculada por employee_id y tallos.",
      { employeeId: assignment.employee_id, totalStems: assignment.totalStems }
    );

    operations.ui.classificationResultDraft = BlessERP.operacionesData.createClassificationResultDraft({
      assignmentId: assignment.id,
      supplier: variant.supplier,
      block: variant.block,
      classifier: classifier.name,
      classifierEmployeeId: classifier.employeeId,
      variety: variant.variety,
      nationalStems: caseNumber % 5,
      observation: `Cierre de clasificación del ejercicio ${caseNumber}.`
    });
    const classificationResult = BlessERP.operacionesState.registerClassificationResult(appState);
    operations = BlessERP.operacionesState.getStore(appState);
    const persistedAssignment = operations.classifierAssignments.find(item => item.id === assignment.id);
    check(
      Boolean(classificationResult) && persistedAssignment?.status === "ENTREGADO + REGISTRADO NACIONAL",
      "clasificacion",
      "Resultado de clasificación cerrado.",
      classificationResult
    );

    operations.ui.labelDraft = BlessERP.operacionesData.createLabelDraft({
      date: runDate,
      supplier: variant.supplier,
      block: variant.block,
      buncher: buncher.name,
      buncherEmployeeId: buncher.employeeId,
      variety: variant.variety,
      length: variant.length,
      category: "EXPORTACION",
      stemsPerBunch,
      quantity: bunchCount,
      labelType: "NORMAL",
      observation: `Etiquetas del ejercicio ${caseNumber}.`
    });
    const labelBatch = BlessERP.operacionesState.generateLabelBatch(appState);
    operations = BlessERP.operacionesState.getStore(appState);
    check(
      labelBatch?.labels?.length === bunchCount,
      "etiqueta",
      "Lote de etiquetas generado.",
      { expected: bunchCount, actual: labelBatch?.labels?.length }
    );
    check(
      labelBatch.labels.every(label => /^\d{10}$/.test(label.code) && label.employee_id === buncher.employeeId),
      "etiqueta",
      "Etiquetas de 10 dígitos vinculadas al embonchador.",
      labelBatch.labels.map(label => ({ code: label.code, employeeId: label.employee_id }))
    );

    const scanResults = labelBatch.labels.map(label => (
      BlessERP.operacionesState.scanBunchLabelIntoInventory(appState, label.code, {
        responsible: "Marco A.",
        observation: `Ingreso a inventario del ejercicio ${caseNumber}.`
      })
    ));
    operations = BlessERP.operacionesState.getStore(appState);
    check(
      scanResults.every(result => result.ok && result.result === "INVENTARIO_CREADO"),
      "embonche_inventario",
      "Todos los bonches ingresaron por escaneo.",
      scanResults.map(result => ({ code: result.code, result: result.result }))
    );
    const generatedLabelIds = new Set(labelBatch.labels.map(label => label.id));
    const generatedLabelCodes = new Set(labelBatch.labels.map(label => label.code));
    const caseInventory = operations.roseInventory.filter(item => generatedLabelIds.has(item.sourceLabelId));
    const caseBunchEntries = operations.bunchEntries.filter(item => generatedLabelCodes.has(item.code));
    check(
      caseInventory.length === bunchCount
        && caseBunchEntries.length === bunchCount,
      "embonche_inventario",
      "Inventario físico y rendimiento de embonche creados una sola vez.",
      {
        inventory: caseInventory.length,
        bunchEntries: caseBunchEntries.length,
        validationSeedInventoryIgnored: operations.roseInventory.length - caseInventory.length
      }
    );
    const commercial = BlessERP.comercialState.getStore(appState);
    const line = BlessERP.comercialData.createLine({
      id: `LINE-E2E-${caseNumber}`,
      boxNumber: 1,
      boxType: "HB",
      variety: variant.variety,
      po: `PO-E2E-${caseNumber}`,
      length: variant.length,
      bunches: bunchCount,
      stemsPerBunch,
      unitPrice,
      state: "reservado",
      scannedBunches: scanResults.map(result => ({
        code: result.code,
        inventoryId: result.inventoryId,
        variety: variant.variety,
        length: variant.length,
        stemsPerBunch
      }))
    });
    const order = BlessERP.comercialData.createOrder({
      id: orderId,
      number: orderNumber,
      issuedAt: runDate,
      flightDate: runDate,
      status: "VALIDADO_COMERCIAL",
      warehouseStatus: "LIBERADO_BODEGA",
      fulfillmentStatus: "LIBERADO_BODEGA",
      customerId: "customer-ursa",
      brandId: "brand-alex",
      destination: "MIAMI",
      destinationCountry: "ESTADOS UNIDOS",
      daeNumber: `055-2026-40-${String(10000000 + caseNumber)}`,
      awb: `369-${String(45000000 + caseNumber)}`,
      hawb: `HWB-E2E-${caseNumber}`,
      airlineId: "air-atlas",
      flightNumber: `E2E ${caseNumber}`,
      sriAuthorizationStatus: "AUTORIZADO",
      sriAuthorizedAt: `${runDate}T12:00:00.000Z`,
      lines: [line]
    });
    order.customerName = `Cliente E2E ${caseNumber}`;
    order.collectionStatus = "COBRADO";
    order.paymentStatus = "PAGADO";
    order.collectedAmount = round2(bunchCount * stemsPerBunch * unitPrice);
    const linkedSeller = BlessERP.comercialState.applySellerLink(order, seller.sellerId, appState, {
      visibleName: seller.name,
      source: "PAYROLL_E2E_VALIDATION"
    });
    commercial.orders.unshift(order);
    commercial.customers = [{ id: order.customerId, commercialName: order.customerName }];
    check(
      linkedSeller?.employee_id === seller.employeeId
        && order.seller_id === seller.sellerId
        && order.seller_name === seller.name,
      "venta_vendedor",
      "Venta vinculada por seller_id, employee_id y nombre visible.",
      {
        sellerId: order.seller_id,
        sellerEmployeeId: order.sellerEmployeeId,
        sellerName: order.seller_name
      }
    );

    const prepared = BlessERP.operacionesDispatchDemo.prepareDispatchFromOrderDemo(appState, order.id);
    check(prepared?.ok, "bodega_despacho", "Pedido preparado en bodega.", prepared);
    const ready = BlessERP.operacionesDispatchDemo.markDispatchReadyDemo(appState, order.id);
    check(
      ready?.ok && ready.progress?.allBoxesComplete,
      "bodega_despacho",
      "Bodega detectó todas las cajas completas.",
      ready
    );
    const dispatched = BlessERP.operacionesDispatchDemo.confirmDispatchDemo(appState, order.id, {
      responsable_demo: "Marco A.",
      observacion: `Carga confirmada para ejercicio ${caseNumber}.`
    });
    check(
      dispatched?.ok && dispatched.dispatch?.estado_despacho === "CARGADO_CAMION",
      "bodega_despacho",
      "Despacho confirmado y cargado al camión.",
      dispatched
    );
    // El despacho operativo conserva el flujo comercial protegido. Para probar
    // comisiones con base SHIPPED se registra la evidencia de embarque devuelta
    // por la API operativa en la venta del escenario.
    order.dispatchedAt = dispatched.dispatch.fecha_hora_despacho;
    order.operationalDispatchId = dispatched.dispatch.dispatch_id;
    check(
      Boolean(order.dispatchedAt) && order.operationalDispatchId === dispatched.dispatch.dispatch_id,
      "bodega_despacho",
      "La venta conserva la evidencia del despacho operativo para la base SHIPPED.",
      { dispatchedAt: order.dispatchedAt, operationalDispatchId: order.operationalDispatchId }
    );
    scanResults.forEach(result => {
      BlessERP.operacionesState.updateInventoryState(appState, result.inventoryId, "DESPACHADO");
    });
    operations = BlessERP.operacionesState.getStore(appState);
    const dispatchedInventory = operations.roseInventory.filter(item => (
      scanResults.some(result => result.inventoryId === item.inventoryId)
    ));
    check(
      dispatchedInventory.length === bunchCount
        && dispatchedInventory.every(item => item.state === "DESPACHADO"),
      "bodega_despacho",
      "Inventario de los bonches marcado como despachado.",
      dispatchedInventory.map(item => ({ inventoryId: item.inventoryId, state: item.state }))
    );

    order.collectionStatus = "COBRADO";
    order.paymentStatus = "PAGADO";
    order.collectedAmount = round2(BlessERP.comercialUtils.getOrderMetrics(order).totalUsd);
    const salesMetrics = BlessERP.comercialUtils.getOrderMetrics(order);
    check(
      salesMetrics.totalBoxes === 1
        && salesMetrics.totalStems === bunchCount * stemsPerBunch
        && salesMetrics.totalUsd > 0,
      "venta_vendedor",
      "Venta conserva cajas, tallos y valor para comisión.",
      salesMetrics
    );

    const commissionRule = commissionRuleFor(caseNumber, seller, periodId, runDate);
    const savedRule = BlessERP.payrollCommissions.saveRule(commissionRule);
    check(savedRule?.ok, "comision", "Regla de comisión guardada.", savedRule);
    const commission = BlessERP.payrollCommissions.calculate({
      sellerId: seller.sellerId,
      period: { id: periodId, from: periodFrom, to: runDate }
    });
    check(
      commission.total > 0
        && commission.details.some(item => item.orderId === order.id),
      "comision",
      "Comisión calculada desde la venta despachada.",
      commission
    );

    operations = BlessERP.operacionesState.getStore(appState);
    const projectedPerformance = BlessERP.operacionesState.syncPayrollPerformanceEntries(operations);
    const classifierPerformance = projectedPerformance.filter(row => (
      row.employee_id === classifier.employeeId && row.date === runDate
    ));
    const buncherPerformance = projectedPerformance.filter(row => (
      row.employee_id === buncher.employeeId
        && row.date === runDate
        && String(row.sourceId || "").startsWith("RAMO-OPS")
    ));
    check(
      classifierPerformance.length === 1
        && classifierPerformance[0].quantity === expectedClassifiedStems,
      "rendimiento_rol",
      "Clasificación sincronizada al rol por tallos y employee_id.",
      classifierPerformance
    );
    check(
      buncherPerformance.length === bunchCount
        && buncherPerformance.every(row => row.quantity === 1),
      "rendimiento_rol",
      "Embonche sincronizado al rol por bonches y employee_id.",
      buncherPerformance
    );

    const createdRun = BlessERP.payrollEngine.createRun({
      companyId: "COMP-BLESS-FLOWER",
      periodId,
      dateFrom: periodFrom,
      dateTo: runDate,
      area: "TODAS",
      employeeIds: [classifier.employeeId, buncher.employeeId, seller.employeeId],
      notes: `Ejercicio integral ${caseNumber}.`
    });
    check(createdRun?.ok, "rol_generacion", "Periodo de rol creado.", createdRun);
    const calculatedRun = BlessERP.payrollEngine.calculateRun(createdRun.run.id);
    check(
      calculatedRun?.ok && calculatedRun.items.length === 3,
      "rol_generacion",
      "Rol calculado para clasificador, embonchador y vendedor.",
      calculatedRun
    );

    const calculatedItems = BlessERP.payrollEngine.items(createdRun.run.id);
    const classifierItem = calculatedItems.find(item => item.employeeId === classifier.employeeId);
    const buncherItem = calculatedItems.find(item => item.employeeId === buncher.employeeId);
    const sellerItem = calculatedItems.find(item => item.employeeId === seller.employeeId);
    const classifierComponents = componentsByCode(BlessERP, classifierItem);
    const buncherComponents = componentsByCode(BlessERP, buncherItem);
    const sellerComponents = componentsByCode(BlessERP, sellerItem);
    const classifierSummary = classifierComponents.PERFORMANCE.snapshot.performanceSummary;
    const buncherSummary = buncherComponents.PERFORMANCE.snapshot.performanceSummary;
    const sellerSummary = sellerComponents.PERFORMANCE.snapshot.performanceSummary;
    const workingDays = BlessERP.payrollEngine.workingDaysInRange(periodFrom, runDate, [1, 2, 3, 4, 5, 6]);
    const salesMetricsForPerformance = BlessERP.payrollCommissions.orderMetrics(order);
    check(
      classifierSummary.role === "CLASSIFIER"
        && classifierSummary.quantity === expectedClassifiedStems
        && classifierSummary.rate === round8(482 / (21 * 5750))
        && classifierSummary.precision === 8
        && classifierComponents.SALARY.amount === 0
        && classifierComponents.SALARY.snapshot.referenceOnly === true
        && classifierItem.daysWorked === classifierSummary.workingDays
        && classifierComponents.PERFORMANCE.amount === round2(classifierSummary.quantity * classifierSummary.rate),
      "rendimiento_rol",
      "Pago automático del clasificador coincide con tallos del rango y tarifa de ocho decimales.",
      classifierSummary
    );
    check(
      buncherSummary.role === "BUNCHER"
        && buncherSummary.quantity === bunchCount
        && buncherSummary.details.every(item => !String(item.entryId).includes("VALID"))
        && buncherSummary.rate === round8(482 / (21 * 200))
        && buncherSummary.stemEquivalentRate === round8(buncherSummary.rate / 25)
        && buncherSummary.precision === 8
        && buncherComponents.SALARY.amount === 0
        && buncherComponents.SALARY.snapshot.referenceOnly === true
        && buncherItem.daysWorked === buncherSummary.workingDays
        && buncherComponents.PERFORMANCE.amount === round2(buncherSummary.quantity * buncherSummary.rate),
      "rendimiento_rol",
      "Pago automático del embonchador coincide con bonches del rango y tarifa de ocho decimales.",
      buncherSummary
    );
    check(
      classifierSummary.parameters.classifier_daily_stem_target === 5750
        && classifierSummary.parameters.classifier_daily_mesh_target === 230
        && classifierSummary.parameters.classifier_stems_per_mesh === 25
        && classifierSummary.parameters.reference_working_days === 21
        && classifierSummary.parameters.classifier_reference_salary === 482
        && buncherSummary.parameters.buncher_daily_bunch_target === 200
        && buncherSummary.parameters.buncher_stems_per_bunch === 25
        && buncherSummary.parameters.buncher_reference_salary === 482
        && sellerSummary.parameters.seller_daily_stem_target === 320000
        && sellerSummary.parameters.seller_reference_salary === 482
        && classifierSummary.workdayHours === 8
        && buncherSummary.workdayHours === 8
        && sellerSummary.workdayHours === 8
        && classifierSummary.workingDays === workingDays
        && buncherSummary.workingDays === classifierSummary.workingDays,
      "rendimiento_rol",
      "Metas diarias, jornada, sueldo referencial y precisión coinciden con los parámetros solicitados.",
      { classifierSummary, buncherSummary, sellerSummary }
    );
    const sampleParameters = classifierSummary.parameters;
    const sampleClassifierRate = BlessERP.payrollEngine.performanceRateForDays("CLASSIFIER", 21, sampleParameters);
    const sampleBuncherRate = BlessERP.payrollEngine.performanceRateForDays("BUNCHER", 21, sampleParameters);
    const sampleSellerRate = BlessERP.payrollEngine.performanceRateForDays("SELLER", 21, sampleParameters);
    const sampleClassifierRate7 = BlessERP.payrollEngine.performanceRateForDays(
      "CLASSIFIER",
      21,
      { ...sampleParameters, precision: 7 }
    );
    check(
      sampleClassifierRate === 0.00399172
        && sampleBuncherRate === 0.1147619
        && round8(sampleBuncherRate / 25) === 0.00459048
        && sampleSellerRate === 0.00007173
        && sampleClassifierRate7 === 0.0039917,
      "rendimiento_rol",
      "Ejemplo de 21 días reproduce las tarifas de clasificador, embonchador y vendedor con precisión configurable de 7 u 8 decimales.",
      {
        classifier8: sampleClassifierRate,
        buncher8: sampleBuncherRate,
        buncherStemEquivalent8: round8(sampleBuncherRate / 25),
        seller8: sampleSellerRate,
        classifier7: sampleClassifierRate7
      }
    );
    check(
      sellerSummary.role === "SELLER"
        && sellerSummary.unit === "TALLOS"
        && sellerSummary.quantity >= salesMetricsForPerformance.totalStems
        && sellerSummary.details.some(detail => (
          detail.entryId === `SALE:${order.id}`
            && detail.quantity === salesMetricsForPerformance.totalStems
        ))
        && sellerSummary.rate === round8(482 / (21 * 320000))
        && sellerSummary.precision === 8
        && sellerComponents.SALARY.amount === 0
        && sellerComponents.SALARY.snapshot.referenceOnly === true
        && sellerComponents.PERFORMANCE.amount === round2(sellerSummary.quantity * sellerSummary.rate),
      "rendimiento_rol",
      "Pago automático del vendedor coincide con los tallos vendidos del rango y conserva su comisión separada.",
      sellerSummary
    );
    check(
      sellerComponents.COMMISSION.amount === round2(commission.total)
        && sellerComponents.COMMISSION.snapshot.details.length === commission.details.length,
      "comision_rol",
      "Comisión y snapshot de venta llegaron al rol del vendedor.",
      sellerComponents.COMMISSION
    );

    const previousSellerNet = sellerItem.netPay;
    const adjustedBonus = round2(caseNumber + .5);
    const adjusted = BlessERP.payrollEngine.adjustEmployeeItem(sellerItem.id, {
      daysWorked: sellerItem.daysWorked,
      reason: `Bonificación extraordinaria del ejercicio ${caseNumber}`,
      components: BlessERP.payrollEngine.components(sellerItem.id).map(component => ({
        componentId: component.id,
        value: component.code === "BONUS" ? adjustedBonus : component.amount
      }))
    });
    const adjustedSeller = BlessERP.payrollEngine.items(createdRun.run.id).find(item => item.id === sellerItem.id);
    check(
      adjusted?.ok
        && adjusted.adjustments.length === 1
        && adjustedSeller.netPay === round2(previousSellerNet + adjustedBonus),
      "rol_ajustes",
      "Detalle del rol editado antes de confirmar, con recálculo del neto y auditoría.",
      adjusted
    );

    const approved = BlessERP.payrollEngine.approveRun(createdRun.run.id);
    check(
      approved?.ok && approved.run.status === "APROBADO" && approved.run.snapshot.items.length === 3,
      "rol_aprobacion",
      "Rol aprobado con snapshot bloqueado.",
      approved
    );
    const blockedAdjustment = BlessERP.payrollEngine.adjustEmployeeItem(sellerItem.id, {
      reason: "No debe aplicarse",
      components: [{ componentId: sellerComponents.BONUS.id, value: adjustedBonus + 1 }]
    });
    check(
      blockedAdjustment?.ok === false,
      "rol_ajustes",
      "El rol confirmado bloquea modificaciones posteriores.",
      blockedAdjustment
    );
    const accounted = BlessERP.payrollAccounting.postRun(createdRun.run.id);
    check(
      accounted?.ok
        && accounted.run.status === "CONTABILIZADO"
        && round2(accounted.entry.lines.reduce((sum, row) => sum + Number(row.debit || 0), 0))
          === round2(accounted.entry.lines.reduce((sum, row) => sum + Number(row.credit || 0), 0)),
      "contabilizacion",
      "Devengo contabilizado y cuadrado.",
      accounted
    );

    const mode = paymentMode(caseNumber);
    const bank = BlessERP.services.banks.bankAccounts().find(account => account.code === "BANCO-PICHINCHA")
      || BlessERP.services.banks.bankAccounts()[0];
    const paid = [];
    for (const item of BlessERP.payrollEngine.items(createdRun.run.id)) {
      const suffix = `${String(caseNumber).padStart(2, "0")}-${item.employeeCode || item.employeeId}`;
      const payment = BlessERP.payrollPayments.registerPayment({
        employeeItemId: item.id,
        date: runDate,
        observation: `Pago ${mode} del ejercicio ${caseNumber}.`,
        splits: paymentSplits(mode, item.pendingBalance, bank.id, runDate, suffix)
      });
      check(
        payment?.ok && payment.payment.status === "CONFIRMADO",
        "pago",
        `Pago ${mode} confirmado para ${item.employeeName}.`,
        payment
      );
      paid.push(payment);
    }
    const finalRun = BlessERP.payrollEngine.getRun(createdRun.run.id);
    check(
      finalRun.status === "PAGADO"
        && finalRun.totals.pending === 0
        && paid.every(payment => payment.entry.id !== accounted.entry.id),
      "pago",
      "Rol pagado totalmente con asientos separados del devengo.",
      {
        status: finalRun.status,
        pending: finalRun.totals.pending,
        accrualEntryId: accounted.entry.id,
        paymentEntryIds: paid.map(payment => payment.entry.id)
      }
    );
    if (mode === "CHECK") {
      check(
        BlessERP.payrollEngine.payrollStore().checkDetails.length === 3,
        "pago",
        "Cheques guardados con detalle independiente.",
        BlessERP.payrollEngine.payrollStore().checkDetails
      );
    }
    if (mode === "MIXED") {
      check(
        paid.every(payment => payment.splits.length === 2),
        "pago",
        "Pago mixto dividido en efectivo y transferencia.",
        paid.map(payment => payment.splits)
      );
    }

    const printOutput = BlessERP.payrollPrint.documentHtml(createdRun.run.id);
    const pageCount = (printOutput.html.match(/<article class="doc-page payroll-slip-page">/g) || []).length;
    check(
      printOutput?.ok && printOutput.count === 3 && pageCount === 3,
      "impresion",
      "HTML A4 generado con una página por trabajador.",
      { count: printOutput?.count, pageCount }
    );
    check(
      printOutput.html.includes("ROL DE PAGOS INDIVIDUAL")
        && printOutput.html.includes(classifier.name)
        && printOutput.html.includes(buncher.name)
        && printOutput.html.includes(seller.name)
        && printOutput.html.includes("Tallos clasificados")
        && printOutput.html.includes("Bonches ingresados")
        && printOutput.html.includes("Tarifa rendimiento")
        && printOutput.html.includes("Meta del rango")
        && printOutput.html.includes("Comisiones")
        && printOutput.html.includes("Rendimiento")
        && printOutput.html.includes("TOTAL INGRESOS")
        && printOutput.html.includes("TOTAL DESCUENTO")
        && printOutput.html.includes("NETO A RECIBIR")
        && printOutput.html.includes("styles/payroll-print.css")
        && !printOutput.html.toUpperCase().includes("IESS"),
      "impresion",
      "Impresión simple contiene el formato Bless Flower, rendimiento y comisión sin obligaciones desactivadas.",
      {
        htmlLength: printOutput.html.length,
        seller: seller.name,
        classifier: classifier.name,
        buncher: buncher.name
      }
    );
    if (caseNumber === 1) {
      await mkdir(OUTPUT_DIR, { recursive: true });
      await writeFile(PRINT_SAMPLE_HTML, printOutput.html, "utf8");
    }

    return {
      caseNumber,
      status: "PASSED",
      durationMs: Date.now() - startedAt,
      assertionCount: checks.length,
      input: {
        supplier: variant.supplier,
        block: variant.block,
        variety: variant.variety,
        length: variant.length,
        meshCount,
        classifiedStems: expectedClassifiedStems,
        bunchCount,
        stemsPerBunch,
        unitPrice,
        classifier,
        buncher,
        seller,
        commissionMode: commission.rule.mode,
        commissionBasis: commission.rule.basis,
        paymentMode: mode
      },
      output: {
        receptionId: reception.id,
        labelCodes: labelBatch.labels.map(label => label.code),
        inventoryIds: scanResults.map(result => result.inventoryId),
        dispatchId: dispatched.dispatch.dispatch_id,
        dispatchStatus: dispatched.dispatch.estado_despacho,
        orderId: order.id,
        orderNumber: order.number,
        saleValue: round2(salesMetrics.totalUsd),
        commission: round2(commission.total),
        classifierPerformancePay: classifierComponents.PERFORMANCE.amount,
        buncherPerformancePay: buncherComponents.PERFORMANCE.amount,
        sellerPerformancePay: sellerComponents.PERFORMANCE.amount,
        sellerCommissionPay: sellerComponents.COMMISSION.amount,
        payrollRunId: finalRun.id,
        payrollRunNumber: finalRun.number,
        payrollStatus: finalRun.status,
        payrollNet: finalRun.totals.net,
        accrualEntryNumber: accounted.entry.entryNumber,
        paymentEntryNumbers: paid.map(payment => payment.entry.entryNumber),
        printPages: printOutput.count,
        printHtmlLength: printOutput.html.length,
        saveCount: runtime.getSaveCount()
      },
      checks
    };
  } catch (error) {
    return {
      caseNumber,
      status: "FAILED",
      durationMs: Date.now() - startedAt,
      assertionCount: checks.length,
      failure: {
        stage: error.stage || "runtime",
        message: error.message,
        evidence: error.evidence || null,
        stack: error.stack
      },
      checks
    };
  }
}

function markdownReport(report) {
  const rows = report.cases.map(item => {
    if (item.status === "FAILED") {
      return `| ${item.caseNumber} | FALLÓ | ${item.failure.stage} | - | - | - | ${String(item.failure.message).replaceAll("|", "\\|")} |`;
    }
    return `| ${item.caseNumber} | OK | ${item.input.variety} | ${item.input.seller.name} | ${item.input.commissionMode} | ${item.input.paymentMode} | ${item.output.payrollStatus} |`;
  }).join("\n");
  const failures = report.cases
    .filter(item => item.status === "FAILED")
    .map(item => `- Caso ${item.caseNumber}, etapa **${item.failure.stage}**: ${item.failure.message}`)
    .join("\n");
  return `# Validación E2E del rol de pagos — 20 ejercicios

Generado: ${report.generatedAt}

- Casos ejecutados: ${report.summary.total}
- Aprobados: ${report.summary.passed}
- Fallidos: ${report.summary.failed}
- Aserciones completadas: ${report.summary.assertions}
- Resultado general: **${report.summary.status}**

| Caso | Resultado | Variedad / etapa | Vendedor | Comisión | Pago | Rol / error |
|---:|---|---|---|---|---|---|
${rows}

## Cobertura por ejercicio

Cada caso recorre recepción de flor, clasificación, embonche, generación y escaneo de etiquetas, ingreso a inventario, preparación y confirmación de despacho, venta vinculada por vendedor, cálculo de comisión, sincronización de rendimientos, generación y aprobación del rol, contabilización, pago e impresión A4.

## Fallos

${failures || "No se detectaron fallos."}
`;
}

async function main() {
  const cases = [];
  for (let caseNumber = 1; caseNumber <= 20; caseNumber += 1) {
    const result = await executeCase(caseNumber);
    cases.push(result);
    const detail = result.status === "PASSED"
      ? `${result.input.commissionMode}/${result.input.paymentMode} · ${result.output.payrollStatus}`
      : `${result.failure.stage}: ${result.failure.message}`;
    console.log(`[${String(caseNumber).padStart(2, "0")}/20] ${result.status} · ${detail}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    validator: "validate-payroll-flow.mjs",
    scope: "Recepción -> clasificación -> embonche -> etiquetas -> inventario -> bodega/despacho -> venta/vendedor -> comisión/rendimiento -> rol -> contabilidad -> pago -> impresión",
    summary: {
      total: cases.length,
      passed: cases.filter(item => item.status === "PASSED").length,
      failed: cases.filter(item => item.status === "FAILED").length,
      assertions: cases.reduce((sum, item) => sum + Number(item.assertionCount || 0), 0),
      status: cases.every(item => item.status === "PASSED") ? "PASSED" : "FAILED"
    },
    cases
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(REPORT_MD, markdownReport(report), "utf8");

  console.log(`\nResultado: ${report.summary.passed}/${report.summary.total} casos aprobados; ${report.summary.assertions} aserciones.`);
  console.log(`JSON: ${path.relative(ROOT, REPORT_JSON)}`);
  console.log(`Markdown: ${path.relative(ROOT, REPORT_MD)}`);

  if (report.summary.failed > 0) process.exitCode = 1;
}

await main();
