import assert from "node:assert/strict";

const API_BASE = String(process.env.SRI_API_BASE || "https://bless-flower-jaeder.vercel.app/api/sri").replace(/\/$/, "");
const SUPABASE_URL = String(process.env.SRI_SUPABASE_URL || "https://lmurmntscqnvkmvielaw.supabase.co").replace(/\/$/, "");
const ANON_KEY = String(process.env.SRI_SUPABASE_ANON_KEY || "").trim();
const ADMIN_EMAIL = String(process.env.SRI_ADMIN_EMAIL || "james1750@users.jaeder.systems").trim();
const ADMIN_PASSWORD = String(process.env.SRI_ADMIN_PASSWORD || "");
const CONFIRMATION = String(process.env.SRI_CERTIFICATION_CONFIRM || "");
const TRANSMIT_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.SRI_TEST_TRANSMIT_ATTEMPTS || 3)));

const COMPANIES = {
  bless: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Bless Flower",
    ruc: "1717637084001",
    legalName: "Lanchimba Tutillo Manuel Clemente",
    point: "001-002"
  },
  imperio: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Imperio Flowers",
    ruc: "1727970137001",
    legalName: "Lanchimba Tipanluisa Sandy Anahi",
    point: "001-001"
  }
};

function ecuadorDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fiscalPeriod(issueDate) {
  const [year, month] = issueDate.split("-");
  return `${month}/${year}`;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

class RemoteError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RemoteError";
    this.status = options.status || 0;
    this.code = options.code || "REMOTE_ERROR";
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
  }
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new RemoteError(`El servidor devolvio una respuesta no JSON (HTTP ${response.status}).`, {
      status: response.status,
      code: "INVALID_JSON"
    });
  }
}

async function authenticate() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  const payload = await responseJson(response);
  if (!response.ok || !payload.access_token) {
    throw new RemoteError(payload?.msg || payload?.error_description || "No se pudo autenticar al administrador.", {
      status: response.status,
      code: payload?.error_code || "AUTH_FAILED"
    });
  }
  return payload.access_token;
}

async function sriRequest(token, method, action, companyId, body = null) {
  const url = method === "GET"
    ? `${API_BASE}?action=${encodeURIComponent(action)}&companyId=${encodeURIComponent(companyId)}`
    : API_BASE;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify({ action, companyId, ...body }) : undefined
  });
  const payload = await responseJson(response);
  if (!response.ok || payload.ok === false) {
    throw new RemoteError(payload?.error?.message || `Solicitud SRI fallida (HTTP ${response.status}).`, {
      status: response.status,
      code: payload?.error?.code || "SRI_API_ERROR",
      retryable: payload?.error?.retryable,
      details: payload?.error?.details
    });
  }
  return payload.data;
}

function pointFor(configuration, code) {
  const point = configuration.emissionPoints.find(item => (
    `${item.establishment_code}-${item.emission_point_code}` === code && item.active
  ));
  assert.ok(point, `No existe el punto de emision TEST ${code}.`);
  return point;
}

function terminalSummary(detail) {
  const document = detail?.document || {};
  return {
    id: document.id || null,
    type: document.document_type || null,
    number: document.full_number || null,
    status: document.status || null,
    environment: document.environment || null,
    authorizationNumber: document.authorization_number || null,
    authorizationDate: document.authorization_date || null,
    files: (detail?.files || []).map(file => file.file_type),
    messages: (detail?.errors || []).map(item => ({
      stage: item.stage,
      identifier: item.identifier,
      message: item.message,
      additionalInformation: item.additional_information
    }))
  };
}

async function createGenerateSign(token, input) {
  let detail = await sriRequest(token, "POST", "create-draft", input.companyId, input);
  const documentId = detail.document.id;
  detail = await sriRequest(token, "POST", "generate-xml", input.companyId, { documentId });
  detail = await sriRequest(token, "POST", "sign", input.companyId, { documentId });
  return detail;
}

async function transmitUntilTerminal(token, companyId, documentId, maximumAttempts = 7) {
  let lastError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const detail = await sriRequest(token, "POST", "transmit", companyId, {
        documentId,
        force: attempt > 1
      });
      if (["AUTORIZADO", "NO_AUTORIZADO", "DEVUELTO", "ANULADO"].includes(detail.document.status)) return detail;
      lastError = new RemoteError(`Estado SRI no terminal: ${detail.document.status}.`, {
        code: "NON_TERMINAL_STATUS",
        retryable: true
      });
    } catch (error) {
      lastError = error;
      if (!error.retryable) throw error;
    }
    await sleep(Math.min(12000, 2000 * attempt));
  }
  throw lastError || new RemoteError("El SRI no devolvio un estado terminal dentro del tiempo de prueba.", {
    code: "SRI_TEST_TIMEOUT",
    retryable: true
  });
}

function invoiceInput(issueDate, emissionPointId) {
  const taxableBase = 100;
  const vat = 15;
  const total = taxableBase + vat;
  const tax = { code: "2", percentageCode: "4", rate: 15, taxableBase, value: vat };
  return {
    companyId: COMPANIES.imperio.id,
    emissionPointId,
    documentType: "01",
    issueDate,
    sourcePayload: {
      buyer: {
        identificationType: "04",
        identification: COMPANIES.bless.ruc,
        legalName: COMPANIES.bless.legalName,
        address: "3 DE NOVIEMBRE LOTE 4 Y CACHICUNGO, CANGAHUA, CAYAMBE"
      },
      invoice: {
        commerceType: "LOCAL",
        totalWithoutTax: taxableBase,
        discountTotal: 0,
        tip: 0,
        grandTotal: total,
        currency: "DOLAR",
        payments: [{ method: "20", total }]
      },
      taxes: [tax],
      lines: [{
        mainCode: "SERV-COM",
        auxiliaryCode: "PRUEBA-SRI",
        description: "SERVICIO DE COMERCIALIZACION - DOCUMENTO DE PRUEBA",
        unit: "UNIDAD",
        quantity: 1,
        unitPrice: taxableBase,
        discount: 0,
        subtotal: taxableBase,
        taxes: [tax]
      }],
      additionalInformation: {
        "Correo cliente": "administracion@blessflower.test",
        Observacion: "DOCUMENTO DE PRUEBA SIN VALIDEZ TRIBUTARIA"
      }
    }
  };
}

function withholdingInput(issueDate, emissionPointId, invoiceDetail) {
  const invoice = invoiceDetail.document;
  const documentNumber = `${invoice.establishment_code}${invoice.emission_point_code}${invoice.sequential_text}`;
  const authorizationNumber = invoice.authorization_number || invoice.access_key;
  return {
    companyId: COMPANIES.bless.id,
    emissionPointId,
    documentType: "07",
    issueDate,
    sourcePayload: {
      buyer: {
        identificationType: "04",
        identification: COMPANIES.imperio.ruc,
        legalName: COMPANIES.imperio.legalName,
        address: "CANGAHUA, CAYAMBE, PICHINCHA"
      },
      withholding: {
        relatedParty: false,
        fiscalPeriod: fiscalPeriod(issueDate),
        supportingDocuments: [{
          supportCode: "01",
          documentCode: "01",
          documentNumber,
          issueDate: invoice.issue_date,
          accountingDate: issueDate,
          authorizationNumber,
          paymentLocation: "01",
          totalWithoutTax: 100,
          grandTotal: 115,
          taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }],
          retentions: [
            { code: "1", retentionCode: "312", taxableBase: 100, rate: 2, value: 2 },
            { code: "2", retentionCode: "1", taxableBase: 15, rate: 30, value: 4.5 }
          ],
          payments: [{ method: "20", total: 115 }]
        }]
      }
    }
  };
}

function exportInvoiceInput(issueDate, emissionPointId) {
  const subtotal = 45;
  const zeroTax = { code: "2", percentageCode: "0", rate: 0, taxableBase: subtotal, value: 0 };
  return {
    companyId: COMPANIES.bless.id,
    emissionPointId,
    documentType: "01",
    issueDate,
    sourcePayload: {
      buyer: {
        identificationType: "08",
        identification: "CEX000001",
        legalName: "CLIENTE EXTERIOR CERTIFICACION",
        address: "MIAMI, FLORIDA, ESTADOS UNIDOS"
      },
      invoice: {
        commerceType: "EXPORTADOR",
        incoterm: "FCA",
        incotermPlace: "QUITO",
        originCountryCode: "593",
        portOfLoading: "UIO",
        portOfDestination: "MIA",
        destinationCountryCode: "110",
        acquisitionCountryCode: "593",
        totalWithoutTax: subtotal,
        totalWithoutTaxIncoterm: "FCA",
        discountTotal: 0,
        internationalFreight: 0,
        internationalInsurance: 0,
        customsExpenses: 0,
        otherTransportExpenses: 0,
        grandTotal: subtotal,
        currency: "USD",
        payments: [{ method: "20", total: subtotal }]
      },
      taxes: [zeroTax],
      lines: [{
        mainCode: "ROSAS",
        auxiliaryCode: "FREEDOM-60",
        description: "ROSAS DE CORTE PARA EXPORTACION - CERTIFICACION",
        unit: "TALLO",
        quantity: 100,
        unitPrice: 0.45,
        discount: 0,
        subtotal,
        variety: "FREEDOM",
        measure: "60 CM",
        taxes: [zeroTax]
      }],
      additionalInformation: {
        "Correo cliente": "qa-export@blessflower.test",
        Guias: "014-12345678 / HAWB-TEST-001",
        Piezas: "1 HB",
        "Marca cliente": "MARCA EXTERIOR CERTIFICACION",
        DAE: "055-2026-40-TEST001",
        Observacion: "DOCUMENTO DE PRUEBA SIN VALIDEZ TRIBUTARIA"
      },
      erpEmission: { transportType: "AEREO" }
    }
  };
}

function creditNoteInput(issueDate, emissionPointId, invoiceDetail, companyId) {
  const invoice = invoiceDetail.document;
  const original = invoice.source_snapshot || {};
  const originalLine = Array.isArray(original.lines) ? original.lines[0] : null;
  const taxable = Number(originalLine?.subtotal || 10);
  const originalTax = Array.isArray(originalLine?.taxes) ? originalLine.taxes[0] : null;
  const rate = Number(originalTax?.rate || 0);
  const taxValue = Number((taxable * rate / 100).toFixed(2));
  const tax = {
    code: String(originalTax?.code || "2"),
    percentageCode: String(originalTax?.percentageCode || "0"),
    rate,
    taxableBase: taxable,
    value: taxValue
  };
  return {
    companyId,
    emissionPointId,
    documentType: "04",
    issueDate,
    sourceOrderDate: invoice.issue_date,
    parentDocumentId: invoice.id,
    sourcePayload: {
      buyer: original.buyer || invoice.buyer_snapshot,
      creditNote: {
        currency: original.invoice?.currency || "USD",
        totalWithoutTax: taxable,
        modificationValue: Number((taxable + taxValue).toFixed(2)),
        reason: "AJUSTE PARCIAL DE CERTIFICACION EN AMBIENTE DE PRUEBAS"
      },
      lines: [{
        mainCode: originalLine?.mainCode || "ITEM-QA",
        auxiliaryCode: originalLine?.auxiliaryCode || "QA",
        description: originalLine?.description || "AJUSTE DE PRUEBA",
        quantity: 1,
        unitPrice: taxable,
        discount: 0,
        subtotal: taxable,
        taxes: [tax]
      }],
      taxes: [tax],
      originalInvoice: {
        id: invoice.id,
        status: "AUTORIZADO",
        fullNumber: invoice.full_number,
        issueDate: invoice.issue_date,
        grandTotal: Number(original.invoice?.grandTotal || taxable + taxValue),
        creditedTotal: 0
      },
      additionalInformation: { Observacion: "NOTA DE CREDITO DE PRUEBA" }
    }
  };
}

assert.equal(CONFIRMATION, "YES", "Defina SRI_CERTIFICATION_CONFIRM=YES para consumir secuenciales y transmitir a SRI TEST.");
assert.ok(ANON_KEY, "Falta SRI_SUPABASE_ANON_KEY.");
assert.ok(ADMIN_PASSWORD, "Falta SRI_ADMIN_PASSWORD.");

const issueDate = process.env.SRI_TEST_ISSUE_DATE || ecuadorDate();
const report = {
  ok: false,
  environment: "TEST",
  issueDate,
  api: API_BASE,
  invoice: null,
  localCreditNote: null,
  exportInvoice: null,
  exportCreditNote: null,
  withholding: null
};

try {
  const token = await authenticate();
  const [blessConfiguration, imperioConfiguration] = await Promise.all([
    sriRequest(token, "GET", "configuration", COMPANIES.bless.id),
    sriRequest(token, "GET", "configuration", COMPANIES.imperio.id)
  ]);
  [blessConfiguration, imperioConfiguration].forEach(configuration => {
    assert.equal(configuration.settings.environment, "TEST");
    assert.equal(configuration.settings.production_enabled, false);
    assert.ok(configuration.certificates.some(item => item.active && item.validation_status === "VALID"));
  });

  const imperioPoint = pointFor(imperioConfiguration, COMPANIES.imperio.point);
  const blessPoint = pointFor(blessConfiguration, COMPANIES.bless.point);

  const invoicePrepared = await createGenerateSign(token, invoiceInput(issueDate, imperioPoint.id));
  report.invoice = terminalSummary(invoicePrepared);
  const invoiceResult = await transmitUntilTerminal(
    token,
    COMPANIES.imperio.id,
    invoicePrepared.document.id,
    TRANSMIT_ATTEMPTS
  );
  report.invoice = terminalSummary(invoiceResult);
  if (invoiceResult.document.status !== "AUTORIZADO") {
    throw new RemoteError(`La factura de prueba termino en ${invoiceResult.document.status}; no se emitira una retencion sobre un comprobante no autorizado.`, {
      code: "INVOICE_NOT_AUTHORIZED",
      details: report.invoice
    });
  }

  const localCreditPrepared = await createGenerateSign(
    token,
    creditNoteInput(issueDate, imperioPoint.id, invoiceResult, COMPANIES.imperio.id)
  );
  const localCreditResult = await transmitUntilTerminal(
    token, COMPANIES.imperio.id, localCreditPrepared.document.id, TRANSMIT_ATTEMPTS
  );
  report.localCreditNote = terminalSummary(localCreditResult);
  if (localCreditResult.document.status !== "AUTORIZADO") {
    throw new RemoteError(`La nota de credito local termino en ${localCreditResult.document.status}.`, {
      code: "LOCAL_CREDIT_NOTE_NOT_AUTHORIZED", details: report.localCreditNote
    });
  }

  const exportPrepared = await createGenerateSign(token, exportInvoiceInput(issueDate, blessPoint.id));
  const exportResult = await transmitUntilTerminal(
    token, COMPANIES.bless.id, exportPrepared.document.id, TRANSMIT_ATTEMPTS
  );
  report.exportInvoice = terminalSummary(exportResult);
  if (exportResult.document.status !== "AUTORIZADO") {
    throw new RemoteError(`La factura de exportacion termino en ${exportResult.document.status}.`, {
      code: "EXPORT_INVOICE_NOT_AUTHORIZED", details: report.exportInvoice
    });
  }

  const exportCreditPrepared = await createGenerateSign(
    token,
    creditNoteInput(issueDate, blessPoint.id, exportResult, COMPANIES.bless.id)
  );
  const exportCreditResult = await transmitUntilTerminal(
    token, COMPANIES.bless.id, exportCreditPrepared.document.id, TRANSMIT_ATTEMPTS
  );
  report.exportCreditNote = terminalSummary(exportCreditResult);
  if (exportCreditResult.document.status !== "AUTORIZADO") {
    throw new RemoteError(`La nota de credito de exportacion termino en ${exportCreditResult.document.status}.`, {
      code: "EXPORT_CREDIT_NOTE_NOT_AUTHORIZED", details: report.exportCreditNote
    });
  }

  const withholdingPrepared = await createGenerateSign(
    token,
    withholdingInput(issueDate, blessPoint.id, invoiceResult)
  );
  report.withholding = terminalSummary(withholdingPrepared);
  const withholdingResult = await transmitUntilTerminal(
    token,
    COMPANIES.bless.id,
    withholdingPrepared.document.id,
    TRANSMIT_ATTEMPTS
  );
  report.withholding = terminalSummary(withholdingResult);
  report.ok = withholdingResult.document.status === "AUTORIZADO";
  if (!report.ok) {
    throw new RemoteError(`La retencion de prueba termino en ${withholdingResult.document.status}.`, {
      code: "WITHHOLDING_NOT_AUTHORIZED",
      details: report.withholding
    });
  }
} catch (error) {
  report.error = {
    code: error.code || error.name,
    message: error.message,
    retryable: Boolean(error.retryable),
    details: error.details || null
  };
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
