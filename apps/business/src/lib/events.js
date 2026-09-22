export function eventPhase(event, now = Date.now()) {
  if (event.status === 'completed' || Date.parse(event.endsAt) <= now) return 'past';
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'draft') return 'draft';
  return Date.parse(event.startsAt) <= now ? 'live' : 'upcoming';
}
export function eventDay(event) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: event.location?.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.startsAt));
  const get = (key) => parts.find((p) => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function selectEvents(events, { view = 'upcoming', search = '', from = '', to = '' }, now = Date.now()) {
  return events.filter((event) => {
    const phase = eventPhase(event, now);
    return (view === 'all' || (view === 'upcoming' ? ['upcoming', 'live'].includes(phase) : phase === view)) &&
      (!from || eventDay(event) >= from) && (!to || eventDay(event) <= to) &&
      [event.title, event.location?.name, event.location?.city].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase());
  });
}
export const saleLabels = { on_sale: 'On sale', scheduled: 'Scheduled', waiting_for_tier: 'Waiting for sellout', sold_out: 'Sold out', closed: 'Sales closed', inactive: 'Paused' };

export function eventTeamRoles(people) {
  return [...new Set(people.map((p) => p.role).filter(Boolean))].sort().map((role) => ({id:role,label:role}));
}
export function filterEventTeam(people, roles) {
  const available = new Set(people.map((p) => p.role));
  const selected = roles.filter((role) => available.has(role));
  return selected.length ? people.filter((p) => selected.includes(p.role)) : people;
}
