export const myEventGuestlistStatuses = [
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Approved' },
  { id: 'rejected', label: 'Denied' },
  { id: 'checked_in', label: 'Checked in' },
  { id: 'no_show', label: 'No-show' },
];

export function myEventGuestStatus(status) {
  return myEventGuestlistStatuses.find((item) => item.id === status)?.label || String(status || 'Unknown').replaceAll('_', ' ');
}

export function myEventActionsReadOnly(detail, now = Date.now()) {
  if (detail?.capabilities?.readOnly !== false) return true;
  const event = detail.event || detail.summary;
  if (['completed', 'cancelled'].includes(event?.status)) return true;
  const end = Date.parse(event?.endsAt);
  return Number.isFinite(end) && end <= now;
}

export function myEventGuestActions(entry, { readOnly = true, canReviewGuestlist = false } = {}) {
  const admitted = Number(entry?.checkedInSpots || 0) > 0 || Boolean(entry?.checkedInAt) || entry?.status === 'checked_in';
  return {
    review: !readOnly && canReviewGuestlist && entry?.status === 'pending',
    revoke: !readOnly && canReviewGuestlist && entry?.status === 'confirmed' && !admitted,
    copy: !readOnly && Boolean(entry?.hasInvitation) && ['confirmed', 'checked_in'].includes(entry?.status),
    admitted,
  };
}

export function myEventGuestPageQuery({ page = 1, search = '', statuses = [] } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: '10', search: search.trim(), sortKey: 'requestedValue', descending: 'true' });
  for (const { id } of myEventGuestlistStatuses) if (statuses.includes(id)) query.append('statuses', id);
  return query.toString();
}

export function myEventInvitePools(pools) {
  return [
    ...(pools?.direct ? [{ id: 'direct', label: 'Event direct guestlist' }] : []),
    ...(pools?.own || []).map((pool) => ({ id: pool.id, label: `My allocation${pool.guestlistAllocation != null ? ` · ${pool.guestlistAllocation} spots` : ''}` })),
  ];
}

export function myEventInviteBody(fields) {
  const name = fields.name.trim();
  const partySize = Number(fields.partySize);
  if (!name || name.length > 120) throw new Error('Enter a guest name, up to 120 characters.');
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw new Error('Choose between 1 and 20 spots.');
  if (!fields.pool) throw new Error('Choose an available guestlist pool.');
  const body = { pool: fields.pool === 'direct' ? 'direct' : 'own', ...(fields.pool === 'direct' ? {} : { eventAffiliateId: fields.pool }), name, inviteBy: fields.inviteBy, partySize };
  if (fields.inviteBy === 'email') {
    const email = fields.email.trim();
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    body.email = email;
  } else if (fields.inviteBy === 'phone') {
    const phone = fields.phone.trim();
    if (!phone) throw new Error('Enter a phone number, including its country code.');
    body.phone = phone;
  } else if (fields.inviteBy !== 'personal') throw new Error('Choose how you will share this invitation.');
  return body;
}

export function myEventInvitationUrl(token, origin) {
  if (!token || typeof token !== 'string') throw new Error('The invitation link is unavailable. Refresh and try again.');
  const url = new URL('/', origin);
  url.searchParams.set('guestlistInvite', token);
  return url.toString();
}

export function myEventAccessLost(error, eventResource = false) {
  return [401, 403].includes(error?.status) || (eventResource && error?.status === 404);
}

export function myEventOperationsClosed(error) {
  return ['EVENT_FINISHED', 'GUESTLIST_CLOSED', 'REFERRALS_CLOSED'].includes(error?.code);
}

export function myEventGuestDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
}
