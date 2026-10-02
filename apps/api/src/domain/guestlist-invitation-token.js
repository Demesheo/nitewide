const { createHmac, timingSafeEqual } = require('node:crypto');
const { getConfig } = require('../config');
const pattern = /^nwgi1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
// Admission-key signing, with a separate namespace. Regenerate the same private
// share link for authorized staff without persisting a raw bearer credential.
function invitationToken(invitation, secret = getConfig().QR_TOKEN_SECRET) {
  const signature = createHmac('sha256', secret).update(`nitewide-guestlist-invitation-v1:${invitation.id}:${invitation.eventId}:${invitation.tokenHash}`).digest('base64url');
  return `nwgi1.${invitation.id}.${signature}`;
}
function invitationId(token) { return typeof token === 'string' ? pattern.exec(token)?.[1] || null : null; }
function verifyInvitationToken(token, invitation, secret) {
  const expected = Buffer.from(invitationToken(invitation, secret)), supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
module.exports = { invitationToken, invitationId, verifyInvitationToken };
