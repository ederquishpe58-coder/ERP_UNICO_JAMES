(function(){
  const erp=window.BlessERP=window.BlessERP||{};
  const repo=()=>erp.getPayrollV2Repository?.();
  let state={context:null,status:'EMPTY',rows:[],error:'',checkedAt:0},request=0,pending=null,timer=0;
  const visible=()=>/^operations-(yields|yield|performance)/.test(String(erp.state?.state?.currentRoute||erp.state?.state?.route||''));
  const current=context=>repo()?.isContextCurrent?.(context)===true;
  function align(){
    const context=repo()?.context?.();
    if(state.context!==context){request++;pending=null;state={context,status:'EMPTY',rows:[],error:'',checkedAt:0};}
    return context;
  }
  function validate(data,context){
    if(data?.ok!==true||data.contract!=='OPERATIONS_PERFORMANCE_V2'||data.companyId!==context.companyId
      ||!Array.isArray(data.rows)||!data.serverTime)throw Error('OPERATIONS_PERFORMANCE_CANONICAL_READ_REQUIRED');
    const ids=new Set();
    for(const r of data.rows){
      const key=r.source_entity+':'+r.source_record_id;
      if(r.company_id!==context.companyId||!['CLASSIFIER','BUNCHER'].includes(r.operational_role)
        ||!r.operational_worker_id||!r.source_record_id||!r.operation_id||!r.workday_id||!r.source_fingerprint
        ||!/^\d{4}-\d{2}-\d{2}$/.test(r.event_date||'')||!Number.isFinite(Date.parse(r.event_at))
        ||!/^\d+(\.\d{1,6})?$/.test(String(r.quantity))||Number(r.quantity)<=0||ids.has(key)
        ||r.unit!==(r.operational_role==='CLASSIFIER'?'MESHES':'BUNCHES')
        ||r.source_entity!==(r.operational_role==='CLASSIFIER'?'operations_mesh_records':'operations_bunch_entries')
        ||(r.operational_role==='BUNCHER'&&Number(r.quantity)!==1))throw Error('OPERATIONS_PERFORMANCE_ROW_INVALID');
      ids.add(key);
    }
    return data.rows.map(r=>Object.freeze({...r}));
  }
  async function refresh(force=false){
    const context=align();
    if(!current(context))return {ok:false,message:'No existe una sesión canónica de empresa.'};
    if(pending&&!force)return pending;
    const id=++request;state={...state,status:'LOADING',rows:[],error:''};
    const run=Promise.resolve().then(async()=>{
      try{
        const client=erp.getSupabaseClient?.();if(!client?.rpc)throw Error('CLIENT_UNAVAILABLE');
        const response=await client.rpc('erp_operations_performance_v2_get',{p_company_id:context.companyId});
        if(!current(context)||id!==request)return {ok:false,stale:true};
        if(response.error)throw response.error;
        const rows=validate(response.data,context);
        state={context,status:'READY',rows,error:'',checkedAt:Date.now()};return {ok:true,rows};
      }catch(error){
        if(!current(context)||id!==request)return {ok:false,stale:true};
        state={context,status:'ERROR',rows:[],error:'No se pudo consultar el rendimiento confirmado. Reintente la consulta.',checkedAt:Date.now()};
        return {ok:false,message:state.error};
      }finally{
        if(id===request){pending=null;if(visible())erp.layout?.renderPage?.();}
      }
    });pending=run;return run;
  }
  function ensure(){
    align();
    if(state.status==='EMPTY')queueMicrotask(()=>refresh());
    if(!timer)timer=window.setInterval(()=>{if(visible()&&state.status!=='LOADING')void refresh();},15000);
  }
  function snapshot(){align();return {status:state.status,rows:state.status==='READY'?state.rows:[],error:state.error};}
  function rows(role,workdayId=''){
    ensure();return snapshot().rows.filter(r=>r.operational_role===role&&(!workdayId||r.workday_id===workdayId));
  }
  function notice(){
    ensure();const s=snapshot();
    return s.status==='READY'?'':s.status==='ERROR'?s.error:'Consultando rendimiento confirmado…';
  }
  window.addEventListener('erp:company-changed',()=>{request++;pending=null;state={context:null,status:'EMPTY',rows:[],error:'',checkedAt:0};});
  erp.operationsPerformanceV2=Object.freeze({refresh,snapshot,rows,notice,validate});
})();
