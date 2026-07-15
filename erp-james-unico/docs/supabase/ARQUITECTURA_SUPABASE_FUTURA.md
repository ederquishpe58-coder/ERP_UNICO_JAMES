# ARQUITECTURA SUPABASE FUTURA

## A. Estado actual

- El ERP trabaja en modo local/demo.
- Supabase no esta conectado.
- No se han ejecutado migraciones.
- No hay tablas reales creadas desde esta fase.

## B. Objetivo futuro

- Persistencia real de datos.
- Usuarios y roles.
- Auditoria.
- Multiempresa futura si aplica.
- Integracion Comercial, Operaciones, Contabilidad e Inventario.
- Preparacion para SRI, scanner real y reportes.

## C. Principios

- Primero estabilizar modulos.
- No mezclar inventario de rosas con inventario de materiales.
- Comercial no crea inventario de rosas.
- Operaciones genera disponibilidad.
- Comercial reserva.
- Despacho consume inventario operativo futuro.
- Contabilidad no recibe ventas reales hasta definir facturacion SRI.
- Toda accion critica debe tener auditoria.

## D. Capa de datos futura

### Core

Responsable de:
- empresa
- usuarios
- roles
- configuracion
- secuenciales
- auditoria

### Comercial / Exportaciones

Responsable de:
- clientes
- marcas
- pedidos
- cajas
- lineas
- documentos comerciales
- workflow comercial

### Operaciones / Poscosecha

Responsable de:
- recepcion
- clasificacion
- inventario de rosas
- disponibilidad
- reservas
- despacho
- scanner
- consumo operativo
- kardex operativo

### Inventario materiales

Responsable de:
- items materiales
- stock
- movimientos
- reglas de empaque
- requerimientos de empaque

### Contabilidad / Administracion

Responsable de:
- catalogo contable
- asientos
- compras
- retenciones
- CxP
- CxC
- bancos
- parametros tributarios

## E. Orden recomendado de adopcion

1. Core minimo
2. Comercial base
3. Operaciones base
4. Inventario materiales
5. Contabilidad base
6. SRI y documentos electronicos

## F. Regla de seguridad de esta fase

- No conectar Supabase.
- No ejecutar SQL.
- No crear migraciones reales.
- No tocar variables de entorno.
- No crear tablas reales.

Esta fase solo disena la arquitectura futura.
