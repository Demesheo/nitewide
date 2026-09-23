const test = require('node:test');
const assert = require('node:assert/strict');
const { sameEuphoriaLocation, assertRedundantGuests } = require('../src/db/reconcile-euphoria');
const { venueOptions } = require('../src/services/venue-scope');
const canonical = { id: 'canonical', name: 'Euphoria Downtown', addressLine1: '110 S Orange Ave', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'public' };
test('Euphoria repair recognizes exact imported and addressless legacy locations, never a different venue', () => {
  assert.ok(sameEuphoriaLocation({ ...canonical, id: 'imported' }, canonical));
  assert.ok(sameEuphoriaLocation({ ...canonical, id: 'legacy', addressLine1: '' }, canonical));
  for (const changes of [{ name: 'Euphoria Annex' }, { city: 'Miami' }, { addressLine1: '112 S Orange Ave' }, { addressLine2: 'Suite 2' }, { privacy: 'private' }]) assert.equal(sameEuphoriaLocation({ ...canonical, ...changes }, canonical), false);
  const events = ['e1', 'e2'].map(id => ({ id, organizationId: 'org', location: canonical }));
  assert.equal(venueOptions(events).length, 1);
});
test('only duplicate guestlists with the same customer, party, status and referring person may be removed', () => {
  const guest = { userId: 'customer', partySize: 1, status: 'confirmed', source: 'affiliate', eventAffiliateId: 'old' };
  const retained = { ...guest, eventAffiliateId: 'kept' };
  const sourceRefs = [{ id: 'old', userId: 'promoter', status: 'active' }];
  const retainedRefs = [{ id: 'kept', userId: 'promoter', status: 'active' }];
  assert.doesNotThrow(() => assertRedundantGuests([guest], [retained], sourceRefs, retainedRefs));
  for (const changes of [{ userId: 'other' }, { status: 'pending' }, { partySize: 2 }, { source: 'event', eventAffiliateId: null }]) assert.throws(() => assertRedundantGuests([guest], [{ ...retained, ...changes }], sourceRefs, retainedRefs), /Guestlists differ/);
  assert.throws(() => assertRedundantGuests([], [], sourceRefs, []), /Unique promoter access/);
  assert.throws(() => assertRedundantGuests([guest], [retained], [], []), /Guestlists differ/);
});
test('both Posh snapshots reject overlapping physical-venue events on repeat imports', () => {
  assert.equal(require('../src/db/fixtures/posh-orlando-2026-09-21').skipVenueOverlaps, true);
  assert.equal(require('../src/db/fixtures/posh-orlando-2026-09-22').skipVenueOverlaps, true);
});
