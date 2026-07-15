-- BORRADOR RLS
-- NO EJECUTAR TODAVÍA
-- POLÍTICAS CONCEPTUALES

-- Objetivo futuro:
-- 1. usuario solo ve datos de su empresa
-- 2. admin puede ver todo dentro de la empresa
-- 3. contador puede ver contabilidad y reportes
-- 4. ventas puede ver comercial
-- 5. operaciones puede ver poscosecha
-- 6. bodega puede ver inventario y despacho
-- 7. auditor solo lectura
-- 8. logs no deben borrarse

-- Ejemplo conceptual:
-- alter table companies enable row level security;
-- alter table commercial_orders enable row level security;
-- alter table flower_inventory enable row level security;
-- alter table journal_entries enable row level security;

-- Concepto 1: aislamiento por empresa
-- create policy company_scope_select
-- on commercial_orders
-- for select
-- using (company_id = auth.jwt()->>'company_id');

-- Concepto 2: admin dentro de su empresa
-- create policy admin_full_access_company
-- on commercial_orders
-- for all
-- using (
--   company_id = auth.jwt()->>'company_id'
--   and auth.jwt()->>'role' = 'admin'
-- )
-- with check (
--   company_id = auth.jwt()->>'company_id'
--   and auth.jwt()->>'role' = 'admin'
-- );

-- Concepto 3: contador
-- Lectura y escritura sobre:
-- - chart_of_accounts
-- - journal_entries
-- - journal_entry_lines
-- - purchases
-- - withholdings
-- - cxc_documents
-- - cxp_documents

-- Concepto 4: ventas
-- Lectura y escritura sobre:
-- - customers
-- - final_brands
-- - commercial_orders
-- - commercial_order_boxes
-- - commercial_order_lines
-- - commercial_documents
-- - commercial_workflow_events

-- Concepto 5: operaciones
-- Lectura y escritura sobre:
-- - flower_inventory
-- - flower_availability
-- - flower_reservations
-- - operational_dispatches
-- - operational_dispatch_boxes
-- - scanner_events
-- - operational_consumptions
-- - operational_kardex

-- Concepto 6: bodega
-- Lectura y escritura sobre:
-- - material_items
-- - material_stock
-- - material_movements
-- - packaging_requirements

-- Concepto 7: auditor
-- Solo lectura en:
-- - commercial_workflow_events
-- - audit_logs
-- - journal_entries
-- - scanner_events
-- - operational_kardex

-- Concepto 8: logs no deben borrarse
-- No crear policy delete sobre audit_logs.
-- No permitir update destructivo de trazabilidad critica.
