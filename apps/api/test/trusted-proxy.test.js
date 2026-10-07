const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { trustedProxy, cloudflareRenderProxy, CLOUDFLARE_CIDRS } = require('../src/http/trusted-proxy');
const { clientNetwork } = require('../src/services/abuse-service');

function visitor(peer, forwarded, policy = cloudflareRenderProxy) {
  const app = express();
  app.set('trust proxy', policy);
  const request = Object.create(express.request);
  request.app = app;
  request.connection = request.socket = { remoteAddress: peer };
  request.headers = forwarded ? { 'x-forwarded-for': forwarded } : {};
  return request.ip;
}

test('Cloudflare/Render resolves short and stacked paths without trusting spoofed visitor addresses', () => {
  const cases = [
    ['10.1.2.3', '198.51.100.7', '198.51.100.7'],
    ['10.1.2.3', '192.0.2.9, 198.51.100.7', '198.51.100.7'],
    ['10.1.2.3', '198.51.100.7, 172.70.10.2', '198.51.100.7'],
    ['10.1.2.3', '192.0.2.9, 198.51.100.7, 172.70.10.2, 162.158.1.2', '198.51.100.7'],
    ['10.1.2.3', 'invalid, 198.51.100.7, 172.70.10.2', '198.51.100.7'],
    ['10.1.2.3', '192.0.2.9, 10.9.8.7, 172.70.10.2', '10.9.8.7'],
    ['10.1.2.3', '192.0.2.9, 203.0.113.8, 172.70.10.2', '203.0.113.8'],
    ['203.0.113.8', '192.0.2.9, 172.70.10.2', '203.0.113.8'],
    ['::ffff:10.1.2.3', '192.0.2.9, ::ffff:198.51.100.7, ::ffff:172.70.10.2', '::ffff:198.51.100.7'],
    ['fd00::1', '192.0.2.9, 2001:db8:abcd::7, 2606:4700::1', '2001:db8:abcd::7'],
    ['10.1.2.3', '192.0.2.9, 2a06:98c0:3600::103, 172.70.10.2', '2a06:98c0:3600::103'],
    ['10.1.2.3', undefined, '10.1.2.3'],
  ];
  for (const [peer, forwarded, expected] of cases) assert.equal(visitor(peer, forwarded), expected, `${peer} / ${forwarded}`);
  // Rate limits normalize mapped addresses and IPv6 privacy addresses as before.
  assert.equal(clientNetwork(visitor('::ffff:10.1.2.3', '::ffff:198.51.100.7, ::ffff:172.70.10.2')), '198.51.100.7');
  assert.equal(clientNetwork(visitor('fd00::1', '2001:db8:abcd::7, 2606:4700::1')), '2001:db8:abcd:0::/64');
  assert.notEqual(visitor('10.1.2.3', '198.51.100.7, 172.70.10.2'), visitor('10.1.2.3', '198.51.100.8, 172.70.10.2'));
});

test('provider trust is finite, denies malformed peers, and leaves legacy/default policies unchanged', () => {
  assert.equal(CLOUDFLARE_CIDRS.length, 22);
  for (const cidr of CLOUDFLARE_CIDRS) assert.equal(cloudflareRenderProxy(cidr.split('/')[0], 1), true, cidr);
  for (const ip of ['invalid', '', '198.51.100.7', '10.1.2.3', '127.0.0.1', 'fd00::1', '169.254.1.1', '2a06:98c0:3600::103']) {
    assert.equal(cloudflareRenderProxy(ip, 1), false, ip);
  }
  assert.equal(trustedProxy({}), false);
  assert.equal(trustedProxy({ hostedDemo: true }), 1);
  assert.equal(trustedProxy({ trustProxy: 0, hostedDemo: true }), 0);
  assert.equal(trustedProxy({ trustProxy: 1 }), 1);
  assert.equal(trustedProxy({ TRUST_PROXY_MODE: 'cloudflare-render' }), cloudflareRenderProxy);
  assert.equal(visitor('127.0.0.1', '192.0.2.9', trustedProxy({})), '127.0.0.1');
});
