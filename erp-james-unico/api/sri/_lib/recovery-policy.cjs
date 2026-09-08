const { withholdingDateRecovery } = require("./withholding-date-recovery.cjs");
const ERROR_STATUSES = new Set([
  "DEVUELTO",
  "NO_AUTORIZADO",
  "ERROR_ENVIO",
  "PENDIENTE_REINTENTO"
]);

const QUERY_ONLY_IDENTIFIERS = new Set(["43", "45", "70"]);
const QUERY_FIRST_TECHNICAL_ERRORS = new Set([
  "SRI_TIMEOUT", "SRI_AUTHORIZATION_PENDING", "SRI_NETWORK_ERROR", "SRI_TRANSPORT_ERROR",
  "SRI_HTTP_ERROR", "SRI_SOAP_FAULT", "SRI_RESPONSE_XML_INVALID", "SRI_TRANSPORT_RESULT_UNCERTAIN"
]);

function normalizedStatus(value) {
  return String(value || "PENDIENTE").trim().toUpperCase();
}

function normalizedIdentifier(value) {
  const match = String(value || "").trim().match(/\d+/);
  return match ? match[0] : "";
}

function diagnosticMessage(error = {}, document = {}) {
  const identifier = String(error.identifier || "").trim();
  const message = String(error.message || document.last_error || "").trim();
  return [identifier, message].filter(Boolean).join(" — ");
}

function recoveryPolicy(detail = {}) {
  const document = detail.document || {};
  const status = normalizedStatus(document.status);
  const errors = Array.isArray(detail.errors) ? detail.errors : [];
  const attempts = Array.isArray(detail.transmissionAttempts) ? detail.transmissionAttempts : [];
  const transmissions = Array.isArray(detail.transmissions) ? detail.transmissions : [];
  const primaryError = errors[0] || {};
  const identifier = normalizedIdentifier(primaryError.identifier);
  const latestAttempt = attempts[0] || {};
  const latestTransmission = transmissions[0] || {};
  const technicalErrorCode = String(latestAttempt.error_class || latestTransmission.error_class || "").trim().toUpperCase();
  const authorizationStarted = transmissions.some(job => job.transmission_type === "AUTHORIZATION_QUERY");
  const uncertainHistory = [...attempts, ...transmissions].some(item => QUERY_FIRST_TECHNICAL_ERRORS.has(String(item.error_class || "").toUpperCase()));
  const transportDiagnostic = (detail.audit || []).find(row => row.action === "TRANSPORT_DIAGNOSTIC" && row.new_values?.attemptId === latestAttempt.id)?.new_values?.transport || null;
  const base = {
    status,
    diagnostic: {
      stage: primaryError.stage || latestTransmission.transmission_type || "",
      attemptedAt: latestAttempt.finished_at || latestAttempt.created_at || latestTransmission.finished_at || latestTransmission.created_at || "",
      identifier,
      message: String(primaryError.message || document.last_error || latestAttempt.error_message || latestTransmission.error_message || "").trim(),
      displayMessage: diagnosticMessage(primaryError, document),
      additionalInformation: String(primaryError.additional_information || "").trim(),
      accessKey: String(document.access_key || ""),
      documentNumber: String(document.full_number || ""),
      attemptId: String(latestAttempt.id || ""),
      transmissionId: String(primaryError.transmission_id || latestAttempt.transmission_id || latestTransmission.id || ""),
      transport: transportDiagnostic
    },
    canViewDiagnostic: ERROR_STATUSES.has(status),
    canTransmit: false,
    action: "NONE",
    actionLabel: "",
    reason: "El estado actual no permite una operación de recuperación."
  };

  if (["AUTORIZADO", "ANULADO"].includes(status)) {
    return {
      ...base,
      canViewDiagnostic: false,
      reason: status === "AUTORIZADO"
        ? "Un comprobante autorizado no puede volver a transmitirse."
        : "Un comprobante anulado no puede volver a transmitirse."
    };
  }

  if (withholdingDateRecovery(detail)) {
    return {
      ...base,
      action: "QUERY_AUTHORIZATION",
      nextAction: "AUTHORIZATION_LOOKUP_FIRST",
      actionLabel: "Consultar / reintentar SRI",
      reason: "La fecha de emisión ya corresponde al día actual de Ecuador. Se consultará la misma clave; solo si no consta autorización se reenviará el XML firmado existente."
    };
  }

  if (QUERY_ONLY_IDENTIFIERS.has(identifier) && ["DEVUELTO", "NO_AUTORIZADO"].includes(status)) {
    return {
      ...base,
      action: "QUERY_AUTHORIZATION",
      actionLabel: identifier === "70" ? "Consultar autorización" : "Consultar estado SRI",
      reason: identifier === "70"
        ? "La clave está en procesamiento. Solo se consultará autorización con la misma clave."
        : "El secuencial ya está registrado. Primero se consultará el estado de la misma clave, sin reenviar ni regenerar el comprobante."
    };
  }

  if (["ERROR_ENVIO", "PENDIENTE_REINTENTO", "ENVIADO_SRI"].includes(status)) {
    if (status === "ENVIADO_SRI" || authorizationStarted || uncertainHistory || technicalErrorCode !== "SRI_TRANSPORT_FAILED_DEFINITE") {
      return {
        ...base,
        action: "QUERY_AUTHORIZATION",
        transportResultState: "TRANSPORT_RESULT_UNCERTAIN",
        nextAction: "AUTHORIZATION_LOOKUP_FIRST",
        actionLabel: "Consultar estado en SRI",
        reason: "El resultado de la transmisión es incierto. Primero se consultará autorización con la misma clave, sin reenviar ni generar otro secuencial."
      };
    }
    const explicitlyNonRetryable = latestAttempt.retryable === false || latestTransmission.status === "FAILED";
    if (!explicitlyNonRetryable) {
      return {
        ...base,
        canTransmit: true,
        action: "RETRY_TRANSMISSION",
        transportResultState: "TRANSPORT_FAILED_DEFINITE",
        nextAction: "RETRY_TRANSMISSION",
        actionLabel: "Reintentar transmisión",
        reason: "El backend clasificó el error técnico como recuperable y reutilizará el documento existente."
      };
    }
  }

  if (["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(status)) {
    return {
      ...base,
      action: "PREPARE_CORRECTION",
      actionLabel: "Preparar corrección",
      reason: "La respuesta requiere corrección explícita. Esta acción solo registra la decisión; no reenvía, no cambia la clave y no reserva otro secuencial."
    };
  }

  return base;
}

module.exports = {
  ERROR_STATUSES,
  QUERY_FIRST_TECHNICAL_ERRORS,
  QUERY_ONLY_IDENTIFIERS,
  diagnosticMessage,
  normalizedIdentifier,
  recoveryPolicy
};
