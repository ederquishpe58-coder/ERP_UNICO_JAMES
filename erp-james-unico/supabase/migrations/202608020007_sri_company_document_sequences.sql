begin;

-- La numeracion SRI se separa por empresa, ambiente, punto de emision y tipo
-- de comprobante. Esta migracion se prepara para Supabase, pero no se aplica
-- automaticamente desde el navegador ni expone permisos de escritura al cliente.

alter table public.electronic_document_sequences
  drop constraint if exists electronic_document_sequences_type_check;

alter table public.electronic_document_sequences
  add constraint electronic_document_sequences_type_check check (
    document_type in ('01', '04', '06', '07')
  );

-- Bless Flower: series confirmadas por el usuario al 02-08-2026.
-- Factura: ultimo 001-003-000000674; siguiente 000000675.
-- Retencion: ultimo 001-002-000000686; siguiente 000000687.
insert into public.emission_points (
  company_id,
  environment,
  establishment_code,
  emission_point_code,
  establishment_address,
  name,
  active
)
select
  settings.company_id,
  'TEST',
  point.establishment_code,
  point.emission_point_code,
  settings.head_office_address,
  point.name,
  true
from public.sri_settings settings
cross join (
  values
    ('001'::text, '003'::text, 'Facturas de venta'),
    ('001'::text, '002'::text, 'Comprobantes de retencion')
) as point(establishment_code, emission_point_code, name)
where settings.company_id = '10000000-0000-4000-8000-000000000001'::uuid
  and settings.environment = 'TEST'
on conflict (company_id, environment, establishment_code, emission_point_code)
do update set
  establishment_address = excluded.establishment_address,
  name = excluded.name,
  active = true,
  updated_at = now();

insert into public.electronic_document_sequences (
  company_id,
  emission_point_id,
  environment,
  document_type,
  next_value
)
select
  point.company_id,
  point.id,
  point.environment,
  configured.document_type,
  configured.next_value
from public.emission_points point
join (
  values
    ('003'::text, '01'::text, 675::bigint),
    ('002'::text, '07'::text, 687::bigint)
) as configured(emission_point_code, document_type, next_value)
  on configured.emission_point_code = point.emission_point_code
where point.company_id = '10000000-0000-4000-8000-000000000001'::uuid
  and point.environment = 'TEST'
  and point.establishment_code = '001'
on conflict (company_id, emission_point_id, environment, document_type)
do update set
  next_value = greatest(public.electronic_document_sequences.next_value, excluded.next_value),
  updated_at = now();

-- Imperio Flowers no recibe por copia la serie de Bless. Su establecimiento,
-- punto y ultimo numero se registraran desde Configuracion cuando el usuario
-- confirme los datos autorizados para ese RUC.

commit;
