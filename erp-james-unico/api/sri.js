const { parsePkcs12, resolveCertificatePassword, certificateSecretName, canonicalCertificateCompany, releaseCertificateMaterial } = require("./sri/_lib/certificate.cjs");
const { handleCertificatePrecheck } = require("./sri/_lib/certificate-precheck.cjs");
const { SriError, SriValidationError } = require("./sri/_lib/errors.cjs");
const {
  createDraft,
  generateXml,
  getDocumentDetail,
  listDocuments,
  preflightIssuanceCertificate,
  registerDocumentAnnulment,
  signDocument,
  uuidOrNull
} = require("./sri/_lib/document-service.cjs");
const { assertUserCapability, authenticateCompanyRequest, getSupabaseAdmin, getSupabaseUserContext } = require("./sri/_lib/supabase-admin.cjs");
const { sha256 } = require("./sri/_lib/artifact-store.cjs");
const {
  prepareDocumentCorrection,
  queryDocumentStatus,
  transmitDocument
} = require("./sri/_lib/transmission-service.cjs");
const { SUPPORTED_XML, validateSriConfiguration } = require("./sri/_lib/technical-readiness.cjs");

const configurationService = require("./sri/_lib/configuration-service.cjs");
const { requireEnvironment } = require("./sri/_lib/environment.cjs");

const WRITE_ROLES = ["ADMIN", "TRIBUTACION", "CONTADOR", "EMISOR"];
const CONFIG_ROLES = ["ADMIN", "TRIBUTACION"];
const ADMIN_ROLES = ["ADMIN"];

function requiredCapability(action, method, body = {}) {
  if (method === "GET") {
    return action === "configuration" ? "tax.parameters.view" : "commercial.electronic_documents.view";
  }
  if (action === "create-draft") {
    const documentType = String(body.documentType || body.document?.documentType || "").trim();
    if (documentType === "04") return "commercial.credit_notes.create";
    if (documentType === "07") return "purchases.withholdings.create";
    return "commercial.electronic_documents.create";
  }
  if (["generate-xml", "sign", "transmit", "query-status"].includes(action)) {
    return "commercial.electronic_documents.authorize";
  }
  if (action === "prepare-correction") return "commercial.electronic_documents.correct";
  if (action === "register-annulment") return "commercial.electronic_documents.annul";
  if (action === "save-document-sequence") return "admin.sequences.manage";
  if (action === "set-environment-enabled") return "tax.parameters.manage";
  if (["save-settings", "save-emission-point", "upload-certificate", "save-accounting-rule"].includes(action)) {
    return "tax.parameters.manage";
  }
  if (action === "cleanup-test-demo") return "admin.synchronization.manage";
  return "";
}

function queryValue(request, name) {
  if (request?.query?.[name] != null) return request.query[name];
  const url = new URL(request.url, "http://localhost");
  return url.searchParams.get(name);
}

function requestBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) return JSON.parse(request.body);
  return {};
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

async function configuration(client, companyId, requestedEnvironment) {
  const [settings, points, sequences, certificates, rules] = await Promise.all([
    client.from("sri_settings").select("*").eq("company_id", companyId).maybeSingle(),
    client.from("emission_points").select("*").eq("company_id", companyId).order("establishment_code"),
    client.from("electronic_document_sequences").select("company_id, emission_point_id, environment, document_type, next_value, updated_at")
      .eq("company_id", companyId).order("document_type"),
    client.from("digital_certificates").select(
      "id, company_id, alias, certificate_serial, subject_name, subject_ruc, issuer_name, valid_from, valid_until, fingerprint_sha256, active, last_validated_at, validation_status, validation_message, created_at, updated_at"
    ).eq("company_id", companyId).order("created_at", { ascending: false }),
    client.from("accounting_generation_rules").select("*").eq("company_id", companyId).order("priority")
  ]);
  const error = settings.error || points.error || sequences.error || certificates.error || rules.error;
  if (error) throw error;
  const environment = requireEnvironment(requestedEnvironment == null ? settings.data?.environment : requestedEnvironment);
  const result = { environment, selectedEnvironment: environment, settings: settings.data, emissionPoints: (points.data || []).filter(point => point.environment === environment), sequences: (sequences.data || []).filter(sequence => sequence.environment === environment), certificates: certificates.data, accountingRules: rules.data };
  return { ...result, readiness: validateSriConfiguration(result) };
}

async function uploadCertificate(client, companyId, userId, input) {
  if (Object.keys(input).some(key => !["passwordSecretName", "p12Base64", "alias", "active"].includes(key))) {
    throw new SriValidationError("La carga admite solo archivo y metadata; no contrasena ni identidad elegida por el cliente.");
  }
  const secretName = certificateSecretName(companyId, input.passwordSecretName);
  const encoded = String(input.p12Base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!encoded.length || encoded.length > 4 * 1024 * 1024 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new SriValidationError("Seleccione un PKCS12 de hasta 3 MB.");
  }
  const buffer = Buffer.from(encoded, "base64");
  let parsed;
  try {
    if (buffer.toString("base64") !== encoded) throw new SriValidationError("Archivo PKCS12 invalido.");
    const company = await canonicalCertificateCompany(client, companyId);
    parsed = parsePkcs12(buffer, resolveCertificatePassword(secretName), { companyId, expectedRuc: company.tax_id });
    const { data: settings, error: settingsError } = await client.from("sri_settings").select("ruc")
      .eq("company_id", companyId).single();
    if (settingsError) throw settingsError;
    if (settings?.ruc !== company.tax_id) throw new SriValidationError("La configuracion SRI no coincide con el RUC canonico de la empresa.");
    const fingerprintSha256 = parsed.metadata.fingerprintSha256.toLowerCase();
    const path = `companies/${companyId}/certificates/${fingerprintSha256}.p12`;
    const { error: uploadError } = await client.storage.from("sri-private").upload(path, buffer, {
      contentType: "application/x-pkcs12",
      upsert: false,
      cacheControl: "private, no-store"
    });
    if (uploadError && Number(uploadError.statusCode) !== 409 && !/already exists/i.test(uploadError.message || "")) throw uploadError;
    if (input.active !== false) {
      const { error } = await client.from("digital_certificates").update({ active: false, updated_by: userId })
        .eq("company_id", companyId).eq("active", true);
      if (error) throw error;
    }
    const row = {
      company_id: companyId,
      alias: String(input.alias || "Certificado SRI"),
      storage_bucket: "sri-private",
      storage_object_path: path,
      password_secret_name: secretName,
      certificate_serial: parsed.metadata.serialNumber,
      subject_name: parsed.metadata.subject,
      subject_ruc: parsed.metadata.holderRuc,
      issuer_name: parsed.metadata.issuer,
      valid_from: parsed.metadata.notBefore,
      valid_until: parsed.metadata.notAfter,
      fingerprint_sha256: fingerprintSha256,
      active: input.active !== false,
      last_validated_at: new Date().toISOString(),
      validation_status: "VALID",
      validation_message: parsed.metadata.expirationWarning ? "Certificado proximo a vencer" : null,
      created_by: userId,
      updated_by: userId
    };
    const { data, error } = await client.from("digital_certificates").upsert(row, {
      onConflict: "company_id,fingerprint_sha256"
    }).select("id, alias, subject_name, subject_ruc, valid_from, valid_until, fingerprint_sha256, active, validation_status, validation_message").single();
    if (error) throw error;
    return data;
  } finally {
    buffer.fill(0);
    releaseCertificateMaterial(parsed);
    delete input.p12Base64;
  }
}

async function saveAccountingRule(client, companyId, userId, input) {
  if (!['01', '04'].includes(String(input.documentType || ""))) throw new SriValidationError("La regla contable admite factura 01 o nota 04.");
  if (!String(input.debitAccountCode || "").trim() || !String(input.creditAccountCode || "").trim()) {
    throw new SriValidationError("Las cuentas debe y haber son obligatorias.");
  }
  const row = {
    id: uuidOrNull(input.id) || undefined,
    company_id: companyId,
    document_type: input.documentType,
    sale_type: input.saleType || null,
    customer_id: uuidOrNull(input.customerId),
    product_id: uuidOrNull(input.productId),
    product_category: input.productCategory || null,
    tax_code: input.taxCode || null,
    cost_center_id: uuidOrNull(input.costCenterId),
    currency: input.currency || null,
    country_code: input.countryCode || null,
    sales_channel: input.salesChannel || null,
    debit_account_code: input.debitAccountCode,
    credit_account_code: input.creditAccountCode,
    tax_account_code: input.taxAccountCode || null,
    priority: Number(input.priority || 100),
    active: input.active !== false,
    effective_from: input.effectiveFrom || null,
    effective_until: input.effectiveUntil || null,
    created_by: userId,
    updated_by: userId
  };
  if (!row.id) delete row.id;
  const { data, error } = await client.from("accounting_generation_rules").upsert(row).select().single();
  if (error) throw error;
  return data;
}

async function downloadFile(client, companyId, fileId, response) {
  const { data: file, error } = await client.from("electronic_document_files").select("*")
    .eq("id", fileId).eq("company_id", companyId).single();
  if (error) throw error;
  const { data: document, error: documentError } = await client.from("electronic_documents")
    .select("full_number")
    .eq("id", file.document_id)
    .eq("company_id", companyId)
    .single();
  if (documentError) throw documentError;
  const { data: blob, error: downloadError } = await client.storage.from(file.storage_bucket).download(file.storage_object_path);
  if (downloadError) throw downloadError;
  const buffer = Buffer.from(await blob.arrayBuffer());
  const extension = file.content_type === "application/pdf" ? "pdf"
    : file.content_type === "application/json" ? "json"
      : "xml";
  const documentNumber = String(document.full_number || "comprobante")
    .replace(/[^0-9A-Za-z-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const artifactName = String(file.file_type || "archivo").toLowerCase().replace(/_/g, "-");
  const fileName = `${documentNumber || "comprobante"}-${artifactName}.${extension}`;
  response.statusCode = 200;
  response.setHeader("content-type", file.content_type);
  response.setHeader("content-length", String(buffer.length));
  response.setHeader("content-disposition", `attachment; filename="${fileName}"`);
  response.setHeader("cache-control", "private, no-store");
  response.end(buffer);
}

function isMarkedTestDemoDocument(document = {}) {
  if (String(document.environment || "").toUpperCase() !== "TEST") return false;
  return /demo|prueba-sri|documento de prueba|validation_only/i.test(JSON.stringify({
    buyer: document.buyer_snapshot,
    source: document.source_snapshot,
    additional: document.additional_information
  }));
}

async function cleanupMarkedTestDemoDocuments(client, companyId, input = {}) {
  if (String(input.confirmation || "") !== "ELIMINAR_DEMO_TEST") {
    throw new SriValidationError("Confirme expresamente la limpieza de documentos demo en TEST.");
  }
  const { data: settings, error: settingsError } = await client.from("sri_settings")
    .select("environment, production_enabled")
    .eq("company_id", companyId)
    .single();
  if (settingsError) throw settingsError;
  if (settings.environment !== "TEST" || settings.production_enabled === true) {
    throw new SriValidationError("La limpieza demo solo esta permitida en ambiente TEST con produccion desactivada.");
  }

  const { data: documents, error: documentsError } = await client.from("electronic_documents")
    .select("id, parent_document_id, document_type, full_number, status, environment, buyer_snapshot, source_snapshot, additional_information")
    .eq("company_id", companyId)
    .eq("environment", "TEST");
  if (documentsError) throw documentsError;
  const marked = (documents || []).filter(isMarkedTestDemoDocument);
  if (!marked.length) return { removed: [], removedArtifacts: 0 };

  const documentIds = marked.map(document => document.id);
  const { data: files, error: filesError } = await client.from("electronic_document_files")
    .select("storage_bucket, storage_object_path")
    .eq("company_id", companyId)
    .in("document_id", documentIds);
  if (filesError) throw filesError;
  const filesByBucket = (files || []).reduce((groups, file) => {
    groups[file.storage_bucket] = groups[file.storage_bucket] || [];
    groups[file.storage_bucket].push(file.storage_object_path);
    return groups;
  }, {});
  for (const [bucket, paths] of Object.entries(filesByBucket)) {
    if (!paths.length) continue;
    const { error } = await client.storage.from(bucket).remove(paths);
    if (error) throw error;
  }

  const ordered = [...marked].sort((left, right) => (
    Number(Boolean(right.parent_document_id)) - Number(Boolean(left.parent_document_id))
  ));
  for (const document of ordered) {
    const { error } = await client.from("electronic_documents")
      .delete()
      .eq("company_id", companyId)
      .eq("id", document.id);
    if (error) throw error;
  }
  return {
    removed: ordered.map(document => ({
      id: document.id,
      documentType: document.document_type,
      fullNumber: document.full_number,
      status: document.status
    })),
    removedArtifacts: (files || []).length
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("x-content-type-options", "nosniff");
  const applyAction = queryValue(request, "action") || request.body?.action;
  if (require("./sri/_lib/test-apply.cjs").ACTIONS.includes(applyAction)) {
    return require("./sri/_lib/test-apply.cjs").handleTestApply(request, response);
  }
  if (queryValue(request, "action") === "validate-certificate" || request.body?.action === "validate-certificate") {
    return handleCertificatePrecheck(request, response);
  }
  if (queryValue(request, "action") === "validate-xml-signature-dry-run" || request.body?.action === "validate-xml-signature-dry-run") {
    return handleCertificatePrecheck(request, response, { dryRun: true });
  }
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    return response.end();
  }
  try {
    const client = getSupabaseAdmin();
    const body = request.method === "GET" ? {} : requestBody(request);
    const action = String(body.action || queryValue(request, "action") || "list");
    const requestedCompanyId = body.companyId || queryValue(request, "companyId");
    const roles = action === "cleanup-test-demo"
      ? ADMIN_ROLES
      : ["save-settings", "save-emission-point", "save-document-sequence", "upload-certificate", "save-accounting-rule"].includes(action)
        ? CONFIG_ROLES
      : (request.method === "GET" ? null : WRITE_ROLES);
    const canonicalConfiguration = action === "configuration" || ["save-settings", "save-emission-point", "save-document-sequence", "set-environment-enabled"].includes(action);
    const auth = canonicalConfiguration
      ? await configurationService.authenticateConfigurationRequest(client, request, requestedCompanyId)
      : await authenticateCompanyRequest(client, request, requestedCompanyId, roles);
    const capabilityId = requiredCapability(action, request.method, body);
    if (!capabilityId) throw new SriValidationError("Accion SRI sin capability asignada.");
    await assertUserCapability(auth.accessToken, auth.companyId, capabilityId);

    if (request.method === "GET" && action === "list") {
      return sendJson(response, 200, { ok: true, data: await listDocuments(client, auth.companyId, {
        status: queryValue(request, "status"),
        documentType: queryValue(request, "documentType"),
        customerId: queryValue(request, "customerId"),
        from: queryValue(request, "from"),
        to: queryValue(request, "to"),
        limit: queryValue(request, "limit"),
        offset: queryValue(request, "offset")
      }) });
    }
    if (request.method === "GET" && action === "detail") {
      return sendJson(response, 200, { ok: true, data: await getDocumentDetail(client, auth.companyId, queryValue(request, "documentId")) });
    }
    if (request.method === "GET" && action === "configuration") {
      return sendJson(response, 200, { ok: true, data: await configuration(client, auth.companyId, queryValue(request, "environment")) });
    }
    if (request.method === "GET" && action === "download") {
      return downloadFile(client, auth.companyId, queryValue(request, "fileId"), response);
    }
    if (request.method !== "POST") throw new SriValidationError("Metodo HTTP no permitido.");

    let data;
    if (action === "create-draft") data = await createDraft(client, { ...body, companyId: auth.companyId }, auth.user.id);
    else if (action === "generate-xml") data = await generateXml(client, auth.companyId, body.documentId, auth.user.id, getSupabaseUserContext(auth.accessToken));
    else if (action === "sign") data = await signDocument(client, auth.companyId, body.documentId, auth.user.id);
    else if (action === "transmit") data = await transmitDocument(client, auth.companyId, body.documentId, auth.user.id, { force: Boolean(body.force) });
    else if (action === "query-status") data = await queryDocumentStatus(client, auth.companyId, body.documentId, auth.user.id);
    else if (action === "prepare-correction") data = await prepareDocumentCorrection(
      client,
      auth.companyId,
      body.documentId,
      auth.user.id,
      body.operationId
    );
    else if (action === "register-annulment") data = await registerDocumentAnnulment(
      client,
      auth.companyId,
      body.documentId,
      auth.user.id,
      body
    );
    else if (action === "save-settings") data = await configurationService.saveSettings(getSupabaseUserContext(auth.accessToken), auth.companyId, body.settings || {}, body.operationId);
    else if (action === "save-emission-point") data = await configurationService.saveEmissionPoint(getSupabaseUserContext(auth.accessToken), auth.companyId, body.emissionPoint || {}, body.operationId);
    else if (action === "save-document-sequence") data = await configurationService.saveDocumentSequence(getSupabaseUserContext(auth.accessToken), auth.companyId, body.sequence || {}, body.operationId);
    else if (action === "set-environment-enabled") {
      if (body.enabled === true) await preflightIssuanceCertificate(client, auth.companyId);
      data = await configurationService.setEnvironmentEnabled(getSupabaseUserContext(auth.accessToken), auth.companyId, body);
    }
    else if (action === "upload-certificate") data = await uploadCertificate(client, auth.companyId, auth.user.id, body.certificate || {});
    else if (action === "save-accounting-rule") data = await saveAccountingRule(client, auth.companyId, auth.user.id, body.rule || {});
    else if (action === "cleanup-test-demo") data = await cleanupMarkedTestDemoDocuments(client, auth.companyId, body);
    else throw new SriValidationError("Accion SRI no reconocida.");
    return sendJson(response, 200, { ok: true, data });
  } catch (error) {
    console.error("[sri-api] request failed", {
      name: error?.name || "Error",
      code: error?.code || null,
      message: error?.message || "Unknown error",
      transport: error?.details?.transport || null,
      stack: error?.stack || null
    });
    const known = error instanceof SriError;
    return sendJson(response, known ? error.httpStatus : 500, {
      ok: false,
      error: {
        code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "Ocurrio un error interno en el backend SRI.",
        retryable: known ? error.retryable : false,
        details: known ? error.details : null
      }
    });
  }
};
