export function mapsUrlForLocation(location) {
  if (!location?.addressLine1 || location.privacy === 'private' || (location.privacy === 'attendees_only' && location.addressVisible !== true)) return null;
  const address = [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.region,
    location.postalCode,
    location.countryCode,
  ].filter(Boolean).join(', ');
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
}
