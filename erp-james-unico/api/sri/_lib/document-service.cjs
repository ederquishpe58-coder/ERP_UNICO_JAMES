const { generateNumericCode } = require("./access-key.cjs");
const { ecuadorDate, emissionDatePolicy } = require("./emission-date.cjs");
const { storeArtifact, loadArtifact } = require("./artifact-store.cjs");
const { resolveCertificatePassword, parsePkcs12 } = require("./certificate.cjs");
const { SriBackendError, SriConfigurationError, SriValidationError } = require("./errors.cjs");
const { signXadesBes } = require("./xades-signer.cjs");
const { buildDocumentXml, normalizeSriText } = require("./xml-builders.cjs");
const softwareProvider = require("../../../scripts/config/software-provider.js");
const { recoveryPolicy } = require("./recovery-policy.cjs");
const { assertOfficialXsd } = require("./xsd-validator.cjs");

const ENABLED_DOCUMENT_TYPES = new Set(["01", "04", "07"]);
const HABITUAL_GOODS_EXPORTER_RUCS = new Set(["1717637084001"]);
const HABITUAL_GOODS_EXPORTER_LEGEND = "EXPORTADOR HABITUAL DE BIENES";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value) {
  const normalized = String(value || "").trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function habitualExporterLegend(ruc) {
  return HABITUAL_GOODS_EXPORTER_RUCS.has(String(ruc || "").trim())
    ? HABITUAL_GOODS_EXPORTER_LEGEND
    : "";
}

function dbError(result, label) {
  if (result?.error) {
    const databaseCode = String(result.error.code || "DATABASE_ERROR");
    const databaseMessage = String(result.error.message || "Error de persistencia no identificado.");
    const knownConfigurationErrors = {
      SRI_DOCUMENT_TYPE_NOT_ENABLED: "El backend tributario aun no tiene habilitado el comprobante de retencion 07. Debe aplicarse la migracion SRI de retenciones ATS 2.0.0 antes de reintentar. No se consumio ningun secuencial.",
      SRI_XML_VERSION_NOT_ENABLED: "El backend tributario no tiene habilitada la version XML 2.0.0 para retenciones. Revise la migracion y la configuracion SRI antes de reintentar.",
      SRI_DRAFT_IDENTIFIERS_INVALID: "La fecha de emision o el codigo numerico del comprobante no son validos para crear el borrador SRI.",
      SRI_SNAPSHOT_MUST_BE_OBJECT: "La informacion de emisor, proveedor o compra no llego con la estructura requerida por el backend SRI."
    };
    if (knownConfigurationErrors[databaseMessage]) {
      throw new SriConfigurationError(knownConfigurationErrors[databaseMessage], {
        stage: label,
        databaseCode,
        databaseMessage,
        hint: result.error.hint || null
      });
    }
    throw new SriBackendError(`${label}: no se pudo completar la operacion en el backend tributario (${databaseCode}).`, {
      stage: label,
      databaseCode,
      databaseMessage,
      hint: result.error.hint || null
    });
  }
  return result?.data;
}

function documentVersion(settings, documentType) {
  if (documentType === "01") return settings.invoice_xml_version;
  if (documentType === "04") return settings.credit_note_xml_version;
  if (documentType === "06") return settings.delivery_guide_xml_version;
  if (documentType === "07") return settings.withholding_xml_version;
  throw new SriValidationError("Tipo de comprobante no habilitado.");
}

function financials(payload, documentType) {
  if (documentType === "07") {
    const supportingDocuments = payload.withholding?.supportingDocuments || [];
    const totalWithheld = supportingDocuments.reduce((documentSum, support) => (
      documentSum + (support.retentions || []).reduce((sum, row) => sum + Number(row.value ?? row.retainedValue ?? 0), 0)
    ), 0);
    if (!Number.isFinite(totalWithheld) || totalWithheld <= 0) {
      throw new SriValidationError("El comprobante de retencion debe tener un valor retenido mayor a cero.");
    }
    return {
      subtotal: totalWithheld,
      discount_total: 0,
      tax_total: 0,
      grand_total: totalWithheld,
      currency: "USD"
    };
  }
  const section = documentType === "01" ? payload.invoice : payload.creditNote;
  if (documentType === "06") return { subtotal: 0, discount_total: 0, tax_total: 0, grand_total: 0, currency: "USD" };
  const subtotal = Number(section?.totalWithoutTax || 0);
  const discount = Number(section?.discountTotal || 0);
  const tax = (payload.taxes || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const total = Number(section?.grandTotal ?? section?.modificationValue ?? (subtotal - discount + tax));
  if (![subtotal, discount, tax, total].every(Number.isFinite) || Math.min(subtotal, discount, tax, total) < 0) {
    throw new SriValidationError("Los totales del comprobante no son validos.");
  }
  return {
    subtotal,
    discount_total: discount,
    tax_total: tax,
    grand_total: total,
    currency: section?.currency || "USD"
  };
}

function withholdingLines(payload) {
  const documents = payload.withholding?.supportingDocuments || [];
  return documents.flatMap((support, documentIndex) => (
    (support.retentions || []).map((retention, retentionIndex) => {
      const value = Number(retention.value ?? retention.retainedValue ?? 0);
      const taxLabel = String(retention.code) === "1" ? "RENTA"
        : String(retention.code) === "2" ? "IVA"
          : String(retention.code) === "6" ? "ISD" : "IMPUESTO";
      return {
        mainCode: `${retention.code}-${retention.retentionCode}`,
        description: `RETENCION ${taxLabel} ${retention.retentionCode}`,
        unit: "RETENCION",
        quantity: 1,
        unitPrice: value,
        discount: 0,
        subtotal: value,
        additionalDetails: {
          documentNumber: support.documentNumber,
          supportCode: support.supportCode,
          retentionRate: Number(retention.rate || 0),
          documentIndex: documentIndex + 1,
          retentionIndex: retentionIndex + 1
        },
        taxes: []
      };
    })
  ));
}

function lineRows(document, lines) {
  return lines.map((line, index) => ({
    company_id: document.company_id,
    document_id: document.id,
    line_number: index + 1,
    source_line_id: uuidOrNull(line.sourceLineId),
    product_id: uuidOrNull(line.productId),
    main_code: normalizeSriText(line.mainCode || `ITEM-${index + 1}`, 25),
    auxiliary_code: normalizeSriText(line.auxiliaryCode, 25) || null,
    description: normalizeSriText(line.description, 300),
    variety: normalizeSriText(line.variety, 300) || null,
    measure: normalizeSriText(line.measure, 300) || null,
    unit: normalizeSriText(line.unit, 50) || null,
    quantity: Number(line.quantity || 0),
    unit_price: Number(line.unitPrice || 0),
    discount: Number(line.discount || 0),
    subtotal: Number(line.subtotal || 0),
    affected_quantity: line.affectedQuantity == null ? null : Number(line.affectedQuantity),
    affected_amount: line.affectedAmount == null ? null : Number(line.affectedAmount),
    additional_details: line.additionalDetails || {}
  }));
}

function normalizeExportAdditionalInformation(payload) {
  const additional = payload.additionalInformation || {};
  const transport = normalizeSriText(payload.erpEmission?.transportType || additional.Transporte || "AEREO", 50)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const canonical = {
    "Correo cliente": normalizeSriText(additional["Correo cliente"] || payload.buyer?.email, 300),
    Guias: normalizeSriText(additional.Guias || additional.GUIAS, 300),
    Piezas: normalizeSriText(additional.Piezas || additional.PIEZAS, 300),
    "Marca cliente": normalizeSriText(additional["Marca cliente"] || additional.Marca || additional.MARCA, 300),
    DAE: normalizeSriText(additional.DAE || additional.DAES || additional.Dae, 300)
  };
  const requiredFields = ["DAE", "Marca cliente", ...(transport === "AEREO" ? ["Guias"] : [])];
  requiredFields.forEach(field => {
    const value = normalizeSriText(canonical[field], 300);
    if (!value) throw new SriValidationError(`La informacion adicional ${field} es obligatoria para la factura de exportacion.`);
    canonical[field] = value;
  });
  payload.additionalInformation = softwareProvider.mergeAdditionalInformation(canonical);
  payload.erpEmission = {
    ...(payload.erpEmission || {}),
    transportType: transport
  };
  payload.buyer = {
    ...(payload.buyer || {}),
    legalName: normalizeSriText(payload.buyer?.legalName, 300),
    identification: normalizeSriText(payload.buyer?.identification, 20),
    address: normalizeSriText(payload.buyer?.address, 300)
  };
  payload.lines = payload.lines.map(line => ({
    ...line,
    mainCode: normalizeSriText(line.mainCode, 25),
    auxiliaryCode: normalizeSriText(line.auxiliaryCode, 25),
    description: normalizeSriText(line.description, 300),
    variety: normalizeSriText(line.variety, 300),
    measure: normalizeSriText(line.measure, 300),
    unit: normalizeSriText(line.unit, 50)
  }));
}

function normalizeLocalInvoice(payload) {
  const additional = payload.additionalInformation || {};
  payload.additionalInformation = softwareProvider.mergeAdditionalInformation({
    "Correo cliente": normalizeSriText(additional["Correo cliente"] || payload.buyer?.email, 300),
    Piezas: normalizeSriText(additional.Piezas || additional.PIEZAS, 300),
    "Marca cliente": normalizeSriText(additional["Marca cliente"] || additional.Marca || additional.MARCA, 300)
  });
  payload.buyer = {
    ...(payload.buyer || {}),
    legalName: normalizeSriText(payload.buyer?.legalName, 300),
    identification: normalizeSriText(payload.buyer?.identification, 20),
    address: normalizeSriText(payload.buyer?.address, 300)
  };
  payload.lines = payload.lines.map(line => ({
    ...line,
    mainCode: normalizeSriText(line.mainCode, 25),
    auxiliaryCode: normalizeSriText(line.auxiliaryCode, 25),
    description: normalizeSriText(line.description, 300),
    variety: normalizeSriText(line.variety, 300),
    measure: normalizeSriText(line.measure, 300),
    unit: normalizeSriText(line.unit, 50)
  }));
}

function isExportInvoicePayload(payload = {}) {
  const commerceType = String(payload.invoice?.commerceType || "").toUpperCase();
  if (commerceType === "LOCAL") return false;
  return commerceType === "EXPORTADOR"
    || Boolean(payload.invoice?.incoterm || payload.invoice?.originCountryCode || payload.invoice?.destinationCountryCode);
}

async function createDraft(client, input, actorUserId) {
  const documentType = String(input.documentType || "");
  if (!ENABLED_DOCUMENT_TYPES.has(documentType)) throw new SriValidationError("Tipo SRI no habilitado en esta etapa.");
  const payload = structuredClone(input.sourcePayload || {});
  if (documentType === "07") {
    payload.buyer = payload.buyer || payload.withholding?.subject || {};
    if (!Array.isArray(payload.lines) || !payload.lines.length) payload.lines = withholdingLines(payload);
  }
  if (!Array.isArray(payload.lines) || !payload.lines.length) {
    throw new SriValidationError("El comprobante debe contener detalles reales del pedido o packing.");
  }
  const companyId = uuidOrNull(input.companyId);
  const emissionPointId = uuidOrNull(input.emissionPointId);
  if (!companyId || !emissionPointId) throw new SriValidationError("Empresa y punto de emision son obligatorios.");

  const settings = dbError(await client.from("sri_settings").select("*").eq("company_id", companyId).single(), "Configuracion SRI");
  if (settings.environment !== "TEST" || settings.production_enabled) {
    throw new SriValidationError("Esta etapa solo permite el ambiente SRI de pruebas con produccion deshabilitada.");
  }
  const version = documentVersion(settings, documentType);
  const exportInvoice = documentType === "01" && isExportInvoicePayload(payload);
  const datePolicy = emissionDatePolicy({
    issueDate: input.issueDate,
    sourceOrderDate: input.sourceOrderDate || payload.document?.sourceOrderDate || payload.orderDate,
    isExport: exportInvoice
  });
  payload.erpEmission = {
    ...(payload.erpEmission || {}),
    sourceOrderDate: datePolicy.sourceOrderDate,
    requestedIssueDate: datePolicy.requestedIssueDate,
    sriIssueDate: datePolicy.issueDate,
    issueDateAdjusted: datePolicy.adjusted,
    timeZone: datePolicy.timeZone
  };
  if (documentType === "01") {
    if (isExportInvoicePayload(payload)) normalizeExportAdditionalInformation(payload);
    else normalizeLocalInvoice(payload);
  }
  const exporterLegend = habitualExporterLegend(settings.ruc);
  if (exporterLegend) {
    payload.additionalInformation = softwareProvider.mergeAdditionalInformation({
      ...(payload.additionalInformation || {}),
      "Calificacion tributaria": exporterLegend
    });
  }
  const numericCode = generateNumericCode();
  const rpc = await client.rpc("create_electronic_document_draft", {
    p_company_id: companyId,
    p_emission_point_id: emissionPointId,
    p_document_type: documentType,
    p_issue_date: datePolicy.issueDate,
    p_numeric_code: numericCode,
    p_xml_version: version,
    p_xsd_version: version,
    p_issuer_snapshot: {
      legalName: settings.legal_name,
      commercialName: settings.commercial_name,
      ruc: settings.ruc,
      headOfficeAddress: settings.head_office_address,
      accountingRequired: settings.accounting_required,
      specialTaxpayerNumber: settings.special_taxpayer_number,
      withholdingAgentNumber: settings.withholding_agent_number,
      rimpeLabel: settings.rimpe_label,
      habitualExporterLegend: exporterLegend
    },
    p_buyer_snapshot: payload.buyer || {},
    p_source_snapshot: payload,
    p_source_order_id: uuidOrNull(input.sourceOrderId),
    p_source_packing_id: uuidOrNull(input.sourcePackingId),
    p_customer_id: uuidOrNull(input.customerId),
    p_parent_document_id: uuidOrNull(input.parentDocumentId),
    p_created_by: actorUserId
  });
  const document = dbError(rpc, "Creacion de borrador SRI");
  const reservationReused = document?._reservation_reused === true;
  if (reservationReused) {
    const existing = await getDocumentDetail(client, companyId, document.id);
    if (existing.lines?.length) return existing;
  }

  // El RPC puede devolver el mismo borrador a dos solicitudes concurrentes.
  // En ese caso ambos procesos deben completar exactamente el snapshot que ya
  // quedo congelado en PostgreSQL, nunca su copia de UI particular.
  const canonicalPayload = structuredClone(document.source_snapshot || payload);
  const canonicalLines = Array.isArray(canonicalPayload.lines) && canonicalPayload.lines.length
    ? canonicalPayload.lines
    : (documentType === "07" ? withholdingLines(canonicalPayload) : []);

  try {
    const insertedLines = dbError(await client
      .from("electronic_document_lines")
      .insert(lineRows(document, canonicalLines))
      .select(), "Detalles del comprobante");
    const taxes = [];
    (canonicalPayload.taxes || []).forEach(tax => taxes.push({
      company_id: companyId,
      document_id: document.id,
      document_line_id: null,
      tax_code: tax.code,
      percentage_code: tax.percentageCode,
      rate: Number(tax.rate || 0),
      taxable_base: Number(tax.taxableBase || 0),
      tax_value: Number(tax.value || 0)
    }));
    canonicalLines.forEach((line, index) => (line.taxes || []).forEach(tax => taxes.push({
      company_id: companyId,
      document_id: document.id,
      document_line_id: insertedLines[index].id,
      tax_code: tax.code,
      percentage_code: tax.percentageCode,
      rate: Number(tax.rate || 0),
      taxable_base: Number(tax.taxableBase || line.subtotal || 0),
      tax_value: Number(tax.value || 0)
    })));
    if (taxes.length) dbError(await client.from("electronic_document_taxes").insert(taxes), "Impuestos del comprobante");
    const totals = financials(canonicalPayload, documentType);
    dbError(await client.from("electronic_documents").update({
      ...totals,
      additional_information: canonicalPayload.additionalInformation || {},
      updated_at: new Date().toISOString()
    }).eq("id", document.id).eq("status", "BORRADOR").select().single(), "Totales del borrador");
    if (documentType === "04") {
      dbError(await client.rpc("validate_credit_note_amount", {
        p_credit_note_id: document.id,
        p_amount: totals.grand_total,
        p_actor_user_id: actorUserId
      }), "Limite de nota de credito");
    }
  } catch (error) {
    if (reservationReused && String(error?.code || "") === "23505") {
      return getDocumentDetail(client, companyId, document.id);
    }
    await client.from("electronic_documents").update({ last_error: error.message }).eq("id", document.id);
    throw error;
  }
  return getDocumentDetail(client, companyId, document.id);
}

async function getDocumentDetail(client, companyId, documentId) {
  const document = dbError(await client.from("electronic_documents").select("*")
    .eq("company_id", companyId).eq("id", documentId).single(), "Comprobante SRI");
  const [lines, taxes, files, transmissions, attempts, responses, authorizations, errors, audit, accounting, journals] = await Promise.all([
    client.from("electronic_document_lines").select("*").eq("document_id", documentId).order("line_number"),
    client.from("electronic_document_taxes").select("*").eq("document_id", documentId),
    client.from("electronic_document_files").select("*").eq("document_id", documentId).order("created_at", { ascending: false }),
    client.from("sri_transmissions").select("*").eq("document_id", documentId).order("created_at", { ascending: false }),
    client.from("sri_transmission_attempts").select("*").eq("document_id", documentId).order("created_at", { ascending: false }),
    client.from("sri_responses").select("*").eq("document_id", documentId).order("received_at", { ascending: false }),
    client.from("sri_authorizations").select("*").eq("document_id", documentId),
    client.from("sri_error_messages").select("*").eq("document_id", documentId).order("created_at", { ascending: false }),
    client.from("electronic_document_audit_logs").select("*").eq("document_id", documentId).order("created_at", { ascending: false }),
    client.from("accounting_document_links").select("*").eq("document_id", documentId),
    client.from("journal_entries").select("*, journal_entry_lines(*)").eq("source_document_id", documentId).order("created_at", { ascending: false })
  ]);
  [lines, taxes, files, transmissions, attempts, responses, authorizations, errors, audit, accounting, journals]
    .forEach(result => dbError(result, "Detalle relacionado SRI"));
  const detail = {
    document,
    lines: lines.data,
    taxes: taxes.data,
    files: files.data,
    transmissions: transmissions.data,
    transmissionAttempts: attempts.data,
    responses: responses.data,
    authorizations: authorizations.data,
    errors: errors.data,
    audit: audit.data,
    accountingLinks: accounting.data,
    journalEntries: journals.data
  };
  return { ...detail, recoveryPolicy: recoveryPolicy(detail) };
}

async function documentPayload(client, document) {
  const settings = dbError(await client.from("sri_settings").select("*").eq("company_id", document.company_id).single(), "Configuracion SRI");
  const point = dbError(await client.from("emission_points").select("*").eq("id", document.emission_point_id).single(), "Punto de emision");
  const lines = dbError(await client.from("electronic_document_lines").select("*").eq("document_id", document.id).order("line_number"), "Lineas");
  const taxes = dbError(await client.from("electronic_document_taxes").select("*").eq("document_id", document.id), "Impuestos");
  const source = structuredClone(document.source_snapshot || {});
  source.additionalInformation = softwareProvider.mergeAdditionalInformation(source.additionalInformation || {});
  const lineTaxes = new Map(lines.map(line => [line.id, []]));
  const documentTaxes = [];
  taxes.forEach(tax => {
    const normalized = {
      code: tax.tax_code,
      percentageCode: tax.percentage_code,
      rate: Number(tax.rate),
      taxableBase: Number(tax.taxable_base),
      value: Number(tax.tax_value)
    };
    if (tax.document_line_id) lineTaxes.get(tax.document_line_id)?.push(normalized);
    else documentTaxes.push(normalized);
  });
  source.document = {
    ...(source.document || {}),
    version: document.xml_version,
    environmentCode: "1",
    emissionType: "1",
    accessKey: document.access_key,
    establishmentCode: document.establishment_code,
    emissionPointCode: document.emission_point_code,
    sequential: document.sequential_text,
    issueDate: document.issue_date,
    establishmentAddress: point.establishment_address,
    issuer: {
      legalName: settings.legal_name,
      commercialName: settings.commercial_name,
      ruc: settings.ruc,
      headOfficeAddress: settings.head_office_address,
      accountingRequired: settings.accounting_required,
      specialTaxpayerNumber: settings.special_taxpayer_number,
      withholdingAgentNumber: settings.withholding_agent_number,
      rimpeLabel: settings.rimpe_label,
      habitualExporterLegend: habitualExporterLegend(settings.ruc)
    }
  };
  source.buyer = document.buyer_snapshot;
  source.taxes = documentTaxes;
  source.lines = lines.map(line => ({
    sourceLineId: line.source_line_id,
    productId: line.product_id,
    mainCode: line.main_code,
    auxiliaryCode: line.auxiliary_code,
    description: line.description,
    variety: line.variety,
    measure: line.measure,
    unit: line.unit,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unit_price),
    discount: Number(line.discount),
    subtotal: Number(line.subtotal),
    affectedQuantity: line.affected_quantity == null ? null : Number(line.affected_quantity),
    affectedAmount: line.affected_amount == null ? null : Number(line.affected_amount),
    additionalDetails: line.additional_details,
    taxes: lineTaxes.get(line.id) || []
  }));
  if (document.document_type === "04") {
    const original = dbError(await client.from("electronic_documents").select("*").eq("id", document.parent_document_id).single(), "Factura original");
    source.originalInvoice = {
      id: original.id,
      status: original.status,
      fullNumber: original.full_number,
      issueDate: original.issue_date,
      authorizationNumber: original.authorization_number,
      grandTotal: Number(original.grand_total),
      creditedTotal: Number(original.credited_total)
    };
  }
  return source;
}

async function transition(client, document, newStatus, actorUserId, reason, messages = null) {
  return dbError(await client.rpc("set_electronic_document_status", {
    p_document_id: document.id,
    p_expected_status: document.status,
    p_new_status: newStatus,
    p_actor_user_id: actorUserId,
    p_reason: reason,
    p_sri_messages: messages
  }), `Transicion ${document.status} -> ${newStatus}`);
}

async function generateXml(client, companyId, documentId, actorUserId) {
  let detail = await getDocumentDetail(client, companyId, documentId);
  let document = detail.document;
  if (["XML_GENERADO", "FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO"].includes(document.status)) return detail;
  if (!['BORRADOR', 'VALIDADO'].includes(document.status)) throw new SriValidationError(`No se puede generar XML desde ${document.status}.`);
  const payload = await documentPayload(client, document);
  const exportInvoice = document.document_type === "01" && isExportInvoicePayload(payload.source || payload);
  const currentIssueDate = ecuadorDate();
  if (exportInvoice) {
    emissionDatePolicy({ issueDate: document.issue_date, sourceOrderDate: document.issue_date, isExport: true });
  } else if (document.status === "BORRADOR" && document.issue_date !== currentIssueDate) {
    document = dbError(await client.rpc("refresh_electronic_document_issue_date", {
      p_document_id: document.id,
      p_issue_date: currentIssueDate,
      p_actor_user_id: actorUserId
    }), "Actualizacion de fecha de emision SRI");
  } else if (document.status === "VALIDADO" && document.issue_date !== currentIssueDate) {
    throw new SriValidationError("La fecha de emision SRI quedo desactualizada. Regrese el documento a borrador antes de generar el XML.");
  }
  // documentPayload se construye antes de refrescar un borrador local. Mantener
  // el XML y la fila de base de datos con exactamente la misma fecha oficial.
  if (payload.document) payload.document.issueDate = document.issue_date;
  const xml = buildDocumentXml(document.document_type, payload);
  const xsdReport = await assertOfficialXsd({ documentType: document.document_type, version: document.xml_version, xml });
  if (document.status === "BORRADOR") document = await transition(client, document, "VALIDADO", actorUserId, "Validacion de datos y reglas de negocio completada");
  await Promise.all([
    storeArtifact(client, { companyId, documentId, fileType: "SOURCE_JSON", content: JSON.stringify(payload), schemaVersion: document.xml_version, createdBy: actorUserId }),
    storeArtifact(client, { companyId, documentId, fileType: "UNSIGNED_XML", content: xml, schemaVersion: document.xml_version, createdBy: actorUserId }),
    storeArtifact(client, { companyId, documentId, fileType: "XSD_REPORT", content: JSON.stringify(xsdReport), schemaVersion: document.xml_version, createdBy: actorUserId })
  ]);
  await transition(client, document, "XML_GENERADO", actorUserId, "XML validado contra XSD oficial");
  return getDocumentDetail(client, companyId, documentId);
}

async function signDocument(client, companyId, documentId, actorUserId) {
  const detail = await getDocumentDetail(client, companyId, documentId);
  const document = detail.document;
  if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO"].includes(document.status)) return detail;
  if (document.status !== "XML_GENERADO") throw new SriValidationError("El comprobante debe tener un XML validado antes de firmarse.");
  const settings = dbError(await client.from("sri_settings").select("*").eq("company_id", companyId).single(), "Configuracion SRI");
  if (settings.environment !== "TEST") throw new SriValidationError("La firma esta habilitada solamente para ambiente de pruebas en esta etapa.");
  const certificateRow = dbError(await client.from("digital_certificates").select("*")
    .eq("company_id", companyId).eq("active", true).single(), "Certificado activo");
  const unsigned = await loadArtifact(client, documentId, "UNSIGNED_XML");
  const { data: p12Blob, error: p12Error } = await client.storage.from(certificateRow.storage_bucket).download(certificateRow.storage_object_path);
  if (p12Error) throw p12Error;
  const password = resolveCertificatePassword(certificateRow.password_secret_name);
  let certificate;
  try {
    certificate = parsePkcs12(Buffer.from(await p12Blob.arrayBuffer()), password, {
      expectedRuc: settings.ruc,
      expirationWarningDays: 30
    });
  } catch (error) {
    await client.from("digital_certificates").update({
      validation_status: /vencido/i.test(error.message) ? "EXPIRED" : (/RUC/i.test(error.message) ? "RUC_MISMATCH" : "INVALID"),
      validation_message: error.message,
      last_validated_at: new Date().toISOString()
    }).eq("id", certificateRow.id);
    throw error;
  }
  const signedXml = await signXadesBes({ xml: unsigned.buffer.toString("utf8"), certificate });
  await assertOfficialXsd({ documentType: document.document_type, version: document.xml_version, xml: signedXml });
  await storeArtifact(client, { companyId, documentId, fileType: "SIGNED_XML", content: signedXml, schemaVersion: document.xml_version, createdBy: actorUserId });
  dbError(await client.from("digital_certificates").update({
    certificate_serial: certificate.metadata.serialNumber,
    subject_name: certificate.metadata.subject,
    subject_ruc: certificate.metadata.holderRuc,
    issuer_name: certificate.metadata.issuer,
    valid_from: certificate.metadata.notBefore,
    valid_until: certificate.metadata.notAfter,
    fingerprint_sha256: String(certificate.metadata.fingerprintSha256 || "").toLowerCase(),
    validation_status: "VALID",
    validation_message: certificate.metadata.expirationWarning ? "Certificado proximo a vencer" : null,
    last_validated_at: new Date().toISOString()
  }).eq("id", certificateRow.id), "Actualizacion de certificado");
  dbError(await client.from("electronic_documents").update({ certificate_id: certificateRow.id }).eq("id", documentId), "Certificado del comprobante");
  await transition(client, document, "FIRMADO", actorUserId, "Firma XAdES-BES verificada en backend");
  return getDocumentDetail(client, companyId, documentId);
}

async function listDocuments(client, companyId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  let query = client.from("electronic_documents").select("*").eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.documentType) query = query.eq("document_type", filters.documentType);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.from) query = query.gte("issue_date", filters.from);
  if (filters.to) query = query.lte("issue_date", filters.to);
  return dbError(await query, "Listado de comprobantes");
}

async function registerDocumentAnnulment(client, companyId, documentId, actorUserId, input = {}) {
  const normalizedDocumentId = uuidOrNull(documentId);
  const operationId = uuidOrNull(input.operationId);
  const reason = String(input.reason || "").trim();
  const accessKey = String(input.accessKey || "").replace(/\D/g, "");
  const annulmentDate = String(input.annulmentDate || "").trim();
  const evidenceReference = String(input.evidenceReference || "").trim();
  if (!normalizedDocumentId) throw new SriValidationError("Seleccione una factura SRI válida.");
  if (!operationId) throw new SriValidationError("La operación de anulación requiere un identificador idempotente válido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(annulmentDate)) throw new SriValidationError("Ingrese la fecha en que se realizó la anulación en el SRI.");
  if (reason.length < 3 || reason.length > 500) throw new SriValidationError("Ingrese un motivo de anulación entre 3 y 500 caracteres.");
  if (!/^\d{49}$/.test(accessKey)) throw new SriValidationError("La clave de acceso debe contener exactamente 49 dígitos.");
  if (evidenceReference.length > 500) throw new SriValidationError("La referencia o evidencia no puede superar 500 caracteres.");

  const result = dbError(await client.rpc("register_sri_document_annulment", {
    p_document_id: normalizedDocumentId,
    p_operation_id: operationId,
    p_annulment_date: annulmentDate,
    p_reason: reason,
    p_access_key: accessKey,
    p_evidence_reference: evidenceReference || null,
    p_actor_user_id: actorUserId
  }), "Registro controlado de anulación SRI");
  const detail = await getDocumentDetail(client, companyId, normalizedDocumentId);
  return { ...detail, annulmentRegistration: result };
}

module.exports = {
  ENABLED_DOCUMENT_TYPES,
  createDraft,
  getDocumentDetail,
  generateXml,
  signDocument,
  listDocuments,
  registerDocumentAnnulment,
  documentPayload,
  transition,
  normalizeExportAdditionalInformation,
  dbError,
  uuidOrNull
};
