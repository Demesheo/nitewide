import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('secure form handles provider errors and verifies confirmation independently without live Stripe', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { PaymentCheckoutForm } = await vite.ssrLoadModule('/src/components/payment-checkout-form.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    let providerError = true, verified = 0;
    const calls = [], activity = [];
    const checkout = { total: { total: { amount: '$25.00' } }, confirm: async options => { calls.push(options); return providerError ? { type: 'error', error: { message: 'Test card declined' } } : { type: 'success' }; } };
    const props = { checkoutState: { type: 'success', checkout }, PaymentFields: () => React.createElement('div', null, 'Mock secure fields'), ExpressFields: ({ onConfirm }) => React.createElement('button', { type: 'button', onClick: () => onConfirm({ fixture: 'wallet-event' }) }, 'Mock wallet'), onVerify: async () => { verified += 1; }, onBusyChange: busy => activity.push(busy) };
    view = render(React.createElement(PaymentCheckoutForm, props), { container: dom.window.document.getElementById('root') });
    await user.click(screen.getByRole('button', { name: 'Pay $25.00' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Test card declined');
    assert.equal(verified, 0);
    providerError = false;
    await user.click(screen.getByRole('button', { name: 'Mock wallet' }));
    await waitFor(() => assert.equal(verified, 1));
    assert.deepEqual(calls, [{ redirect: 'if_required' }, { redirect: 'if_required', expressCheckoutConfirmEvent: { fixture: 'wallet-event' } }]);
    assert.deepEqual(activity, [true, false, true, false]);
    view.rerender(React.createElement(PaymentCheckoutForm, { ...props, checkoutState: { type: 'error', error: { message: 'Offline' } } }));
    assert.match(screen.getByRole('alert').textContent, /check or cancel/);
    assert.equal(screen.queryByRole('button', { name: 'Pay $25.00' }), null);
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
