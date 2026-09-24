export function eventIdFromSearch(search) {
  return new URLSearchParams(search).get('event') || null;
}

export function eventShareUrl(eventId, origin, referralCode) {
  const url = new URL('/', origin);
  url.searchParams.set('event', eventId);
  if (referralCode) url.searchParams.set('ref', referralCode);
  return url.toString();
}
