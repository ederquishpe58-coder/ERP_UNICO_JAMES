begin;

-- La retención (07) utiliza la misma clave de acceso de 49 dígitos. La
-- función histórica todavía limitaba los tipos a factura, nota y guía, por
-- eso create_electronic_document_draft fallaba con 22023 antes de reservar el
-- secuencial de la retención.
create or replace function public.sri_build_access_key(
  p_issue_date date,
  p_document_type text,
  p_ruc text,
  p_establishment_code text,
  p_emission_point_code text,
  p_sequential bigint,
  p_numeric_code text
)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = public, pg_temp
as $$
declare
  v_base text;
begin
  if p_document_type not in ('01', '04', '06', '07') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_ruc !~ '^[0-9]{13}$'
     or p_establishment_code !~ '^[0-9]{3}$'
     or p_emission_point_code !~ '^[0-9]{3}$'
     or p_numeric_code !~ '^[0-9]{8}$'
     or p_sequential < 1
     or p_sequential > 999999999 then
    raise exception using errcode = '22023', message = 'SRI_ACCESS_KEY_INPUT_INVALID';
  end if;

  v_base :=
    to_char(p_issue_date, 'DDMMYYYY')
    || p_document_type
    || p_ruc
    || '1'
    || p_establishment_code
    || p_emission_point_code
    || lpad(p_sequential::text, 9, '0')
    || p_numeric_code
    || '1';

  if length(v_base) <> 48 then
    raise exception using errcode = '22023', message = 'SRI_ACCESS_KEY_BASE_LENGTH_INVALID';
  end if;

  return v_base || public.sri_modulo11(v_base)::text;
end;
$$;

commit;
