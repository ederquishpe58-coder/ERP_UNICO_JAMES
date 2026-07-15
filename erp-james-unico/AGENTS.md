# AGENTS.md

Instrucciones permanentes para Codex en el proyecto `Proyecto ERP JAMES / Bless Flower`.

## Alcance general

1. El ERP se construirá por fases.
2. La Parte 1 de poscosecha e inventario de rosas ya existe y no debe modificarse sin autorización explícita.
3. La Parte 2 es contable-administrativa y debe evolucionar sobre una base modular limpia.
4. Ventas, exportaciones, preorden, factura comercial, packing, guías y coordinación quedan para fase futura.
5. No implementar módulos grandes de golpe.
6. Antes de programar, siempre analizar impacto técnico y funcional.
7. No crear SQL sin aprobación explícita.
8. No tocar Supabase sin aprobación explícita.
9. No mezclar diseño visual con lógica contable.
10. Toda lógica contable debe salir del libro diario y de los asientos; no se deben “inventar” saldos por fuera del motor contable.
11. El stock se calcula por movimientos; no se digita manualmente como saldo final.
12. Todo documento importante debe tener auditoría.
13. Todo módulo debe tener estados consistentes, como mínimo: `borrador`, `confirmado` y `contabilizado` o `anulado`, según corresponda.
14. Las pantallas deben ser compactas, limpias y orientadas a productividad, con sidebar colapsable, submenús y filtros para ahorrar espacio.

## Reglas de implementación

- No tocar la Parte 1 ni mezclar inventario de rosas con inventario administrativo sin autorización.
- No mezclar todavía la capa comercial/exportadora con la Parte 2 contable-administrativa.
- Construir primero cascarón, navegación, formularios y servicios por módulo; luego lógica.
- Cada módulo nuevo debe quedar desacoplado, con archivos propios y expansión futura sencilla.
- Antes de añadir lógica nueva, revisar si afecta:
  - navegación
  - auditoría
  - estados del documento
  - libro diario
  - stock por movimientos
- Si una tarea implica datos reales, sincronización o tributación, confirmar primero si hay autorización.

## Prioridad arquitectónica

- Preferir estructura modular por dominio.
- Preferir listas separadas del formulario detalle.
- Preferir render del módulo activo en vez de render global.
- Preferir placeholders y fases pequeñas antes que implementar todo de una sola vez.

## Comandos detectados del proyecto

Raíz del proyecto actual:

- `C:\Users\Contador J\Downloads\Codex\Codex\2026-06-06\puedes-crear-un-erp-contable-y\outputs\erp-bless-v2`

Instalación:

- No se detectaron dependencias de npm obligatorias en `package.json`.
- Si se requiere inicializar entorno npm: `npm install`

Compilación:

- `npm run build`
- `npm run build:standalone`

Ejecución local:

- No se detectó script `start`, `dev` ni `serve`.
- Para pruebas rápidas, abrir `index.html` localmente o servir la carpeta con un servidor estático si luego se agrega uno.

Archivos relevantes de entrada:

- `index.html`
- `styles.css`
- `app.js`
- `scripts/config/navigation.js`
- `scripts/core/`
- `scripts/modules/`
- `scripts/ui/`

## Forma de trabajo esperada para Codex

- Antes de programar, explicar qué archivos se van a tocar cuando el cambio sea amplio.
- Hacer cambios pequeños y verificables.
- No introducir lógica tributaria, contable o de base de datos sin aprobación cuando aún no haya sido autorizada.
- Mantener separación clara entre:
  - shell visual
  - navegación
  - servicios
  - lógica de negocio
  - persistencia
