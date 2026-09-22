export function referralFromSearch(search) {
  const params = new URLSearchParams(search);
  const eventId = params.get('event');
  const code = params.get('ref');
  return eventId && code ? { eventId, code } : null;
}
export function referralCodeForEvent(referral, eventId) {
  return referral?.eventId === eventId ? referral.code : undefined;
}
