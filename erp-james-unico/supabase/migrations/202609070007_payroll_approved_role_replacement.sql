-- Explicit, audited replacement of an approved Payroll V2 role.
-- This migration changes schema/functions only. It does not replace an existing role.

alter table public.erp_payroll_roles
  add column replacement_revision integer not null default 1,
  add column replaces_role_id uuid,
  add column replacement_reason text,
  add column replaced_reason text,
  add column replaced_at timestamptz,
  add column replaced_by uuid;

alter table public.erp_payroll_roles
  drop constraint erp_payroll_roles_status_check,
  drop constraint erp_payroll_roles_company_id_period_id_key,
  add constraint erp_payroll_roles_status_check
    check(status in ('DRAFT','CALCULATED','APPROVED','POSTED','REPLACED')),
  add constraint erp_payroll_roles_replacement_revision_check
    check(replacement_revision>0 and ((replaces_role_id is null and replacement_revision=1) or (replaces_role_id is not null and replacement_revision>1))),
  add constraint erp_payroll_roles_replacement_metadata_check
    check(
      (status='REPLACED' and replaced_at is not null and replaced_by is not null and nullif(btrim(replaced_reason),'') is not null)
      or
      (status<>'REPLACED' and replaced_at is null and replaced_by is null and replaced_reason is null)
    ),
  add constraint erp_payroll_roles_replaces_role_fkey
    foreign key(company_id,replaces_role_id) references public.erp_payroll_roles(company_id,role_id),
  add constraint erp_payroll_roles_replaced_by_fkey
    foreign key(replaced_by) references auth.users(id);

create unique index erp_payroll_roles_active_period_uidx
  on public.erp_payroll_roles(company_id,period_id) where status<>'REPLACED';
create unique index erp_payroll_roles_period_root_uidx
  on public.erp_payroll_roles(company_id,period_id) where replaces_role_id is null;
create unique index erp_payroll_roles_predecessor_uidx
  on public.erp_payroll_roles(company_id,replaces_role_id) where replaces_role_id is not null;
create unique index erp_payroll_roles_period_revision_uidx
  on public.erp_payroll_roles(company_id,period_id,replacement_revision);

create or replace function public.erp_payroll_core_v2_validate_replacement_chain()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_parent public.erp_payroll_roles%rowtype;
begin
  if tg_op='UPDATE' then
    if new.company_id<>old.company_id or new.period_id<>old.period_id
      or new.replaces_role_id is distinct from old.replaces_role_id
      or new.replacement_revision<>old.replacement_revision
      or new.replacement_reason is distinct from old.replacement_reason then
      raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_LINK_IMMUTABLE';
    end if;
    return new;
  end if;
  if new.replaces_role_id is null then
    if new.replacement_revision<>1 or new.replacement_reason is not null then
      raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_LINK_REQUIRED';
    end if;
    return new;
  end if;
  select * into v_parent from public.erp_payroll_roles
    where company_id=new.company_id and role_id=new.replaces_role_id for key share;
  if not found or v_parent.period_id<>new.period_id then
    raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_PERIOD_MISMATCH';
  end if;
  if v_parent.status<>'REPLACED' or v_parent.accrual_journal_entry_id is not null then
    raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_PREDECESSOR_INVALID';
  end if;
  if new.replacement_revision<>v_parent.replacement_revision+1 or nullif(btrim(new.replacement_reason),'') is null then
    raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_REVISION_INVALID';
  end if;
  if tg_op='INSERT' and new.status<>'DRAFT' then
    raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_MUST_START_DRAFT';
  end if;
  return new;
end $$;

create trigger erp_payroll_roles_validate_replacement_chain
before insert or update of company_id,period_id,replaces_role_id,replacement_revision,replacement_reason,status
on public.erp_payroll_roles for each row execute function public.erp_payroll_core_v2_validate_replacement_chain();

create or replace function public.erp_payroll_core_v2_guard_replaced_role()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='REPLACED' then
    raise exception using errcode='23514',message='PAYROLL_REPLACED_ROLE_IMMUTABLE';
  end if;
  if old.status='POSTED' then
    raise exception using errcode='23514',message='PAYROLL_POSTED_ROLE_IMMUTABLE';
  end if;
  if tg_op='UPDATE' and old.status='APPROVED' and new.status='REPLACED' then
    if new.company_id<>old.company_id or new.role_id<>old.role_id or new.period_id<>old.period_id
      or new.role_number<>old.role_number or new.employee_count<>old.employee_count
      or new.total_income<>old.total_income or new.total_discounts<>old.total_discounts or new.net_total<>old.net_total
      or new.accrual_journal_entry_id is distinct from old.accrual_journal_entry_id
      or new.notes<>old.notes or new.created_at<>old.created_at or new.created_by is distinct from old.created_by
      or new.calculated_at is distinct from old.calculated_at or new.calculated_by is distinct from old.calculated_by
      or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
      or new.posted_at is distinct from old.posted_at or new.posted_by is distinct from old.posted_by
      or new.calculation_config_snapshot is distinct from old.calculation_config_snapshot
      or new.replacement_revision<>old.replacement_revision or new.replaces_role_id is distinct from old.replaces_role_id
      or new.replacement_reason is distinct from old.replacement_reason
      or new.version<>old.version+1 or new.replaced_at is null or new.replaced_by is null
      or nullif(btrim(new.replaced_reason),'') is null then
      raise exception using errcode='23514',message='PAYROLL_APPROVED_ROLE_SILENT_EDIT_DENIED';
    end if;
  elsif tg_op='UPDATE' and old.status='APPROVED' and new.status='POSTED' then
    if new.company_id<>old.company_id or new.role_id<>old.role_id or new.period_id<>old.period_id
      or new.role_number<>old.role_number or new.employee_count<>old.employee_count
      or new.total_income<>old.total_income or new.total_discounts<>old.total_discounts or new.net_total<>old.net_total
      or old.accrual_journal_entry_id is not null or new.accrual_journal_entry_id is null
      or new.notes<>old.notes or new.created_at<>old.created_at or new.created_by is distinct from old.created_by
      or new.calculated_at is distinct from old.calculated_at or new.calculated_by is distinct from old.calculated_by
      or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
      or new.calculation_config_snapshot is distinct from old.calculation_config_snapshot
      or new.replacement_revision<>old.replacement_revision or new.replaces_role_id is distinct from old.replaces_role_id
      or new.replacement_reason is distinct from old.replacement_reason or new.replaced_reason is distinct from old.replaced_reason
      or new.replaced_at is distinct from old.replaced_at or new.replaced_by is distinct from old.replaced_by
      or new.version<>old.version+1 or new.posted_at is null or new.posted_by is null then
      raise exception using errcode='23514',message='PAYROLL_APPROVED_ROLE_SILENT_EDIT_DENIED';
    end if;
  elsif old.status='APPROVED' then
    raise exception using errcode='23514',message='PAYROLL_APPROVED_ROLE_SILENT_EDIT_DENIED';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create trigger erp_payroll_roles_guard_replaced_role
before update or delete on public.erp_payroll_roles
for each row execute function public.erp_payroll_core_v2_guard_replaced_role();

create or replace function public.erp_payroll_core_v2_publish_role_bundle(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_role_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; i record; l record; ps record; v_records jsonb:='[]'::jsonb;
begin
  select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
  v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_roles',r.role_id::text,
    jsonb_build_object('id',r.role_id,'roleId',r.role_id,'periodId',r.period_id,'roleNumber',r.role_number,'status',r.status,
      'employeeCount',r.employee_count,'totalIncome',r.total_income,'totalDiscounts',r.total_discounts,'netTotal',r.net_total,
      'journalEntryId',r.accrual_journal_entry_id,'notes',r.notes,'createdAt',r.created_at,'calculatedAt',r.calculated_at,'approvedAt',r.approved_at,
      'postedAt',r.posted_at,'version',r.version,'replacementRevision',r.replacement_revision,'replacesRoleId',r.replaces_role_id,
      'replacementReason',r.replacement_reason,'replacedReason',r.replaced_reason,'replacedAt',r.replaced_at,'replacedBy',r.replaced_by,'syncFlow','PAYROLL_CORE_V2')));
  for i in select * from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop
    v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_items',i.role_item_id::text,
      jsonb_build_object('id',i.role_item_id,'roleItemId',i.role_item_id,'roleId',i.role_id,'employeeId',i.employee_id,
        'employeeCode',i.employee_code_snapshot,'employeeName',i.employee_name_snapshot,'employeeIdentification',i.employee_identification_snapshot,'position',i.position_snapshot,
        'calculationMode',i.calculation_mode_snapshot,'referenceBaseSalary',i.reference_base_salary,'baseAmountUsed',i.base_amount_used,
        'baseAdjustmentReason',i.base_adjustment_reason,'baseAdjustedAt',i.base_adjusted_at,'baseAdjustedBy',i.base_adjusted_by,
        'employeeNotes',i.employee_notes,'performanceCalculationSnapshot',i.performance_calculation_snapshot,'frozenAt',i.frozen_at,
        'performanceSnapshotCount',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
        'totalIncome',i.total_income,'totalDiscounts',i.total_discounts,'netTotal',i.net_total,'version',i.version,'syncFlow','PAYROLL_CORE_V2')));
    for l in select * from public.erp_payroll_role_lines where company_id=i.company_id and role_item_id=i.role_item_id order by line_order loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',l.role_line_id::text,
        to_jsonb(l)||jsonb_build_object('id',l.role_line_id,'roleLineId',l.role_line_id,'roleItemId',l.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    for ps in select * from public.erp_payroll_performance_policy_snapshots where company_id=i.company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_snapshots',ps.policy_snapshot_id::text,
        to_jsonb(ps)||jsonb_build_object('id',ps.policy_snapshot_id,'policySnapshotId',ps.policy_snapshot_id,'roleItemId',ps.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
  end loop;
  return v_records;
end $$;

create or replace function public.erp_payroll_core_v2_replace_role_u2c4_internal(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_expected_version bigint,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_new public.erp_payroll_roles%rowtype;
  v_period public.erp_payroll_periods%rowtype; v_request jsonb; v_result jsonb; v_records jsonb; v_reason text:=btrim(coalesce(p_reason,''));
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.approve');
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.calculate');
  if p_operation_id is null or p_role_id is null or p_expected_version is null or nullif(btrim(p_device_id),'') is null then
    raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID';
  end if;
  if length(v_reason)<10 or length(v_reason)>500 then
    raise exception using errcode='22023',message='PAYROLL_ROLE_REPLACEMENT_REASON_REQUIRED';
  end if;
  v_request:=jsonb_build_object('roleId',p_role_id,'expectedVersion',p_expected_version,'reason',v_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where operation_id=p_operation_id;
  if found then
    if v_command.company_id<>p_company_id or v_command.command_type<>'PAYROLL_V2_REPLACE_ROLE'
      or v_command.user_id is distinct from auth.uid() or v_command.request_payload is distinct from v_request
      or v_command.status<>'CONFIRMED' then
      raise exception using errcode='23514',message='PAYROLL_V2_OPERATION_REPLAY_MISMATCH';
    end if;
    return v_command.result;
  end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERFORMANCE_SOURCE',0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERIOD:'||v_role.period_id::text,0));
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=v_role.period_id for update;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
  if v_role.status='POSTED' or v_role.accrual_journal_entry_id is not null then
    raise exception using errcode='23514',message='PAYROLL_POSTED_ROLE_IMMUTABLE';
  end if;
  if v_role.status<>'APPROVED' then raise exception using errcode='23514',message='PAYROLL_ROLE_REPLACEMENT_APPROVED_REQUIRED'; end if;
  if v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
  if exists(select 1 from public.erp_payroll_roles where company_id=p_company_id and replaces_role_id=p_role_id) then
    raise exception using errcode='23514',message='PAYROLL_ROLE_ALREADY_REPLACED';
  end if;
  update public.erp_payroll_roles set status='REPLACED',replaced_reason=v_reason,replaced_at=clock_timestamp(),replaced_by=auth.uid(),
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and role_id=p_role_id returning * into v_role;
  insert into public.erp_payroll_roles(company_id,period_id,role_number,status,notes,created_by,updated_by,last_operation_id,
    replacement_revision,replaces_role_id,replacement_reason)
  values(p_company_id,v_role.period_id,public.erp_payroll_core_v2_next_code(p_company_id,'ROLE',v_period.date_to),'DRAFT','',auth.uid(),auth.uid(),p_operation_id,
    v_role.replacement_revision+1,v_role.role_id,v_reason) returning * into v_new;
  update public.erp_payroll_periods set status='OPEN',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and period_id=v_role.period_id returning * into v_period;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_REPLACED','ROLE',v_role.role_id,
    jsonb_build_object('replacementRoleId',v_new.role_id,'periodId',v_role.period_id,'replacementRevision',v_new.replacement_revision,'reason',v_reason));
  v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,v_role.role_id)
    ||public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,v_new.role_id)
    ||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_periods',v_period.period_id::text,
      jsonb_build_object('id',v_period.period_id,'periodId',v_period.period_id,'year',v_period.year,'month',v_period.month,'dateFrom',v_period.date_from,
        'dateTo',v_period.date_to,'status',v_period.status,'version',v_period.version,'syncFlow','PAYROLL_CORE_V2')));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object(
    'originalRoleId',v_role.role_id,'originalStatus',v_role.status,'originalVersion',v_role.version,'replacementRoleId',v_new.role_id,
    'replacementStatus',v_new.status,'replacementVersion',v_new.version,'replacementRevision',v_new.replacement_revision,'periodId',v_role.period_id));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_REPLACE_ROLE',v_role.role_id::text,v_request,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_replace_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_expected_version bigint,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_REPLACE_ROLE',
    public.erp_payroll_core_v2_replace_role_u2c4_internal(p_operation_id,p_company_id,p_device_id,p_role_id,p_expected_version,p_reason,p_local_created_at));
end $$;

-- The full calculate function is repeated with one material change:
-- period lookup only targets the active (non-REPLACED) role.
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
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and period_id=p_period_id and status<>'REPLACED' for update;
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
        if v_kind='DEDUCTION' and v_account='' then
          raise exception using errcode='23514',message='PAYROLL_DEDUCTION_LINE_ACCOUNT_REQUIRED:'||v_code;
        end if;
        if v_account<>'' then perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,v_account,case when v_kind='EARNING' then 'EXPENSE' when v_code='ADVANCE' then 'ADVANCE_LINE' else 'DEDUCTION_LINE' end); end if;
        if v_account='' and v_kind='EARNING' then v_account:=coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''); end if;
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
end $function$;

create or replace function public.erp_payroll_core_v2_get_bundle_u2c4_internal(p_company_id uuid,p_role_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_roles jsonb; v_periods jsonb; v_employees jsonb; v_links jsonb; v_settings jsonb; v_policies jsonb; v_assignments jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_code),'[]') into v_employees from public.erp_payroll_employees e where e.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.employee_id,l.operational_role),'[]') into v_links from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.operational_role,p.code,p.policy_version desc),'[]') into v_policies from public.erp_payroll_performance_policies p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id,a.operational_role,a.valid_from desc),'[]') into v_assignments from public.erp_payroll_employee_policy_assignments a where a.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.date_from desc),'[]') into v_periods from public.erp_payroll_periods p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',r.company_id,'role_id',r.role_id,'period_id',r.period_id,'role_number',r.role_number,'status',r.status,'notes',r.notes,
    'employee_count',r.employee_count,'total_income',r.total_income,'total_discounts',r.total_discounts,'net_total',r.net_total,
    'accrual_journal_entry_id',r.accrual_journal_entry_id,'created_at',r.created_at,'calculated_at',r.calculated_at,'approved_at',r.approved_at,
    'posted_at',r.posted_at,'version',r.version,'replacement_revision',r.replacement_revision,'replaces_role_id',r.replaces_role_id,
    'replacement_reason',r.replacement_reason,'replaced_reason',r.replaced_reason,'replaced_at',r.replaced_at,'replaced_by',r.replaced_by,
    'requires_recalculation',public.erp_payroll_core_v2_requires_recalculation(p_company_id,r.role_id),'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_order) from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_snapshot_count',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
      'performance_policy_snapshots',coalesce((select jsonb_agg(to_jsonb(ps) order by ps.operational_role) from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id),'[]'::jsonb)
    ) order by i.employee_name_snapshot) from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id),'[]'::jsonb)
  ) order by r.replacement_revision desc,r.created_at desc),'[]') into v_roles from public.erp_payroll_roles r
    where r.company_id=p_company_id and (p_role_id is null or r.role_id=p_role_id);
  select coalesce(to_jsonb(s),'{}') into v_settings from public.erp_payroll_accounting_settings s where s.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'employees',v_employees,'operationalRoles',v_links,
    'performancePolicies',v_policies,'policyAssignments',v_assignments,'periods',v_periods,'roles',v_roles,
    'accountingSettings',v_settings,'serverTime',clock_timestamp());
end $$;

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
   where r.company_id=p_company_id and r.period_id=p_period_id and r.status<>'REPLACED' and i.employee_id=p_employee_id;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'employeeId',p_employee_id,'periodId',p_period_id,'rows',data,
   'policyMetrics','[]'::jsonb,'performanceCalculationSnapshot',calculation,'sourceAuthority','OPERATIONS_PERFORMANCE_V2',
   'totals',coalesce((select jsonb_object_agg(operational_role,total) from
     (select operational_role,sum(quantity)::numeric(24,6)::text total from public.erp_payroll_performance_v2_employee_rows(p_company_id,p_employee_id,p.date_from,p.date_to) group by operational_role) t),'{}'::jsonb),
   'unlinkedSourceCount',unlinked,'matchingPolicy','OPERATIONAL_WORKER_ID_ONLY');
end $$;

create or replace function public.erp_payroll_core_v2_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_permissions jsonb; v_capabilities jsonb;
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  select coalesce(jsonb_agg(effective.capability_id order by effective.capability_id),'[]'::jsonb) into v_capabilities
    from public.erp_security_get_effective_capabilities(p_company_id) effective where effective.module='payroll';
  v_permissions:=jsonb_build_object('view',public.erp_payroll_core_v2_has_permission(p_company_id,'VIEW'),
    'manage',public.erp_payroll_core_v2_has_permission(p_company_id,'MANAGE'),'approve',public.erp_payroll_core_v2_has_permission(p_company_id,'APPROVE'),
    'post',public.erp_payroll_core_v2_has_permission(p_company_id,'POST'));
  return jsonb_build_object('ok',true,'functionalCore','PAYROLL_GO_LIVE_20260907','okContract','PAYROLL_COMMAND_CONFIRMATION_V1',
    'component','PAYROLL_CORE_V2','migration','202608210003','companyId',p_company_id,'permissions',v_permissions,'capabilities',v_capabilities,
    'securityAlignment','PAYROLL_CANONICAL_CAPABILITIES','employeeTable',to_regclass('public.erp_payroll_employees') is not null,
    'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,'periodTable',to_regclass('public.erp_payroll_periods') is not null,
    'roleTable',to_regclass('public.erp_payroll_roles') is not null,'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'performancePolicyTable',to_regclass('public.erp_payroll_performance_policies') is not null,
    'policyAssignmentTable',to_regclass('public.erp_payroll_employee_policy_assignments') is not null,
    'policySnapshotTable',to_regclass('public.erp_payroll_performance_policy_snapshots') is not null,'manualRoleValues',true,'serverTotals',true,
    'baseAdjustmentAudit',true,'performanceDetailsOnDemand',true,'approvedRoleReplacement',true,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','CANONICAL_PERIOD_EXCESS_V1','salaryImpact','BASE_470_PLUS_PERIOD_EXCESS',
    'performanceSource','OPERATIONS_PERFORMANCE_V2','buncherSource','operations_bunch_entries','classifierSource','operations_mesh_records','serverTime',clock_timestamp());
end $$;

revoke all on function public.erp_payroll_core_v2_validate_replacement_chain() from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_core_v2_guard_replaced_role() from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_core_v2_replace_role_u2c4_internal(uuid,uuid,text,uuid,bigint,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_core_v2_replace_role(uuid,uuid,text,uuid,bigint,text,timestamptz) from public,anon,service_role;
grant execute on function public.erp_payroll_core_v2_replace_role(uuid,uuid,text,uuid,bigint,text,timestamptz) to authenticated;
