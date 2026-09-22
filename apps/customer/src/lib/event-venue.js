// An organization is the host/business, not necessarily the physical venue.
export function eventVenueName(event, fallback = 'Independent experience') {
  return event?.location?.name?.trim() || event?.organization?.name?.trim() || fallback;
}
