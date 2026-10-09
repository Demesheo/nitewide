import test from 'node:test';
import assert from 'node:assert/strict';
import { customerHomeLink, privacyPolicyLink } from '../../shared/privacy-links.mjs';

test('legal and return links target Customer in development, demo and both hosted environments without private query data', () => {
  const noRuntime = {};
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const location = new URL(`http://${hostname}:5174/?invite=private#secret`);
    assert.equal(customerHomeLink('', location, noRuntime), `http://${hostname}:5173/`);
    assert.equal(privacyPolicyLink('', location, noRuntime), `http://${hostname}:5173/privacy`);
  }
  const business = new URL('https://business.nitewide.test/?onboarding=secret');
  for (const origin of ['https://nitewide.test', 'https://staging.nitewide.test']) {
    const runtime = { window: { __NITEWIDE_PUBLIC_CONFIG__: { customerUrl: `${origin}/?invite=secret#private` } } };
    assert.equal(customerHomeLink('http://localhost:5173/', business, runtime), `${origin}/`);
    assert.equal(privacyPolicyLink('', business, runtime), `${origin}/privacy`);
  }
  const demo = new URL('https://demo.nitewide.test/business?invite=secret');
  assert.equal(privacyPolicyLink('', demo, { window: { __NITEWIDE_PUBLIC_CONFIG__: { customerUrl: '/' } } }), 'https://demo.nitewide.test/privacy');
  assert.equal(customerHomeLink('https://nitewide.test/?private=secret', business, noRuntime), 'https://nitewide.test/');
  for (const unsafe of ['javascript:alert(1)', 'https://user:password@nitewide.test/', 'https://[invalid']) {
    assert.equal(privacyPolicyLink(unsafe, business, noRuntime), 'https://business.nitewide.test/privacy');
  }
});
