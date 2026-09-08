const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateSriConfiguration } = require('./api/sri/_lib/technical-readiness.cjs');
const routing = require('./scripts/modules/comercial/invoice-sequence-core.js');
const clone = value => JSON.parse(JSON.stringify(value));
const companies = [
  { key: 'BLESS_FLOWER', id: '11111111-1111-4111-8111-111111111111', ruc: '1717637084001' },
  { key: 'IMPERIO_FLOWERS', id: '22222222-2222-4222-8222-222222222222', ruc: '1727970137001' }
];
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function config(company, environment) {
  const settings = { company_id: company.id, environment, test_enabled: true, production_enabled: true,
    ruc: company.ruc, legal_name: 'EMISOR SINTETICO', head_office_address: 'DIRECCION SINTETICA', emission_type: '1',
    immediate_transmission: true, technical_spec_version: '2.34', invoice_xml_version: '1.1.0', credit_note_xml_version: '1.1.0',
    withholding_xml_version: '2.0.0', withholding_agent_number: company.key === 'BLESS_FLOWER' ? '10' : null };
  const emissionPoints = ['TEST', 'PRODUCTION'].flatMap(env => ['002', '003'].map(code => ({
    id: `${company.id}-${env}-${code}`, company_id: company.id, environment: env, active: true,
    establishment_code: '001', emission_point_code: code, establishment_address: 'DIRECCION SINTETICA'
  })));
  const sequences = emissionPoints.flatMap(point => ['01', '04', ...(point.emission_point_code === '002' && settings.withholding_agent_number ? ['07'] : [])]
    .map(type => ({ company_id: company.id, environment: point.environment, emission_point_id: point.id, document_type: type, next_value: 31 })));
  const certificates = [{ id: `cert-${company.id}`, company_id: company.id, subject_ruc: company.ruc, active: true,
    validation_status: 'VALID', valid_from: '2025-01-01T00:00:00Z', valid_until: '2030-01-01T00:00:00Z' }];
  return { settings, emissionPoints, sequences, certificates };
}
async function main() {
  let pendingResponse = null;
  let requests = [];
  const configurations = new Map(companies.map(company => [company.id, config(company, 'TEST')]));
  const window = { sessionStorage: { getItem: () => null, setItem() {} }, BlessERP: {
    getEnvConfig: () => ({ supabaseEnabled: true, authEnabled: true }),
    getSupabaseStatus: () => ({ configured: true, hasRuntimeFactory: true }),
    getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'SYNTHETIC-ONLY' } } }) } })
  } };
  const context = vm.createContext({ window, URL, URLSearchParams, Date, Intl, console, setTimeout, clearTimeout,
    fetch: async (path, options = {}) => {
      requests.push({ path, options });
      if (pendingResponse) return pendingResponse;
      const url = new URL(path, 'https://fixture.invalid');
      const result = clone(configurations.get(url.searchParams.get('companyId')));
      if (url.searchParams.has('environment')) result.selectedEnvironment = url.searchParams.get('environment');
      return { ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => ({ ok: true, data: result }) };
    }
  });
  vm.runInContext(fs.readFileSync('scripts/services/sri/sri-api-client.js', 'utf8'), context);
  const api = window.BlessERP.sriApi;
  check(api.activeCompany().environment === null, 'No frontend environment before canonical configuration');
  for (const value of [undefined, null, '', 'PROD', 'production', 'UNKNOWN', 1, 2]) {
    assert.throws(() => api.environmentDefinition(value)); checks++;
  }
  for (const company of companies) {
    for (const environment of ['TEST', 'PRODUCTION']) {
      const configuration = config(company, environment);
      api.bindRuntimeCompany(company.key, company.id, configuration, 'OWNER');
      api.selectCompany(company.key);
      check(api.companyIdentity().environmentCode === (environment === 'TEST' ? '1' : '2'), 'Canonical environment code');
      check(api.validateCompanyConfiguration(configuration).ok, 'Scoped configuration and certificate');
      check(validateSriConfiguration(configuration).readyForSignature, 'Backend readiness matrix');
      for (const market of ['LOCAL', 'EXPORTACION']) {
        const context = { companyId: company.id, saleType: market };
        const point = routing.resolveEmissionPoint(configuration, context);
        check(point?.environment === environment && point.company_id === company.id
          && point.emission_point_code === (market === 'LOCAL' ? '003' : '002'), 'Company/environment/market exact route');
        const foreign = clone(configuration);
        foreign.emissionPoints.forEach(row => { row.company_id = companies.find(other => other.id !== company.id).id; });
        check(routing.resolveEmissionPoint(foreign, context) === null, 'Foreign route blocked');
        const opposite = clone(configuration);
        opposite.emissionPoints = opposite.emissionPoints.filter(row => row.environment !== environment);
        check(routing.resolveEmissionPoint(opposite, context) === null, 'Opposite environment cannot supply route');
        const duplicates = clone(configuration);
        duplicates.emissionPoints.push(clone(point));
        check(routing.resolveEmissionPoint(duplicates, context) === null, 'Ambiguous route blocked');
      }
      const disabled = clone(configuration);
      disabled.settings[environment === 'TEST' ? 'test_enabled' : 'production_enabled'] = false;
      check(!validateSriConfiguration(disabled).readyForXml, 'Disabled environment blocked');
      check(!api.validateCompanyConfiguration(disabled).readyForInvoice, 'UI disabled environment blocked');
      const noSequence = clone(configuration);
      noSequence.sequences = noSequence.sequences.filter(row => row.environment !== environment);
      check(!validateSriConfiguration(noSequence).readyForXml, 'No opposite environment sequence fallback');
      const badSequence = clone(configuration);
      badSequence.sequences.forEach(row => { row.next_value = 1000000000; });
      check(!validateSriConfiguration(badSequence).readyForXml, 'Exhausted sequence blocked');
      for (const mutate of [
        row => { row.company_id = companies.find(other => other.id !== company.id).id; },
        row => { row.subject_ruc = '9999999999999'; },
        row => { row.active = false; },
        row => { row.valid_until = '2020-01-01T00:00:00Z'; },
        row => { row.validation_status = 'INVALID'; }
      ]) {
        const bad = clone(configuration); mutate(bad.certificates[0]);
        check(!validateSriConfiguration(bad).readyForSignature, 'Certificate fail closed');
        check(!api.validateCompanyConfiguration(bad).readyForSignature, 'UI certificate fail closed');
      }
      const crossed = clone(configuration); crossed.settings.company_id = companies.find(other => other.id !== company.id).id;
      assert.throws(() => api.bindRuntimeCompany(company.key, company.id, crossed)); checks++;
    }
  }
  const bless = companies[0], imperio = companies[1];
  for (const company of companies) api.bindRuntimeCompany(company.key, company.id, config(company, 'TEST'));
  api.selectCompany(bless.key);
  requests = [];
  await assert.rejects(api.post('set-environment-enabled', { companyId: imperio.id, environment: 'PRODUCTION', enabled: true }), /otra empresa/); checks++;
  check(requests.length === 0, 'Cross-company write blocked before fetch');
  const fullConfig = await api.configuration();
  check(fullConfig.settings.company_id === bless.id && api.activeCompany().environment === 'TEST', 'Configuration canonical ACK binding');
  await api.configuration('PRODUCTION');
  check(requests.at(-1).path.includes('environment=PRODUCTION'), 'Explicit environment read');
  check(api.activeCompany().environment === 'TEST', 'Reading PROD does not select it for new issuance');
  await assert.rejects(api.configuration('')); checks++;

  let resolveFetch;
  pendingResponse = new Promise(resolve => { resolveFetch = resolve; });
  const pending = api.configuration();
  await new Promise(resolve => setTimeout(resolve, 0));
  api.selectCompany(imperio.key);
  resolveFetch({ ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => ({ ok: true, data: config(bless, 'PRODUCTION') }) });
  await assert.rejects(pending, /empresa cambio/); checks++;
  check(api.companyIdentity(bless.key).environment === 'TEST' && api.activeCompany().environment === 'TEST', 'Stale response cannot mutate bindings');
  pendingResponse = null;

  // Exercise actual route selector/rendering, not a separate model of it.
  window.BlessERP.comercialUtils = { esc: value => String(value) };
  window.BlessERP.comercialState = { getOrders: () => [] };
  const uiSource = fs.readFileSync('scripts/modules/comercial/sri-authorization.js', 'utf8');
  vm.runInContext(uiSource.replace(/\}\)\(\);\s*$/, 'window.__testUi = { ui, currentEnvironmentPoints, selectedEnvironmentLabel, renderReadiness, technicalReadiness, activeEmissionPoint }; })();'), context);
  const surface = window.__testUi;
  for (const company of companies) for (const environment of ['TEST', 'PRODUCTION']) {
    const configuration = config(company, environment);
    api.bindRuntimeCompany(company.key, company.id, configuration);
    api.selectCompany(company.key);
    surface.ui.companyKey = company.key;
    surface.ui.configuration = configuration;
    check(surface.currentEnvironmentPoints().every(point => point.environment === environment && point.company_id === company.id), 'UI point isolation');
    check(surface.activeEmissionPoint().environment === environment, 'UI selection current environment');
    check(surface.renderReadiness().includes(environment === 'TEST' ? 'PRUEBAS' : 'PRODUCCION'), 'Readiness renders real environment');
    surface.ui.emissionPointIdByCompany[company.key] = `${company.id}-${environment === 'TEST' ? 'PRODUCTION' : 'TEST'}-002`;
    check(surface.activeEmissionPoint().environment === environment, 'Stale selected point cannot migrate environment');
  }
  surface.ui.configuration = null;
  check(!surface.technicalReadiness().readyForXml && surface.activeEmissionPoint() === null, 'Missing configuration fails closed');
  console.log(JSON.stringify({ ok: true, checks, environments: 2, companies: 2, realNetworkRequests: 0, databaseWrites: 0, sriTransmissions: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
