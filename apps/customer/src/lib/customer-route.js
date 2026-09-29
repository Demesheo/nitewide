const tabs = new Set(['discover', 'booked', 'saved', 'connections']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const booking = /^(purchase|guestlist):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-') === value ? value : '';
}
export function parseCustomerRoute(search) {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  return {
    tab: tabs.has(tab) ? tab : 'discover',
    eventId: uuid.test(params.get('event') || '') ? params.get('event') : null,
    booking: booking.test(params.get('booking') || '') ? params.get('booking') : null,
    city: (params.get('city') || '').slice(0, 120),
    date: validDate(params.get('date')),
    query: (params.get('q') || '').slice(0, 120),
    shortcut: ['tonight', 'tomorrow', 'weekend'].includes(params.get('when')) ? params.get('when') : '',
  };
}
export function updateCustomerRoute(changes, { replace = false, eventEntry = false } = {}) {
  const url = new URL(window.location.href);
  const fields = { tab: 'tab', eventId: 'event', booking: 'booking', city: 'city', date: 'date', query: 'q', shortcut: 'when' };
  for (const [field, param] of Object.entries(fields)) {
    if (!(field in changes)) continue;
    const value = changes[field];
    if (value && !(field === 'tab' && value === 'discover')) url.searchParams.set(param, value);
    else url.searchParams.delete(param);
  }
  const state = { ...window.history.state, nitewideEventEntry: eventEntry, nitewideScrollY: eventEntry ? window.scrollY : 0 };
  window.history[replace ? 'replaceState' : 'pushState'](state, '', url);
}
