const locationFields = ['name', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode', 'privacy'];
export function requiresEventNotice(event, payload) {
  if (event?.status !== 'published') return false;
  if (payload.status === 'cancelled') return true;
  if (['startsAt', 'endsAt'].some((key) => new Date(payload[key]).getTime() !== new Date(event[key]).getTime())) return true;
  if ((payload.locationId || null) !== (event.locationId || null)) return true;
  return Boolean(!payload.locationId && payload.location && locationFields.some((key) => (payload.location[key] || '') !== (event.location?.[key] || '')));
}
