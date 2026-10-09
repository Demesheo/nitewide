import test from 'node:test';
import assert from 'node:assert/strict';
import { teamInvitationUrl } from '../src/lib/team-invitation-link.js';

test('team and promoter links always target the business workspace and encode the token', () => {
  for (const base of ['http://localhost:5174', 'https://business.example.test/']) {
    const token = 'synthetic +/?&=# invitation';
    const link = new URL(teamInvitationUrl(token, base));
    assert.equal(link.origin, new URL(base).origin);
    assert.equal(link.pathname, '/');
    assert.equal(link.searchParams.get('invite'), token);
    assert.deepEqual([...link.searchParams.keys()], ['invite']);
    assert.equal(link.hash, '');
  }
});

test('configured invitation targets preserve Business origin and the shared demo path', () => {
  const previous = globalThis.window;
  try {
    for (const target of ['https://business.nitewide.test/?section=overview', 'https://business-staging.nitewide.test/?section=overview', '/business?section=overview']) {
      globalThis.window = { __NITEWIDE_PUBLIC_CONFIG__: { businessWorkspace: target } };
      const link = new URL(teamInvitationUrl('synthetic-token', 'https://demo.nitewide.test'));
      assert.equal(link.pathname, target.startsWith('/') ? '/business' : '/');
      assert.equal(link.origin, target.startsWith('/') ? 'https://demo.nitewide.test' : new URL(target).origin);
      assert.deepEqual([...link.searchParams], [['invite', 'synthetic-token']]);
    }
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
