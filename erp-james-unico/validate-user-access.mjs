import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
let idCounter = 0;
let storedUi = { currentRoute: "dashboard-home" };

const initialDb = {
  activeCompanyId: "COMP-BLESS-FLOWER",
  meta: { companyName: "Bless Flower", accountingPeriod: "Julio 2026" },
  session: {
    activeUser: {
      id: "USR-ADMIN-001",
      name: "James Lanchimba",
      role: "Administrador / Contador"
    },
    alerts: []
  },
  visualUsers: [
    {
      id: "USR-ADMIN-001",
      code: "USR-001",
      name: "James Lanchimba",
      fullName: "James Lanchimba",
      role: "Administrador / Contador",
      cargo: "Administrador / Contador",
      area: "Administracion",
      status: "activo"
    },
    {
      id: "USR-ACC-002",
      code: "USR-002",
      name: "Analista",
      fullName: "Analista Contable",
      role: "Asistente contable",
      cargo: "Asistente contable",
      area: "Contabilidad",
      status: "activo",
      companyAccess: {
        "COMP-BLESS-FLOWER": {
          enabled: true,
          status: "activo",
          roleCode: "CONTABILIDAD",
          routeAccess: {
            "accounting-journal": false,
            "commercial-order-master": true
          }
        },
        "COMP-IMPERIO-FLOWERS": {
          enabled: false,
          status: "inactivo",
          roleCode: "CONTABILIDAD",
          routeAccess: {}
        }
      }
    }
  ],
  documentSequences: [],
  costCenters: [],
  auditLogs: []
};
let persistedDb = structuredClone(initialDb);

const windowObject = {
  BlessERP: {
    utils: {
      clone: value => structuredClone(value),
      uid: prefix => `${prefix}-${String(++idCounter).padStart(4, "0")}`
    }
  },
  location: {
    search: "",
    href: "https://erp.example.test/?company=COMP-BLESS-FLOWER",
    protocol: "https:",
    hostname: "erp.example.test"
  },
  history: {
    replaceState() {}
  }
};

const context = vm.createContext({
  console,
  structuredClone,
  URL,
  URLSearchParams,
  window: windowObject
});

for (const file of [
  "./scripts/config/company-capabilities.js",
  "./scripts/config/navigation.js",
  "./scripts/config/navigation-tree.js",
  "./scripts/services/navigation/menu-service.js"
]) {
  vm.runInContext(await read(file), context, { filename: file });
}

const BlessERP = context.window.BlessERP;
const menu = BlessERP.menuService;
const { BLESS, IMPERIO } = BlessERP.companyCapabilities.COMPANY_IDS;

assert.equal(menu.normalizeRoleCode("Asistente administrativo"), "INVITADO", "Un cargo administrativo no debe convertirse en ADMIN por coincidencia parcial");
assert.equal(menu.normalizeRoleCode("Administrador / Contador"), "ADMIN");

const analyst = structuredClone(initialDb.visualUsers[1]);
assert.equal(menu.canUserAccessRoute(analyst, BLESS, "accounting-journal"), false, "La excepcion individual debe ocultar la ruta");
assert.equal(menu.canUserAccessRoute(analyst, BLESS, "commercial-order-master"), true, "La excepcion individual puede ampliar dentro del techo de empresa");
assert.equal(menu.getVisiblePagesForUser(analyst, IMPERIO).length, 0, "Una membresia inactiva no debe mostrar rutas");

const imperioAdmin = {
  id: "USR-IMP-TEST",
  status: "activo",
  companyAccess: {
    [IMPERIO]: {
      enabled: true,
      status: "activo",
      roleCode: "ADMIN",
      routeAccess: { "operations-postharvest": true }
    }
  }
};
assert.equal(
  menu.canUserAccessRoute(imperioAdmin, IMPERIO, "operations-postharvest"),
  false,
  "Un permiso individual no puede superar la capacidad funcional de Imperio"
);

BlessERP.storage = {
  loadUi() {
    return structuredClone(storedUi);
  },
  saveUi(next) {
    storedUi = structuredClone(next);
  },
  load() {
    return structuredClone(persistedDb);
  },
  save(next) {
    persistedDb = structuredClone(next);
    return true;
  },
  reset() {
    persistedDb = structuredClone(initialDb);
    return structuredClone(persistedDb);
  }
};
BlessERP.services = {
  companyContext: {
    activeCompanyId() {
      return BlessERP.state?.state?.db?.activeCompanyId || persistedDb.activeCompanyId;
    },
    hasCapability(capability) {
      return BlessERP.companyCapabilities.hasCapability(
        this.activeCompanyId(),
        capability
      );
    }
  }
};

vm.runInContext(await read("./scripts/core/state.js"), context, { filename: "./scripts/core/state.js" });
BlessERP.state.state.db.session.activeUser = {
  id: analyst.id,
  name: analyst.name,
  role: analyst.role
};
BlessERP.state.refreshNavigationAccess();
assert.equal(BlessERP.state.setRoute("accounting-journal"), false, "La navegacion directa debe respetar el permiso individual");
assert.equal(BlessERP.state.setRoute("commercial-order-master"), true, "La navegacion directa debe permitir una excepcion autorizada");

BlessERP.state.state.db.session.activeUser = {
  id: "USR-ADMIN-001",
  name: "James Lanchimba",
  role: "Administrador / Contador"
};
vm.runInContext(await read("./scripts/services/admin-config.js"), context, { filename: "./scripts/services/admin-config.js" });
const admin = BlessERP.services.adminConfig;
admin.ensureStore();

const draft = admin.createUserDraft();
Object.assign(draft, {
  name: "Validador Comercial",
  fullName: "Validador Comercial",
  cargo: "Vendedor",
  role: "Vendedor",
  area: "Ventas"
});
draft.companyAccess[BLESS].roleCode = "COMERCIAL";
let result = admin.saveUser(draft);
assert.equal(result.ok, true, "Debe crear un usuario con membresias editables");
const created = result.user;

const changed = structuredClone(created);
changed.companyAccess[BLESS].routeAccess["commercial-order-history"] = false;
result = admin.saveUser(changed);
assert.equal(result.ok, false, "Un cambio de accesos debe exigir motivo");
assert.ok(result.errors.some(error => error.includes("motivo")));

result = admin.saveUser(changed, { reason: "Limitar el historial comercial" });
assert.equal(result.ok, true, "Debe guardar el cambio justificado");
assert.ok(
  BlessERP.state.state.db.auditLogs.some(log => log.action === "EDITAR_USUARIO_ACCESOS" && log.reason === "Limitar el historial comercial"),
  "El cambio debe quedar auditado con antes, despues y motivo"
);

const selfLocked = structuredClone(admin.findUser("USR-ADMIN-001"));
selfLocked.companyAccess[BLESS].routeAccess["settings-users"] = false;
result = admin.saveUser(selfLocked, { reason: "Prueba de autobloqueo" });
assert.equal(result.ok, false, "El administrador activo no debe poder quitarse el acceso a Usuarios");

const inactive = structuredClone(admin.findUser(created.id));
inactive.status = "inactivo";
result = admin.saveUser(inactive);
assert.equal(result.ok, true, "Debe permitir inactivar un usuario que no es la sesion activa");
result = admin.removeUser(created.id, { reason: "Usuario temporal de validacion" });
assert.equal(result.ok, true, "Debe eliminar un usuario inactivo y sin uso operativo");
assert.ok(BlessERP.state.state.db.auditLogs.some(log => log.action === "ELIMINAR_USUARIO_SIN_USO"));

const settingsSource = await read("./scripts/modules/part2-settings.js");
const layoutSource = await read("./scripts/ui/layout.js");
const authAccessSource = await read("./scripts/services/supabase/auth-access.js");
const adminApiSource = await read("./api/admin-users.js");
const remoteUserAccessSource = await read("./scripts/services/supabase/user-access-remote.js");
const adminConfigSource = await read("./scripts/services/admin-config.js");
const appSource = await read("./app.js");
assert.match(settingsSource, /data-user-route-access/, "La pantalla debe incluir matriz editable por ruta");
assert.match(settingsSource, /VISTA PREVIA SEGURA/, "La pantalla debe incluir vista previa sin cambiar sesion");
assert.doesNotMatch(settingsSource, /data-set-active-user/, "La vista previa no debe suplantar el usuario activo");
assert.match(layoutSource, /enforceRouteVisibility/, "Los accesos internos tambien deben filtrarse");
assert.match(layoutSource, /Nube segura/, "Los despliegues remotos deben identificarse como nube segura");
assert.match(authAccessSource, /DIRECTORY_QUERY_TIMEOUT_MS/, "El directorio de acceso debe limitar consultas bloqueadas");
assert.match(authAccessSource, /transientDirectoryError/, "El directorio de acceso debe reintentar fallos transitorios del pool");
assert.match(authAccessSource, /\.eq\("user_id", userId\)/, "El ingreso debe consultar solamente la membresia, perfil y permisos del usuario actual");
assert.match(authAccessSource, /\.in\("id", companyIds\)/, "El ingreso debe consultar solamente las empresas vinculadas al usuario actual");
assert.match(authAccessSource, /ACCESS_CACHE_FRESH_MS/, "El caché normal de acceso debe tener una vigencia corta y verificable");
assert.match(authAccessSource, /ACCESS_CACHE_OFFLINE_MAX_AGE_MS/, "Debe existir continuidad controlada cuando Internet no responde");
assert.match(authAccessSource, /AUTHENTICATED_CACHE/, "El ingreso debe poder abrir rápidamente desde un caché reciente mientras revalida permisos");
assert.match(authAccessSource, /AUTHENTICATED_OFFLINE_CACHE/, "Una falla temporal de red no debe expulsar al usuario durante su jornada");
assert.match(authAccessSource, /Cargando JAEDER SYSTEMS/, "El acceso debe mostrar un estado visible mientras valida sesión y permisos");
assert.match(appSource, /renderFatalBootError/, "El arranque debe mostrar un error recuperable en lugar de dejar la pantalla en blanco");
assert.match(appSource, /LOAD_TIMEOUT/, "El arranque debe continuar si la sincronización remota excede el tiempo");
assert.match(settingsSource, /data-unlinked-user-enable/, "Las cuentas existentes en Supabase Auth deben poder habilitarse en el ERP");
assert.match(settingsSource, /user\.email \|\| user\.loginEmail/, "La lista debe mostrar el correo real de Supabase Auth cuando no exista correo de contacto");
assert.match(settingsSource, /preserveAuthEmail:\s*true/, "Al habilitar una cuenta existente debe conservarse su correo de inicio de sesión");
assert.match(adminApiSource, /email:\s*contactEmail \|\| loginEmail/, "El backend debe exponer el correo real de las cuentas sin perfil ERP");
assert.match(adminApiSource, /action === "update_access"/, "La edición debe usar una acción exclusiva de autorización");
assert.match(adminApiSource, /existingTargetUser/, "La edición debe conservar el Auth UUID existente");
const existingTargetSource = adminApiSource.slice(
  adminApiSource.indexOf("async function existingTargetUser"),
  adminApiSource.indexOf("async function createTargetUser")
);
assert.doesNotMatch(existingTargetSource, /(?:inviteUserByEmail|createUser|deleteUser|updateUserById|generateLink|resetPassword|recovery)/i, "La edición de accesos no debe mutar Auth");
assert.match(adminApiSource, /async function createTargetUser[\s\S]*authEmailForUsername[\s\S]*updateUserById[\s\S]*inviteUserByEmail/, "Create, contraseña e invitación deben conservar el contrato RC11");
assert.match(remoteUserAccessSource, /user\.cloudManaged\s*\?\s*"update_access"\s*:\s*"create_user"/, "Create y update deben usar contratos separados");
assert.match(remoteUserAccessSource, /preserveAuthEmail:\s*user\.preserveAuthEmail === true/, "La intención de conservar el correo Auth debe llegar al backend seguro");
assert.match(adminConfigSource, /cloudManaged:\s*current\.cloudManaged === true/, "La normalización debe conservar el vínculo con Supabase Auth");

console.log("Validacion integral de usuarios y visualizaciones: OK");
console.log("CRUD local, membresias, roles, excepciones por ruta y auditoria: OK");
console.log("Techo de empresa, menu, busqueda y navegacion directa: OK");
console.log("Vista previa segura y proteccion contra autobloqueo: OK");
console.log("Habilitacion de cuentas existentes en Supabase Auth: OK");
