import test from "node:test";
import assert from "node:assert/strict";
import { stat, readFile } from 'node:fs/promises';
import { eventImageSource, eventArtworkState, fallbackArtwork, genericFallbackArtwork, NIGHTLIFE_ARTWORK } from "../src/lib/presentation.js";
import { VENUE_ARTWORK, venueArtwork, venuePhoto } from '../src/lib/venue-artwork.js';
test("event artwork prefers uploaded image URLs and supports separate API hosts", () => {
  assert.equal(eventImageSource({}), null);
  assert.equal(
    eventImageSource({ imageUrl: "/api/media/images/abc" }),
    "/api/media/images/abc",
  );
  assert.equal(
    eventImageSource(
      { imageUrl: "/api/media/images/abc" },
      "https://api.nitewide.test/api",
    ),
    "https://api.nitewide.test/api/media/images/abc",
  );
});
test('uploaded flyer wins; failure falls back to local artwork without a retry loop', () => {
  const event = { title: 'Friday Nights', category: 'nightlife', imageUrl: '/api/media/images/flyer' };
  const base = 'https://api.nitewide.test/api';
  const uploaded = eventImageSource(event, base);
  assert.deepEqual(eventArtworkState(event, base), { src: uploaded, kind: 'flyer' });
  const fallback = fallbackArtwork(event);
  assert.deepEqual(eventArtworkState(event, base, [uploaded]), { src: fallback, kind: 'illustration' });
  assert.deepEqual(eventArtworkState(event, base, [uploaded, fallback]), { src: null, kind: 'placeholder' });
  assert.equal(eventArtworkState({ ...event, imageUrl: '/api/media/images/replacement' }, base, [uploaded, fallback]).kind, 'flyer');
});
test('missing flyer uses deterministic, category-appropriate local artwork', () => {
  assert.equal(fallbackArtwork({ category: 'concert' }), NIGHTLIFE_ARTWORK.dancefloor);
  assert.equal(fallbackArtwork({ category: 'private' }), NIGHTLIFE_ARTWORK.lounge);
  assert.equal(fallbackArtwork({ title: 'A', organization: { name: 'OHM' } }), fallbackArtwork({ title: 'B', organization: { name: 'OHM' } }));
  assert.equal(eventArtworkState({}).kind, 'illustration');
});
test('changing the API host does not incorrectly retain a previous image failure', () => {
  const event = { imageUrl: '/api/media/images/flyer' };
  assert.equal(eventArtworkState(event, 'https://new.example', ['https://old.example/api/media/images/flyer']).kind, 'flyer');
});
test('fallback assets are shipped locally as lightweight WebP files', async () => {
  for (const src of [...Object.values(NIGHTLIFE_ARTWORK), ...VENUE_ARTWORK.flatMap((venue) => [venue.src, venue.photoSrc])]) {
    assert.ok(src.startsWith('/images/'));
    const file = new URL(`../public${src}`, import.meta.url);
    assert.ok((await stat(file)).size < 200_000);
    const bytes = await readFile(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});
test('all six Orlando venues have distinct artwork and preserve the supplied Instagram handles', () => {
  assert.equal(new Set(VENUE_ARTWORK.map((venue) => venue.src)).size, 6);
  assert.deepEqual(VENUE_ARTWORK.map((venue) => venue.instagram), ['parlayorlando', 'edenthelounge', 'shakailounge', 'auraorlando_', 'larosaorl_', 'celine_orlando']);
  for (const venue of VENUE_ARTWORK) {
    const location = { city: ' Orlando ', region: 'FL', countryCode: 'US' };
    assert.equal(fallbackArtwork({ organization: { slug: venue.slug }, location, category: 'concert' }), venue.photoSrc);
    for (const name of venue.names) {
      assert.equal(venueArtwork({ organization: { name: name.toUpperCase() }, location }), venue.src);
    }
  }
});
test('venue matching does not mistake titles, partial names or other cities for curated Orlando venues', () => {
  assert.equal(venueArtwork({ title: 'Celine', location: { city: 'Orlando' } }), null);
  for (const location of [undefined, { city: 'Miami' }, { city: 'Orlando', region: 'CA' }, { city: 'Orlando', countryCode: 'GB' }]) {
    assert.equal(venueArtwork({ organization: { slug: 'celine', name: 'Celine' }, location }), null);
  }
  assert.equal(venueArtwork({ organization: { name: 'Aura Festival' }, location: { city: 'Orlando' } }), null);
  assert.equal(venueArtwork({ organization: { slug: 'another-aura', name: 'Aura' }, location: { city: 'Orlando' } }), null);
});
test('uploaded flyer wins over real venue photo, then generated art is the last image resort', () => {
  const event = { organization: { slug: 'parlay' }, location: { city: 'Orlando' }, imageUrl: '/flyer.webp' };
  const venue = venueArtwork(event);
  const photo = venuePhoto(event);
  const generic = genericFallbackArtwork(event);
  assert.deepEqual(eventArtworkState(event), { src: '/flyer.webp', kind: 'flyer' });
  assert.deepEqual(eventArtworkState(event, undefined, ['/flyer.webp']), { src: photo, kind: 'photo' });
  assert.deepEqual(eventArtworkState(event, undefined, ['/flyer.webp', photo]), { src: venue, kind: 'illustration' });
  assert.deepEqual(eventArtworkState(event, undefined, ['/flyer.webp', photo, venue]), { src: generic, kind: 'illustration' });
  assert.deepEqual(eventArtworkState(event, undefined, ['/flyer.webp', photo, venue, generic]), { src: null, kind: 'placeholder' });
});
test('all curated real photos have stable source links and are used without an event flyer', () => {
  for (const venue of VENUE_ARTWORK) {
    assert.match(venue.photoSource, /^https:\/\/www\.instagram\.com\//);
    assert.ok(venue.photoCredit);
    const event = { organization: { slug: venue.slug }, location: { city: 'Orlando' } };
    assert.deepEqual(eventArtworkState(event), { src: venue.photoSrc, kind: 'photo' });
  }
  assert.equal(venuePhoto({ organization: { slug: 'eden' }, location: { city: 'Miami' } }), null);
});
test('card flyers stretch edge-to-edge while original proportions remain available in details', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.card-image img\.uploaded-artwork\s*\{[^}]*object-fit:\s*fill/);
  assert.match(css, /\.detail-art img\.uploaded-artwork\s*\{[^}]*object-fit:\s*contain/);
});
test('event detail artwork retains a portrait frame for venue photos and generated fallbacks', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.detail-art\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(css, /\.event-modal\s*\{[^}]*overflow-anchor:\s*none/);
  assert.match(css, /\.event-modal\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/);
});
test('opened flyers use intrinsic proportions with an iPhone-height cap instead of letterboxing', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.detail-art:has\(> \.artwork-flyer\)\s*\{[^}]*aspect-ratio:\s*auto/);
  assert.match(css, /\.detail-art:has\(> \.artwork-flyer\) > \.event-artwork\s*\{[^}]*position:\s*static/);
  assert.match(css, /\.detail-art:has\(> \.artwork-flyer\) img\.uploaded-artwork\s*\{[^}]*max-height:\s*min\(48svh, 420px\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.detail-art:has\(> \.artwork-flyer\) img\.uploaded-artwork \{ max-height: 38svh; \}/);
});
test('opened event flyer is compact and centered on short mobile viewports', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.detail-art\s*\{[^}]*width:\s*min\(100%, 256px, 32svh\)/);
  assert.match(css, /\.detail-art\s*\{[^}]*align-self:\s*center/);
});
