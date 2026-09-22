const { createHash } = require('node:crypto');
const clean = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
// Location rows can be duplicated by source imports. Group physical venues,
// within the authorized organization, without treating its business name as a venue.
function venueKey(event) {
  const location = event.location;
  if (!location) return null;
  const identity = [event.organizationId || `creator:${event.creatorUserId}`, clean(location.name), clean(location.addressLine1), clean(location.city), clean(location.region), clean(location.countryCode)];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
function venueOptions(events) {
  const groups = new Map();
  for (const event of events) {
    const id = venueKey(event);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { id, label: event.location.name || event.location.addressLine1 || 'Event location', organizationId: event.organizationId || null, location: event.location, locationIds: [] });
    const group = groups.get(id), locationId = event.locationId || event.location.id;
    if (locationId && !group.locationIds.includes(locationId)) group.locationIds.push(locationId);
  }
  return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
function filterVenues(events, selected = []) {
  return selected.length ? events.filter(event => selected.includes(venueKey(event))) : events;
}
module.exports = { venueKey, venueOptions, filterVenues };
