import { compareEventListings } from './discovery.js';

export function upcomingSavedEvents(events, savedIds, now = Date.now()) {
  const ids = new Set(savedIds);
  return events.filter((event) => ids.has(event.id) && new Date(event.startsAt).getTime() >= now)
    .sort(compareEventListings);
}
