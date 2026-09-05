# Fuentes oficiales SRI

Baseline utilizado por el modulo de comprobantes electronicos:

- Ficha tecnica: esquema offline 2.33, actualizada el 13 de julio de 2026.
- Factura: XML/XSD 1.1.0, paquete oficial publicado por el SRI.
- Nota de credito: XML/XSD 1.1.0, paquete oficial publicado por el SRI.
- Guia de remision: XML/XSD 1.1.0, paquete oficial publicado por el SRI.
- Firma: XAdES-BES 1.3.2, enveloped, UTF-8 y RSA-SHA1 conforme a la ficha 2.33.

## Origen

- Portal: https://www.sri.gob.ec/facturacion-electronica
- Ficha 2.33: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/5a547488-80f3-4966-a2a4-841f2e951986/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.33.pdf
- Factura: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/05546998-6f29-4870-be3b-62650f312a6c/XML%20y%20XSD%20Factura.zip
- Nota de credito: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/dfc944cd-5f18-4433-a626-3cc64cfc4549/XML%20y%20XSD%20Nota%20de%20Cr%C3%A9dito.zip
- Guia de remision: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/642ba34d-82d0-49d8-9622-5946f8eda268/XML%20y%20XSD%20Gu%C3%ADa%20de%20Remisi%C3%B3n.zip
- Dependencia XMLDSig: https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd

Los ZIP originales se conservan sin modificar. `schemas/` y `examples/` contienen copias con rutas ASCII para uso del backend y las pruebas. No se debe editar un XSD oficial; una actualizacion futura debe entrar en otra carpeta versionada.

## Hashes SHA-256

| Archivo | SHA-256 |
| --- | --- |
| `ficha-tecnica-offline-v2.33-2026-07.pdf` | `C839ADB17844A971CC09F4AC245D4EE96D9758221155C105C56CA65B88F1B251` |
| `factura-xsd-xml-oficial.zip` | `BA1FF0C4E329FE759C3F88DC75F2975780B315B6EB3D0069071B77C1F26FEC03` |
| `nota-credito-xsd-xml-oficial.zip` | `9B7E9C1A240AE39A858AA8FBAF91C41C761417E7BD763CCB20FFC0B81AD1BD43` |
| `guia-remision-xsd-xml-oficial.zip` | `2830D06822B7110F0DD29364320071F5389B8C4471B2C842FE965E38D6C59BA2` |

## Servicios de pruebas

- Recepcion: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline`
- Autorizacion: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`

Produccion queda declarada en configuracion, pero bloqueada por `production_enabled = false`.
