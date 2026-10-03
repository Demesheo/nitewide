const test = require('node:test');
const assert = require('node:assert/strict');
const { teamInvitationToken, teamInvitationId, verifyTeamInvitationToken, shareableTeamInvitation } = require('../src/domain/team-invitation-token');
const secret = 'team-invitation-test-key-not-used-in-production';
const row = { id: 'b7b6d5e3-f051-4d04-a27b-87740d60c2db', organizationId: 'org-1', eventId: null,
  email: 'invited@example.test', name: 'Invited Person', role: 'employee', tokenHash: 'old-random-token-hash', expiresAt: new Date('2099-10-09T00:00:00Z') };

test('authorized directory links are reproducible without retaining plaintext tokens', () => {
  const token = teamInvitationToken(row, secret);
  assert.equal(teamInvitationToken({ ...row }, secret), token);
  assert.equal(teamInvitationId(token), row.id);
  assert.equal(verifyTeamInvitationToken(token, row, secret), true);
  const safe = shareableTeamInvitation(row, secret);
  assert.equal(safe.name, row.name);
  assert.equal(safe.token, token);
  assert.equal('tokenHash' in safe, false);
  assert.equal(shareableTeamInvitation({ toJSON: () => row, ...row }, secret).token, token);
});

test('renewal, scope, recipient, role and signing-key changes invalidate a copied invitation', () => {
  const token = teamInvitationToken(row, secret);
  for (const changes of [{ tokenHash: 'renewed' }, { organizationId: 'other-org' }, { eventId: 'event-1' },
    { email: 'other@example.test' }, { role: 'manager' }, { expiresAt: new Date('2099-10-10T00:00:00Z') }]) {
    assert.equal(verifyTeamInvitationToken(token, { ...row, ...changes }, secret), false);
  }
  assert.equal(verifyTeamInvitationToken(token, row, `${secret}-rotated`), false);
  assert.equal(verifyTeamInvitationToken(token.replace(row.id, 'c7b6d5e3-f051-4d04-a27b-87740d60c2db'), row, secret), false);
});

test('legacy random invitation tokens remain distinguishable from signed directory links', () => {
  assert.equal(teamInvitationId('old-random-email-token'), null);
  assert.equal(teamInvitationId(null), null);
  assert.equal(teamInvitationId(`nwti1.${row.id}.bad`), null);
});
