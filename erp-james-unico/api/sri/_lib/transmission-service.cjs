const { randomUUID } = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");
const { generateAccountingForDocument } = require("./accounting-service.cjs");
const { loadArtifact, sha256, storeArtifact } = require("./artifact-store.cjs");
const { dbError, getDocumentDetail, transition } = require("./document-service.cjs");
const { SriError, SriTransportError, SriValidationError } = require("./errors.cjs");
const { generateRidePdf } = require("./ride.cjs");
const { diagnosticMessage, recoveryPolicy } = require("./recovery-policy.cjs");
const { TEST_ENDPOINTS, queryAuthorization, sendForReception } = require("./sri-soap.cjs");

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
  if (!/^\d{49}$/.test(value)) return null;
  return {
    accessKey: value,
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
    documentType: canonicalText(info.codDoc),
    ruc: canonicalText(info.ruc),
    establishment: canonicalText(info.estab),
    emissionPoint: canonicalText(info.ptoEmi),
    sequential: canonicalText(info.secuencial)
  };
}

function validateAuthorizationIdentity(document, result) {
  const sequentialText = canonicalText(document.sequential_text);
  const expected = {
    accessKey: canonicalText(document.access_key),
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
  if (!responseIdentity) {
    mismatches.push({ source: "authorization_response", field: "accessKeyFormat", expected: "49_DIGITS", actual: canonicalText(result.accessKey) || null });
  } else {
    ["documentType", "ruc", "establishment", "emissionPoint", "sequential"].forEach(field => {
      compare("authorization_access_key", field, responseIdentity[field]);
    });
  }

  if (canonicalText(result.authorizedXml)) {
    const xmlIdentity = authorizedXmlIdentity(result.authorizedXml);
    if (xmlIdentity?.parseError) {
      mismatches.push({ source: "authorized_xml", field: "identity", expected: "VALID_CANONICAL_IDENTITY", actual: xmlIdentity.parseError });
    } else {
      ["accessKey", "documentType", "ruc", "establishment", "emissionPoint", "sequential"].forEach(field => {
        compare("authorized_xml", field, xmlIdentity?.[field]);
      });
    }
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

async function settingsFor(client, companyId) {
  const settings = dbError(await client.from("sri_settings").select("*")
    .eq("company_id", companyId).single(), "Configuracion SRI");
  if (settings.environment !== "TEST" || settings.production_enabled || settings.test_enabled !== true) {
    throw new SriValidationError("La transmision SRI esta restringida al ambiente de pruebas.");
  }
  return settings;
}

async function ensureJob(client, document, settings, transmissionType, requestFileId = null) {
  const endpoint = transmissionType === "RECEPTION"
    ? (settings.reception_test_url || TEST_ENDPOINTS.reception)
    : (settings.authorization_test_url || TEST_ENDPOINTS.authorization);
  const idempotencyKey = `${document.id}:${transmissionType}`;
  let job = dbError(await client.from("sri_transmissions").select("*")
    .eq("idempotency_key", idempotencyKey).maybeSingle(), "Busqueda de transmision");
  if (!job) {
    job = dbError(await client.from("sri_transmissions").insert({
      company_id: document.company_id,
      document_id: document.id,
      transmission_type: transmissionType,
      environment: "TEST",
      endpoint_url: endpoint,
      status: "PENDING",
      idempotency_key: idempotencyKey,
      attempt_number: 0,
      max_attempts: settings.retry_max_attempts,
      request_file_id: requestFileId,
      next_attempt_at: new Date().toISOString()
    }).select().single(), "Creacion de transmision");
  }
  return job;
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
  const claimed = dbError(await client.rpc("claim_sri_transmission", {
    p_transmission_id: job.id,
    p_worker_id: `api-${randomUUID()}`
  }), "Toma atomica de transmision");
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
  const exhausted = job.attempt_number >= job.max_attempts;
  const retryable = error.retryable !== false && !exhausted;
  const delay = retryDelaySeconds(settings, job.attempt_number);
  const nextAttempt = retryable ? new Date(Date.now() + (delay * 1000)).toISOString() : null;
  await finishAttempt(client, attempt, {
    status: retryable ? "RETRY_SCHEDULED" : "FAILED",
    retryable,
    error_class: error.code || error.name,
    error_message: error.message
  });
  dbError(await client.from("sri_transmissions").update({
    status: retryable ? "RETRY_SCHEDULED" : "FAILED",
    next_attempt_at: nextAttempt,
    error_class: error.code || error.name,
    error_message: error.message,
    finished_at: new Date().toISOString()
  }).eq("id", job.id).eq("status", "PROCESSING"), "Programacion de reintento");

  let current = dbError(await client.from("electronic_documents").select("*").eq("id", document.id).single(), "Comprobante tras error");
  if (retryable && ["ENVIADO_SRI", "RECIBIDO_SRI"].includes(current.status)) {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, error.message);
  } else if (!retryable && current.status === "PENDIENTE_REINTENTO") {
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, error.message);
  } else if (!retryable && current.status === "ENVIADO_SRI") {
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, error.message);
  } else if (!retryable && current.status === "RECIBIDO_SRI") {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, error.message);
    current = await transition(client, current, "ERROR_ENVIO", actorUserId, error.message);
  }
  await client.from("electronic_documents").update({ last_error: error.message }).eq("id", document.id);
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
  let current = document;
  const recoveryQuery = options.recoveryQuery === true;
  const recoverySourceStatus = ["DEVUELTO", "NO_AUTORIZADO"].includes(current.status);
  const technicalRecoveryStatus = ["ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(current.status);
  if (!["RECIBIDO_SRI", "ENVIADO_SRI"].includes(current.status)
      && !(recoveryQuery && (recoverySourceStatus || technicalRecoveryStatus))) {
    throw new SriValidationError(`No se puede consultar autorizacion desde ${current.status}.`);
  }
  let job = await ensureJob(client, current, settings, "AUTHORIZATION_QUERY");
  if (job.status === "COMPLETED") return getDocumentDetail(client, current.company_id, current.id);
  job = await claimJob(client, job, options.force);
  const attempt = await beginAttempt(client, job, sha256(current.access_key));
  try {
    const result = await queryAuthorization(current.access_key, {
      endpoint: job.endpoint_url,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    validateAuthorizationIdentity(current, result);
    if (technicalRecoveryStatus && (result.authorized || ["NO AUTORIZADO", "NO_AUTORIZADO"].includes(result.state))) {
      current = await normalizeTechnicalRecoveryStatus(client, current, actorUserId);
    }
    const persisted = await persistResponse(
      client, current, job, "AUTHORIZATION", "AUTHORIZATION_RESPONSE",
      result.rawXml, result, result.messages, actorUserId
    );
    if (result.authorized) {
      await storeArtifact(client, {
        companyId: current.company_id,
        documentId: current.id,
        fileType: "AUTHORIZED_XML",
        content: result.authorizedXml,
        schemaVersion: current.xml_version,
        createdBy: actorUserId
      });
      dbError(await client.rpc(recoverySourceStatus ? "record_sri_recovery_authorization" : "record_sri_authorization", {
        p_document_id: current.id,
        p_response_xml: result.rawXml,
        p_authorization_status: "AUTORIZADO",
        p_authorization_number: result.authorizationNumber,
        p_authorization_date: result.authorizationDate,
        p_environment: result.environment || "PRUEBAS",
        p_authorized_xml: result.authorizedXml,
        p_actor_user_id: actorUserId
      }), "Autorizacion oficial SRI");
      await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
      await completeJob(client, job);
      const authorizedDetail = await getDocumentDetail(client, current.company_id, current.id);
      await generateAccountingForDocument(client, current.id, actorUserId);
      return ensureRide(client, authorizedDetail, actorUserId);
    }
    if (["NO AUTORIZADO", "NO_AUTORIZADO"].includes(result.state)) {
      dbError(await client.rpc(recoverySourceStatus ? "record_sri_recovery_authorization" : "record_sri_authorization", {
        p_document_id: current.id,
        p_response_xml: result.rawXml,
        p_authorization_status: "NO AUTORIZADO",
        p_authorization_number: "",
        p_authorization_date: null,
        p_environment: result.environment || "PRUEBAS",
        p_authorized_xml: null,
        p_actor_user_id: actorUserId
      }), "Respuesta NO AUTORIZADO");
      await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
      await completeJob(client, job);
      return getDocumentDetail(client, current.company_id, current.id);
    }
    throw new SriTransportError("El comprobante todavia no aparece en autorizacion del SRI.", {
      code: "SRI_AUTHORIZATION_PENDING",
      retryable: true,
      details: { state: result.state, documentCount: result.documentCount }
    });
  } catch (error) {
    if (error?.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH") {
      await failAuthorizationAttemptWithoutDocumentMutation(client, job, attempt, error);
      throw error;
    }
    await scheduleFailure(client, settings, current, job, attempt, error, actorUserId);
    throw error;
  }
}

async function processReception(client, settings, document, actorUserId, options = {}) {
  let current = document;
  if (current.status === "ERROR_ENVIO") {
    current = await transition(client, current, "PENDIENTE_REINTENTO", actorUserId, "Reintento manual habilitado");
  }
  if (["FIRMADO", "PENDIENTE_REINTENTO"].includes(current.status)) {
    current = await transition(client, current, "ENVIADO_SRI", actorUserId, "Inicio de transmision a recepcion SRI");
  }
  if (current.status !== "ENVIADO_SRI") {
    throw new SriValidationError(`No se puede transmitir recepcion desde ${current.status}.`);
  }
  const signed = await loadArtifact(client, current.id, "SIGNED_XML");
  let job = await ensureJob(client, current, settings, "RECEPTION", signed.file.id);
  if (job.status === "COMPLETED") {
    const refreshed = dbError(await client.from("electronic_documents").select("*").eq("id", current.id).single(), "Comprobante recibido");
    return processAuthorization(client, settings, refreshed, actorUserId, options);
  }
  job = await claimJob(client, job, options.force);
  const signedXml = signed.buffer.toString("utf8");
  const attempt = await beginAttempt(client, job, sha256(signedXml));
  try {
    const result = await sendForReception(signedXml, {
      endpoint: job.endpoint_url,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    const persisted = await persistResponse(
      client, current, job, "RECEPTION", "RECEPTION_RESPONSE",
      result.rawXml, result, result.messages, actorUserId
    );
    if (result.received) {
      current = await transition(client, current, "RECIBIDO_SRI", actorUserId, "SRI confirmo RECIBIDA", result.messages);
      await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
      await completeJob(client, job);
      return processAuthorization(client, settings, current, actorUserId, options);
    }
    if (result.returned) {
      if (hasSriIdentifier(result.messages, "43")) {
        await finishAttempt(client, attempt, { status: "SUCCEEDED", response_sha256: persisted.hash, http_status: 200 });
        await completeJob(client, job);
        return processAuthorization(client, settings, current, actorUserId, {
          ...options,
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
    throw new SriTransportError(`Estado de recepcion SRI no reconocido: ${result.state || "VACIO"}.`);
  } catch (error) {
    await scheduleFailure(client, settings, current, job, attempt, error, actorUserId);
    throw error;
  }
}

async function transmitDocument(client, companyId, documentId, actorUserId, options = {}) {
  const detail = await getDocumentDetail(client, companyId, documentId);
  const document = detail.document;
  const policy = recoveryPolicy(detail);
  if (policy.action === "QUERY_AUTHORIZATION") {
    const settings = await settingsFor(client, companyId);
    return processAuthorization(client, settings, document, actorUserId, {
      ...options,
      force: true,
      recoveryQuery: true
    });
  }
  if (["AUTORIZADO", "NO_AUTORIZADO", "DEVUELTO", "ANULADO"].includes(document.status)) return detail;
  const settings = await settingsFor(client, companyId);
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
  const policy = recoveryPolicy(detail);
  if (policy.action !== "QUERY_AUTHORIZATION") {
    throw new SriValidationError(policy.reason || "El comprobante no admite consulta de recuperación.");
  }
  const settings = await settingsFor(client, companyId);
  return processAuthorization(client, settings, detail.document, actorUserId, {
    ...options,
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
