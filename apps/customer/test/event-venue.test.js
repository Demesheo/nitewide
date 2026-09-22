import test from 'node:test';
import assert from 'node:assert/strict';
import { eventVenueName } from '../src/lib/event-venue.js';
import { venuePhoto } from '../src/lib/venue-artwork.js';
test('two venues sharing one organization keep their individual names', () => {
  const organization = {name:'Proper',slug:'proper'};
  assert.equal(eventVenueName({organization,location:{name:'Room 22'}}),'Room 22');
  assert.equal(eventVenueName({organization,location:{name:'Proper'}}),'Proper');
  assert.equal(eventVenueName({organization}), 'Proper');
  assert.equal(eventVenueName({}), 'Independent experience');
});
test('venue photos follow the physical venue, not the parent business', () => {
  const organization = {name:'Celine',slug:'celine'};
  assert.equal(venuePhoto({organization,location:{name:'Eden',city:'Orlando'}}),'/images/eden-orlando-instagram.webp');
  assert.equal(venuePhoto({organization,location:{name:'Room 22',city:'Orlando'}}),null);
});
