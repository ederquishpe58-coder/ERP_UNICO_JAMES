-- Prepara los puntos de emision obligatorios de Bless Flower sin alterar
-- documentos ni secuenciales ya existentes:
--   exportaciones: 001-002
--   ventas locales: 001-003
--
-- Esta migracion es idempotente. Si el secuencial de facturas 01 ya existe,
-- no lo reemplaza. Si falta, inicia despues del mayor secuencial confirmado
-- para el mismo punto de emision, o en 1 cuando todavia no hay documentos.

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
  configured.establishment_code,
  configured.emission_point_code,
  settings.head_office_address,
  configured.name,
  true
from public.sri_settings settings
cross join lateral (
  values
    ('001'::text, '002'::text, 'Facturas de exportacion'),
    ('001'::text, '003'::text, 'Facturas de venta local')
) as configured(establishment_code, emission_point_code, name)
where settings.company_id = '10000000-0000-4000-8000-000000000001'::uuid
  and settings.environment = 'TEST'
on conflict (company_id, environment, establishment_code, emission_point_code)
do update set
  establishment_address = excluded.establishment_address,
  active = true,
  updated_at = now();

insert into public.electronic_document_sequences (
  company_id,
  emission_point_id,
  environment,
  document_type,
  next_value,
  updated_at
)
select
  point.company_id,
  point.id,
  point.environment,
  '01',
  coalesce((
    select max(document.sequential) + 1
    from public.electronic_documents document
    where document.company_id = point.company_id
      and document.emission_point_id = point.id
      and document.environment = point.environment
      and document.document_type = '01'
  ), 1),
  now()
from public.emission_points point
where point.company_id = '10000000-0000-4000-8000-000000000001'::uuid
  and point.environment = 'TEST'
  and point.establishment_code = '001'
  and point.emission_point_code in ('002', '003')
on conflict (company_id, emission_point_id, environment, document_type)
do nothing;
