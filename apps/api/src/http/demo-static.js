const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
function installDemoStatic(app, root = path.resolve(__dirname, '../../../..')) {
  const dirs = Object.fromEntries(['customer', 'business', 'admin'].map(name => [name, path.join(root, 'apps', name, 'dist')]));
  const page = name => {
    const html = fs.readFileSync(path.join(dirs[name], 'index.html'), 'utf8');
    const document = /<body[\s>]/i.test(html)
      ? html
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nitewide Admin</title></head><body>${html}</body></html>`;
    return (_req, res) => res.type('html').send(document);
  };
  app.use('/business/assets', express.static(path.join(dirs.business, 'assets'), { index: false }));
  app.use('/admin/assets', express.static(path.join(dirs.admin, 'assets'), { index: false }));
  app.get(['/business', '/business/', '/app', '/sign-in'], page('business'));
  app.get(['/admin', '/admin/'], page('admin'));
  app.get('/', page('customer'));
  app.use(express.static(dirs.customer, { index: false, dotfiles: 'deny' }));
}
module.exports = { installDemoStatic };
