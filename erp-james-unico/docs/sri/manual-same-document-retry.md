# Reintento humano del mismo comprobante

El gestor conservaba `QUERY_AUTHORIZATION` para cualquier antecedente incierto, aun después de consultas oficiales sin resultado. El presupuesto manual de consulta podía continuar, pero no existía una decisión que habilitara un nuevo intento de recepción.

Este cambio agrega una excepción estrecha al gestor existente. No altera el retry automático ni su presupuesto. La evidencia debe incluir un fallo SOAP Server de recepción identificado (`Could not open connection` o `Invocation cannot proceed as component is shutting down`), el hash del XML utilizado y al menos dos consultas posteriores distintas con respuestas oficiales de ausencia verificables. Un HTTP 500 genérico, un timeout, el tiempo transcurrido o agotar el presupuesto no son suficientes.

La elegibilidad es una conclusión técnica limitada a esa evidencia; no se presenta como una autorización general del SRI para reenviar errores HTTP. La ficha técnica oficial 2.34 mantiene el código 70 en consulta, sin nueva clave ni secuencial. Los códigos 43/45/70, cualquier respuesta de recepción previa, autorización, gestión de anulación o evidencia incompleta bloquean esta excepción.

Fuente: https://www.sri.gob.ec/facturacion-electronica (Ficha técnica offline 2.34, procesamiento y claves/secuenciales registrados).

## Ejecución

1. El backend valida identidad, XML archivado, XSD, XAdES, certificado/RUC, campos fuente y evidencia. La UI recibe decisión y motivo.
2. El operador confirma número, clave, fecha y hash. La confirmación incluye una operación UUID nueva y la identidad mostrada.
3. Se adquiere el claim canónico de autorización y se revalida todo bajo ese claim. Se consulta oficialmente la misma clave en el ambiente persistido.
4. Una autorización recupera el mismo documento; procesamiento o respuesta inconclusa impiden recepción.
5. Ante ausencia y elegibilidad vigente, una RPC transfiere atómicamente el claim de consulta a recepción, registra la operación consumida y crea un intento técnico con el mismo hash. No consume el presupuesto automático ni numeraciones fiscales/contables.
6. El transporte compartido carga y verifica el mismo XML firmado. RECIBIDA o 43/45/70 conducen a consulta. Una nueva incertidumbre queda sin programación automática de recepción; no hay reenvío recursivo.

La operación consumida no puede repetirse. El claim document-level dura 180 segundos, mayor que el límite de ejecución de 120 segundos. Solo un claim manual auditado vencido puede recuperarse, exclusivamente hacia consulta. No se sostiene una transacción PostgreSQL durante la red. Las RPC privilegiadas solo admiten `service_role` y vuelven a validar actor, membresía, capability, empresa, ambiente y routing existentes.

## Publicación y compensación

Migración forward-only `202609090005_sri_manual_same_document_retry.sql`: dos RPC nuevas y extensión focal del claim manual de autorización. No contiene mutaciones de documentos existentes fuera de las acciones explícitas futuras. Aplicar únicamente este archivo con guard de definición previa y hashes de tablas protegidas, en una transacción. No usar apply-all.

Si la publicación debe retirarse antes de cualquier uso, devolver la app al release anterior y, mediante otra migración forward-only revisada, restaurar la definición anterior de `claim_sri_manual_authorization` y revocar las dos RPC nuevas. Si ya hubo intentos manuales, preservar sus auditorías/claims y su vía de consulta hasta finalizar: no eliminar leases ni historial como rollback.

Pruebas: `validate-sri-manual-same-document.cjs`, `validate-sri-manual-same-document-db.cjs` y `validate-sri-manual-same-document-ui.cjs`, más regresiones canónicas 01/04/07, transporte dual, manager y fecha Ecuador. Las pruebas usan fixtures sin red SRI. Los documentos 750/755 solo se inspeccionan y validan en memoria; su transmisión queda exclusivamente a confirmación humana posterior.
