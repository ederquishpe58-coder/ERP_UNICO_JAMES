# Lectura autenticada del caso SRI

El archivo read-sri-country-case.js define una funcion READ ONLY. No ejecuta
consultas al cargarse. Revisarlo y ejecutarlo como Snippet de DevTools en la
pestana ERP donde James ya tiene seleccionada IMPERIO. No introducir credenciales.

Luego ejecutar en la consola de esa misma pestana:

```js
const company = BlessERP.authAccess.activeAccess().activeCompany;
await readSriCountryCase({
  companyId: company.id,
  companyName: company.name,
  orderNumber: "PED-COM-2026-0003"
});
```

Antes de ejecutar, comprobar visualmente que la empresa seleccionada es IMPERIO.
Si activeCompany.name no esta disponible, introducir el nombre exacto que muestra
la empresa; el lector lo contrasta contra companies. El numero es solo un parametro
de diagnostico y no forma parte del resolutor ni del comportamiento de la app.

El lector verifica el usuario con auth.getUser, consulta el historial canonico
del repositorio y resuelve record_id por empresa y numero. Consulta el catalogo
autorizado y los registros fiscales mediante SELECT con RLS. No usa cache de
pedidos ni snapshots locales. No incluye tokens ni informacion de certificados.

Una lectura denegada se informa como NOT_VERIFIED. Cero filas con RLS nunca
demuestra por si solo ausencia de pedido, reserva o documento. La salida limita
el documento fiscal a ID, estado y codigo de pais del snapshot.

No llama a crear borrador, reservar, guardar, corregir, firmar ni autorizar.
La funcion no altera el pedido, el catalogo ni los snapshots fiscales.
