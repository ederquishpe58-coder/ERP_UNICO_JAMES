-- Run only in a disposable database after the period-excess migration.
-- No employee, role, policy, concept, inventory or account rows are created.
begin;
do $$
declare
  r record;
  result jsonb;
  role_name text;
  days integer;
  daily integer;
  target numeric;
  actual numeric;
  error_code text;
begin
  for r in select * from (values
    ('CLASSIFIER',21,5460::numeric,'5460.000000','0.000000','0.086081','0.000000','470.000000'),
    ('CLASSIFIER',21,5600::numeric,'5460.000000','140.000000','0.086081','12.051282','482.051282'),
    ('CLASSIFIER',21,5000::numeric,'5460.000000','0.000000','0.086081','0.000000','470.000000'),
    ('BUNCHER',21,4200::numeric,'4200.000000','0.000000','0.111905','0.000000','470.000000'),
    ('BUNCHER',21,4300::numeric,'4200.000000','100.000000','0.111905','11.190476','481.190476'),
    ('BUNCHER',20,4300::numeric,'4000.000000','300.000000','0.117500','35.250000','505.250000'),
    ('BUNCHER',22,4300::numeric,'4400.000000','0.000000','0.106818','0.000000','470.000000'),
    ('CLASSIFIER',20,5600::numeric,'5200.000000','400.000000','0.090385','36.153846','506.153846'),
    ('CLASSIFIER',22,5600::numeric,'5720.000000','0.000000','0.082168','0.000000','470.000000')
  ) v(role,days,actual,target,excess,rate,extra,total) loop
    result := public.erp_payroll_performance_v2_period_excess(r.role,r.days,r.actual);
    if result->>'periodTarget' <> r.target or result->>'excessUnits' <> r.excess
      or result->>'unitCost' <> r.rate or result->>'extraPay' <> r.extra
      or result->>'basePlusExtra' <> r.total or result->>'baseSalary' <> '470.000000'
      or result->>'calculationPeriod' <> 'PAYROLL_PERIOD' then
      raise exception 'EXCESS_FIXTURE_FAILED: % / % / % => %',r.role,r.days,r.actual,result;
    end if;
  end loop;

  -- Period aggregation compensates low days: 200 + 210 + 190 = 600, no excess.
  result := public.erp_payroll_performance_v2_period_excess('BUNCHER',3,200+210+190);
  if result->>'extraPay' <> '0.000000' then raise exception 'DAILY_EXCESS_LEAK'; end if;

  -- Cover all supported day counts. Under target never removes base salary.
  -- Twice target must pay exactly twice the base, without rate-rounding drift.
  foreach role_name in array array['CLASSIFIER','BUNCHER'] loop
    daily := case role_name when 'CLASSIFIER' then 260 else 200 end;
    for days in 1..31 loop
      target := days * daily;
      foreach actual in array array[0::numeric,target-1,target] loop
        result := public.erp_payroll_performance_v2_period_excess(role_name,days,actual);
        if (result->>'periodTarget')::numeric <> target
          or result->>'extraPay' <> '0.000000'
          or result->>'basePlusExtra' <> '470.000000' then
          raise exception 'BASE_REDUCTION_OR_TARGET_ERROR: % / %',role_name,days;
        end if;
      end loop;
      result := public.erp_payroll_performance_v2_period_excess(role_name,days,2*target);
      if result->>'extraPay' <> '470.000000' or result->>'basePlusExtra' <> '940.000000' then
        raise exception 'PREMATURE_RATE_ROUNDING: % / %',role_name,days;
      end if;
    end loop;
  end loop;

  -- Calculate canonically at six places, display only at the two-place boundary.
  result := public.erp_payroll_performance_v2_period_excess('BUNCHER',21,4300);
  if round((result->>'extraPay')::numeric,2) <> 11.19
    or round((result->>'basePlusExtra')::numeric,2) <> 481.19 then
    raise exception 'DISPLAY_BOUNDARY_ERROR';
  end if;
  result := public.erp_payroll_performance_v2_period_excess('CLASSIFIER',21,5600);
  if round((result->>'extraPay')::numeric,2) <> 12.05
    or round((result->>'basePlusExtra')::numeric,2) <> 482.05 then
    raise exception 'CLASSIFIER_DISPLAY_BOUNDARY_ERROR';
  end if;

  for r in select * from (values
    ('SELLER'::text,21,1::numeric,'PAYROLL_PERFORMANCE_ROLE_REQUIRED'),
    (null::text,21,1::numeric,'PAYROLL_PERFORMANCE_ROLE_REQUIRED'),
    ('BUNCHER',null::integer,0::numeric,'PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'),
    ('BUNCHER',0,0::numeric,'PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'),
    ('CLASSIFIER',-1,0::numeric,'PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'),
    ('CLASSIFIER',32,0::numeric,'PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'),
    ('BUNCHER',21,null::numeric,'PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED'),
    ('BUNCHER',21,-1::numeric,'PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED'),
    ('BUNCHER',21,'NaN'::numeric,'PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED'),
    ('BUNCHER',21,'Infinity'::numeric,'PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED'),
    ('BUNCHER',21,'-Infinity'::numeric,'PAYROLL_PERFORMANCE_ACTUAL_UNITS_REQUIRED'),
    ('CLASSIFIER',21,1.0000001::numeric,'PAYROLL_PERFORMANCE_PRECISION_EXCEEDED')
  ) v(role,days,actual,expected) loop
    error_code := null;
    begin
      perform public.erp_payroll_performance_v2_period_excess(r.role,r.days,r.actual);
    exception when others then
      get stacked diagnostics error_code = message_text;
    end;
    if error_code is distinct from r.expected then
      raise exception 'FAIL_CLOSED_ERROR: expected %, got %',r.expected,error_code;
    end if;
  end loop;

  if has_function_privilege('anon','public.erp_payroll_performance_v2_period_excess(text,integer,numeric)','EXECUTE')
    or has_function_privilege('authenticated','public.erp_payroll_performance_v2_period_excess(text,integer,numeric)','EXECUTE')
    or has_function_privilege('service_role','public.erp_payroll_performance_v2_period_excess(text,integer,numeric)','EXECUTE') then
    raise exception 'PRIVATE_ARITHMETIC_EXPOSED_AS_RPC';
  end if;
end;
$$;
rollback;
