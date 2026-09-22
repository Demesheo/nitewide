import { compareEventListings } from './discovery.js';

// One card per event, with an explicit choice when multiple connections refer it.
export function connectionEvents(entries, { people = null, city = 'all', query = '' } = {}, now = new Date()) {
  const groups = new Map();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    if (!entry.code || !entry.referrer?.id || !entry.event?.id || new Date(entry.event.startsAt) <= now) continue;
    if (people !== null && !people.includes(entry.referrer.id)) continue;
    if (city !== 'all' && connectionCity(entry.event) !== city) continue;
    const text = [entry.event.title, entry.event.organization?.name, entry.event.location?.city, entry.event.location?.name, entry.referrer.name].filter(Boolean).join(' ').toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;
    if (!groups.has(entry.event.id)) groups.set(entry.event.id, { event: entry.event, referrals: [] });
    const referrals = groups.get(entry.event.id).referrals;
    if (!referrals.some((referral) => referral.referrer.id === entry.referrer.id)) referrals.push(entry);
  }
  return [...groups.values()].map((group) => ({ ...group, referrals: group.referrals.sort((a, b) => a.referrer.name.localeCompare(b.referrer.name)) }))
    .sort((a, b) => compareEventListings(a.event, b.event));
}
export function toggleConnectionSelection(selected, id) {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}
export function applyConnectionSelection(draft, availableIds) {
  const selected = [...new Set(draft)].filter((id) => availableIds.includes(id));
  return selected.length === availableIds.length ? null : selected;
}
export function connectionCity(event) {
  return [event.location?.city, event.location?.region].filter(Boolean).join(', ') || 'Location to be announced';
}
export function selectedConnection(group, personId) {
  return group.referrals.find((entry) => entry.referrer.id === personId) || group.referrals[0];
}
export function connectionLink(entry, origin) {
  const url = new URL('/', origin);
  url.searchParams.set('event', entry.event.id);
  url.searchParams.set('ref', entry.code);
  return url.toString();
}
