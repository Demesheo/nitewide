const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
function installDemoStatic(app, root = path.resolve(__dirname, '../../../..')) {
  const dirs = Object.fromEntries(['customer', 'business', 'admin'].map(name => [name, path.join(root, 'apps', name, 'dist')]));
  // A new release changes the fingerprinted module URLs referenced by HTML.
  // Never retain the entry document or a missing old module at a cache/CDN.
  const noStore = res => res.set('Cache-Control', 'no-store');
  const assetOptions = {
    index: false,
    dotfiles: 'deny',
    setHeaders(res, filename) {
      res.setHeader('Cache-Control', /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path.basename(filename))
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate');
    },
  };
  const missingAsset = (_req, res) => noStore(res).status(404).type('text').send('Asset not found');
  const page = name => {
    const html = fs.readFileSync(path.join(dirs[name], 'index.html'), 'utf8');
    const document = /<body[\s>]/i.test(html)
      ? html
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nitewide Admin</title></head><body>${html}</body></html>`;
    return (_req, res) => noStore(res).type('html').send(document);
  };
  app.use('/business/assets', express.static(path.join(dirs.business, 'assets'), assetOptions), missingAsset);
  app.use('/admin/assets', express.static(path.join(dirs.admin, 'assets'), assetOptions), missingAsset);
  app.use('/assets', express.static(path.join(dirs.customer, 'assets'), assetOptions), missingAsset);
  app.get(['/business', '/business/', '/app', '/sign-in'], page('business'));
  app.get(['/admin', '/admin/'], page('admin'));
  app.get('/', page('customer'));
  app.use(express.static(dirs.customer, {
    index: false,
    dotfiles: 'deny',
    setHeaders(res, filename) { if (path.extname(filename) === '.html') noStore(res); },
  }));
}
module.exports = { installDemoStatic };
