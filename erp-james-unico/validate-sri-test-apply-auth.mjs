import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('./',import.meta.url)),req=createRequire(app+'api/sri.js');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';let validAuth=true,capability=true,allowedCompany=B,phaseCalls=0;
const admin={auth:{getUser:async()=>({data:{user:validAuth?{id:'TEST-ACTOR',role:'OWNER'}:null},error:null})},storage:{getBucket:async()=>({data:{public:false}}),from:()=>({})},from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:B,tax_id:'1717637084001',is_active:true}})};},rpc:async()=>{phaseCalls++;return{data:{status:'READY',test_enabled:false,production_enabled:false}};}};
const authPath=req.resolve('./sri/_lib/supabase-admin.cjs');req.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{getSupabaseAdmin:()=>admin,getSupabaseUserContext:()=>({rpc:async(_n,a)=>({error:capability&&a.p_company_id===allowedCompany?null:{code:'42501'}})})}};
const {handleTestApply}=req('./sri/_lib/test-apply.cjs'),{HASH}=req('./sri/_lib/test-apply-plan.cjs');
const checks=[];
async function run(body,token='SYNTHETIC-JWT'){let payload;const res={setHeader(){},end(b){payload=JSON.parse(b);}};await handleTestApply({method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:structuredClone(body)},res);return{status:res.statusCode,body:payload};}
const review={action:'review-sri-test-configuration',company_id:B},apply={action:'apply-sri-test-configuration',company_id:B,approved_plan_hash:HASH,explicit_confirmation:'ACTIVAR TEST',certificate_file:Buffer.from('synthetic').toString('base64')};
async function test(n,f){await f();checks.push(n);}
await test('No ERP JWT returns 401',async()=>assert.equal((await run(review,'')).status,401));
await test('Expired ERP JWT returns 401',async()=>{validAuth=false;assert.equal((await run(review)).status,401);validAuth=true;});
await test('OWNER without capability returns 403',async()=>{capability=false;assert.equal((await run(review)).status,403);capability=true;});
await test('Other company capability denied',async()=>assert.equal((await run({...review,company_id:I})).status,403));
await test('Unknown company returns 403',async()=>assert.equal((await run({...review,company_id:'00000000-0000-0000-0000-000000000000'})).status,403));
await test('Read plan with session returns exact hash and no enabled environment',async()=>{const r=await run(review);assert.equal(r.status,200);assert.equal(r.body.data.approved_plan_hash,HASH);assert.equal(r.body.data.test_enabled,false);});
await test('Stale hash rejected before phase call',async()=>{const n=phaseCalls,r=await run({...apply,approved_plan_hash:'0'.repeat(64)});assert.equal(r.body.error.code,'PLAN_DRIFT');assert.equal(phaseCalls,n);});
for(const k of ['production_enabled','environment','ruc','emission_point','next_value','password','secret_name','storage_path','operation_id','actor_id'])await test('Reject client field '+k,async()=>assert.equal((await run({...apply,[k]:'FORBIDDEN'})).body.error.code,'INVALID_INPUT'));
await test('Exact confirmation required',async()=>assert.equal((await run({...apply,explicit_confirmation:'SI'})).body.error.code,'ACTIVAR_TEST_REQUIRED'));
await test('Altered deployed JSON rejected',async()=>{const original=fs.readFileSync;fs.readFileSync=function(p,...a){const b=original(p,...a);return String(p).endsWith('reviewable-apply-plan-current.json')?Buffer.from(String(b)+' '):b;};try{assert.equal((await run(review)).body.error.code,'PLAN_DRIFT');}finally{fs.readFileSync=original;}});
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({result:'PASS',checks,productionWrites:0},null,2)+'\n');console.log(JSON.stringify({result:'PASS',checks:checks.length}));
