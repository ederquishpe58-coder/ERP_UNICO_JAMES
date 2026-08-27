-- U2D-P1: keep the internal Commercial history implementation private while
-- allowing the capability-guarded public wrapper to execute it as its trusted owner.

do $guard$
declare
  v_wrapper_oid oid := to_regprocedure(
    'public.erp_list_commercial_order_history(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[])'
  );
  v_internal_oid oid := to_regprocedure(
    'public.erp_list_commercial_order_history_u2c3_internal(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[])'
  );
  v_definition text;
  v_assert_position integer;
  v_internal_position integer;
begin
  if v_wrapper_oid is null or v_internal_oid is null then
    raise exception using errcode = '55000', message = 'U2D_P1_EXPECTED_FUNCTIONS_REQUIRED';
  end if;

  if pg_get_userbyid((select proowner from pg_proc where oid = v_wrapper_oid))
       not in ('postgres', 'supabase_admin')
     or pg_get_userbyid((select proowner from pg_proc where oid = v_internal_oid))
       not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '55000', message = 'U2D_P1_TRUSTED_OWNER_REQUIRED';
  end if;

  if pg_get_function_result(v_wrapper_oid) is distinct from pg_get_function_result(v_internal_oid) then
    raise exception using errcode = '55000', message = 'U2D_P1_RETURN_CONTRACT_MISMATCH';
  end if;

  select pg_get_functiondef(v_wrapper_oid) into v_definition;
  v_assert_position := position('erp_security_assert_capability' in v_definition);
  v_internal_position := position('erp_list_commercial_order_history_u2c3_internal' in v_definition);

  if v_assert_position = 0 or v_internal_position = 0 or v_assert_position >= v_internal_position then
    raise exception using errcode = '55000', message = 'U2D_P1_CAPABILITY_GUARD_ORDER_REQUIRED';
  end if;
end;
$guard$;

alter function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) security definer;

alter function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) set search_path = pg_catalog, public, pg_temp;

revoke all on function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) from public, anon, service_role;
grant execute on function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) to authenticated;

revoke all on function public.erp_list_commercial_order_history_u2c3_internal(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) from public, anon, authenticated, service_role;

comment on function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) is
  'U2D-P1 capability-guarded SECURITY DEFINER read entrypoint. The private U2C3 implementation remains non-executable by API roles.';
