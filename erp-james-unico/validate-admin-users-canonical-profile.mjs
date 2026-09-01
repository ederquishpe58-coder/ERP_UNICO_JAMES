import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const [api, remote, settings, adminConfig, migration, gerencia] = await Promise.all([
  read("./api/admin-users.js"),
  read("./scripts/services/supabase/user-access-remote.js"),
  read("./scripts/modules/part2-settings.js"),
  read("./scripts/services/admin-config.js"),
  read("./supabase/migrations/202609010001_admin_users_canonical_profile.sql"),
  read("./supabase/migrations/202608290001_gerencia_general_profile.sql")
]);

const saveBody = api.slice(api.indexOf("async function saveUserAccess"), api.indexOf("async function revokeUser"));
assert.ok(saveBody.length > 2500);
assert.match(saveBody, /CANONICAL_PROFILE_REQUIRED/);
assert.match(saveBody, /ACTIVE_CANONICAL_PROFILE_REQUIRED/);
assert.match(saveBody, /erp_admin_configure_user_access/);
assert.match(saveBody, /getSupabaseUserContext\(actorUser\.accessToken\)/);
assert.match(saveBody, /AUTH_CREATED/);
assert.match(saveBody, /ERP_CONFIGURATION_FAILED/);
assert.match(saveBody, /AUTH_COMPENSATION_SUCCESS/);
assert.match(saveBody, /AUTH_COMPENSATION_FAILED/);
assert.match(saveBody, /client\.auth\.admin\.deleteUser\(target\.id\)/);
assert.doesNotMatch(saveBody, /\.from\("user_route_permissions"\)/);
assert.doesNotMatch(saveBody, /updateUserById/);

assert.match(api, /canonicalProfileName:\s*canonicalProfile\?\.display_name\s*\|\|\s*"PROFILE_MISSING"/);
assert.match(api, /resource === "profiles"/);
assert.match(api, /admin\.users\.view/);
assert.match(api, /admin\.users\.manage/);
assert.match(api, /Solo un propietario puede asignar otro propietario/);
assert.match(api, /No puede eliminar su propia cuenta administradora/);
assert.match(api, /INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED/);

assert.match(remote, /profileId:\s*String\(access\.profileId/);
assert.match(remote, /const successful = responses\.filter\(item => item\.users\.ok && item\.profiles\.ok\)/);
assert.match(remote, /successful\.forEach\(\(\{ companyKey, users, profiles \}\) =>/);
assert.match(remote, /skippedCompanyKeys:/);
assert.doesNotMatch(remote, /const failed = responses\.find\(item => !item\.users\.ok \|\| !item\.profiles\.ok\);\s*if \(failed\) return/);
assert.doesNotMatch(remote, /permissionsFor\(/);
assert.doesNotMatch(remote, /permissions:\s*permissionsFor/);
assert.match(settings, /Perfil canónico/);
assert.match(settings, /Crear e invitar/);
assert.match(settings, /PROFILE_MISSING/);
assert.match(settings, /LEGACY VISIBLE/);
assert.match(settings, /Admin Users no crea permisos individuales/);
assert.match(adminConfig, /profileId:/);
assert.match(adminConfig, /legacyDependent:/);

assert.match(migration, /^begin;/m);
assert.match(migration, /create or replace function public\.erp_admin_configure_user_access/);
assert.match(migration, /create or replace function public\.erp_admin_revoke_user_company_access/);
assert.match(migration, /perform public\.erp_security_u2c4_assert_admin\(v_company_id, 'admin\.users\.manage'\)/);
assert.match(migration, /SECURITY_SELF_ELEVATION_DENIED/);
assert.match(migration, /OWNER_ROLE_ASSIGNMENT_REQUIRES_OWNER/);
assert.match(migration, /LAST_ACTIVE_OWNER_REQUIRED/);
assert.match(migration, /ACTIVE_CANONICAL_PROFILE_REQUIRED/);
assert.match(migration, /insert into public\.erp_security_user_company_profiles/);
assert.match(migration, /on conflict\(company_id, user_id\) do update/);
assert.match(migration, /delete from public\.erp_security_user_company_profiles/);
assert.match(migration, /legacy_route_permissions_written', 0/);
assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.user_route_permissions/i);
assert.match(migration, /grant execute on function public\.erp_admin_configure_user_access[\s\S]*to authenticated/);
assert.doesNotMatch(migration, /OWNER.*bypass|bypass.*OWNER/i);

assert.match(gerencia, /\('admin\.users\.view'\)/);
assert.match(gerencia, /\('admin\.users\.manage'\)/);

console.log(JSON.stringify({
  result: "PASS",
  canonicalProfileRequired: true,
  transactionalErpFinalizer: true,
  authCompensation: true,
  newLegacyWrites: 0,
  ownerBypass: false,
  gerencia: {
    "admin.users.view": true,
    "admin.users.manage": true
  }
}, null, 2));
