const test = require('node:test');
const assert = require('node:assert/strict');
const { venues, teamCountsForVenue, managerFixture, employeeFixture } = require('../src/db/seed');

test('demo teams vary repeatably from one to three managers and nine to twelve employees per venue', () => {
  const counts = venues.map((_, index) => teamCountsForVenue(index));
  assert.deepEqual(new Set(counts.map((team) => team.managers)), new Set([1, 2, 3]));
  assert.deepEqual(new Set(counts.map((team) => team.employees)), new Set([9, 10, 11, 12]));
  assert.deepEqual(counts, venues.map((_, index) => teamCountsForVenue(index)));
});

test('every demo team account has a unique, repeatable email', () => {
  const accounts = venues.flatMap((_, venueIndex) => {
    const counts = teamCountsForVenue(venueIndex);
    return [
      ...Array.from({ length: counts.managers }, (_, index) => managerFixture(venueIndex, index)),
      ...Array.from({ length: counts.employees }, (_, index) => employeeFixture(venueIndex, index)),
    ];
  });
  assert.equal(new Set(accounts.map((account) => account.email)).size, accounts.length);
  assert.equal(managerFixture(0, 0).email, 'sam.rivera.manager@nitewide.test');
  assert.equal(employeeFixture(0, 0).email, 'tessa.ward.employee1@nitewide.test');
});
