-- Explicit commercial-document request only. Saving an order remains order-only.
create or replace function public.erp_commercial_reserve_invoice_for_documents(
  p_company_id uuid, p_order_id text, p_document_code text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_actor uuid:=auth.uid(); v_order jsonb; v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype; v_res public.commercial_invoice_reservations%rowtype;
  v_doc public.electronic_documents%rowtype; v_ep text; v_count integer; v_next bigint;
  v_number text; v_created boolean:=false;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id,v_actor) then
    raise exception 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  perform public.erp_security_assert_capability(p_company_id,'commercial.orders.view');
  perform public.erp_security_assert_capability(p_company_id,'commercial.electronic_documents.create');
  if p_document_code is null or p_document_code not in ('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT')
    or nullif(btrim(p_order_id),'') is null then raise exception 'COMMERCIAL_RESERVATION_INPUT_INVALID'; end if;
  -- Same lock order as create_electronic_document_draft: settings, point, invoice key.
  select * into v_settings from public.sri_settings where company_id=p_company_id for update;
  if not found or v_settings.environment not in ('TEST','PRODUCTION') then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
  select payload into v_order from public.erp_entity_records
    where company_id=p_company_id and entity='commercial_orders' and record_id=p_order_id and deleted_at is null for share;
  if not found or nullif(v_order->>'number','') is null or coalesce((v_order->>'unsavedDraft')::boolean,false)
    or coalesce((v_order->>'numberPending')::boolean,false) then raise exception 'COMMERCIAL_SAVED_ORDER_REQUIRED'; end if;
  if upper(coalesce(v_order->>'status','')) in ('ANULADO','CANCELLED','VOIDED') then raise exception 'COMMERCIAL_ORDER_CANCELLED'; end if;
  -- Reuse the validated LOCAL / EXPORT routing, deriving it from the saved order.
  v_ep:=case when coalesce(v_order->>'saleType','') ~* 'LOCAL'
    or coalesce(v_order->>'transportType','') ~* 'TERRESTRE|LOCAL' then '003' else '002' end;
  select count(*) into v_count from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active;
  if v_count<>1 then raise exception 'SRI_ACTIVE_EMISSION_POINT_REQUIRED'; end if;
  select * into v_point from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active for update;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':SRI_INVOICE:'||v_settings.environment||':'||p_order_id,0));
  select count(*) into v_count from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED');
  if v_count>1 then raise exception 'COMMERCIAL_INVOICE_RESERVATION_AMBIGUOUS'; end if;
  select * into v_res from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED') for update;
  if v_res.id is not null and (v_res.emission_point_id<>v_point.id or v_res.establishment_code<>'001' or v_res.emission_point_code<>v_ep) then
    raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
  if v_res.status='CONSUMED' then
    select * into v_doc from public.electronic_documents where id=v_res.consumed_document_id
      and company_id=p_company_id and environment=v_settings.environment and document_type='01';
    if not found then raise exception 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING'; end if;
  else
    select count(*) into v_count from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
    if v_count>1 then raise exception 'COMMERCIAL_INVOICE_DOCUMENT_AMBIGUOUS'; end if;
    select * into v_doc from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
  end if;
  if v_doc.id is not null then
    if v_doc.emission_point_id<>v_point.id or v_doc.establishment_code<>'001' or v_doc.emission_point_code<>v_ep
      or (v_res.id is not null and (v_res.full_number<>v_doc.full_number or v_res.sequential<>v_doc.sequential)) then
      raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
    v_number:=v_doc.full_number; v_next:=v_doc.sequential;
    -- Adopt an existing canonical document without touching it or the counter.
    -- This also makes the later Factura 01 retry use the existing consumed link.
    if v_res.id is null then
      insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
        establishment_code,emission_point_code,sequential,full_number,status,created_by,consumed_document_id,consumed_at)
        values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'CONSUMED',v_actor,v_doc.id,now())
        returning * into v_res;
    elsif v_res.status='ACTIVE' then
      update public.commercial_invoice_reservations set status='CONSUMED',consumed_document_id=v_doc.id,consumed_at=now(),updated_at=now()
        where id=v_res.id returning * into v_res;
    end if;
  elsif v_res.id is not null then
    v_number:=v_res.full_number; v_next:=v_res.sequential;
  else
    -- OFF remains OFF. Reading an existing identity does not enable issuance.
    if (v_settings.environment='TEST' and (not v_settings.test_enabled or v_settings.production_enabled))
      or (v_settings.environment='PRODUCTION' and not v_settings.production_enabled) then
      raise exception 'SRI_ENVIRONMENT_RESERVATION_DISABLED'; end if;
    insert into public.electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value,updated_by)
      values(p_company_id,v_point.id,v_settings.environment,'01',1,v_actor)
      on conflict(company_id,emission_point_id,environment,document_type) do nothing;
    select next_value into v_next from public.electronic_document_sequences where company_id=p_company_id
      and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01' for update;
    if v_next is null or v_next<1 or v_next>999999999 then raise exception 'SRI_SEQUENTIAL_EXHAUSTED'; end if;
    v_number:='001-'||v_ep||'-'||lpad(v_next::text,9,'0');
    update public.electronic_document_sequences set next_value=v_next+1,updated_by=v_actor
      where company_id=p_company_id and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01';
    insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by)
      values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'ACTIVE',v_actor) returning * into v_res;
    v_created:=true;
  end if;
  if v_number is distinct from '001-'||v_ep||'-'||lpad(v_next::text,9,'0') then raise exception 'COMMERCIAL_INVOICE_IDENTITY_INVALID'; end if;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'orderId',p_order_id,'orderNumber',v_order->>'number',
    'environment',v_settings.environment,'documentType','01','emissionPointId',v_point.id,
    'establishmentCode','001','emissionPointCode',v_ep,'sequential',lpad(v_next::text,9,'0'),'fullNumber',v_number,
    'reservationId',v_res.id,'documentId',v_doc.id,'status',case when v_doc.id is not null then 'DOCUMENT' else 'ACTIVE' end,
    'created',v_created,'reused',not v_created);
end;
$function$;
revoke all on function public.erp_commercial_reserve_invoice_for_documents(uuid,text,text) from public,anon,service_role;
grant execute on function public.erp_commercial_reserve_invoice_for_documents(uuid,text,text) to authenticated;
