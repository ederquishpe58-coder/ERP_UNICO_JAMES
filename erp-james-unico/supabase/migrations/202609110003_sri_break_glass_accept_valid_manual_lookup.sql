-- Forward-only repair for the observed contract mismatch:
-- valid manual NO_ENCONTRADO lookups are settled as FAILED by design, while
-- the break-glass claim must accept them only when the HTTP 200 response and
-- its canonical hash/contents prove the lookup was valid.
-- No business rows, documents, attempts, or permissions are changed.
begin;

do $migration$
declare
  function_oid oid;
  definition text;
  succeeded_count integer;
  latest_count integer;
  patched_count integer;
  patched_latest_count integer;
  succeeded_pattern text := $$and x.status = 'SUCCEEDED'$$;
  latest_pattern text := $$or latest_lookup.status <> 'SUCCEEDED'$$;
  patched_pattern text := $$and x.status in ('SUCCEEDED', 'FAILED')$$;
  patched_latest_pattern text := $$or latest_lookup.status not in ('SUCCEEDED', 'FAILED')$$;
begin
  select p.oid
    into function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'claim_sri_break_glass_reception'
    and pg_get_function_identity_arguments(p.oid) =
      'p_company_id uuid, p_document_id uuid, p_actor_user_id uuid, p_operation_id uuid, p_authorization_job_id uuid, p_authorization_worker text, p_authorization_attempt_id uuid, p_lookup_response_id uuid, p_signed_file_id uuid, p_document_snapshot jsonb, p_evidence jsonb';

  if function_oid is null then
    raise exception 'SRI_BREAK_GLASS_CLAIM_FUNCTION_NOT_FOUND';
  end if;

  select pg_get_functiondef(function_oid)
    into definition;

  succeeded_count := (length(definition) - length(replace(definition, succeeded_pattern, ''))) / length(succeeded_pattern);
  latest_count := (length(definition) - length(replace(definition, latest_pattern, ''))) / length(latest_pattern);
  patched_count := (length(definition) - length(replace(definition, patched_pattern, ''))) / length(patched_pattern);
  patched_latest_count := (length(definition) - length(replace(definition, patched_latest_pattern, ''))) / length(patched_latest_pattern);

  if succeeded_count = 0 and latest_count = 0
     and patched_count = 1 and patched_latest_count = 1 then
    return;
  end if;

  if succeeded_count <> 1 or latest_count <> 1
     or patched_count <> 0 or patched_latest_count <> 0 then
    raise exception 'SRI_BREAK_GLASS_CLAIM_CONTRACT_DRIFT';
  end if;

  definition := replace(
    definition,
    succeeded_pattern,
    $$and x.status in ('SUCCEEDED', 'FAILED')$$
  );
  definition := replace(
    definition,
    latest_pattern,
    $$or latest_lookup.status not in ('SUCCEEDED', 'FAILED')$$
  );

  execute definition;
end;
$migration$;

commit;
