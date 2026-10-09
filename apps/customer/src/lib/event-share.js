import { publicRouteParams, eventPublicLink } from '../../../shared/public-links.mjs';
export function eventIdFromSearch(search) {
  return publicRouteParams(search).get('event') || null;
}

export function eventShareUrl(eventId, origin, referralCode) {
  return eventPublicLink(eventId, origin, referralCode);
}
