const test = require('node:test');
const assert = require('node:assert/strict');
const snapshot = require('../src/db/fixtures/posh-orlando-2026-09-21');
const { replacements, fieldsFor } = require('../src/db/replace-verified-seed-events');

test('fresh demo seed replaces booked generic overlaps with reviewed source details', () => {
  assert.deepEqual(replacements.map(item => item.organizationSlug), ['euphoria-downtown', 'tier', 'tier']);
  assert.equal(new Set(replacements.map(item => item.sourceUrl)).size, 3);
  for (const item of replacements) {
    const source = snapshot.events.find(event => event.sourceUrl === item.sourceUrl);
    assert.ok(source, item.sourceUrl);
    const fields = fieldsFor(source, 'sample-image-id');
    assert.equal(fields.title, source.title);
    assert.equal(fields.imageAssetId, 'sample-image-id');
    assert.equal(fields.startsAt, source.startsAt);
    assert.match(fields.description, /Nitewide demo listing/);
    assert.ok(fields.description.includes(`Source: ${source.sourceUrl}`));
  }
});

test('hosted reseed stays generation-gated and isolated to the demo database', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const startup = await fs.readFile(path.resolve(__dirname, '../../../deploy/start.cjs'), 'utf8');
  assert.match(startup, /config\.hostedDemo \|\| new URL\(config\.DATABASE_URL\)\.pathname !== '\/nitewide_demo'/);
  assert.match(startup, /rows\[0\]\.seed_generation !== requestedGeneration/);
  assert.match(startup, /seed\(\{ hostedBootstrap: true, allowHostedReseed: true \}\)/);
  assert.match(startup, /status='ready', seed_generation=\$1/);
});
