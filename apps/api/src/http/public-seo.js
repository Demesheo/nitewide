const { publicTarget, publicRouteParams, publicId, publicPath, eventPublicLink } = require('../../../shared/public-links.mjs');
const { publicMetadata, plainText, eventOffers } = require('../../../shared/public-metadata.mjs');
const { features } = require('../../../business/src/lib/landing-content.js');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const production = config => config.APP_ENVIRONMENT === 'production' && !config.hostedDemo;
function privatePage(name, url) {
  if (name === 'admin' || /(?:^|\/)sign-in\/?$/.test(url.pathname)) return true;
  const allowed = name === 'business' ? new Set(['utm_source', 'utm_medium', 'utm_campaign'])
    : new Set(['event', 'rundown', 'ref', 'tab', 'city', 'date', 'q', 'scope', 'sort', 'when', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
  return [...url.searchParams.keys()].some(key => !allowed.has(key))
    || (name === 'customer' && url.searchParams.has('tab') && url.searchParams.get('tab') !== 'discover');
}
function indexableRequest(config, name, url) {
  if (!production(config) || privatePage(name, url)) return false;
  if (name === 'customer' && !publicTarget(url.pathname) && !url.searchParams.has('event') && !url.searchParams.has('rundown')) {
    return !['city', 'date', 'q', 'scope', 'sort', 'when'].some(key => url.searchParams.has(key));
  }
  return true;
}
function renderDocument(document, metadata, content = '') {
  // Replace, rather than append, to prevent competing canonicals and stale
  // social tags. Never weaken CSP; JSON-LD is an inert, escaped data block.
  const clean = document.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*(?:name\s*=\s*["'](?:description|robots|twitter:[^"']*)["']|property\s*=\s*["']og:[^"']*["'])[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*id=["']nitewide-public-jsonld["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const tags = `<title>${escapeHtml(metadata.title)}</title>
<meta name="description" content="${escapeHtml(metadata.description)}">
<meta name="robots" content="${metadata.robots}">
${metadata.canonical ? `<link rel="canonical" href="${escapeHtml(metadata.canonical)}"><meta property="og:url" content="${escapeHtml(metadata.canonical)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Nitewide">
<meta property="og:title" content="${escapeHtml(metadata.title)}"><meta property="og:description" content="${escapeHtml(metadata.description)}">
<meta property="og:image" content="${escapeHtml(metadata.image)}"><meta property="og:image:alt" content="${escapeHtml(metadata.title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(metadata.title)}">
<meta name="twitter:description" content="${escapeHtml(metadata.description)}"><meta name="twitter:image" content="${escapeHtml(metadata.image)}">
${metadata.structured.length ? `<script type="application/ld+json" id="nitewide-public-jsonld">${safeJson(metadata.structured)}</script>` : ''}`;
  const result = clean.replace(/<\/head>/i, `${tags}</head>`);
  if (!content) return result;
  const root = /<div\s+id=["']root["'][^>]*>/i.exec(result);
  if (!root) return result;
  const divs = /<\/?div\b[^>]*>/gi;
  divs.lastIndex = root.index + root[0].length;
  let depth = 1, match;
  while ((match = divs.exec(result))) {
    depth += /^<\/div/i.test(match[0]) ? -1 : 1;
    if (!depth) return `${result.slice(0, root.index + root[0].length)}${content}${result.slice(match.index)}`;
  }
  return result;
}
function eventList(items, origin) {
  return `<ul>${items.map(event => `<li><a href="${escapeHtml(eventPublicLink(event.id, origin, event.referralCode))}">${escapeHtml(plainText(event.title))}</a> — <time datetime="${escapeHtml(new Date(event.startsAt).toISOString())}">${escapeHtml(new Date(event.startsAt).toISOString())}</time>${event.location?.city ? ` · ${escapeHtml(event.location.city)}` : ''}</li>`).join('')}</ul>`;
}
function fallback(title, body) {
  return `<main class="wrap"><p><a href="/">Nitewide</a></p><h1>${escapeHtml(title)}</h1>${body}<noscript><p>Enable JavaScript to explore all events, view more, sign in and book.</p></noscript></main>`;
}
function createPublicSeoHandler({ config, service }) {
  async function page(name, document, req, res) {
    const url = new URL(req.originalUrl, 'http://localhost'), privateView = privatePage(name, url), canIndex = indexableRequest(config, name, url);
    if (!canIndex) res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    // Minimal static fixtures and callers without a SEO service retain their
    // original HTML. Real built documents have a head and the React root.
    if (!service || !/<head[\s>]/i.test(document)) return res.type('html').send(document);
    const origin = name === 'business' ? config.businessAppUrl || config.BUSINESS_APP_URL || config.CUSTOMER_APP_URL : config.CUSTOMER_APP_URL;
    let descriptor = { origin, imageOrigin: config.CUSTOMER_APP_URL, indexable: canIndex, kind: privateView ? 'private' : name === 'business' ? 'business' : 'home' }, content = '';
    try {
      if (!privateView && name === 'customer') {
        const target = publicTarget(url.pathname), params = publicRouteParams(url.search, url.pathname);
        if (/^\/(events|rundowns)(?:\/|$)/.test(url.pathname) && !target) throw Object.assign(new Error('Page not found'), { status: 404 });
        if (params.has('event')) {
          const id = publicId(params.get('event'));
          if (!id) throw Object.assign(new Error('Event not found'), { status: 404 });
          const data = await service.event(id);
          descriptor = { ...descriptor, kind: 'event', ...data, indexable: canIndex && data.indexable };
          const event = data.event, loc = event.location, offers = eventOffers(event, new URL(publicPath('events', id), origin).toString());
          content = fallback(plainText(event.title), `<p>${escapeHtml(plainText(event.summary || event.description))}</p>
<p><time datetime="${escapeHtml(new Date(event.startsAt).toISOString())}">${escapeHtml(new Date(event.startsAt).toISOString())}</time></p>
<p>${escapeHtml([loc?.name, loc?.city, loc?.region].filter(Boolean).join(', '))}</p>
${loc?.privacy === 'public' && loc.addressLine1 ? `<p>${escapeHtml([loc.addressLine1, loc.addressLine2, loc.postalCode].filter(Boolean).join(', '))}</p>` : ''}
<h2>Tickets and packages</h2><ul>${offers.map(offer => `<li>${escapeHtml(offer.name)} — ${escapeHtml(offer.priceCurrency)} ${escapeHtml(offer.price)} total, fees included</li>`).join('')}</ul>`);
        } else if (params.has('rundown')) {
          const id = publicId(params.get('rundown'));
          if (!id) throw Object.assign(new Error('Rundown not found'), { status: 404 });
          const data = await service.rundown(id);
          descriptor = { ...descriptor, kind: 'rundown', id, ...data };
          content = fallback(`${plainText(data.profile.name)}’s Rundown`, `<p>Upcoming nights · Soonest first</p>${eventList(data.items, origin)}`);
        } else if (/^\/privacy\/?$/.test(url.pathname)) {
          descriptor.kind = 'privacy';
        } else if (canIndex) {
          const data = await service.home();
          content = fallback('Find your kind of night.', `<p>${escapeHtml(publicMetadata(descriptor).description)}</p><h2>Upcoming events</h2>${eventList(data.items, origin)}`);
        }
      } else if (!privateView && name === 'business') {
        content = fallback('Nitewide for Business', `<p>${escapeHtml(publicMetadata(descriptor).description)}</p>${features.map(feature => `<section><h2>${escapeHtml(feature.title)}</h2><p>${escapeHtml(feature.description)}</p></section>`).join('')}`);
      }
      const metadata = publicMetadata(descriptor);
      if (!descriptor.indexable) res.set('X-Robots-Tag', metadata.robots);
      return res.type('html').send(renderDocument(document, metadata, content));
    } catch (error) {
      const status = error.status === 404 ? 404 : error.status === 422 ? 422 : 503;
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const metadata = publicMetadata({ origin, kind: 'unavailable', indexable: false });
      return res.status(status).type('html').send(renderDocument(document, metadata, fallback('This page isn’t available.', '<p><a href="/">Discover events</a></p>')));
    }
  }
  const xml = (entries, index = false) => `<?xml version="1.0" encoding="UTF-8"?><${index ? 'sitemapindex' : 'urlset'} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(url => `<${index ? 'sitemap' : 'url'}><loc>${escapeHtml(url)}</loc></${index ? 'sitemap' : 'url'}>`).join('')}</${index ? 'sitemapindex' : 'urlset'}>`;
  const robots = name => {
    if (!production(config) || name === 'admin') return 'User-agent: *\nDisallow: /\n';
    const origin = name === 'business' ? config.businessAppUrl || config.BUSINESS_APP_URL : config.CUSTOMER_APP_URL;
    return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: ${new URL('/sitemap.xml', origin)}\n`;
  };
  async function sitemap(name, req, res) {
    res.set('Cache-Control', 'no-store');
    if (!production(config) || name === 'admin') return res.set('X-Robots-Tag', 'noindex, nofollow, noarchive').status(404).type('text').send('Sitemap not available');
    try {
      if (name === 'business') return req.path === '/sitemap.xml' ? res.type('application/xml').send(xml([config.businessAppUrl || config.BUSINESS_APP_URL])) : res.status(404).type('text').send('Sitemap not available');
      const leaf = /^\/sitemaps\/(static|events|rundowns)-(\d+)\.xml$/.exec(req.path);
      if (!leaf) {
        if (req.path !== '/sitemap.xml') return res.status(404).type('text').send('Sitemap not available');
        const pages = await service.sitemapIndex();
        return res.type('application/xml').send(xml(pages.map(({ kind, page }) => new URL(`/sitemaps/${kind}-${page}.xml`, config.CUSTOMER_APP_URL).toString()), true));
      }
      const page = Number(leaf[2]);
      const entries = leaf[1] === 'static' && page === 1 ? [new URL('/', config.CUSTOMER_APP_URL).toString(), new URL('/privacy', config.CUSTOMER_APP_URL).toString()]
        : await service.sitemap(leaf[1], page);
      if (leaf[1] === 'static' && config.APP_ROUTING_MODE !== 'subdomains') entries.push(config.businessAppUrl || config.BUSINESS_APP_URL);
      return res.type('application/xml').send(xml(entries));
    } catch (error) { return res.set('X-Robots-Tag', 'noindex, nofollow, noarchive').status(error.status === 404 ? 404 : 503).type('text').send('Sitemap not available'); }
  }
  return { page, robots, sitemap };
}
module.exports = { createPublicSeoHandler, renderDocument, indexableRequest };
