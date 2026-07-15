# FASE 5C CRITERIOS ACEPTACION DEMO LOCAL

## El ERP pasa FASE 5C si

- Navegacion principal funciona.
- Diagnostico muestra modo local/demo.
- Comercial abre sin errores criticos.
- Pedido Maestro abre.
- Documentos demo se visualizan.
- Operaciones abre.
- Despacho demo funciona visualmente.
- Scanner demo lee codigos de prueba.
- Consumo demo / kardex demo se visualiza.
- Contabilidad local/demo abre.
- No se conecta Supabase.
- No se ejecuta SRI.
- No se generan asientos reales desde Comercial.
- No se descuenta inventario real.

## No pasa si

- una ruta principal rompe la app.
- se ejecuta logica real por accidente.
- se intenta conectar Supabase sin autorizacion.
- se genera XML / SRI real.
- se modifica contabilidad real desde Comercial.
- se descuenta inventario real.
