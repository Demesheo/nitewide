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
export const saleLabels = { on_sale: 'On sale', scheduled: 'Opens on schedule', waiting_for_tier: 'Waiting for prior tier', sold_out: 'Sold out', closed: 'Window closed', inactive: 'Closed manually' };

export function eventTeamRoles(people) {
  return [...new Set(people.map((p) => p.role).filter(Boolean))].sort().map((role) => ({id:role,label:role}));
}
export function filterEventTeam(people, roles) {
  const available = new Set(people.map((p) => p.role));
  const selected = roles.filter((role) => available.has(role));
  return selected.length ? people.filter((p) => selected.includes(p.role)) : people;
}

export function eventTeamSalesSlices({ people = [], channels = [], summary }) {
  const slices = people.filter((person) => person.salesCents > 0).map((person) => ({
    id: person.userId,
    name: person.name,
    salesCents: person.salesCents,
  }));
  const channelSales = (name) => channels.filter((channel) => channel.name === name).reduce((sum, channel) => sum + channel.salesCents, 0);
  slices.push({ id: 'direct', name: 'Direct sales', salesCents: channelSales('Direct') });
  const otherReferrals = channelSales('Other referral');
  if (otherReferrals > 0) slices.push({ id: 'other-referrals', name: 'Other referrals', salesCents: otherReferrals });
  const remainder = Math.max(0, (summary?.salesCents || 0) - slices.reduce((sum, slice) => sum + slice.salesCents, 0));
  if (remainder > 0) slices.push({ id: 'unattributed', name: 'Unattributed sales', salesCents: remainder });
  return slices.sort((a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name));
}
