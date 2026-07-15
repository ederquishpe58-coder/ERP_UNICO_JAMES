# MAPA MODULOS TABLAS FUTURAS

| Modulo | Tabla futura sugerida | Contrato relacionado | Prioridad | Observacion |
| --- | --- | --- | --- | --- |
| Operaciones / Inventario rosas | `flower_inventory` | `operationalInventoryContract` | Alta | Fuente futura Parte 1 |
| Operaciones / Disponibilidad | `flower_availability` | `availabilityContract` | Alta | Alimenta Pedido Maestro |
| Operaciones / Reservas | `flower_reservations` | `reservationContract` | Alta | Reserva operativa/comercial |
| Comercial / Pedido Maestro | `commercial_orders` | `commercialOrderContract` | Alta | Centro del flujo comercial |
| Comercial / Cajas | `commercial_order_boxes` | `boxDetailContract` | Alta | Base para packing y etiquetas |
| Comercial / Lineas pedido | `commercial_order_lines` | `commercialOrderContract` | Alta | Totales y detalle comercial |
| Operaciones / Despacho | `dispatches` | `dispatchContract` | Alta | Conecta comercial y operaciones |
| Operaciones / Scanner | `scanner_events` | `scannerEventContract` | Media | Zebra futuro |
| Operaciones / Consumo rosas | `operational_consumptions` | `operationalConsumptionContract` | Media | Descuento real futuro |
| Operaciones / Kardex | `operational_kardex` | `operationalConsumptionContract` | Media | Trazabilidad operativa |
| Comercial / Factura cliente | `commercial_documents` | `clientCommercialInvoiceContract` | Media | No es SRI en esta fase |
| Comercial / Workflow | `commercial_workflow_events` | `commercialWorkflowContract` | Media | Historial y transiciones |
| Contabilidad / Libro diario | `journal_entries` | `salesAccountingContract` | Alta | Ya existe local/demo |
| Contabilidad / Lineas diario | `journal_entry_lines` | `salesAccountingContract` | Alta | Preparar asientos futuros |
| Inventario materiales | `material_stock` | `packagingRequirementContract` | Media | Bodega empaque |
| Inventario materiales / movimientos | `material_movements` | `packagingRequirementContract` | Media | Consumo futuro por despacho |
