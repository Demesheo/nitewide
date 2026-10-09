import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('Stripe initialization binds keys to runtime mode and preserves merchant-scoped caching', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { stripeClient } = await vite.ssrLoadModule('/src/components/stripe-checkout.jsx');
    const calls = [];
    const initialize = async (key, options) => {
      calls.push({ key, options });
      return { fixture: options.stripeAccount };
    };
    const first = stripeClient('pk_test_fixture', 'acct_fixture_one', initialize);
    assert.equal(stripeClient('pk_test_fixture', 'acct_fixture_one', initialize), first);
    assert.deepEqual(await first, { fixture: 'acct_fixture_one' });
    assert.deepEqual(await stripeClient('pk_test_fixture', 'acct_fixture_two', initialize), { fixture: 'acct_fixture_two' });
    assert.deepEqual(calls, ['acct_fixture_one', 'acct_fixture_two'].map(stripeAccount => ({
      key: 'pk_test_fixture', options: { stripeAccount, developerTools: { assistant: { enabled: false } } },
    })));
    assert.equal(await stripeClient('pk_live_fixture', 'acct_fixture_one', initialize), null);
    assert.equal(await stripeClient('pk_test_fixture', '', initialize), null);
    assert.equal(calls.length, 2);
    const live = stripeClient('pk_live_fixture', 'acct_fixture_one', initialize, 'live');
    assert.equal(stripeClient('pk_live_fixture', 'acct_fixture_one', initialize, 'live'), live);
    assert.notEqual(live, first);
    assert.deepEqual(await live, { fixture: 'acct_fixture_one' });
    assert.equal(calls.at(-1).key, 'pk_live_fixture');
    assert.equal(await stripeClient('pk_test_fixture', 'acct_fixture_one', initialize, 'live'), null);
    assert.equal(await stripeClient('pk_live_fixture', 'acct_fixture_one', initialize, 'test'), null);
    assert.equal(await stripeClient('pk_live_fixture', 'acct_fixture_one', initialize, 'disabled'), null);
    assert.equal(calls.length, 3, 'mode mismatches do not initialize a provider client or reuse a cached one');
  } finally { await vite.close(); }
});
