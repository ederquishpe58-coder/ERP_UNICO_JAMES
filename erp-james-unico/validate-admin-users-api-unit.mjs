import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./api/admin-users.js", import.meta.url), "utf8");
assert.match(
  source,
  /\.from\("erp_security_profiles"\)[\s\S]*?\.select\("profile_id, display_name, description, active"\)[\s\S]*?\.eq\("active", true\)/,
  "El catálogo debe consultar las columnas canónicas disponibles y solo perfiles activos."
);
assert.doesNotMatch(
  source,
  /\.select\("[^"]*system_defined[^"]*"\)/,
  "Admin Users no debe depender de system_defined, ausente del contrato REST real de TEST."
);
let rpcFailure = null;
let rpcCalls = 0;
const rpcClient = {
  async rpc(name, args) {
    rpcCalls += 1;
    assert.equal(name, "erp_admin_configure_user_access");
    assert.equal(args.p_company_access[0].profile_id, "COMERCIAL");
    return rpcFailure
      ? { data: null, error: { message: rpcFailure } }
      : { data: { target_user_id: args.p_target_user_id, legacy_route_permissions_written: 0 }, error: null };
  }
};

const moduleObject = { exports: {} };
vm.runInNewContext(`${source}\nmodule.exports.__test = { saveUserAccess };`, {
  module: moduleObject,
  exports: moduleObject.exports,
  require(request) {
    if (request === "node:crypto") return { randomUUID: () => "11111111-1111-4111-8111-111111111111" };
    if (request === "./sri/_lib/supabase-admin.cjs") {
      return {
        async assertUserCapability() { return true; },
        getSupabaseAdmin() {},
        getSupabaseUserContext() { return rpcClient; },
        bearerToken() { return "token"; }
      };
    }
    throw new Error(`Unexpected require: ${request}`);
  },
  URL,
  console,
  process,
  setTimeout,
  clearTimeout
}, { filename: "api/admin-users.js" });

const { saveUserAccess } = moduleObject.exports.__test;
const actor = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accessToken: "actor-token" };
const target = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "fixture-admin-users@fixture.invalid",
  user_metadata: { contact_email: "fixture-admin-users@fixture.invalid" }
};

function query(table) {
  const state = { table, filters: [] };
  const builder = {
    select() { return builder; },
    eq(column, value) { state.filters.push([column, value]); return builder; },
    in() { return builder; },
    order() { return builder; },
    async single() {
      assert.equal(table, "companies");
      return { data: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", company_key: "COMP-BLESS-FLOWER", commercial_name: "Bless Flower" }, error: null };
    },
    async maybeSingle() {
      if (table === "user_company_memberships") {
        return { data: { membership_role: "OWNER", membership_status: "ACTIVE" }, error: null };
      }
      if (table === "erp_security_profiles") {
        return { data: { profile_id: "COMERCIAL", display_name: "Comercial", active: true }, error: null };
      }
      throw new Error(`Unexpected maybeSingle table: ${table}`);
    }
  };
  return builder;
}

let inviteCalls = 0;
let deleteCalls = 0;
const adminClient = {
  from: query,
  auth: {
    admin: {
      async listUsers() { return { data: { users: [] }, error: null }; },
      async inviteUserByEmail(email) {
        inviteCalls += 1;
        assert.equal(email, target.email);
        return { data: { user: structuredClone(target) }, error: null };
      },
      async deleteUser(id) {
        deleteCalls += 1;
        assert.equal(id, target.id);
        return { data: {}, error: null };
      }
    }
  }
};

const canonicalInput = {
  email: target.email,
  username: "fixture.admin",
  fullName: "Fixture Admin Users",
  cargo: "Fixture",
  status: "activo",
  inviteRedirectTo: "https://test.invalid/crear-contrasena",
  companies: [{
    companyKey: "COMP-BLESS-FLOWER",
    membershipRole: "VIEWER",
    profileId: "COMERCIAL",
    enabled: true,
    status: "activo",
    isDefault: true
  }]
};

const success = await saveUserAccess(adminClient, actor, structuredClone(canonicalInput), { createIdentity: true });
assert.equal(success.id, target.id);
assert.equal(success.invited, true);
assert.equal(success.created, true);
assert.equal(inviteCalls, 1);
assert.equal(deleteCalls, 0);
assert.equal(rpcCalls, 1);

await assert.rejects(
  saveUserAccess(adminClient, actor, {
    ...structuredClone(canonicalInput),
    companies: [{ ...canonicalInput.companies[0], profileId: "" }]
  }, { createIdentity: true }),
  /CANONICAL_PROFILE_REQUIRED/
);
assert.equal(inviteCalls, 1, "Missing profile must fail before Auth invite");

await assert.rejects(
  saveUserAccess(adminClient, actor, {
    ...structuredClone(canonicalInput),
    capabilities: ["admin.users.manage"]
  }, { createIdentity: true }),
  /INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED/
);
assert.equal(inviteCalls, 1, "Manual capabilities must fail before Auth invite");

rpcFailure = "CANONICAL_PROFILE_WRITE_FAILED";
await assert.rejects(
  saveUserAccess(adminClient, actor, structuredClone(canonicalInput), { createIdentity: true }),
  /ERP_CONFIGURATION_FAILED/
);
assert.equal(inviteCalls, 2);
assert.equal(deleteCalls, 1, "A newly-created Auth must be compensated after ERP failure");

console.log(JSON.stringify({
  result: "PASS",
  createInvite: "PASS",
  canonicalProfileRequiredBeforeAuth: "PASS",
  manualAuthorityRejectedBeforeAuth: "PASS",
  erpFailureIsCreateFailure: "PASS",
  authCompensation: "PASS"
}, null, 2));
