import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

async function withReuse(callback) {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
  try {
    return await callback(await vite.ssrLoadModule('/src/lib/event-reuse.js'));
  } finally {
    await vite.close();
  }
}

const sourceEvent = () => ({
  id: 'source-event-id', version: 9, title: 'Friday Night', slug: 'friday-night', status: 'completed',
  isDiscoverable: true, imageAssetId: 'image-id', imageUrl: '/private/source-image', salesCents: 150_000,
  attendees: [{ id: 'buyer-id', email: 'buyer@example.test' }],
  locationId: 'saved-location', organizationId: 'workspace-a',
  location: { name: 'Main Room', city: 'Test City', timezone: 'America/Denver' },
  startsAt: '2024-01-05T05:00:00.000Z', endsAt: '2024-01-05T08:30:00.000Z',
  offerings: [
    { id: 'ga-id', name: 'General', kind: 'ticket', priceCents: 2500, quantityTotal: 100, quantitySold: 90,
      saleState: 'sold_out', accessCodeHash: 'secret-hash', releaseAfterOfferingId: null,
      salesStartAt: '2024-01-01T00:00:00.000Z', salesEndAt: '2024-01-04T00:00:00.000Z', customerEmail: 'buyer@example.test' },
    { id: 'vip-id', name: 'VIP', kind: 'ticket', priceCents: 5000, quantityTotal: 20, quantitySold: 8,
      releaseAfterOfferingId: 'ga-id', releaseAfterKey: 'ga-id', accessCodeHash: 'other-secret', salesStartAt: null, salesEndAt: null },
  ],
});

test('duplicate drafts reset history and remap offering dependencies while keeping local schedule', async () => withReuse(({ reusableDraft }) => {
  const source = sourceEvent();
  const draft = reusableDraft(source, { copyOfferings: true, copyImage: false });
  assert.equal(draft.title, 'Friday Night (copy)');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.isDiscoverable, false);
  assert.equal(draft.imageAssetId, null);
  assert.equal(draft.imageUrl, null);
  assert.equal(draft.organizationId, source.organizationId);
  assert.equal(draft.locationId, source.locationId);
  assert.ok(!('id' in draft) && !('version' in draft) && !('salesCents' in draft) && !('attendees' in draft));
  assert.ok(Date.parse(draft.startsAt) > Date.now(), 'a completed source becomes a future draft');
  assert.equal(draft.startsAt.slice(11), '22:00', 'the source event’s venue-local start time is preserved');
  assert.equal(draft.endsAt.slice(11), '01:30', 'source duration is preserved even across midnight');
  const [general, vip] = draft.offerings;
  assert.notEqual(general.clientKey, 'ga-id');
  assert.notEqual(vip.clientKey, 'vip-id');
  assert.equal(vip.releaseAfterKey, general.clientKey, 'dependencies point to the new offering IDs');
  assert.equal(general.releaseAfterKey, '');
  assert.deepEqual([general.price, general.quantitySold, general.salesStartAt, general.salesEndAt, general.saleState, general.accessCodeHash], [25, undefined, '', '', undefined, undefined]);
  assert.deepEqual([vip.price, vip.quantitySold, vip.salesStartAt, vip.salesEndAt, vip.accessCodeHash], [50, undefined, '', '', undefined]);
  assert.equal(Object.hasOwn(general, 'customerEmail'), false, 'recipient data is never copied');
  assert.equal(reusableDraft(source, { copyOfferings: false }).offerings.length, 0);
}));

test('saved templates are user-scoped, whitelist source fields, and tolerate damaged persistence', async () => withReuse(({ readEventTemplates, removeEventTemplate, saveEventTemplate }) => {
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  try {
    const source = sourceEvent();
    const template = saveEventTemplate('user-a', source);
    assert.equal(readEventTemplates('user-b').length, 0);
    const row = readEventTemplates('user-a')[0];
    assert.equal(row.id, template.id);
    assert.equal(row.source.id, undefined);
    assert.equal(row.source.salesCents, undefined);
    assert.equal(row.source.attendees, undefined);
    assert.equal(row.source.offerings[0].accessCodeHash, undefined);
    assert.equal(row.source.offerings[0].customerEmail, undefined);
    assert.equal(row.source.offerings[0].quantitySold, undefined);
    removeEventTemplate('user-a', template.id);
    assert.equal(readEventTemplates('user-a').length, 0);

    storage.setItem('nitewide:business:templates:user-a', '{not-json');
    assert.deepEqual(readEventTemplates('user-a'), [], 'corrupt browser storage falls back to no templates');
    storage.setItem('nitewide:business:templates:user-a', JSON.stringify([{ schema: 2, source }, { schema: 1, source: null }]));
    assert.deepEqual(readEventTemplates('user-a'), [], 'unknown schemas and incomplete persisted templates are ignored');
  } finally {
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else delete globalThis.localStorage;
  }
}));

test('hostile persisted template keys do not flow into a reusable draft', async () => withReuse(({ readEventTemplates, reusableDraft }) => {
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  try {
    const unsafeOffering = { id: 'unsafe-id', name: 'Tier', kind: 'ticket', priceCents: 2500, unexpectedCredential: 'token', accessCodeHash: 'secret' };
    Object.defineProperty(unsafeOffering, '__proto__', { value: { isAdmin: true }, enumerable: true });
    const unsafeSource = { title: 'Safe draft', startsAt: '2024-01-05T05:00:00.000Z', endsAt: '2024-01-05T08:30:00.000Z',
      location: { timezone: 'America/Denver' }, organizationId: null, locationId: null,
      unexpectedCredential: 'should-not-survive', offerings: [unsafeOffering] };
    Object.defineProperty(unsafeSource, '__proto__', { value: { isAdmin: true }, enumerable: true });
    storage.setItem('nitewide:business:templates:user-a', JSON.stringify([{ schema: 1, id: 'hostile', name: 'Hostile', source: unsafeSource }]));
    const [template] = readEventTemplates('user-a');
    assert.equal(Object.hasOwn(template.source, '__proto__'), false);
    assert.equal(Object.hasOwn(template.source.offerings[0], '__proto__'), false);
    assert.equal(Object.hasOwn(template.source.offerings[0], 'unexpectedCredential'), false);
    const draft = reusableDraft(template.source);
    assert.equal(Object.getPrototypeOf(draft), Object.prototype);
    assert.equal(Object.hasOwn(draft, 'unexpectedCredential'), false);
    assert.equal(Object.hasOwn(draft.offerings[0], 'unexpectedCredential'), false);
    assert.equal(Object.getPrototypeOf(draft.offerings[0]), Object.prototype);
    assert.equal(draft.offerings[0].accessCodeHash, undefined);
  } finally {
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else delete globalThis.localStorage;
  }
}));
