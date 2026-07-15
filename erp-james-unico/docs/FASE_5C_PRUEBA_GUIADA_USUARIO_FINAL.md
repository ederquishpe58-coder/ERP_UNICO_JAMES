# FASE 5C PRUEBA GUIADA USUARIO FINAL

## Objetivo

Guiar a un usuario final por el ERP unico en modo demo/local para validar visualmente que el flujo principal funciona sin tocar servicios reales.

## Pasos de prueba

1. Inicio / diagnostico
2. Comercial / Exportaciones
3. Pedido Maestro
4. Disponibilidad / reservas
5. Cajas y documentos
6. Despacho demo
7. Operaciones / Poscosecha
8. Scanner demo
9. Consumo demo / Kardex demo
10. Contabilidad local/demo
11. Confirmacion de que no se toco nada real

## Resultados esperados

- El ERP carga en modo local/demo.
- Diagnostico confirma Supabase desactivado y servicios reales pendientes.
- Comercial abre y mantiene sus previews/documentos en demo.
- Operaciones abre y mantiene inventario, despacho, scanner y consumo en demo.
- Contabilidad sigue separada del flujo comercial demo.

## Que no debe ocurrir

- No se conecta Supabase.
- No se ejecuta SRI.
- No se conecta scanner real.
- No se descuenta inventario real.
- No se generan asientos reales desde Comercial.

## Como registrar hallazgos

- Usar la pantalla `Core del sistema -> Prueba guiada demo`.
- En cada paso registrar:
  - observacion del usuario
  - hallazgo
  - prioridad
  - estado revisado u observado

## Como decidir si pasa o no pasa la prueba

- Pasa si el recorrido se puede completar sin errores criticos de navegacion ni activacion de servicios reales.
- Pasa con observacion si el flujo demo funciona pero hay detalles visuales o de usabilidad menores.
- No pasa si una ruta principal rompe la app o intenta ejecutar logica real.

## Siguiente fase recomendada

FASE 5D: Registrar hallazgos reales de prueba de usuario y priorizar correcciones.
