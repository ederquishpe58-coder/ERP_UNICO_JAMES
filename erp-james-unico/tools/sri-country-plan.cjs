const fs = require("node:fs");
const assert = require("node:assert/strict");
const out = "output/sri-country-release";
const source = JSON.parse(fs.readFileSync(out + "/source.json"));
const before = JSON.parse(fs.readFileSync(out + "/before.json"));
const fold = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
const official = [];
for (const page of [80,81,82]) {
  for (const line of fs.readFileSync(out + "/page-" + page + ".txt", "utf8").split(/\r?\n/)) {
    const two = /^\s*(\d{3})\s+(.+?)\s+(\d{3})\s+(.+?)\s*$/.exec(line);
    const one = /^\s*(333)\s+(EMIRATOS ARABES UNIDOS)\s*$/.exec(fold(line));
    if (two) official.push({code: two[1], name: two[2].trim(), page}, {code: two[3], name: two[4].trim(), page});
    else if (one) official.push({code: one[1], name: one[2], page});
  }
}
assert.equal(official.filter(row => row.code === "246" && row.name === "GEORGIA").length, 1);
assert.equal(new Set(official.map(row => row.code)).size, official.length);
const fields = ["sriCountryCode","sri_country_code","sriCode","sri_code","countrySriCode","country_sri_code","codigoSri","codigo_sri","codigoSriPais","codigo_sri_pais"];
// Table 25 contains multiple fiscal entries for these country identities.
// Exact spelling alone cannot establish which historical entry is appropriate.
const historicalAmbiguities = new Set([
 "BELARUS","BIELORRUSIA","CHIPRE","CYPRUS","SIRIA","SYRIAN ARAB REPUBLIC",
 "LETONIA","LATVIA","COSTA DE MARFIL","COTE DIVOIRE","COTE D'IVOIRE",
 "MARRUECOS","MOROCCO","BURKINA FASO","ALTO VOLTA","JERSEY"
]);
const rows = before.countries.map(row => {
  const p = row.payload;
  const names = [p.name,p.searchName,p.legacyName,p.legacy_name,...(Array.isArray(p.aliases)?p.aliases:[])].map(fold).filter(Boolean);
  const matches = official.filter(item => names.includes(fold(item.name)));
  const codes = [...new Set(fields.map(field => String(p[field] ?? "").trim()).filter(Boolean))];
  const historical = names.some(name=>historicalAmbiguities.has(name));
  const status = historical || matches.length !== 1 ? "NEEDS_REVIEW" : !codes.length ? "ADD"
    : codes.length === 1 && codes[0] === matches[0].code ? "VALID" : "INVALID";
  return {...row, names, codes, matches, status, reviewReason:historical?"OFFICIAL_HISTORICAL_ALTERNATIVES":matches.length!==1?"NO_UNIQUE_EXACT_NAME":""};
});
const summary = {total: rows.length, valid: rows.filter(r=>r.status==="VALID").length,
  missing: rows.filter(r=>!r.codes.length).length, invalid: rows.filter(r=>r.codes.length && (r.codes.length!==1 || !/^\d{3}$/.test(r.codes[0]) || (r.matches.length===1 && r.codes[0]!==r.matches[0].code))).length,
  needsReview: rows.filter(r=>r.status==="NEEDS_REVIEW").length, safelyAdded: rows.filter(r=>r.status==="ADD").length};
fs.writeFileSync(out + "/plan.json", JSON.stringify({source,official,summary,rows}, null,2));
console.log(JSON.stringify(summary));
console.log("NEEDS_REVIEW", [...new Set(rows.filter(r=>r.status==="NEEDS_REVIEW").map(r=>r.payload.name))].join(" | "));
