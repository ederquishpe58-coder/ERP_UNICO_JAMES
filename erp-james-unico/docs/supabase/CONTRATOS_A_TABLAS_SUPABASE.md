# CONTRATOS A TABLAS SUPABASE

- `availabilityContract` -> `flower_availability`
- `reservationContract` -> `flower_reservations` + `commercial_reservations_link`
- `commercialOrderContract` -> `commercial_orders`
- `boxDetailContract` -> `commercial_order_boxes` + `commercial_order_lines`
- `packagingRequirementContract` -> `packaging_requirements`
- `salesAccountingContract` -> `commercial_accounting_previews` futuro + `journal_entries` futuro
- `clientCommercialInvoiceContract` -> `commercial_documents` o `commercial_invoices` futuro
- `commercialWorkflowContract` -> `commercial_workflow_events`
- `dispatchContract` -> `operational_dispatches` + `operational_dispatch_boxes`
- `scannerEventContract` -> `scanner_events`
- `operationalInventoryContract` -> `flower_inventory`
- `bunchLabelContract` -> `bunch_labels`
- `operationalConsumptionContract` -> `operational_consumptions` + `operational_kardex`
- `auditEventContract` -> `audit_logs`
