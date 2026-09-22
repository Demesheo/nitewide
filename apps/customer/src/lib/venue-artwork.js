// Curated local demo photos and last-resort mood art. See docs/CUSTOMER_ARTWORK.md for sources and usage review.
export const VENUE_ARTWORK = [
  { slug: 'parlay', names: ['Parlay', 'Parlay Orlando'], instagram: 'parlayorlando', src: '/images/parlay-orlando-mood.webp' },
  { slug: 'eden', names: ['Eden', 'Eden The Lounge'], instagram: 'edenthelounge', src: '/images/eden-orlando-mood.webp' },
  { slug: 'shakai', names: ['Shakai', 'Shakai Lounge', 'Shakai Sushi Lounge'], instagram: 'shakailounge', src: '/images/shakai-orlando-mood.webp' },
  { slug: 'aura', names: ['Aura', 'Aura Nightclub'], instagram: 'auraorlando_', src: '/images/aura-orlando-mood.webp' },
  { slug: 'la-rosa', names: ['La Rosa'], instagram: 'larosaorl_', src: '/images/la-rosa-orlando-mood.webp' },
  { slug: 'celine', names: ['Celine', 'Celine Orlando'], instagram: 'celine_orlando', src: '/images/celine-orlando-mood.webp' },
];

const PHOTO_POSTS = {
  parlay: 'https://www.instagram.com/parlayorlando/', // User-supplied screenshot; original post URL unavailable.
  eden: 'https://www.instagram.com/edenthelounge/p/DdfekozoM-Z/',
  shakai: 'https://www.instagram.com/shakailounge/p/DN_-aeWEYIq/',
  aura: 'https://www.instagram.com/auraorlando_/reel/DGeSTMqsE_9/',
  'la-rosa': 'https://www.instagram.com/parcerosentertainment/p/DdKxyl6AHlU/',
  celine: 'https://www.instagram.com/celine_orlando/reel/DdeLfp2Et44/',
};
for (const venue of VENUE_ARTWORK) {
  venue.photoSrc = `/images/${venue.slug}-orlando-instagram.webp`;
  venue.photoSource = PHOTO_POSTS[venue.slug];
  venue.photoCredit = venue.slug === 'la-rosa' ? 'parcerosentertainment' : venue.instagram;
}

const normalize = (value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';

export function curatedVenue(event) {
  const { organization, location } = event;
  // Avoid applying Orlando venue imagery to same-name organizations elsewhere.
  if (normalize(location?.city) !== 'orlando') return null;
  if (location.region && !['fl', 'florida'].includes(normalize(location.region))) return null;
  if (location.countryCode && normalize(location.countryCode) !== 'us') return null;
  // Never borrow artwork from a different venue owned by the same organization.
  if (normalize(location.name)) return VENUE_ARTWORK.find(venue => venue.names.some(name => normalize(name) === normalize(location.name))) || null;
  if (!organization) return null;
  const slug = normalize(organization.slug);
  return VENUE_ARTWORK.find((venue) => slug
    ? venue.slug === slug
    : venue.names.some((name) => normalize(name) === normalize(organization.name))) || null;
}

export function venueArtwork(event) {
  return curatedVenue(event)?.src || null;
}

export function venuePhoto(event) {
  return curatedVenue(event)?.photoSrc || null;
}
