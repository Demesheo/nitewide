const test = require('node:test');
const assert = require('node:assert/strict');
const { replacementFields } = require('../src/db/replace-room22-friday');
test('Room 22 source replacement changes presentation and schedule, never relationships or commerce', () => {
  const patch = replacementFields('flyer-id');
  assert.deepEqual(Object.keys(patch).sort(),['title','summary','description','startsAt','endsAt','imageAssetId'].sort());
  assert.equal(patch.title,'Culture Code Friday');
  assert.equal(patch.startsAt,'2026-09-25T21:00:00-04:00');
  assert.equal(patch.endsAt,'2026-09-26T02:00:00-04:00');
  assert.match(patch.description,/Nitewide demo listing/);
});
