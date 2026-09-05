import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releasesRoot = path.join(root, "SALIDAS");
const output = path.join(root, "VERCEL-UN-SOLO-ARCHIVO");
const localDirectory = path.join(releasesRoot, "LOCAL");
const localOutput = path.join(localDirectory, "JAEDER-SYSTEMS-LOCAL.html");
const staging = path.join(root, ".standalone-build");
const htmlSource = await readFile(path.join(root, "index.html"), "utf8");

const stripQuery = value => value.split(/[?#]/, 1)[0];
const isLocalAsset = value => !/^(?:[a-z]+:|\/\/|#)/i.test(value);
const safeScript = source => source.replace(/<\/script/gi, "<\\/script");
const imageMimeTypes = Object.freeze({
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
});

const stylesheetTags = [...htmlSource.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
  .filter(match => isLocalAsset(match[1]));
const scriptTags = [...htmlSource.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)]
  .filter(match => isLocalAsset(match[1]));

if (!stylesheetTags.length || !scriptTags.length) {
  throw new Error("index.html no contiene los estilos o scripts locales esperados");
}

const [styles, scripts] = await Promise.all([
  Promise.all(stylesheetTags.map(match => readFile(path.join(root, stripQuery(match[1])), "utf8"))),
  Promise.all(scriptTags.map(match => readFile(path.join(root, stripQuery(match[1])), "utf8")))
]);

const lazyGroupOf = match => match[0].match(/data-jaeder-lazy-group=["']([^"']+)["']/i)?.[1] || "";

const replacements = [
  ...stylesheetTags.map((match, index) => ({
    index: match.index,
    length: match[0].length,
    content: `<style data-source="${stripQuery(match[1])}">\n${styles[index]}\n</style>`
  })),
  ...scriptTags.map((match, index) => ({
    index: match.index,
    length: match[0].length,
    content: lazyGroupOf(match)
      ? `<script type="application/x-jaeder-lazy-source" data-jaeder-lazy-group="${lazyGroupOf(match)}" data-source="${stripQuery(match[1])}">\n${safeScript(scripts[index])}\n</script>`
      : `<script data-source="${stripQuery(match[1])}">\n${safeScript(scripts[index])}\n</script>`
  }))
].sort((left, right) => right.index - left.index);

let html = htmlSource;
for (const replacement of replacements) {
  html = `${html.slice(0, replacement.index)}${replacement.content}${html.slice(replacement.index + replacement.length)}`;
}

const assetRoot = path.join(root, "scripts", "assets");
const assetEntries = await readdir(assetRoot, { recursive: true, withFileTypes: true });
for (const entry of assetEntries) {
  if (!entry.isFile()) continue;
  const extension = path.extname(entry.name).toLowerCase();
  const mimeType = imageMimeTypes[extension];
  if (!mimeType) continue;
  const absolutePath = path.join(entry.parentPath, entry.name);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  const dataUrl = `data:${mimeType};base64,${(await readFile(absolutePath)).toString("base64")}`;
  html = html.replaceAll(relativePath, dataUrl);
}

// El contenido embebido puede traer tabulaciones al final de una línea desde
// dependencias minificadas. No son parte funcional del JavaScript y ensucian
// la verificación del artefacto generado.
html = html.replace(/[ \t]+(?=\r?\n)/g, "");
const localRuntime = `<script data-source="scripts/config/runtime-env.js">
window.__JAEDER_LOCAL_BUILD__ = true;
window.__ERP_LOCAL_MODE__ = true;
window.__ERP_ENV__ = {
  VITE_SUPABASE_ENABLED: "false",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_ANON_KEY: "",
  VITE_APP_ENV: "local-isolated",
  VITE_COMPANY_MODE: "multi",
  VITE_ENABLE_AUTH: "false",
  VITE_ENABLE_RLS: "false",
  VITE_ENABLE_CORE_SUPABASE: "false",
  VITE_ENABLE_INCREMENTAL_SYNC: "false",
  VITE_ENABLE_ACCOUNTING_SUPABASE: "false",
  VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE: "false",
  VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE: "false",
  VITE_ENABLE_OPERATIONS_SUPABASE: "false",
  VITE_ENABLE_SCANNER_SUPABASE: "false",
  VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE: "false",
  VITE_ENABLE_SRI_SUPABASE: "false"
  ,VITE_ENABLE_PAYROLL_V2_CAPTURE: "false"
};
</script>`;
const localHtml = html.replace(
  /<script data-source="scripts\/config\/runtime-env\.js">[\s\S]*?<\/script>/i,
  localRuntime
);

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await writeFile(path.join(staging, "index.html"), html, "utf8");
await rm(output, { recursive: true, force: true });
await rename(staging, output);
await mkdir(localDirectory, { recursive: true });
await writeFile(localOutput, localHtml, "utf8");

console.log(`JAEDER SYSTEMS standalone preparado en ${path.join(output, "index.html")}`);
console.log(`JAEDER SYSTEMS local preparado en ${localOutput}`);
