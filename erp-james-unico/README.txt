ERP JAMES UNICO - SHELL BASE

Proyecto nuevo creado desde la base tecnica de Parte 2.

Objetivo actual:
- Un solo shell visual y un solo menu modular.
- Mantener activa la base administrativa/contable de Parte 2.
- Registrar Operaciones / Poscosecha y Comercial / Exportaciones como placeholders.
- No mover todavia la logica pesada de Parte 1 ni Parte 3.
- No tocar Supabase ni SQL en esta fase.

Estructura principal:
- index.html
- styles.css
- app.js
- scripts/config/navigation.js
- scripts/core/
- scripts/data/
- scripts/modules/part2.js
- scripts/ui/layout.js
- scripts/config/module-registry.js

Comandos:
- npm run build
- npm run build:standalone

Notas:
- Este proyecto no fusiona todavia la logica operativa ni comercial.
- El almacenamiento local usa claves separadas:
  - erp-james-unico-db
  - erp-james-unico-ui
