begin;

-- Configuracion fiscal inicial exclusivamente para el ambiente de pruebas.
-- No carga certificados, documentos, inventario ni movimientos contables.

insert into public.sri_settings (
  company_id,
  legal_name,
  commercial_name,
  ruc,
  head_office_address,
  accounting_required,
  environment,
  production_enabled
)
select
  company.id,
  company.legal_name,
  company.commercial_name,
  company.tax_id,
  case company.company_key
    when 'COMP-BLESS-FLOWER'
      then 'Pichincha / Cayambe / Cangahua / Central S/N y Santa Rosa'
    when 'COMP-IMPERIO-FLOWERS'
      then coalesce(
        nullif(company.metadata ->> 'matrix_address', ''),
        'Calle 3 de Noviembre, lote 4 e interseccion Cachicungo, Cangahua, Cayambe, Pichincha'
      )
  end,
  case company.company_key
    when 'COMP-BLESS-FLOWER' then true
    when 'COMP-IMPERIO-FLOWERS' then false
  end,
  'TEST',
  false
from public.companies company
where company.company_key in ('COMP-BLESS-FLOWER', 'COMP-IMPERIO-FLOWERS')
on conflict (company_id) do update set
  legal_name = excluded.legal_name,
  commercial_name = excluded.commercial_name,
  ruc = excluded.ruc,
  head_office_address = excluded.head_office_address,
  accounting_required = excluded.accounting_required,
  environment = 'TEST',
  production_enabled = false,
  updated_at = now();

-- Bless Flower conserva las series TEST confirmadas por el usuario.
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
cross join (
  values
    ('001'::text, '003'::text, 'Facturas, notas de credito y guias'),
    ('001'::text, '002'::text, 'Comprobantes de retencion')
) as configured(establishment_code, emission_point_code, name)
where settings.company_id = '10000000-0000-4000-8000-000000000001'::uuid
on conflict (company_id, environment, establishment_code, emission_point_code)
do update set
  establishment_address = excluded.establishment_address,
  name = excluded.name,
  active = true,
  updated_at = now();

-- Imperio inicia en TEST con una serie independiente y editable desde Configuracion.
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
  '001',
  '001',
  settings.head_office_address,
  'Facturas, notas de credito y guias',
  true
from public.sri_settings settings
where settings.company_id = '10000000-0000-4000-8000-000000000002'::uuid
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
    ('10000000-0000-4000-8000-000000000001'::uuid, '003'::text, '01'::text, 675::bigint),
    ('10000000-0000-4000-8000-000000000001'::uuid, '003'::text, '04'::text, 1::bigint),
    ('10000000-0000-4000-8000-000000000001'::uuid, '003'::text, '06'::text, 1::bigint),
    ('10000000-0000-4000-8000-000000000001'::uuid, '002'::text, '07'::text, 687::bigint),
    ('10000000-0000-4000-8000-000000000002'::uuid, '001'::text, '01'::text, 1::bigint),
    ('10000000-0000-4000-8000-000000000002'::uuid, '001'::text, '04'::text, 1::bigint),
    ('10000000-0000-4000-8000-000000000002'::uuid, '001'::text, '06'::text, 1::bigint)
) as configured(company_id, emission_point_code, document_type, next_value)
  on configured.company_id = point.company_id
 and configured.emission_point_code = point.emission_point_code
where point.environment = 'TEST'
  and point.establishment_code = '001'
on conflict (company_id, emission_point_id, environment, document_type)
do update set
  next_value = greatest(public.electronic_document_sequences.next_value, excluded.next_value),
  updated_at = now();

commit;
