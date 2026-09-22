const { overlaps } = require('./seed-booking-policy');
const aliases = { 'room-22': ['room22'], elixir: ['elixir'], sessions: ['sessions'], 'taco-kat': ['tacokat'], robinson: ['robinson'], mcqueens: ['mcqueens'] };
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function matchVenue(name, address = '') {
  if (!/\bOrlando\b/i.test(address)) return null;
  const matches = Object.entries(aliases).filter(([, names]) => names.some(alias => normalize(name).includes(alias)));
  return matches.length === 1 ? matches[0][0] : null;
}
function firstNonOverlapping(events, existing = []) {
  const kept = [], skipped = [];
  for (const event of events) {
    const conflict = [...existing, ...kept].find(other => other.venueSlug === event.venueSlug && overlaps(other, event));
    if (conflict) skipped.push({ event, conflict }); else kept.push(event);
  }
  return { kept, skipped };
}
module.exports = { matchVenue, firstNonOverlapping };
