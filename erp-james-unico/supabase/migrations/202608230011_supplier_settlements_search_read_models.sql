-- Liquidaciones de proveedor V2: candidatos, historial y detalle bajo demanda.
-- Solo lectura; no altera la transacción erp_supplier_v2_create_settlement.

create index if not exists erp_operations_receptions_provider_date_read_idx
  on public.erp_entity_records(company_id,(payload->>'providerId'),(payload->>'date'))
  where entity='operations_receptions' and deleted_at is null;

create or replace function public.erp_supplier_settlement_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object('ok',true,'component','SUPPLIER_SETTLEMENT_READ_V2','migration','202608230011',
    'candidates',true,'historyPage',true,'detail',true,'serverTime',clock_timestamp());
end $$;

create or replace function public.erp_supplier_settlement_candidates(
  p_company_id uuid,p_provider_id uuid,p_period_start date,p_period_end date,p_quantity_type text default 'STEM',p_limit integer default 500
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;v_type text:=upper(coalesce(p_quantity_type,'STEM'));v_provider public.erp_supplier_providers%rowtype;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_provider_id is null or p_period_start is null or p_period_end is null or p_period_start>p_period_end
     or v_type not in('STEM','BUNCH') or p_limit<1 or p_limit>500 then
    raise exception using errcode='22023',message='SUPPLIER_SETTLEMENT_CANDIDATE_FILTER_INVALID';
  end if;
  select * into v_provider from public.erp_supplier_providers p
  where p.company_id=p_company_id and p.provider_id=p_provider_id and p.status='ACTIVE';
  if not found then raise exception using errcode='P0002',message='SUPPLIER_SETTLEMENT_PROVIDER_NOT_FOUND';end if;
  with reception_items as (
    select r.record_id reception_id,item.value reception_item,r.payload reception_payload,
      r.payload->>'date' reception_date
    from public.erp_entity_records r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'items','[]'::jsonb)) item(value)
    where r.company_id=p_company_id and r.entity='operations_receptions' and r.deleted_at is null
      and r.payload->>'date'>=p_period_start::text and r.payload->>'date'<=p_period_end::text
      and (
        r.payload->>'providerId'=p_provider_id::text
        or (nullif(v_provider.operational_supplier_id,'') is not null and r.payload->>'providerId'=v_provider.operational_supplier_id)
      )
  ), rows as (
    select ri.reception_id,coalesce(ri.reception_item->>'id','') reception_item_id,ri.reception_date,
      coalesce(ri.reception_item->>'variety',ri.reception_payload->>'variety','') variety,
      coalesce(ri.reception_item->>'length',ri.reception_item->>'measure','') length,
      case when v_type='BUNCH' then case when coalesce(ri.reception_item->>'meshCount','')~'^-?\d+(\.\d+)?$' then (ri.reception_item->>'meshCount')::numeric else 0 end
        else case when coalesce(ri.reception_item->>'totalStems','')~'^-?\d+(\.\d+)?$' then (ri.reception_item->>'totalStems')::numeric else 0 end end received,
      coalesce((select sum(a.quantity) from public.erp_supplier_reception_cost_allocations a
        where a.company_id=p_company_id and a.reception_id=ri.reception_id
          and coalesce(a.reception_item_id,'')=coalesce(ri.reception_item->>'id','')
          and a.quantity_type=v_type and a.status='ACTIVE'),0) settled
    from reception_items ri
  ), available as (
    select *,greatest(received-settled,0) pending from rows where received>settled
  ), limited as (
    select * from available order by reception_date,reception_id,reception_item_id limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',reception_id||'|'||reception_item_id,'receptionId',reception_id,
    'receptionItemId',reception_item_id,'date',reception_date,'variety',variety,'length',length,'received',received,
    'settled',settled,'pending',pending,'quantityType',v_type) order by reception_date,reception_id,reception_item_id),'[]') into v_items from limited;
  with reception_items as (
    select r.record_id reception_id,item.value reception_item,r.payload reception_payload,r.payload->>'date' reception_date
    from public.erp_entity_records r cross join lateral jsonb_array_elements(coalesce(r.payload->'items','[]'::jsonb)) item(value)
    where r.company_id=p_company_id and r.entity='operations_receptions' and r.deleted_at is null
      and r.payload->>'date'>=p_period_start::text and r.payload->>'date'<=p_period_end::text
      and (r.payload->>'providerId'=p_provider_id::text or (nullif(v_provider.operational_supplier_id,'') is not null and r.payload->>'providerId'=v_provider.operational_supplier_id))
  ), rows as (
    select case when v_type='BUNCH' then case when coalesce(ri.reception_item->>'meshCount','')~'^-?\d+(\.\d+)?$' then (ri.reception_item->>'meshCount')::numeric else 0 end
      else case when coalesce(ri.reception_item->>'totalStems','')~'^-?\d+(\.\d+)?$' then (ri.reception_item->>'totalStems')::numeric else 0 end end received,
      coalesce((select sum(a.quantity) from public.erp_supplier_reception_cost_allocations a where a.company_id=p_company_id
        and a.reception_id=ri.reception_id and coalesce(a.reception_item_id,'')=coalesce(ri.reception_item->>'id','') and a.quantity_type=v_type and a.status='ACTIVE'),0) settled
    from reception_items ri
  ), available as (select received,settled,greatest(received-settled,0) pending from rows where received>settled)
  select count(*),jsonb_build_object('items',count(*),'received',coalesce(sum(received),0),'settled',coalesce(sum(settled),0),
    'pending',coalesce(sum(pending),0),'truncated',count(*)>p_limit) into v_total,v_summary from available;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'quantityType',v_type);
end $$;

create or replace function public.erp_supplier_settlement_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_provider_id uuid default null,p_status text default null,
  p_reference text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to or p_limit not in(25,50) or p_offset<0 then
    raise exception using errcode='22023',message='SUPPLIER_SETTLEMENT_HISTORY_FILTER_INVALID';
  end if;
  with filtered as (
    select s.*,coalesce(nullif(p.commercial_name,''),p.legal_name) provider_name,p.tax_id provider_ruc,
      coalesce(a.status,'') payable_status,coalesce(a.balance,0) payable_balance,coalesce(j.entry_number,'') journal_entry_number,
      (select count(*) from public.erp_supplier_settlement_lines l where l.company_id=s.company_id and l.settlement_id=s.settlement_id) line_count,
      (select coalesce(sum(l.quantity),0) from public.erp_supplier_settlement_lines l where l.company_id=s.company_id and l.settlement_id=s.settlement_id) total_quantity
    from public.erp_supplier_settlements s join public.erp_supplier_providers p on p.company_id=s.company_id and p.provider_id=s.provider_id
    left join public.erp_supplier_accounts_payable a on a.company_id=s.company_id and a.payable_id=s.payable_id
    left join public.erp_financial_journal_entries j on j.company_id=s.company_id and j.journal_entry_id=s.journal_entry_id
    where s.company_id=p_company_id and s.period_end between p_date_from and p_date_to
      and (p_provider_id is null or s.provider_id=p_provider_id)
      and (nullif(upper(btrim(p_status)),'') is null or s.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or s.settlement_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(btrim(p_search),'') is null or concat_ws(' ',s.settlement_code,p.legal_name,p.commercial_name,p.tax_id,s.notes) ilike '%'||btrim(p_search)||'%')
  ), page as (select * from filtered order by period_end desc,settlement_code desc limit p_limit offset p_offset)
  select coalesce(jsonb_agg(jsonb_build_object('id',settlement_id,'settlementId',settlement_id,'settlementCode',settlement_code,
    'providerId',provider_id,'providerName',provider_name,'providerRuc',provider_ruc,'periodStart',period_start,'periodEnd',period_end,
    'settlementMethod',settlement_method,'grossTotal',gross_total,'discountTotal',discount_total,'adjustmentTotal',adjustment_total,
    'total',total,'status',status,'payableId',payable_id,'payableStatus',payable_status,'payableBalance',payable_balance,
    'journalEntryId',journal_entry_id,'journalEntryNumber',journal_entry_number,'lineCount',line_count,'totalQuantity',total_quantity,
    'postedAt',posted_at,'updatedAt',coalesce(reversed_at,posted_at,created_at)) order by period_end desc,settlement_code desc),'[]') into v_items from page;
  with filtered as (
    select s.* from public.erp_supplier_settlements s join public.erp_supplier_providers p on p.company_id=s.company_id and p.provider_id=s.provider_id
    where s.company_id=p_company_id and s.period_end between p_date_from and p_date_to and (p_provider_id is null or s.provider_id=p_provider_id)
      and (nullif(upper(btrim(p_status)),'') is null or s.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or s.settlement_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(btrim(p_search),'') is null or concat_ws(' ',s.settlement_code,p.legal_name,p.commercial_name,p.tax_id,s.notes) ilike '%'||btrim(p_search)||'%')
  ) select count(*),jsonb_build_object('settlements',count(*),'grossTotal',coalesce(sum(gross_total),0),'discountTotal',coalesce(sum(discount_total),0),
    'adjustmentTotal',coalesce(sum(adjustment_total),0),'netTotal',coalesce(sum(total),0),'posted',count(*)filter(where status='POSTED'),
    'reversed',count(*)filter(where status='REVERSED')) into v_total,v_summary from filtered;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset,'dateField','period_end');
end $$;

create or replace function public.erp_supplier_settlement_detail(p_company_id uuid,p_settlement_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_settlement jsonb;v_lines jsonb;v_allocations jsonb;v_payable jsonb:='null';v_journal jsonb:='null';
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  select to_jsonb(s)||jsonb_build_object('provider',to_jsonb(p)) into v_settlement
  from public.erp_supplier_settlements s join public.erp_supplier_providers p on p.company_id=s.company_id and p.provider_id=s.provider_id
  where s.company_id=p_company_id and s.settlement_id=p_settlement_id;
  if v_settlement is null then raise exception using errcode='P0002',message='SUPPLIER_SETTLEMENT_NOT_FOUND';end if;
  select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('reception',jsonb_build_object('id',r.record_id,'date',r.payload->>'date',
    'supplier',r.payload->>'supplier','providerId',r.payload->>'providerId','block',r.payload->>'block','status',r.payload->>'status'))
    order by l.reception_id,l.reception_item_id),'[]') into v_lines
  from public.erp_supplier_settlement_lines l left join public.erp_entity_records r on r.company_id=l.company_id and r.entity='operations_receptions'
    and r.record_id=l.reception_id and r.deleted_at is null where l.company_id=p_company_id and l.settlement_id=p_settlement_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.reception_id,a.reception_item_id),'[]') into v_allocations
  from public.erp_supplier_reception_cost_allocations a where a.company_id=p_company_id and a.source_type='SUPPLIER_SETTLEMENT' and a.source_id=p_settlement_id;
  select to_jsonb(a) into v_payable from public.erp_supplier_accounts_payable a
  where a.company_id=p_company_id and a.payable_id=(v_settlement->>'payable_id')::uuid;
  select jsonb_build_object('id',j.journal_entry_id,'number',j.entry_number,'accountingDate',j.accounting_date,'status',j.status,
    'concept',j.concept,'totalDebit',j.total_debit,'totalCredit',j.total_credit) into v_journal
  from public.erp_financial_journal_entries j where j.company_id=p_company_id and j.journal_entry_id=(v_settlement->>'journal_entry_id')::uuid;
  return jsonb_build_object('ok',true,'settlement',v_settlement,'lines',v_lines,'allocations',v_allocations,
    'payable',coalesce(v_payable,'null'),'journal',coalesce(v_journal,'null'));
end $$;

revoke all on function public.erp_supplier_settlement_read_health(uuid) from public,anon;
revoke all on function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) from public,anon;
revoke all on function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_supplier_settlement_detail(uuid,uuid) from public,anon;
grant execute on function public.erp_supplier_settlement_read_health(uuid) to authenticated;
grant execute on function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) to authenticated;
grant execute on function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) to authenticated;
grant execute on function public.erp_supplier_settlement_detail(uuid,uuid) to authenticated;
