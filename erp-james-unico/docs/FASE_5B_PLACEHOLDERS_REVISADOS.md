# FASE 5B PLACEHOLDERS REVISADOS

## Estado general

Los placeholders principales siguen visibles, pero quedan controlados con mensajes claros de fase futura. No ejecutan lógica real.

## Placeholders controlados

| Módulo | Ubicación | Estado actual | Comportamiento actual |
| --- | --- | --- | --- |
| Comercial | Preview contable comercial | Controlado | `Enviar a contabilidad` y `Generar asiento real` muestran mensaje de fase futura y no crean asientos |
| Comercial | Centro de impresión / Pedido Maestro | Controlado | `Descargar PDF`, `Enviar por correo` y `Zebra futuro` muestran mensaje de fase futura |
| Comercial | Bodega / Materiales | Controlado | `Solicitar reposición` sigue visual/demo con mensaje claro |
| Comercial | Autorización SRI futura | Controlado | Pantalla placeholder informativa, sin SRI real |
| Operaciones | Scanner / Zebra | Controlado | Sin lector real, sin WebUSB, sin WebBluetooth, sin descuento real |
| Operaciones | Despacho operativo | Controlado | Sin consumo de inventario real ni contabilidad real |
| Core / Supabase | Diagnóstico y servicios preparados | Controlado | Supabase desactivado y repositorios en modo local/demo |

## Pendientes futuros que se mantienen

- Supabase real
- Auth real
- RLS real
- SRI ventas
- Scanner / Zebra real
- Inventario real de rosas
- Consumo real de materiales
- Contabilidad real de ventas

## Nota

FASE 5B no activa ningún placeholder ni lo convierte en servicio real. Solo deja mensajes, toasts y pantallas más claros para el usuario demo/local.
