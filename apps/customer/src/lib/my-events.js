export const MY_EVENTS_PAGE_SIZE = 12;

export function myEventPhase(event, now = Date.now()) {
  if (event?.status === 'cancelled') return 'cancelled';
  if (event?.status === 'completed') return 'past';
  const end = Date.parse(event?.endsAt || event?.startsAt);
  if (Number.isFinite(end) && end <= now) return 'past';
  if (event?.status === 'draft') return 'draft';
  const start = Date.parse(event?.startsAt);
  return Number.isFinite(start) && start <= now ? 'ongoing' : 'upcoming';
}

export function isMyEventsUnauthorized(error) {
  return error?.status === 401 || error?.status === 403;
}

export function myEventsMoney(cents) {
  return Number.isFinite(Number(cents)) && cents !== null && cents !== undefined
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100)
    : 'Unavailable';
}

export function myEventsCount(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value).toLocaleString('en-US') : '—';
}

export function myEventsListPath({ myStatus = 'upcoming', myPage = 1, mySearch = '' }) {
  const past = myStatus === 'past';
  const params = new URLSearchParams({ status: past ? 'past' : 'upcoming', sort: past ? 'starts_desc' : 'starts_asc', page: String(myPage), pageSize: String(MY_EVENTS_PAGE_SIZE) });
  if (mySearch.trim()) params.set('search', mySearch.trim().slice(0, 120));
  return `/customer/my-events?${params}`;
}

export function validMyEventsPage(result) {
  return Boolean(result && Array.isArray(result.items) && Number.isSafeInteger(result.total) && result.total >= 0 && Number.isSafeInteger(result.page) && result.page > 0 && Number.isSafeInteger(result.pageSize) && result.pageSize > 0 && typeof result.hasMore === 'boolean' && result.items.every(event => event?.id && event.title));
}

export function validMyEventDetail(result) {
  return Boolean(result?.event?.id && result.event.title && ['event', 'own'].includes(result.scope) && result.summary && result.capabilities && result.personalEarnings);
}

export function myEventBusinessUrl(base, eventId, location) {
  const url = new URL(base, location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('section', 'events');
  url.searchParams.set('event', eventId);
  return url.href;
}
