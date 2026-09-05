# Fuentes oficiales SRI

Baseline vigente utilizado por el backend de comprobantes electronicos:

- Ficha tecnica offline 2.34, actualizada el 27 de julio de 2026.
- Factura 01: XML/XSD 1.1.0.
- Nota de credito 04: XML/XSD 1.1.0.
- Guia de remision 06: XML/XSD 1.1.0.
- Comprobante de retencion ATS 07: XML/XSD 2.0.0.
- Firma: XAdES-BES 1.3.2, enveloped, UTF-8 y RSA-SHA1.

## Origen

- Portal: https://www.sri.gob.ec/facturacion-electronica
- Ficha 2.34: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/f8d9bb36-5632-4f96-b463-b9265b55338c/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.34.pdf
- Retencion: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/90950fca-73a7-4cfb-9c2d-3142b10435f2/XML%20y%20XSD%20Comprobante%20de%20Retenci%C3%B3n.zip
- Factura, nota de credito y guia: copias XSD 1.1.0 sin modificaciones procedentes del baseline 2.33; la ficha 2.34 no cambia sus versiones XML.
- Dependencia XMLDSig: https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd

Los XSD oficiales no se editan. `schemas/` contiene copias con rutas ASCII para el backend y `examples/` conserva el ejemplo publicado por el SRI.

## Hashes SHA-256

| Archivo | SHA-256 |
| --- | --- |
| `ficha-tecnica-offline-v2.34-2026-07.pdf` | `7333AEBFBDF2CB3BA83F9FC67A7A7F0346CA59506480A260CC42F96DBDFC13C9` |
| `retencion-xsd-xml-oficial.zip` | `D365DEC7FFE15199DDB1EEFA8B91C12E4BDC884CBC40B4177410466148C255F8` |
| `schemas/07/comprobanteRetencion_v2.0.0.xsd` | `1E006D6D16C791C8F5B23D1F3E006CD066CCBA2BFB797A3CB9098BD09C793CB7` |

## Servicios de certificacion

- Recepcion: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline`
- Autorizacion: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`

La integracion real de esta etapa permanece forzada a `TEST`; los endpoints de produccion no se habilitan.
