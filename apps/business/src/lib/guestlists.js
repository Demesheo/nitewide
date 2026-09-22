export const guestlistStatuses = [
  { id: 'pending', label: 'Awaiting approval' },
  { id: 'confirmed', label: 'Approved' },
  { id: 'rejected', label: 'Declined' },
  { id: 'checked_in', label: 'Checked in' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'no_show', label: 'No-show' },
];

export function guestlistEventName(title, maxLength = 36) {
  return title.length > maxLength ? `${title.slice(0, maxLength)}…` : title;
}

export function guestlistStatusesForEvent(event, now = Date.now()) {
  return event && Date.parse(event.startsAt) > now
    ? guestlistStatuses.filter(({ id }) => id !== 'checked_in' && id !== 'no_show')
    : guestlistStatuses;
}

export function recentAndUpcomingGuestlistEvents(events, now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return events
    .filter((event) => {
      const endsAt = Date.parse(event.endsAt || event.startsAt);
      return Number.isFinite(endsAt) && endsAt >= cutoff;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title));
}

export function reviewableGuestlistEvents(events, now = Date.now()) {
  return recentAndUpcomingGuestlistEvents(events.filter((event) => event.canReviewGuestlist ?? event.canManage), now);
}

export function guestlistStatusQuery(statuses) {
  const query = new URLSearchParams();
  if (!statuses.length) query.set('status', 'all');
  else statuses.forEach((status) => query.append('status', status));
  return query.toString();
}
