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
    let providerError = true, verified = 0, checked = 0, unpaid = true, checkError = null, checkGate = null, verifyError = null;
    const calls = [], activity = [], fieldsOptions = [], expressOptions = [];
    let availabilityChanged, walletLoadError, fieldsReady, fieldsLoadError;
    const checkout = { total: { total: { amount: '$25.00' } }, confirm: async options => { calls.push(options); return providerError ? { type: 'error', error: { message: 'Test card declined' } } : { type: 'success' }; } };
    const props = { amount:'$25.00', checkoutState: { type: 'success', checkout }, PaymentFields: ({options, onReady, onLoadError}) => { fieldsOptions.push(options); fieldsReady = onReady; fieldsLoadError = onLoadError; return React.createElement('div', null, 'Mock secure fields'); }, ExpressFields: ({ onConfirm, options, onAvailablePaymentMethodsChange, onLoadError }) => { expressOptions.push(options); availabilityChanged = onAvailablePaymentMethodsChange; walletLoadError = onLoadError; return React.createElement('button', { type: 'button', onClick: () => onConfirm({ fixture: 'wallet-event' }) }, 'Mock wallet'); }, onCheck: async () => { checked += 1; if (checkGate) await checkGate; if (checkError) throw checkError; return unpaid; }, onVerify: async () => { verified += 1; if (verifyError) throw verifyError; }, onBusyChange: busy => activity.push(busy) };
    view = render(React.createElement(PaymentCheckoutForm, { ...props, checkoutState: { type: 'loading' } }), { container: dom.window.document.getElementById('root') });
    // Loading the Checkout SDK and rendering its secure iframe are separate
    // phases. Neither may expose Pay or accept implicit Enter submissions.
    const submit = () => dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit', {bubbles:true,cancelable:true}));
    assert.ok(screen.getByText('Loading secure payment form…'));
    assert.equal(screen.queryByRole('button', {name:/^Pay /}), null);
    assert.equal(screen.queryByText('Mock secure fields'), null);
    await React.act(submit);
    view.rerender(React.createElement(PaymentCheckoutForm, props));
    assert.equal(screen.queryByText(/Sandbox payment/), null, 'unknown payment mode must not claim the purchase uses test funds');
    view.rerender(React.createElement(PaymentCheckoutForm, { ...props, mode: 'test' }));
    assert.ok(screen.getByText('Sandbox payment · use test payment details only.'));
    view.rerender(React.createElement(PaymentCheckoutForm, { ...props, mode: 'live' }));
    assert.equal(screen.queryByText(/Sandbox payment/), null, 'real payments must never show a sandbox disclaimer');
    assert.ok(screen.getByText('Mock secure fields'));
    assert.ok(screen.getByText('Loading secure payment form…'));
    assert.equal(screen.queryByRole('button', {name:/^Pay /}), null);
    await React.act(submit);
    assert.equal(checked, 0);
    assert.equal(calls.length, 0);
    assert.deepEqual(activity, []);
    await React.act(() => fieldsReady());
    assert.ok(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.equal(screen.queryByText('Loading secure payment form…'), null);
    assert.deepEqual(fieldsOptions[0], {layout:'tabs',wallets:{applePay:'never',googlePay:'never',link:'never'}});
    assert.deepEqual(expressOptions[0].paymentMethods, {applePay:'always',googlePay:'always',link:'auto',paypal:'never',amazonPay:'never',klarna:'never'});
    assert.deepEqual(expressOptions[0].paymentMethodOrder, ['apple_pay', 'google_pay', 'link']);
    assert.deepEqual(expressOptions[0].layout, {maxColumns:2,maxRows:0,overflow:'never'});
    assert.ok(screen.getByText('Checking express payment options…'));
    // Stripe sends nested availability objects, not boolean values. No
    // wallets (including blocked methods only) must leave card checkout usable.
    for (const paymentMethods of [undefined, { applePay: {available:false}, googlePay: {available:false}, link: {available:false} }, {paypal:{available:true}}]) {
      await React.act(() => availabilityChanged({paymentMethods}));
      assert.equal(screen.queryByRole('button', {name:'Mock wallet'}), null);
      assert.ok(screen.getByRole('button', {name:'Pay $25.00'}));
      assert.equal(screen.queryByText('Or pay with card'), null);
    }
    for (const method of ['applePay', 'googlePay', 'link']) {
      await React.act(() => availabilityChanged({paymentMethods:{[method]:{available:true}}}));
      assert.ok(screen.getByRole('button', {name:'Mock wallet'}));
      assert.ok(screen.getByText('Or pay with card'));
      assert.equal(screen.queryByText('Checking express payment options…'), null);
    }
    await React.act(() => walletLoadError());
    assert.equal(screen.queryByRole('button', {name:'Mock wallet'}), null);
    await React.act(() => availabilityChanged({paymentMethods:{applePay:{available:true},googlePay:{available:true},link:{available:true}}}));
    await user.click(screen.getByRole('button', { name: 'Pay $25.00' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Test card declined');
    assert.equal(verified, 0);
    providerError = false;
    await user.click(screen.getByRole('button', { name: 'Mock wallet' }));
    await waitFor(() => assert.equal(verified, 1));
    assert.deepEqual(calls, [{ redirect: 'if_required' }, { redirect: 'if_required', expressCheckoutConfirmEvent: { fixture: 'wallet-event' } }]);
    assert.equal(checked, 2);
    assert.deepEqual(activity, [true, false, true, false]);
    // Lost confirmation responses cannot result in a second provider call
    // when the server already sees payment, or when status cannot be checked.
    unpaid = false;
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.equal(calls.length, 2);
    checkError = new Error('Connection lost; your booking is saved');
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.match(screen.getByRole('alert').textContent, /Connection lost/);
    assert.equal(calls.length, 2);
    checkError = null;
    view.rerender(React.createElement(PaymentCheckoutForm, { ...props, checkoutState: { type: 'error', error: { message: 'Offline' } } }));
    assert.ok(screen.getAllByRole('alert').some(alert => /Pay will check/.test(alert.textContent)));
    assert.equal(screen.queryByText('Mock secure fields'), null);
    await user.click(screen.getByRole('button', { name: 'Pay $25.00' }));
    assert.equal(checked, 5);
    assert.equal(calls.length, 2);
    unpaid = true;
    await user.click(screen.getByRole('button', { name: 'Pay $25.00' }));
    assert.ok(screen.getAllByRole('alert').some(alert => /Refresh the page/.test(alert.textContent)));
    assert.equal(calls.length, 2);
    // The actual form lock blocks repetitive submissions while verification
    // is in flight, even when bypassing the disabled button via form submit.
    view.rerender(React.createElement(PaymentCheckoutForm, props));
    assert.equal(screen.queryByRole('button', {name:/^Pay /}), null);
    await React.act(() => fieldsReady());
    const beforeCheck = checked;
    let release;
    checkGate = new Promise(resolve => { release = resolve; });
    const form = dom.window.document.querySelector('form');
    await React.act(() => {
      form.dispatchEvent(new dom.window.Event('submit', {bubbles:true,cancelable:true}));
      form.dispatchEvent(new dom.window.Event('submit', {bubbles:true,cancelable:true}));
    });
    assert.equal(checked, beforeCheck + 1);
    assert.equal(screen.getByRole('button', {name:'Checking your booking…'}).disabled, true);
    unpaid = false;
    await React.act(async () => { release(); await checkGate; });
    checkGate = null;
    assert.equal(calls.length, 2);
    // A lost post-confirmation verification response leaves Pay retryable;
    // its next preflight discovers payment without confirming again.
    unpaid = true;
    verifyError = new Error('Verification response lost');
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.match(screen.getByRole('alert').textContent, /Verification response lost/);
    assert.equal(calls.length, 3);
    unpaid = false;
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.equal(calls.length, 3);
    // A provider reload must not reuse the old iframe's readiness. A failed
    // iframe can still recover a paid booking, but cannot confirm unpaid cards.
    view.rerender(React.createElement(PaymentCheckoutForm, { ...props, checkoutState: { type: 'loading' } }));
    assert.equal(screen.queryByRole('button', {name:/^Pay /}), null);
    view.rerender(React.createElement(PaymentCheckoutForm, props));
    assert.equal(screen.queryByRole('button', {name:/^Pay /}), null);
    await React.act(() => fieldsLoadError());
    assert.equal(screen.queryByText('Loading secure payment form…'), null);
    assert.ok(screen.getAllByRole('alert').some(alert => /form couldn’t load/.test(alert.textContent)));
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.equal(calls.length, 3);
    unpaid = true;
    await user.click(screen.getByRole('button', {name:'Pay $25.00'}));
    assert.equal(calls.length, 3);
    assert.match(screen.getByRole('alert').textContent, /Refresh the page/);
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
