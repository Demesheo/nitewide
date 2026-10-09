const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtemp, mkdir, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { installAppStatic } = require('../src/http/app-static');
const { renderDocument } = require('../src/http/public-seo');
const { publicMetadata, eventOffers } = require('../../shared/public-metadata.mjs');
const { request } = require('./support/http-client.cjs');
const id = 'a1000000-0000-4000-8000-000000000001', missing = 'a1000000-0000-4000-8000-000000000002';
const event = { id, title: 'Friday & Friends', summary: 'A public night.', startsAt: '2099-10-09T21:00:00-04:00', endsAt: '2099-10-10T02:00:00-04:00',
  organization: { name: 'Public venue' }, feeMode: 'buyer', imageUrl: '/flyer.png',
  location: { name: 'Main Room', privacy: 'public', addressLine1: '123 Public Street', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York' },
  offerings: [{ name: 'Admission', priceCents: 1000, currency: 'USD', saleState: 'on_sale', inventoryMode: 'finite', quantityTotal: 100, quantitySold: 0 }] };
const document = '<!doctype html><html><head><title>Old</title><meta name="description" content="old"><meta property="og:title" content="old"><meta name="twitter:title" content="old"><link rel="canonical" href="https://old.test/"></head><body><div id="root"><main><div>Startup fallback</div></main></div><script src="/assets/app.js"></script></body></html>';
const config = { APP_ENVIRONMENT: 'production', APP_ROUTING_MODE: 'subdomains', CUSTOMER_APP_URL: 'https://nitewide.test/',
  BUSINESS_APP_URL: 'https://business.nitewide.test/', businessAppUrl: 'https://business.nitewide.test/', ADMIN_APP_URL: 'https://admin.nitewide.test/',
  CORS_ORIGINS: 'https://nitewide.test,https://business.nitewide.test,https://admin.nitewide.test' };
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'nitewide-seo-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', name, 'dist'); await mkdir(dist, { recursive: true }); await writeFile(path.join(dist, 'index.html'), document);
  }
  const reads = [];
  const service = {
    home: async () => { reads.push('home'); return { items: [event] }; },
    event: async value => { reads.push('event'); if (value === missing) throw Object.assign(new Error('Missing'), { status: 404 }); return { event, indexable: true }; },
    rundown: async value => { reads.push('rundown'); if (value === missing) throw Object.assign(new Error('Missing'), { status: 404 }); return { profile: { name: 'Alex Morgan', kind: 'personal' }, items: [{ ...event, referralCode: `RUN-${id}` }] }; },
    sitemapIndex: async () => [{ kind: 'static', page: 1 }, { kind: 'events', page: 1 }, { kind: 'rundowns', page: 1 }],
    sitemap: async (kind, page) => { if (page !== 1 || !['events', 'rundowns'].includes(kind)) throw Object.assign(new Error('Missing'), { status: 404 }); return [`https://nitewide.test/${kind}/${id}`]; },
  };
  const app = express(); installAppStatic(app, root, { ...config, ...overrides }, service);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { reads, service, get: (url, host = 'nitewide.test', headers = {}) => request(server, url, { headers: { host, ...headers } }) };
}
test('public HTML is readable without JavaScript, canonical and identical for people and crawlers; old URLs preserve context', async t => {
  const { get } = await fixture(t);
  for (const url of [`/events/${id}?ref=STAFF-code&city=Orlando`, `/?event=${id}&ref=STAFF-code`]) {
    const response = await get(url); assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.text, /<h1>Friday &amp; Friends<\/h1>/); assert.match(response.text, /USD 11.64 total, fees included/);
    assert.match(response.text, new RegExp(`<link rel="canonical" href="https://nitewide.test/events/${id}">`));
    assert.equal((response.text.match(/rel="canonical"/g) || []).length, 1); assert.doesNotMatch(response.text, /content="old"|Startup fallback/);
    const json = JSON.parse(response.text.match(/id="nitewide-public-jsonld">([\s\S]*?)<\/script>/)[1]);
    assert.equal(json[0]['@type'], 'Event'); assert.equal(json[0].offers[0].price, '11.64');
    assert.equal(json[0].startDate, '2099-10-10T01:00:00.000Z'); assert.equal(json[0].location.address.streetAddress, '123 Public Street');
    assert.equal(response.headers['x-robots-tag'], undefined);
    assert.equal((await get(url, 'nitewide.test', { 'user-agent': 'Googlebot' })).text, response.text, 'no user-agent cloaking');
  }
  const home = await get('/'); assert.match(home.text, /<h1>Find your kind of night\.<\/h1>/); assert.match(home.text, new RegExp(`href="https://nitewide.test/events/${id}"`));
  const rundown = await get(`/rundowns/${id}`); assert.equal(rundown.status, 200); assert.match(rundown.text, /Alex Morgan’s Rundown/);
  assert.match(rundown.text, new RegExp(`events/${id}\\?ref=RUN-${id}`)); assert.match(rundown.text, /"@type":"CollectionPage"/);
  assert.doesNotMatch(rundown.text, /"@type":"Event"/);
  assert.match((await get(`/?rundown=${id}`)).text, new RegExp(`rel="canonical" href="https://nitewide.test/rundowns/${id}"`));
  const business = await get('/', 'business.nitewide.test'); assert.match(business.text, /<h1>Nitewide for Business<\/h1>/);
  assert.match(business.text, /Publish with your flyer/); assert.match(business.text, /https:\/\/nitewide.test\/images\/nitewide-social/);
  const redirect = await get(`/events/${id}?ref=STAFF-code&verifyEmail=private`, 'business.nitewide.test');
  assert.equal(redirect.headers.location, `https://nitewide.test/events/${id}?ref=STAFF-code`);
  assert.equal((await get('/', 'spoof.test')).status, 404);
});
test('private workspaces, previews, filters and staging/demo remain noindex without private data reads', async t => {
  const { get, reads } = await fixture(t);
  for (const [url, host] of [['/?tab=booked', 'nitewide.test'], ['/?tab=my-events', 'nitewide.test'], ['/?rundownPreview=personal', 'nitewide.test'],
    ['/?resetPassword=private', 'nitewide.test'], ['/?guestlistInvite=private', 'nitewide.test'], ['/?city=Orlando', 'nitewide.test'],
    ['/?section=payments', 'business.nitewide.test'], ['/?invite=private', 'business.nitewide.test'], ['/sign-in', 'business.nitewide.test'], ['/', 'admin.nitewide.test']]) {
    const response = await get(url, host); assert.equal(response.status, 200); assert.match(response.headers['x-robots-tag'], /noindex/);
    assert.match(response.text, /name="robots" content="noindex/); assert.doesNotMatch(response.text, /nitewide-public-jsonld/);
    if (!url.includes('city=')) assert.doesNotMatch(response.text, /rel="canonical"/);
  }
  assert.deepEqual(reads, []);
  for (const overrides of [{ APP_ENVIRONMENT: 'staging' }, { hostedDemo: true }]) {
    const nonproduction = await fixture(t, overrides);
    assert.match((await nonproduction.get(`/events/${id}`)).headers['x-robots-tag'], /noindex/);
    assert.match((await nonproduction.get('/robots.txt')).text, /Disallow: \/\n/);
    assert.equal((await nonproduction.get('/sitemap.xml')).status, 404);
  }
});
test('missing and malformed public pages return real 404s; unavailable storage returns 503, never an indexable empty success', async t => {
  const { get, service } = await fixture(t);
  for (const url of [`/events/${missing}`, `/rundowns/${missing}`, '/events/invalid', '/rundowns/invalid', '/events/', '/?event=invalid']) {
    const response = await get(url); assert.equal(response.status, 404); assert.match(response.headers['x-robots-tag'], /noindex/); assert.doesNotMatch(response.text, /rel="canonical"|nitewide-public-jsonld/);
  }
  service.event = async () => { throw new Error('Synthetic database outage'); };
  const response = await get(`/events/${id}`); assert.equal(response.status, 503); assert.match(response.headers['x-robots-tag'], /noindex/); assert.doesNotMatch(response.text, /database outage/);
});
test('sitemaps contain clean canonical public URLs, are partitioned, and never invent lastmod or trust Host', async t => {
  const { get } = await fixture(t);
  const robots = await get('/robots.txt'); assert.match(robots.text, /Sitemap: https:\/\/nitewide.test\/sitemap.xml/);
  const index = await get('/sitemap.xml'); assert.equal(index.status, 200); assert.match(index.text, /<sitemapindex/); assert.match(index.text, /sitemaps\/events-1.xml/);
  for (const kind of ['events', 'rundowns']) {
    const leaf = await get(`/sitemaps/${kind}-1.xml`); assert.equal(leaf.status, 200); assert.match(leaf.headers['content-type'], /application\/xml/);
    assert.match(leaf.text, new RegExp(`https://nitewide.test/${kind}/${id}`)); assert.doesNotMatch(leaf.text, /lastmod|ref=|preview/);
    assert.equal((await get(`/sitemaps/${kind}-2.xml`)).status, 404);
  }
  assert.equal((await get('/sitemaps/unknown.xml')).status, 404);
  assert.equal((await get('/sitemap.xml', 'admin.nitewide.test')).status, 404);
  assert.match((await get('/robots.txt', 'admin.nitewide.test')).text, /Disallow: \/\n/);
  const business = await get('/sitemap.xml', 'business.nitewide.test'); assert.match(business.text, /https:\/\/business.nitewide.test\//);
});
test('metadata is closed to private locations and uses obtainable, all-in minimum-quantity prices', () => {
  const base = { origin: config.CUSTOMER_APP_URL, kind: 'event', event };
  assert.equal(publicMetadata(base).structured[0].offers[0].price, '11.64');
  for (const privacy of ['attendees_only', 'private']) {
    const metadata = publicMetadata({ ...base, event: { ...event, location: { ...event.location, privacy, addressLine1: 'Secret Street' } } });
    assert.deepEqual(metadata.structured, []); assert.equal(JSON.stringify(metadata).includes('Secret Street'), false);
  }
  assert.deepEqual(publicMetadata({ ...base, indexable: false }).structured, []);
  const offers = eventOffers({ ...event, offerings: [
    { ...event.offerings[0], name: 'Group', minPerOrder: 2, maxPerOrder: 2 },
    { ...event.offerings[0], name: 'Sold out', quantitySold: 100 },
    { ...event.offerings[0], name: 'Hidden', visibility: 'hidden' },
    { ...event.offerings[0], name: 'Future', saleState: 'scheduled' },
    { ...event.offerings[0], name: 'Ineligible absorbed', priceCents: 1, effectiveFeeMode: 'absorbed' },
  ] }, `https://nitewide.test/events/${id}`);
  assert.equal(offers.length, 1); assert.match(offers[0].name, /order of 2/); assert.equal(offers[0].price, '23.20');
  const metadata = publicMetadata({ ...base, event: { ...event, imageUrl: 'javascript:alert(1)' } }); assert.match(metadata.image, /nitewide-social/);
});
test('HTML attributes and JSON-LD cannot break out of their inert data contexts', () => {
  const attack = '</script><script>alert(1)</script>" & <img src=x onerror=alert(1)>', metadata = {
    title: attack, description: attack, canonical: `https://nitewide.test/?q=${encodeURIComponent(attack)}`, image: 'https://nitewide.test/flyer.png',
    robots: 'index, follow', structured: [{ name: attack }],
  };
  const html = renderDocument(document, metadata, '<main>Safe content</main>');
  assert.doesNotMatch(html, /<script>alert|<img src=x/); assert.match(html, /&lt;\/script&gt;/);
  assert.deepEqual(JSON.parse(html.match(/id="nitewide-public-jsonld">([\s\S]*?)<\/script>/)[1]), metadata.structured);
  assert.match(html, /<div id="root"><main>Safe content<\/main><\/div>/); assert.match(html, /src="\/assets\/app.js"/);
});
test('the minimal production image includes every public SEO runtime module', async () => {
  const dockerfile = await readFile(path.resolve(__dirname, '../../../Dockerfile'), 'utf8');
  for (const filename of ['apps/shared/public-links.mjs', 'apps/shared/public-metadata.mjs', 'apps/business/src/lib/landing-content.js']) {
    assert.ok(dockerfile.includes(`COPY --from=build /app/${filename} ${filename}`), filename);
    await readFile(path.resolve(__dirname, '../../..', filename), 'utf8');
  }
});
