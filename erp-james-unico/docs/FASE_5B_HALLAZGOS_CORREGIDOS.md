# FASE 5B HALLAZGOS CORREGIDOS

| Hallazgo | Módulo | Tipo | Corrección aplicada | Estado |
| --- | --- | --- | --- | --- |
| Documentos base de FASE 5A requeridos para la revisión | Core / Docs | DOCUMENTACION | Se verificó que los archivos guía de FASE 5A existen y pudieron usarse como referencia de cierre. | CORREGIDO |
| Inconsistencia de abreviaturas internas entre menú y grupos de navegación | Core del sistema | VISUAL | Se alinearon `shortLabel` internos de Operaciones y Comercial con el menú principal. | CORREGIDO |
| Estados del `module-registry` mezclaban valores viejos (`parcial`, `demo-integrado`, `futuro`) con estados nuevos | Core del sistema | DIAGNOSTICO | Se normalizaron estados a `demo avanzado`, `activo demo/local` y `placeholder` para reflejar el modo real del ERP. | CORREGIDO |
| El conteo del Diagnóstico dependía de estados antiguos | Core del sistema | DIAGNOSTICO | Se ajustaron filtros de módulos activos, demo, placeholder y futuros en [scripts/modules/part2.js](C:/Users/Contador%20J/Downloads/Codex/ERP_UNICO_JAMES/erp-james-unico/scripts/modules/part2.js). | CORREGIDO |
| Faltaba una sección explícita de correcciones 5B en Diagnóstico | Core del sistema | DIAGNOSTICO | Se agregó `Correcciones FASE 5B` con resumen de navegación, mensajes demo, placeholders y estabilidad local/demo. | CORREGIDO |
| El mensaje visible de Scanner no coincidía con la frase esperada en la auditoría funcional | Operaciones / Poscosecha | MENSAJE_DEMO | Se actualizó el hero de Scanner / Zebra para mostrar `Scanner demo. No hay lector Zebra real conectado.` | CORREGIDO |
| El mensaje visible de Despacho no coincidía con la frase esperada en la auditoría funcional | Operaciones / Poscosecha | MENSAJE_DEMO | Se reforzó el hero de Despacho operativo con `Despacho demo. No descuenta inventario real de rosas ni materiales.` | CORREGIDO |
| El preview contable comercial no mostraba la frase corta estándar de vista previa | Comercial / Exportaciones | MENSAJE_DEMO | Se reforzó el bloque de preview contable con `Vista previa. No afecta Libro Diario ni Mayor General.` | CORREGIDO |
| Acciones placeholder de documentos y bodega no dejaban el prefijo uniforme de fase futura | Comercial / Exportaciones | PLACEHOLDER | Se prefijaron toasts con `Pendiente fase futura.` para PDF, Zebra, correo y reposición demo. | CORREGIDO |
| Botones de contabilidad futura usaban mensaje genérico poco uniforme | Comercial / Exportaciones | BOTON | Se unificó el mensaje de `Enviar a contabilidad` y `Generar asiento real` como acción futura controlada. | CORREGIDO |
| Navegación principal y orden por grupos | Core del sistema | RUTA | Se revisó el orden general y no se detectaron duplicados ni grupos fuera de secuencia. | NO_APLICA |
| Activación real de Supabase, SRI, scanner o contabilidad de ventas | Core / Servicios reales | BUILD | Se revisó configuración; todo permanece desactivado y en modo local/demo. | NO_APLICA |
| Integración real de Parte 1, SRI o Supabase | Operaciones / Comercial | DOCUMENTACION | Se mantiene como pendiente futuro y se deja expresamente fuera de FASE 5B. | PENDIENTE_FUTURO |
