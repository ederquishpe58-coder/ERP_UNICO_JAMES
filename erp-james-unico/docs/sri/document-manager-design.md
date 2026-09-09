# Gestor canónico SRI — diseño focal

Base publicada verificada: `2f8a13b4837097c2d81d8ba6e5753c0c17242c13` / `dpl_5BTogK3ksK1taHSFes4gh9bWp5yh`.

## Evidencia

La bandeja comercial y el detalle de Compras usan `api/sri.js`, `document-service.cjs` y `transmission-service.cjs`. Los archivos ya son inmutables y se identifican por SHA-256 en `electronic_document_files` / `sri-private`. No se creará otro transporte ni otro almacén fiscal.

`claim_sri_manual_authorization` conserva el presupuesto automático, crea un intento humano y tiene fencing antes/después de red. Actualmente solo admite 07 con presupuesto agotado y determinados errores. Se ampliará la elegibilidad, conservando su claim por documento, identidad, empresa, ambiente, cooldown y exclusión.

Lectura PROD de referencia, sin consultar al SRI: 750 y 755 están `PENDIENTE_REINTENTO`, con 29 y 20 intentos históricos respectivamente. Ambos tienen autorización automática 12/12 agotada y última respuesta almacenada `NO_ENCONTRADO`. No se efectuarán acciones sobre ellos durante el desarrollo o postcheck.

## Integración

- Nueva ruta SRI / Gestor de Comprobantes; filtros remotos y detalle por ID y empresa. No fuentes locales de autoridad.
- Servicio manager sobre los lectores, validadores XSD/identidad/XAdES, almacenamiento inmutable, transporte y anulación existentes.
- Validación sin escritura, firma ni transmisión. Distingue evidencia disponible de validaciones imposibles por datos ausentes; nunca informa PASS silenciosamente.
- Recuperación humana consulta primero y nunca reenvía por el mero `NO_ENCONTRADO`. Reenvío solo cuando el contrato de recuperación existente lo autorice explícitamente.
- Pausa y revisión manual son metadatos por documento, no estados fiscales. Deben ser comprobados también por el claim del scheduler.
- Corrección acotada a campos fuente permitidos de documentos sin transmisión; identidad fiscal, importes, impuestos, DocSustento y contabilidad quedan protegidos. Concurrencia optimista, archivos anteriores conservados, versión y motivo auditados; se regenera y firma mediante infraestructura existente.
- Evidencia externa de autorización: comprobar identidad e integridad y consultar oficialmente mediante el transporte existente. Ningún archivo cargado o texto libre constituye por sí solo autorización SRI.
- Anulación 07 usa el expediente/RPC actual de Compras. 01/04 deben respetar los límites del contrato existente; no inventar reversas contables ni marcar ANULADO desde texto libre.

## Seguridad y release

Autenticación real, membership activa y capabilities canónicas en backend. Las capabilities adicionales no se conceden globalmente por defecto. Ningún OWNER bypass. No se alteran memberships, perfiles ni documentos actuales al aplicar la migración.

Migración forward-only para metadatos, evidencia/versiones y extensión focal de claims. Tests aislados, regresiones y build antes de cualquier despliegue. Cero transmisiones reales y cero acciones automáticas sobre 750/755.

La [información oficial del SRI sobre anulación](https://www.sri.gob.ec/detalle-noticias?idnoticia=1160&marquesina=1) remite al portal institucional y distingue solicitud de anulación de su aceptación. No se automatizan interfaces privadas ni scraping.

## Límites operativos y permisos

La anulación 01/04 permite solicitud y referencia de trámite externo, sin transición fiscal ni reversión. El backend bloquea expresamente la confirmación final: esos tipos no tienen el workflow contable completo de 07 y este cambio no lo inventa. Retención 07 conserva solicitud, evidencia oficial, reversión idempotente y nueva emisión mediante los RPC de Compras existentes.

La corrección solo permite dirección del comprador (01/04) y observaciones (01/04/07), antes de cualquier transmisión. Nunca cambia identidad, fecha, clave, importes, impuestos o sustento. La validación diferencia comprobante sin firma de firma validada: un XML aún no firmado informa esa limitación como advertencia.

El acceso al gestor requiere `commercial.electronic_documents.view`. Validación usa la nueva capability `commercial.electronic_documents.validate`; evidencia externa usa `commercial.electronic_documents.reconcile`. Consulta/reintento/pausa usan `authorize`, corrección usa `correct` y anulación usa el contrato específico existente. La migración registra las dos capabilities, pero no asigna permisos a usuarios ni perfiles. Los permisos se administran desde el panel canónico.

La evidencia XML aportada se valida criptográficamente y por identidad; se registra su hash y motivo. Solo una consulta oficial coincidente puede reconciliar la autorización; el XML devuelto por SRI se archiva mediante el almacenamiento fiscal existente.

## Verificación y publicación

Suites focales: `validate-sri-document-manager.cjs`, `validate-sri-document-manager-db.cjs`, `validate-sri-document-manager-client.cjs` y `validate-sri-document-manager-ui.cjs`. La prueba de UI usa Playwright con Edge y una página sintética con toda red bloqueada; configurar `SRI_MANAGER_PLAYWRIGHT` a una instalación de laboratorio. No abre una sesión ERP ni hace llamadas SRI.

Regresiones: safe retry, manual authorization recovery, dual documents/transport/frontend, withholding cancellation/UI y Ecuador fiscal date. La prueba DB aplica la migración dos veces sobre PGlite y datos sintéticos; verifica 20 solicitudes concurrentes y ausencia de cambios fiscales al pausar o registrar trámites.

Publicar únicamente esta migración forward-only después de tests/build y revisión de SHA. Comparar hashes de documentos, archivos, autorizaciones, intentos, secuencias, configuración y datos canónicos antes/después. Crear RC y verificar remoto y artefacto publicado antes de mover el dominio canónico.

Compensación: ante fallo previo al commit, la transacción revierte completa. Después de aplicar, conservar las tablas aditivas y deshabilitar la ruta de UI si fuera necesario mediante una RC focal. No eliminar eventos/versiones ni revertir ciegamente el lector de archivos después de una corrección: una revisión puede reutilizar un hash anterior y su puntero comprometido es la autoridad. Cualquier compensación de código/funciones debe ser forward-only, preservar los eventos y verificar las mismas regresiones. Un fallo de commit de corrección puede dejar un objeto privado sin referencia; nunca se selecciona como versión fiscal vigente.

Resultado de validación general adicional: `validate-project.mjs:190` falla al acceder a `airAdditionalPayload.erpEmission.transportType`. Reproducido en un checkout limpio de la base publicada `2f8a13b` con las mismas dependencias y sin el gestor; no es una regresión de este cambio. No se altera ese fixture ni el contrato de exportaciones. Las doce suites focales indicadas y el build con el runtime público de PROD pasan.
