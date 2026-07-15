# MIGRACION DATOS DEMO A REALES

## Principio base

Los datos demo actuales no deben migrarse automaticamente sin revision.

## Reglas

- Primero se deben separar datos de prueba y datos reales.
- Se puede crear seed controlado solo para catalogos.
- No migrar pedidos demo como reales.
- No migrar consumos demo como reales.
- No migrar kardex demo como real.
- No migrar documentos demo como oficiales.

## Seed futuro recomendado solo para

- empresa demo
- roles
- secuenciales
- catalogos comerciales iniciales
- productos exportables
- variedades si aplica

## Pendiente

Crear script de seed futuro solo despues de definir:
- company real
- usuarios reales
- catalogos aprobados
- ambiente de pruebas
