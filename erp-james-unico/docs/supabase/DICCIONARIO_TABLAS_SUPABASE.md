# DICCIONARIO TABLAS SUPABASE

## Core

### `companies`
- proposito: empresa o entidad operativa del ERP
- modulo: Core
- campos clave: `id`, `name`, `legal_name`, `ruc`, `status`
- contrato relacionado: base comun
- prioridad: Alta
- observaciones: preparar multiempresa futura

### `users`
- proposito: usuarios del sistema
- modulo: Core
- campos clave: `id`, `company_id`, `email`, `display_name`, `status`
- contrato relacionado: `auditEventContract`
- prioridad: Alta
- observaciones: auth real queda fuera de esta fase

### `roles`
- proposito: catalogo de roles
- modulo: Core
- campos clave: `id`, `code`, `name`, `scope`
- contrato relacionado: base comun
- prioridad: Alta
- observaciones: usar con `user_roles`

### `audit_logs`
- proposito: persistencia futura de auditoria
- modulo: Core
- campos clave: `id`, `company_id`, `user_id`, `module`, `action`, `payload`, `created_at`
- contrato relacionado: `auditEventContract`
- prioridad: Alta
- observaciones: no debe borrarse libremente

### `sequences`
- proposito: secuenciales por documento
- modulo: Core
- campos clave: `id`, `company_id`, `sequence_key`, `prefix`, `current_value`
- contrato relacionado: base comun
- prioridad: Alta
- observaciones: importante para pedidos y documentos

## Comercial

### `customers`
- proposito: clientes principales
- modulo: Comercial
- campos clave: `id`, `company_id`, `code`, `commercial_name`, `legal_name`, `status`
- contrato relacionado: `commercialOrderContract`
- prioridad: Alta
- observaciones: puede convivir luego con clientes contables

### `final_brands`
- proposito: marcas o clientes finales
- modulo: Comercial
- campos clave: `id`, `company_id`, `customer_id`, `name`, `destination_country`, `requires_po`
- contrato relacionado: `commercialOrderContract`
- prioridad: Alta
- observaciones: relacion directa con Pedido Maestro

### `commercial_orders`
- proposito: encabezado del pedido comercial
- modulo: Comercial
- campos clave: `id`, `company_id`, `order_number`, `customer_id`, `brand_id`, `status`, `flight_date`, `total_usd`
- contrato relacionado: `commercialOrderContract`
- prioridad: Alta
- observaciones: centro del flujo comercial

### `commercial_order_boxes`
- proposito: cajas del pedido
- modulo: Comercial
- campos clave: `id`, `company_id`, `commercial_order_id`, `box_number`, `box_type`, `full_equivalent`, `status`
- contrato relacionado: `boxDetailContract`
- prioridad: Alta
- observaciones: base para packing y despacho

### `commercial_order_lines`
- proposito: lineas detalladas por caja
- modulo: Comercial
- campos clave: `id`, `company_id`, `commercial_order_box_id`, `variety`, `length`, `bunches`, `stems_per_bunch`, `unit_price`
- contrato relacionado: `boxDetailContract`
- prioridad: Alta
- observaciones: totales y documentos comerciales

### `commercial_documents`
- proposito: documentos comerciales y de impresion
- modulo: Comercial
- campos clave: `id`, `company_id`, `commercial_order_id`, `document_type`, `document_mode`, `status`
- contrato relacionado: `clientCommercialInvoiceContract`
- prioridad: Media
- observaciones: no equivale a SRI

### `commercial_workflow_events`
- proposito: historial de estados comerciales
- modulo: Comercial
- campos clave: `id`, `company_id`, `commercial_order_id`, `previous_status`, `next_status`, `reason`, `created_at`
- contrato relacionado: `commercialWorkflowContract`
- prioridad: Alta
- observaciones: apoyo de auditoria de negocio

## Operaciones

### `flower_inventory`
- proposito: inventario operativo de rosas
- modulo: Operaciones
- campos clave: `id`, `company_id`, `source_record_id`, `variety`, `length`, `available_bunches`, `warehouse`, `status`
- contrato relacionado: `operationalInventoryContract`
- prioridad: Alta
- observaciones: origen futuro Parte 1

### `flower_availability`
- proposito: disponibilidad comercial derivada del inventario operativo
- modulo: Operaciones
- campos clave: `id`, `company_id`, `flower_inventory_id`, `variety`, `length`, `available_bunches`, `status`
- contrato relacionado: `availabilityContract`
- prioridad: Alta
- observaciones: Comercial consulta, no crea

### `flower_reservations`
- proposito: reservas sobre disponibilidad
- modulo: Operaciones
- campos clave: `id`, `company_id`, `flower_availability_id`, `commercial_order_id`, `reserved_bunches`, `status`
- contrato relacionado: `reservationContract`
- prioridad: Alta
- observaciones: luego puede vincularse tambien por tabla puente

### `operational_dispatches`
- proposito: despacho operativo
- modulo: Operaciones
- campos clave: `id`, `company_id`, `commercial_order_id`, `dispatch_number`, `dispatch_status`, `flight_date`
- contrato relacionado: `dispatchContract`
- prioridad: Alta
- observaciones: sincroniza con Comercial

### `operational_dispatch_boxes`
- proposito: cajas incluidas en despacho
- modulo: Operaciones
- campos clave: `id`, `company_id`, `operational_dispatch_id`, `commercial_order_box_id`, `scan_status`
- contrato relacionado: `dispatchContract`
- prioridad: Alta
- observaciones: soporte de scanner y cierre de despacho

### `scanner_events`
- proposito: eventos de lectura de scanner
- modulo: Operaciones
- campos clave: `id`, `company_id`, `operational_dispatch_id`, `code`, `code_type`, `result`, `created_at`
- contrato relacionado: `scannerEventContract`
- prioridad: Media
- observaciones: Zebra real pendiente

### `operational_consumptions`
- proposito: consumo operativo por despacho
- modulo: Operaciones
- campos clave: `id`, `company_id`, `operational_dispatch_id`, `flower_reservation_id`, `consumed_bunches`, `consumed_stems`, `status`
- contrato relacionado: `operationalConsumptionContract`
- prioridad: Media
- observaciones: descuento real futuro

### `operational_kardex`
- proposito: trazabilidad de movimientos operativos
- modulo: Operaciones
- campos clave: `id`, `company_id`, `operational_consumption_id`, `movement_type`, `bunches`, `stems`, `balance_bunches`
- contrato relacionado: `operationalConsumptionContract`
- prioridad: Media
- observaciones: no mezclar con kardex de materiales

## Inventario materiales

### `material_items`
- proposito: catalogo de materiales
- modulo: Inventario materiales
- campos clave: `id`, `company_id`, `code`, `name`, `unit`, `status`
- contrato relacionado: `packagingRequirementContract`
- prioridad: Media
- observaciones: separado del inventario de rosas

### `material_stock`
- proposito: stock por item y bodega
- modulo: Inventario materiales
- campos clave: `id`, `company_id`, `material_item_id`, `warehouse_id`, `quantity_on_hand`
- contrato relacionado: `packagingRequirementContract`
- prioridad: Media
- observaciones: soporte de bodega empaque

### `material_movements`
- proposito: ingresos, consumos y ajustes
- modulo: Inventario materiales
- campos clave: `id`, `company_id`, `material_item_id`, `movement_type`, `quantity`, `reference_type`
- contrato relacionado: `packagingRequirementContract`
- prioridad: Media
- observaciones: consumo real futuro por despacho

### `packaging_requirements`
- proposito: requerimientos de materiales por pedido
- modulo: Inventario materiales
- campos clave: `id`, `company_id`, `commercial_order_id`, `material_item_id`, `required_quantity`, `status`
- contrato relacionado: `packagingRequirementContract`
- prioridad: Media
- observaciones: origen en Pedido Maestro

## Contabilidad

### `chart_of_accounts`
- proposito: catalogo contable
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `account_code`, `account_name`, `account_type`, `status`
- contrato relacionado: `salesAccountingContract`
- prioridad: Alta
- observaciones: ya existe logica local/demo

### `journal_entries`
- proposito: encabezado de asientos
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `entry_number`, `entry_date`, `source_module`, `status`
- contrato relacionado: `salesAccountingContract`
- prioridad: Alta
- observaciones: no conectar ventas aun

### `journal_entry_lines`
- proposito: detalle de asiento
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `journal_entry_id`, `account_id`, `debit`, `credit`
- contrato relacionado: `salesAccountingContract`
- prioridad: Alta
- observaciones: depende de `chart_of_accounts`

### `suppliers`
- proposito: proveedores
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `supplier_code`, `name`, `identification`, `status`
- contrato relacionado: compras
- prioridad: Alta
- observaciones: compras base

### `purchases`
- proposito: compras
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `supplier_id`, `document_number`, `issue_date`, `total`
- contrato relacionado: compras
- prioridad: Alta
- observaciones: puede generar asiento

### `withholdings_issued`
- proposito: retenciones emitidas
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `purchase_id`, `document_number`, `issue_date`, `total`
- contrato relacionado: tributario
- prioridad: Media
- observaciones: enlazable a compras

### `withholdings_received`
- proposito: retenciones recibidas
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `customer_id`, `document_number`, `issue_date`, `total`
- contrato relacionado: tributario
- prioridad: Media
- observaciones: ventas reales futuras

### `cxc_documents`
- proposito: cuentas por cobrar
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `customer_id`, `reference_number`, `issue_date`, `balance`
- contrato relacionado: `salesAccountingContract`
- prioridad: Media
- observaciones: no activar desde Comercial aun

### `cxp_documents`
- proposito: cuentas por pagar
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `supplier_id`, `reference_number`, `issue_date`, `balance`
- contrato relacionado: compras
- prioridad: Media
- observaciones: vinculado a compras

### `bank_accounts`
- proposito: cuentas bancarias
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `bank_name`, `account_number`, `currency`, `status`
- contrato relacionado: bancos
- prioridad: Media
- observaciones: base para conciliacion

### `bank_movements`
- proposito: movimientos bancarios
- modulo: Contabilidad
- campos clave: `id`, `company_id`, `bank_account_id`, `movement_date`, `amount`, `reference`
- contrato relacionado: bancos
- prioridad: Media
- observaciones: puede enlazarse a CxP/CxC
