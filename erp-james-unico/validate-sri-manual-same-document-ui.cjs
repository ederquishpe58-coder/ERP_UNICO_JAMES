// Isolated browser fixture; never opens ERP PROD or any authenticated session.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.SRI_MANAGER_PLAYWRIGHT||'playwright');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 try{
  await page.setContent('<html lang="es"><body><main id="fixture"></main></body></html>');
  await page.addStyleTag({content:fs.readFileSync('styles.css','utf8')});
  await page.addStyleTag({content:fs.readFileSync('styles/sri-manager.css','utf8')});
  await page.evaluate(()=>{
   if(!crypto.randomUUID)crypto.randomUUID=()=> '11111111-1111-4111-8111-111111111111';window.calls=[];window.retryEligible=false;window.retryCompleted=false;window.selectedCompany='BLESS_FLOWER';window.waiting=false;
   const d=id=>({document:{id,company_id:selectedCompany,environment:'PRODUCTION',document_type:'07',full_number:'001-002-'+id,issue_date:'2026-09-08',access_key:'1'.repeat(49),status:'PENDIENTE_REINTENTO',buyer_snapshot:{legalName:'PROVEEDOR FIXTURE'},last_error:'El comprobante todavía no aparece en autorización del SRI.'},responses:[{sri_status:'NO_ENCONTRADO'}],transmissionAttempts:Array.from({length:29},()=>({finished_at:'2026-09-08T15:16:36Z'})),management:{version:0,revision:1},technicalHistory:[{timestamp:'2026-09-08T15:16:36Z',action:'AUTHORIZATION_LOOKUP_ATTEMPT',result:'FAILED',classification:'TIMEOUT',reason:'Consulta anterior sin respuesta'}],managerEvents:[],files:[],source:{purchaseId:'FIXTURE-PURCHASE'},managerPolicy:{manualSameDocumentRetry:{allowed:retryEligible&&!retryCompleted,humanReason:'Evidencia canónica de recepción',evidence:{identity:{documentId:id,fullNumber:'001-002-'+id,sequential:id,accessKey:'1'.repeat(49),issueDate:'2026-09-08',signedXmlHash:'a'.repeat(64)}}},automaticBudgetExhausted:true,waitUntil:waiting?new Date(Date.now()+1000).toISOString():null,transmissionState:'TRANSPORT_RESULT_UNCERTAIN',retryState:'RETRY_BUDGET_EXHAUSTED',recoveryState:'AUTHORIZATION_LOOKUP_FIRST',message:'El resultado del envío anterior es incierto. Primero se consultará el SRI antes de reenviar.',actions:Object.fromEntries(['validate','recover','retry','pause','resume','correct','evidence'].map(k=>[k,{allowed:k==='retry'?retryEligible&&!retryCompleted:!['correct','resume'].includes(k)&&!(k==='recover'&&waiting),reason:k==='retry'?'Consulta de autorización requerida':''}]))}});
   const api={managerCompany:()=>({companyId:selectedCompany,commercialName:selectedCompany==='BLESS_FLOWER'?'BLESS FLOWER':'IMPERIO'}),activeCompany:()=>({commercialName:selectedCompany==='BLESS_FLOWER'?'BLESS FLOWER':'IMPERIO'}),activeCompanyKey:()=>selectedCompany,companyKeyForReference:r=>r,selectCompany:c=>{selectedCompany=c;},
    managerRequest:async(action,data,method)=>{calls.push({action,data,method,company:selectedCompany});
     if(action==='manager-list')return {rows:['000000750','000000755'].map(x=>d(x).document),total:2};
     if(action==='manager-retry'){await new Promise(r=>setTimeout(r,100));retryCompleted=true;return d(data.documentId);}
     if(action==='manager-detail')return d(data.documentId);
     if(action==='manager-validate')return {validation:'PASS',checks:[{name:'XSD oficial',result:'PASS'}],errors:[],warnings:[]};
     throw Error('Unexpected fixture action '+action);
    }};
   window.BlessERP={sriApi:api,state:{state:{currentRoute:'sri-document-manager',db:{activeCompanyId:'BLESS_FLOWER'}}},services:{companyContext:{activeCompanyId:()=>selectedCompany}}};
  });
  await page.addScriptTag({content:fs.readFileSync('scripts/modules/sri/document-manager.js','utf8')});
  const render=()=>page.evaluate(()=>BlessERP.modules.sriDocumentManager.render(document.getElementById('fixture'),{id:'sri-document-manager'},BlessERP.state.state));
  await render();await page.getByRole('button',{name:'Ver / gestionar'}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Ver / gestionar'}).count(),2);
  await page.getByRole('button',{name:'Ver / gestionar'}).first().click();
  await page.getByRole('heading',{name:'001-002-000000750',exact:true}).waitFor();
  assert.match(await page.locator('#fixture').innerText(),/29/);
  await page.getByRole('button',{name:'Recuperación / gestión',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Consultar / recuperar SRI',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Reintentar envío',exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:'Corregir comprobante',exact:true}).isEnabled(),false);
  await page.screenshot({path:'.release/same-document-retry/retry-blocked.png',fullPage:true});
  await page.getByRole('button',{name:'Validación',exact:true}).click();await page.getByRole('button',{name:'Validar comprobante',exact:true}).click();await page.getByRole('heading',{name:'PASS',exact:true}).waitFor();
  await page.getByRole('button',{name:'Historial técnico',exact:true}).click();assert.match(await page.locator('#fixture').innerText(),/TIMEOUT/);
  await page.getByRole('button',{name:'XML / versiones',exact:true}).click();assert.equal(await page.locator('[data-xml-view]').getAttribute('contenteditable'),null);
  await page.evaluate(()=>retryEligible=true);
  await page.getByRole('button',{name:'Ver / gestionar'}).first().click();
  await page.getByRole('button',{name:'Recuperación / gestión',exact:true}).click();
  await page.getByRole('button',{name:'Reintentar envío',exact:true}).click();
  await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/NO CAMBIA/);
  assert.match(await page.getByRole('dialog').innerText(),/UN NUEVO INTENTO DE TRANSMISIÓN/);
  await page.getByRole('button',{name:'CANCELAR',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='manager-retry').length),0);
  await page.getByRole('button',{name:'Reintentar envío',exact:true}).click();
  await page.screenshot({path:'.release/same-document-retry/retry-confirmation.png',fullPage:true});
  await page.getByRole('button',{name:'CONFIRMAR REINTENTO DEL MISMO COMPROBANTE',exact:true}).click();
  await page.waitForFunction(()=>retryCompleted);
  const retry=await page.evaluate(()=>calls.filter(c=>c.action==='manager-retry'));assert.equal(retry.length,1);assert.equal(retry[0].data.confirmSameDocument,true);assert.equal(retry[0].data.identity.sequential,'000000750');assert.match(retry[0].data.operationId,/^[a-f0-9-]{36}$/);
  await page.getByRole('button',{name:'Ver / gestionar'}).nth(1).click();await page.getByRole('heading',{name:'001-002-000000755',exact:true}).waitFor();
  await page.evaluate(()=>{selectedCompany='IMPERIO_FLOWERS';BlessERP.state.state.db.activeCompanyId=selectedCompany;});await render();await page.getByRole('button',{name:'Ver / gestionar'}).first().waitFor();
  assert.equal(await page.getByRole('heading',{name:'001-002-000000755',exact:true}).count(),0);
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.method==='POST'&&!['manager-validate','manager-retry'].includes(c.action)).length,0);assert.ok(calls.some(c=>c.company==='IMPERIO_FLOWERS'&&c.action==='manager-list'));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({result:'PASS',summary:true,validation:true,recovery:true,history:true,xmlReadonly:true,fixture750:true,fixture755:true,companyChange:true,realNetworkCalls:0,realSRI:0}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
