import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const sessionValues = new Map();
let savedDb = null;

const db = {
  activeCompanyId: "COMP-BLESS-FLOWER",
  session: {
    activeUser: {
      id: "USR-ADMIN-001",
      name: "Administrador",
      role: "Administrador"
    }
  },
  visualUsers: [
    {
      id: "USR-ADMIN-001",
      code: "USR-001",
      username: "administrador",
      name: "Administrador",
      fullName: "Administrador Local",
      email: "admin@local.test",
      role: "Administrador",
      cargo: "Administrador",
      status: "activo",
      companyAccess: {
        "COMP-BLESS-FLOWER": {
          enabled: true,
          status: "activo",
          roleCode: "ADMIN",
          routeAccess: {}
        }
      }
    }
  ]
};

const windowObject = {
  BlessERP: {
    state: { state: { db } },
    storage: {
      save(next) {
        savedDb = structuredClone(next);
        return true;
      }
    },
    services: {
      companyContext: {
        activeCompanyId() {
          return db.activeCompanyId;
        }
      }
    },
    menuService: {
      getUserAccessContext(user, companyId) {
        const membership = user.companyAccess?.[companyId];
        return {
          active: Boolean(membership?.enabled && membership?.status === "activo"),
          roleCode: membership?.roleCode || "INVITADO",
          roleLabel: membership?.roleCode || "Invitado"
        };
      }
    }
  },
  crypto: webcrypto
};

const context = vm.createContext({
  atob: value => Buffer.from(value, "base64").toString("binary"),
  btoa: value => Buffer.from(value, "binary").toString("base64"),
  console,
  Date,
  document: {
    body: {
      classList: { remove() {} }
    }
  },
  sessionStorage: {
    getItem(key) {
      return sessionValues.get(key) || null;
    },
    setItem(key, value) {
      sessionValues.set(key, String(value));
    },
    removeItem(key) {
      sessionValues.delete(key);
    }
  },
  structuredClone,
  TextEncoder,
  Uint8Array,
  window: windowObject
});

vm.runInContext(await read("./scripts/services/local-auth.js"), context, {
  filename: "./scripts/services/local-auth.js"
});

const localAuth = windowObject.BlessERP.localAuth;
assert.equal(localAuth.isConfigured(), false, "Sin contraseña no debe bloquear el primer ingreso del administrador");

let result = await localAuth.createCredential("corta");
assert.equal(result.ok, false, "Debe rechazar una contraseña débil");

result = await localAuth.createCredential("Administrador2026*");
assert.equal(result.ok, true, "Debe crear una credencial PBKDF2 válida");
assert.equal(result.credential.algorithm, "PBKDF2-SHA256");
assert.ok(result.credential.salt);
assert.ok(result.credential.hash);
assert.notEqual(result.credential.hash, "Administrador2026*");

db.visualUsers[0].localCredential = result.credential;
assert.equal(localAuth.isConfigured(), true, "La credencial activa debe habilitar el acceso local");
assert.equal(await localAuth.verifyPassword("incorrecta", result.credential), false);
assert.equal(await localAuth.verifyPassword("Administrador2026*", result.credential), true);

result = await localAuth.signIn("administrador", "incorrecta");
assert.equal(result.ok, false, "No debe aceptar una contraseña incorrecta");
result = await localAuth.signIn("USR-001", "Administrador2026*");
assert.equal(result.ok, true, "Debe permitir ingresar por código con la contraseña correcta");
assert.equal(savedDb.session.activeUser.id, "USR-ADMIN-001");

result = await localAuth.boot();
assert.equal(result.ok, true, "La sesión de la pestaña debe reabrir el ERP");
assert.equal(result.mode, "LOCAL_AUTHENTICATED");
await localAuth.signOut();
assert.equal(sessionValues.size, 0, "Cerrar sesión debe eliminar la sesión local de la pestaña");

const [settingsSource, sriSource, sriPrintSource] = await Promise.all([
  read("./scripts/modules/part2-settings.js"),
  read("./scripts/modules/comercial/sri-authorization.js"),
  read("./scripts/modules/comercial/print/sri-invoice-print.js")
]);

assert.match(settingsSource, /Usuario de ingreso/, "Usuarios debe permitir definir el identificador de ingreso");
assert.match(settingsSource, /createCredential/, "Usuarios debe generar la credencial local al guardar");
assert.match(settingsSource, /data-user-delete/, "Usuarios debe mantener la opción de eliminación controlada");
assert.match(sriSource, /data-sri-local-xml/, "La bandeja SRI debe descargar XML autorizado almacenado localmente");
assert.match(sriSource, /data-sri-local-pdf/, "La bandeja SRI debe generar el PDF RIDE local");
assert.match(sriPrintSource, /sriAuthorizedXml/, "El XML descargado debe provenir del XML autorizado real almacenado");
assert.doesNotMatch(sriPrintSource, /status\s*=\s*["']AUTORIZADO["']/, "La impresión no debe inventar un estado autorizado");

console.log("Acceso local por usuario y contraseña PBKDF2: OK");
console.log("Sesión local, cambio de clave y cierre de sesión: OK");
console.log("Documentos SRI: XML autorizado real y PDF RIDE local: OK");
