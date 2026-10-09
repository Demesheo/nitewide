import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPaymentTestServer } from './helpers/payment-runtime.js';

const freshLink = () => ({ url: 'https://connect.stripe.com/setup/offline-fixture', expiresAt: new Date(Date.now() + 300000).toISOString() });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('Stripe setup remains visible, recoverable and scoped when navigation or requests fail', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/?section=payments', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view, cleanupRoots;
  try {
    vite = await createPaymentTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { PaymentAccounts, stripeOnboardingUrl } = await vite.ssrLoadModule('/src/components/PaymentAccounts.jsx');
    const React = await import('react');
    const { render, within, waitFor, act, fireEvent, cleanup } = await import('@testing-library/react');
    cleanupRoots = cleanup;
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const session = { accessToken: 'offline-fixture', user: { id: 'owner' } };
    const organization = { id: 'org-a', canManageFinance: true };
    function propsFor(reply, navigate) {
      return { session, organization, navigate, request: async (path, identity, options = {}) => {
        assert.equal(identity, session);
        if (path.endsWith('/onboarding')) return reply(options);
        return { items: [{ id: 'account-a', name: 'Downtown', paymentsReady: false }], total: 1, hasMore: false, defaultPaymentAccountId: null };
      } };
    }
    async function mount(props) {
      cleanupRoots?.();
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      view = render(React.createElement(PaymentAccounts, props), { container: dom.window.document.getElementById('root') });
      return screen.findByRole('button', { name: 'Complete Stripe setup' });
    }
    await t.test('a delayed request displays progress, ignores duplicate clicks and retains a native fallback', async () => {
      const pending = deferred(), destinations = []; let attempts = 0;
      const button = await mount(propsFor(() => { attempts++; return pending.promise; }, url => destinations.push(url)));
      await act(async () => { fireEvent.click(button); fireEvent.click(button); });
      assert.equal(attempts, 1);
      assert.equal(screen.getByRole('button', { name: 'Opening Stripe…' }).disabled, true);
      assert.match(screen.getByRole('status').textContent, /Preparing your secure Stripe setup/);
      await act(async () => pending.resolve(freshLink()));
      await waitFor(() => assert.deepEqual(destinations, [freshLink().url]));
      const link = screen.getByRole('link', { name: /Continue to Stripe/ });
      assert.equal(link.href, freshLink().url);
      assert.equal(link.getAttribute('rel'), 'noreferrer');
      assert.match(screen.getByRole('status').textContent, /If it did not open automatically/);
      assert.equal(screen.getByRole('button', { name: 'Complete Stripe setup' }).disabled, false);
      assert.equal(dom.window.sessionStorage.length, 0, 'single-use setup URLs are not persisted');
    });
    await t.test('provider failures and timeouts are actionable and allow a fresh retry', async () => {
      for (const failure of [new Error('Stripe is temporarily unavailable'), Object.assign(new Error('timeout'), { name: 'TimeoutError' })]) {
        let attempt = 0; const destinations = [];
        const button = await mount(propsFor(() => { if (++attempt === 1) throw failure; return freshLink(); }, url => destinations.push(url)));
        await user.click(button);
        await screen.findByRole('alert');
        assert.match(screen.getByRole('alert').textContent, failure.name === 'TimeoutError' ? /too long to respond/ : /temporarily unavailable/);
        assert.equal(button.disabled, false);
        assert.equal(screen.queryByRole('status'), null);
        await user.click(button);
        await waitFor(() => assert.equal(destinations.length, 1));
        assert.equal(screen.queryByRole('alert'), null);
      }
    });
    await t.test('malformed, unsafe or expired provider links never navigate', async () => {
      for (const response of [undefined, { ...freshLink(), url: 'javascript:alert(1)' }, { ...freshLink(), url: 'https://connect.stripe.com.evil.example/setup' }, { ...freshLink(), url: 'https://secret@connect.stripe.com/setup' }, { ...freshLink(), expiresAt: 'invalid' }, { ...freshLink(), expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
        const destinations = [];
        await user.click(await mount(propsFor(() => response, url => destinations.push(url))));
        await screen.findByRole('alert');
        assert.deepEqual(destinations, []);
        assert.equal(screen.queryByRole('link', { name: /Continue to Stripe/ }), null);
        assert.equal(screen.getByRole('button', { name: 'Complete Stripe setup' }).disabled, false);
      }
      for (const url of ['https://connect.stripe.com:8443/setup', 'http://connect.stripe.com/setup', 'https://dashboard.stripe.com/setup']) assert.throws(() => stripeOnboardingUrl(url), /invalid onboarding/);
    });
    await t.test('a navigation error still exposes the valid setup link', async () => {
      await user.click(await mount(propsFor(freshLink, () => { throw new Error('Navigation blocked'); })));
      await screen.findByRole('alert');
      assert.equal(screen.getByRole('link', { name: /Continue to Stripe/ }).href, freshLink().url);
      assert.equal(screen.getByRole('button', { name: 'Complete Stripe setup' }).disabled, false);
    });
    await t.test('switching organizations cancels setup and cannot navigate to the previous merchant', async () => {
      const pending = deferred(), destinations = []; let signal;
      const props = propsFor(options => { signal = options.signal; return pending.promise; }, url => destinations.push(url));
      await user.click(await mount(props));
      view.rerender(React.createElement(PaymentAccounts, { ...props, organization: { id: 'org-b', canManageFinance: true } }));
      assert.equal(signal.aborted, true);
      await act(async () => pending.resolve(freshLink()));
      assert.deepEqual(destinations, []);
      assert.equal(screen.queryByRole('link', { name: /Continue to Stripe/ }), null);
    });
    await t.test('unmounting cancels an in-flight setup without redirecting after it resolves', async () => {
      const pending = deferred(), destinations = []; let signal;
      await user.click(await mount(propsFor(options => { signal = options.signal; return pending.promise; }, url => destinations.push(url))));
      view.unmount(); view = null;
      assert.equal(signal.aborted, true);
      await act(async () => pending.resolve(freshLink()));
      assert.deepEqual(destinations, []);
    });
  } finally {
    try {
      cleanupRoots?.();
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
      dom.window.close();
    }
  }
});
