// Always use the normal, freshly validated event details for checkout. A
// miniature public rundown card is deliberately not a complete event model.
export async function loadRundownEvent({ eventId, code, signal, sessionKey }, request) {
  const path = `/events/${encodeURIComponent(eventId)}`;
  const [event, visit] = await Promise.all([
    request(path, { signal }),
    code ? request(`${path}/referral-visits`, { signal, body: { code, sessionKey } }) : null,
  ]);
  if (!event || event.id !== eventId || (code && visit?.code !== code)) throw new Error('This event link is no longer available.');
  return { event, referral: code ? { eventId, code: visit.code, referrerName: visit.referrerName } : null };
}
