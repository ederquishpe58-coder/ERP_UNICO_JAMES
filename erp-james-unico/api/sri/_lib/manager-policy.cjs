const { recoveryPolicy } = require('./recovery-policy.cjs');
const CAPS = Object.freeze({ view:'commercial.electronic_documents.view', validate:'commercial.electronic_documents.validate', recover:'commercial.electronic_documents.authorize', retry:'commercial.electronic_documents.authorize', pause:'commercial.electronic_documents.authorize', resume:'commercial.electronic_documents.authorize', correct:'commercial.electronic_documents.correct', evidence:'commercial.electronic_documents.reconcile', cancellation:'commercial.electronic_documents.annul' });
const DRAFT = new Set(['BORRADOR','VALIDADO','XML_GENERADO','FIRMADO']);
const RECOVERABLE = new Set(['ENVIADO_SRI','RECIBIDO_SRI','PENDIENTE_REINTENTO','ERROR_ENVIO','DEVUELTO','NO_AUTORIZADO']);
function managerPolicy(detail, capabilities=[], now=Date.now()) {
 const d=detail.document||{}, jobs=detail.transmissions||[], attempts=detail.transmissionAttempts||[], policy=recoveryPolicy(detail);
 const management=detail.management||{}, allowed=new Set(capabilities), active=jobs.find(j=>j.status==='PROCESSING');
 const claimExpired=Boolean(active&&String(active.worker_id||'').startsWith('manual-auth-')&&Date.parse(active.claimed_at)+180000<=now);
 const waitUntil=jobs.filter(j=>j.transmission_type==='AUTHORIZATION_QUERY').map(j=>Math.max(Date.parse(j.next_attempt_at)||0,Date.parse(j.finished_at)?Date.parse(j.finished_at)+30000:0)).reduce((a,b)=>Math.max(a,b),0);
 const waiting=waitUntil>now, busy=Boolean((active&&!claimExpired)||management.correction_in_progress);
 const immutable=['AUTORIZADO','ANULADO'].includes(d.status);
 const draft=DRAFT.has(d.status)&&!jobs.length&&!attempts.length&&!(detail.responses||[]).length&&!(detail.authorizations||[]).length;
 const recoverable=RECOVERABLE.has(d.status)&&(!['DEVUELTO','NO_AUTORIZADO'].includes(d.status)||policy.action==='QUERY_AUTHORIZATION');
 const exhausted=jobs.some(j=>j.attempt_number>=j.max_attempts);
 const actions={};
 function action(name,eligible,reason=''){actions[name]={allowed:allowed.has(CAPS[name])&&eligible,reason:!allowed.has(CAPS[name])?'Requiere permiso: '+CAPS[name]:reason};}
 action('validate',true);action('recover',recoverable&&!busy&&!waiting,busy?'Otro proceso está trabajando este comprobante.':waiting?'Espere hasta la próxima consulta programada.':!recoverable?'El estado fiscal no permite recuperación.':'');
 action('retry',!busy&&!waiting&&!management.automatic_paused&&policy.canTransmit===true,policy.reason);
 action('pause',!immutable&&!busy,immutable?'El documento ya tiene estado final.':busy?'Espere a que termine el proceso activo.':'');
 action('resume',management.automatic_paused===true&&!immutable&&!busy);
 action('correct',draft&&!busy,'Solo se corrigen campos fuente permitidos antes de cualquier transmisión.');
 action('evidence',recoverable&&!busy&&!waiting,'La evidencia se verificará con la misma clave mediante consulta oficial.');
 return {actions,automaticBudgetExhausted:exhausted,automaticPaused:management.automatic_paused===true,claimExpired,activeClaim:busy,waitUntil:waiting?new Date(waitUntil).toISOString():null,
  transmissionState:policy.transportResultState||jobs[0]?.status||'SIN_ENVIO',retryState:management.automatic_paused?'MANUAL_REVIEW_REQUIRED':waiting?'WAIT_SCHEDULED':exhausted?'RETRY_BUDGET_EXHAUSTED':'DISPONIBLE',
  recoveryState:immutable?d.status:recoverable?'AUTHORIZATION_LOOKUP_FIRST':policy.action,reason:policy.reason,
  message:policy.transportResultState==='TRANSPORT_RESULT_UNCERTAIN'?'El resultado del envío anterior es incierto. Primero se consultará el SRI antes de reenviar.':policy.reason};
}
module.exports={CAPS,DRAFT,RECOVERABLE,managerPolicy};
