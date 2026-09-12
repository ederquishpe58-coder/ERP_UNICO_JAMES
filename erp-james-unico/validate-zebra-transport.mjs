import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('scripts/services/zebra-browser-print.js', 'utf8');
const base = '8dc6c5a9935964792e483f655cc4eaaecf179d17';
const old = execFileSync('git', ['show', `${base}:erp-james-unico/scripts/services/zebra-browser-print.js`], { encoding: 'utf8' });
const device = { uid: 'fixture-printer', name: 'Fixture', connection: 'usb', deviceType: 'printer', version: 5, provider: 'fixture' };
const zpl = '^XA^PW609^LL464^FO20,20^A0N,30,30^FDFIXTURE^FS^PQ1^XZ';
function setup(code = source, options = {}) {
  const requests = [];
  const window = { location: { protocol: 'https:', origin: 'https://bless-flower-jaeder-prod-indol.vercel.app' }, navigator: { userAgent: options.safari ? 'Version/18 Safari/605' : 'Chrome/140' }, crypto: webcrypto, BrowserPrint: options.sdk };
  const fetch = async (url, config) => {
    requests.push({ url, config });
    if (url.endsWith('write')) {
      if (options.timeout) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (options.error) return { ok: false, status: 503 };
      if (options.hold) await options.hold;
      return { ok: true, text: async () => '' };
    }
    return { ok: true, text: async () => options.missing ? '' : JSON.stringify(device) };
  };
  vm.runInNewContext(code, { window, fetch, AbortController, setTimeout, clearTimeout, TextEncoder, Uint8Array });
  return { api: window.BlessERP.zebraBrowserPrint, requests, window };
}
const prior = setup(old);
await prior.api.send(zpl);
assert.equal(JSON.parse(prior.requests[1].config.body).device.version, 5);
assert.match(prior.requests[1].url, /https:\/\/localhost:9101/);
const current = setup();
assert.equal(current.requests.length, 0, 'No automatic requests');
await current.api.send(zpl);
assert.equal(current.requests.filter(r => r.url.endsWith('write')).length, 1);
assert.equal(current.requests[1].url, 'http://127.0.0.1:9100/write');
assert.equal(JSON.parse(current.requests[1].config.body).device.version, 2);
assert.equal(JSON.parse(current.requests[1].config.body).data, zpl);
assert.equal(current.api.getDiagnostic().stage, 'ACEPTADO_POR_BROWSER_PRINT');
assert.match(current.api.getDiagnostic().sha256, /^[0-9a-f]{64}$/);
assert.equal(setup(source, { safari: true }).api.baseUrl(), 'https://127.0.0.1:9101/');
const missing = setup(source, { missing: true });
await assert.rejects(missing.api.send(zpl), /predeterminada/);
assert.equal(missing.requests.length, 1);
const empty = setup();
await assert.rejects(empty.api.send(''), /vacio/);
assert.equal(empty.requests.length, 0);
for (const mode of ['error', 'timeout']) {
  const failed = setup(source, { [mode]: true });
  await assert.rejects(failed.api.send(zpl), mode === 'timeout' ? /incierto/ : /503/);
  assert.equal(failed.requests.filter(r => r.url.endsWith('write')).length, 1, 'No retry or alternate send');
}
let release;
const held = setup(source, { hold: new Promise(resolve => { release = resolve; }) });
const first = held.api.send(zpl);
await assert.rejects(held.api.send(zpl), /curso/);
release(); await first;
assert.equal(held.requests.filter(r => r.url.endsWith('write')).length, 1);
let sdkSends = 0;
const sdkDevice = { ...device, uid: 'configured-not-default', send(data, ok) { sdkSends++; assert.equal(data, zpl); ok(''); } };
const sdk = setup(source, { sdk: { getDefaultDevice(type, ok) { assert.equal(type, 'printer'); ok(sdkDevice); } } });
await sdk.api.getDefaultPrinter();
sdk.window.BrowserPrint.getDefaultDevice = () => { throw new Error('Do not silently change selected printer'); };
await sdk.api.send(zpl);
assert.equal(sdkSends, 1); assert.equal(sdk.requests.length, 0);
const late = setup();
late.window.BrowserPrint = { getDefaultDevice(type, ok) { ok(sdkDevice); } };
await late.api.send(zpl);
assert.equal(late.requests.length, 0);
const badSdk = setup(source, { sdk: { getDefaultDevice(type, ok) { ok({ ...device, send(data, ok, error) { error('Fixture USB failure'); } }); } } });
await assert.rejects(badSdk.api.send(zpl), /Fixture USB failure/);
assert.equal(badSdk.requests.length, 0);
for (const file of ['scripts/modules/operaciones/etiquetas-ramos.js', 'scripts/modules/operaciones/bunch-label-codec.js']) {
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `${base}:erp-james-unico/${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), `Generator and handler unchanged: ${file}`);
}
console.log('PASS: baseline transport mismatch reproduced; endpoint/protocol corrected; native/SDK single send; late SDK; selected device retained; empty/missing/error/timeout/concurrency; ZPL and handler unchanged; no real requests.');
