const { createHmac, timingSafeEqual } = require('node:crypto');
const { getConfig } = require('../config');
const pattern = /^nwti1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;

// A namespaced, reproducible link for authorized managers. Keep the existing
// random-token hash as the revocation nonce; Resend invalidates both formats.
// Old emailed links still work, without retaining plaintext bearer tokens.
function teamInvitationToken(row, secret = getConfig().AUTH_TOKEN_SECRET) {
  const subject = JSON.stringify([row.id, row.organizationId || null, row.eventId || null,
    row.email, row.role, row.tokenHash, new Date(row.expiresAt).toISOString()]);
  const signature = createHmac('sha256', secret).update(`nitewide-team-invitation-v1:${subject}`).digest('base64url');
  return `nwti1.${row.id}.${signature}`;
}
function teamInvitationId(token) { return typeof token === 'string' ? pattern.exec(token)?.[1] || null : null; }
function verifyTeamInvitationToken(token, row, secret) {
  const expected = Buffer.from(teamInvitationToken(row, secret)), supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function shareableTeamInvitation(row, secret) {
  const { tokenHash, ...safe } = row.toJSON ? row.toJSON() : row;
  return { ...safe, ...(tokenHash ? { token: teamInvitationToken(row, secret) } : {}) };
}
module.exports = { teamInvitationToken, teamInvitationId, verifyTeamInvitationToken, shareableTeamInvitation };
