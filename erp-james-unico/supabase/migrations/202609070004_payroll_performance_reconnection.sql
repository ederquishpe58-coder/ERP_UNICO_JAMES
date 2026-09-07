-- Shared confirmed-event authority. No historical rows, employees, policies,
-- accounts, concepts, memberships or operational commands are changed here.
begin;

alter table public.erp_payroll_role_items add column performance_calculation_snapshot jsonb;

create function public.erp_operations_performance_v2_mesh_count(p_value text)
returns numeric language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if p_value is null or p_value !~ '^\d+(\.\d{1,6})?$' then
   raise exception using errcode='22023',message='OPERATIONS_PERFORMANCE_MESH_COUNT_INVALID';
 end if;
 return p_value::numeric;
end $$;

create function public.erp_operations_performance_v2_rows(p_company_id uuid,p_date_from date,p_date_to date)
returns table(operational_role text,operational_worker_id text,worker_name text,
 source_entity text,source_record_id text,source_version bigint,source_updated_at timestamptz,
 operation_id uuid,event_at timestamptz,event_date date,workday_id text,
 quantity numeric,unit text,stems numeric,source_fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
 with deliveries as (
   select distinct on (r.record_id) r.*,c.operation_id origin_operation_id,c.server_created_at event_time
   from public.erp_operations_commands c
   cross join lateral jsonb_array_elements(coalesce(c.result->'records','[]')) proof
   join public.erp_entity_records r on r.company_id=c.company_id and r.entity='operations_mesh_records'
     and r.record_id=coalesce(proof->>'record_id',proof->>'recordId') and r.deleted_at is null
   where c.company_id=p_company_id and c.status='CONFIRMED' and c.command_type='ASSIGN_CLASSIFICATION'
     and proof->>'entity'='operations_mesh_records'
     and upper(coalesce(r.payload->>'status','')) not in ('ANULADO','CANCELADO')
   order by r.record_id,c.server_created_at,c.operation_id
 ), receipts as (
   select distinct on (z.bunch_id) r.*,c.operation_id origin_operation_id,c.server_created_at event_time,
     coalesce(nullif(r.payload->>'buncherEmployeeId',''),nullif(r.payload->>'buncher_employee_id',''),
       nullif(r.payload->>'operationalWorkerId',''),nullif(r.payload->>'operational_worker_id',''),
       nullif(b.proof#>>'{payload,buncherEmployeeId}',''),nullif(i.proof#>>'{payload,buncherEmployeeId}','')) worker_id
   from public.erp_zebra_label_registry z
   join public.erp_operations_commands c on c.company_id=z.company_id and c.operation_id=z.receipt_operation_id
     and c.status='CONFIRMED' and c.command_type='RECEIVE_ZEBRA_BUNCH'
   cross join lateral jsonb_array_elements(coalesce(c.result->'records','[]')) entry_proof
   join public.erp_entity_records r on r.company_id=c.company_id and r.entity='operations_bunch_entries'
     and r.record_id=coalesce(entry_proof->>'record_id',entry_proof->>'recordId') and r.deleted_at is null
     and r.payload->>'bunchId'=z.bunch_id::text
   cross join lateral (select value proof from jsonb_array_elements(c.result->'records')
     where value->>'entity'='operations_bunches' and coalesce(value->>'record_id',value->>'recordId')=z.bunch_id::text limit 1) b
   cross join lateral (select value proof from jsonb_array_elements(c.result->'records')
     where value->>'entity'='operations_rose_inventory'
       and value#>>'{payload,sourceBunchEntryId}'=r.record_id
       and value#>>'{payload,sourceType}'='ESCANEO_ETIQUETA' limit 1) i
   where z.company_id=p_company_id and entry_proof->>'entity'='operations_bunch_entries'
     and coalesce(b.proof#>>'{payload,buncherEmployeeId}','')=coalesce(i.proof#>>'{payload,buncherEmployeeId}','')
   order by z.bunch_id,r.record_id
   -- Inventory availability/state and label reprints never undo completed work.
 ), raw as (
   select 'CLASSIFIER'::text role,
     coalesce(nullif(payload->>'classifierEmployeeId',''),nullif(payload->>'classifier_employee_id',''),
       nullif(payload->>'operationalWorkerId',''),nullif(payload->>'operational_worker_id',''),
       nullif(payload->>'employeeId',''),nullif(payload->>'employee_id','')) worker,
     entity,record_id,version,updated_at,origin_operation_id,event_time,payload->>'workdayId' workday,
     public.erp_operations_performance_v2_mesh_count(payload->>'meshCount') qty,
     'MESHES'::text units,
     case when coalesce(payload->>'totalStems','') ~ '^\d+(\.\d{1,6})?$' then (payload->>'totalStems')::numeric else 0 end stem_qty
   from deliveries
   where lower(coalesce(payload->>'demoValidationSeed','false')) not in ('true','1')
   union all
   select 'BUNCHER',worker_id,entity,record_id,version,updated_at,origin_operation_id,event_time,payload->>'workdayId',1,'BUNCHES',
     case when coalesce(payload->>'stemsPerBunch','') ~ '^\d+(\.\d{1,6})?$' then (payload->>'stemsPerBunch')::numeric else 0 end
   from receipts
 ), canonical as (
   select r.*,(r.event_time at time zone 'America/Guayaquil')::date event_day
   from raw r where nullif(r.worker,'') is not null and r.qty>0 and r.event_time is not null
     and exists(select 1 from public.erp_entity_records w where w.company_id=p_company_id and w.deleted_at is null
       and w.entity in ('operations_yield_workday','operations_yield_workday_history') and w.payload->>'id'=r.workday)
 )
 select r.role,r.worker,coalesce(nullif(w.payload->>'name',''),r.worker),
   r.entity,r.record_id,r.version,r.updated_at,r.origin_operation_id,r.event_time,r.event_day,r.workday,
   r.qty,r.units,r.stem_qty,
   md5(jsonb_build_array(p_company_id,r.role,r.worker,r.entity,r.record_id,r.origin_operation_id,r.event_time,r.workday,r.qty)::text)
 from canonical r left join public.erp_entity_records w on w.company_id=p_company_id
   and w.entity=case r.role when 'CLASSIFIER' then 'operations_classifiers' else 'operations_bunchers' end and w.record_id=r.worker
 where (p_date_from is null or r.event_day>=p_date_from) and (p_date_to is null or r.event_day<=p_date_to)
$$;

create function public.erp_payroll_performance_v2_effective_link(p_company_id uuid,p_role text,p_worker_id text,p_event_date date)
returns setof public.erp_payroll_employee_operational_roles
language sql stable security definer set search_path=public,pg_temp as $$
 select l.* from public.erp_payroll_employee_operational_roles l
 where l.company_id=p_company_id and l.operational_role=p_role and l.operational_worker_id=p_worker_id
   and (l.active or l.valid_to is not null) and p_event_date between l.valid_from and coalesce(l.valid_to,'infinity'::date)
 order by l.valid_from desc,l.updated_at desc,l.link_id desc limit 1
$$;

create function public.erp_payroll_performance_v2_employee_rows(p_company_id uuid,p_employee_id uuid,p_from date,p_to date)
returns table(operational_role text,operational_worker_id text,source_entity text,source_record_id text,
 source_version bigint,source_updated_at timestamptz,operation_id uuid,event_at timestamptz,event_date date,
 workday_id text,quantity numeric,unit text,source_fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.operational_role,r.operational_worker_id,r.source_entity,r.source_record_id,r.source_version,r.source_updated_at,
   r.operation_id,r.event_at,r.event_date,r.workday_id,r.quantity,r.unit,r.source_fingerprint
 from public.erp_operations_performance_v2_rows(p_company_id,p_from,p_to) r
 join lateral public.erp_payroll_performance_v2_effective_link(p_company_id,r.operational_role,r.operational_worker_id,r.event_date) l
   on l.employee_id=p_employee_id
$$;

create or replace function public.erp_payroll_core_v2_performance_rows(p_company_id uuid,p_employee_id uuid,p_date_from date,p_date_to date)
returns table(operational_role text,source_entity text,source_record_id text,source_version bigint,source_updated_at timestamptz,quantity numeric,unit text)
language sql stable security definer set search_path=public,pg_temp as $$
 select operational_role,source_entity,source_record_id,source_version,source_updated_at,quantity,unit
 from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p_date_from,p_date_to)
$$;

create function public.erp_operations_performance_v2_get(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 perform public.erp_security_assert_capability(p_company_id,'operations.yields.view');
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('company_id',p_company_id,'quantity',r.quantity::numeric(20,6)::text,'stems',r.stems::numeric(20,6)::text,'payroll_linked',exists(
   select 1 from public.erp_payroll_performance_v2_effective_link(p_company_id,r.operational_role,r.operational_worker_id,r.event_date)
 )) order by r.event_at,r.source_record_id),'[]') into result
 from public.erp_operations_performance_v2_rows(p_company_id,null,null) r;
 return jsonb_build_object('ok',true,'contract','OPERATIONS_PERFORMANCE_V2','companyId',p_company_id,
   'rows',result,'serverTime',clock_timestamp());
end $$;

create function public.erp_payroll_performance_v2_input_snapshot(p_company_id uuid,p_employee_id uuid,p_from date,p_to date)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('contract','PAYROLL_PERIOD_EXCESS_470_V1',
   'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.link_id,'role',l.operational_role,'worker',l.operational_worker_id,
     'from',l.valid_from,'to',l.valid_to,'active',l.active) order by l.link_id)
     from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id and l.employee_id=p_employee_id
       and (l.active or l.valid_to is not null) and l.valid_from<=p_to and coalesce(l.valid_to,'infinity'::date)>=p_from),'[]'),
   'sources',coalesce((select jsonb_agg(jsonb_build_object('entity',r.source_entity,'id',r.source_record_id,'fingerprint',r.source_fingerprint)
     order by r.source_entity,r.source_record_id) from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p_from,p_to) r),'[]'))
$$;

create function public.erp_payroll_performance_v2_source_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare company uuid; old_company uuid; new_company uuid;
begin
 if tg_table_name='erp_entity_records' then
   if tg_op<>'INSERT' and old.entity in ('operations_mesh_records','operations_bunch_entries') then old_company:=old.company_id; end if;
   if tg_op<>'DELETE' and new.entity in ('operations_mesh_records','operations_bunch_entries') then new_company:=new.company_id; end if;
 else
   if tg_op<>'INSERT' then old_company:=old.company_id; end if;
   if tg_op<>'DELETE' then new_company:=new.company_id; end if;
 end if;
 for company in select distinct c from unnest(array[old_company,new_company]) c where c is not null order by c loop
   perform pg_advisory_xact_lock(hashtextextended(company::text||':PAYROLL_PERFORMANCE_SOURCE',0));
 end loop;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger payroll_performance_source_lock before insert or update or delete on public.erp_entity_records
 for each row execute function public.erp_payroll_performance_v2_source_lock();
create trigger payroll_performance_link_lock before insert or update or delete on public.erp_payroll_employee_operational_roles
 for each row execute function public.erp_payroll_performance_v2_source_lock();

-- Existing function replacements; capability and ACK wrappers are retained.

create or replace function public.erp_payroll_performance_v2_snapshot_item(p_company_id uuid,p_role_item_id uuid,p_employee_id uuid,p_period_from date,p_period_to date,p_considered_workdays integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.erp_payroll_employees%rowtype; r record; role text; roles integer; actual numeric; calculation jsonb; fingerprint text;
begin
 select * into e from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id;
 if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
 if not exists(select 1 from public.erp_payroll_role_items i join public.erp_payroll_roles p using(company_id,role_id)
   where i.company_id=p_company_id and i.role_item_id=p_role_item_id and i.employee_id=p_employee_id and p.status in ('DRAFT','CALCULATED')) then
   raise exception using errcode='23514',message='PAYROLL_V2_ROLE_LOCKED';
 end if;
 select count(distinct l.operational_role),min(l.operational_role) into roles,role
 from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id and l.employee_id=p_employee_id
   and (l.active or l.valid_to is not null) and l.valid_from<=p_period_to and coalesce(l.valid_to,'infinity'::date)>=p_period_from;
 if roles>1 then raise exception using errcode='23514',message='PAYROLL_PERFORMANCE_ROLE_CONFLICT'; end if;
 if roles=0 and e.calculation_mode in ('FIXED_PERFORMANCE','PERFORMANCE') then
   raise exception using errcode='23514',message='PAYROLL_PERFORMANCE_LINK_REQUIRED';
 end if;
 delete from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=p_role_item_id;
 delete from public.erp_payroll_performance_policy_snapshots where company_id=p_company_id and role_item_id=p_role_item_id;
 fingerprint:=md5(public.erp_payroll_performance_v2_input_snapshot(p_company_id,p_employee_id,p_period_from,p_period_to)::text);
 if roles=0 then
   update public.erp_payroll_role_items set performance_calculation_snapshot=jsonb_build_object('contract','PAYROLL_NO_PERFORMANCE_V1','inputFingerprint',fingerprint)
   where company_id=p_company_id and role_item_id=p_role_item_id;
   return jsonb_build_object('performance',false,'policyCount',0,'baseSalary',0);
 end if;
 actual:=0;
 for r in select * from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p_period_from,p_period_to) loop
   actual:=actual+r.quantity;
   insert into public.erp_payroll_performance_snapshots(company_id,role_item_id,employee_id,operational_role,source_entity,source_record_id,
     source_version,source_updated_at,period_from,period_to,quantity,unit,applied_rate,calculated_value,source_fingerprint,source_ids)
   values(p_company_id,p_role_item_id,p_employee_id,r.operational_role,r.source_entity,r.source_record_id,r.source_version,r.source_updated_at,
     p_period_from,p_period_to,r.quantity,r.unit,0,0,r.source_fingerprint,
     jsonb_build_array(jsonb_build_object('id',r.source_record_id,'workerId',r.operational_worker_id,'operationId',r.operation_id,'eventDate',r.event_date,'workdayId',r.workday_id)));
 end loop;
 calculation:=public.erp_payroll_performance_v2_period_excess(role,p_considered_workdays,actual)||jsonb_build_object(
   'companyId',p_company_id,'employeeId',p_employee_id,'roleItemId',p_role_item_id,'periodFrom',p_period_from,'periodTo',p_period_to,
   'standardDailyHours',8,'inputFingerprint',fingerprint,'sourceAuthority','OPERATIONS_PERFORMANCE_V2');
 update public.erp_payroll_role_items set performance_calculation_snapshot=calculation
 where company_id=p_company_id and role_item_id=p_role_item_id;
 return calculation||jsonb_build_object('performance',true,'policyCount',0);
end $$;
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_calculate_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_period_id uuid, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_role public.erp_payroll_roles%rowtype;
  v_employee public.erp_payroll_employees%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_item_id uuid; v_employee_id uuid;
  v_payload_item jsonb; v_concept jsonb; v_perf record; v_line integer; v_income numeric; v_deductions numeric; v_amount numeric;
  v_qty numeric; v_kind text; v_code text; v_label text; v_account text; v_notes text; v_role_id uuid; v_records jsonb; v_result jsonb;
  v_policy_summary jsonb; v_reference_salary numeric; v_base_used numeric; v_adjustment_reason text; v_considered_days integer;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.calculate');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERFORMANCE_SOURCE',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERIOD:'||p_period_id::text,0));
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=p_period_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PERIOD_NOT_FOUND'; end if;
  if v_period.status not in ('OPEN','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_PERIOD_LOCKED'; end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and period_id=p_period_id for update;
  if found and v_role.status not in ('DRAFT','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_LOCKED'; end if;
  if found and p_expected_version is not null and v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
  if not found then
    v_role_id:=gen_random_uuid();
    insert into public.erp_payroll_roles(company_id,role_id,period_id,role_number,status,notes,created_by,updated_by,last_operation_id)
    values(p_company_id,v_role_id,p_period_id,public.erp_payroll_core_v2_next_code(p_company_id,'ROLE',v_period.date_to),'DRAFT',btrim(coalesce(p_payload->>'notes','')),auth.uid(),auth.uid(),p_operation_id)
    returning * into v_role;
  else
    v_role_id:=v_role.role_id;
    delete from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id;
  end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'))=0 then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEES_REQUIRED';
  end if;
  select * into v_settings from public.erp_payroll_accounting_settings where company_id=p_company_id;
  for v_payload_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_employee_id:=nullif(v_payload_item->>'employeeId','')::uuid;
    select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_employee_id and status='ACTIVE';
    if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND:'||coalesce(v_employee_id::text,''); end if;
    v_item_id:=gen_random_uuid(); v_line:=0;
    insert into public.erp_payroll_role_items(company_id,role_item_id,role_id,employee_id,employee_code_snapshot,employee_name_snapshot,
      employee_identification_snapshot,position_snapshot,calculation_mode_snapshot,employee_area_snapshot,last_operation_id)
    values(p_company_id,v_item_id,v_role_id,v_employee_id,v_employee.employee_code,v_employee.full_name,v_employee.identification,v_employee.position_name,v_employee.calculation_mode,v_employee.area,p_operation_id);
    v_considered_days:=nullif(v_payload_item->>'consideredWorkdays','')::integer;
    if nullif(v_payload_item->>'consideredWorkdays','') is not null and (v_payload_item->>'consideredWorkdays') !~ '^\d+$' then raise exception using errcode='22023',message='PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'; end if;
    if v_considered_days<0 or v_considered_days>31 then raise exception using errcode='23514',message='PAYROLL_V2_CONSIDERED_DAYS_INVALID'; end if;
    v_policy_summary:=public.erp_payroll_performance_v2_snapshot_item(p_company_id,v_item_id,v_employee_id,v_period.date_from,v_period.date_to,v_considered_days);
    v_reference_salary:=case
      when coalesce((v_policy_summary->>'performance')::boolean,false) then 470
      when v_employee.calculation_mode in ('FIXED','FIXED_MANUAL_HOURS','MONTHLY','MIXED') then v_employee.monthly_salary
      else 0 end;
    v_base_used:=round(coalesce(nullif(v_payload_item->>'baseAmount','')::numeric,v_reference_salary),6);
    if coalesce((v_policy_summary->>'performance')::boolean,false) and not public.erp_payroll_core_v2_concept_enabled(p_company_id,'BASE_AMOUNT') then raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:BASE_AMOUNT'; end if;
    v_adjustment_reason:=btrim(coalesce(v_payload_item->>'baseAdjustmentReason',''));
    if coalesce((v_policy_summary->>'performance')::boolean,false) and v_base_used<>470 then raise exception using errcode='23514',message='PAYROLL_PERFORMANCE_BASE_FIXED_470'; end if;
    if v_base_used<0 then raise exception using errcode='23514',message='PAYROLL_V2_BASE_AMOUNT_INVALID'; end if;
    if not public.erp_payroll_core_v2_concept_enabled(p_company_id,'BASE_AMOUNT') then
      v_base_used:=0; v_adjustment_reason:='Concepto desactivado por configuración canónica';
    end if;
    if abs(v_base_used-v_reference_salary)>0.000001 and nullif(v_adjustment_reason,'') is null then
      raise exception using errcode='23514',message='PAYROLL_V2_BASE_ADJUSTMENT_REASON_REQUIRED';
    end if;
    update public.erp_payroll_role_items set reference_base_salary=v_reference_salary,base_amount_used=v_base_used,
      base_adjustment_reason=v_adjustment_reason,base_adjusted_at=case when abs(v_base_used-v_reference_salary)>0.000001 then clock_timestamp() end,
      base_adjusted_by=case when abs(v_base_used-v_reference_salary)>0.000001 then auth.uid() end,
      employee_notes=btrim(coalesce(v_payload_item->>'notes','')) where company_id=p_company_id and role_item_id=v_item_id;
    if v_base_used>0 then
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,line_notes)
      values(p_company_id,v_item_id,v_line,'EARNING','BASE_AMOUNT','Valor base del período',1,0,v_base_used,coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''),
        case when coalesce((v_policy_summary->>'performance')::boolean,false) then 'PERFORMANCE_POLICY_BASE' else 'EMPLOYEE_MASTER' end,v_adjustment_reason);
    end if;
    -- Existing OTHER_INCOME, explicitly typed as automatic period excess.
    -- Historical PERFORMANCE remains disabled; no all-unit proportional payment.
    if coalesce((v_policy_summary->>'performance')::boolean,false) and (v_policy_summary->>'extraPay')::numeric>0 then
      if not public.erp_payroll_core_v2_concept_enabled(p_company_id,'OTHER_INCOME') then
        raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:OTHER_INCOME';
      end if;
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
      values(p_company_id,v_item_id,v_line,'EARNING','OTHER_INCOME','Excedente de rendimiento del período',
        (v_policy_summary->>'excessUnits')::numeric,(v_policy_summary->>'unitCost')::numeric,(v_policy_summary->>'extraPay')::numeric,
        coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''),'PERFORMANCE_PERIOD_EXCESS',v_policy_summary->>'operationalRole');
    end if;
    if jsonb_typeof(coalesce(v_payload_item->'concepts','[]'))='array' then
      for v_concept in select value from jsonb_array_elements(v_payload_item->'concepts') loop
        v_code:=upper(btrim(v_concept->>'code')); v_kind:=upper(btrim(v_concept->>'kind'));
        v_amount:=round(coalesce(nullif(v_concept->>'amount','')::numeric,0),6);
        v_qty:=coalesce(nullif(v_concept->>'quantity','')::numeric,0);
        if v_amount<0 or v_qty<0 then raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_AMOUNT_INVALID'; end if;
        if not public.erp_payroll_core_v2_concept_enabled(p_company_id,v_code) then
          if v_amount<>0 then raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:'||v_code; end if;
          continue;
        end if;
        if (v_kind='EARNING' and v_code not in ('ADDITIONAL_HOURS','OVERTIME','TRANSPORT','BONUS','COMMISSION','OTHER_INCOME'))
          or (v_kind='DEDUCTION' and v_code not in ('FOOD','ADVANCE','MANUAL_DISCOUNT','OTHER_DISCOUNTS')) then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_NOT_ALLOWED:'||coalesce(v_code,'');
        end if;
        v_amount:=round(coalesce(nullif(v_concept->>'amount','')::numeric,0),6);
        v_qty:=coalesce(nullif(v_concept->>'quantity','')::numeric,0);
        if v_amount<0 or v_qty<0 then raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_AMOUNT_INVALID'; end if;
        if v_amount=0 then continue; end if;
        v_label:=btrim(coalesce(v_concept->>'label',replace(v_code,'_',' ')));
        if v_code in ('OTHER_INCOME','OTHER_DISCOUNTS','MANUAL_DISCOUNT') and nullif(v_label,'') is null then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_DESCRIPTION_REQUIRED';
        end if;
        v_notes:=btrim(coalesce(v_concept->>'notes',v_concept->>'reference',''));
        v_account:=btrim(coalesce(v_concept->>'accountCode',''));
        if v_account<>'' then perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,v_account,case when v_kind='EARNING' then 'EXPENSE' else 'DEDUCTION_LINE' end); end if;
        if v_account='' then v_account:=case when v_kind='EARNING' then coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,'') else coalesce(v_settings.payroll_deduction_account_code,'') end; end if;
        v_line:=v_line+1;
        insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference,line_notes)
        values(p_company_id,v_item_id,v_line,v_kind,v_code,v_label,v_qty,0,v_amount,v_account,'MANUAL_PERIOD',v_notes,v_notes);
      end loop;
    end if;
    select coalesce(sum(amount) filter(where line_kind='EARNING'),0),coalesce(sum(amount) filter(where line_kind='DEDUCTION'),0)
      into v_income,v_deductions from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=v_item_id;
    if v_deductions>v_income then raise exception using errcode='23514',message='PAYROLL_V2_NEGATIVE_NET_NOT_ALLOWED'; end if;
    update public.erp_payroll_role_items set total_income=v_income,total_discounts=v_deductions,net_total=v_income-v_deductions,updated_at=clock_timestamp(),version=version+1
      where company_id=p_company_id and role_item_id=v_item_id;
    if abs(v_base_used-v_reference_salary)>0.000001 then
      perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_ITEM_BASE_ADJUSTED','ROLE_ITEM',v_item_id,
        jsonb_build_object('employeeId',v_employee_id,'configuredValue',v_reference_salary,'usedValue',v_base_used,'reason',v_adjustment_reason,'adjustedBy',auth.uid(),'adjustedAt',clock_timestamp()));
    end if;
  end loop;
  select count(*),coalesce(sum(total_income),0),coalesce(sum(total_discounts),0),coalesce(sum(net_total),0)
    into v_line,v_income,v_deductions,v_amount from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id;
  update public.erp_payroll_roles set calculation_config_snapshot=public.erp_payroll_core_v2_configuration_snapshot(p_company_id,v_role_id),status='CALCULATED',employee_count=v_line,total_income=v_income,total_discounts=v_deductions,net_total=v_amount,
    notes=btrim(coalesce(p_payload->>'notes',notes)),calculated_at=clock_timestamp(),calculated_by=auth.uid(),updated_at=clock_timestamp(),updated_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=v_role_id returning * into v_role;
  update public.erp_payroll_periods set status='CALCULATED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and period_id=p_period_id;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_CALCULATED','ROLE',v_role_id,
    jsonb_build_object('periodId',p_period_id,'totalIncome',v_role.total_income,'totalDiscounts',v_role.total_discounts,'netTotal',v_role.net_total));
  v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,v_role_id);
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',v_role_id,'roleNumber',v_role.role_number,'status',v_role.status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_CALCULATE_ROLE',v_role_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_approve_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_records jsonb; v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.approve');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERFORMANCE_SOURCE',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_ROLE:'||p_role_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
  if v_role.status='APPROVED' then
    v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  else
    if v_role.status<>'CALCULATED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_CALCULATED'; end if;
    if p_expected_version is null or v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
    if public.erp_payroll_core_v2_requires_recalculation(p_company_id,p_role_id) then raise exception using errcode='23514',message='PAYROLL_RECALCULATION_REQUIRED'; end if;
    if not exists(select 1 from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id) then
      raise exception using errcode='23514',message='PAYROLL_V2_ROLE_ITEMS_REQUIRED';
    end if;
    if exists(select 1 from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id
      and (net_total<0 or abs(base_amount_used-reference_base_salary)>0.000001 and nullif(btrim(base_adjustment_reason),'') is null)) then
      raise exception using errcode='23514',message='PAYROLL_V2_ROLE_ITEM_INVALID';
    end if;
    if exists(select 1 from public.erp_payroll_role_items i where i.company_id=p_company_id and i.role_id=p_role_id
      and i.calculation_mode_snapshot='FIXED_PERFORMANCE' and coalesce(i.performance_calculation_snapshot->>'contract','')<>'PAYROLL_PERIOD_EXCESS_470_V1' and not exists(select 1 from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id)) then
      raise exception using errcode='23514',message='PAYROLL_V2_PERFORMANCE_SNAPSHOT_REQUIRED';
    end if;
    update public.erp_payroll_performance_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_performance_policy_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_role_items set frozen_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
      where company_id=p_company_id and role_id=p_role_id;
    update public.erp_payroll_roles set status='APPROVED',approved_at=clock_timestamp(),approved_by=auth.uid(),updated_at=clock_timestamp(),
      updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id returning * into v_role;
    update public.erp_payroll_periods set status='APPROVED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and period_id=v_role.period_id;
    perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_APPROVED','ROLE',p_role_id,
      jsonb_build_object('version',v_role.version,'employeeCount',v_role.employee_count,'totalIncome',v_role.total_income,'totalDiscounts',v_role.total_discounts,'netTotal',v_role.net_total));
    v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  end if;
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',p_role_id,'status','APPROVED'));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_APPROVE_ROLE',p_role_id::text,jsonb_build_object('expectedVersion',p_expected_version),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_link_operational_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_operational_role text, p_operational_worker_id text, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype;
  v_link public.erp_payroll_employee_operational_roles%rowtype;
  v_result jsonb;
  v_record jsonb;
  v_role text:=upper(btrim(coalesce(p_operational_role,'')));
  v_worker text:=btrim(coalesce(p_operational_worker_id,''));
  v_reassigned integer:=0;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.employees.manage');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if v_role not in ('BUNCHER','CLASSIFIER') or v_worker='' or p_valid_from is null or (p_valid_to is not null and p_valid_to<p_valid_from) then
    raise exception using errcode='22023',message='PAYROLL_V2_OPERATIONAL_ROLE_INVALID';
  end if;
  if not exists(select 1 from public.erp_entity_records w where w.company_id=p_company_id
    and w.entity=case v_role when 'CLASSIFIER' then 'operations_classifiers' else 'operations_bunchers' end
    and w.record_id=v_worker and w.deleted_at is null and lower(coalesce(w.payload->>'active','true')) not in ('false','0')) then
    raise exception using errcode='23514',message='PAYROLL_OPERATIONAL_WORKER_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERFORMANCE_SOURCE',0));
  perform 1 from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id and status='ACTIVE';
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;

  -- Serializa tanto por trabajador operativo como por empleado/rol. Así una
  -- reasignación desde Parámetros no deja dos vínculos activos.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_role||':WORKER:'||v_worker,0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_role||':EMPLOYEE:'||p_employee_id::text,0));

  if p_active then
    update public.erp_payroll_employee_operational_roles
    set active=false,
        valid_to=case when valid_from<p_valid_from then p_valid_from-1 else valid_from end,
        updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and operational_role=v_role and active
      and (operational_worker_id=v_worker or employee_id=p_employee_id)
      and not (operational_worker_id=v_worker and employee_id=p_employee_id);
    get diagnostics v_reassigned=row_count;
  end if;

  select * into v_link from public.erp_payroll_employee_operational_roles
  where company_id=p_company_id and employee_id=p_employee_id and operational_role=v_role and operational_worker_id=v_worker
  order by created_at desc limit 1 for update;
  if found then
    update public.erp_payroll_employee_operational_roles
    set valid_from=p_valid_from,valid_to=p_valid_to,active=p_active,updated_at=clock_timestamp(),updated_by=auth.uid(),
        version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and link_id=v_link.link_id returning * into v_link;
  else
    insert into public.erp_payroll_employee_operational_roles(
      company_id,employee_id,operational_role,operational_worker_id,valid_from,valid_to,active,created_by,updated_by,last_operation_id
    ) values(
      p_company_id,p_employee_id,v_role,v_worker,p_valid_from,p_valid_to,p_active,auth.uid(),auth.uid(),p_operation_id
    ) returning * into v_link;
  end if;

  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_operational_roles',v_link.link_id::text,
    jsonb_build_object('id',v_link.link_id,'linkId',v_link.link_id,'employeeId',v_link.employee_id,'operationalModule','POSCOSECHA',
      'operationalRole',v_link.operational_role,'operationalWorkerId',v_link.operational_worker_id,'validFrom',v_link.valid_from,
      'validTo',v_link.valid_to,'active',v_link.active,'version',v_link.version,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,
    case when v_reassigned>0 then 'OPERATIONAL_ROLE_REASSIGNED' else 'OPERATIONAL_ROLE_LINKED' end,
    'EMPLOYEE',p_employee_id,jsonb_build_object('linkId',v_link.link_id,'operationalRole',v_role,'operationalWorkerId',v_worker,'reassignedLinks',v_reassigned));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',
    jsonb_build_object('linkId',v_link.link_id,'employeeId',p_employee_id,'operationalRole',v_role,'operationalWorkerId',v_worker,'reassignedLinks',v_reassigned));
  insert into public.erp_operations_commands(
    operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at
  ) values(
    p_operation_id,p_company_id,'PAYROLL_V2_LINK_OPERATIONAL_ROLE',v_link.link_id::text,
    jsonb_build_object('employeeId',p_employee_id,'operationalRole',v_role,'operationalWorkerId',v_worker),
    v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()
  );
  return v_result;
end $function$
;
create or replace function public.erp_payroll_core_v2_requires_recalculation(p_company_id uuid,p_role_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select r.status='CALCULATED' and (
   r.calculation_config_snapshot is null or r.calculation_config_snapshot->>'configurationHash' is distinct from
     public.erp_payroll_core_v2_configuration_snapshot(p_company_id,p_role_id)->>'configurationHash'
   or exists(select 1 from public.erp_payroll_role_items i join public.erp_payroll_periods p on p.company_id=i.company_id and p.period_id=r.period_id
     where i.company_id=p_company_id and i.role_id=p_role_id and i.performance_calculation_snapshot->>'inputFingerprint' is distinct from
       md5(public.erp_payroll_performance_v2_input_snapshot(p_company_id,i.employee_id,p.date_from,p.date_to)::text)))
   from public.erp_payroll_roles r where r.company_id=p_company_id and r.role_id=p_role_id),true)
$$;
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_publish_role_bundle(p_company_id uuid, p_operation_id uuid, p_device_id text, p_role_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.erp_payroll_roles%rowtype; i record; l record; ps record; v_records jsonb:='[]'::jsonb;
begin
  select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
  v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_roles',r.role_id::text,
    jsonb_build_object('id',r.role_id,'roleId',r.role_id,'periodId',r.period_id,'roleNumber',r.role_number,'status',r.status,
      'employeeCount',r.employee_count,'totalIncome',r.total_income,'totalDiscounts',r.total_discounts,'netTotal',r.net_total,
      'journalEntryId',r.accrual_journal_entry_id,'notes',r.notes,'createdAt',r.created_at,'calculatedAt',r.calculated_at,'approvedAt',r.approved_at,
      'postedAt',r.posted_at,'version',r.version,'syncFlow','PAYROLL_CORE_V2')));
  for i in select * from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop
    v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_items',i.role_item_id::text,
      jsonb_build_object('id',i.role_item_id,'roleItemId',i.role_item_id,'roleId',i.role_id,'employeeId',i.employee_id,
        'employeeCode',i.employee_code_snapshot,'employeeName',i.employee_name_snapshot,'employeeIdentification',i.employee_identification_snapshot,'position',i.position_snapshot,
        'calculationMode',i.calculation_mode_snapshot,'referenceBaseSalary',i.reference_base_salary,'baseAmountUsed',i.base_amount_used,
        'baseAdjustmentReason',i.base_adjustment_reason,'baseAdjustedAt',i.base_adjusted_at,'baseAdjustedBy',i.base_adjusted_by,
        'employeeNotes',i.employee_notes,'performanceCalculationSnapshot',i.performance_calculation_snapshot,'frozenAt',i.frozen_at,'performanceSnapshotCount',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
        'totalIncome',i.total_income,'totalDiscounts',i.total_discounts,'netTotal',i.net_total,
        'version',i.version,'syncFlow','PAYROLL_CORE_V2')));
    for l in select * from public.erp_payroll_role_lines where company_id=i.company_id and role_item_id=i.role_item_id order by line_order loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',l.role_line_id::text,
        to_jsonb(l)||jsonb_build_object('id',l.role_line_id,'roleLineId',l.role_line_id,'roleItemId',l.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    -- El detalle fuente permanece canónico en PostgreSQL y se consulta con
    -- get_performance. No se replica masivamente a la caché en cada posteo.
    for ps in select * from public.erp_payroll_performance_policy_snapshots where company_id=i.company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_snapshots',ps.policy_snapshot_id::text,
        to_jsonb(ps)||jsonb_build_object('id',ps.policy_snapshot_id,'policySnapshotId',ps.policy_snapshot_id,'roleItemId',ps.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
  end loop;
  return v_records;
end $function$
;
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_health(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_permissions jsonb;
  v_capabilities jsonb;
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  select coalesce(jsonb_agg(effective.capability_id order by effective.capability_id), '[]'::jsonb)
  into v_capabilities
  from public.erp_security_get_effective_capabilities(p_company_id) effective
  where effective.module = 'payroll';
  v_permissions := jsonb_build_object(
    'view', public.erp_payroll_core_v2_has_permission(p_company_id,'VIEW'),
    'manage', public.erp_payroll_core_v2_has_permission(p_company_id,'MANAGE'),
    'approve', public.erp_payroll_core_v2_has_permission(p_company_id,'APPROVE'),
    'post', public.erp_payroll_core_v2_has_permission(p_company_id,'POST')
  );
  return jsonb_build_object(
    'ok',true,'functionalCore','PAYROLL_GO_LIVE_20260907','okContract','PAYROLL_COMMAND_CONFIRMATION_V1','component','PAYROLL_CORE_V2','migration','202608210003','companyId',p_company_id,
    'permissions',v_permissions,'capabilities',v_capabilities,'securityAlignment','PAYROLL_CANONICAL_CAPABILITIES',
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,
    'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,
    'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'performancePolicyTable',to_regclass('public.erp_payroll_performance_policies') is not null,
    'policyAssignmentTable',to_regclass('public.erp_payroll_employee_policy_assignments') is not null,
    'policySnapshotTable',to_regclass('public.erp_payroll_performance_policy_snapshots') is not null,
    'manualRoleValues',true,'serverTotals',true,'baseAdjustmentAudit',true,'performanceDetailsOnDemand',true,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','CANONICAL_PERIOD_EXCESS_V1','salaryImpact','BASE_470_PLUS_PERIOD_EXCESS',
    'performanceSource','OPERATIONS_PERFORMANCE_V2','buncherSource','operations_bunch_entries','classifierSource','operations_mesh_records','serverTime',clock_timestamp()
  );
end;
$function$
;
create or replace function public.erp_payroll_core_v2_get_performance_u2c4_internal(p_company_id uuid,p_employee_id uuid,p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.erp_payroll_periods%rowtype; data jsonb; unlinked bigint; calculation jsonb;
begin
 perform public.erp_security_assert_capability(p_company_id,'payroll.performance_policies.view');
 select * into p from public.erp_payroll_periods where company_id=p_company_id and period_id=p_period_id;
 if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PERIOD_NOT_FOUND'; end if;
 if not exists(select 1 from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id) then
   raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.event_at,r.source_record_id),'[]') into data
   from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p.date_from,p.date_to) r;
 select count(*) into unlinked from public.erp_operations_performance_v2_rows(p_company_id,p.date_from,p.date_to) r
   where not exists(select 1 from public.erp_payroll_performance_v2_effective_link(p_company_id,r.operational_role,r.operational_worker_id,r.event_date));
 select i.performance_calculation_snapshot into calculation from public.erp_payroll_role_items i
   join public.erp_payroll_roles r on r.company_id=i.company_id and r.role_id=i.role_id
   where r.company_id=p_company_id and r.period_id=p_period_id and i.employee_id=p_employee_id;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'employeeId',p_employee_id,'periodId',p_period_id,'rows',data,
   'policyMetrics','[]'::jsonb,'performanceCalculationSnapshot',calculation,'sourceAuthority','OPERATIONS_PERFORMANCE_V2',
   'totals',coalesce((select jsonb_object_agg(operational_role,total) from
     (select operational_role,sum(quantity)::numeric(24,6)::text total from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p.date_from,p.date_to) group by operational_role) t),'{}'::jsonb),
   'unlinkedSourceCount',unlinked,'matchingPolicy','OPERATIONAL_WORKER_ID_ONLY');
end $$;
revoke all on function public.erp_operations_performance_v2_mesh_count(text) from public,anon,authenticated,service_role;
revoke all on function public.erp_operations_performance_v2_rows(uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_performance_v2_effective_link(uuid,text,text,date) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_performance_v2_employee_rows(uuid,uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_performance_v2_input_snapshot(uuid,uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_performance_v2_source_lock() from public,anon,authenticated,service_role;
revoke all on function public.erp_operations_performance_v2_get(uuid) from public,anon,service_role;
grant execute on function public.erp_operations_performance_v2_get(uuid) to authenticated;
commit;
