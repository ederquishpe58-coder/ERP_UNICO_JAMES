# País canónico en pedidos marítimos

Base publicada: `a50a5bfef365f7e75a98ded9527d451f740523f9`.

El formulario marítimo consumía `commercial.destinationCatalog`. La migración
202608070005 ya declaraba obsoleto ese catálogo; Países era su reemplazo.
PROD tenía 21 destinos BLESS y ninguno IMPERIO. Los países existentes eran
27 BLESS / 13 IMPERIO, todos activos, insuficientes para seleccionar cualquier país.

Se reutiliza `erp_entity_records / commercial_countries`. No hay tabla nueva
ni lista alternativa en el navegador. La migración forward-only completa los
249 códigos ISO en las dos empresas, conserva IDs/nombres/códigos/estados previos
y añade metadatos ISO y nombre de búsqueda español a los registros reconocidos.
Las fuentes del seed son [Debian iso-codes](https://salsa.debian.org/iso-codes-team/iso-codes/-/blob/main/data/iso_3166-1.json)
y [Unicode CLDR español](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-localenames-full/main/es/territories.json).
Sus hashes se incluyen en la migración. El dataset solo se utiliza para el seed;
el lector consulta los registros persistidos.

El ensayo con los catálogos de PROD añade 228 países BLESS y 237 IMPERIO,
y enriquece metadatos de 27 y 12 registros, respectivamente. Quedan 255/250 filas:
se conservan los seis duplicados históricos BLESS y «ÁFRICA» en IMPERIO.
No se renumeran ni eliminan por este cambio. El seed repetido no cambia nada.

`erp_commercial_order_countries` exige usuario y membership activos en la empresa
solicitada, además de capability canónica de lectura/creación/edición de pedidos.
Solo devuelve campos públicos de países de esa empresa. No expone escrituras,
inventario ni otros catálogos. No modifica RLS ni introduce OWNER bypass.

El selector busca nombre/ISO sin distinguir acentos o mayúsculas y conserva
`destinationId`, `destination`, `destinationCountry` y las marcas de selección
manual existentes. No filtra por cliente, marca, agencia, aerolínea o historial.
Su caché se separa por empresa/actor, comparte lecturas concurrentes y caduca en
60 segundos. Un error requiere reconsulta explícita y se muestra en pantalla.

El trigger `erp_order_country_guard` valida nuevas referencias marítimas en
servidor, incluidos estado activo y snapshot coincidente. Un cambio concurrente
del catálogo exige volver a seleccionar. Una referencia/texto histórico intacto
permanece válido; no se reescriben pedidos ni documentos impresos. El RPC de
guardado, sus ACK/versiones y sus mecanismos de numeración quedan intactos.

Validación: `node validate-order-country-catalog.cjs` (PostgreSQL aislado, lector,
mapper, flujo real save/ACK/reabrir/editar mediante I/O de fixture); pruebas DOM
en Edge de búsqueda, selección, 100 aperturas y recuperación de error; regresiones
de Hoja de Ruta, SENAE, catálogos compartidos, permisos y borrador de pedido.
No se crean pedidos reales ni se llaman APIs SRI durante estas pruebas.

Dos pruebas heredadas fallan también en la base publicada: presupuesto de bytes
en `validate-commercial-final-customer.mjs` y la expectativa del marcador retirado
`SUPABASE_ATOMICO` en `validate-commercial-order-atomic-identifiers.mjs`.
Sus fallos se registran como deuda previa, no como pruebas aprobadas.

Compensación: revertir primero la aplicación consumidora y retirar únicamente
el nuevo lector/trigger si se requiere. No borrar países sembrados que puedan
haber recibido referencias nuevas. La aplicación controlada verifica hashes
de datos ajenos al catálogo antes/después dentro de la misma transacción.
