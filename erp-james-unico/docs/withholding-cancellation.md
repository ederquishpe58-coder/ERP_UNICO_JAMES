# Retención 07: descarte, anulación oficial y nueva emisión

## Autoridad

La [guía de anulación publicada por el SRI](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/c97242e6-c271-4eb8-8f6a-f687313118ba/Guia%20para%20contribuyentes%20de%20anulaci%C3%B3n%20de%20comprobantes%20electr%C3%B3nicos.pdf) documenta solicitud y confirmación en **SRI en Línea**. Una solicitud pendiente conserva la validez fiscal del comprobante. La [información oficial de agosto de 2025](https://www.sri.gob.ec/detalle-noticias?idnoticia=1160&marquesina=1) actualiza las condiciones de anulación y aceptación del receptor.

No se identificó una API pública de anulación oficialmente documentada en las fuentes revisadas. Este cambio no automatiza el portal ni consulta endpoints privados. Tampoco aplica los plazos antiguos de la guía como reglas nuevas en el ERP: el portal SRI determina la elegibilidad real.

## Flujo

- Sin transmisión: `BORRADOR`, `VALIDADO`, `XML_GENERADO` o `FIRMADO`, sin trabajos, intentos, respuestas ni autorización: **Descartar retención**. Conserva documento y número; revierte el asiento propio y reabre la compra.
- Autorizado: **Solicitar anulación** abre un trámite interno. La retención continúa `AUTORIZADO`.
- Después de presentar la solicitud en SRI en Línea: registrar su referencia. Trámite `PENDING_CANCELLATION`, documento todavía vigente.
- Solo cuando el portal muestra **ANULADO**: adjuntar constancia PDF/PNG/JPEG (máximo 2 MB), transcribir clave y autorización, indicar fecha y confirmar la verificación humana. La evidencia se conserva privadamente con SHA-256, actor y fecha. No se presenta como respuesta SOAP ni verificación automática.
- La confirmación, reversión contable y reapertura de la compra son una transacción. Un período cerrado, cuenta inválida, evidencia incompleta o versión obsoleta bloquean la operación completa.
- **Volver a retener** abre la preparación de un documento nuevo. La creación existente toma el NEXT vigente, otra clave y otro asiento. El vínculo conserva `previous_electronic_document_id`; solo existe una retención activa por compra.
- Pendiente, incierto, devuelto o no autorizado: este cambio no ofrece descarte ni reemplazo. Permanece el recovery canónico existente cuando sea elegible.

## Contabilidad y permisos

Se reutiliza `erp_financial_v2_reverse_journal`. El original conserva importes y líneas; el contrato canónico registra su estado `REVERSED` y crea otro asiento con `reverse_of_id`.

La emisión actual registra el efecto de retención en el diario (débito CxP, créditos específicos IR/IVA). No reduce nuevamente la tabla de CxP de proveedor. La anulación invierte esas mismas líneas; no suma por segunda vez el importe a dicha tabla. No se modifica el asiento de la compra.

Lectura: `purchases.withholdings.view`. Trámite: `purchases.withholdings.reverse`. Reversión final: además `accounting.journal.reverse`. Nueva emisión: conserva todos los controles existentes, incluido `purchases.withholdings.create`. Membresía activa y empresa autenticada obligatorias. No hay bypass OWNER. IMPERIO mantiene su restricción de emisión 07.

## Migración y operación

`202609080010_purchase_withholding_cancellation.sql` es forward-only. Agrega un expediente privado, una referencia histórica en los vínculos y unicidad parcial de vínculo activo. Modifica exclusivamente la búsqueda de vínculos activos del creador y dos lectores. No cambia lógica 01/04, XML, firma, transporte, contadores ni documentos existentes.

Aplicar solo esta migración después de validar sus dependencias contra PROD, pruebas aisladas y build. Verificar hashes semánticos antes/después de documentos, artefactos, intentos, compras, asientos, CxP, configuración y secuencias. La nueva columna nula del vínculo no constituye una modificación de identidad.

Compensación: antes de usar el flujo, puede restaurarse la app anterior y dejar las estructuras aditivas sin uso. Después de registrar un trámite o reversión, cualquier corrección debe ser forward-only y conservar expedientes, vínculos y asientos; no restaurar la PK antigua ni borrar el historial. No hay rollback automático de datos fiscales.

Pruebas: `node validate-withholding-cancellation.cjs`, `node validate-withholding-cancellation-ui.cjs`, `node validate-sri-manual-recovery-ui.cjs`, `node validate-sri-safe-retry.cjs`, `node validate-sri-dual-documents.cjs`. Todas usan fixtures/mocks; no transmiten documentos reales.
