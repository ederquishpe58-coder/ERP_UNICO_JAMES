import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of [
  "index.html",
  "index-local.html",
  "index-local-unlocked.html",
  "styles.css",
  "styles",
  "app.js",
  "README.txt",
  "scripts"
]) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}

console.log(`ERP JAMES UNICO preparado en ${output}`);
