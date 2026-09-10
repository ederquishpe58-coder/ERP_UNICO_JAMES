const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = phase => JSON.parse(fs.readFileSync('output/sri-country-release/' + phase + '.json', 'utf8'));
const before = read('before'), after = read('after'), second = read('second');
assert.deepEqual(after.preservation, before.preservation);
assert.deepEqual(second.preservation, before.preservation);
assert.deepEqual(after.reservation, before.reservation);
assert.deepEqual(second.reservation, before.reservation);
assert.deepEqual(second.countries, after.countries);
const prior = new Map(before.countries.map(r => [r.company_id + ':' + r.record_id, r]));
let changed = 0;
assert.equal(after.countries.length, before.countries.length);
for (const row of after.countries) {
  const old = prior.get(row.company_id + ':' + row.record_id);
  assert.ok(old);
  if (JSON.stringify(row.payload) === JSON.stringify(old.payload)) {
    assert.equal(row.version, old.version);
    continue;
  }
  const {sriCountryCode, ...rest} = row.payload;
  assert.match(sriCountryCode, /^\d{3}$/);
  assert.deepEqual(rest, old.payload);
  assert.equal(row.version, old.version + 1);
  changed++;
}
assert.equal(changed, 337);
console.log('PASS PROD preservation: 337 country-only additions; second delta=0; orders/reservations/documents/sequences unchanged.');
