const { randomUUID } = require('node:crypto');
const { SriError, SriValidationError } = require('./errors.cjs');
const { requireEnvironment } = require('./environment.cjs');
const { bearerToken, getSupabaseUserContext } = require('./supabase-admin.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function operationId(value, legacy = false) {
  if (legacy && !value) return randomUUID();
  if (!UUID.test(String(value || ''))) throw new SriValidationError('La operacion requiere un identificador UUID estable.');
  return value;
}
function companyId(value) {
  if (!UUID.test(String(value || ''))) throw new SriValidationError('Seleccione una empresa canonica.');
  return value;
}
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new SriError(error.message || 'No se pudo guardar la configuracion SRI.', {
    code: /^SRI_[A-Z_]+$/.test(error.message || '') ? error.message : 'SRI_CONFIGURATION_REJECTED',
    httpStatus: ['40001', '23505'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 422
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SriError('La confirmacion del servidor esta incompleta.', { code: 'SRI_CONFIGURATION_ACK_INVALID', httpStatus: 502 });
  return data;
}
function assertAck(data, expected) {
  if (Object.entries(expected).some(([key, value]) => data[key] !== value)) throw new SriError('La confirmacion del servidor no coincide con la operacion.', { code: 'SRI_CONFIGURATION_ACK_INVALID', httpStatus: 502 });
  return data;
}
async function authenticateConfigurationRequest(admin, request, requestedCompanyId) {
  const accessToken = bearerToken(request);
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data?.user?.id) throw new SriValidationError('La sesion no es valida o expiro.');
  // The exact canonical capability RPC validates active profile, company and membership.
  // Configuration never intersects the old SRI role catalog with canonical capabilities.
  return { user: data.user, companyId: companyId(requestedCompanyId), accessToken };
}
async function settingsRow(client, id) {
  const data = await rpc(client, 'erp_sri_configuration_state', { p_company_id: id });
  if (!data.settings || data.settings.company_id !== id) throw new SriValidationError('La empresa no tiene configuracion SRI canonica.');
  return data.settings;
}
async function saveDocumentSequence(client, id, input = {}, opId) {
  const legacy = input.nextValue == null;
  const environment = requireEnvironment(input.environment);
  if (legacy && environment !== 'TEST') throw new SriValidationError('Produccion requiere el siguiente secuencial exacto.');
  const next = legacy ? Number(input.lastIssuedNumber ?? input.currentNumber ?? 0) + 1 : Number(input.nextValue);
  if (!Number.isSafeInteger(next) || next < 1 || next > 999999999) throw new SriValidationError('El siguiente secuencial debe estar entre 1 y 999999999.');
  if (!UUID.test(String(input.emissionPointId || ''))) throw new SriValidationError('Seleccione un punto de emision canonico.');
  let expected = input.expectedNextValue;
  if (legacy && expected === undefined) {
    const state = await rpc(client, 'erp_sri_configuration_state', { p_company_id: id });
    expected = state.sequences?.find(row => row.company_id === id && row.environment === environment && row.emission_point_id === input.emissionPointId && row.document_type === input.documentType)?.next_value ?? null;
  }
  if (expected === undefined || (expected !== null && (!Number.isSafeInteger(Number(expected)) || Number(expected) < 1))) {
    throw new SriValidationError('Recargue el valor actual antes de guardar el secuencial.');
  }
  const op = operationId(opId, legacy);
  const data = await rpc(client, 'erp_sri_set_sequence_next', { p_company_id: id, p_environment: environment,
    p_emission_point_id: input.emissionPointId, p_document_type: String(input.documentType || ''), p_next_value: next,
    p_expected_next_value: expected === null ? null : Number(expected), p_operation_id: op,
    p_reason: String(input.reason || (legacy ? 'Configuracion explicita del ultimo secuencial TEST' : '')).trim() });
  return assertAck(data, { company_id: id, environment, emission_point_id: input.emissionPointId, document_type: String(input.documentType || ''), next_value: next, operation_id: op });
}
async function saveEmissionPoint(client, id, input = {}, opId) {
  const legacy = !opId;
  const environment = requireEnvironment(input.environment);
  let expected = input.expectedUpdatedAt;
  if (legacy && expected === undefined) {
    const state = await rpc(client, 'erp_sri_configuration_state', { p_company_id: id });
    expected = state.emissionPoints?.find(row => row.company_id === id && row.environment === environment && row.establishment_code === input.establishmentCode && row.emission_point_code === input.emissionPointCode)?.updated_at ?? null;
  }
  if (expected === undefined) throw new SriValidationError('Recargue el punto de emision antes de guardar.');
  const data = await rpc(client, 'erp_sri_save_emission_point', { p_company_id: id, p_environment: environment,
    p_establishment_code: String(input.establishmentCode || ''), p_emission_point_code: String(input.emissionPointCode || ''),
    p_address: String(input.establishmentAddress || ''), p_name: input.name || null, p_active: input.active !== false,
    p_expected_updated_at: expected, p_operation_id: operationId(opId, legacy) });
  if (!UUID.test(String(data.id || '')) || !data.updated_at) throw new SriError('La confirmacion del punto esta incompleta.', { code: 'SRI_CONFIGURATION_ACK_INVALID', httpStatus: 502 });
  return assertAck(data, { company_id: id, environment, establishment_code: String(input.establishmentCode || ''), emission_point_code: String(input.emissionPointCode || ''), active: input.active !== false });
}
async function saveSettings(client, id, input = {}, opId) {
  const stored = await settingsRow(client, id);
  const map = { legalName: 'legal_name', commercialName: 'commercial_name', ruc: 'ruc', headOfficeAddress: 'head_office_address',
    accountingRequired: 'accounting_required', specialTaxpayerNumber: 'special_taxpayer_number', withholdingAgentNumber: 'withholding_agent_number',
    rimpeLabel: 'rimpe_label', invoiceXmlVersion: 'invoice_xml_version', creditNoteXmlVersion: 'credit_note_xml_version',
    deliveryGuideXmlVersion: 'delivery_guide_xml_version', withholdingXmlVersion: 'withholding_xml_version', retryInitialSeconds: 'retry_initial_seconds',
    retryMaxSeconds: 'retry_max_seconds', retryMaxAttempts: 'retry_max_attempts', xmlRideEmails: 'xml_ride_emails' };
  const values = Object.fromEntries(Object.entries(map).filter(([key]) => Object.hasOwn(input, key)).map(([key, column]) => [column, input[key]]));
  for (const [key, column] of [['environment', 'environment'], ['testEnabled', 'test_enabled'], ['productionEnabled', 'production_enabled']]) {
    if (Object.hasOwn(input, key) && input[key] !== stored[column]) throw new SriValidationError('Cambie el ambiente mediante su activacion explicita.');
  }
  const data = await rpc(client, 'erp_sri_save_settings', { p_company_id: id, p_settings: values,
    p_expected_updated_at: input.expectedUpdatedAt ?? stored.updated_at, p_operation_id: operationId(opId, true) });
  return assertAck(data, { company_id: id, environment: stored.environment, test_enabled: stored.test_enabled, production_enabled: stored.production_enabled });
}
async function setEnvironmentEnabled(client, id, input = {}) {
  if (typeof input.enabled !== 'boolean' || typeof input.expectedEnabled !== 'boolean') throw new SriValidationError('La activacion requiere estado actual y estado solicitado explicitos.');
  const environment = requireEnvironment(input.environment);
  const op = operationId(input.operationId);
  const data = await rpc(client, 'erp_sri_set_environment_enabled', { p_company_id: id, p_environment: environment,
    p_enabled: input.enabled, p_expected_enabled: input.expectedEnabled, p_operation_id: op,
    p_reason: String(input.reason || '').trim() });
  return assertAck(data, { company_id: id, operation_id: op, [environment === 'TEST' ? 'test_enabled' : 'production_enabled']: input.enabled,
    ...(input.enabled ? { environment } : {}) });
}
module.exports = { authenticateConfigurationRequest, saveDocumentSequence, saveEmissionPoint, saveSettings, setEnvironmentEnabled, getSupabaseUserContext };
