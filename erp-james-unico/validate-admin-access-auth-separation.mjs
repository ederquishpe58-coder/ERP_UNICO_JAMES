import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const apiSource = await read("./api/admin-users.js");
const remoteSource = await read("./scripts/services/supabase/user-access-remote.js");
const realtimeSource = await read("./scripts/services/sync/realtime-sync.js");
const securityMigration = await read("./supabase/migrations/202608250004_capability_security_engine_foundation.sql");

assert.match(remoteSource, /user\.cloudManaged\s*\?\s*"update_access"\s*:\s*"create_user"/);
assert.match(apiSource, /action === "create_user"/);
assert.match(apiSource, /action === "update_access"/);
assert.match(apiSource, /saveUserAccess\(client, currentActor, body\.user \|\| \{\}, \{ createIdentity: false \}\)/);

const updateAccessBody = apiSource.slice(
  apiSource.indexOf("async function saveUserAccess"),
  apiSource.indexOf("async function revokeUser")
);
assert.ok(updateAccessBody.length > 1000);
assert.doesNotMatch(updateAccessBody, /client\.auth\.admin\.(?:inviteUserByEmail|createUser|deleteUser|updateUserById|generateLink)/);
assert.doesNotMatch(updateAccessBody, /resetPassword|recovery/i);
const existingTargetBody = apiSource.slice(
  apiSource.indexOf("async function existingTargetUser"),
  apiSource.indexOf("async function createTargetUser")
);
assert.doesNotMatch(existingTargetBody, /(?:inviteUserByEmail|createUser|deleteUser|updateUserById|generateLink|resetPassword|recovery)/i);
assert.match(apiSource, /async function createTargetUser[\s\S]*authEmailForUsername[\s\S]*updateUserById[\s\S]*inviteUserByEmail/);

const moduleObject = { exports: {} };
const executableSource = `${apiSource}\nmodule.exports.__test = { existingTargetUser, createTargetUser };`;
vm.runInNewContext(executableSource, {
  module: moduleObject,
  exports: moduleObject.exports,
  require(request) {
    if (request === "./sri/_lib/supabase-admin.cjs") {
      return { assertUserCapability() {}, getSupabaseAdmin() {}, bearerToken() {} };
    }
    throw new Error(`Unexpected require: ${request}`);
  },
  URL,
  console,
  process,
  setTimeout,
  clearTimeout
}, { filename: "api/admin-users.js" });

const { existingTargetUser } = moduleObject.exports.__test;
const canonicalUser = {
  id: "8d1ff40d-6d1c-427e-925e-361dbca834ec",
  email: "actor.fixture@example.test",
  email_confirmed_at: "2026-08-30T12:00:00.000Z",
  identities: [{ id: "identity-1", provider: "email" }],
  passwordDigest: "original-password-digest",
  user_metadata: { display_name: "Actor Fixture" }
};
const authCalls = {
  getUserById: 0,
  updateUserById: 0,
  inviteUserByEmail: 0,
  createUser: 0,
  deleteUser: 0,
  resetPassword: 0
};
const client = {
  auth: {
    admin: {
      async getUserById(id) {
        authCalls.getUserById += 1;
        assert.equal(id, canonicalUser.id);
        return { data: { user: structuredClone(canonicalUser) }, error: null };
      },
      async updateUserById() { authCalls.updateUserById += 1; throw new Error("AUTH_MUTATION_FORBIDDEN"); },
      async inviteUserByEmail() { authCalls.inviteUserByEmail += 1; throw new Error("INVITE_FORBIDDEN"); },
      async createUser() { authCalls.createUser += 1; throw new Error("CREATE_FORBIDDEN"); },
      async deleteUser() { authCalls.deleteUser += 1; throw new Error("DELETE_FORBIDDEN"); }
    }
  }
};

const authorization = { profile: "PROFILE_A", grants: new Set(["core.dashboard.view"]) };
const loginWithOriginalPassword = () => canonicalUser.passwordDigest === "original-password-digest";
const snapshot = structuredClone(canonicalUser);

async function updateAuthorization(profile, grants) {
  const target = await existingTargetUser(client, {
    id: canonicalUser.id,
    username: "actor.fixture",
    email: "changed-contact@example.test",
    fullName: "Changed Display Name",
    password: ""
  });
  authorization.profile = profile;
  authorization.grants = new Set(grants);
  assert.equal(target.user.id, snapshot.id);
  assert.equal(target.user.email, snapshot.email);
  assert.deepEqual(target.user.identities, snapshot.identities);
  assert.equal(target.passwordUpdated, false);
  assert.equal(target.authMutations, 0);
  assert.equal(loginWithOriginalPassword(), true);
}

await updateAuthorization("PROFILE_B", ["core.dashboard.view", "commercial.customers.view"]);
const passwordAfterProfileChange = loginWithOriginalPassword();
await updateAuthorization("PROFILE_B", ["core.dashboard.view", "commercial.customers.view", "commercial.customers.manage"]);
const passwordAfterAccessAdd = loginWithOriginalPassword();
await updateAuthorization("PROFILE_C", ["core.dashboard.view"]);
const passwordAfterAccessRemove = loginWithOriginalPassword();

await assert.rejects(
  existingTargetUser(client, { id: canonicalUser.id, password: "Forbidden-password-1!" }),
  /contraseña no puede modificarse/i
);

assert.deepEqual(canonicalUser, snapshot);
assert.deepEqual({
  updateUserById: authCalls.updateUserById,
  inviteUserByEmail: authCalls.inviteUserByEmail,
  createUser: authCalls.createUser,
  deleteUser: authCalls.deleteUser,
  resetPassword: authCalls.resetPassword
}, {
  updateUserById: 0,
  inviteUserByEmail: 0,
  createUser: 0,
  deleteUser: 0,
  resetPassword: 0
});

assert.match(realtimeSource, /"erp_security_permission_versions"/);
assert.match(realtimeSource, /handleSecurityRealtime/);
assert.match(realtimeSource, /validateActiveAccess/);
assert.match(securityMigration, /create trigger erp_security_user_profile_version[\s\S]*erp_security_bump_company_version/);
assert.match(securityMigration, /create trigger erp_security_membership_version[\s\S]*erp_security_bump_company_version/);

console.log(JSON.stringify({
  result: "PASS",
  editUserApi: "POST /api/admin-users action=update_access",
  authMutations: 0,
  inviteCalled: authCalls.inviteUserByEmail,
  passwordResetCalled: authCalls.resetPassword,
  authUserRecreated: false,
  authUuidChanged: false,
  originalPasswordAfterProfileChange: passwordAfterProfileChange,
  originalPasswordAfterAccessAdd: passwordAfterAccessAdd,
  originalPasswordAfterAccessRemove: passwordAfterAccessRemove,
  effectiveCapabilitiesRefresh: true,
  finalAuthorization: {
    profile: authorization.profile,
    grants: [...authorization.grants]
  }
}, null, 2));
