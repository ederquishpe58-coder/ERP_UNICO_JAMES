begin;

-- Restore self inspection only. The mutation RPC retains its unconditional
-- self-elevation denial, membership checks and atomic profile/override contract.
do $migration$
declare
  definition text := pg_get_functiondef('public.erp_admin_preview_user_access_plan(uuid,uuid,text,jsonb)'::regprocedure);
  old_guard text := 'if v_actor=p_target_user_id then raise exception using errcode=''42501'',message=''SECURITY_SELF_ELEVATION_DENIED''; end if;';
  read_guard text := 'if v_actor=p_target_user_id and (p_profile_id is not null or p_overrides is not null) then raise exception using errcode=''42501'',message=''SECURITY_SELF_ELEVATION_DENIED''; end if;';
  old_result text := '''target_user_id'',p_target_user_id,''membership'',to_jsonb(v_member)';
  read_result text := '''target_user_id'',p_target_user_id,''can_edit'',v_actor<>p_target_user_id,''membership'',to_jsonb(v_member)';
begin
  if position(read_guard in definition)>0 and position(read_result in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
    or (length(definition)-length(replace(definition,old_result,'')))/length(old_result)<>1 then
    raise exception 'SECURITY_ACCESS_PLAN_READ_CONTRACT_CHANGED';
  end if;
  execute replace(replace(definition,old_guard,read_guard),old_result,read_result);
end $migration$;

notify pgrst,'reload schema';
commit;
