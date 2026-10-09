const ipaddr = require('ipaddr.js');

function assertPublicAppUrl(value, name) {
  const invalid = () => { throw new Error(`Hosted Stripe requires an explicit HTTPS public ${name}; localhost, private addresses and URL credentials are not allowed`); };
  if (typeof value !== 'string' || !value.trim()) invalid();
  let url;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password) invalid();
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) {
    if (ipaddr.process(hostname).range() !== 'unicast') invalid();
  } else if (!hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname)) invalid();
}

function subdomainApps(config) {
  const apps = {};
  for (const [name, key, pathname] of [
    ['customer', 'CUSTOMER_APP_URL', '/'], ['business', 'BUSINESS_APP_URL', '/'], ['admin', 'ADMIN_APP_URL', '/'],
  ]) {
    assertPublicAppUrl(config[key], key);
    const url = new URL(config[key]);
    const dnsName = url.hostname.length <= 253 && url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    if (url.pathname !== pathname || url.search || url.hash || url.port || ipaddr.isValid(url.hostname) || !dnsName) {
      throw new Error('Subdomain routing requires three distinct public HTTPS hostnames with each app at /');
    }
    apps[name] = url;
  }
  if (new Set(Object.values(apps).map(url => url.hostname)).size !== 3) {
    throw new Error('Subdomain routing requires three distinct public HTTPS hostnames');
  }
  const origins = config.corsOrigins || (config.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!Object.values(apps).every(url => origins.includes(url.origin))
    || origins.some(origin => { try { return new URL(origin).origin !== origin; } catch { return true; } })) {
    throw new Error('Subdomain routing requires explicit CORS origins including all three apps; wildcards and paths are not allowed');
  }
  return apps;
}

function appForHost(host, apps) {
  // Use the actual Host header, never a caller-supplied X-Forwarded-Host.
  // Render forwards the original custom-domain Host to the web service.
  if (typeof host !== 'string' || !/^[a-z0-9.-]+(?::443)?$/i.test(host)) return null;
  const hostname = host.toLowerCase().replace(/:443$/, '');
  return Object.keys(apps).find(name => apps[name].hostname === hostname) || null;
}

function publicAppLinks(config) {
  if (!config.CUSTOMER_APP_URL) return null;
  if (config.APP_ROUTING_MODE !== 'subdomains') {
    // Bundled path routing stays relative to the current host, including a
    // disabled-payment demo that has no explicit public callback URLs yet.
    return { customerUrl: '/', businessHome: '/business', businessWorkspace: '/business?section=overview', adminUrl: '/admin' };
  }
  const customer = new URL(config.CUSTOMER_APP_URL);
  const business = new URL(config.BUSINESS_APP_URL);
  const workspace = new URL(business);
  workspace.searchParams.set('section', 'overview');
  return {
    customerUrl: customer.toString(),
    businessHome: new URL('/', business).toString(),
    businessWorkspace: workspace.toString(),
    adminUrl: new URL(config.ADMIN_APP_URL).toString(),
  };
}

module.exports = { assertPublicAppUrl, subdomainApps, appForHost, publicAppLinks };
