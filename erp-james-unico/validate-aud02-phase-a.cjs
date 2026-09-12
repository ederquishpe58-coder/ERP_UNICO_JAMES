const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
global.fetch = async () => { throw Error('REAL_NETWORK_FORBIDDEN'); };
const { fixture } = require('./validate-sri-manual-authorization-recovery.cjs');
const BASE = 'dd38a445f3ad20be85088fd4949c10ff0cb9c6f7';
const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const baseSource = name => execFileSync('git', ['show', `${BASE}:erp-james-unico/${name}`], {encoding:'utf8'});
const checks = [];
async function test(name, run) { await run(); checks.push({name, result:'PASS'}); }

function oldFixture(type) {
  const filename = path.join(__dirname, 'validate-sri-safe-retry.cjs');
  const module = {exports:{}};
  const actualRequire = createRequire(filename);
  vm.runInNewContext(source('validate-sri-safe-retry.cjs'), {
    module, exports:module.exports, __dirname, Buffer, Date, console, structuredClone,
    require(name) {
      if (name === 'node:fs') return {...fs, readFileSync(file, ...args) {
        return String(file).endsWith('transmission-service.cjs') ? baseSource('api/sri/_lib/transmission-service.cjs') : fs.readFileSync(file,...args);
      }};
      return actualRequire(name);
    }
  }, {filename});
  const wrapper = { exports: {} };
  vm.runInNewContext(source('validate-sri-manual-authorization-recovery.cjs'), {
    module: wrapper, exports: wrapper.exports, __dirname, Buffer, Date, console, structuredClone,
    global: {fetch:async()=>{throw Error('REAL_NETWORK_FORBIDDEN');}},
    require: name => name === './validate-sri-safe-retry.cjs' ? module.exports : actualRequire(name)
  });
  return wrapper.exports.fixture('TEST',type,true);
}
async function authorize(b) {
  const baseRpc = b.client.rpc.bind(b.client);
  b.client.rpc = async (name,args) => {
    if (name === 'generate_sri_accounting_entry') {
      b.calls.push({rpc:name,args});
      return {error:{code:'23514',message:'SRI_ACCOUNTING_RULE_NOT_FOUND'}};
    }
    return baseRpc(name,args);
  };
  b.tables.accounting_document_links[0].status='PENDING';
  b.tables.accounting_document_links[0].journal_entry_id=null;
  const identity = [b.document.id,b.document.access_key,b.document.issue_date,b.document.full_number,b.signedArtifact.xml];
  await b.service.processAuthorization(b.client,b.tables.sri_settings[0],b.document,'actor',{
    managerRecovery:true,recoveryQuery:true,
    fetchImpl:async () => ({ok:true,status:200,text:async()=>b.authResponse()})
  });
  assert.equal(b.document.status,'AUTORIZADO');
  assert.deepEqual([b.document.id,b.document.access_key,b.document.issue_date,b.document.full_number,b.signedArtifact.xml],identity);
  return b.calls.filter(c=>c.rpc==='generate_sri_accounting_entry').length;
}
function fiscalSync(code) {
  const order={id:'order',sriAuthorizationStatus:'PENDIENTE',saleAccountingStatus:'CONTABILIZADO',saleJournalEntryId:'prior-journal',sriCreditNotes:[{id:'nc',remoteDocumentId:'nc',status:'BORRADOR',accountingStatus:'CONTABILIZADO',journalEntryId:'prior-nc-journal'}]};
  let accountingCalls=0;
  const functions=['syncSriDocument','syncSriCreditNote'].map(name=>{
    const start=code.indexOf(`  function ${name}(`);
    let end=code.indexOf('\n  function ',start+10);
    const asyncEnd=code.indexOf('\n  async function ',start+10);
    if(asyncEnd>=0&&(end<0||asyncEnd<end)) end=asyncEnd;
    return code.slice(start,end);
  }).join('\n');
  const context={order, BlessERP:{services:{receivables:{syncAuthorizedSale(){accountingCalls++;return {ok:true,accountingPending:true};},applyAuthorizedCreditNote(){accountingCalls++;return {ok:true};}}}},
    findOrder:()=>order,invoiceSequence:{synchronize:()=>({})},workflow:{recordEvent(){}},saveDb(){}};
  vm.runInNewContext(`${functions}\nthis.syncInvoice=syncSriDocument;this.syncNC=syncSriCreditNote;`,context);
  return {...context,accountingCalls:()=>accountingCalls};
}

(async()=>{
  for(const type of ['01','04']) await test(`Base: ${type} reproduced auto-post 23514 after fiscal authorization`,async()=>{
    const b=oldFixture(type); assert.equal(await authorize(b),1);
    assert.equal(b.tables.accounting_document_links[0].status,'FAILED');
  });
  for(const environment of ['TEST','PRODUCTION']) for(const type of ['01','04']) await test(`Candidate: ${environment}/${type} authorization/recovery, identity preserved, no auto-post`,async()=>{
    const b=fixture(environment,type,true); assert.equal(await authorize(b),0);
    assert.equal(b.tables.accounting_document_links[0].status,'PENDING');
    await assert.rejects(b.service.queryDocumentStatus(b.client,b.document.company_id,b.document.id,'actor',{
      fetchImpl:async()=>{throw Error('AUTHORIZED_MUST_NOT_QUERY');}
    }), /autorizado/);
    assert.equal(b.calls.filter(c=>c.rpc==='generate_sri_accounting_entry').length,0);
  });
  await test('07 normal accounting path retained',async()=>assert.equal(await authorize(fixture('TEST','07')),1));
  await test('Frontend fiscal sync: no CxC/NC effects; prior accounting preserved',()=>{
    const old=fiscalSync(baseSource('scripts/modules/comercial/comercial-state.js'));
    const current=fiscalSync(source('scripts/modules/comercial/comercial-state.js'));
    for(const b of [old,current]) {
      b.syncInvoice({},'order',{id:'invoice',document_type:'01',status:'AUTORIZADO'});
      b.syncNC({},'order',{id:'nc',document_type:'04',status:'AUTORIZADO'});
    }
    assert.equal(old.accountingCalls(),2);assert.equal(current.accountingCalls(),0);
    assert.equal(current.order.saleAccountingStatus,'CONTABILIZADO');assert.equal(current.order.saleJournalEntryId,'prior-journal');
    assert.equal(current.order.sriCreditNotes[0].journalEntryId,'prior-nc-journal');
  });
  console.log(JSON.stringify({result:'PASS',checks,realSriRequests:0},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
