# FASE 5C CIERRE PRUEBA GUIADA DEMO LOCAL

## Que se creo

- Ruta `Core del sistema -> Prueba guiada demo`
- Pantalla guiada de recorrido manual
- Formato de resultados
- Criterios de aceptacion
- Documentacion de uso y cierre

## Como usar la prueba guiada

1. Abrir `Core del sistema -> Prueba guiada demo`.
2. Iniciar la prueba demo.
3. Recorrer los 10 pasos sugeridos.
4. Marcar cada paso como revisado u observado.
5. Registrar observaciones, hallazgos y prioridad.
6. Volver a Diagnostico para confirmar que todo sigue en modo local/demo.

## Que modulos recorre

- Core del sistema
- Comercial / Exportaciones
- Pedido Maestro
- Operaciones / Poscosecha
- Scanner / Zebra demo
- Inventario de rosas / Kardex demo
- Administracion / Contabilidad

## Que validar

- rutas principales
- mensajes demo
- despacho demo
- scanner demo
- consumo demo
- separation entre preview comercial y contabilidad real/local
- ausencia de conexiones reales

## Que no se activo

- Supabase
- SQL
- Auth/RLS
- SRI
- scanner real
- inventario real
- contabilidad real de ventas

## Siguiente fase recomendada

FASE 5D: Registrar hallazgos reales de prueba de usuario y priorizar correcciones.
