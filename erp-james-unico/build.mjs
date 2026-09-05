import { access, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");
const staging = path.join(root, ".dist-build");

const entries = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "styles.css",
  "styles",
  "app.js",
  "README.txt",
  "scripts"
];

// Verifica todos los insumos antes de tocar la compilacion funcional existente.
await Promise.all(entries.map(entry => access(path.join(root, entry))));
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

for (const entry of entries) {
  await cp(path.join(root, entry), path.join(staging, entry), { recursive: true });
}

const publicEnvNames = [
  "VITE_SUPABASE_ENABLED", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY",
  "VITE_APP_ENV", "VITE_COMPANY_MODE", "VITE_ENABLE_AUTH", "VITE_ENABLE_RLS",
  "VITE_ENABLE_SRI", "VITE_ENABLE_REAL_ACCOUNTING", "VITE_ENABLE_REAL_INVENTORY",
  "VITE_ENABLE_REAL_SCANNER", "VITE_ENABLE_CORE_SUPABASE", "VITE_ENABLE_INCREMENTAL_SYNC",
  "VITE_ENABLE_ACCOUNTING_SUPABASE", "VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE",
  "VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE", "VITE_ENABLE_OPERATIONS_SUPABASE",
  "VITE_ENABLE_SCANNER_SUPABASE", "VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE",
  "VITE_ENABLE_SRI_SUPABASE", "VITE_ENABLE_OPERATIONS_V2_CAPTURE",
  "VITE_ENABLE_ZEBRA_V2_CAPTURE", "VITE_ENABLE_WAREHOUSE_V2_CAPTURE",
  "VITE_ENABLE_DISPATCH_V2_CAPTURE", "VITE_ENABLE_EXPORT_V2_CAPTURE",
  "VITE_ENABLE_FINANCIAL_V2_CAPTURE", "VITE_ENABLE_SUPPLIER_FINANCE_V2_CAPTURE", "VITE_ENABLE_TREASURY_V2_CAPTURE",
  "VITE_ENABLE_PAYROLL_V2_CAPTURE"
];
const publicEnv = Object.fromEntries(publicEnvNames.map(name => [name, process.env[name] || ""]));
await writeFile(
  path.join(staging, "scripts", "config", "runtime-env.js"),
  `(function(){window.__ERP_ENV__={...(window.__ERP_ENV__||{}),...${JSON.stringify(publicEnv)}};})();\n`,
  "utf8"
);

await rm(output, { recursive: true, force: true });
try {
  await rename(staging, output);
} catch (error) {
  if (!(["EPERM", "EACCES", "EBUSY"].includes(error?.code))) throw error;
  // Windows puede mantener una vista previa o análisis antivirus sobre dist y
  // bloquear el rename aun después de borrarla. La copia conserva el mismo
  // resultado sin dejar una compilación incompleta.
  await mkdir(output, { recursive: true });
  await cp(staging, output, { recursive: true });
  await rm(staging, { recursive: true, force: true });
}

console.log(`JAEDER SYSTEMS preparado en ${output}`);
