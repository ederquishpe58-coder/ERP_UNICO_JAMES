-- Human-approved period excess arithmetic only. No production data mutation.
-- Deliberately private: the canonical source/link/workday integration must validate
-- its inputs before using this helper. This is not a write ACK or an access guard.
begin;

create function public.erp_payroll_performance_v2_period_excess(
  p_operational_role text,
  p_worked_days integer,
  p_actual_units numeric
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := upper(btrim(coalesce(p_operational_role, '')));
  v_base numeric(20,6) := 470;
  v_daily_target numeric(20,6);
  v_period_target numeric(20,6);
  v_actual numeric(20,6);
  v_excess numeric(20,6);
  v_unit_cost numeric(20,6);
  v_extra numeric(20,6);
  v_total numeric(20,6);
begin
  if v_role not in ('CLASSIFIER', 'BUNCHER') then
    raise exception using errcode='22023', message='PAYROLL_PERFORMANCE_ROLE_REQUIRED';
  end if;
  -- Reuse the integer-day domain of considered_workdays, but zero cannot be a
  -- denominator. Never substitute 21, calendar days, or browser dates.
  if p_worked_days is null or p_worked_days < 1 or p_worked_days > 31 then
    raise exception using errcode='22023', message='PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED';
  end if;
  if p_actual_units is null
     or p_actual_units::text in ('NaN', 'Infinity', '-Infinity')
     or p_actual_units < 0 then
    raise exception using errcode='22023', message='PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED';
  end if;
  if p_actual_units <> round(p_actual_units, 6) then
    raise exception using errcode='22023', message='PAYROLL_PERFORMANCE_PRECISION_EXCEEDED';
  end if;

  v_daily_target := case v_role when 'CLASSIFIER' then 260 else 200 end;
  v_actual := p_actual_units;
  v_period_target := p_worked_days * v_daily_target;
  v_excess := greatest(v_actual - v_period_target, 0);
  v_unit_cost := round(v_base / v_period_target, 6);
  -- Preserve the approved proportion until the monetary boundary. The six-place
  -- unit cost is a snapshot representation, never a rounded multiplication base.
  -- Example: an excess equal to the target pays exactly 470, not 470.001.
  v_extra := round((v_excess * v_base) / v_period_target, 6);
  v_total := v_base + v_extra;

  return jsonb_build_object(
    'contract', 'PAYROLL_PERIOD_EXCESS_470_V1',
    'calculationPeriod', 'PAYROLL_PERIOD',
    'operationalRole', v_role,
    'unit', case v_role when 'CLASSIFIER' then 'MESHES' else 'BUNCHES' end,
    'workedDays', p_worked_days,
    'baseSalary', v_base::text,
    'dailyTarget', v_daily_target::text,
    'periodTarget', v_period_target::text,
    'actualUnits', v_actual::text,
    'excessUnits', v_excess::text,
    'unitCost', v_unit_cost::text,
    'extraPay', v_extra::text,
    'basePlusExtra', v_total::text,
    'precision', 6,
    'rounding', 'EXACT_RATIO_THEN_ROUND_EXTRA_6'
  );
end;
$$;

-- Default Supabase ACLs can grant new functions to API roles. Revoke explicitly.
revoke all on function public.erp_payroll_performance_v2_period_excess(text,integer,numeric)
  from public, anon, authenticated, service_role;

comment on function public.erp_payroll_performance_v2_period_excess(text,integer,numeric) is
  'Private approved payroll-period excess arithmetic: fixed base 470, classifier 260/day, buncher 200/day, no below-target reduction. Inputs require independently validated canonical performance. No historical PERFORMANCE activation.';

commit;
