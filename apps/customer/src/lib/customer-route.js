const tabs = new Set(['discover', 'booked', 'saved', 'connections', 'my-events']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const booking = /^(purchase|guestlist):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function rundownIdFromSearch(search) {
  const params = new URLSearchParams(search);
  const id = params.get('rundown');
  return (!params.has('tab') || params.get('tab') === 'discover') && uuid.test(id || '') ? id.toLowerCase() : null;
}
export function rundownPreviewFromSearch(search) {
  const params = new URLSearchParams(search);
  if (rundownIdFromSearch(search) || (params.has('tab') && params.get('tab') !== 'discover')) return null;
  const value = params.get('rundownPreview');
  if (value === 'personal') return { kind: 'personal', organizationId: null };
  return uuid.test(value || '') ? { kind: 'business', organizationId: value.toLowerCase() } : null;
}
export function rundownContextKeyFromSearch(search) {
  const publicId = rundownIdFromSearch(search);
  if (publicId) return `public:${publicId}`;
  const preview = rundownPreviewFromSearch(search);
  return preview ? `preview:${preview.kind}:${preview.organizationId || ''}` : '';
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-') === value ? value : '';
}
export function canApplyInitialEvent({ eventId, routeEventId, checkoutLocked, checkoutEventId }) {
  // A completed recovery owns its checkout even after the request lock clears.
  // The initial deep-link fetch must not reset it to an event-details screen.
  return Boolean(eventId && eventId === routeEventId && !checkoutLocked && eventId !== checkoutEventId);
}
export function parseCustomerRoute(search) {
  const params = new URLSearchParams(search);
  const requestedTab = params.get('tab');
  const tab = tabs.has(requestedTab) ? requestedTab : 'discover';
  const operatorView = tab === 'my-events';
  const page = Number(params.get('myPage'));
  return {
    tab,
    eventId: !operatorView && uuid.test(params.get('event') || '') ? params.get('event') : null,
    booking: !operatorView && booking.test(params.get('booking') || '') ? params.get('booking') : null,
    city: operatorView ? '' : (params.get('city') || '').slice(0, 120),
    date: operatorView ? '' : validDate(params.get('date')),
    query: operatorView ? '' : (params.get('q') || '').slice(0, 120),
    // Legacy quick-date links no longer apply an invisible date restriction.
    shortcut: '',
    scope: !operatorView && params.get('scope') === 'city' ? 'city' : 'nearby',
    sort: !operatorView && ['distance', 'date'].includes(params.get('sort')) ? params.get('sort') : 'recommended',
    myEventId: operatorView && uuid.test(params.get('myEvent') || '') ? params.get('myEvent') : null,
    myStatus: operatorView && params.get('myStatus') === 'past' ? 'past' : 'upcoming',
    myPage: operatorView && Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    mySearch: operatorView ? (params.get('mySearch') || '').trim().slice(0, 120) : '',
  };
}
export function updateCustomerRoute(changes, { replace = false, eventEntry = false } = {}) {
  const url = new URL(window.location.href);
  const fields = { tab: 'tab', eventId: 'event', referralCode: 'ref', rundownId: 'rundown', rundownPreview: 'rundownPreview', booking: 'booking', city: 'city', date: 'date', query: 'q', shortcut: 'when', scope: 'scope', sort: 'sort', myEventId: 'myEvent', myStatus: 'myStatus', myPage: 'myPage', mySearch: 'mySearch' };
  for (const [field, param] of Object.entries(fields)) {
    if (!(field in changes)) continue;
    const value = changes[field];
    if (field === 'city' && value === '') url.searchParams.set(param, '');
    else if (value && !(field === 'tab' && value === 'discover') && !(field === 'scope' && value === 'nearby') && !(field === 'sort' && value === 'recommended') && !(field === 'myStatus' && value === 'upcoming') && !(field === 'myPage' && value === 1)) url.searchParams.set(param, value);
    else url.searchParams.delete(param);
  }
  const operatorView = url.searchParams.get('tab') === 'my-events';
  for (const param of operatorView ? ['event', 'booking', 'city', 'date', 'q', 'when', 'scope', 'sort', 'ref', 'rundown', 'rundownPreview'] : ['myEvent', 'myStatus', 'myPage', 'mySearch']) url.searchParams.delete(param);
  if (changes.tab && changes.tab !== 'discover') { url.searchParams.delete('rundown'); url.searchParams.delete('rundownPreview'); }
  const state = { ...window.history.state, nitewideEventEntry: operatorView ? false : eventEntry, nitewideScrollY: eventEntry ? window.scrollY : 0 };
  window.history[replace ? 'replaceState' : 'pushState'](state, '', url);
}
