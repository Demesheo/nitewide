import { publicAppLink } from '../../../shared/app-links.mjs';

// Runtime configuration keeps invitations on Business, including the shared demo.
export function teamInvitationUrl(token, origin = window.location.origin) {
  const url = new URL(publicAppLink('businessWorkspace', '/?section=overview'), origin);
  url.search = '';
  url.searchParams.set('invite', token);
  return url.toString();
}
