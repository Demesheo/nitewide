const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
function installDemoStatic(app, root = path.resolve(__dirname, '../../../..')) {
  const dirs = Object.fromEntries(['customer', 'business', 'admin'].map(name => [name, path.join(root, 'apps', name, 'dist')]));
  const page = name => {
    const html = fs.readFileSync(path.join(dirs[name], 'index.html'), 'utf8');
    const notice = '<div role="status" style="padding:6px 12px;text-align:center;font:12px system-ui;background:#21192d;color:#e4d9f1">Private demo · Sample data · No real charges or admission</div>';
    return (_req, res) => res.type('html').send(html.replace(/<body([^>]*)>/, `<body$1>${notice}`));
  };
  app.use('/business/assets', express.static(path.join(dirs.business, 'assets'), { index: false }));
  app.use('/admin/assets', express.static(path.join(dirs.admin, 'assets'), { index: false }));
  app.get(['/business', '/business/', '/app', '/sign-in'], page('business'));
  app.get(['/admin', '/admin/'], page('admin'));
  app.get('/', page('customer'));
  app.use(express.static(dirs.customer, { index: false, dotfiles: 'deny' }));
}
module.exports = { installDemoStatic };
