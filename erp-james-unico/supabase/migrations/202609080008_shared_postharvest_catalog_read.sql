begin;

-- Shared projection only. No configuration/record writes and no table/RLS grants.
-- Quality remains the existing flower-quality PREMIUM/TIPO_B contract.
-- Rollback: revoke this function's EXECUTE after reverting the consuming app;
-- no catalog rows, historical snapshots or RLS policies need restoration.
create or replace function public.erp_commercial_shared_postharvest_catalog(
 p_company_id uuid,p_catalog text,p_include_inactive boolean default false
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 v_owner constant uuid:='cf331b82-7ac3-4065-9e38-d0bbcde96cd5';
 v_consumer constant uuid:='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
 v_actor uuid;v_entity text;v_rows jsonb;
begin
 if p_company_id is null or p_company_id not in (v_owner,v_consumer) then
   raise exception using errcode='42501',message='SHARED_CATALOG_COMPANY_NOT_ALLOWED';
 end if;
 v_actor:=public.erp_u2a_assert_company_read_access(p_company_id);
 if not exists(select 1 from public.user_profiles where user_id=v_actor and is_active=true)
   or not exists(select 1 from public.user_company_memberships where user_id=v_actor and company_id=p_company_id and membership_status='ACTIVE') then
   raise exception using errcode='42501',message='SHARED_CATALOG_ACTIVE_MEMBERSHIP_REQUIRED';
 end if;
 perform public.erp_security_assert_capability(p_company_id,'commercial.export_products.view');
 if p_catalog is null or p_catalog not in ('varieties','lengths') then
   raise exception using errcode='42501',message='SHARED_CATALOG_NOT_ALLOWED';
 end if;
 v_entity:=case p_catalog when 'varieties' then 'operations_varieties' when 'lengths' then 'operations_lengths' end;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.record_id,'owner_company_id',r.company_id,'code',r.payload->>'code','name',r.payload->>'name',
   'active',r.deleted_at is null and coalesce(r.payload->'active','true'::jsonb)='true'::jsonb,
   'version',r.version,'updated_at',r.updated_at,'deleted_at',r.deleted_at
 ) order by r.payload->>'name',r.record_id),'[]'::jsonb) into v_rows
 from public.erp_entity_records r
 where r.company_id=v_owner and r.entity=v_entity
   and (p_include_inactive is true or (r.deleted_at is null and coalesce(r.payload->'active','true'::jsonb)='true'::jsonb));
 return jsonb_build_object('company_id',p_company_id,'owner_company_id',v_owner,'catalog',p_catalog,
   'include_inactive',p_include_inactive is true,'records',v_rows,'source','erp_entity_records','read_only',true);
end;
$$;
revoke all on function public.erp_commercial_shared_postharvest_catalog(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.erp_commercial_shared_postharvest_catalog(uuid,text,boolean) to authenticated;

commit;
