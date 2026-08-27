begin;

-- Limpieza técnica sin cambios funcionales ni de datos. Ajusta las categorías
-- de volatilidad a las expresiones realmente utilizadas por PostgreSQL.
alter function public.sri_build_access_key(date, text, text, text, text, bigint, text) stable;
alter function public.erp_clean_transaction_state(jsonb) stable;
alter function public.erp_sync_health(uuid) volatile;

-- El índice del FOR se declara automáticamente en PL/pgSQL. Mantener una
-- variable del mismo nombre generaba una advertencia de sombreado.
create or replace function public.sri_modulo11(p_value text)
returns smallint
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_factor integer := 2;
  v_sum integer := 0;
  v_result integer;
begin
  if p_value !~ '^[0-9]+$' then
    raise exception using
      errcode = '22023',
      message = 'SRI_MODULO11_REQUIRES_DIGITS';
  end if;

  for v_index in reverse length(p_value)..1 loop
    v_sum := v_sum + substring(p_value from v_index for 1)::integer * v_factor;
    v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
  end loop;

  v_result := 11 - (v_sum % 11);
  if v_result = 11 then
    return 0;
  elsif v_result = 10 then
    return 1;
  end if;
  return v_result::smallint;
end;
$$;

-- La consulta de la factura original solo comprueba existencia y bloqueo. No
-- necesita conservar la fila completa en una variable que nunca se utiliza.
do $migration$
declare
  v_function regprocedure := 'public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)'::regprocedure;
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(v_function::oid) into v_before;
  v_after := regexp_replace(
    v_before,
    E'\n[[:space:]]*v_original public[.]electronic_documents%rowtype;\n',
    E'\n'
  );
  v_after := regexp_replace(
    v_after,
    'select[[:space:]]+[*][[:space:]]+into[[:space:]]+v_original[[:space:]]+from',
    'perform 1 from'
  );
  if v_after = v_before or position('v_original' in v_after) > 0 then
    raise exception 'No se pudo aplicar de forma segura la limpieza de create_electronic_document_draft';
  end if;
  execute v_after;
end;
$migration$;

commit;
