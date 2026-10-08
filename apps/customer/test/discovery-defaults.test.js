import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCurrentCity,
  formatCity,
  localDateInputValue,
  initialDiscoveryCity,
} from "../src/discovery-defaults.js";

test("the discovery date defaults to the supplied local calendar day", () => {
  const localDate = new Date(2026, 8, 20, 23, 59);
  assert.equal(localDateInputValue(localDate), "2026-09-20");
});

test("city labels include the compact region code when available", () => {
  assert.equal(
    formatCity({ city: "Orlando", principalSubdivisionCode: "US-FL" }),
    "Orlando, FL",
  );
});

test("precise browser coordinates replace the IP-based city fallback", async () => {
  const requests = [];
  let permissionPrompts = 0;
  let geolocationOptions;
  const fetchImpl = async (url) => {
    requests.push(url);
    const precise = url.includes("latitude=28.54");
    return {
      ok: true,
      json: async () =>
        precise
          ? { city: "Orlando", principalSubdivisionCode: "US-FL" }
          : { city: "Tampa", principalSubdivisionCode: "US-FL" },
    };
  };
  const geolocation = {
    getCurrentPosition: (success, _failure, options) => {
      permissionPrompts++;
      geolocationOptions = options;
      success({ coords: { latitude: 28.54, longitude: -81.38 } });
    },
  };
  assert.equal(
    await detectCurrentCity({ fetchImpl, geolocation, requestPrecise: true }),
    "Orlando, FL",
  );
  assert.equal(permissionPrompts, 1, 'precise location is requested only by the explicit opt-in path');
  assert.deepEqual(geolocationOptions, { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8_000 });
  assert.equal(requests.length, 2);
  assert.ok(requests.some(url => url.includes('latitude=28.54&longitude=-81.38')));
  const approximate = requests.find(url => !url.includes('latitude='));
  assert.ok(approximate);
  assert.equal(new URL(approximate).searchParams.has('longitude'), false);
});

test("IP-based city is used when browser location permission is denied", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ city: "Miami", principalSubdivisionCode: "US-FL" }),
  });
  const geolocation = {
    getCurrentPosition: (_success, reject) => reject(new Error("denied")),
  };
  assert.equal(
    await detectCurrentCity({ fetchImpl, geolocation, requestPrecise: true }),
    "Miami, FL",
  );
});

test('automatic detection uses only approximate lookup, without requesting or transmitting coordinates', async () => {
  const requests = [];
  assert.equal(await detectCurrentCity({
    fetchImpl: async (url) => { requests.push(url); return { ok: true, json: async () => ({ city: 'Winter Park', principalSubdivisionCode: 'US-FL', countryCode: 'US' }) }; },
    geolocation: { getCurrentPosition() { assert.fail('Automatic discovery must not prompt for precise location'); } },
  }), 'Winter Park, FL');
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0], /latitude|longitude/);
  assert.equal(formatCity({ city: 'Toronto', principalSubdivisionCode: 'CA-ON', countryCode: 'CA' }), 'Toronto, ON, CA');
});

test('cancelling explicit location lookup prevents a late GPS callback from transmitting coordinates', async () => {
  const controller = new AbortController();
  const requests = [];
  let latePosition;
  const lookup = detectCurrentCity({
    requestPrecise: true,
    signal: controller.signal,
    geolocation: { getCurrentPosition(success) { latePosition = success; } },
    fetchImpl: async (url, { signal }) => {
      requests.push(url);
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
  });
  controller.abort();
  latePosition({ coords: { latitude: 28.54, longitude: -81.38 } });
  assert.equal(await lookup, '');
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0], /latitude|longitude/);
});

test('explicit URL city wins over preferred selection, including empty and unresolved selections', () => {
  assert.equal(initialDiscoveryCity({ city: 'Winter Park, Florida' }, 'Miami, FL', true), 'Winter Park, FL');
  assert.equal(initialDiscoveryCity({ city: '' }, 'Miami, FL', true), '');
  assert.equal(initialDiscoveryCity({ city: 'Orlando' }, 'Miami, FL', true), 'Orlando');
  assert.equal(initialDiscoveryCity({ city: '' }, 'Kissimmee, FL'), 'Kissimmee, FL');
  assert.equal(initialDiscoveryCity({ city: '' }, 'Toronto, ON, CA'), 'Toronto, ON, CA');
  assert.equal(initialDiscoveryCity({ city: '' }, 'Orlando'), '');
});
