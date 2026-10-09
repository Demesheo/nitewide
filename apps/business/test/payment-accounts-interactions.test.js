import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPaymentTestServer } from './helpers/payment-runtime.js';
import './payment-setup-recovery.cases.js';
import './payment-disconnect.cases.js';

test('finance account controls use hosted onboarding and server readiness; event payment lock is enforced', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/?section=team', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view, cleanupRoots;
  try {
    vite = await createPaymentTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { PaymentAccounts, EventPaymentAccount, stripeOnboardingUrl } = await vite.ssrLoadModule('/src/components/PaymentAccounts.jsx');
    const React = await import('react');
    const { render, within, waitFor, cleanup } = await import('@testing-library/react');
    cleanupRoots = cleanup;
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const calls = [], destinations = [];
    const session = { accessToken: 'fixture-token', user: { id: 'owner' } }, organization = { id: 'org', canManageFinance: true };
    const accounts = [{ id: 'account', name: 'Downtown', mode: 'test', paymentsReady: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false }];
    let defaultPaymentAccountId = null, failCreate = true;
    const request = async (path, identity, options = {}) => {
      assert.equal(identity, session); calls.push({ path, options });
      if (!options.method) return { items: [...accounts], total: accounts.length, hasMore: false, defaultPaymentAccountId };
      if (path.endsWith('/onboarding')) return { url: 'https://connect.stripe.com/setup/fixture', expiresAt: new Date(Date.now() + 300000).toISOString() };
      if (path.endsWith('/synchronize')) { accounts[0] = { ...accounts[0], paymentsReady: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }; return accounts[0]; }
      if (path.endsWith('/default')) { defaultPaymentAccountId = JSON.parse(options.body).paymentAccountId; return {}; }
      if (options.method === 'PUT') return {};
      if (failCreate) { failCreate = false; throw new Error('Offline'); }
      accounts.push({ id: 'second', name: JSON.parse(options.body).name, paymentsReady: false }); return accounts[1];
    };
    const props = { session, organization, request, navigate: url => destinations.push(url) };
    view = render(React.createElement(PaymentAccounts, { ...props, organization: { ...organization, canManageFinance: false } }), { container: dom.window.document.getElementById('root') });
    assert.equal(calls.length, 0); assert.equal(screen.queryByText('Payment accounts'), null);
    view.rerender(React.createElement(PaymentAccounts, props));
    await screen.findByText('Downtown');
    const verificationHint = /If you’ve already completed Stripe onboarding, check your email for further verification instructions from Stripe\. Then select Check readiness\./;
    assert.ok(screen.getByText(verificationHint));
    await user.click(screen.getByRole('button', { name: 'Complete Stripe setup' }));
    assert.deepEqual(destinations, ['https://connect.stripe.com/setup/fixture']);
    assert.equal(screen.queryByText('Ready for sandbox payments'), null);
    assert.ok(screen.getByText(verificationHint));
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await screen.findByText('Ready for sandbox payments');
    assert.equal(screen.queryByText(verificationHint), null);
    accounts[0] = { ...accounts[0], mode: 'live' };
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await screen.findByText('Ready for payments');
    assert.equal(screen.queryByText('Ready for sandbox payments'), null);
    await user.selectOptions(screen.getByLabelText('Default payment account'), 'account');
    await waitFor(() => assert.equal(defaultPaymentAccountId, 'account'));
    await user.type(screen.getByLabelText('New account name'), 'Uptown');
    await user.click(screen.getByRole('button', { name: 'Add payment account' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Add payment account' }));
    await screen.findByText('Uptown');
    const creates = calls.filter(call => call.options.method === 'POST' && call.path.endsWith('/payment-accounts'));
    assert.equal(JSON.parse(creates[0].options.body).idempotencyKey, JSON.parse(creates[1].options.body).idempotencyKey);
    assert.throws(() => stripeOnboardingUrl('https://example.com/phishing'), /invalid onboarding/);
    const event = { id: 'event', organizationId: 'org', canManageFinance: true, canChangePaymentAccount: false, paymentAccountId: 'account' };
    view.rerender(React.createElement(EventPaymentAccount, { event, session, request }));
    await screen.findByRole('status');
    assert.equal(screen.getByLabelText('Event payment account').disabled, true);
    assert.equal(screen.getByRole('button', { name: 'Save payment account' }).disabled, true);
    view.rerender(React.createElement(EventPaymentAccount, { event: { ...event, canChangePaymentAccount: true }, session, request }));
    await waitFor(() => assert.equal(screen.getByLabelText('Event payment account').disabled, false));
    await user.selectOptions(screen.getByLabelText('Event payment account'), 'second');
    await user.click(screen.getByRole('button', { name: 'Save payment account' }));
    assert.deepEqual(JSON.parse(calls.find(call => call.path === '/business/events/event/payment-account').options.body), { paymentAccountId: 'second' });
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
