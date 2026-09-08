const { SriError } = require("./errors.cjs");

const ENVIRONMENTS = Object.freeze({
  TEST: Object.freeze({ code: "1", label: "PRUEBAS", endpoints: Object.freeze({
    reception: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    authorization: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline"
  }) }),
  PRODUCTION: Object.freeze({ code: "2", label: "PRODUCCION", endpoints: Object.freeze({
    reception: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    authorization: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline"
  }) })
});

function reject(code, message) {
  throw new SriError(message, { code, httpStatus: 422, retryable: false });
}

function requireEnvironment(value) {
  if (value !== "TEST" && value !== "PRODUCTION") {
    reject("SRI_ENVIRONMENT_INVALID", "El ambiente SRI debe ser TEST o PRODUCTION.");
  }
  return value;
}

function environmentCode(value) { return ENVIRONMENTS[requireEnvironment(value)].code; }
function authorizationEnvironmentLabel(value) { return ENVIRONMENTS[requireEnvironment(value)].label; }

function endpointFor(environment, transmissionType) {
  const endpoints = ENVIRONMENTS[requireEnvironment(environment)].endpoints;
  if (transmissionType === "RECEPTION") return endpoints.reception;
  if (transmissionType === "AUTHORIZATION_QUERY") return endpoints.authorization;
  reject("SRI_TRANSMISSION_TYPE_INVALID", "El tipo de transmision SRI no es valido.");
}

function assertEnvironmentEnabled(settings, environment, companyId = settings?.company_id) {
  requireEnvironment(environment);
  requireEnvironment(settings?.environment);
  if (!companyId || settings?.company_id !== companyId) {
    reject("SRI_SETTINGS_COMPANY_MISMATCH", "La configuracion SRI no corresponde a la empresa del comprobante.");
  }
  const enabled = environment === "TEST" ? settings.test_enabled : settings.production_enabled;
  if (enabled !== true) {
    reject(environment === "TEST" ? "SRI_TEST_DISABLED" : "SRI_PRODUCTION_DISABLED", "El ambiente SRI del comprobante esta deshabilitado para esta empresa.");
  }
  // The current selector governs new issuance. Historical documents retain their
  // own environment and are gated only by the corresponding independent flag.
  return environment;
}

function assertDocumentEnvironment(document, { accessKey, xmlEnvironment } = {}) {
  const environment = requireEnvironment(document?.environment);
  const code = environmentCode(environment);
  const persistedKey = document?.access_key;
  for (const key of [persistedKey, accessKey]) {
    if (key !== undefined && key !== null && (typeof key !== "string" || key.length !== 49 || !/^\d{49}$/.test(key) || key[23] !== code)) {
      reject("SRI_DOCUMENT_ENVIRONMENT_MISMATCH", "La clave de acceso no corresponde al ambiente del comprobante.");
    }
  }
  if (accessKey !== undefined && accessKey !== persistedKey) {
    reject("SRI_DOCUMENT_ACCESS_KEY_MISMATCH", "El XML no contiene la clave de acceso persistida del comprobante.");
  }
  if (xmlEnvironment !== undefined && xmlEnvironment !== code) {
    reject("SRI_DOCUMENT_ENVIRONMENT_MISMATCH", "El XML no corresponde al ambiente del comprobante.");
  }
  return environment;
}

module.exports = {
  ENVIRONMENTS, requireEnvironment, environmentCode, authorizationEnvironmentLabel,
  endpointFor, assertEnvironmentEnabled, assertDocumentEnvironment
};
