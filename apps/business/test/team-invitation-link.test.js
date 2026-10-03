import test from 'node:test';
import assert from 'node:assert/strict';
import { teamInvitationUrl } from '../src/lib/team-invitation-link.js';

test('team and promoter links always target the business workspace and encode the token', () => {
  for (const base of ['http://localhost:5174', 'https://nitewide-demo.onrender.com/app', 'https://business.example.test/business']) {
    const token = 'synthetic +/?&=# invitation';
    const link = new URL(teamInvitationUrl(token, base));
    assert.equal(link.origin, new URL(base).origin);
    assert.equal(link.pathname, '/app');
    assert.equal(link.searchParams.get('invite'), token);
    assert.deepEqual([...link.searchParams.keys()], ['invite']);
    assert.equal(link.hash, '');
  }
});
