# CAMPOS MINIMOS PRIMERA MIGRACION

| Entidad | Campos minimos | Relacion | Observacion |
| --- | --- | --- | --- |
| `companies` | `id`, `name`, `ruc`, `created_at`, `updated_at` | base comun | empresa principal |
| `customers` | `id`, `company_id`, `legal_name`, `commercial_name`, `identification_type`, `identification_number`, `country`, `city`, `address`, `email`, `phone`, `credit_days`, `status` | `companies` 1:N `customers` | cliente principal |
| `final_brands` | `id`, `company_id`, `customer_id`, `brand_name`, `country`, `city`, `address`, `status` | `customers` 1:N `final_brands` | marca / cliente final |
| `commercial_orders` | `id`, `company_id`, `order_number`, `customer_id`, `final_brand_id`, `issue_date`, `flight_date`, `destination_country`, `destination_city`, `dae_id`, `cargo_agency_id`, `airline_id`, `awb`, `hawb`, `status`, `total_boxes`, `total_fulls`, `total_bunches`, `total_stems`, `total_usd` | `customers`, `final_brands`, `dae_records`, `cargo_agencies`, `airlines` | centro del Pedido Maestro |
| `commercial_order_boxes` | `id`, `company_id`, `order_id`, `box_number`, `box_type`, `full_equivalent`, `po`, `status` | `commercial_orders` 1:N `commercial_order_boxes` | base para packing y despacho |
| `commercial_order_lines` | `id`, `company_id`, `order_id`, `box_id`, `variety`, `stem_length`, `bunches`, `stems_per_bunch`, `total_stems`, `unit_price`, `total_usd`, `reservation_id` | `commercial_orders` 1:N, `commercial_order_boxes` 1:N | detalle por caja |
| `flower_availability` | `id`, `company_id`, `variety`, `stem_length`, `stems_per_bunch`, `available_bunches`, `reserved_bunches`, `balance_bunches`, `warehouse`, `supplier`, `block`, `category`, `status` | fuente para `flower_reservations` | Operaciones minima persistible |
| `flower_reservations` | `id`, `company_id`, `availability_id`, `order_id`, `variety`, `stem_length`, `reserved_bunches`, `reserved_stems`, `status` | `flower_availability` 1:N, `commercial_orders` N:1 | reserva comercial/operativa |
| `operational_dispatches` | `id`, `company_id`, `order_id`, `dispatch_status`, `responsible_user_id`, `dispatched_at`, `notes` | `commercial_orders` 1:N `operational_dispatches` | despacho minimo |
| `operational_dispatch_boxes` | `id`, `company_id`, `dispatch_id`, `order_box_id`, `scan_status`, `status` | `operational_dispatches` 1:N | cajas despachadas |
