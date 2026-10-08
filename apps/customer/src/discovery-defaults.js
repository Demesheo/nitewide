import { qualifiedDiscoveryCity } from './lib/discovery-selection.js';

export const discoveryAreaStorageKey = 'nitewide.discovery-area';

// An explicit URL selection (including an empty/invalid one) always wins.
export function initialDiscoveryCity(route, preferred, explicitCity = false) {
  const selected = explicitCity ? route.city : preferred;
  return qualifiedDiscoveryCity(selected) || (explicitCity ? route.city.trim() : '');
}

const REVERSE_GEOCODE_URL =
  "https://api.bigdatacloud.net/data/reverse-geocode-client";

export function localDateInputValue(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatCity(location) {
  const city = location?.city || location?.locality;
  if (!city) return "";
  const subdivisionCode = location?.principalSubdivisionCode?.split("-").at(-1);
  const region = subdivisionCode || location?.principalSubdivision;
  const country = location?.countryCode?.toUpperCase();
  const label = region && region.toLowerCase() !== city.toLowerCase() ? `${city}, ${region}` : city;
  return country && country !== 'US' ? `${label}, ${country}` : label;
}

async function reverseGeocode(fetchImpl, coordinates, signal) {
  const params = new URLSearchParams({ localityLanguage: "en" });
  if (coordinates) {
    params.set("latitude", String(coordinates.latitude));
    params.set("longitude", String(coordinates.longitude));
  }
  const response = await fetchImpl(`${REVERSE_GEOCODE_URL}?${params}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Location lookup failed");
  return formatCity(await response.json());
}

function currentCoordinates(geolocation) {
  if (!geolocation) return Promise.reject(new Error("Geolocation unavailable"));
  return new Promise((resolve, reject) =>
    geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      reject,
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8_000 },
    ),
  );
}

export async function detectCurrentCity({
  fetchImpl = fetch,
  geolocation = globalThis.navigator?.geolocation,
  requestPrecise = false,
  signal,
} = {}) {
  const approximateCity = reverseGeocode(fetchImpl, null, signal).catch(() => "");
  // Automatic discovery never opens the browser's precise-location prompt.
  if (!requestPrecise) return approximateCity;
  try {
    const coordinates = await currentCoordinates(geolocation);
    const preciseCity = await reverseGeocode(fetchImpl, coordinates, signal);
    if (preciseCity) return preciseCity;
  } catch (_error) {
    // Permission denial, timeouts, and third-party failures all use the less precise fallback.
  }
  return approximateCity;
}
