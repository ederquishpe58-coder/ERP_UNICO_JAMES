import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const forge = require('node-forge');
const BLESS = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5';
const IMPERIO = 'ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const rucs = { [BLESS]: '1717637084001', [IMPERIO]: '1727970137001' };
const syntheticPassword = 'isolated-synthetic-fixture-only';
const checks = [];
const logs = [];
const beforeEnv = { ...process.env };
let authValid = true, capability = true, membership = true, canonicalActive = true, canonicalRuc = true;
const calls = { auth: 0, rpc: [], reads: [], writes: 0, storage: 0, transmissions: 0 };
const failWrite = () => { calls.writes++; throw Error('WRITE_FORBIDDEN'); };
const client = {
  auth: { async getUser(token) { calls.auth++; assert.equal(token, 'erp-user-jwt'); return { data: { user: authValid ? { id: 'isolated-user' } : null }, error: null }; } },
  from(table) {
    calls.reads.push(table);
    assert.equal(table, 'companies');
    let company;
    const query = {
      select(fields) { assert.equal(fields, 'id, tax_id, is_active'); return query; },
      eq(key, value) { assert.equal(key, 'id'); company = value; return query; },
      async maybeSingle() { return { data: { id: company, tax_id: canonicalRuc ? rucs[company] : '', is_active: canonicalActive }, error: null }; },
      insert: failWrite, update: failWrite, upsert: failWrite, delete: failWrite
    };
    return query;
  },
  get storage() { calls.storage++; throw Error('STORAGE_FORBIDDEN'); }
};
const supabasePath = require.resolve('@supabase/supabase-js');
const priorSupabase = require.cache[supabasePath];
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: {
  createClient(url, key, options) {
    assert.equal(url, 'https://isolated.invalid');
    assert.equal(key, 'isolated-server-key');
    if (options.global.headers.authorization) {
      assert.equal(options.global.headers.authorization, 'Bearer erp-user-jwt');
      return { async rpc(name, args) {
        calls.rpc.push({ name, args });
        assert.equal(name, 'erp_security_assert_capability');
        assert.equal(args.p_capability_id, 'tax.parameters.manage');
        assert.ok(Object.hasOwn(rucs, args.p_company_id));
        return { data: null, error: membership && capability ? null : { code: '42501', message: 'DENIED' } };
      } };
    }
    return client;
  }
} };
process.env.SUPABASE_URL = 'https://isolated.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-server-key';
delete process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
process.env.SRI_P12_PASSWORD_BLESS = syntheticPassword;
process.env.SRI_P12_PASSWORD_IMPERIO = syntheticPassword;
const handler = require('./api/sri.js');
const { identityRuc } = require('./api/sri/_lib/certificate-precheck.cjs');
const { identityDiagnostics } = require('./api/sri/_lib/certificate-identity-metadata.cjs');
const pair = forge.pki.rsa.generateKeyPair(2048);
const otherPair = forge.pki.rsa.generateKeyPair(2048);
const RUC_OID = '1.3.6.1.4.1.37746.3.11';
const textExtension = (id, value, type = forge.asn1.Type.UTF8) => ({ id, value: forge.asn1.toDer(forge.asn1.create(0, type, false, value)).getBytes() });
function p12({ company = BLESS, expired = false, future = false, unknown = false, ambiguous = false, noKey = false, wrongKey = false, extensions = [], subjectExtra = [], issuer = 'SECURITY DATA S.A. 2', rucValue = rucs[company] } = {}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01abcdef';
  cert.validity.notBefore = new Date(Date.now() + (future ? 86400000 : -86400000));
  cert.validity.notAfter = expired ? new Date(Date.now() - 1000) : new Date(company === BLESS ? '2029-03-28T00:00:00Z' : '2030-06-19T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'Synthetic ' + rucs[company] }];
  if (!unknown) attrs.push({ type: '2.5.4.5', value: rucs[company].slice(0, 10) });
  attrs.push(...subjectExtra);
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'organizationName', value: issuer }, { name: 'countryName', value: 'EC' }]);
  const identityExtensions = unknown ? [] : [textExtension(RUC_OID, rucValue),
    textExtension('1.3.6.1.4.1.37746.3.1', rucs[company].slice(0, 10)),
    textExtension('1.3.6.1.4.1.37746.3.8', company === BLESS ? '0981357267' : '0992645720')];
  if (ambiguous) identityExtensions.push(textExtension(RUC_OID, rucs[company === BLESS ? IMPERIO : BLESS]));
  cert.setExtensions([...identityExtensions, ...extensions]);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  const asn = forge.pkcs12.toPkcs12Asn1(noKey ? null : wrongKey ? otherPair.privateKey : pair.privateKey, [cert], syntheticPassword, { algorithm: '3des', count: 2048 });
  return Buffer.from(forge.asn1.toDer(asn).getBytes(), 'binary').toString('base64');
}
async function invoke(file, company = BLESS, options = {}) {
  const before = { writes: calls.writes, storage: calls.storage, transmissions: calls.transmissions };
  const request = { method: options.method || 'POST', url: '/api/sri?action=validate-certificate', headers: options.noAuth ? {} : { authorization: 'Bearer erp-user-jwt' },
    body: options.rawBody ?? { company_id: company, certificate_file: file, ...options.extra } };
  const headers = {};
  let value;
  const response = { setHeader(k, v) { headers[k] = v; }, end(text) { value = JSON.parse(text); } };
  await handler(request, response);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(request.body, undefined);
  assert.deepEqual({ writes: calls.writes, storage: calls.storage, transmissions: calls.transmissions }, before);
  const text = JSON.stringify(value);
  assert.ok(!text.includes(syntheticPassword) && !text.includes(file));
  const data = value.data;
  if (data) {
    assert.deepEqual(Object.keys(data).sort(), ['valid','crypto_valid','validity_valid','identity_diagnostics','company_id','ruc_match','identity_ruc','identity_ruc_oid','subject_safe_summary','issuer','serial_number','not_before','not_after','expired','private_key_present','private_key_usable','secret_resolution','certificate_format'].sort());
    assert.ok(!data.subject_safe_summary.includes(rucs[company]));
  }
  return { status: response.statusCode, ...value };
}
async function test(name, task) { await task(); checks.push({ name, result: 'PASS' }); }
const originalLog = console.error;
console.error = (...args) => logs.push(args);
try {
  const bless = p12();
  const imperio = p12({ company: IMPERIO });
  await test('A: both valid companies, canonical RUC, usable private key, SRI OFF and no settings', async () => {
    for (const [id, file] of [[BLESS, bless], [IMPERIO, imperio]]) {
      const r = await invoke(file, id); assert.equal(r.status, 200); assert.equal(r.data.valid, true); assert.equal(r.data.ruc_match, 'PASS'); assert.equal(r.data.private_key_usable, true);
      assert.equal(r.data.identity_ruc, rucs[id]); assert.equal(r.data.identity_ruc_oid, RUC_OID);
    }
  });
  await test('B/C: both certificate cross-company swaps rejected', async () => {
    for (const [id, file] of [[IMPERIO, bless], [BLESS, imperio]]) {
      const r = await invoke(file, id); assert.equal(r.data.valid, false); assert.equal(r.data.ruc_match, 'FAIL');
    }
  });
  await test('D: wrong runtime password fails closed', async () => {
    process.env.SRI_P12_PASSWORD_BLESS = 'wrong-isolated-password';
    assert.equal((await invoke(bless)).data.valid, false);
    process.env.SRI_P12_PASSWORD_BLESS = syntheticPassword;
  });
  await test('Missing runtime secret fails closed', async () => {
    delete process.env.SRI_P12_PASSWORD_BLESS;
    const r = await invoke(bless); assert.equal(r.data.secret_resolution, 'FAIL'); assert.equal(r.data.valid, false);
    process.env.SRI_P12_PASSWORD_BLESS = syntheticPassword;
  });
  await test('E: expired and not-yet-valid certificates fail closed', async () => {
    const expired = await invoke(p12({ expired: true })); assert.equal(expired.data.valid, false); assert.equal(expired.data.expired, true);
    assert.equal((await invoke(p12({ future: true }))).data.valid, false);
  });
  await test('F: corrupt PKCS12 fails closed without parser details', async () => { assert.equal((await invoke(Buffer.from('corrupt').toString('base64'))).data.valid, false); });
  await test('G: no auth and expired session return 401 before company/secret lookup', async () => {
    const reads = calls.reads.length, rpc = calls.rpc.length;
    assert.equal((await invoke(bless, BLESS, { noAuth: true })).status, 401);
    authValid = false; assert.equal((await invoke(bless)).status, 401); authValid = true;
    assert.equal(calls.reads.length, reads); assert.equal(calls.rpc.length, rpc);
  });
  await test('H: OWNER or ADMIN without capability returns 403, no company/secret lookup', async () => {
    capability = false; const reads = calls.reads.length;
    assert.equal((await invoke(bless, BLESS)).status, 403);
    assert.equal(calls.reads.length, reads); capability = true;
  });
  await test('I: wrong company membership returns 403 before certificate processing', async () => {
    membership = false; assert.equal((await invoke(bless, IMPERIO)).status, 403); membership = true;
    assert.equal((await invoke(bless, 'unscoped-company')).status, 403);
  });
  await test('Canonical company inactive or RUC missing fails closed', async () => {
    canonicalActive = false; assert.equal((await invoke(bless)).status, 422); canonicalActive = true;
    canonicalRuc = false; assert.equal((await invoke(bless)).status, 422); canonicalRuc = true;
  });
  await test('Client password/private key/secret override inputs are rejected', async () => {
    for (const key of ['password','secret_value','passwordSecretName','private_key','companyId']) assert.equal((await invoke(bless, BLESS, { extra: { [key]: 'forbidden' } })).status, 400);
    assert.equal((await invoke(bless, BLESS, { rawBody: '{"certificate_file":"SENSITIVE_CORRUPT' })).status, 400);
    assert.equal((await invoke(bless, BLESS, { method: 'GET' })).status, 405);
  });
  await test('Unknown/ambiguous RUC stays UNPROVEN; CN/name is not identity authority', async () => {
    for (const opts of [{ unknown: true }, { ambiguous: true }]) { const r = await invoke(p12(opts)); assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.valid, false); assert.equal(r.data.crypto_valid, true); assert.equal(r.data.validity_valid, true); }
    assert.equal(identityRuc({ subject: { attributes: [{ type: '2.5.4.5', value: '1717637084' }] } }), null);
  });
  await test('Security Data RUC OID is authoritative before conflicting secondary cedula/subject', async () => {
    const r = await invoke(p12({ subjectExtra: [{ type: '2.5.4.97', value: rucs[IMPERIO] }] }));
    assert.equal(r.data.identity_ruc, rucs[BLESS]); assert.equal(r.data.ruc_match, 'PASS');
  });
  await test('Only exact 13-digit RUC scalar accepted; no trimming, substring, prefix or length repair', async () => {
    for (const value of ['', '1717637084', '17176370840010', '171763708400X', ' 1717637084001', '1717637084001\n', 'RUC:1717637084001', '１７１７６３７０８４００１']) {
      const r = await invoke(p12({ rucValue: value }));
      assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.valid, false); assert.equal(r.data.identity_ruc, null);
    }
  });
  await test('Unsupported issuer cannot authorize Security Data OID even with matching subject RUC', async () => {
    for (const issuer of ['Other provider', 'SECURITY DATA S.A. 2 impostor', 'SECURITY DATA S.A.']) {
      const r = await invoke(p12({ issuer, subjectExtra: [{ type: '2.5.4.97', value: rucs[BLESS] }] }));
      assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.valid, false);
    }
  });
  await test('Missing .3.11: cedula, .3.1, .3.8 phone and unknown enterprise OIDs never prove RUC', async () => {
    for (const id of ['1.3.6.1.4.1.37746.3.1', '1.3.6.1.4.1.37746.3.8', '1.3.6.1.4.1.37746.3.111', '1.3.6.1.4.1.55555.11']) {
      for (const value of [rucs[BLESS].slice(0, 10), rucs[BLESS]]) {
        const r = await invoke(p12({ unknown: true, subjectExtra: [{ type: '2.5.4.5', value: rucs[BLESS].slice(0, 10) }], extensions: [textExtension(id, value)] }));
        assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.identity_ruc, null); assert.equal(r.data.valid, false);
      }
    }
  });
  await test('Strict DER: reject corrupt, trailing, composite and duplicate RUC encodings', async () => {
    const scalar = textExtension(RUC_OID, rucs[BLESS]).value;
    const composite = forge.asn1.toDer(forge.asn1.create(0, 16, true, [forge.asn1.create(0, 12, false, rucs[BLESS])])).getBytes();
    for (const value of [rucs[BLESS], 'corrupt', scalar + 'extra', composite]) {
      const r = await invoke(p12({ unknown: true, extensions: [{ id: RUC_OID, value }] }));
      assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.valid, false);
    }
    const duplicate = await invoke(p12({ extensions: [textExtension(RUC_OID, rucs[BLESS])] }));
    assert.equal(duplicate.data.ruc_match, 'UNPROVEN'); assert.equal(duplicate.data.valid, false);
  });
  await test('Issuer profile is exact and country compatible, never subject-name authority', async () => {
    const certificate = { issuer: { attributes: [{ type: '2.5.4.10', value: 'SECURITY DATA S.A. 2' }, { type: '2.5.4.6', value: 'EC' }] }, extensions: [textExtension(RUC_OID, rucs[BLESS])] };
    assert.equal(identityRuc(certificate), rucs[BLESS]);
    certificate.issuer.attributes[1].value = 'US'; assert.equal(identityRuc(certificate), null);
    certificate.issuer.attributes = [{ type: '2.5.4.10', value: 'Other' }, { type: '2.5.4.3', value: 'SECURITY DATA S.A. 2' }];
    assert.equal(identityRuc(certificate), null);
  });
  await test('Supported scalar DER encodings and bounded OCTET wrapper preserve exact RUC', async () => {
    for (const type of [12, 19, 22, 30, 18]) {
      const r = await invoke(p12({ unknown: true, extensions: [textExtension(RUC_OID, rucs[BLESS], type)] }));
      assert.equal(r.data.ruc_match, 'PASS'); assert.equal(r.data.identity_ruc, rucs[BLESS]);
    }
    const wrapped = forge.asn1.toDer(forge.asn1.create(0, 4, false, textExtension(RUC_OID, rucs[BLESS]).value)).getBytes();
    assert.equal((await invoke(p12({ unknown: true, extensions: [{ id: RUC_OID, value: wrapped }] }))).data.ruc_match, 'PASS');
  });
  await test('Unknown provider extension metadata exposes OID/candidate, NEVER changes UNPROVEN to PASS', async () => {
    const value = forge.asn1.toDer(forge.asn1.create(0, 12, false, '1717637084')).getBytes();
    const r = await invoke(p12({ unknown: true, extensions: [{ id: '1.3.6.1.4.1.55555.1', value }] }));
    assert.equal(r.data.crypto_valid, true); assert.equal(r.data.ruc_match, 'UNPROVEN'); assert.equal(r.data.valid, false);
    const candidate = r.data.identity_diagnostics.candidate_identifiers.find(c => c.oid === '1.3.6.1.4.1.55555.1');
    assert.equal(candidate.value, '1717637084'); assert.equal(candidate.authority, 'UNVERIFIED');
  });
  await test('SAN otherName/UID and explicit IDCEC prefix are observable, not silently normalized', async () => {
    const nested = forge.asn1.create(0, 16, true, [forge.asn1.create(128, 0, true, [
      forge.asn1.create(0, 6, false, forge.asn1.oidToDer('1.3.6.1.4.1.55555.2').getBytes()),
      forge.asn1.create(128, 0, true, [forge.asn1.create(0, 12, false, '1727970137')])
    ])]);
    const r = await invoke(p12({ company: IMPERIO, unknown: true,
      subjectExtra: [{ type: '0.9.2342.19200300.100.1.1', value: '1727970137' }, { type: '2.5.4.5', value: 'IDCEC-1727970137' }],
      extensions: [{ id: '2.5.29.17', value: forge.asn1.toDer(nested).getBytes() }] }), IMPERIO);
    assert.equal(r.data.valid, false); assert.equal(r.data.ruc_match, 'UNPROVEN');
    const d = r.data.identity_diagnostics;
    assert.ok(d.subject_alt_name_types.includes('otherName'));
    assert.ok(d.extensions[0].embedded_oids.includes('1.3.6.1.4.1.55555.2'));
    assert.ok(d.candidate_identifiers.some(c => c.identity_prefix === 'IDCEC-' && c.value === '1727970137'));
  });
  await test('Diagnostics redact names, emails, friendlyName and binary values; tolerate corrupt extension', async () => {
    const d = identityDiagnostics({ subject: { attributes: [{ type: '2.5.4.3', value: 'SENSITIVE_NAME' }, { type: '1.2.840.113549.1.9.1', value: 'sensitive@example.invalid' }] },
      issuer: { attributes: [] }, extensions: [{ id: '2.5.29.17', altNames: [{ type: 1, value: 'sensitive@example.invalid' }], value: 'RAW_SECRET_DER_SENTINEL' }] },
      { friendlyName: ['PRIVATE_FRIENDLY_NAME'], localKeyId: ['PRIVATE_BINARY'] });
    const text = JSON.stringify(d);
    for (const secret of ['SENSITIVE_NAME', 'sensitive@example.invalid', 'RAW_SECRET_DER_SENTINEL', 'PRIVATE_FRIENDLY_NAME', 'PRIVATE_BINARY']) assert.ok(!text.includes(secret));
    assert.deepEqual(d.subject_alt_name_types, ['rfc822Name']);
    assert.equal(d.pkcs12_attributes.friendly_name_present, true);
    assert.equal(d.pkcs12_attributes.authority, 'AUXILIARY_ONLY');
  });
  await test('No private key or unrelated private key fails closed', async () => {
    for (const opts of [{ noKey: true }, { wrongKey: true }]) { const r = await invoke(p12(opts)); assert.equal(r.data.valid, false); assert.equal(r.data.private_key_usable, false); }
  });
  await test('File bounds and malformed base64 rejected', async () => {
    assert.equal((await invoke('not base64')).status, 400);
    assert.equal((await invoke('A'.repeat(4 * 1024 * 1024 + 4))).status, 400);
  });
  await test('J: DB/settings/points/sequences/certificates/storage/documents/business writes all zero; no logs', async () => {
    assert.equal(calls.writes, 0); assert.equal(calls.storage, 0); assert.equal(calls.transmissions, 0); assert.deepEqual(logs, []);
    assert.ok(calls.reads.every(t => t === 'companies'));
  });

  let uiCompany = BLESS, uiCapability = true, requestCount = 0, responseCompany = BLESS, networkFail = false, delayedRead = false;
  const sessions = { session: { access_token: 'erp-user-jwt' } };
  const erp = { env: { sriEnabled: false, sriSupabaseEnabled: false }, services: { companyContext: { activeCompanyId: () => uiCompany } },
    authAccess: { activeAccess: () => ({ companies: Object.keys(rucs).map(id => ({ id })) }) },
    capabilityRuntime: { status: () => ({ companyId: uiCompany, loaded: true }), can: () => uiCapability },
    getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: sessions, error: null }) } }) };
  const storage = { getItem: () => null, setItem: failWrite, removeItem: failWrite };
  const ctx = { window: { BlessERP: erp, localStorage: storage }, localStorage: storage, sessionStorage: storage,
    URLSearchParams, Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    fetch: async (url, options) => {
      requestCount++; assert.equal(url, '/api/sri?action=validate-certificate'); assert.equal(options.headers.authorization, 'Bearer erp-user-jwt');
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['certificate_file','company_id']);
      return { ok: !networkFail, async json() { return networkFail ? { ok: false, error: { message: 'Fallo controlado' } } : { ok: true, data: { valid: true, crypto_valid: true, validity_valid: true, company_id: responseCompany, ruc_match: 'PASS', identity_ruc: rucs[responseCompany], identity_ruc_oid: RUC_OID, not_after: responseCompany === BLESS ? '2029-03-28T00:00:00Z' : '2030-06-19T00:00:00Z', private_key_usable: true } }; } };
    } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(root + '/scripts/services/sri/sri-api-client.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(root + '/scripts/services/sri/certificate-precheck-ui.js', 'utf8'), ctx);
  const file = { name: 'synthetic.p12', size: 3, async arrayBuffer() { if (delayedRead) uiCompany = IMPERIO; return Uint8Array.from([1,2,3]).buffer; } };
  await test('UI/client: canonical company and capability with both SRI flags OFF, no configuration discovery', async () => {
    assert.equal(erp.sriApi.certificatePrecheckCompany(), BLESS);
    assert.ok(erp.sriCertificatePrecheck.render().includes('Validar certificado'));
    assert.equal((await erp.sriApi.validateCertificate(BLESS, file)).valid, true);
    uiCapability = false; assert.equal(erp.sriCertificatePrecheck.render(), '');
    await assert.rejects(erp.sriApi.validateCertificate(BLESS, file)); uiCapability = true;
  });
  await test('UI/client: company switch before send prevents request; wrong-company response rejected', async () => {
    const before = requestCount; delayedRead = true;
    await assert.rejects(erp.sriApi.validateCertificate(BLESS, file)); assert.equal(requestCount, before);
    delayedRead = false; uiCompany = BLESS; responseCompany = IMPERIO;
    await assert.rejects(erp.sriApi.validateCertificate(BLESS, file)); responseCompany = BLESS;
  });
  await test('UI: confirms server result, clears file, failure never shows success, stale result discarded', async () => {
    let click;
    const input = { files: [file], value: 'selected', disabled: false };
    const button = { disabled: false, addEventListener: (event, cb) => { assert.equal(event, 'click'); click = cb; } };
    const output = { textContent: '' };
    const diagnostic = { hidden: true }, diagnosticText = { value: '' };
    const panel = { isConnected: true, querySelector: s => s.includes('-dry-run') || s.includes('-fixture') ? null : s.includes('-diagnostic-text') ? diagnosticText : s.includes('-diagnostic') ? diagnostic : s.includes('-file') ? input : s.includes('-validate') ? button : output };
    erp.sriCertificatePrecheck.bind({ querySelector: () => panel });
    await click(); assert.match(output.textContent, /Certificado válido/); assert.equal(input.value, ''); assert.equal(button.disabled, false);
    assert.match(output.textContent, /Certificado criptográficamente válido: sí/);
    assert.match(output.textContent, /RUC demostrado: 1717637084001/); assert.match(output.textContent, /Vence: 2029-03-28/);
    uiCompany = IMPERIO; responseCompany = IMPERIO; erp.sriCertificatePrecheck.bind({ querySelector: () => panel });
    await click(); assert.match(output.textContent, /RUC demostrado: 1727970137001/); assert.match(output.textContent, /Vence: 2030-06-19/);
    uiCompany = BLESS; responseCompany = BLESS; erp.sriCertificatePrecheck.bind({ querySelector: () => panel });
    networkFail = true; await click(); assert.equal(output.textContent, 'Fallo controlado'); assert.equal(input.value, ''); networkFail = false;
    const original = erp.sriApi.validateCertificate;
    erp.sriApi.validateCertificate = async () => ({ valid: false, crypto_valid: true, validity_valid: true, ruc_match: 'UNPROVEN', company_id: BLESS, private_key_usable: true, identity_diagnostics: { diagnostic_only: true } });
    await click(); assert.match(output.textContent, /Certificado válido; identidad tributaria no pudo demostrarse/);
    assert.equal(diagnostic.hidden, false); assert.equal(JSON.parse(diagnosticText.value).valid, false);
    erp.sriApi.validateCertificate = async () => ({ valid: false, crypto_valid: true, validity_valid: true, ruc_match: 'FAIL', company_id: BLESS, private_key_usable: true });
    await click(); assert.match(output.textContent, /no coincide con esta empresa/); assert.equal(diagnostic.hidden, true); assert.equal(diagnosticText.value, '');
    erp.sriApi.validateCertificate = async () => ({ valid: false, crypto_valid: true, validity_valid: false, ruc_match: 'PASS', company_id: BLESS, private_key_usable: true });
    await click(); assert.match(output.textContent, /fuera de vigencia/);
    erp.sriApi.validateCertificate = async () => ({ valid: false, crypto_valid: false, validity_valid: false, ruc_match: 'UNPROVEN', company_id: BLESS });
    await click(); assert.match(output.textContent, /No fue posible validar criptográficamente/);
    erp.sriApi.validateCertificate = async () => { uiCompany = IMPERIO; return { valid: true }; };
    await click(); assert.equal(output.textContent, ''); assert.equal(input.value, ''); assert.equal(diagnostic.hidden, true); assert.equal(diagnosticText.value, ''); erp.sriApi.validateCertificate = original;
  });
  assert.equal(calls.writes, 0); assert.equal(calls.storage, 0);
} finally {
  console.error = originalLog;
  for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
  Object.assign(process.env, beforeEnv);
  if (priorSupabase) require.cache[supabasePath] = priorSupabase; else delete require.cache[supabasePath];
}
const report = { at: new Date().toISOString(), result: 'PASS', checks, isolatedOnly: true,
  realCertificatesUsed: false, realSecretsRead: false, writes: 0, storageCalls: 0, sequenceAllocations: 0,
  documentCreates: 0, transmissions: 0, leakedLogs: 0, runtimeProductionSecrets: 'REQUIRES_HUMAN_INVOCATION' };
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, tests: checks.length, writes: 0, storageCalls: 0 }));
