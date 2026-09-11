const { randomUUID } = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");
const { generateAccountingForDocument } = require("./accounting-service.cjs");
const { loadArtifact, sha256, storeArtifact } = require("./artifact-store.cjs");
const { dbError, getDocumentDetail, transition } = require("./document-service.cjs");
const { SriError, SriTransportError, SriValidationError } = require("./errors.cjs");
const { validateAccessKey } = require("./access-key.cjs");
const { assertEnvironmentEnabled, assertDocumentEnvironment, environmentCode, authorizationEnvironmentLabel, endpointFor } = require("./environment.cjs");
const { assertCanonicalDocumentIdentity, assertDocumentXmlIdentity } = require("./xml-identity.cjs");
const { generateRidePdf } = require("./ride.cjs");
const { diagnosticMessage, recoveryPolicy } = require("./recovery-policy.cjs");
const { withholdingDateRecovery, definitiveAuthorizationAbsent } = require("./withholding-date-recovery.cjs");
const { queryAuthorization, sendForReception } = require("./sri-soap.cjs");
const { UNCERTAIN, DEFINITE, safeText, nativeDiagnostic } = require("./transport-diagnostic.cjs");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORIZED_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true
});

function canonicalText(value) {
  return String(value ?? "").trim();
}

function accessKeyIdentity(accessKey) {
  const value = canonicalText(accessKey);
  if (!validateAccessKey(value)) return null;
  return {
    accessKey: value,
    environmentCode: value[23],
    documentType: value.slice(8, 10),
    ruc: value.slice(10, 23),
    establishment: value.slice(24, 27),
    emissionPoint: value.slice(27, 30),
    sequential: value.slice(30, 39)
  };
}

function authorizedXmlIdentity(xml) {
  if (!canonicalText(xml)) return null;
  let parsed;
  try {
    parsed = AUTHORIZED_XML_PARSER.parse(String(xml));
  } catch (error) {
    return { parseError: error?.message || "INVALID_XML" };
  }
  const root = parsed?.factura || parsed?.notaCredito || parsed?.comprobanteRetencion || parsed?.guiaRemision;
  const info = root?.infoTributaria;
  if (!info || typeof info !== "object") return { parseError: "SRI_AUTHORIZED_XML_IDENTITY_NOT_FOUND" };
  return {
    accessKey: canonicalText(info.claveAcceso),
    environmentCode: canonicalText(info.ambiente),
    documentType: canonicalText(info.codDoc),
    ruc: canonicalText(info.ruc),
    establishment: canonicalText(info.estab),
    emissionPoint: canonicalText(info.ptoEmi),
    sequential: canonicalText(info.secuencial)
  };
}

function validateAuthorizationIdentity(document, result) {
  const environment = assertDocumentEnvironment(document);
  const sequentialText = canonicalText(document.sequential_text);
  const expected = {
    accessKey: canonicalText(document.access_key),
    environmentCode: environmentCode(environment),
    documentType: canonicalText(document.document_type),
    ruc: canonicalText(document.issuer_snapshot?.ruc),
    establishment: canonicalText(document.establishment_code),
    emissionPoint: canonicalText(document.emission_point_code),
    sequential: sequentialText ? sequentialText.padStart(9, "0") : ""
  };
  const responseIdentity = accessKeyIdentity(result.accessKey);
  const mismatches = [];
  const compare = (source, field, actual) => {
    if (!expected[field] || !actual || expected[field] !== actual) {
      mismatches.push({ source, field, expected: expected[field] || null, actual: actual || null });
    }
  };

  compare("authorization_response", "accessKey", canonicalText(result.accessKey));
  if ((result.authorized || result.state === "AUTORIZADO")
      && (typeof result.authorizationNumber !== "string"
        || result.authorizationNumber !== document.access_key
        || !validateAccessKey(result.authorizationNumber))) {
    mismatches.push({ source: "authorization_response", field: "authorizationNumber", expected: "SAME_VALID_ACCESS_KEY", actual: "INVALID_AUTHORIZATION_NUMBER" });
  }
  if (!responseIdentity) {
    mismatches.push({ source: "authorization_response", field: "accessKeyFormat", expected: "49_DIGITS", actual: canonicalText(result.accessKey) || null });
  } else {
    ["environmentCode", "documentType", "ruc", "establishment", "emissionPoint", "sequential"].forEach(field => {
      compare("authorization_access_key", field, responseIdentity[field]);
    });
  }

  const reportedEnvironment = canonicalText(result.environment).toUpperCase();
  const acceptedLabels = environment === "TEST" ? ["PRUEBAS", "TEST", "1"] : ["PRODUCCION", "PRODUCCIÓN", "PRODUCTION", "2"];
  if ((result.authorized || ["NO AUTORIZADO", "NO_AUTORIZADO"].includes(result.state) || reportedEnvironment)
      && !acceptedLabels.includes(reportedEnvironment)) {
    mismatches.push({ source: "authorization_response", field: "environment", expected: authorizationEnvironmentLabel(environment), actual: safeText(reportedEnvironment) || null });
  }

  if (canonicalText(result.authorizedXml)) {
    const xmlIdentity = authorizedXmlIdentity(result.authorizedXml);
    if (xmlIdentity?.parseError) {
      mismatches.push({ source: "authorized_xml", field: "identity", expected: "VALID_CANONICAL_IDENTITY", actual: xmlIdentity.parseError });
    } else {
      ["accessKey", "environmentCode", "documentType", "ruc", "establishment", "emissionPoint", "sequential"].forEach(field => {
        compare("authorized_xml", field, xmlIdentity?.[field]);
      });
    }
    try { assertDocumentXmlIdentity(document, result.authorizedXml); }
    catch { mismatches.push({ source: "authorized_xml", field: "identity", expected: "VALID_CANONICAL_IDENTITY", actual: "INVALID_CANONICAL_IDENTITY" }); }
  } else if (result.authorized) {
    mismatches.push({ source: "authorized_xml", field: "identity", expected: "VALID_CANONICAL_IDENTITY", actual: null });
  }

  if (mismatches.length) {
    throw new SriError("La autorización devuelta por el SRI no corresponde al comprobante consultado.", {
      code: "SRI_AUTHORIZATION_IDENTITY_MISMATCH",
      httpStatus: 409,
      retryable: false,
      details: { mismatches }
    });
  }
  return true;
}

function hasSriIdentifier(messages, expectedIdentifier) {
  return (Array.isArray(messages) ? messages : []).some(message => {
    const match = canonicalText(message?.identifier).match(/\d+/);
    return match?.[0] === String(expectedIdentifier);
  });
}

function retryDelaySeconds(settings, attemptNumber) {
  const initial = Number(settings.retry_initial_seconds || 30);
  const maximum = Number(settings.retry_max_seconds || 1800);
  return Math.min(maximum, initial * (2 ** Math.max(0, Number(attemptNumber || 1) - 1)));
}

async function settingsFor(client, companyId, document) {
  const settings = dbError(await client.from("sri_settings").select("*")
    .eq("company_id", companyId).single(), "Configuracion SRI");
  if (document?.company_id !== companyId) throw new SriValidationError("El comprobante no pertenece a la empresa solicitada.");
  validateTransportSettings(settings, document);
  return settings;
}

function validateTransportSettings(settings, document) {
  const environment = assertDocumentEnvironment(document);
  assertEnvironmentEnabled(settings, environment, document.company_id);
  if (typeof settings.ruc !== "string" || !/^[0-9]{13}$/.test(settings.ruc) || settings.ruc.length !== 13) {
    throw new SriValidationError("La configuracion requiere el RUC canonico de la empresa.");
  }
  assertCanonicalDocumentIdentity(document, { expectedRuc: settings.ruc });
  if (environment === "TEST") {
    for (const [field, type] of [["reception_test_url", "RECEPTION"], ["authorization_test_url", "AUTHORIZATION_QUERY"]]) {
      if (settings[field] != null && settings[field] !== endpointFor(environment, type)) {
        throw new SriValidationError("La configuracion contiene un endpoint distinto del servicio oficial del ambiente.");
      }
    }
  }
  return environment;
}

function assertJobIdentity(job, document, transmissionType = job?.transmission_type, requestFileId = null) {
  const environment = assertDocumentEnvironment(document);
  if (!job || job.company_id !== document.company_id || job.document_id !== document.id
      || job.environment !== environment || job.transmission_type !== transmissionType
      || job.idempotency_key !== `${document.id}:${transmissionType}`
      || job.endpoint_url !== endpointFor(environment, transmissionType)
      || (requestFileId && job.request_file_id !== requestFileId)) {
    throw new SriError("La identidad persistida de la transmision no corresponde al comprobante.", {
      code: "SRI_TRANSMISSION_IDENTITY_MISMATCH", httpStatus: 409, retryable: false
    });
  }
  return job;
}

function assertRetryJob(detail, selectedJob) {
  if (!selectedJob) throw new SriValidationError("El trabajador SRI requiere una transmision persistida.");
  const persisted = detail.transmissions.find(job => job.id === selectedJob.id);
  assertJobIdentity(persisted, detail.document);
  for (const field of ["company_id", "document_id", "environment", "transmission_type", "endpoint_url"]) {
    if (persisted[field] !== selectedJob[field]) {
      throw new SriValidationError("La transmision seleccionada por el trabajador cambio de identidad.");
    }
  }
  const dueAt = new Date(persisted.next_attempt_at || "invalid").getTime();
  if (!["PENDING", "RETRY_SCHEDULED"].includes(persisted.status)
      || !(persisted.attempt_number < persisted.max_attempts)
      || !Number.isFinite(dueAt) || dueAt > Date.now()) {
    throw new SriTransportError("La transmision seleccionada ya no esta disponible para este reintento.", {
      code: "SRI_TRANSMISSION_NOT_DUE", retryable: true
    });
  }
  return persisted;
}

async function transportPreflight(client, settings, document, actorUserId) {
  validateTransportSettings(settings, document);
  const company = dbError(await client.from("companies").select("id, tax_id, is_active")
    .eq("id", document.company_id).maybeSingle(), "Empresa canonica SRI");
  if (company?.id !== document.company_id || company.is_active !== true || company.tax_id !== settings.ruc) {
    throw new SriValidationError("La transmision requiere una empresa activa y su RUC canonico.");
  }
  if (!actorUserId) throw new SriValidationError("La transmision requiere un actor autorizado de la empresa.");
  const allowed = dbError(await client.rpc("erp_sri_assert_transport_actor", {
    p_company_id: document.company_id, p_actor_user_id: actorUserId
  }), "Autoridad canonica de transmision SRI");
  if (allowed !== true) throw new SriError("El actor no tiene autorizacion vigente para transmitir comprobantes de esta empresa.", {
    code: "SRI_TRANSPORT_ACTOR_DENIED", httpStatus: 403, retryable: false
  });
}

async function ensureJob(client, document, settings, transmissionType, requestFileId = null) {
  const environment = validateTransportSettings(settings, document);
  const endpoint = endpointFor(environment, transmissionType);
  const idempotencyKey = `${document.id}:${transmissionType}`;
  let job = dbError(await client.from("sri_transmissions").select("*")
    .eq("idempotency_key", idempotencyKey).maybeSingle(), "Busqueda de transmision");
  if (!job) {
    job = dbError(await client.from("sri_transmissions").insert({
      company_id: document.company_id,
      document_id: document.id,
      transmission_type: transmissionType,
      environment,
      endpoint_url: endpoint,
      status: "PENDING",
      idempotency_key: idempotencyKey,
      attempt_number: 0,
      max_attempts: settings.retry_max_attempts,
      request_file_id: requestFileId,
      next_attempt_at: new Date().toISOString()
    }).select().single(), "Creacion de transmision");
  }
  return assertJobIdentity(job, document, transmissionType, requestFileId);
}

function claimResult(result, job, label = "Toma atomica de transmision") {
  const databaseCode = String(result?.error?.code || "");
  const databaseMessage = String(result?.error?.message || "");
  if (databaseMessage === "SRI_MANAGER_WAIT_SCHEDULED" || databaseMessage === "SRI_MANAGER_MANUAL_REVIEW_REQUIRED" || databaseMessage === "SRI_MANAGER_CORRECTION_IN_PROGRESS") {
    throw new SriError(databaseMessage === "SRI_MANAGER_WAIT_SCHEDULED" ? "Espere hasta la próxima consulta programada." : "Los reintentos de este comprobante requieren revisión manual.", {
      code: databaseMessage, httpStatus: 409, retryable: false, details: { nextAttemptAt: job.next_attempt_at || null }
    });
  }
  if (databaseMessage === "SRI_MANUAL_AUTHORIZATION_CLAIM_LOST") {
    throw new SriTransportError("La consulta de este comprobante terminó o está siendo atendida por otro proceso. Consulte su estado en unos segundos.", {
      code: "SRI_MANUAL_AUTHORIZATION_CLAIM_LOST", httpStatus: 409, retryable: true,
      details: { stage: job.transmission_type, databaseCode, databaseMessage, retryAfterSeconds: 30 }
    });
  }
  if (["SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE", "SRI_TRANSMISSION_ATTEMPTS_EXHAUSTED"].includes(databaseMessage)) {
    throw new SriError("Este comprobante no admite otro intento automático. Revise su respuesta SRI antes de continuar.", {
      code: databaseMessage, httpStatus: 409, retryable: false,
      details: { stage: job.transmission_type, databaseCode, databaseMessage }
    });
  }
  if (databaseCode === "55P03") {
    const notDue = /NOT_DUE|COOLDOWN/.test(databaseMessage);
    const exhausted = databaseMessage === "SRI_TRANSMISSION_NOT_CLAIMABLE" && job.status === "FAILED";
    let retryAfterSeconds = 30;
    try { retryAfterSeconds = Math.min(30, Math.max(1, Number(JSON.parse(result.error.hint)?.retryAfterSeconds) || 30)); } catch {}
    throw new SriTransportError(exhausted
      ? "Los intentos automáticos de este comprobante terminaron. Consulte su autorización con la misma clave de acceso."
      : notDue
        ? "La consulta de este comprobante tiene una espera programada. Intente nuevamente en unos segundos."
        : "Este comprobante está siendo procesado. Intente nuevamente en unos segundos.", {
      code: exhausted ? "SRI_TRANSMISSION_NOT_CLAIMABLE" : notDue ? "SRI_TRANSMISSION_NOT_DUE" : "SRI_TRANSMISSION_ALREADY_PROCESSING",
      httpStatus: 409,
      retryable: !exhausted,
      details: { stage: job.transmission_type, databaseCode, databaseMessage, retryAfterSeconds }
    });
  }
  return dbError(result, label);
}

async function claimManualAuthorization(client, job, document, actorUserId) {
  const workerId = `manual-auth-${randomUUID()}`;
  const claimed = claimResult(await client.rpc("claim_sri_manual_authorization", {
    p_transmission_id: job.id, p_worker_id: workerId,
    p_company_id: document.company_id, p_document_id: document.id, p_actor_user_id: actorUserId
  }), job, "Consulta manual de autorización SRI");
  assertJobIdentity(claimed, document, "AUTHORIZATION_QUERY");
  const attempt = claimed.claim_attempt;
  if (claimed.manual_recovery !== true || claimed.status !== "PROCESSING" || claimed.worker_id !== workerId
      || claimed.id !== job.id || claimed.attempt_number !== job.attempt_number || claimed.max_attempts !== job.max_attempts
      || !attempt?.id || attempt.status !== "STARTED" || attempt.transmission_id !== job.id
      || attempt.company_id !== document.company_id || attempt.document_id !== document.id
      || attempt.endpoint_url !== job.endpoint_url || attempt.request_sha256 !== sha256(document.access_key)
      || !Number.isInteger(attempt.attempt_number) || attempt.attempt_number <= job.attempt_number) {
    throw new SriValidationError("SRI_MANUAL_AUTHORIZATION_CANONICAL_ACK_REQUIRED");
  }
  return claimed;
}

async function assertManualAuthorizationClaim(client, job, attempt, actorUserId) {
  if (!job.manual_recovery) return;
  const allowed = claimResult(await client.rpc("assert_sri_manual_authorization_claim", {
    p_transmission_id: job.id, p_worker_id: job.worker_id,
    p_attempt_id: attempt.id, p_actor_user_id: actorUserId
  }), job, "Vigencia de consulta manual SRI");
  if (allowed !== true) throw new SriTransportError("Otro proceso está trabajando este comprobante. Consulte su estado en unos segundos.", {
    code: "SRI_TRANSMISSION_ALREADY_PROCESSING", httpStatus: 409, retryable: true,
    details: { stage: "AUTHORIZATION_QUERY", retryAfterSeconds: 30 }
  });
}

async function settleAuthorizationJob(client, job, attempt, actorUserId, responseHash, error = null) {
  if (!job.manual_recovery) {
    await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: responseHash, http_status: 200 });
    return completeJob(client, job);
  }
  const settled = claimResult(await client.rpc("settle_sri_manual_authorization", {
    p_transmission_id: job.id, p_worker_id: job.worker_id, p_attempt_id: attempt.id, p_actor_user_id: actorUserId,
    p_success: !error, p_response_sha256: responseHash || null,
    p_http_status: error ? error.details?.transport?.httpStatus || null : 200,
    p_error_class: error ? error.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH" ? error.code : "SRI_TRANSPORT_RESULT_UNCERTAIN" : null,
    p_error_message: error ? safeText(error.message) : null
  }), job, "Cierre canónico de consulta manual SRI");
  if (!settled || settled.manual_recovery !== true || settled.status !== (error ? "FAILED" : "COMPLETED")
      || settled.next_attempt_at !== null
      || ["id", "company_id", "document_id", "environment", "transmission_type", "endpoint_url", "idempotency_key",
        "worker_id", "attempt_number", "max_attempts"].some(field => settled[field] !== job[field])) {
    throw new SriError("No se recibió la confirmación canónica del cierre de la consulta SRI. Consulte el estado del comprobante.", {
      code: "SRI_MANUAL_AUTHORIZATION_CANONICAL_ACK_REQUIRED", httpStatus: 409, retryable: false
    });
  }
  return settled;
}

async function claimJob(client, job, force = false) {
  if (["COMPLETED", "RECEIVED"].includes(job.status)) return null;
  const nextAttemptAt = job.next_attempt_at ? new Date(job.next_attempt_at) : null;
  if (!force && nextAttemptAt && nextAttemptAt.getTime() > Date.now()) {
    throw new SriTransportError("La autorizacion SRI sigue pendiente y tiene un reintento programado.", {
      code: "SRI_TRANSMISSION_NOT_DUE",
      retryable: true,
      details: {
        stage: job.transmission_type,
        nextAttemptAt: job.next_attempt_at
      }
    });
  }
  if (force && job.status === "RETRY_SCHEDULED") {
    job = dbError(await client.from("sri_transmissions").update({ next_attempt_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "RETRY_SCHEDULED").select().single(), "Reintento inmediato");
  }
  const claimed = claimResult(await client.rpc("claim_sri_transmission", {
    p_transmission_id: job.id,
    p_worker_id: `api-${randomUUID()}`
  }), job);
  if (!claimed) {
    throw new SriTransportError("La transmision SRI esta siendo procesada por otro intento. Espere unos segundos y vuelva a consultar.", {
      code: "SRI_TRANSMISSION_ALREADY_PROCESSING",
      retryable: true,
      details: { stage: job.transmission_type }
    });
  }
  return claimed;
}

async function beginAttempt(client, job, requestHash) {
  return dbError(await client.from("sri_transmission_attempts").insert({
    company_id: job.company_id,
    document_id: job.document_id,
    transmission_id: job.id,
    attempt_number: job.attempt_number,
    status: "STARTED",
    endpoint_url: job.endpoint_url,
    request_sha256: requestHash
  }).select().single(), "Registro de intento SRI");
}

async function finishAttempt(client, attempt, patch) {
  return dbError(await client.from("sri_transmission_attempts").update({
    ...patch,
    finished_at: new Date().toISOString()
  }).eq("id", attempt.id).select().single(), "Cierre de intento SRI");
}

async function persistResponse(client, document, job, responseType, fileType, rawXml, payload, messages, actorUserId) {
  const artifact = await storeArtifact(client, {
    companyId: document.company_id,
    documentId: document.id,
    fileType,
    content: rawXml,
    schemaVersion: document.xml_version,
    createdBy: actorUserId
  });
  const hash = sha256(rawXml);
  let response = dbError(await client.from("sri_responses").upsert({
    company_id: document.company_id,
    document_id: document.id,
    transmission_id: job.id,
    response_type: responseType,
    sri_status: payload.state,
    raw_xml: rawXml,
    payload,
    content_sha256: hash
  }, { onConflict: "document_id,response_type,content_sha256", ignoreDuplicates: true })
    .select().maybeSingle(), "Respuesta SRI");
  if (!response) {
    response = dbError(await client.from("sri_responses").select("*")
      .eq("document_id", document.id).eq("response_type", responseType)
      .eq("content_sha256", hash).single(), "Respuesta SRI existente");
  }
  const existingErrors = dbError(await client.from("sri_error_messages").select("id")
    .eq("response_id", response.id).limit(1), "Mensajes SRI existentes");
  if (!existingErrors.length && messages?.length) {
    dbError(await client.from("sri_error_messages").insert(messages.map(message => ({
      company_id: document.company_id,
      document_id: document.id,
      transmission_id: job.id,
      response_id: response.id,
      stage: responseType,
      identifier: message.identifier || null,
      message_type: message.type || null,
      message: message.message || "Mensaje SRI",
      additional_information: message.additionalInformation || null,
      retryable: false
    }))), "Mensajes de respuesta SRI");
  }
  return { response, artifact, hash };
}

async function ensureRide(client, detail, actorUserId) {
  if (detail.files.some(file => file.file_type === "RIDE_PDF")) return detail;
  try {
    const pdf = await generateRidePdf(detail);
    await storeArtifact(client, {
      companyId: detail.document.company_id,
      documentId: detail.document.id,
      fileType: "RIDE_PDF",
      content: pdf,
      schemaVersion: detail.document.xml_version,
      createdBy: actorUserId
    });
  } catch (error) {
    await client.from("sri_error_messages").insert({
      company_id: detail.document.company_id,
      document_id: detail.document.id,
      stage: "RIDE",
      message_type: "ERROR",
      message: error.message,
      retryable: true
    });
  }
  return getDocumentDetail(client, detail.document.company_id, detail.document.id);
}

async function completeJob(client, job, httpStatus = 200) {
  return dbError(await client.from("sri_transmissions").update({
    status: "COMPLETED",
    http_status: httpStatus,
    finished_at: new Date().toISOString(),
    next_attempt_at: null,
    error_class: null,
    error_message: null
  }).eq("id", job.id).eq("status", "PROCESSING").select().single(), "Finalizacion de transmision");
}

async function scheduleFailure(client, settings, document, job, attempt, error, actorUserId) {
  const transport = error.details?.transport || nativeDiagnostic(error);
  const uncertain = job.transmission_type === "AUTHORIZATION_QUERY" || transport.resultState !== DEFINITE;
  const resultState = uncertain ? UNCERTAIN : DEFINITE;
  const errorClass = `SRI_${resultState}`;
  const message = safeText(error.message);
  const httpStatus = transport.httpStatus || null;
  // The existing audit JSON contract stores bounded technical evidence separately
  // from the human message; no schema or fiscal document identity changes.
  const diagnostic = { ...transport, environment: document.environment, workflowResultState: resultState, nextAction: uncertain ? "AUTHORIZATION_LOOKUP_FIRST" : "RETRY_TRANSMISSION", serviceCode: safeText(error.code || error.name), reason: safeText(error.details?.reason || error.message) };
  error.details = { ...error.details, transport: diagnostic };
  console.error("[sri-transport] failure", JSON.stringify({ documentId: document.id, attemptId: attempt.id, phase: job.transmission_type, transport: diagnostic }));
  const exhausted = job.attempt_number >= job.max_attempts;
  const retryable = error.retryable !== false && !exhausted;
  const delay = retryDelaySeconds(settings, job.attempt_number);
  const nextAttempt = retryable ? new Date(Date.now() + (delay * 1000)).toISOString() : null;
  await finishAttempt(client, attempt, {
    status: retryable ? "RETRY_SCHEDULED" : "FAILED",
    retryable,
    error_class: errorClass,
    error_message: message,
    http_status: httpStatus
  });
  dbError(await client.from("sri_transmissions").update({
    status: retryable ? "RETRY_SCHEDULED" : "FAILED",
    next_attempt_at: nextAttempt,
    error_class: errorClass,
    error_message: message,
    http_status: httpStatus,
    finished_at: new Date().toISOString()
  }).eq("id", job.id).eq("status", "PROCESSING"), "Programacion de reintento");
  dbError(await client.from("electronic_document_audit_logs").insert({
    company_id: document.company_id, document_id: document.id, actor_user_id: actorUserId,
    actor_type: "SYSTEM", action: "TRANSPORT_DIAGNOSTIC", reason: message,
    new_values: { attemptId: attempt.id, transmissionId: job.id, phase: job.transmission_type, transport: diagnostic }
  }), "Diagnostico tecnico de transporte SRI");

  let current = dbError(await client.from("electronic_documents").select("*").eq("id", document.id).single(), "Comprobante tras error");
  if ((retryable || uncertain) && ["ENVIADO_SRI", "RECIBIDO_SRI"].includes(current.status)) {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, message);
  } else if (!retryable && !uncertain && current.status === "PENDIENTE_REINTENTO") {
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, message);
  } else if (!retryable && !uncertain && current.status === "ENVIADO_SRI") {
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, message);
  } else if (!retryable && !uncertain && current.status === "RECIBIDO_SRI") {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, message);
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, message);
  }
  await client.from("electronic_documents").update({ last_error: message }).eq("id", document.id);
  return { document: current, retryable, nextAttempt };
}

async function failAuthorizationAttemptWithoutDocumentMutation(client, job, attempt, error) {
  await finishAttempt(client, attempt, {
    status: "FAILED",
    retryable: false,
    error_class: error.code || error.name,
    error_message: error.message
  });
  dbError(await client.from("sri_transmissions").update({
    status: "FAILED",
    next_attempt_at: null,
    error_class: error.code || error.name,
    error_message: error.message,
    finished_at: new Date().toISOString()
  }).eq("id", job.id).eq("status", "PROCESSING"), "Cierre seguro de consulta SRI");
}

async function normalizeTechnicalRecoveryStatus(client, document, actorUserId) {
  let current = document;
  if (current.status === "ERROR_ENVIO") {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, "Autorización SRI confirmada tras resultado incierto");
  }
  if (current.status === "PENDIENTE_REINTENTO") {
    current = await transition(client, current, "ENVIADO_SRI", actorUserId, "Autorización SRI consultada con la misma clave");
  }
  return current;
}

async function processAuthorization(client, settings, document, actorUserId, options = {}) {
  await transportPreflight(client, settings, document, actorUserId);
  let current = document;
  const recoveryQuery = options.recoveryQuery === true;
  const recoverySourceStatus = ["DEVUELTO", "NO_AUTORIZADO"].includes(current.status);
  const technicalRecoveryStatus = ["ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(current.status);
  if (!["RECIBIDO_SRI", "ENVIADO_SRI"].includes(current.status)
      && !(recoveryQuery && (recoverySourceStatus || technicalRecoveryStatus))) {
    throw new SriValidationError(`No se puede consultar autorizacion desde ${current.status}.`);
  }
  let job = await ensureJob(client, current, settings, "AUTHORIZATION_QUERY");
  if (job.status === "COMPLETED" && !options.managerRecovery) return getDocumentDetail(client, current.company_id, current.id);
  const manualRecovery = (options.managerRecovery === true && !options.retryJob && Boolean(actorUserId)) || (options.manualAuthorizationRecovery === true && !options.retryJob && Boolean(actorUserId)
    && recoveryQuery && current.document_type === "07" && !recoverySourceStatus
    && job.attempt_number >= job.max_attempts
    && ((job.status === "FAILED" && job.error_class === "SRI_TRANSPORT_RESULT_UNCERTAIN")
      || (job.status === "PROCESSING" && String(job.worker_id || "").startsWith("manual-auth-"))));
  job = manualRecovery
    ? await claimManualAuthorization(client, job, current, actorUserId)
    : await claimJob(client, job, options.force);
  assertJobIdentity(job, current, "AUTHORIZATION_QUERY");
  const attempt = manualRecovery ? job.claim_attempt : await beginAttempt(client, job, sha256(current.access_key));
  let requeued = null;
  let manualSettled = false;
  let authorizationResponseHash = null;
  try {
    await assertManualAuthorizationClaim(client, job, attempt, actorUserId);
    if (manualRecovery && options.beforeAuthorizationLookup) await options.beforeAuthorizationLookup({ current, job, attempt });
    const result = await queryAuthorization(current.access_key, {
      environment: current.environment,
      endpoint: job.endpoint_url,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    await assertManualAuthorizationClaim(client, job, attempt, actorUserId);
    validateAuthorizationIdentity(current, result);
    if (technicalRecoveryStatus && (result.authorized || ["NO AUTORIZADO", "NO_AUTORIZADO"].includes(result.state))) {
      current = await normalizeTechnicalRecoveryStatus(client, current, actorUserId);
    }
    const persisted = await persistResponse(
      client, current, job, "AUTHORIZATION", "AUTHORIZATION_RESPONSE",
      result.rawXml, result, result.messages, actorUserId
    );
    authorizationResponseHash = persisted.hash;
    if (result.authorized) {
      await assertManualAuthorizationClaim(client, job, attempt, actorUserId);
      await storeArtifact(client, {
        companyId: current.company_id,
        documentId: current.id,
        fileType: "AUTHORIZED_XML",
        content: result.authorizedXml,
        schemaVersion: current.xml_version,
        createdBy: actorUserId
      });
      await assertManualAuthorizationClaim(client, job, attempt, actorUserId);
      dbError(await client.rpc(recoverySourceStatus ? "record_sri_recovery_authorization" : "record_sri_authorization", {
        p_document_id: current.id,
        p_response_xml: result.rawXml,
        p_authorization_status: "AUTORIZADO",
        p_authorization_number: result.authorizationNumber,
        p_authorization_date: result.authorizationDate,
        p_environment: authorizationEnvironmentLabel(current.environment),
        p_authorized_xml: result.authorizedXml,
        p_actor_user_id: actorUserId
      }), "Autorizacion oficial SRI");
      await settleAuthorizationJob(client, job, attempt, actorUserId, persisted.hash);
      manualSettled = manualRecovery;
      const authorizedDetail = await getDocumentDetail(client, current.company_id, current.id);
      if (options.skipAccounting !== true) await generateAccountingForDocument(client, current.id, actorUserId);
      return ensureRide(client, authorizedDetail, actorUserId);
    }
    if (["NO AUTORIZADO", "NO_AUTORIZADO"].includes(result.state)) {
      await assertManualAuthorizationClaim(client, job, attempt, actorUserId);
      dbError(await client.rpc(recoverySourceStatus ? "record_sri_recovery_authorization" : "record_sri_authorization", {
        p_document_id: current.id,
        p_response_xml: result.rawXml,
        p_authorization_status: "NO AUTORIZADO",
        p_authorization_number: "",
        p_authorization_date: null,
        p_environment: authorizationEnvironmentLabel(current.environment),
        p_authorized_xml: null,
        p_actor_user_id: actorUserId
      }), "Respuesta NO AUTORIZADO");
      await settleAuthorizationJob(client, job, attempt, actorUserId, persisted.hash);
      manualSettled = manualRecovery;
      return getDocumentDetail(client, current.company_id, current.id);
    }
    if (manualRecovery && options.onAuthorizationAbsent && definitiveAuthorizationAbsent(current, result)) {
      return await options.onAuthorizationAbsent({ current, job, attempt, persisted, result });
    }
    const dateRecovery = !manualRecovery && options.manualDateRecovery === true && withholdingDateRecovery(
      await getDocumentDetail(client, current.company_id, current.id)
    );
    if (dateRecovery && definitiveAuthorizationAbsent(current, result)) {
      // Revalidate immutable signed bytes BEFORE the canonical requeue transition.
      const signed = await loadArtifact(client, current.id, "SIGNED_XML");
      if (signed.file.id !== dateRecovery.signedFileId || signed.file.company_id !== current.company_id
          || signed.file.document_id !== current.id || sha256(signed.buffer) !== signed.file.content_sha256) {
        throw new SriValidationError("El XML firmado no corresponde a la retención devuelta.");
      }
      assertDocumentXmlIdentity(current, signed.buffer.toString("utf8"), { expectedRuc: settings.ruc });
      requeued = dbError(await client.rpc("erp_sri_retry_returned_withholding_date", {
        p_company_id: current.company_id, p_document_id: current.id, p_actor_user_id: actorUserId,
        p_lookup_response_id: persisted.response.id, p_lookup_attempt_id: attempt.id,
        p_reception_response_id: dateRecovery.receptionResponseId
      }), "Reintento canónico de retención devuelta por fecha");
      if (!requeued || requeued.document_id !== current.id || requeued.access_key !== current.access_key
          || String(requeued.sequential).padStart(9, "0") !== current.sequential_text
          || requeued.company_id !== current.company_id || requeued.environment !== current.environment) {
        throw new SriValidationError("SRI_DATE_RETRY_CANONICAL_ACK_REQUIRED");
      }
    } else throw new SriTransportError("El comprobante todavia no aparece en autorizacion del SRI.", {
      code: "SRI_AUTHORIZATION_PENDING",
      retryable: true,
      details: { state: result.state, documentCount: result.documentCount, transport: {
        classification: "SOAP", resultState: UNCERTAIN, nextAction: "AUTHORIZATION_LOOKUP_FIRST",
        httpStatus: 200, state: safeText(result.state), documentCount: result.documentCount
      } }
    });
  } catch (error) {
    if (manualRecovery) {
      if (!manualSettled && !options.manualRetryHandoff?.completed && !["SRI_MANUAL_AUTHORIZATION_CLAIM_LOST", "SRI_MANUAL_AUTHORIZATION_CANONICAL_ACK_REQUIRED"].includes(error.code)) {
        await settleAuthorizationJob(client, job, attempt, actorUserId, authorizationResponseHash, error);
      }
      if (error.retryable) error.details = { ...error.details, retryAfterSeconds: 30 };
      throw error;
    }
    if (error?.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH") {
      await failAuthorizationAttemptWithoutDocumentMutation(client, job, attempt, error);
      throw error;
    }
    await scheduleFailure(client, settings, current, job, attempt, error, actorUserId);
    throw error;
  }
  // A reception failure belongs to reception, not to the successfully completed lookup.
  const refreshed = await getDocumentDetail(client, current.company_id, current.id);
  if (requeued?.requeued !== true) return refreshed;
  return processReception(client, settings, refreshed.document, actorUserId, { ...options, force: true });
}

async function processReception(client, settings, document, actorUserId, options = {}) {
  await transportPreflight(client, settings, document, actorUserId);
  let current = document;
  if (!["FIRMADO", "PENDIENTE_REINTENTO", "ERROR_ENVIO", "ENVIADO_SRI"].includes(current.status)) {
    throw new SriValidationError(`No se puede transmitir recepcion desde ${current.status}.`);
  }
  const signed = await loadArtifact(client, current.id, "SIGNED_XML");
  if (signed.file.company_id !== current.company_id || signed.file.document_id !== current.id
      || signed.file.file_type !== "SIGNED_XML" || signed.file.storage_bucket !== "sri-private"
      || signed.file.storage_object_path !== `companies/${current.company_id}/documents/${current.id}/signed_xml-${signed.file.content_sha256}.xml`
      || sha256(signed.buffer) !== signed.file.content_sha256) {
    throw new SriValidationError("El XML firmado almacenado no corresponde al comprobante o a su huella canonica.");
  }
  const signedXml = signed.buffer.toString("utf8");
  assertDocumentXmlIdentity(current, signedXml, { expectedRuc: settings.ruc });
  // Validate existing immutable transport identity before changing document state.
  const manualClaim = options.manualReceptionClaim;
  const assertManual = async () => {
    if (!manualClaim) return;
    const claimRpc = manualClaim.break_glass_same_document === true
      ? 'assert_sri_break_glass_reception_claim'
      : 'assert_sri_manual_reception_claim';
    const ok = dbError(await client.rpc(claimRpc, {
      p_transmission_id: manualClaim.id, p_worker_id: manualClaim.worker_id,
      p_attempt_id: manualClaim.claim_attempt.id, p_actor_user_id: actorUserId
    }), manualClaim.break_glass_same_document === true ? 'Vigencia del reintento extraordinario' : 'Vigencia del reintento manual');
    if (ok !== true) throw new SriError('Otro proceso está trabajando este comprobante.', {code:'SRI_MANUAL_RECEPTION_CLAIM_LOST',httpStatus:409});
  };
  let job = manualClaim || await ensureJob(client, current, settings, "RECEPTION", signed.file.id);
  await assertManual();
  if (job.status === "COMPLETED") {
    const refreshed = dbError(await client.from("electronic_documents").select("*").eq("id", current.id).eq("company_id", current.company_id).single(), "Comprobante recibido");
    return processAuthorization(client, settings, refreshed, actorUserId, options);
  }
  if (current.status === "ERROR_ENVIO") {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, "Reintento manual habilitado");
  }
  if (["FIRMADO", "PENDIENTE_REINTENTO"].includes(current.status)) {
    current = await transition(client, current, "ENVIADO_SRI", actorUserId, "Inicio de transmision a recepcion SRI");
  }
  if (current.status !== "ENVIADO_SRI") {
    throw new SriValidationError(`No se puede transmitir recepcion desde ${current.status}.`);
  }
  job = manualClaim || await claimJob(client, job, options.force);
  assertJobIdentity(job, current, "RECEPTION", signed.file.id);
  const attempt = manualClaim?.claim_attempt || await beginAttempt(client, job, sha256(signedXml));
  // Remove the one-shot hooks before any follow-up authorization; never recurse into reception.
  const followup = manualClaim ? {timeoutMs:options.timeoutMs,fetchImpl:options.fetchImpl,managerRecovery:true,recoveryQuery:true,
    skipAccounting: manualClaim.break_glass_same_document === true} : options;
  try {
    await assertManual();
    const result = await sendForReception(signedXml, {
      document: current,
      environment: current.environment,
      endpoint: job.endpoint_url,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    await assertManual();
    const persisted = await persistResponse(
      client, current, job, "RECEPTION", "RECEPTION_RESPONSE",
      result.rawXml, result, result.messages, actorUserId
    );
    if (result.received) {
      current = await transition(client, current, "RECIBIDO_SRI", actorUserId, "SRI confirmo RECIBIDA", result.messages);
      await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
      await completeJob(client, job);
      return processAuthorization(client, settings, current, actorUserId, followup);
    }
    if (result.returned) {
      if (hasSriIdentifier(result.messages, "43") || (manualClaim && ["45","70"].some(code=>hasSriIdentifier(result.messages,code)))) {
        await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
        await completeJob(client, job);
        return processAuthorization(client, settings, current, actorUserId, {
          ...followup,
          force: true,
          recoveryQuery: true
        });
      }
      const returnedReason = diagnosticMessage(result.messages?.[0] || {}, { last_error: "SRI devolvio el comprobante" });
      await transition(client, current, "DEVUELTO", actorUserId, returnedReason || "SRI devolvio el comprobante", result.messages);
      await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
      await completeJob(client, job);
      return getDocumentDetail(client, current.company_id, current.id);
    }
    throw new SriTransportError(`Estado de recepcion SRI no reconocido: ${safeText(result.state) || "VACIO"}.`, {
      details: { transport: { classification: "SOAP", resultState: UNCERTAIN, nextAction: "AUTHORIZATION_LOOKUP_FIRST", httpStatus: 200, state: safeText(result.state) } }
    });
  } catch (error) {
    if (manualClaim) {
      // Do not attribute a follow-up authorization error to a completed reception.
      const fresh = dbError(await client.from('sri_transmission_attempts').select('*').eq('id',attempt.id).single(), 'Estado del intento manual');
      if (fresh.status !== 'STARTED') throw error;
      await assertManual();
      error.retryable = false; // human retry never replenishes or restarts the automatic loop
    }
    await scheduleFailure(client, settings, current, job, attempt, error, actorUserId);
    throw error;
  }
}

async function transmitDocument(client, companyId, documentId, actorUserId, options = {}) {
  const detail = await getDocumentDetail(client, companyId, documentId);
  const document = detail.document;
  if (document?.company_id !== companyId || document?.id !== documentId) throw new SriValidationError("El comprobante no pertenece a la empresa solicitada.");
  const management = dbError(await client.from('erp_sri_document_management').select('automatic_paused,correction_in_progress')
    .eq('company_id',companyId).eq('document_id',documentId).maybeSingle(), 'Control manual SRI');
  if (management?.automatic_paused || management?.correction_in_progress) {
    throw new SriError('Los envíos automáticos están pausados. Puede consultar o recuperar el mismo comprobante.',{code:'SRI_MANAGER_MANUAL_REVIEW_REQUIRED',httpStatus:409,retryable:false});
  }
  for (const job of detail.transmissions) assertJobIdentity(job, document);
  if (options.retryJob || !actorUserId) {
    assertRetryJob(detail, options.retryJob);
    // The service worker rechecks the persisted creator's current membership and
    // canonical capability. A revoked creator never becomes an anonymous bypass.
    actorUserId = document.created_by;
  }
  const policy = recoveryPolicy(detail);
  if (policy.action === "QUERY_AUTHORIZATION") {
    const settings = await settingsFor(client, companyId, document);
    return processAuthorization(client, settings, document, actorUserId, {
      ...options,
      manualDateRecovery: !options.retryJob && Boolean(actorUserId),
      manualAuthorizationRecovery: !options.retryJob && Boolean(actorUserId),
      force: options.force === true,
      recoveryQuery: true
    });
  }
  if (["AUTORIZADO", "NO_AUTORIZADO", "DEVUELTO", "ANULADO"].includes(document.status)) return detail;
  const settings = await settingsFor(client, companyId, document);
  const authorizationJob = detail.transmissions.find(job =>
    job.transmission_type === "AUTHORIZATION_QUERY" && ["PENDING", "PROCESSING", "RETRY_SCHEDULED"].includes(job.status)
  );
  if (document.status === "RECIBIDO_SRI" || (document.status === "PENDIENTE_REINTENTO" && authorizationJob)) {
    return processAuthorization(client, settings, document, actorUserId, options);
  }
  return processReception(client, settings, document, actorUserId, options);
}

async function queryDocumentStatus(client, companyId, documentId, actorUserId, options = {}) {
  const detail = await getDocumentDetail(client, companyId, documentId);
  for (const job of detail.transmissions) assertJobIdentity(job, detail.document);
  const policy = recoveryPolicy(detail);
  if (policy.action !== "QUERY_AUTHORIZATION") {
    throw new SriValidationError(policy.reason || "El comprobante no admite consulta de recuperación.");
  }
  const settings = await settingsFor(client, companyId, detail.document);
  return processAuthorization(client, settings, detail.document, actorUserId, {
    ...options,
    manualDateRecovery: Boolean(actorUserId),
    manualAuthorizationRecovery: Boolean(actorUserId) && !options.retryJob,
    force: true,
    recoveryQuery: true
  });
}

async function prepareDocumentCorrection(client, companyId, documentId, actorUserId, operationId) {
  if (!UUID_PATTERN.test(String(operationId || ""))) {
    throw new SriValidationError("operation_id es obligatorio para preparar una corrección SRI.");
  }
  const detail = await getDocumentDetail(client, companyId, documentId);
  const policy = recoveryPolicy(detail);
  if (policy.action !== "PREPARE_CORRECTION") {
    throw new SriValidationError(policy.reason || "El comprobante no admite preparación de corrección.");
  }
  dbError(await client.rpc("prepare_sri_document_correction", {
    p_document_id: documentId,
    p_operation_id: operationId,
    p_actor_user_id: actorUserId
  }), "Preparación auditada de corrección SRI");
  const refreshed = await getDocumentDetail(client, companyId, documentId);
  return { ...refreshed, correctionPrepared: true, operationId };
}

module.exports = {
  retryDelaySeconds,
  settingsFor,
  validateTransportSettings,
  assertJobIdentity,
  assertRetryJob,
  transportPreflight,
  ensureJob,
  claimJob,
  transmitDocument,
  queryDocumentStatus,
  prepareDocumentCorrection,
  processReception,
  processAuthorization,
  accessKeyIdentity,
  authorizedXmlIdentity,
  validateAuthorizationIdentity,
  hasSriIdentifier
};
