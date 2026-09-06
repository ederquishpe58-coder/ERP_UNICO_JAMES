const fs = require("node:fs");
const { createHash } = require("node:crypto");
const HASH = "6bb2a1af90e761a31bb97b1b85d73c658fc9ba0f64cbac05da71a68585c6b107";
function approvedPlan(companyId) {
  const bytes = fs.readFileSync(require.resolve("./reviewable-apply-plan-current.json"));
  if (createHash("sha256").update(bytes).digest("hex") !== HASH) throw Object.assign(new Error("PLAN_DRIFT"), { code: "PLAN_DRIFT" });
  const plan = JSON.parse(bytes);
  const company = plan.companies.find(item => item.companyId === companyId);
  if (!company) throw Object.assign(new Error("COMPANY_NOT_APPROVED"), { code: "COMPANY_NOT_APPROVED" });
  return { hash: HASH, company };
}
module.exports = { HASH, approvedPlan };
