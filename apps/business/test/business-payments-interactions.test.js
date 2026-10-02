import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './helpers/vite-server.js';

const merchant = (organizationId, collectedCents = 12500) => ({
  organizationId, period: 'all_time', mode: 'test',
  currencies: [{ currency: 'USD', collectedCents, refundedCents: 2500, netCollectedCents: collectedCents - 2500, paidOrders: 3, refundedOrders: 1, pendingOrders: 2, reviewOrders: 1 }],
  pendingOrders: 2, reviewOrders: 1, merchantBalance: null, payouts: null,
});
const earnings = {
  period: 'all_time', scope: 'own',
  currencies: [{ currency: 'USD', verifiedEarnedCents: 1800, verifiedRefundedCents: 300, demoEarnedCents: 4200, demoRefundedCents: 200, verifiedPaidOrders: 3, verifiedRefundedOrders: 1, demoPaidOrders: 4, demoRefundedOrders: 1 }],
  receivedPayouts: null, dashboardConnected: null, dashboardUrl: null, reason: 'not_connected',
};
const accountData = organizationId => ({ items: [{ id: `${organizationId}-account`, name: `${organizationId} account`, paymentsReady: false }], total: 1, hasMore: false, defaultPaymentAccountId: null });

test('payments workspace protects finance scope, switches views and organizations, and recovers request failures', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/app?section=payments', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessPayments } = await vite.ssrLoadModule('/src/components/BusinessPayments.jsx');
    const React = await import('react');
    const { render, screen, waitFor, act, within } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const session = { accessToken: 'fixture-token', user: { id: 'user-a' } };
    const organizations = [{ id: 'private', name: 'Private organization', canManageFinance: false }, { id: 'org-a', name: 'Downtown', canManageFinance: true }, { id: 'org-b', name: 'Uptown', canManageFinance: true }];
    const mount = props => {
      view?.unmount();
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      view = render(React.createElement(BusinessPayments, { session, organizations, ...props }), { container: dom.window.document.getElementById('root') });
      return view;
    };
    const location = search => dom.window.history.replaceState({}, '', `/app?section=payments${search}`);

    await t.test('finance dropdown excludes unauthorized organizations and personal view clears merchant controls', async () => {
      location('&paymentOrganization=private');
      const calls = [];
      const request = async (path, identity) => {
        assert.equal(identity, session); calls.push(path);
        if (path === '/business/payments/earnings') return earnings;
        const id = path.split('/')[3];
        return path.includes('/payment-accounts') ? accountData(id) : merchant(id);
      };
      mount({ canViewEarnings: true, request });
      await screen.findByRole('heading', { name: 'org-a account' });
      const business = screen.getByLabelText('Business');
      assert.deepEqual([...business.options].map(option => option.value), ['org-a', 'org-b']);
      assert.equal(calls.some(path => path.includes('/private/')), false);
      const payments = screen.getByRole('heading', { name: 'Business payments' }).closest('section');
      assert.ok(within(payments).getByText('$125.00'));
      assert.ok(within(payments).getByText('$25.00'));
      assert.ok(within(payments).getByText('$100.00'));
      assert.ok(within(payments).getByText(/2 pending bookings · 1 payments needing review/));
      await user.selectOptions(business, 'org-b');
      await screen.findByRole('heading', { name: 'org-b account' });
      assert.equal(screen.queryByRole('heading', { name: 'org-a account' }), null);
      assert.equal(new URLSearchParams(dom.window.location.search).get('paymentOrganization'), 'org-b');
      await user.click(screen.getByRole('button', { name: 'My commissions', exact: true }));
      await screen.findByText('$18.00');
      assert.ok(screen.getByRole('heading', { name: 'Commission rate locked at 0%' }));
      assert.ok(screen.getByText(/Historical earnings remain recorded/));
      assert.ok(screen.getByText('$3.00'));
      assert.ok(screen.getByText('$42.00'));
      assert.equal(screen.queryByRole('heading', { name: 'Payment accounts' }), null);
      assert.equal(screen.queryByLabelText('Business'), null);
      assert.equal(new URLSearchParams(dom.window.location.search).get('paymentView'), 'commissions');
      assert.equal(new URLSearchParams(dom.window.location.search).has('paymentOrganization'), false);
      assert.ok(screen.getByText(/Personal Stripe payout accounts .* have not been connected/));
      assert.equal(screen.getByRole('link', { name: /Open your Stripe dashboard/ }).href, 'https://dashboard.stripe.com/');
      assert.equal(screen.getByRole('button', { name: 'My commissions', exact: true }).getAttribute('aria-pressed'), 'true');
      await user.click(screen.getByRole('button', { name: 'Business payments', exact: true }));
      await screen.findByRole('heading', { name: 'org-a account' });
      assert.equal(screen.queryByText('$18.00'), null);
      // Browser navigation restores the view and selected organization from the URL.
      await act(async () => { location('&paymentOrganization=org-b'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
      await screen.findByRole('heading', { name: 'org-b account' });
    });

    await t.test('commission-only and forbidden viewers never request merchant financial data', async () => {
      location('&paymentOrganization=private');
      const calls = [];
      const request = async path => { calls.push(path); assert.equal(path, '/business/payments/earnings'); return earnings; };
      mount({ organizations: organizations.map(org => ({ ...org, canManageFinance: false })), canViewEarnings: true, request });
      await screen.findByText('$18.00');
      assert.ok(screen.getByRole('heading', { name: 'Commission rate locked at 0%' }));
      assert.deepEqual(calls, ['/business/payments/earnings']);
      assert.equal(screen.queryByRole('heading', { name: 'Payment accounts' }), null);
      assert.equal(screen.queryByRole('button', { name: 'Business payments', exact: true }), null);
      assert.equal(screen.queryByLabelText('Business'), null);
      calls.length = 0;
      mount({ organizations: organizations.map(org => ({ ...org, canManageFinance: false })), canViewEarnings: false, request });
      assert.ok(screen.getByRole('heading', { name: 'Payments access required' }));
      assert.deepEqual(calls, []);
      assert.equal(screen.queryByText('$18.00'), null);
    });

    await t.test('organization switching aborts old overview and accounts and ignores late results', async () => {
      location('&paymentOrganization=org-a');
      const pending = [];
      const request = (path, identity, options) => new Promise(resolve => pending.push({ path, identity, signal: options.signal, resolve }));
      mount({ request });
      await waitFor(() => assert.equal(pending.length, 2));
      await user.selectOptions(screen.getByLabelText('Business'), 'org-b');
      await waitFor(() => assert.equal(pending.length, 4));
      assert.ok(pending.slice(0, 2).every(call => call.signal.aborted));
      await act(async () => {
        pending.slice(2).forEach(call => call.resolve(call.path.includes('/payment-accounts') ? accountData('org-b') : merchant('org-b', 20500)));
      });
      await screen.findByText('$205.00');
      await act(async () => {
        pending.slice(0, 2).forEach(call => call.resolve(call.path.includes('/payment-accounts') ? accountData('stale-private') : merchant('org-a', 999999)));
      });
      assert.equal(screen.queryByText('$9,999.99'), null);
      assert.equal(screen.queryByRole('heading', { name: 'stale-private account' }), null);
      assert.ok(screen.getByRole('heading', { name: 'org-b account' }));
    });

    await t.test('changing signed-in identity clears financial data and revoking finance access removes account controls', async () => {
      location('&paymentOrganization=org-a');
      const pending = [];
      const request = async (path, identity, options) => {
        if (identity.user.id === 'user-a') return path.includes('/payment-accounts') ? accountData('org-a') : merchant('org-a');
        return new Promise(resolve => pending.push({ path, signal: options.signal, resolve }));
      };
      mount({ request });
      await screen.findByText('$125.00');
      await screen.findByRole('heading', { name: 'org-a account' });
      const secondSession = { accessToken: 'other-token', user: { id: 'user-b' } };
      view.rerender(React.createElement(BusinessPayments, { session: secondSession, organizations, request }));
      await waitFor(() => assert.equal(pending.length, 2));
      assert.equal(screen.queryByText('$125.00'), null);
      assert.equal(screen.queryByRole('heading', { name: 'org-a account' }), null);
      view.rerender(React.createElement(BusinessPayments, { session: secondSession, organizations: organizations.map(org => ({ ...org, canManageFinance: false })), request }));
      assert.ok(screen.getByRole('heading', { name: 'Payments access required' }));
      assert.ok(pending.every(call => call.signal.aborted));
      await act(async () => pending.forEach(call => call.resolve(call.path.includes('/payment-accounts') ? accountData('private-late') : merchant('org-a'))));
      assert.equal(screen.queryByText('$125.00'), null);
      assert.equal(screen.queryByRole('heading', { name: 'private-late account' }), null);
      assert.equal(screen.queryByRole('heading', { name: 'Payment accounts' }), null);
    });

    await t.test('merchant overview retry and accounts retry recover independently', async () => {
      location('&paymentOrganization=org-a');
      let overviewAttempts = 0, accountAttempts = 0;
      const request = async path => {
        if (path.includes('/payment-accounts')) { if (++accountAttempts === 1) throw new Error('Accounts offline'); return accountData('org-a'); }
        if (++overviewAttempts === 1) throw new Error('Payments offline');
        return merchant('org-a', 35000);
      };
      mount({ request });
      await screen.findByText('Payments offline');
      await screen.findByText('Accounts offline');
      await user.click(screen.getByRole('button', { name: 'Refresh payments' }));
      await screen.findByText('$350.00');
      assert.equal(screen.queryByText('Payments offline'), null);
      assert.ok(screen.getByText('Accounts offline'));
      await user.click(screen.getByRole('button', { name: 'Retry payment accounts' }));
      await screen.findByRole('heading', { name: 'org-a account' });
      assert.equal(overviewAttempts, 2);
      assert.equal(accountAttempts, 2);
    });

    await t.test('personal reload hides a failed previous result and refreshes only own earnings', async () => {
      location('&paymentView=commissions');
      let attempts = 0;
      const request = async path => {
        assert.equal(path, '/business/payments/earnings');
        if (++attempts === 2) throw new Error('Earnings offline');
        return earnings;
      };
      mount({ canViewEarnings: true, request });
      await screen.findByText('$18.00');
      await user.click(screen.getByRole('button', { name: 'Refresh commissions' }));
      await screen.findByText('Earnings offline');
      assert.equal(screen.queryByText('$18.00'), null);
      await user.click(screen.getByRole('button', { name: 'Refresh commissions' }));
      await screen.findByText('$18.00');
      assert.equal(attempts, 3);
      assert.equal(screen.queryByRole('heading', { name: 'Payment accounts' }), null);
    });
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
