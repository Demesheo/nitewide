// Only customer-owned booking notifications may open admission credentials.
export function notificationTarget(item) {
  if (item.kind === 'purchase_confirmed') return { type: 'booking', kind: 'purchase', id: item.metadata?.orderId };
  if (['guestlist_approved', 'guestlist_invited', 'guestlist_declined'].includes(item.kind)) {
    return { type: 'booking', kind: 'guestlist', id: item.metadata?.entryId };
  }
  return item.eventId ? { type: 'event', id: item.eventId } : null;
}

export async function loadNotificationBooking(target, request, token) {
  if (!target.id) throw new Error('This notification no longer has a linked booking. Please check your Booked list.');
  const id = encodeURIComponent(target.id);
  return request(target.kind === 'guestlist' ? `/customer/guestlists/${id}/pass` : `/customer/purchases/${id}/tickets`, { token });
}

export async function activateNotification(item, navigate, request, token) {
  const openedBooking = await navigate(item);
  if (openedBooking) {
    await request(`/notifications/${encodeURIComponent(item.id)}`, { token, method: 'DELETE' });
  } else if (!item.readAt) {
    await request(`/notifications/${encodeURIComponent(item.id)}/read`, { token, method: 'POST' });
  }
  return openedBooking;
}
