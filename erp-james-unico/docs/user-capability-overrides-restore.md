# Permisos específicos por membership

El directorio remoto ya entregaba `membership.id` y `membership_status`. `admin-config.normalizeCompanyAccess` descartaba ambos al normalizar usuarios; el editor confundía una membership existente con una pendiente de creación y ocultaba su panel. Además, el render excluía explícitamente al usuario conectado.

El normalizador conserva ahora esos metadatos. El editor monta el panel canónico existente para memberships reconocidas, con las etiquetas y búsqueda de `capability-presentation-es.js`. No se usa la matriz legacy de rutas. Se conserva la separación entre el editor de identidad/rol y el plan atómico de perfil/overrides: al abrir este último se bloquean los controles exteriores durante la edición del plan.

La migración `202609090001_user_access_plan_self_read.sql` modifica exclusivamente la vista previa existente. Permite consultar el propio plan sin parámetros de modificación y devuelve `can_edit=false`. Cualquier vista previa propia con cambios y el guardado propio siguen bloqueados. Un administrador distinto debe tener membership activa, `admin.users.manage` y la autoridad requerida para administrar el rol del destinatario; OWNER no es un bypass.

Persistencia: `erp_security_user_company_profiles` + `erp_security_user_capability_overrides`. Precedencia canónica: DENY > GRANT > PROFILE. El RPC `erp_admin_configure_user_access_plan` conserva atomicidad, motivo, operation ID, state token, auditoría y segunda lectura de confirmación. El formulario envía únicamente overrides explícitos y bloquea la revisión si el token cambió desde la carga.

Para James/ BLESS, el panel propio sirve para consultar y buscar `purchases.withholdings.reverse`. Asignarlo requiere otro actor autorizado según el contrato vigente. Este release no asigna permisos, no crea memberships y no modifica perfiles globales.

Pruebas: `node validate-user-overrides-restore-db.cjs` (PGlite, funciones canónicas actuales y fixtures sintéticos) y `node validate-user-overrides-restore-ui.mjs` (Chrome aislado, únicamente servidor localhost). No se utilizan sesiones PROD ni se cambian permisos reales.

Aplicación: verificar las definiciones actuales antes de aplicar únicamente esta migración forward-only. Es idempotente y aborta ante un contrato inesperado. No modifica filas. Compensación: restaurar la app anterior mantiene las restricciones de escritura; una eventual compensación DB debe restaurar solo la condición de lectura propia, sin tocar datos de seguridad ni el RPC de guardado.
