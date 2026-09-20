import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrentCity, formatCity, localDateInputValue } from '../src/discovery-defaults.js';

test('the discovery date defaults to the supplied local calendar day', () => {
  const localDate = new Date(2026, 8, 20, 23, 59);
  assert.equal(localDateInputValue(localDate), '2026-09-20');
});

test('city labels include the compact region code when available', () => {
  assert.equal(formatCity({ city: 'Orlando', principalSubdivisionCode: 'US-FL' }), 'Orlando, FL');
});

test('precise browser coordinates replace the IP-based city fallback', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const precise = url.includes('latitude=28.54');
    return { ok: true, json: async () => precise ? { city: 'Orlando', principalSubdivisionCode: 'US-FL' } : { city: 'Tampa', principalSubdivisionCode: 'US-FL' } };
  };
  const geolocation = { getCurrentPosition: (success) => success({ coords: { latitude: 28.54, longitude: -81.38 } }) };
  assert.equal(await detectCurrentCity({ fetchImpl, geolocation }), 'Orlando, FL');
  assert.equal(requests.length, 2);
});

test('IP-based city is used when browser location permission is denied', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ city: 'Miami', principalSubdivisionCode: 'US-FL' }) });
  const geolocation = { getCurrentPosition: (_success, reject) => reject(new Error('denied')) };
  assert.equal(await detectCurrentCity({ fetchImpl, geolocation }), 'Miami, FL');
});
