begin;

-- FASE 6: expediente logístico canónico. Depende de las fases 1-5 y no
-- contabiliza, factura ni transmite información a SRI/ECUAPASS.

create table if not exists public.erp_export_shipment_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, calendar_year)
);

create table if not exists public.erp_export_shipment_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null,
  shipment_code text not null,
  customer_id text not null,
  invoice_id text,
  electronic_document_id text,
  destination_country text not null default '',
  destination_name text not null default '',
  cargo_agency_id text,
  airline_id text,
  origin_airport text not null default 'UIO',
  destination_airport text not null default '',
  planned_departure_at timestamptz,
  status text not null default 'DRAFT' check (status in (
    'DRAFT','DOCUMENTATION_PENDING','DOCUMENTATION_COMPLETE','READY_FOR_CARGO',
    'DELIVERED_TO_CARGO','BOOKED','DEPARTED','ARRIVED','CLOSED','REOPENED','CANCELLED'
  )),
  required_document_types text[] not null default '{}'::text[],
  dae jsonb not null default '{}'::jsonb,
  waybills jsonb not null default '{}'::jsonb,
  flight jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{"source":"PENDING","net":0,"gross":0,"volumetric":0}'::jsonb,
  logistics jsonb not null default '{}'::jsonb,
  observations text not null default '',
  delivered_to_cargo_at timestamptz,
  delivered_to_cargo_by uuid references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, shipment_id),
  unique (company_id, shipment_code)
);

create table if not exists public.erp_export_shipment_order_links (
  company_id uuid not null,
  shipment_id uuid not null,
  order_id text not null,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  primary key (company_id, shipment_id, order_id),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create table if not exists public.erp_export_shipment_dispatch_links (
  company_id uuid not null,
  shipment_id uuid not null,
  dispatch_id uuid not null,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  primary key (company_id, shipment_id, dispatch_id),
  unique (company_id, dispatch_id),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict,
  foreign key (company_id, dispatch_id)
    references public.erp_dispatch_registry(company_id, dispatch_id) on delete restrict
);

create table if not exists public.erp_export_shipment_box_links (
  company_id uuid not null,
  shipment_id uuid not null,
  box_id uuid not null,
  net_weight numeric(14,4),
  gross_weight numeric(14,4),
  volumetric_weight numeric(14,4),
  weight_source text not null default 'PENDING' check (weight_source in ('PENDING','BOX_SCALE','MANUAL_BOX','MANUAL_SHIPMENT')),
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  primary key (company_id, shipment_id, box_id),
  unique (company_id, box_id),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict,
  foreign key (company_id, box_id)
    references public.erp_order_box_registry(company_id, box_id) on delete restrict
);

create table if not exists public.erp_export_shipment_documents (
  company_id uuid not null,
  document_id uuid not null,
  shipment_id uuid not null,
  document_type text not null,
  status text not null default 'PENDING' check (status in ('PENDING','AVAILABLE','VALIDATED','REJECTED','EXPIRED','ANNULLED')),
  reference text not null default '',
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, document_id),
  unique (company_id, shipment_id, document_type),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create table if not exists public.erp_export_shipment_flight_history (
  company_id uuid not null,
  flight_revision_id uuid not null,
  shipment_id uuid not null,
  revision integer not null check (revision > 0),
  airline_id text,
  flight_number text not null default '',
  planned_departure_at timestamptz,
  origin_airport text not null default '',
  destination_airport text not null default '',
  connections jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED','CANCELLED','DEPARTED','ARRIVED')),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  operation_id uuid not null,
  primary key (company_id, flight_revision_id),
  unique (company_id, shipment_id, revision),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create unique index if not exists erp_export_shipment_active_flight_idx
  on public.erp_export_shipment_flight_history(company_id, shipment_id)
  where status = 'ACTIVE';

create table if not exists public.erp_export_shipment_events (
  company_id uuid not null,
  event_id uuid not null,
  shipment_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  operation_id uuid not null,
  device_id text not null,
  primary key (company_id, event_id),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create index if not exists erp_export_shipment_status_idx
  on public.erp_export_shipment_registry(company_id, status, planned_departure_at desc);
create index if not exists erp_export_shipment_order_idx
  on public.erp_export_shipment_order_links(company_id, order_id);
create index if not exists erp_export_shipment_document_idx
  on public.erp_export_shipment_documents(company_id, shipment_id, status);
create index if not exists erp_export_shipment_event_idx
  on public.erp_export_shipment_events(company_id, shipment_id, occurred_at desc);

alter table public.erp_export_shipment_sequence_counters enable row level security;
alter table public.erp_export_shipment_registry enable row level security;
alter table public.erp_export_shipment_order_links enable row level security;
alter table public.erp_export_shipment_dispatch_links enable row level security;
alter table public.erp_export_shipment_box_links enable row level security;
alter table public.erp_export_shipment_documents enable row level security;
alter table public.erp_export_shipment_flight_history enable row level security;
alter table public.erp_export_shipment_events enable row level security;

revoke all on table
  public.erp_export_shipment_sequence_counters,
  public.erp_export_shipment_registry,
  public.erp_export_shipment_order_links,
  public.erp_export_shipment_dispatch_links,
  public.erp_export_shipment_box_links,
  public.erp_export_shipment_documents,
  public.erp_export_shipment_flight_history,
  public.erp_export_shipment_events
from anon, authenticated;
grant select on table
  public.erp_export_shipment_sequence_counters,
  public.erp_export_shipment_registry,
  public.erp_export_shipment_order_links,
  public.erp_export_shipment_dispatch_links,
  public.erp_export_shipment_box_links,
  public.erp_export_shipment_documents,
  public.erp_export_shipment_flight_history,
  public.erp_export_shipment_events
to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'erp_export_shipment_sequence_counters','erp_export_shipment_registry',
    'erp_export_shipment_order_links','erp_export_shipment_dispatch_links',
    'erp_export_shipment_box_links','erp_export_shipment_documents',
    'erp_export_shipment_flight_history','erp_export_shipment_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_member_select', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_company_memberships membership where membership.company_id = %I.company_id and membership.user_id = auth.uid() and membership.membership_status = ''ACTIVE''))',
      v_table || '_member_select', v_table, v_table
    );
  end loop;
end;
$$;

create or replace function public.erp_export_v2_assert_access(p_company_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.erp_dispatch_v2_assert_access(p_company_id);
end;
$$;

create or replace function public.erp_export_v2_next_code(p_company_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_year integer := extract(year from (clock_timestamp() at time zone 'America/Guayaquil'))::integer;
  v_value bigint;
begin
  insert into public.erp_export_shipment_sequence_counters(company_id, calendar_year, last_value, updated_at)
  values (p_company_id, v_year, 1, clock_timestamp())
  on conflict (company_id, calendar_year) do update set
    last_value = erp_export_shipment_sequence_counters.last_value + 1,
    updated_at = clock_timestamp()
  returning last_value into v_value;
  return format('EXP-%s-%s', v_year, lpad(v_value::text, 6, '0'));
end;
$$;

create or replace function public.erp_export_v2_write_event(
  p_company_id uuid, p_operation_id uuid, p_device_id text, p_shipment_id uuid,
  p_event_type text, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id uuid := gen_random_uuid(); v_saved jsonb;
begin
  insert into public.erp_export_shipment_events(
    company_id,event_id,shipment_id,event_type,payload,occurred_at,user_id,operation_id,device_id
  ) values (
    p_company_id,v_event_id,p_shipment_id,upper(btrim(p_event_type)),coalesce(p_payload,'{}'::jsonb),
    clock_timestamp(),auth.uid(),p_operation_id,p_device_id
  );
  v_saved := public.erp_operations_v2_write_record(
    p_company_id,p_operation_id,p_device_id,'commercial_export_shipment_events',v_event_id::text,
    jsonb_build_object('id',v_event_id::text,'eventId',v_event_id::text,'shipmentId',p_shipment_id::text,
      'eventType',upper(btrim(p_event_type)),'payload',coalesce(p_payload,'{}'::jsonb),
      'occurredAt',clock_timestamp(),'operationId',p_operation_id::text,'syncFlow','EXPORT_V2'),0
  );
  return v_saved;
end;
$$;

create or replace function public.erp_export_v2_canonical_records(
  p_company_id uuid, p_operation_id uuid, p_device_id text, p_shipment_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shipment public.erp_export_shipment_registry%rowtype;
  v_record public.erp_entity_records%rowtype;
  v_document public.erp_export_shipment_documents%rowtype;
  v_flight public.erp_export_shipment_flight_history%rowtype;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_orders jsonb; v_dispatches jsonb; v_boxes jsonb; v_documents jsonb; v_flights jsonb;
begin
  select * into v_shipment from public.erp_export_shipment_registry shipment
  where shipment.company_id=p_company_id and shipment.shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002', message='EXPORT_V2_SHIPMENT_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(order_id order by order_id),'[]'::jsonb) into v_orders
    from public.erp_export_shipment_order_links where company_id=p_company_id and shipment_id=p_shipment_id;
  select coalesce(jsonb_agg(dispatch_id::text order by dispatch_id::text),'[]'::jsonb) into v_dispatches
    from public.erp_export_shipment_dispatch_links where company_id=p_company_id and shipment_id=p_shipment_id;
  select coalesce(jsonb_agg(jsonb_build_object('boxId',box.box_id::text,'boxCode',box.box_code,
    'netWeight',link.net_weight,'grossWeight',link.gross_weight,'volumetricWeight',link.volumetric_weight,
    'weightSource',link.weight_source) order by box.box_number),'[]'::jsonb) into v_boxes
    from public.erp_export_shipment_box_links link join public.erp_order_box_registry box
      on box.company_id=link.company_id and box.box_id=link.box_id
    where link.company_id=p_company_id and link.shipment_id=p_shipment_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',document_id::text,'type',document_type,'status',status,
    'reference',reference,'storagePath',storage_path,'metadata',metadata,'updatedAt',updated_at)
    order by document_type),'[]'::jsonb) into v_documents
    from public.erp_export_shipment_documents where company_id=p_company_id and shipment_id=p_shipment_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',flight_revision_id::text,'revision',revision,'airlineId',airline_id,
    'flightNumber',flight_number,'plannedDepartureAt',planned_departure_at,'originAirport',origin_airport,
    'destinationAirport',destination_airport,'connections',connections,'status',status,'changedAt',changed_at)
    order by revision),'[]'::jsonb) into v_flights
    from public.erp_export_shipment_flight_history where company_id=p_company_id and shipment_id=p_shipment_id;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id,p_operation_id,p_device_id,'commercial_export_shipments',p_shipment_id::text,
    jsonb_build_object(
      'id',p_shipment_id::text,'shipmentId',p_shipment_id::text,'shipmentCode',v_shipment.shipment_code,
      'customerId',v_shipment.customer_id,'invoiceId',v_shipment.invoice_id,
      'electronicDocumentId',v_shipment.electronic_document_id,'destinationCountry',v_shipment.destination_country,
      'destination',v_shipment.destination_name,'cargoAgencyId',v_shipment.cargo_agency_id,
      'airlineId',v_shipment.airline_id,'originAirport',v_shipment.origin_airport,
      'destinationAirport',v_shipment.destination_airport,'plannedDepartureAt',v_shipment.planned_departure_at,
      'status',v_shipment.status,'requiredDocumentTypes',to_jsonb(v_shipment.required_document_types),
      'dae',v_shipment.dae,'waybills',v_shipment.waybills,'flight',v_shipment.flight,
      'weights',v_shipment.weights,'logistics',v_shipment.logistics,'observations',v_shipment.observations,
      'orderIds',v_orders,'dispatchIds',v_dispatches,'boxes',v_boxes,'documents',v_documents,'flightHistory',v_flights,
      'deliveredToCargoAt',v_shipment.delivered_to_cargo_at,'closedAt',v_shipment.closed_at,
      'reopenedAt',v_shipment.reopened_at,'reopenReason',v_shipment.reopen_reason,
      'createdAt',v_shipment.created_at,'updatedAtServer',v_shipment.updated_at,'version',v_shipment.version,
      'syncFlow','EXPORT_V2'
    ),coalesce((select version from public.erp_entity_records where company_id=p_company_id
      and entity='commercial_export_shipments' and record_id=p_shipment_id::text),0)
  );
  v_records := v_records || jsonb_build_array(v_saved);

  for v_document in select * from public.erp_export_shipment_documents document
    where document.company_id=p_company_id and document.shipment_id=p_shipment_id order by document.document_type
  loop
    v_saved := public.erp_operations_v2_write_record(
      p_company_id,p_operation_id,p_device_id,'commercial_export_shipment_documents',v_document.document_id::text,
      jsonb_build_object('id',v_document.document_id::text,'documentId',v_document.document_id::text,
        'shipmentId',p_shipment_id::text,'type',v_document.document_type,'status',v_document.status,
        'reference',v_document.reference,'storagePath',v_document.storage_path,'metadata',v_document.metadata,
        'createdAt',v_document.created_at,'updatedAtServer',v_document.updated_at,'syncFlow','EXPORT_V2'),
      coalesce((select version from public.erp_entity_records where company_id=p_company_id
        and entity='commercial_export_shipment_documents' and record_id=v_document.document_id::text),0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;
  for v_flight in select * from public.erp_export_shipment_flight_history flight
    where flight.company_id=p_company_id and flight.shipment_id=p_shipment_id order by flight.revision
  loop
    v_saved := public.erp_operations_v2_write_record(
      p_company_id,p_operation_id,p_device_id,'commercial_export_shipment_flights',v_flight.flight_revision_id::text,
      jsonb_build_object('id',v_flight.flight_revision_id::text,'flightRevisionId',v_flight.flight_revision_id::text,
        'shipmentId',p_shipment_id::text,'revision',v_flight.revision,'airlineId',v_flight.airline_id,
        'flightNumber',v_flight.flight_number,'plannedDepartureAt',v_flight.planned_departure_at,
        'originAirport',v_flight.origin_airport,'destinationAirport',v_flight.destination_airport,
        'connections',v_flight.connections,'status',v_flight.status,'changedAt',v_flight.changed_at,
        'operationId',v_flight.operation_id::text,'syncFlow','EXPORT_V2'),
      coalesce((select version from public.erp_entity_records where company_id=p_company_id
        and entity='commercial_export_shipment_flights' and record_id=v_flight.flight_revision_id::text),0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  for v_record in select record.* from public.erp_entity_records record
    join public.erp_export_shipment_order_links link on link.company_id=record.company_id
      and link.order_id=record.record_id and link.shipment_id=p_shipment_id
    where record.company_id=p_company_id and record.entity='commercial_orders' and record.deleted_at is null for update
  loop
    v_saved := public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,
      'commercial_orders',v_record.record_id,v_record.payload || jsonb_build_object(
        'exportShipmentId',p_shipment_id::text,'exportShipmentCode',v_shipment.shipment_code,
        'exportShipmentStatus',v_shipment.status,'daeNumber',coalesce(v_shipment.dae->>'number',v_record.payload->>'daeNumber',''),
        'awb',coalesce(v_shipment.waybills->>'mawb',v_record.payload->>'awb',''),
        'hawb',coalesce(v_shipment.waybills->>'hawb',v_record.payload->>'hawb',''),
        'airlineId',coalesce(v_shipment.airline_id,v_record.payload->>'airlineId',''),
        'agencyId',coalesce(v_shipment.cargo_agency_id,v_record.payload->>'agencyId',''),
        'flightNumber',coalesce(v_shipment.flight->>'flightNumber',v_record.payload->>'flightNumber',''),
        'flightDate',coalesce(to_char(v_shipment.planned_departure_at at time zone 'America/Guayaquil','YYYY-MM-DD'),v_record.payload->>'flightDate',''),
        'syncFlowExport','EXPORT_V2'),v_record.version);
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;
  for v_record in select record.* from public.erp_entity_records record
    join public.erp_export_shipment_dispatch_links link on link.company_id=record.company_id
      and link.dispatch_id::text=record.record_id and link.shipment_id=p_shipment_id
    where record.company_id=p_company_id and record.entity='operations_dispatch_records' and record.deleted_at is null for update
  loop
    v_saved := public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,
      'operations_dispatch_records',v_record.record_id,v_record.payload || jsonb_build_object(
        'exportShipmentId',p_shipment_id::text,'exportShipmentCode',v_shipment.shipment_code,
        'exportShipmentStatus',v_shipment.status,'syncFlowExport','EXPORT_V2'),v_record.version);
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;
  return v_records;
end;
$$;

create or replace function public.erp_export_v2_refresh_documentation_status(
  p_company_id uuid, p_shipment_id uuid
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_missing integer; v_status text;
begin
  select count(*) into v_missing from unnest((select required_document_types
    from public.erp_export_shipment_registry where company_id=p_company_id and shipment_id=p_shipment_id)) required(type)
  where not exists (select 1 from public.erp_export_shipment_documents document
    where document.company_id=p_company_id and document.shipment_id=p_shipment_id
      and document.document_type=upper(required.type) and document.status in ('AVAILABLE','VALIDATED'));
  select status into v_status from public.erp_export_shipment_registry
    where company_id=p_company_id and shipment_id=p_shipment_id for update;
  if v_status in ('DRAFT','DOCUMENTATION_PENDING','DOCUMENTATION_COMPLETE','READY_FOR_CARGO','REOPENED') then
    v_status := case
      when v_missing>0 then 'DOCUMENTATION_PENDING'
      when nullif((select cargo_agency_id from public.erp_export_shipment_registry
        where company_id=p_company_id and shipment_id=p_shipment_id),'') is not null
        and exists(select 1 from public.erp_export_shipment_box_links
          where company_id=p_company_id and shipment_id=p_shipment_id)
        then 'READY_FOR_CARGO'
      else 'DOCUMENTATION_COMPLETE'
    end;
    update public.erp_export_shipment_registry set status=v_status,updated_at=clock_timestamp(),
      updated_by=auth.uid(),version=version+1 where company_id=p_company_id and shipment_id=p_shipment_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.erp_export_v2_create(
  p_operation_id uuid, p_company_id uuid, p_device_id text,
  p_order_ids text[], p_dispatch_ids uuid[], p_required_document_types text[] default '{}'::text[],
  p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.erp_operations_commands%rowtype; v_order public.erp_entity_records%rowtype;
  v_dispatch public.erp_dispatch_registry%rowtype; v_shipment public.erp_export_shipment_registry%rowtype;
  v_order_id text; v_dispatch_id uuid; v_customer text; v_country text; v_destination text;
  v_invoice_id text; v_electronic_document_id text;
  v_records jsonb; v_event jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
  perform public.erp_export_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null
     or coalesce(array_length(p_order_ids,1),0)=0 or coalesce(array_length(p_dispatch_ids,1),0)=0 then
    raise exception using errcode='22023', message='EXPORT_V2_CREATE_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands command
    where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':EXPORT:'||array_to_string(p_dispatch_ids,','),0));
  foreach v_order_id in array p_order_ids loop
    select * into v_order from public.erp_entity_records record where record.company_id=p_company_id
      and record.entity='commercial_orders' and record.record_id=v_order_id and record.deleted_at is null for update;
    if not found or upper(coalesce(v_order.payload->>'dispatchStatus',v_order.payload->>'status',''))<>'DISPATCHED' then
      raise exception using errcode='23514', message='EXPORT_V2_ORDER_NOT_DISPATCHED:'||v_order_id;
    end if;
    if v_customer is null then
      v_customer:=coalesce(v_order.payload->>'customerId','');
      v_country:=coalesce(v_order.payload->>'destinationCountry','');
      v_destination:=coalesce(v_order.payload->>'destination','');
      v_invoice_id:=nullif(coalesce(v_order.payload->>'invoiceId',v_order.payload->>'invoiceNumber',''),'');
      v_electronic_document_id:=nullif(coalesce(v_order.payload->>'electronicDocumentId',v_order.payload->>'sriDocumentId',''),'');
    elsif v_customer is distinct from coalesce(v_order.payload->>'customerId','') then
      raise exception using errcode='23514', message='EXPORT_V2_MULTIPLE_CUSTOMERS_NOT_ALLOWED';
    end if;
  end loop;
  foreach v_dispatch_id in array p_dispatch_ids loop
    select * into v_dispatch from public.erp_dispatch_registry dispatch where dispatch.company_id=p_company_id
      and dispatch.dispatch_id=v_dispatch_id for update;
    if not found or v_dispatch.status<>'DISPATCHED' then
      raise exception using errcode='23514', message='EXPORT_V2_DISPATCH_NOT_CONFIRMED:'||v_dispatch_id::text;
    end if;
    if not (v_dispatch.order_id=any(p_order_ids)) then
      raise exception using errcode='23514', message='EXPORT_V2_DISPATCH_ORDER_MISMATCH';
    end if;
    if exists(select 1 from public.erp_export_shipment_dispatch_links link
      where link.company_id=p_company_id and link.dispatch_id=v_dispatch_id) then
      raise exception using errcode='23505', message='EXPORT_V2_DISPATCH_ALREADY_LINKED:'||v_dispatch_id::text;
    end if;
  end loop;
  insert into public.erp_export_shipment_registry(
    company_id,shipment_id,shipment_code,customer_id,invoice_id,electronic_document_id,destination_country,destination_name,
    required_document_types,status,created_at,created_by,updated_at,updated_by,last_operation_id
  ) values (
    p_company_id,gen_random_uuid(),public.erp_export_v2_next_code(p_company_id),v_customer,v_invoice_id,v_electronic_document_id,
    coalesce(v_country,''),coalesce(v_destination,v_country,''),
    array(select distinct upper(btrim(value)) from unnest(coalesce(p_required_document_types,'{}'::text[])) value where btrim(value)<>''),
    'DRAFT',v_now,auth.uid(),v_now,auth.uid(),p_operation_id
  ) returning * into v_shipment;
  insert into public.erp_export_shipment_order_links(company_id,shipment_id,order_id,linked_at,linked_by)
    select p_company_id,v_shipment.shipment_id,value,v_now,auth.uid() from unnest(p_order_ids) value;
  insert into public.erp_export_shipment_dispatch_links(company_id,shipment_id,dispatch_id,linked_at,linked_by)
    select p_company_id,v_shipment.shipment_id,value,v_now,auth.uid() from unnest(p_dispatch_ids) value;
  insert into public.erp_export_shipment_box_links(company_id,shipment_id,box_id,linked_at,linked_by)
    select p_company_id,v_shipment.shipment_id,box.box_id,v_now,auth.uid()
    from public.erp_order_box_registry box where box.company_id=p_company_id
      and box.dispatch_id=any(p_dispatch_ids) and box.status='DISPATCHED';
  v_records:=public.erp_export_v2_canonical_records(p_company_id,p_operation_id,p_device_id,v_shipment.shipment_id);
  v_event:=public.erp_export_v2_write_event(p_company_id,p_operation_id,p_device_id,v_shipment.shipment_id,
    'SHIPMENT_CREATED',jsonb_build_object('orderIds',to_jsonb(p_order_ids),'dispatchIds',to_jsonb(p_dispatch_ids)));
  v_records:=v_records||jsonb_build_array(v_event);
  v_result:=jsonb_build_object('ok',true,'command','CREATE_EXPORT_SHIPMENT','operationId',p_operation_id,
    'serverTime',v_now,'records',v_records,'result',jsonb_build_object('status','DRAFT',
      'shipmentId',v_shipment.shipment_id,'shipmentCode',v_shipment.shipment_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,
    request_payload,result,status,user_id,device_id,local_created_at)
  values(p_operation_id,p_company_id,'CREATE_EXPORT_SHIPMENT',v_shipment.shipment_id::text,
    jsonb_build_object('orderIds',to_jsonb(p_order_ids),'dispatchIds',to_jsonb(p_dispatch_ids)),
    v_result,'CONFIRMED',auth.uid(),p_device_id,coalesce(p_local_created_at,now()));
  return v_result;
end;
$$;

create or replace function public.erp_export_v2_update_logistics(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_shipment_id uuid,p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.erp_operations_commands%rowtype; v_shipment public.erp_export_shipment_registry%rowtype;
  v_document jsonb; v_document_id uuid; v_revision integer; v_records jsonb; v_saved jsonb;
  v_before jsonb; v_status text; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_mawb text;
begin
  perform public.erp_export_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null or p_shipment_id is null then
    raise exception using errcode='22023', message='EXPORT_V2_UPDATE_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':EXPORT:'||p_shipment_id::text,0));
  select * into v_shipment from public.erp_export_shipment_registry shipment
    where shipment.company_id=p_company_id and shipment.shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002', message='EXPORT_V2_SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status='CLOSED' then raise exception using errcode='23514', message='EXPORT_V2_CLOSED_IMMUTABLE'; end if;
  v_before:=to_jsonb(v_shipment);
  if nullif(p_payload->>'cargoAgencyId','') is not null and not exists(
    select 1 from public.erp_entity_records agency where agency.company_id=p_company_id
      and agency.entity='commercial_agencies' and agency.record_id=p_payload->>'cargoAgencyId' and agency.deleted_at is null
  ) then raise exception using errcode='23514', message='EXPORT_V2_CARGO_AGENCY_NOT_FOUND'; end if;
  if nullif(p_payload->>'airlineId','') is not null and not exists(
    select 1 from public.erp_entity_records airline where airline.company_id=p_company_id
      and airline.entity='commercial_airlines' and airline.record_id=p_payload->>'airlineId' and airline.deleted_at is null
  ) then raise exception using errcode='23514', message='EXPORT_V2_AIRLINE_NOT_FOUND'; end if;
  if nullif(p_payload#>>'{dae,catalogId}','') is not null and not exists(
    select 1 from public.erp_entity_records dae where dae.company_id=p_company_id
      and dae.entity='commercial_dae' and dae.record_id=p_payload#>>'{dae,catalogId}' and dae.deleted_at is null
  ) then raise exception using errcode='23514', message='EXPORT_V2_DAE_CATALOG_NOT_FOUND'; end if;
  v_mawb:=regexp_replace(coalesce(p_payload#>>'{waybills,mawb}',v_shipment.waybills->>'mawb',''),'[^0-9]','','g');
  if v_mawb<>'' and v_mawb!~'^\d{11}$' then raise exception using errcode='22023', message='EXPORT_V2_MAWB_FORMAT_INVALID'; end if;
  if v_mawb<>'' and nullif(coalesce(p_payload->>'airlineId',v_shipment.airline_id),'') is null then
    raise exception using errcode='23514', message='EXPORT_V2_AIRLINE_REQUIRED_FOR_MAWB'; end if;
  if v_mawb<>'' and not exists(select 1 from public.erp_entity_records airline
    where airline.company_id=p_company_id and airline.entity='commercial_airlines'
      and airline.record_id=coalesce(p_payload->>'airlineId',v_shipment.airline_id) and airline.deleted_at is null
      and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_mawb,3)) then
    raise exception using errcode='23514', message='EXPORT_V2_MAWB_PREFIX_AIRLINE_MISMATCH'; end if;
  update public.erp_export_shipment_registry set
    cargo_agency_id=coalesce(nullif(p_payload->>'cargoAgencyId',''),cargo_agency_id),
    airline_id=coalesce(nullif(p_payload->>'airlineId',''),airline_id),
    origin_airport=coalesce(nullif(upper(p_payload->>'originAirport'),''),origin_airport),
    destination_airport=coalesce(nullif(upper(p_payload->>'destinationAirport'),''),destination_airport),
    planned_departure_at=coalesce(nullif(p_payload->>'plannedDepartureAt','')::timestamptz,planned_departure_at),
    dae=case when p_payload?'dae' then coalesce(p_payload->'dae','{}'::jsonb) else dae end,
    waybills=case when p_payload?'waybills' then coalesce(p_payload->'waybills','{}'::jsonb)||jsonb_build_object('mawbDigits',v_mawb) else waybills end,
    flight=case when p_payload?'flight' then coalesce(p_payload->'flight','{}'::jsonb) else flight end,
    weights=case when p_payload?'weights' then coalesce(p_payload->'weights','{}'::jsonb) else weights end,
    logistics=logistics||coalesce(p_payload->'logistics','{}'::jsonb),
    observations=coalesce(p_payload->>'observations',observations),updated_at=v_now,updated_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id
  where company_id=p_company_id and shipment_id=p_shipment_id returning * into v_shipment;
  if p_payload?'flight' and coalesce(p_payload#>>'{flight,flightNumber}','') is distinct from coalesce(v_before#>>'{flight,flightNumber}','') then
    update public.erp_export_shipment_flight_history set status='SUPERSEDED'
      where company_id=p_company_id and shipment_id=p_shipment_id and status='ACTIVE';
    select coalesce(max(revision),0)+1 into v_revision from public.erp_export_shipment_flight_history
      where company_id=p_company_id and shipment_id=p_shipment_id;
    insert into public.erp_export_shipment_flight_history(company_id,flight_revision_id,shipment_id,revision,
      airline_id,flight_number,planned_departure_at,origin_airport,destination_airport,connections,status,changed_at,changed_by,operation_id)
    values(p_company_id,gen_random_uuid(),p_shipment_id,v_revision,v_shipment.airline_id,
      coalesce(p_payload#>>'{flight,flightNumber}',''),v_shipment.planned_departure_at,
      v_shipment.origin_airport,v_shipment.destination_airport,coalesce(p_payload#>'{flight,connections}','[]'::jsonb),
      'ACTIVE',v_now,auth.uid(),p_operation_id);
  end if;
  for v_document in select value from jsonb_array_elements(coalesce(p_payload->'documents','[]'::jsonb)) loop
    if nullif(upper(btrim(v_document->>'type')),'') is null then continue; end if;
    select document_id into v_document_id from public.erp_export_shipment_documents document
      where document.company_id=p_company_id and document.shipment_id=p_shipment_id
        and document.document_type=upper(btrim(v_document->>'type')) for update;
    if v_document_id is null then v_document_id:=gen_random_uuid(); end if;
    insert into public.erp_export_shipment_documents(company_id,document_id,shipment_id,document_type,status,
      reference,storage_path,metadata,created_at,created_by,updated_at,updated_by,last_operation_id)
    values(p_company_id,v_document_id,p_shipment_id,upper(btrim(v_document->>'type')),
      upper(coalesce(nullif(v_document->>'status',''),'PENDING')),coalesce(v_document->>'reference',''),
      nullif(v_document->>'storagePath',''),coalesce(v_document->'metadata','{}'::jsonb),v_now,auth.uid(),v_now,auth.uid(),p_operation_id)
    on conflict(company_id,shipment_id,document_type) do update set status=excluded.status,
      reference=excluded.reference,storage_path=excluded.storage_path,metadata=excluded.metadata,
      updated_at=v_now,updated_by=auth.uid(),last_operation_id=p_operation_id;
  end loop;
  v_status:=public.erp_export_v2_refresh_documentation_status(p_company_id,p_shipment_id);
  v_records:=public.erp_export_v2_canonical_records(p_company_id,p_operation_id,p_device_id,p_shipment_id);
  v_saved:=public.erp_export_v2_write_event(p_company_id,p_operation_id,p_device_id,p_shipment_id,
    'LOGISTICS_UPDATED',jsonb_build_object('before',v_before,'after',p_payload,'status',v_status));
  v_records:=v_records||jsonb_build_array(v_saved);
  v_result:=jsonb_build_object('ok',true,'command','UPDATE_EXPORT_LOGISTICS','operationId',p_operation_id,
    'serverTime',v_now,'records',v_records,'result',jsonb_build_object('shipmentId',p_shipment_id,'status',v_status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,
    result,status,user_id,device_id,local_created_at) values(p_operation_id,p_company_id,'UPDATE_EXPORT_LOGISTICS',
    p_shipment_id::text,coalesce(p_payload,'{}'::jsonb),v_result,'CONFIRMED',auth.uid(),p_device_id,coalesce(p_local_created_at,now()));
  return v_result;
end;
$$;

create or replace function public.erp_export_v2_transition(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_shipment_id uuid,p_action text,
  p_payload jsonb default '{}'::jsonb,p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.erp_operations_commands%rowtype; v_shipment public.erp_export_shipment_registry%rowtype;
  v_missing integer; v_records jsonb; v_saved jsonb; v_result jsonb; v_action text:=upper(btrim(p_action));
  v_now timestamptz:=clock_timestamp();
begin
  perform public.erp_export_v2_assert_access(p_company_id);
  if p_operation_id is null or p_shipment_id is null or nullif(btrim(p_device_id),'') is null then
    raise exception using errcode='22023', message='EXPORT_V2_TRANSITION_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':EXPORT:'||p_shipment_id::text,0));
  select * into v_shipment from public.erp_export_shipment_registry shipment
    where shipment.company_id=p_company_id and shipment.shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002', message='EXPORT_V2_SHIPMENT_NOT_FOUND'; end if;
  if v_action='DELIVER_TO_CARGO' then
    if v_shipment.status='CLOSED' then raise exception using errcode='23514', message='EXPORT_V2_CLOSED_IMMUTABLE'; end if;
    if nullif(coalesce(p_payload->>'cargoAgencyId',v_shipment.cargo_agency_id),'') is null then
      raise exception using errcode='23514', message='EXPORT_V2_CARGO_AGENCY_REQUIRED'; end if;
    if not exists(select 1 from public.erp_entity_records agency where agency.company_id=p_company_id
      and agency.entity='commercial_agencies' and agency.record_id=coalesce(p_payload->>'cargoAgencyId',v_shipment.cargo_agency_id)
      and agency.deleted_at is null) then
      raise exception using errcode='23514', message='EXPORT_V2_CARGO_AGENCY_NOT_FOUND'; end if;
    if not exists(select 1 from public.erp_export_shipment_box_links where company_id=p_company_id and shipment_id=p_shipment_id) then
      raise exception using errcode='23514', message='EXPORT_V2_BOXES_REQUIRED'; end if;
    update public.erp_export_shipment_registry set status='DELIVERED_TO_CARGO',
      cargo_agency_id=coalesce(nullif(p_payload->>'cargoAgencyId',''),cargo_agency_id),
      delivered_to_cargo_at=v_now,delivered_to_cargo_by=auth.uid(),observations=coalesce(p_payload->>'observations',observations),
      updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and shipment_id=p_shipment_id;
  elsif v_action='CLOSE' then
    if v_shipment.status='CLOSED' then
      v_action:='ALREADY_CLOSED';
    else
      if v_shipment.status not in ('DELIVERED_TO_CARGO','BOOKED','DEPARTED','ARRIVED') then
        raise exception using errcode='23514', message='EXPORT_V2_CLOSE_STATE_INVALID'; end if;
      select count(*) into v_missing from unnest(v_shipment.required_document_types) required(type)
      where not exists(select 1 from public.erp_export_shipment_documents document
        where document.company_id=p_company_id and document.shipment_id=p_shipment_id
          and document.document_type=upper(required.type) and document.status in ('AVAILABLE','VALIDATED'));
      if v_missing>0 then raise exception using errcode='23514', message='EXPORT_V2_REQUIRED_DOCUMENTS_MISSING'; end if;
      if not exists(select 1 from public.erp_export_shipment_dispatch_links link
        join public.erp_dispatch_registry dispatch on dispatch.company_id=link.company_id and dispatch.dispatch_id=link.dispatch_id
        where link.company_id=p_company_id and link.shipment_id=p_shipment_id and dispatch.status='DISPATCHED') then
        raise exception using errcode='23514', message='EXPORT_V2_CONFIRMED_DISPATCH_REQUIRED'; end if;
      update public.erp_export_shipment_registry set status='CLOSED',closed_at=v_now,closed_by=auth.uid(),
        updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
        where company_id=p_company_id and shipment_id=p_shipment_id;
    end if;
  elsif v_action='REOPEN' then
    if v_shipment.status<>'CLOSED' or nullif(btrim(p_payload->>'reason'),'') is null then
      raise exception using errcode='23514', message='EXPORT_V2_REOPEN_REASON_AND_CLOSED_REQUIRED'; end if;
    update public.erp_export_shipment_registry set status='REOPENED',reopened_at=v_now,reopened_by=auth.uid(),
      reopen_reason=btrim(p_payload->>'reason'),closed_at=null,closed_by=null,updated_at=v_now,updated_by=auth.uid(),
      version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and shipment_id=p_shipment_id;
  elsif v_action in ('BOOK','DEPART','ARRIVE') then
    if v_shipment.status='CLOSED' then raise exception using errcode='23514', message='EXPORT_V2_CLOSED_IMMUTABLE'; end if;
    if v_action='BOOK' and (nullif(v_shipment.flight->>'flightNumber','') is null or v_shipment.planned_departure_at is null) then
      raise exception using errcode='23514', message='EXPORT_V2_FLIGHT_REQUIRED_FOR_BOOKING'; end if;
    if v_action='DEPART' and v_shipment.status not in ('BOOKED','DELIVERED_TO_CARGO') then
      raise exception using errcode='23514', message='EXPORT_V2_DEPART_STATE_INVALID'; end if;
    if v_action='ARRIVE' and v_shipment.status<>'DEPARTED' then
      raise exception using errcode='23514', message='EXPORT_V2_ARRIVE_STATE_INVALID'; end if;
    update public.erp_export_shipment_registry set
      status=case v_action when 'BOOK' then 'BOOKED' when 'DEPART' then 'DEPARTED' else 'ARRIVED' end,
      logistics=logistics||case v_action when 'BOOK' then jsonb_build_object('bookedAt',v_now)
        when 'DEPART' then jsonb_build_object('departedAt',v_now) else jsonb_build_object('arrivedAt',v_now) end,
      updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and shipment_id=p_shipment_id;
    if v_action in ('DEPART','ARRIVE') then
      update public.erp_export_shipment_flight_history set status=case v_action when 'DEPART' then 'DEPARTED' else 'ARRIVED' end,
        changed_at=v_now,changed_by=auth.uid(),operation_id=p_operation_id
        where company_id=p_company_id and shipment_id=p_shipment_id and status in ('ACTIVE','DEPARTED');
    end if;
  else
    raise exception using errcode='22023', message='EXPORT_V2_ACTION_INVALID';
  end if;
  v_records:=public.erp_export_v2_canonical_records(p_company_id,p_operation_id,p_device_id,p_shipment_id);
  v_saved:=public.erp_export_v2_write_event(p_company_id,p_operation_id,p_device_id,p_shipment_id,v_action,p_payload);
  v_records:=v_records||jsonb_build_array(v_saved);
  v_result:=jsonb_build_object('ok',true,'command',v_action,'operationId',p_operation_id,'serverTime',v_now,
    'records',v_records,'result',jsonb_build_object('shipmentId',p_shipment_id,'status',
      (select status from public.erp_export_shipment_registry where company_id=p_company_id and shipment_id=p_shipment_id)));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,
    result,status,user_id,device_id,local_created_at) values(p_operation_id,p_company_id,'EXPORT_'||v_action,
    p_shipment_id::text,coalesce(p_payload,'{}'::jsonb),v_result,'CONFIRMED',auth.uid(),p_device_id,coalesce(p_local_created_at,now()));
  return v_result;
end;
$$;

create or replace function public.erp_export_v2_health(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.erp_export_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'EXPORT_V2',
    'migration', '202608150008',
    'companyId', p_company_id,
    'sequenceTable', to_regclass('public.erp_export_shipment_sequence_counters') is not null,
    'shipmentTable', to_regclass('public.erp_export_shipment_registry') is not null,
    'orderLinksTable', to_regclass('public.erp_export_shipment_order_links') is not null,
    'dispatchLinksTable', to_regclass('public.erp_export_shipment_dispatch_links') is not null,
    'boxLinksTable', to_regclass('public.erp_export_shipment_box_links') is not null,
    'documentsTable', to_regclass('public.erp_export_shipment_documents') is not null,
    'flightHistoryTable', to_regclass('public.erp_export_shipment_flight_history') is not null,
    'eventsTable', to_regclass('public.erp_export_shipment_events') is not null,
    'operationsDependency', to_regprocedure('public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)') is not null,
    'dispatchDependency', to_regprocedure('public.erp_dispatch_v2_health(uuid)') is not null,
    'createRpc', to_regprocedure('public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz)') is not null,
    'updateRpc', to_regprocedure('public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz)') is not null,
    'transitionRpc', to_regprocedure('public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz)') is not null,
    'serverTime', clock_timestamp()
  );
end;
$$;

revoke all on function public.erp_export_v2_assert_access(uuid) from public,anon,authenticated;
revoke all on function public.erp_export_v2_next_code(uuid) from public,anon,authenticated;
revoke all on function public.erp_export_v2_write_event(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.erp_export_v2_canonical_records(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_export_v2_refresh_documentation_status(uuid,uuid) from public,anon,authenticated;
revoke all on function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) from public,anon;
revoke all on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_export_v2_health(uuid) from public,anon,authenticated;
grant execute on function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) to authenticated;
grant execute on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_export_v2_health(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
