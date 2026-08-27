import { spawnSync } from "node:child_process";

const checks = [
  ["validate-project.mjs", "--operations"],
  ["validate-company-capabilities.mjs"],
  ["validate-user-access.mjs"],
  ["validate-local-auth-sri.mjs"],
  ["validate-label-pdf.mjs"],
  ["validate-availability-pieces.mjs"],
  ["validate-commercial-no-intercompany.mjs"],
  ["validate-commercial-order-draft-sync.mjs"],
  ["validate-commercial-order-atomic-identifiers.mjs"],
  ["validate-multi-company-commercial.mjs"],
  ["validate-payroll-flow.mjs"],
  ["validate-sri-documents-grid.mjs"],
  ["scripts/services/sri/validate-sri-multicompany.mjs"],
  ["validate-deployment-readiness.mjs"]
];

for (const [script, ...args] of checks) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

const build = spawnSync(process.execPath, ["build.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});
if (build.status !== 0) process.exit(build.status || 1);

const standaloneBuild = spawnSync(process.execPath, ["build-standalone.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});
if (standaloneBuild.status !== 0) process.exit(standaloneBuild.status || 1);

const localHtmlValidation = spawnSync(process.execPath, ["validate-local-html.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});
if (localHtmlValidation.status !== 0) process.exit(localHtmlValidation.status || 1);

console.log("VALIDACION_GENERAL_RELEASE_OK");
