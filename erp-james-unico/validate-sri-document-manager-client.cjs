const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function main(){
 const companies=[
  {id:'11111111-1111-4111-8111-111111111111',company_key:'COMP-BLESS-FLOWER',tax_id:'1717637084001'},
  {id:'22222222-2222-4222-8222-222222222222',company_key:'COMP-IMPERIO-FLOWERS',tax_id:'1727970137001'}
 ];
 let active=companies[1].id,rows=companies,calls=[],pending=null,checks=0;
 const window={sessionStorage:{getItem:()=>null},BlessERP:{
  services:{companyContext:{activeCompanyId:()=>active}},
  authAccess:{activeAccess:()=>({companies:rows})},
  getEnvConfig:()=>({supabaseEnabled:true,authEnabled:true}),
  getSupabaseStatus:()=>({configured:true,hasRuntimeFactory:true}),
  getSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'SYNTHETIC-ONLY'}}})},
   from:()=>{throw Error('Legacy company membership/config discovery is forbidden for manager.');}})
 }};
 const response={ok:true,headers:new Map([['content-type','application/json']]),json:async()=>({ok:true,data:{fixture:true}})};
 const ctx=vm.createContext({window,URL,URLSearchParams,Date,Intl,console,setTimeout,clearTimeout,
  fetch:async(path,options)=>{calls.push({path,options});return pending||response;}});
 vm.runInContext(fs.readFileSync('scripts/services/sri/sri-api-client.js','utf8'),ctx);
 const api=window.BlessERP.sriApi;
 assert.equal(api.managerCompany().companyId,companies[1].id);checks++;
 await api.managerRequest('manager-list',{environment:'PRODUCTION'});
 assert.equal(new URL(calls[0].path,'https://fixture.invalid').searchParams.get('companyId'),companies[1].id);checks++;
 assert.equal(api.activeCompany().bound,false);checks++;
 await api.managerRequest('manager-pause',{documentId:'fixture',action:'save-settings'},'POST');
 const body=JSON.parse(calls[1].options.body);assert.equal(body.action,'manager-pause');assert.equal(body.companyId,companies[1].id);checks++;
 await assert.rejects(api.managerRequest('manager-list',{companyId:companies[0].id}),/otra empresa/);checks++;
 active='33333333-3333-4333-8333-333333333333';
 assert.throws(()=>api.managerCompany(),/canónica autorizada/);checks++;
 await assert.rejects(api.managerRequest('manager-list'),/canónica autorizada/);checks++;
 active=companies[0].company_key;assert.equal(api.managerCompany().companyId,companies[0].id);checks++;
 rows=[{...companies[0],tax_id:companies[1].tax_id}];assert.throws(()=>api.managerCompany(),/no coincide/);checks++;
 rows=[companies[0],companies[0]];assert.throws(()=>api.managerCompany(),/canónica autorizada/);checks++;
 rows=companies;let release;pending=new Promise(r=>{release=r;});
 const request=api.managerRequest('manager-detail',{documentId:'fixture'});
 await new Promise(r=>setImmediate(r));active=companies[1].id;release(response);
 await assert.rejects(request,/empresa cambió/);checks++;
 assert.equal(calls.length,3);assert.ok(calls.every(c=>JSON.parse(c.options?.body||'{}').action?.startsWith('manager-')||c.path.includes('action=manager-')));checks++;
 console.log(JSON.stringify({result:'PASS',checks,unknownCompanyFallback:'BLOCKED',legacyDiscoveryCalls:0,companySwitch:'BLOCKED',realNetworkCalls:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
