begin;
-- Hoja de Ruta uses the existing explicit, atomic commercial reservation contract.
-- Preserve every other guard, capability, routing and idempotency branch.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.erp_commercial_reserve_invoice_for_documents(uuid,text,text)'::regprocedure);
  v_before text := $$('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT')$$;
  v_after text := $$('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT','HR')$$;
begin
  if position(v_after in v_definition) > 0 then return; end if;
  if position(v_before in v_definition) = 0
     or (length(v_definition) - length(replace(v_definition,v_before,''))) <> length(v_before) then
    raise exception 'COMMERCIAL_RESERVATION_CONTRACT_CHANGED';
  end if;
  execute replace(v_definition,v_before,v_after);
end;
$migration$;
commit;
