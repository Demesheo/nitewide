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
    const locationId = event.locationId || event.location.id;
    if (!groups.has(id)) groups.set(id, { id, label: locationId ? event.location.name || event.location.addressLine1 || 'Event location' : 'No event location', organizationId: event.organizationId || null, creatorUserId: event.organizationId ? null : event.creatorUserId, location: event.location, locationIds: [] });
    const group = groups.get(id);
    if (locationId && !group.locationIds.includes(locationId)) group.locationIds.push(locationId);
  }
  return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
function filterVenues(events, selected = []) {
  return selected.length ? events.filter(event => selected.includes(venueKey(event))) : events;
}
// A physical location can host multiple organizations or independent creators.
// Preserve that owner dimension when translating a selected venue group to SQL.
function venueFilter(options, selected) {
  const values = {};
  const clauses = options.filter((venue) => selected.includes(venue.id)).map((venue, index) => {
    if (venue.locationIds.length) values[`venueLocations${index}`] = venue.locationIds;
    values[`venueOwner${index}`] = venue.organizationId || venue.creatorUserId;
    return `(${venue.locationIds.length ? `e.location_id IN (:venueLocations${index})` : 'e.location_id IS NULL'} AND ${venue.organizationId
      ? `e.organization_id = :venueOwner${index}`
      : `e.organization_id IS NULL AND e.creator_user_id = :venueOwner${index}`})`;
  });
  return { sql: clauses.length ? `(${clauses.join(' OR ')})` : 'FALSE', values };
}
module.exports = { venueKey, venueOptions, filterVenues, venueFilter };
