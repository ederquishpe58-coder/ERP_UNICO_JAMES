const assert = require('node:assert/strict');
const { fixture } = require('./validate-sri-manual-authorization-recovery.cjs');
const { endpointFor } = require('./api/sri/_lib/environment.cjs');

(async () => {
  const b = fixture('TEST', '07');
  b.tables.accounting_document_links[0].status = 'PENDING';
  const linksBefore = JSON.stringify(b.tables.accounting_document_links);
  let lookupCalls = 0;

  await b.service.processAuthorization(b.client, b.tables.sri_settings[0], b.document, 'actor', {
    managerRecovery: true,
    recoveryQuery: true,
    skipAccounting: true,
    fetchImpl: async url => {
      lookupCalls += 1;
      assert.equal(url, endpointFor('TEST', 'AUTHORIZATION_QUERY'));
      return { ok: true, status: 200, text: async () => b.authResponse() };
    }
  });

  assert.equal(lookupCalls, 1);
  assert.equal(b.document.status, 'AUTORIZADO');
  assert.equal(JSON.stringify(b.tables.accounting_document_links), linksBefore);
  assert.equal(b.calls.filter(call => call.rpc === 'generate_sri_accounting_entry').length, 0);
  assert.equal(b.calls.filter(call => call.table === 'accounting_document_links' && call.operation !== 'select').length, 0);
  console.log(JSON.stringify({
    result: 'PASS',
    authorizedSameDocument: true,
    accountingDelta: 0,
    accountingGenerationCalls: 0,
    realSriRequests: 0
  }, null, 2));
})().catch(error => {
  console.error(JSON.stringify({ result: 'FAIL', error: error.stack }, null, 2));
  process.exitCode = 1;
});
