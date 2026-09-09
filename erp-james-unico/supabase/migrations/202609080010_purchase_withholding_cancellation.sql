begin;
-- Retenciones de Compras solamente. No modifica documentos ni contadores existentes.
-- La evidencia del portal es registrada por un usuario autorizado; no es una respuesta SOAP.
create table if not exists public.erp_purchase_withholding_cancellations (
  company_id uuid not null,
  electronic_document_id uuid not null,
  state text not null check (state in ('CANCELLATION_REQUESTED','PENDING_CANCELLATION','ANULLED','DISCARDED')),
  reason text not null check (length(reason) between 3 and 500),
  portal_reference text,
  evidence jsonb,
  evidence_content bytea,
  evidence_sha256 text,
  reversal_journal_entry_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  version bigint not null default 1,
  primary key (company_id,electronic_document_id),
  foreign key (company_id,electronic_document_id) references public.electronic_documents(company_id,id) on delete restrict,
  foreign key (company_id,reversal_journal_entry_id) references public.erp_financial_journal_entries(company_id,journal_entry_id) on delete restrict,
  check ((state in ('ANULLED','DISCARDED')) = (reversal_journal_entry_id is not null)),
  check (state <> 'ANULLED' or (evidence is not null and evidence_content is not null and evidence_sha256 is not null)),
  check (octet_length(evidence_content) <= 2097152)
);
alter table public.erp_purchase_withholding_cancellations enable row level security;
revoke all on public.erp_purchase_withholding_cancellations from public,anon,authenticated;
-- Read and writes only through the scoped RPCs below (including evidence).

alter table public.erp_supplier_purchase_withholding_links
  add column if not exists previous_electronic_document_id uuid;
do $$ begin
  if exists(select 1 from pg_constraint where conrelid='public.erp_supplier_purchase_withholding_links'::regclass
    and conname='erp_supplier_purchase_withholding_links_pkey' and pg_get_constraintdef(oid)='PRIMARY KEY (company_id, purchase_document_id)') then
    alter table public.erp_supplier_purchase_withholding_links drop constraint erp_supplier_purchase_withholding_links_pkey;
    alter table public.erp_supplier_purchase_withholding_links add primary key(company_id,electronic_document_id);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.erp_supplier_purchase_withholding_links'::regclass and conname='withholding_previous_document_fk') then
    alter table public.erp_supplier_purchase_withholding_links add constraint withholding_previous_document_fk
      foreign key(company_id,previous_electronic_document_id) references public.electronic_documents(company_id,id) on delete restrict;
  end if;
end $$;
create unique index if not exists withholding_one_active_per_purchase
  on public.erp_supplier_purchase_withholding_links(company_id,purchase_document_id) where status='ACTIVE';

-- Narrow edits to the deployed canonical implementations. Fail if the expected contract drifted.
do $patch$
declare spec record; definition text; patched text;
begin
 for spec in select * from (values
  ('public.create_electronic_document_draft_u2a_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)',
   E'from public.erp_supplier_purchase_withholding_links\n    where company_id = p_company_id and purchase_document_id = v_purchase_id\n    for update;',
   E'from public.erp_supplier_purchase_withholding_links\n    where company_id = p_company_id and purchase_document_id = v_purchase_id and status = ''ACTIVE''\n    for update;'),
  ('public.erp_purchase_withholding_v2_pending_page_u2c3_internal(uuid,integer,integer)',
   'and existing_link.purchase_document_id = purchase.purchase_document_id',
   'and existing_link.purchase_document_id = purchase.purchase_document_id and existing_link.status = ''ACTIVE'''),
  ('public.erp_purchase_withholding_v2_detail_u2c3_internal(uuid,uuid,uuid)',
   'and link.purchase_document_id = p_purchase_document_id;',
   'and link.purchase_document_id = p_purchase_document_id and link.status = ''ACTIVE'';')
 ) p(signature,old_text,new_text) loop
   definition := pg_get_functiondef(spec.signature::regprocedure);
   if strpos(definition,spec.new_text)>0 then continue; end if;
   if (length(definition)-length(replace(definition,spec.old_text,'')))/length(spec.old_text) <> 1 then
     raise exception 'WITHHOLDING_CANCELLATION_BASE_CONTRACT_DRIFT: %',spec.signature;
   end if;
   patched := replace(definition,spec.old_text,spec.new_text);
   execute patched;
 end loop;
end $patch$;

create or replace function public.erp_purchase_withholding_replacement_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare previous public.erp_supplier_purchase_withholding_links%rowtype; original public.electronic_documents%rowtype; current_doc public.electronic_documents%rowtype;
begin
 if new.status <> 'ACTIVE' then raise exception 'WITHHOLDING_NEW_LINK_REQUIRES_ACTIVE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':PURCHASE_WITHHOLDING:'||new.purchase_document_id::text,0));
 select * into previous from public.erp_supplier_purchase_withholding_links
   where company_id=new.company_id and purchase_document_id=new.purchase_document_id
   order by created_at desc,electronic_document_id desc limit 1;
 if found then
   select * into strict original from public.electronic_documents where company_id=new.company_id and id=previous.electronic_document_id;
   select * into strict current_doc from public.electronic_documents where company_id=new.company_id and id=new.electronic_document_id;
   if previous.status <> 'CANCELLED' or original.status <> 'ANULADO' or original.document_type <> '07'
      or current_doc.document_type <> '07' or current_doc.environment <> original.environment
      or current_doc.access_key=original.access_key
      or (current_doc.establishment_code=original.establishment_code and current_doc.emission_point_code=original.emission_point_code and current_doc.sequential=original.sequential)
      or not exists(select 1 from public.erp_purchase_withholding_cancellations c
        join public.erp_financial_journal_entries r on r.company_id=c.company_id and r.journal_entry_id=c.reversal_journal_entry_id
        where c.company_id=new.company_id and c.electronic_document_id=previous.electronic_document_id
        and c.state in ('DISCARDED','ANULLED') and r.reverse_of_id=previous.journal_entry_id and r.status='POSTED') then
     raise exception 'WITHHOLDING_REPLACEMENT_REQUIRES_COMPLETED_CANCELLATION';
   end if;
   new.previous_electronic_document_id := previous.electronic_document_id;
 elsif new.previous_electronic_document_id is not null then
   raise exception 'WITHHOLDING_PREVIOUS_LINK_NOT_FOUND';
 end if;
 return new;
end $$;
drop trigger if exists withholding_replacement_guard on public.erp_supplier_purchase_withholding_links;
create trigger withholding_replacement_guard before insert on public.erp_supplier_purchase_withholding_links
 for each row execute function public.erp_purchase_withholding_replacement_guard();

create or replace function public.erp_purchase_withholding_cancellation_state(p_company_id uuid,p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype; l public.erp_supplier_purchase_withholding_links%rowtype;
 c public.erp_purchase_withholding_cancellations%rowtype; actions jsonb:='[]'; can_reverse boolean; never_sent boolean;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'purchases.withholdings.view');
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id and document_type='07';
 if not found then raise exception 'WITHHOLDING_DOCUMENT_NOT_FOUND'; end if;
 select * into l from public.erp_supplier_purchase_withholding_links where company_id=p_company_id and electronic_document_id=p_document_id;
 if not found then raise exception 'WITHHOLDING_PURCHASE_LINK_REQUIRED'; end if;
 select * into c from public.erp_purchase_withholding_cancellations where company_id=p_company_id and electronic_document_id=p_document_id;
 can_reverse := public.erp_security_has_capability(p_company_id,'purchases.withholdings.reverse');
 never_sent := d.status in ('BORRADOR','VALIDADO','XML_GENERADO','FIRMADO')
   and d.authorization_number is null and d.authorized_at is null
   and not exists(select 1 from public.sri_transmissions where company_id=p_company_id and document_id=p_document_id)
   and not exists(select 1 from public.sri_transmission_attempts where company_id=p_company_id and document_id=p_document_id)
   and not exists(select 1 from public.sri_responses where company_id=p_company_id and document_id=p_document_id);
 if l.status='ACTIVE' and can_reverse then
   if never_sent and c.state is null and public.erp_security_has_capability(p_company_id,'accounting.journal.reverse') then actions:='["DISCARD"]';
   elsif d.status='AUTORIZADO' then
     if c.state is null then actions:='["REQUEST"]';
     elsif c.state='CANCELLATION_REQUESTED' then actions:='["SUBMIT_PORTAL_REFERENCE"]';
     elsif c.state='PENDING_CANCELLATION' and public.erp_security_has_capability(p_company_id,'accounting.journal.reverse') then actions:='["CONFIRM_OFFICIAL_ANNULMENT"]'; end if;
   end if;
 end if;
 if c.state in ('DISCARDED','ANULLED') and d.status='ANULADO' and l.status='CANCELLED'
   and public.erp_security_has_capability(p_company_id,'purchases.withholdings.create')
   and exists(select 1 from public.erp_supplier_purchase_documents p where p.company_id=p_company_id and p.purchase_document_id=l.purchase_document_id and p.status='POSTED' and p.retention_status='PENDING_ISSUANCE')
   and not exists(select 1 from public.erp_supplier_purchase_withholding_links x where x.company_id=p_company_id and x.purchase_document_id=l.purchase_document_id and x.status='ACTIVE') then actions:='["REISSUE"]'; end if;
 return jsonb_build_object('ok',true,'documentId',d.id,'companyId',p_company_id,'purchaseId',l.purchase_document_id,
   'state',coalesce(c.state,'NONE'),'version',coalesce(c.version,0),'documentUpdatedAt',d.updated_at,'actions',actions,
   'workflow',case when c.electronic_document_id is null then null else to_jsonb(c)-'evidence_content' end,
   'history',coalesce((select jsonb_agg(jsonb_build_object('documentId',h.id,'fullNumber',h.full_number,'status',h.status,
      'previousDocumentId',x.previous_electronic_document_id,'journalEntryId',x.journal_entry_id,'cancellationState',w.state,
      'reversalJournalEntryId',w.reversal_journal_entry_id) order by x.created_at,h.id)
     from public.erp_supplier_purchase_withholding_links x join public.electronic_documents h on h.company_id=x.company_id and h.id=x.electronic_document_id
     left join public.erp_purchase_withholding_cancellations w on w.company_id=x.company_id and w.electronic_document_id=x.electronic_document_id
     where x.company_id=p_company_id and x.purchase_document_id=l.purchase_document_id),'[]'));
end $$;

create or replace function public.erp_purchase_withholding_cancel(
 p_company_id uuid,p_document_id uuid,p_operation_id uuid,p_device_id text,p_action text,
 p_expected_version bigint,p_document_updated_at timestamptz,p_reason text,p_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype; l public.erp_supplier_purchase_withholding_links%rowtype;
 c public.erp_purchase_withholding_cancellations%rowtype; policy jsonb; previous jsonb; result jsonb;
 content bytea; v_evidence jsonb; reversal jsonb; reversal_id uuid; evidence_date date; request_hash text; purchase_id uuid;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'purchases.withholdings.reverse');
 if p_operation_id is null or nullif(btrim(p_device_id),'') is null or length(p_device_id)>200 then raise exception 'WITHHOLDING_COMMAND_ID_REQUIRED'; end if;
 if p_action is null or p_action not in ('DISCARD','REQUEST','SUBMIT_PORTAL_REFERENCE','CONFIRM_OFFICIAL_ANNULMENT') then raise exception 'WITHHOLDING_CANCELLATION_ACTION_INVALID'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'WITHHOLDING_CANCELLATION_REASON_REQUIRED'; end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('company',p_company_id,'document',p_document_id,'actor',auth.uid(),
   'action',p_action,'reason',p_reason,'evidence',p_evidence,'version',p_expected_version,'updatedAt',p_document_updated_at)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('WITHHOLDING_CANCEL_OPERATION:'||p_operation_id::text,0));
 select a.new_values into previous from public.electronic_document_audit_logs a where a.action='PURCHASE_WITHHOLDING_CANCELLATION'
   and a.new_values->>'operationId'=p_operation_id::text;
 if found then
   if previous->>'requestHash' is distinct from request_hash then raise exception 'WITHHOLDING_OPERATION_CONFLICT'; end if;
   return public.erp_purchase_withholding_cancellation_state(p_company_id,p_document_id)||jsonb_build_object('reused',true);
 end if;
 if exists(select 1 from public.erp_operations_commands where operation_id=p_operation_id) then raise exception 'WITHHOLDING_OPERATION_CONFLICT'; end if;
 select purchase_document_id into purchase_id from public.erp_supplier_purchase_withholding_links where company_id=p_company_id and electronic_document_id=p_document_id;
 if not found then raise exception 'WITHHOLDING_PURCHASE_LINK_REQUIRED'; end if;
 -- Same lock order as draft creation: purchase mutex, purchase row, then document.
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PURCHASE_WITHHOLDING:'||purchase_id::text,0));
 perform 1 from public.erp_supplier_purchase_documents where company_id=p_company_id and purchase_document_id=purchase_id and status='POSTED' for update;
 if not found then raise exception 'WITHHOLDING_POSTED_PURCHASE_REQUIRED'; end if;
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id and document_type='07' for update;
 if not found then raise exception 'WITHHOLDING_DOCUMENT_NOT_FOUND'; end if;
 perform public.sri_assert_document_routing(p_company_id,d.environment,d.emission_point_id,'07');
 select * into l from public.erp_supplier_purchase_withholding_links where company_id=p_company_id and electronic_document_id=p_document_id for update;
 select * into c from public.erp_purchase_withholding_cancellations where company_id=p_company_id and electronic_document_id=p_document_id for update;
 policy:=public.erp_purchase_withholding_cancellation_state(p_company_id,p_document_id);
 -- A second logical confirmation cannot reverse twice, even with a different operation ID.
 if (p_action='DISCARD' and c.state='DISCARDED') or (p_action='CONFIRM_OFFICIAL_ANNULMENT' and c.state='ANULLED') then
   return policy||jsonb_build_object('reused',true);
 end if;
 if p_expected_version is distinct from coalesce(c.version,0) or p_document_updated_at is distinct from d.updated_at then raise exception 'WITHHOLDING_CANCELLATION_STALE_VERSION'; end if;
 if not (policy->'actions' ? p_action) then raise exception 'WITHHOLDING_CANCELLATION_NOT_ALLOWED: %',d.status; end if;
 if p_action='REQUEST' then
   insert into public.erp_purchase_withholding_cancellations(company_id,electronic_document_id,state,reason,created_by,updated_by)
   values(p_company_id,p_document_id,'CANCELLATION_REQUESTED',btrim(p_reason),auth.uid(),auth.uid());
 elsif p_action='SUBMIT_PORTAL_REFERENCE' then
   if p_evidence->>'accessKey' is distinct from d.access_key or length(btrim(coalesce(p_evidence->>'reference',''))) not between 3 and 500 then raise exception 'WITHHOLDING_PORTAL_REFERENCE_REQUIRED'; end if;
   update public.erp_purchase_withholding_cancellations set state='PENDING_CANCELLATION',portal_reference=btrim(p_evidence->>'reference'),
     updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1 where company_id=p_company_id and electronic_document_id=p_document_id;
 else
   perform public.erp_security_assert_capability(p_company_id,'accounting.journal.reverse');
   if p_action='CONFIRM_OFFICIAL_ANNULMENT' then
     if p_evidence->>'officialStatus' is distinct from 'ANULADO' or p_evidence->>'accessKey' is distinct from d.access_key
       or p_evidence->>'authorizationNumber' is distinct from d.authorization_number or nullif(d.authorization_number,'') is null
       or p_evidence->>'verifiedInSriOnline' is distinct from 'true'
       or length(btrim(coalesce(p_evidence->>'reference',''))) not between 3 and 500
       or coalesce(p_evidence->>'annulmentDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'WITHHOLDING_OFFICIAL_ANNULMENT_EVIDENCE_REQUIRED'; end if;
     evidence_date:=(p_evidence->>'annulmentDate')::date;
     if evidence_date < d.issue_date or evidence_date > (clock_timestamp() at time zone 'America/Guayaquil')::date then raise exception 'WITHHOLDING_OFFICIAL_ANNULMENT_DATE_INVALID'; end if;
     if length(coalesce(p_evidence->>'fileBase64','')) > 2796204 then raise exception 'WITHHOLDING_EVIDENCE_FILE_TOO_LARGE'; end if;
     content:=decode(coalesce(p_evidence->>'fileBase64',''),'base64');
     if octet_length(content) not between 16 and 2097152 or not (
       (p_evidence->>'contentType'='application/pdf' and substring(content from 1 for 5)=decode('255044462d','hex')) or
       (p_evidence->>'contentType'='image/png' and substring(content from 1 for 8)=decode('89504e470d0a1a0a','hex')) or
       (p_evidence->>'contentType'='image/jpeg' and substring(content from 1 for 3)=decode('ffd8ff','hex'))
     ) then raise exception 'WITHHOLDING_EVIDENCE_FILE_REQUIRED'; end if;
     v_evidence:=jsonb_build_object('source','SRI_ONLINE_MANUALLY_VERIFIED','officialStatus','ANULADO','accessKey',d.access_key,
       'authorizationNumber',d.authorization_number,'annulmentDate',evidence_date,'reference',btrim(p_evidence->>'reference'),
       'contentType',p_evidence->>'contentType','verifiedBy',auth.uid(),'verifiedAt',clock_timestamp());
   end if;
   -- Reverse exactly the original withholding entry, including its CxP debit and each IR/IVA credit.
   -- Creation posts to the journal; it does not debit the supplier-payable table. Do not add that amount twice.
   if not exists(select 1 from public.erp_financial_journal_entries j where j.company_id=p_company_id and j.journal_entry_id=l.journal_entry_id
     and j.source_type='PURCHASE_WITHHOLDING' and j.source_id=p_document_id::text and j.status='POSTED') then raise exception 'WITHHOLDING_ORIGINAL_JOURNAL_REQUIRED'; end if;
   reversal:=public.erp_financial_v2_reverse_journal(p_operation_id,p_company_id,p_device_id,l.journal_entry_id,
     'Retencion '||d.full_number||' - '||p_action||': '||btrim(p_reason));
   reversal_id:=(reversal#>>'{result,reverseJournalEntryId}')::uuid;
   if reversal_id is null or not exists(select 1 from public.erp_financial_journal_entries r where r.company_id=p_company_id
     and r.journal_entry_id=reversal_id and r.reverse_of_id=l.journal_entry_id and r.status='POSTED'
     and r.total_debit=r.total_credit and r.total_debit>0) then raise exception 'WITHHOLDING_REVERSAL_ACK_INVALID'; end if;
   if p_action='DISCARD' then
     insert into public.erp_purchase_withholding_cancellations(company_id,electronic_document_id,state,reason,reversal_journal_entry_id,created_by,updated_by)
     values(p_company_id,p_document_id,'DISCARDED',btrim(p_reason),reversal_id,auth.uid(),auth.uid());
   else
     update public.erp_purchase_withholding_cancellations set state='ANULLED',evidence=v_evidence,evidence_content=content,
       evidence_sha256=encode(sha256(content),'hex'),reversal_journal_entry_id=reversal_id,updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1
       where company_id=p_company_id and electronic_document_id=p_document_id;
     perform set_config('app.sri_registered_annulment','on',true);
   end if;
   update public.electronic_documents set status='ANULADO',updated_by=auth.uid() where company_id=p_company_id and id=p_document_id;
   update public.erp_supplier_purchase_withholding_links set status='CANCELLED',updated_at=clock_timestamp(),updated_by=auth.uid()
     where company_id=p_company_id and electronic_document_id=p_document_id;
   update public.erp_supplier_purchase_documents set retention_status='PENDING_ISSUANCE',updated_at=clock_timestamp(),
     version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and purchase_document_id=purchase_id;
   perform public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,purchase_id);
 end if;
 result:=public.erp_purchase_withholding_cancellation_state(p_company_id,p_document_id);
 insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,old_status,new_status,reason,old_values,new_values)
 values(p_company_id,p_document_id,auth.uid(),'USER','PURCHASE_WITHHOLDING_CANCELLATION',d.status,
   case when p_action in ('DISCARD','CONFIRM_OFFICIAL_ANNULMENT') then 'ANULADO' else d.status end,btrim(p_reason),
   jsonb_build_object('workflow',c.state,'status',d.status,'authorizationNumber',d.authorization_number,'accessKey',d.access_key),
   jsonb_build_object('operationId',p_operation_id,'requestHash',request_hash,'action',p_action,'workflow',result->>'state',
     'reversalJournalEntryId',reversal_id,'evidenceSha256',case when content is not null then encode(sha256(content),'hex') end,
     'portalReference',p_evidence->>'reference','artifactsPreserved',true));
 return result;
end $$;

create or replace function public.erp_purchase_withholding_annulment_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.document_type='07' and new.status='ANULADO' and old.status<>'ANULADO' and not exists(
   select 1 from public.erp_purchase_withholding_cancellations c
   join public.erp_supplier_purchase_withholding_links l on l.company_id=c.company_id and l.electronic_document_id=c.electronic_document_id
   join public.erp_financial_journal_entries r on r.company_id=c.company_id and r.journal_entry_id=c.reversal_journal_entry_id
   where c.company_id=old.company_id and c.electronic_document_id=old.id and r.reverse_of_id=l.journal_entry_id and r.status='POSTED'
     and ((old.status='AUTORIZADO' and c.state='ANULLED' and c.evidence->>'officialStatus'='ANULADO' and c.evidence->>'accessKey'=old.access_key)
       or (old.status in ('BORRADOR','VALIDADO','XML_GENERADO','FIRMADO') and c.state='DISCARDED'
         and not exists(select 1 from public.sri_transmissions t where t.company_id=old.company_id and t.document_id=old.id)))
 ) then raise exception 'WITHHOLDING_CANONICAL_CANCELLATION_REQUIRED'; end if;
 return new;
end $$;
drop trigger if exists withholding_annulment_guard on public.electronic_documents;
create trigger withholding_annulment_guard before update of status on public.electronic_documents
 for each row when (old.document_type='07') execute function public.erp_purchase_withholding_annulment_guard();

create or replace function public.erp_purchase_withholding_cancellation_evidence(p_company_id uuid,p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.erp_sri_config_assert_access(p_company_id,'purchases.withholdings.view');
 return (select jsonb_build_object('ok',true,'evidence',evidence,'sha256',evidence_sha256,'fileBase64',encode(evidence_content,'base64'))
   from public.erp_purchase_withholding_cancellations where company_id=p_company_id and electronic_document_id=p_document_id and state='ANULLED');
end $$;
revoke all on function public.erp_purchase_withholding_replacement_guard(),public.erp_purchase_withholding_annulment_guard() from public,anon,authenticated;
revoke all on function public.erp_purchase_withholding_cancellation_state(uuid,uuid),public.erp_purchase_withholding_cancellation_evidence(uuid,uuid),
 public.erp_purchase_withholding_cancel(uuid,uuid,uuid,text,text,bigint,timestamptz,text,jsonb) from public,anon;
grant execute on function public.erp_purchase_withholding_cancellation_state(uuid,uuid),public.erp_purchase_withholding_cancellation_evidence(uuid,uuid),
 public.erp_purchase_withholding_cancel(uuid,uuid,uuid,text,text,bigint,timestamptz,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
