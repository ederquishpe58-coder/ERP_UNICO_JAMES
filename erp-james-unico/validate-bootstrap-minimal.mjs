import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sandbox = { window: { BlessERP: {} }, console };
vm.createContext(sandbox);
vm.runInContext(read("scripts/services/sync/entity-registry.js"), sandbox);
const registry = sandbox.window.BlessERP.syncEntityRegistry;
const inventory = registry.hydrationInventory();
const bootstrap = registry.preloadEntities();

assert(inventory.length === 129, `Se esperaban 129 entidades; se encontraron ${inventory.length}.`);
assert(bootstrap.length === 10, `Bootstrap mínimo esperado=10; actual=${bootstrap.length}.`);
assert(bootstrap.includes("operations_yield_workday"), "La jornada canónica debe hidratarse al iniciar sesión.");
assert(inventory.every(row => row.preloadClass && row.loadStrategy), "Existe una entidad sin decisión CONT-D.");
assert(inventory.filter(row => row.preload).every(row => row.preloadClass === "A_REQUIRED"), "Una entidad no obligatoria quedó en bootstrap.");
assert(inventory.filter(row => row.preloadClass === "B_DOMAIN_LAZY").every(row => row.domain), "Una entidad domain-lazy carece de dominio.");

const ignored = new Set(["dist", "node_modules", "VERCEL-UN-SOLO-ARCHIVO", "SALIDAS", ".git", ".release", "backups"]);
const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:js|mjs)$/i.test(entry.name)) sourceFiles.push(absolute);
  }
}
walk(path.join(root, "scripts"));
sourceFiles.push(path.join(root, "app.js"));
const sources = sourceFiles.map(file => ({
  file: path.relative(root, file).split(path.sep).join("/"),
  text: fs.readFileSync(file, "utf8")
}));
const mutationMarkers = /saveDb\s*\(|saveDbLocalOnly\s*\(|storage\??\.save|captureRecord\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/;
const legacyNames = new Set(["scripts/services/journal.js", "scripts/services/portfolios.js", "scripts/services/receivables.js", "scripts/services/reports.js", "scripts/services/banks.js"]);

const domainSource = read("scripts/services/sync/domain-loader.js");
const routeIds = [...read("scripts/config/navigation.js").matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map(match => match[1]);
const routeSandbox = {
  window: {
    BlessERP: { syncEntityRegistry: registry, state: { state: { db: {} } } },
    addEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout
  },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console, setTimeout, clearTimeout
};
vm.createContext(routeSandbox);
vm.runInContext(domainSource, routeSandbox);
const loader = routeSandbox.window.BlessERP.domainDataLoader;

const graph = inventory.map(row => {
  const pathNeedles = [row.entity, `state.db.${row.path}`, `db.${row.path}`, row.path];
  const consumers = sources.filter(source => pathNeedles.some(needle => source.text.includes(needle)));
  const readConsumers = consumers.map(item => item.file).filter(file => file !== "scripts/services/sync/entity-registry.js");
  const writeConsumers = consumers.filter(item => mutationMarkers.test(item.text)).map(item => item.file);
  const cacheConsumers = consumers.filter(item => /state\??\.db|BlessERP\.state|localStorage|indexedDB/i.test(item.text)).map(item => item.file);
  const realtimeConsumers = consumers.filter(item => /realtime|postgres_changes|canonical-record-updated|incremental-sync-applied/i.test(item.text)).map(item => item.file);
  const legacyConsumers = readConsumers.filter(file => legacyNames.has(file));
  const activeRoutes = row.domain ? routeIds.filter(route => loader.routeDomains(route).includes(row.domain)) : [];
  return {
    entity: row.entity,
    path: row.path,
    classification: row.preloadClass,
    strategy: row.loadStrategy,
    domain: row.domain || null,
    bootstrap: row.preload,
    readConsumers: [...new Set(readConsumers)].sort(),
    writeConsumers: [...new Set(writeConsumers)].sort(),
    cacheConsumers: [...new Set(cacheConsumers)].sort(),
    realtimeConsumers: [...new Set(realtimeConsumers)].sort(),
    legacyConsumers: [...new Set(legacyConsumers)].sort(),
    activeRoutes: [...new Set(activeRoutes)].sort(),
    dormant: row.preloadClass === "E_LEGACY_DORMANT"
  };
});

const outputDirectory = path.join(root, "LOCAL-DATA");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "cont-d-entity-consumer-graph.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  entities: graph.length,
  bootstrap,
  classifications: graph.reduce((acc, item) => ({ ...acc, [item.classification]: Number(acc[item.classification] || 0) + 1 }), {}),
  graph
}, null, 2)}\n`);

console.log("VALIDACION_BOOTSTRAP_MINIMAL_OK");
console.log(JSON.stringify({ entities: inventory.length, bootstrap: bootstrap.length, domainLazy: inventory.filter(row => row.preloadClass === "B_DOMAIN_LAZY").length, searchRpc: inventory.filter(row => row.preloadClass === "C_SEARCH_RPC").length, graph: "LOCAL-DATA/cont-d-entity-consumer-graph.json" }, null, 2));
