-- Forward-only repair for the server-side lease assertion required by the
-- break-glass reception worker. No user capability is granted here.
begin;

create or replace function public.assert_sri_break_glass_reception_claim(
  p_transmission_id uuid,
  p_worker_id text,
  p_attempt_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  j public.sri_transmissions%rowtype;
  d public.electronic_documents%rowtype;
  a public.sri_transmission_attempts%rowtype;
  e public.electronic_document_audit_logs%rowtype;
begin
  select * into j from public.sri_transmissions where id = p_transmission_id;
  if j.id is null then raise exception 'SRI_BREAK_GLASS_CLAIM_LOST'; end if;
  perform public.sri_assert_service_actor_capability(j.company_id, p_actor_user_id,
    'commercial.electronic_documents.break_glass_retry');
  perform public.erp_sri_assert_transport_actor(j.company_id, p_actor_user_id);
  select * into d
  from public.electronic_documents
  where company_id = j.company_id and id = j.document_id
  for update;
  select * into j from public.sri_transmissions where id = p_transmission_id for update;
  select * into a
  from public.sri_transmission_attempts
  where company_id = j.company_id and document_id = j.document_id
    and transmission_id = j.id and id = p_attempt_id;
  select * into e
  from public.electronic_document_audit_logs
  where company_id = j.company_id and document_id = j.document_id
    and action = 'SRI_BREAK_GLASS_RETRY'
    and actor_user_id = p_actor_user_id
    and new_values->>'attempt_id' = a.id::text
    and new_values->>'worker_id' = p_worker_id
  order by created_at desc, id desc
  limit 1;
  if d.id is null or j.status <> 'PROCESSING' or j.transmission_type <> 'RECEPTION'
     or j.worker_id is distinct from p_worker_id
     or p_worker_id not like 'break-glass-reception-%'
     or j.environment is distinct from d.environment
     or j.claimed_at is null
     or j.claimed_at <= clock_timestamp() - interval '180 seconds'
     or j.claimed_at > clock_timestamp()
     or a.id is null or a.status <> 'STARTED'
     or e.id is null
     or a.request_sha256 is distinct from e.new_values->>'signed_xml_hash'
     or (to_jsonb(d) - array['status', 'updated_at', 'updated_by', 'last_error']) is distinct from
        ((e.new_values->'document_before') - array['status', 'updated_at', 'updated_by', 'last_error'])
     or exists(select 1 from public.sri_authorizations
               where company_id = d.company_id and document_id = d.id)
     or exists(select 1 from public.sri_responses
               where company_id = d.company_id and document_id = d.id and response_type = 'RECEPTION')
     or exists(select 1 from public.sri_error_messages
               where company_id = d.company_id and document_id = d.id and identifier in ('43', '45', '70'))
     or exists(select 1 from public.erp_sri_document_manager_events
               where company_id = d.company_id and document_id = d.id and action = 'CANCELLATION_REQUESTED')
     or exists(select 1 from public.erp_purchase_withholding_cancellations
               where company_id = d.company_id and electronic_document_id = d.id
                 and state in ('CANCELLATION_REQUESTED', 'PENDING_CANCELLATION')) then
    raise exception 'SRI_BREAK_GLASS_CLAIM_LOST';
  end if;
  perform public.sri_assert_environment_enabled(d.company_id, d.environment);
  return true;
end;
$function$;

revoke all on function public.assert_sri_break_glass_reception_claim(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_sri_break_glass_reception_claim(uuid, text, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
