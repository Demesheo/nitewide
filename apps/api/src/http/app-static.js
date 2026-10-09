const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { subdomainApps, appForHost, publicAppLinks } = require('../domain/app-routing');

function installAppStatic(app, root = path.resolve(__dirname, '../../../..'), config = {}) {
  const dirs = Object.fromEntries(['customer', 'business', 'admin'].map(name => [name, path.join(root, 'apps', name, 'dist')]));
  const apps = config.APP_ROUTING_MODE === 'subdomains' ? subdomainApps(config) : null;
  const links = publicAppLinks(config);
  // A new release changes the fingerprinted module URLs referenced by HTML.
  // Never retain the entry document or a missing old module at a cache/CDN.
  const noStore = res => res.set('Cache-Control', 'no-store');
  const assetOptions = {
    index: false,
    dotfiles: 'deny',
    setHeaders(res, filename) {
      if (path.extname(filename) === '.html') return res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Cache-Control', /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path.basename(filename))
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate');
    },
  };
  const missingAsset = (_req, res) => noStore(res).status(404).type('text').send('Asset not found');
  const assetHandlers = Object.fromEntries(Object.keys(dirs).map(name => [name, express.static(path.join(dirs[name], 'assets'), assetOptions)]));
  const publicHandlers = Object.fromEntries(Object.keys(dirs).map(name => [name, express.static(dirs[name], assetOptions)]));
  if (apps) app.use((req, res, next) => appForHost(req.get('host'), apps) ? next() : noStore(res).status(404).type('text').send('Route not found'));
  if (links) {
    // Explicit public URLs only: never serialize the runtime environment or
    // credentials. External same-origin JS also works under the strict CSP.
    const serialized = JSON.stringify(links).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    app.get('/app-config.js', (_req, res) => noStore(res).set('X-Content-Type-Options', 'nosniff')
      .type('js').send(`window.__NITEWIDE_PUBLIC_CONFIG__=Object.freeze(${serialized});`));
  }
  const page = name => {
    const html = fs.readFileSync(path.join(dirs[name], 'index.html'), 'utf8');
    let document = /<body[\s>]/i.test(html)
      ? html
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nitewide Admin</title></head><body>${html}</body></html>`;
    if (links) {
      document = document.replace(/<\/head>/i, '<script src="/app-config.js"></script></head>');
      if (name === 'customer' && config.CUSTOMER_APP_URL.startsWith('https://')) {
        document = document.replaceAll('https://nitewide-demo.onrender.com/images/nitewide-social-nightlife-v1.png',
          new URL('/images/nitewide-social-nightlife-v1.png', config.CUSTOMER_APP_URL).toString());
      }
    }
    return (_req, res) => noStore(res).type('html').send(document);
  };
  const pages = Object.fromEntries(Object.keys(dirs).map(name => [name, page(name)]));
  if (apps) {
    const selectedApp = req => appForHost(req.get('host'), apps);
    const onHost = (name, handler) => (req, res, next) => selectedApp(req) === name ? handler(req, res, next) : missingAsset(req, res);
    const redirect = (req, res, target) => {
      const url = new URL(target);
      url.search = new URL(req.originalUrl, 'http://localhost').search;
      return noStore(res).redirect(302, url.toString());
    };
    app.use('/business/assets', onHost('business', assetHandlers.business), missingAsset);
    app.use('/admin/assets', onHost('admin', assetHandlers.admin), missingAsset);
    app.use('/assets', (req, res, next) => assetHandlers[selectedApp(req)](req, res, next), missingAsset);
    app.get(['/privacy', '/privacy/'], (req, res) => selectedApp(req) === 'customer'
      ? pages.customer(req, res)
      : noStore(res).redirect(302, new URL('/privacy', apps.customer).toString()));
    app.get(['/', '/index.html'], (req, res) => {
      const name = selectedApp(req);
      if (name === 'customer' && new URL(req.originalUrl, 'http://localhost').searchParams.get('invite')) return redirect(req, res, links.businessWorkspace);
      return pages[name](req, res);
    });
    app.get(['/business', '/business/', '/business/index.html'], (req, res) => redirect(req, res, links.businessHome));
    app.get(['/sign-in', '/sign-in/'], (req, res) => selectedApp(req) === 'business'
      ? pages.business(req, res)
      : redirect(req, res, new URL('/sign-in', apps.business)));
    app.get(['/admin', '/admin/', '/admin/index.html'], (req, res) => redirect(req, res, links.adminUrl));
    app.use('/business', onHost('business', publicHandlers.business));
    app.use('/admin', onHost('admin', publicHandlers.admin));
    app.use((req, res, next) => publicHandlers[selectedApp(req)](req, res, next));
    // No SPA fallback for nonexistent modules, unknown routes or another app.
    app.use((_req, res, next) => { noStore(res); next(); });
    return;
  }
  app.use('/business/assets', assetHandlers.business, missingAsset);
  app.use('/admin/assets', assetHandlers.admin, missingAsset);
  app.use('/assets', assetHandlers.customer, missingAsset);
  app.get(['/privacy', '/privacy/'], pages.customer);
  app.get(['/business', '/business/', '/business/index.html', '/sign-in', '/sign-in/'], pages.business);
  app.get(['/admin', '/admin/', '/admin/index.html'], pages.admin);
  app.get('/', (req, res, next) => {
    // Older team/promoter links pointed to the customer root. Keep their
    // tokens and query intact, but never take a redirect target from input.
    const url = new URL(req.originalUrl, 'http://localhost');
    if (!url.searchParams.get('invite')) return next();
    noStore(res).redirect(302, `/business${url.search}`);
  }, pages.customer);
  app.get('/index.html', pages.customer);
  app.use('/business', publicHandlers.business);
  app.use('/admin', publicHandlers.admin);
  app.use(publicHandlers.customer);
}
module.exports = { installAppStatic };
