// The customer app owns `/` on shared deployments; invitations must open
// the business workspace on both standalone and shared-domain deployments.
export function teamInvitationUrl(token, origin = window.location.origin) {
  const url = new URL('/app', origin);
  url.searchParams.set('invite', token);
  return url.toString();
}
