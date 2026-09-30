const supertest = require('supertest');

// Test only in-process apps or explicitly loopback-bound fixture servers.
// Never accept a URL: these regressions must not target a live deployment.
function request(target, path, { method = 'GET', token, headers = {}, body } = {}) {
  if (!target || (typeof target !== 'function' && typeof target.listen !== 'function'))
    throw new TypeError('Pass an Express app or local fixture server, never a URL');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//'))
    throw new TypeError('Use an application-relative request path');
  const address = typeof target.address === 'function' ? target.address() : null;
  if (address && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address.address))
    throw new TypeError('Fixture servers must bind to loopback');
  const verb = method.toLowerCase();
  if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(verb))
    throw new TypeError('Unsupported test request method');
  const result = supertest(target)[verb](path).redirects(0).timeout({ response: 5000, deadline: 10000 }).set('Accept', 'application/json').set(headers);
  if (token) result.auth(token, { type: 'bearer' });
  if (body !== undefined) result.send(body);
  return result; // Retain native .expect(), .attach(), .field(), and response body/text/headers.
}

module.exports = { request };
