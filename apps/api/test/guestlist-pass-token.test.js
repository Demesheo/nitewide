const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { invitationToken, invitationId, verifyInvitationToken } = require('../src/domain/guestlist-invitation-token');
const { guestlistPassToken, verifyGuestlistPassToken } = require('../src/domain/wallet-qr');
const secret = 'separate-guestlist-test-signing-key';

test('private invitation links are stable, namespace-bound and invalid after secret/token rotation', () => {
  const invitation = { id: randomUUID(),eventId: randomUUID(),tokenHash: 'stored-random-hash' };
  const token = invitationToken(invitation,secret);
  assert.equal(invitationId(token),invitation.id);
  assert.equal(invitationToken(invitation,secret),token);
  assert.equal(verifyInvitationToken(token,invitation,secret),true);
  for (const change of [{ id: randomUUID() },{ eventId: randomUUID() },{ tokenHash: 'rotated' }]) assert.equal(verifyInvitationToken(token,{ ...invitation,...change },secret),false);
  assert.equal(verifyInvitationToken(token,invitation,'rotated-key'),false);
  assert.equal(invitationId('nwgi1.not-a-uuid.'+'A'.repeat(43)),null);
  assert.equal(invitationId('nwgi1.'+invitation.id+'.short'),null);
});
test('individual pass codes bind the child, event and approval generation without binding optional account identity', () => {
  const entry = { id: randomUUID(),eventId: randomUUID(),qrTokenHash: 'approval-generation',userId: null };
  const pass = { id: randomUUID(),position: 1,qrTokenHash: 'child-secret' };
  const token = guestlistPassToken(pass,entry,secret);
  assert.equal(verifyGuestlistPassToken(token,pass,entry,secret),true);
  assert.equal(verifyGuestlistPassToken(token,pass,{ ...entry,userId: randomUUID() },secret),true);
  for (const change of [{ id: randomUUID() },{ position: 2 },{ qrTokenHash: 'other' }]) assert.equal(verifyGuestlistPassToken(token,{ ...pass,...change },entry,secret),false);
  for (const change of [{ id: randomUUID() },{ eventId: randomUUID() },{ qrTokenHash: 'new-approval' }]) assert.equal(verifyGuestlistPassToken(token,pass,{ ...entry,...change },secret),false);
});
