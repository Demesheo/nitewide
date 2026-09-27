const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bookingFromSearch(search) {
  const value = new URLSearchParams(search).get('booking') || '';
  const [kind, id, extra] = value.split(':');
  if (extra || !['purchase', 'guestlist'].includes(kind) || !UUID.test(id || '')) return null;
  return { type: 'booking', kind, id };
}
