# Candidato de pais SRI, sin despliegue

BASE SHA / PROD SHA: 19af30bc31d12345be131b065f50bb30664eb8b3.
Branch: fix/sri-country-validation.
Worktree: C:/Users/Contador J/Documents/.codex-worktrees/sri-country-validation.

Identidad obtenida por GET autenticado de Vercel:
dpl_5swbkGsBnz3GkGVitR3YRrzE3VNf, proyecto bless-flower-jaeder-prod,
prj_o2JzhrK0BZ85k9F91mIwgwSQxBN8. El alias publico
bless-flower-jaeder-prod-indol.vercel.app sirvio los cuatro archivos funcionales
con HTTP 200, application/javascript y hash SHA256 identico a la base
(normalizando CRLF). El alias terminado en prod-bless-flower redirige a login;
su HTML no se utiliza como evidencia de codigo.

## Alcance

Se preserva el checkout original con sus cambios sin incorporar archivos antiguos
completos. El nuevo candidato parte de PROD y conserva las publicaciones posteriores.
No hay cambios SQL, permisos, perfiles, firmador, backend fiscal ni Parte 1.
dist se genera exclusivamente mediante npm run build y esta ignorado por Git
en esta base. No se incorpora la edicion manual del catalogo SRI del candidato
antiguo ni codigos de pais por defecto.

Archivos funcionales:
- scripts/modules/comercial/comercial-data.js: conserva campos SRI sin convertir ISO.
- scripts/repositories/comercial/order-country-catalog.js: lectura fiscal autenticada,
  normalizacion y contexto por empresa y actor, con bloqueo si la lectura es incompleta.
- scripts/modules/comercial/sri-order-queue-core.js: resolucion por destino guardado,
  bloqueo de mapeo ausente, ambiguedad y contradicciones, sin pais del comprador.
- scripts/modules/comercial/sri-authorization.js: carga previa a validar nuevos
  payloads y contexto fiscal; documentos existentes conservan su ruta publicada.

Pruebas y lector:
- scripts/services/sri/validate-sri-multicompany.mjs.
- validate-sri-country-pipeline.cjs.
- validate-sri-country-reader.cjs.
- tools/read-sri-country-case.js y su guia.

## Evidencia

REFERENCE ORDER ID: pendiente de ejecutar lector con la sesion James en IMPERIO.
SAVED DESTINATION: no verificado.
CANONICAL SRI COUNTRY CODE: no verificado.
TRANSPORT / RESERVATION / FISCAL SNAPSHOT: no verificados para el caso real.

EXACT LOSS POINT generico: createCountry omitia campos SRI; el RPC publicado
erp_commercial_order_countries proyecta ID/nombre/ISO pero no SRI, y el selector
tambien descarta campos adicionales. localContext no transportaba paises al
resolutor; validateOrder emitia el error antes de create-draft. El candidato lee
el registro canonico con la sesion autorizada y conserva los campos hasta paisDestino.
No se afirma que ese sea el punto exacto observado en el pedido real.

No se ha verificado el codigo oficial del pais real porque aun no se conoce el
pais guardado. Los codigos de los fixtures prueban transporte de datos, no completan
el catalogo ni certifican sus valores. 149 nunca es un default.

## Documento existente

createDraft reutiliza la reserva y devuelve el documento con lineas existentes.
La generacion usa source_snapshot persistido. Los contratos de refresh encontrados
permiten direccion del comprador y fecha, no una correccion generica del pais.
No se propone recrear ni modificar el snapshot de un borrador incompleto: primero
identificarlo; una correccion de pais requeriria contrato especifico revisado.
Firmados, transmitidos, inciertos y autorizados no se sobrescriben con este candidato.

## Verificacion

- Pipeline en fuente y dist: 26 casos cada uno, incluye carga, normalizacion,
  localContext real, cola, payload y XML real en memoria para BLESS/IMPERIO,
  AEREO/MARITIMO, manual, LOCAL, ausencia, contradicciones y cambio de empresa.
- Lector: siete estados fiscales inmutables, rechazo de empresa distinta,
  lectura denegada explicita, sin APIs de escritura disponibles en el doble.
- validate:sri:documents-grid y validate:sri:companies: PASS.
- validate-sri-manual-same-document.cjs: 24/24 PASS.
- validate-sri-certificate-pipeline.mjs: 39 PASS, certificados sinteticos.
- npm run build: PASS; git diff --check: PASS.
- No se ejecutaron firma con certificados reales, lectura James real, XSD del
  pedido real, autorizacion ni transmision. No se copiaron certificados reales.

MENU SRI IMPERIO: guard no diagnosticado en este turno; pendiente separado.
READY FOR DEPLOY REVIEW: NO.
MISSING EVIDENCE: salida del lector autenticado; codigo oficial del pais seleccionado;
visibilidad RLS del registro fiscal; estado/reserva/snapshot del documento real.
DEPLOYMENT: NONE.
DATA WRITES / SEQUENCE CONSUMPTION / SRI TRANSMISSIONS: 0.
