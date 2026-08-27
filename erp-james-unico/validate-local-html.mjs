import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const stripQuery = value => value.split(/[?#]/, 1)[0];
const localAssets = (html, expression) => [...html.matchAll(expression)]
  .map(match => stripQuery(match[1]))
  .filter(value => !/^(?:[a-z]+:|\/\/|#)/i.test(value));

const [source, local, envSource, storageSource] = await Promise.all([
  read("index.html"),
  read("SALIDAS/LOCAL/JAEDER-SYSTEMS-LOCAL.html"),
  read("scripts/config/env.js"),
  read("scripts/core/storage.js")
]);

const sourceScripts = localAssets(
  source,
  /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi
);
const sourceStyles = localAssets(
  source,
  /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi
);
const embeddedScripts = [...local.matchAll(/<script\b[^>]*data-source="([^"]+)"[^>]*>/g)].map(match => match[1]);
const embeddedAppScripts = embeddedScripts;
const embeddedStyles = [...local.matchAll(/<style data-source="([^"]+)">/g)].map(match => match[1]);

assert.ok(sourceScripts.length >= 190, "El HTML fuente debe cargar el conjunto completo de scripts de JAEDER SYSTEMS");
assert.deepEqual(embeddedAppScripts, sourceScripts, "El HTML local debe embeber todos los scripts y respetar su orden");
assert.deepEqual(embeddedStyles, sourceStyles, "El HTML local debe embeber todos los estilos y respetar su orden");
const outerMarkup = local
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
assert.doesNotMatch(outerMarkup, /<script\b[^>]*\bsrc=/i, "El HTML local no debe depender de scripts externos");
assert.doesNotMatch(outerMarkup, /<link\b[^>]*rel=["']stylesheet["']/i, "El HTML local no debe depender de hojas de estilo externas");

const localModePosition = local.indexOf("window.__ERP_LOCAL_MODE__ = true");
const runtimePosition = local.indexOf('data-source="scripts/config/runtime-env.js"');
assert.ok(localModePosition >= 0, "El HTML local debe declarar explícitamente el modo local");
assert.ok(runtimePosition > localModePosition, "El modo local debe configurarse antes de leer el entorno");
assert.match(local, /window\.__JAEDER_LOCAL_BUILD__ = true/, "El artefacto local debe permanecer aislado incluso si se sirve por localhost");
assert.ok(!embeddedScripts.some(source => source.startsWith("LOCAL-DATA/")), "El HTML local no debe incrustar capturas de Vercel");
assert.doesNotMatch(local, /online-browser-snapshot/i, "El HTML local no debe importar datos anteriores de la web");
assert.doesNotMatch(local, /https:\/\/[^"']+\.supabase\.co/i, "El HTML local no debe contener la URL del proyecto Supabase");

for (const flag of [
  "VITE_SUPABASE_ENABLED",
  "VITE_ENABLE_AUTH",
  "VITE_ENABLE_CORE_SUPABASE",
  "VITE_ENABLE_SRI_SUPABASE"
]) {
  assert.match(
    local.slice(localModePosition, runtimePosition),
    new RegExp(`${flag}: "false"`),
    `${flag} debe estar desactivado al abrir el HTML local`
  );
}

for (const requiredSource of [
  "scripts/services/supabase/auth-access.js",
  "scripts/services/local-auth.js",
  "scripts/services/supabase/cloud-state-sync.js",
  "scripts/modules/comercial/flow-v2/commercial-flow-core.js",
  "scripts/modules/comercial/flow-v2/commercial-flow-ui.js",
  "scripts/modules/comercial/flow-v2/cold-room-ui.js",
  "scripts/modules/comercial/intercompany-service.js",
  "scripts/modules/comercial/sri-authorization.js",
  "scripts/modules/comercial/print/sri-invoice-print.js",
  "scripts/modules/comercial/print/box-labels-print.js",
  "scripts/modules/operaciones/disponibilidad.js",
  "scripts/modules/operaciones/pantalla-rendimientos.js",
  "scripts/modules/payroll/payroll-engine.js",
  "scripts/modules/payroll/payroll-print.js",
  "scripts/modules/payroll/index.js",
  "app.js"
]) {
  assert.ok(
    embeddedScripts.includes(requiredSource),
    `Falta el módulo obligatorio ${requiredSource} en el HTML local`
  );
}

const context = vm.createContext({
  console,
  window: {
    __ERP_LOCAL_MODE__: true,
    __ERP_ENV__: {
      VITE_SUPABASE_ENABLED: "true",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-test-key",
      VITE_ENABLE_AUTH: "true",
      VITE_ENABLE_RLS: "true",
      VITE_ENABLE_CORE_SUPABASE: "true",
      VITE_ENABLE_INCREMENTAL_SYNC: "true"
    },
    BlessERP: {},
    location: { protocol: "file:" }
  }
});
context.globalThis = context;
vm.runInContext(envSource, context, { filename: "env.js" });
const isolated = context.window.BlessERP.getEnvConfig();
assert.equal(isolated.supabaseEnabled, false, "file:// no debe poder reactivar Supabase desde runtime-env.js");
assert.equal(isolated.authEnabled, false, "file:// no debe poder reactivar Supabase Auth");
assert.equal(isolated.incrementalSyncEnabled, false, "file:// no debe poder reactivar la sincronización incremental");
assert.equal(isolated.supabaseUrl, "", "file:// no debe conservar la URL de Supabase");
assert.match(storageSource, /jaeder-systems-local-isolated-db-v1/, "El modo local debe utilizar una base separada de la web");
assert.match(storageSource, /LOCAL-WORKSPACE-ADMIN/, "La copia local debe crear un operador técnico para mostrar todos los módulos");
assert.match(storageSource, /localWorkspaceOnly:\s*true/, "El operador técnico debe quedar identificado como exclusivo del HTML local");

console.log(`JAEDER SYSTEMS local completo: OK | scripts=${embeddedAppScripts.length} | captura web=0 | estilos=${embeddedStyles.length}`);
console.log("Aislamiento file:///localhost, operador local completo y Supabase desactivado: OK");
