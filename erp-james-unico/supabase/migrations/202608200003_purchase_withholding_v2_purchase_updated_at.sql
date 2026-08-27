-- Hotfix aditivo para el proyecto TEST donde 202608200002 ya se aplico antes
-- de confirmar que Compra V2 no tenia updated_at. No toca datos tributarios ni
-- secuenciales; habilita el timestamp canónico usado por la transición.
alter table public.erp_supplier_purchase_documents
  add column if not exists updated_at timestamptz not null default now();

select pg_notify('pgrst', 'reload schema');
