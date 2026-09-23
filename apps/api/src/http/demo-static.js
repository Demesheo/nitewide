const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
function installDemoStatic(app, root = path.resolve(__dirname, '../../../..')) {
  const dirs = Object.fromEntries(['customer', 'business', 'admin'].map(name => [name, path.join(root, 'apps', name, 'dist')]));
  const page = name => {
    const html = fs.readFileSync(path.join(dirs[name], 'index.html'), 'utf8');
    const notice = '<div role="status" style="position:fixed;z-index:2147483647;bottom:8px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);box-sizing:border-box;pointer-events:none;padding:4px 10px;border-radius:6px;text-align:center;font:11px/1.4 system-ui;background:#21192deb;color:#e4d9f1">Public demo · Shared sample data · No real charges or admission · Use test contact details</div>';
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
