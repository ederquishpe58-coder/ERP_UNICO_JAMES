import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fixture,document} from './validate-commercial-fiscal-cycle-read.mjs';

const parent='7d85af2c9e09b02b28e310af3b697281e3c6280a';
const oldSource=execFileSync('git',['show',parent+':erp-james-unico/scripts/modules/comercial/sri-authorization.js'],{encoding:'utf8'});
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(previous=false,stage='list'){
  const f=fixture(previous?{sriSource:oldSource}:{}),u=f.B.__trace.ui;
  u.issueYear='2026';u.issueMonth='7';
  f.B.state={currentRoute:()=>({id:'commercial-sri-authorization'})};
  const jobs=[],handlers=new Map(),page={number:1,total:0,items:[]};
  const node=(key,dataset={})=>({dataset,addEventListener:(event,fn)=>handlers.set(key+':'+event,fn)});
  const monthNode=node('month',{sriIssueMonth:'7'});
  const nodes={
    '[data-sri-issue-year]':node('year'), '[data-sri-list-refresh]':node('refresh'),
    '[data-sri-list-status]':node('status'), '[data-sri-list-date-from]':node('dateFrom')
  };
  const container={id:'page-root',isConnected:true,innerHTML:'',
    querySelector:s=>nodes[s]||null,querySelectorAll:s=>s==='[data-sri-issue-month]'?[monthNode]:[]};
  f.B.performance={
    resetPage:()=>{page.number=1;},
    paginate:items=>{page.total=items.length;page.items=items.slice((page.number-1)*2,page.number*2);return {items:page.items,total:items.length};}
  };
  let current;
  f.B.sriApi.list=async input=>{
    if(input.documentType==='04')return [];
    const d=deferred(),job={...d,from:input.from,to:input.to,number:jobs.length+1};
    jobs.push(job);current=job;
    return stage==='list'?d.promise:docs(job);
  };
  f.B.sriApi.configuration=()=>stage==='configuration'?current.promise:Promise.resolve({settings:{company_id:f.B.sriApi.activeCompany().companyId,environment:'PRODUCTION'}});
  const realPending=f.B.commercialFiscalReservationRead.pending;
  f.B.commercialFiscalReservationRead.pending=async options=>{
    if(stage==='reservation')await current.promise;
    return realPending(options);
  };
  function docs(job){
    return [1,2,3].map(n=>({...document(job.number*10+n),issue_date:job.from,buyer_snapshot:{legalName:'Buyer'},
      additional_information:{MARCACION:'FINAL-'+job.number+'-'+n}}));
  }
  const resolve=job=>job.resolve(stage==='configuration'?{settings:{company_id:f.B.sriApi.activeCompany().companyId,environment:'PRODUCTION'}}:stage==='reservation'?[]:docs(job));
  const mount=()=>{container.innerHTML=f.B.comercialSriAuthorization.render(f.appState);f.B.comercialSriAuthorization.bind(container,f.appState);};
  const month=async value=>{monthNode.dataset.sriIssueMonth=String(value);handlers.get('month:click')();await flush();};
  const refresh=async()=>{handlers.get('refresh:click')();await flush();};
  const ready=job=>{
    assert.equal(u.loading,false);assert.equal(u.error,'');
    assert.deepEqual(Array.from(u.remoteDocuments,d=>d.id),docs(job).map(d=>d.id));
    assert.equal(page.total,3);assert.ok(page.items.every(d=>d.brand.startsWith('FINAL-'+job.number+'-')));
    assert.doesNotMatch(container.innerHTML.match(/<button[^>]*data-sri-list-refresh[^>]*>/)?.[0]||'',/disabled/);
    assert.equal(f.writes.length,0);
  };
  return {f,u,jobs,page,handlers,container,mount,month,refresh,resolve,ready};
}
const results=[];
async function test(name,fn){await fn();results.push({name,result:'PASS'});}

await test('Entry without month does not start any read',async()=>{
  const h=harness();h.u.issueMonth='';h.mount();await flush();
  assert.equal(h.jobs.length,0);assert.equal(h.u.loading,false);assert.equal(h.f.writes.length,0);
});
await test('Negative control: parent sticks loading after month switch',async()=>{
  const h=harness(true);h.mount();await flush();const a=h.jobs[0];await h.month(8);
  assert.equal(h.jobs.length,1);h.resolve(a);await flush();assert.equal(h.u.loading,true);assert.equal(h.u.loaded,false);
});
for(const stage of ['list','configuration','reservation'])for(const first of ['A','B']){
  await test('July to August '+stage+' '+first+' first',async()=>{
    const h=harness(false,stage);h.mount();await flush();const a=h.jobs[0];await h.month(8);const b=h.jobs[1];
    assert.ok(b);assert.equal(b.from,'2026-08-01');assert.equal(h.u.loading,true);
    h.resolve(first==='A'?a:b);await flush();
    if(first==='A'){assert.equal(h.u.loading,true);assert.equal(h.u.remoteDocuments.length,0);}else h.ready(b);
    h.resolve(first==='A'?b:a);await flush();h.ready(b);assert.equal(h.u.issueMonth,'8');
  });
}
await test('Stale error after latest success is ignored',async()=>{
  const h=harness();h.mount();await flush();const a=h.jobs[0];await h.month(8);const b=h.jobs[1];
  h.resolve(b);await flush();a.reject(Error('OLD_ERROR'));await flush();h.ready(b);assert.doesNotMatch(h.container.innerHTML,/OLD_ERROR/);
});
await test('Current error releases loading, stays visible, explicit retry succeeds',async()=>{
  const h=harness();h.mount();await flush();h.jobs[0].reject(Error('CURRENT_READ_ERROR'));await flush();
  assert.equal(h.u.loading,false);assert.equal(h.u.loaded,false);assert.match(h.u.error,/CURRENT_READ_ERROR/);
  assert.match(h.container.innerHTML,/CURRENT_READ_ERROR/);assert.equal(h.jobs.length,1);
  assert.doesNotMatch(h.container.innerHTML.match(/<button[^>]*data-sri-list-refresh[^>]*>/)[0],/disabled/);
  await h.refresh();assert.equal(h.jobs.length,2);h.resolve(h.jobs[1]);await flush();h.ready(h.jobs[1]);
});
await test('Same-period overlapping refresh: new read owns rows and loading',async()=>{
  const h=harness();h.mount();await flush();const a=h.jobs[0];await h.refresh();const b=h.jobs[1];
  assert.equal(a.from,b.from);h.resolve(b);await flush();h.ready(b);h.resolve(a);await flush();h.ready(b);
});
await test('January February March out of order',async()=>{
  const h=harness();h.u.issueMonth='1';h.mount();await flush();await h.month(2);await h.month(3);
  h.resolve(h.jobs[1]);await flush();assert.equal(h.u.loading,true);
  h.resolve(h.jobs[2]);await flush();h.ready(h.jobs[2]);h.resolve(h.jobs[0]);await flush();h.ready(h.jobs[2]);
});
await test('Local filters and paging use latest rows without new requests',async()=>{
  const h=harness();h.mount();await flush();await h.month(8);const b=h.jobs[1];
  h.handlers.get('status:change')({target:{value:'AUTORIZADO'}});assert.equal(h.jobs.length,2);
  h.resolve(b);await flush();h.ready(b);h.page.number=2;h.mount();assert.equal(h.page.total,3);assert.equal(h.page.items.length,1);
  h.resolve(h.jobs[0]);await flush();assert.equal(h.page.number,2);assert.equal(h.jobs.length,2);assert.equal(h.page.items[0].brand,'FINAL-2-3');
});
await test('Ten consecutive periods: reverse completion never sticks loading',async()=>{
  const h=harness();h.u.issueMonth='1';h.mount();await flush();for(let month=2;month<=10;month++)await h.month(month);
  assert.equal(h.jobs.length,10);for(const job of [...h.jobs].reverse()){h.resolve(job);await flush();h.ready(h.jobs[9]);}
});
await test('Year reset invalidates pending read, then new year/month loads',async()=>{
  const h=harness();h.mount();await flush();const a=h.jobs[0];
  h.handlers.get('year:change')({currentTarget:{value:'2027'}});await flush();assert.equal(h.u.loading,false);assert.equal(h.u.issueMonth,'');
  h.resolve(a);await flush();assert.equal(h.u.remoteDocuments.length,0);
  await h.month(1);assert.equal(h.jobs[1].from,'2027-01-01');h.resolve(h.jobs[1]);await flush();h.ready(h.jobs[1]);
});
await test('Company switch and unavailable/empty-period refresh supersede old reads',async()=>{
  for(const mode of ['company','offline','empty']){
    const h=harness();h.mount();await flush();const a=h.jobs[0];
    if(mode==='company'){h.f.switchCompany();h.u.companyKey='IMPERIO_FLOWERS';h.f.B.comercialSriAuthorization.resetDocumentsEntry();}
    if(mode==='offline'){h.f.B.sriApi.status=()=>({ready:false});await h.refresh();}
    if(mode==='empty'){h.u.issueMonth='';await h.refresh();}
    const before=JSON.stringify({rows:h.u.remoteDocuments,error:h.u.error,loading:h.u.loading});
    h.resolve(a);await flush();assert.equal(JSON.stringify({rows:h.u.remoteDocuments,error:h.u.error,loading:h.u.loading}),before);assert.equal(h.u.loading,false);
  }
});
console.log(JSON.stringify({result:'PASS',groups:results.length,results,scope:'Actual render/bind/refresh, controlled read transports, no real browser session or external requests',businessWrites:0},null,2));
