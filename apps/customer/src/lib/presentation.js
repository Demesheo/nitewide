import { venueArtwork, venuePhoto } from './venue-artwork.js';

export const NIGHTLIFE_ARTWORK = {
  dancefloor: '/images/afterhours-dancefloor.webp',
  lounge: '/images/velvet-vip-lounge.webp',
};
export function eventImageSource(event, apiBase) {
  if (!event.imageUrl) return null;
  return apiBase && /^https?:\/\//.test(apiBase)
    ? new URL(event.imageUrl, apiBase).href
    : event.imageUrl;
}
export const artIndex = (event) =>
  [...(event.location?.name || event.organization?.name || event.title || 'Nitewide')].reduce(
    (n, char) => n + char.charCodeAt(0),
    0,
  );
export function genericFallbackArtwork(event) {
  if (/concert|music|festival/.test(event.category || '')) return NIGHTLIFE_ARTWORK.dancefloor;
  if (/private|dining|lounge|reservation/.test(event.category || '')) return NIGHTLIFE_ARTWORK.lounge;
  return artIndex(event) % 2 ? NIGHTLIFE_ARTWORK.lounge : NIGHTLIFE_ARTWORK.dancefloor;
}
export function fallbackArtwork(event) {
  return venuePhoto(event) || venueArtwork(event) || genericFallbackArtwork(event);
}
export function eventArtworkState(event, apiBase, failedSources = []) {
  const uploaded = eventImageSource(event, apiBase);
  if (uploaded && !failedSources.includes(uploaded)) return { src: uploaded, kind: 'flyer' };
  const photo = venuePhoto(event);
  if (photo && !failedSources.includes(photo)) return { src: photo, kind: 'photo' };
  const fallback = [venueArtwork(event), genericFallbackArtwork(event)]
    .find((src) => src && !failedSources.includes(src));
  return fallback
    ? { src: fallback, kind: 'illustration' }
    : { src: null, kind: 'placeholder' };
}
export const eventDate = (event) =>
  new Date(event.startsAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: event.location?.timezone,
  });
export const eventTime = (event) =>
  new Date(event.startsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.location?.timezone,
  });

export function eventAddress(location) {
  if (!location) return 'Address not available yet';
  const region = [location.city, location.region].filter(Boolean).join(', ');
  const locality = [region, location.postalCode].filter(Boolean).join(' ');
  if (location.privacy && location.privacy !== 'public') {
    return [region, 'Exact address shared by the host'].filter(Boolean).join(' · ');
  }
  return [location.addressLine1, location.addressLine2, locality, location.countryCode]
    .filter(Boolean).join(', ') || 'Address not available yet';
}

export function eventAddressLines(location) {
  if (!location || (location.privacy && location.privacy !== 'public')) {
    return [eventAddress(location)];
  }
  const street = [location.addressLine1, location.addressLine2].filter(Boolean).join(', ');
  const region = [location.city, location.region].filter(Boolean).join(', ');
  const cityLine = [[region, location.postalCode].filter(Boolean).join(' '), location.countryCode]
    .filter(Boolean).join(', ');
  const lines = [street, cityLine].filter(Boolean);
  return lines.length ? lines : ['Address not available yet'];
}
