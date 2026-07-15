# CONFIGURACION SUPABASE DESACTIVADA

## Estado por defecto

Supabase queda desactivado por defecto.

El ERP sigue funcionando en modo local/demo.

## Variables necesarias

- `VITE_SUPABASE_ENABLED`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_ENV`
- `VITE_ENABLE_AUTH`
- `VITE_ENABLE_RLS`
- `VITE_ENABLE_SRI`
- `VITE_ENABLE_REAL_INVENTORY`
- `VITE_ENABLE_REAL_ACCOUNTING`
- `VITE_ENABLE_REAL_SCANNER`

## Diferencia entre `.env.example` y `.env.local`

- `.env.example` solo documenta variables
- `.env.local` se usara en el futuro para configuracion real por ambiente

## Regla de seguridad

- No subir claves reales al repositorio.
- No poner credenciales reales en `.env.example`.

## Que significa `VITE_SUPABASE_ENABLED=false`

- el cliente Supabase no se activa
- no se crea conexion real
- el ERP usa servicios demo/locales
- los modulos actuales no dependen de Supabase

## Que pasara cuando se active en el futuro

- `env.js` leera variables reales
- `supabase-client.js` podra construir un cliente real
- `repository-base.js` servira como patron de repositorios futuros

## Modulos que NO dependen todavia de Supabase

- Comercial demo
- Operaciones demo
- Despacho demo
- Scanner demo
- Consumo demo
- Contabilidad local/demo
- Inventario materiales local/demo

## Como verificar que sigue en modo demo

- revisar `.env.example`
- abrir `scripts/config/env.js`
- abrir `scripts/services/supabase/supabase-client.js`
- revisar el Diagnostico del ERP
- confirmar mensaje: Supabase desactivado. ERP usando modo local/demo.
