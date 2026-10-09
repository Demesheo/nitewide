import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './helpers/vite-server.js';

test('commission approval, funding retry, personal setup and booking conversations keep independent authority and durable identities', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLFormElement: dom.window.HTMLFormElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { CommissionStatements } = await vite.ssrLoadModule('/src/components/CommissionStatements.jsx');
    const { PersonalCommissionConnection } = await vite.ssrLoadModule('/src/components/PersonalCommissionConnection.jsx');
    const { MyCommissions, commissionPaymentLabel } = await vite.ssrLoadModule('/src/components/MyCommissions.jsx');
    const { CommissionFeeReview, canReviewCommissionFee } = await vite.ssrLoadModule('/src/components/CommissionFeeReview.jsx');
    const { Messages: CustomerMessages } = await vite.ssrLoadModule(resolve(root, '../customer/src/components/messages.jsx'));
    const { ReferralEarnings } = await vite.ssrLoadModule(resolve(root, '../customer/src/components/referral-earnings.jsx'));
    const { BookingMessages } = await vite.ssrLoadModule(resolve(root, '../shared/BookingMessages.jsx'));
    const { Button } = await vite.ssrLoadModule('/src/components/ui/button.jsx');
    const dialog = await vite.ssrLoadModule('/src/components/ui/dialog.jsx');
    const React = await import('react'), { render, screen, waitFor, within, act } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const session = { accessToken: 'fixture', user: { id: 'referrer', displayName: 'Alex Referrer' } };
    const mount = (Component, props) => { view?.unmount(); dom.window.document.body.innerHTML = '<div id="root"></div>'; view = render(React.createElement(Component, props), { container: dom.window.document.getElementById('root') }); };

    await t.test('each statement is approved separately, only same-recipient selections combine, and a lost payment response survives remount', async () => {
      const row = (id, recipient, title) => ({ id, organizationId: 'org', recipientUserId: recipient, recipientDisplayName: recipient, eventTitle: title,
        currency: 'USD', status: 'pending', availableAt: '2026-01-01T00:00:00Z', originalCommissionCents: 1200, payableCommissionCents: 1200, heldCommissionCents: 0, paidCommissionCents: 0, canApprove: true });
      const rows = [row('one', 'Alex', 'First night'), row('two', 'Alex', 'Second night'), { ...row('three', 'Other', 'Other night'), status: 'approved' }];
      const calls = []; let fail = true;
      const request = async (path, identity, options = {}) => {
        assert.equal(identity, session); const body = options.body ? JSON.parse(options.body) : null; calls.push({ path, body, method: options.method });
        if (path.endsWith('/approve')) { const found = rows.find(r => path.includes(`/${r.id}/`)); found.status = 'approved'; return found; }
        if (path.endsWith('/quote')) return { currency: 'USD', commissionCents: 2400, estimatedFeeCents: 150, totalCents: 2550, statementIds: body.statementIds, feeEstimateBasis: 'estimated_provider_fees' };
        if (path.endsWith('/commission-payments')) { if (fail) throw new Error('Response lost. Retry the same approved payment.'); return { paymentId: 'payment', status: 'paid_fee_review', netSettlementStatus: 'invoicing_fee_unknown', currency: 'USD', commissionCents: 2400, totalCents: 2550, actualFeeCents: null, verifiedNetCents: null }; }
        return { items: rows, total: 3, page: 1, pageSize: 10 };
      };
      const props = { session, organization: { id: 'org', name: 'Business' }, request };
      mount(CommissionStatements, props); await screen.findByRole('heading', { name: 'First night' });
      assert.equal(screen.getByRole('checkbox', { name: /Alex at First night/ }).disabled, true);
      await user.click(screen.getByRole('button', { name: 'Review approval for First night' }));
      assert.equal(calls.filter(call => call.path.endsWith('/approve')).length, 0);
      await user.click(screen.getByRole('button', { name: 'Approve this statement' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      await user.click(screen.getByRole('button', { name: 'Review approval for Second night' }));
      await user.click(screen.getByRole('button', { name: 'Approve this statement' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      await user.click(screen.getByRole('checkbox', { name: /Alex at First night/ }));
      await user.click(screen.getByRole('checkbox', { name: /Other at Other night/ }));
      await screen.findByText(/same business, individual and currency/);
      assert.equal(screen.getByRole('checkbox', { name: /Other at Other night/ }).checked, false);
      await user.click(screen.getByRole('checkbox', { name: /Alex at Second night/ }));
      await user.click(screen.getByRole('button', { name: 'Pay 2 selected statements' }));
      const modal = await screen.findByRole('dialog', { name: 'Confirm commission payment' });
      await within(modal).findByText('$25.50');
      assert.ok(within(modal).getByText('Estimated processing fees', { exact: true }));
      assert.equal(within(modal).getAllByText('$1.50', { exact: true }).length, 1);
      assert.equal(within(modal).queryByText('Business fee allowance', { exact: true }), null);
      assert.equal(within(modal).queryByText('Sandbox payment · Test funds only.'), null);
      assert.equal(within(modal).getByRole('button', { name: 'Create approved Stripe payment' }).disabled, true);
      await user.click(within(modal).getByRole('checkbox'));
      await user.click(within(modal).getByRole('button', { name: 'Create approved Stripe payment' }));
      await within(modal).findByRole('alert');
      const first = calls.find(call => call.path.endsWith('/commission-payments'));
      assert.deepEqual(first.body.statementIds, ['one', 'two']); assert.equal(first.body.approvedTotalCents, 2550);
      mount(CommissionStatements, props); await screen.findByRole('heading', { name: 'First night' });
      await user.click(screen.getByRole('checkbox', { name: /Alex at First night/ })); await user.click(screen.getByRole('checkbox', { name: /Alex at Second night/ }));
      await user.click(screen.getByRole('button', { name: 'Pay 2 selected statements' }));
      await screen.findByText('$25.50'); await user.click(screen.getByRole('dialog').querySelector('input[type="checkbox"]'));
      fail = false; await user.click(screen.getByRole('button', { name: 'Create approved Stripe payment' }));
      await screen.findByText('Fee review · net not verified');
      assert.equal(calls.filter(call => call.path.endsWith('/commission-payments')).at(-1).body.idempotencyKey, first.body.idempotencyKey);
      assert.ok(screen.getByText('Not verified', { exact: true }));
      assert.equal(screen.getByText('Processing fees', { exact: true }).parentElement.querySelector('dd').textContent, 'Awaiting fee evidence');
      assert.equal(screen.queryByText('Net credit verified'), null);
    });

    await t.test('historical paid and released attempts do not block a fresh balance, and equal installments have distinct durable identities', async () => {
      const row = (id, title, overrides = {}) => ({ id, organizationId: 'org', recipientUserId: 'Alex', recipientDisplayName: 'Alex', eventTitle: title, currency: 'USD', status: 'approved', availableAt: '2026-01-01T00:00:00Z', originalCommissionCents: 1000, payableCommissionCents: 500, reservedCommissionCents: 0, heldCommissionCents: 0, paidCommissionCents: 500, ...overrides });
      const rows = [row('installment', 'Another balance', { payment: { paymentId: 'old-paid', status: 'paid', netSettlementStatus: 'net_settled' } }), row('released', 'Released balance', { payment: { paymentId: 'old-released', status: 'failed' } }), row('reserved', 'Reserved balance', { reservedCommissionCents: 500, payment: { paymentId: 'active', status: 'processing' } })];
      const calls = []; let marker = 'old-paid-attempt', fail = true;
      const request = async (path, identity, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        if (path.endsWith('/quote')) return { currency: 'USD', commissionCents: 500, totalCents: 600, estimatedFeeCents: 100, installmentFingerprint: marker, feeEstimateBasis: 'sandbox_estimate' };
        if (path.endsWith('/commission-payments')) { calls.push(body); if (fail) throw new Error('Unknown result. Retry the same payment.'); return { paymentId: 'first-new', currency: 'USD', status: 'paid', netSettlementStatus: 'net_settled', feeEvidence: 'provider_verified', commissionCents: 500, totalCents: 600, actualFeeCents: 100, verifiedNetCents: 500 }; }
        return { items: rows, total: rows.length };
      };
      const props = { session, organization: { id: 'org', name: 'Business' }, request };
      async function fund() {
        mount(CommissionStatements, props); await screen.findByRole('heading', { name: 'Another balance' });
        assert.equal(screen.getByRole('checkbox', { name: /Another balance/ }).disabled, false);
        assert.equal(screen.getByRole('checkbox', { name: /Released balance/ }).disabled, false);
        assert.equal(screen.getByRole('checkbox', { name: /Reserved balance/ }).disabled, true);
        await user.click(screen.getByRole('checkbox', { name: /Another balance/ })); await user.click(screen.getByRole('button', { name: 'Pay 1 selected statement' }));
        const modal = await screen.findByRole('dialog', { name: 'Confirm commission payment' }); await within(modal).findByText('$6.00');
        assert.ok(within(modal).getByText('Sandbox payment · Test funds only.'));
        await user.click(within(modal).getByRole('checkbox')); await user.click(within(modal).getByRole('button', { name: 'Create approved Stripe payment' }));
      }
      await fund(); await screen.findByText('Unknown result. Retry the same payment.');
      fail = false; await fund(); await screen.findByText('Net credit · provider-verified fees');
      assert.equal(screen.getByText('Processing fees', { exact: true }).parentElement.querySelector('dd').textContent, '$1.00');
      assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey); assert.equal(Object.hasOwn(calls[1], 'installmentFingerprint'), false);
      marker = 'first-new-completed-attempt'; await fund(); await screen.findByText('Net credit · provider-verified fees');
      assert.notEqual(calls[2].idempotencyKey, calls[1].idempotencyKey); assert.equal(calls[2].approvedTotalCents, calls[1].approvedTotalCents);
    });

    await t.test('combined processing-fee review saves immutable evidence and retry identity, labels merchant proof, and requires fresh residual approval', async () => {
      const eligible = { paymentId: 'fee-payment', status: 'paid_fee_review', providerVerificationStatus: 'verified', fundsReceived: true, processingFeeCents: 100, feeEvidence: null, feeReview: null, currency: 'USD', netSettlementStatus: 'invoicing_fee_unknown', commissionCents: 1200, totalCents: 1300, actualFeeCents: null, verifiedNetCents: null, hostedInvoiceUrl: 'https://invoice.stripe.com/i/already-paid' };
      assert.equal(canReviewCommissionFee(eligible), true);
      assert.equal(canReviewCommissionFee({ ...eligible, processingFeeCents: 0 }), true);
      for (const change of [{ status: 'paid' }, { providerVerificationStatus: 'review' }, { fundsReceived: false }, { processingFeeCents: null }, { processingFeeCents: -1 }, { processingFeeCents: 0.5 }, { feeEvidence: 'merchant_reviewed' }, { feeEvidence: 'provider_verified' }]) assert.equal(canReviewCommissionFee({ ...eligible, ...change }), false);
      let current = eligible, fail = true; const calls = [];
      const rows = [{ id: 'fee-statement', recipientUserId: 'Alex', recipientDisplayName: 'Alex', eventTitle: 'Fee review night', status: 'approved', currency: 'USD', availableAt: '2026-01-01T00:00:00Z', reservedCommissionCents: 1200, payableCommissionCents: 0, payment: { paymentId: 'fee-payment', status: 'paid_fee_review' } }];
      const request = async (path, identity, options = {}) => {
        if (path.endsWith('/invoicing-fee-review')) { const body = JSON.parse(options.body); calls.push(body); if (fail) throw new Error('Fee review response lost.'); current = { ...eligible, feeEvidence: 'merchant_reviewed', feeReview: { ...body, reviewedAt: '2026-10-02T12:00:00Z' }, actualFeeCents: 667, verifiedNetCents: 633, residualCents: 567, netSettlementStatus: 'net_shortfall' }; return current; }
        if (path.includes('/commission-payments/')) return current;
        return { items: rows, total: 1 };
      };
      const props = { session, organization: { id: 'org', name: 'Business' }, request };
      async function openReview() { mount(CommissionStatements, props); await user.click(await screen.findByRole('button', { name: 'View payment for Fee review night' })); return screen.findByRole('form', { name: 'Merchant processing-fee review' }); }
      const form = await openReview(); assert.equal(screen.queryByRole('link', { name: /Pay from business/ }), null);
      assert.equal(screen.getByText('Processing fees', { exact: true }).parentElement.querySelector('dd').textContent, 'Awaiting fee evidence');
      assert.ok(screen.getByText('Not verified', { exact: true }));
      await user.type(within(form).getByLabelText('Processing fees (USD)'), '6.67'); await user.type(within(form).getByLabelText('Evidence reference'), 'Stripe statement INV-8'); await user.type(within(form).getByLabelText('Reason for fee review'), 'Reviewed the merchant processing-fee report');
      await user.click(within(form).getByRole('checkbox')); await user.click(within(form).getByRole('button', { name: 'Record merchant fee review' }));
      await screen.findByText('Fee review response lost.'); assert.equal(calls[0].invoicingFeeCents, 567);
      const retryForm = await openReview(); assert.equal(within(retryForm).getByLabelText('Processing fees (USD)').value, '6.67'); assert.equal(within(retryForm).getByLabelText('Evidence reference').disabled, true);
      fail = false; await user.click(within(retryForm).getByRole('checkbox')); await user.click(within(retryForm).getByRole('button', { name: 'Retry saved fee review' }));
      await screen.findByText('Merchant-reviewed fees · residual commission owed'); assert.deepEqual(calls[1], calls[0]);
      assert.ok(screen.getByText('Stripe net · merchant reviewed')); assert.ok(screen.getByText(/fresh quote and separate approval/)); assert.ok(screen.getByText('Evidence reference: Stripe statement INV-8'));
      assert.equal(screen.getByText('Processing fees', { exact: true }).parentElement.querySelector('dd').textContent, '$6.67');
      assert.equal(screen.queryByRole('form', { name: 'Merchant processing-fee review' }), null); assert.equal(screen.queryByRole('link', { name: /Pay from business/ }), null);
      assert.equal(commissionPaymentLabel({ ...current, status: 'disputed' }), 'disputed');
    });

    await t.test('total fee input subtracts the verified payment fee exactly once, rejects smaller totals and preserves legacy retries', async () => {
      for (const [id, verifiedFee, total, additionalFee] of [['decimal', 62, '0.66', 4], ['no-additional-fee', 62, '0.62', 0], ['zero-total', 0, '0.00', 0]]) {
        const calls = [], errors = [], payment = { paymentId: id, currency: 'USD', processingFeeCents: verifiedFee };
        const storageKey = `nitewide.action.commission-fee-review.${session.user.id}.${id}`;
        mount(CommissionFeeReview, { session, payment, busy: '', onReview: async body => calls.push(body), onError: error => errors.push(error) });
        const form = screen.getByRole('form', { name: 'Merchant processing-fee review' }), fields = within(form);
        const amount = fields.getByLabelText('Processing fees (USD)');
        assert.equal(amount.value, '', 'No fee total or zero additional fee is inferred without evidence');
        assert.equal(fields.getByRole('button', { name: 'Record merchant fee review' }).disabled, true);
        await user.type(fields.getByLabelText('Evidence reference'), 'Recipient fee report');
        await user.type(fields.getByLabelText('Reason for fee review'), 'Reviewed all fees for this invoice');
        await user.click(fields.getByRole('checkbox'));
        if (id === 'decimal') {
          await user.type(amount, '0.61');
          await user.click(fields.getByRole('button', { name: 'Record merchant fee review' }));
          assert.deepEqual(errors, ['Total processing fees cannot be less than the already-verified payment fee.']);
          assert.equal(calls.length, 0); assert.equal(localStorage.getItem(storageKey), null);
          await user.clear(amount);
        }
        await user.type(amount, total); await user.click(fields.getByRole('button', { name: 'Record merchant fee review' }));
        assert.equal(calls.length, 1); assert.equal(calls[0].invoicingFeeCents, additionalFee);
        assert.equal(Object.hasOwn(calls[0], 'processingFeeCents'), false, 'The verified charge fee is not submitted a second time');
        assert.equal(JSON.parse(JSON.parse(localStorage.getItem(storageKey)).fingerprint).invoicingFeeCents, additionalFee);
      }
      const payload = { invoicingFeeCents: 4, evidenceReference: 'Previously saved invoice-fee report', reason: 'Legacy additional-fee review' };
      const key = '00000000-0000-4000-8000-000000000129', calls = [];
      localStorage.setItem(`nitewide.action.commission-fee-review.${session.user.id}.legacy-review`, JSON.stringify({ fingerprint: JSON.stringify(payload), idempotencyKey: key }));
      mount(CommissionFeeReview, { session, payment: { paymentId: 'legacy-review', currency: 'USD', processingFeeCents: 62 }, busy: '', onReview: async body => calls.push(body), onError: error => assert.fail(error) });
      assert.equal(screen.getByLabelText('Processing fees (USD)').value, '0.66');
      assert.equal(screen.getByLabelText('Processing fees (USD)').disabled, true);
      await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Retry saved fee review' }));
      assert.deepEqual(calls, [{ ...payload, idempotencyKey: key }]);
    });

    await t.test('only independently verified payable invoices expose a Stripe payment link', async () => {
      const row = { id: 'link', eventTitle: 'Invoice link night', status: 'approved', currency: 'USD', availableAt: '2026-01-01T00:00:00Z', payableCommissionCents: 0, payment: { paymentId: 'link-payment', status: 'awaiting_payment' } };
      for (const [status, verification, expected] of [['awaiting_payment', 'verified', true], ['payment_failed', 'verified', true], ['awaiting_payment', 'pending', false], ['review', 'verified', false], ['disputed', 'verified', false], ['reversed', 'verified', false], ['processing', 'verified', false], ['paid', 'verified', false], ['paid_fee_review', 'verified', false]]) {
        const request = async path => path.includes('/commission-payments/') ? { paymentId: 'link-payment', status, providerVerificationStatus: verification, hostedInvoiceUrl: 'https://invoice.stripe.com/i/fixture', currency: 'USD', commissionCents: 1000, totalCents: 1100 } : { items: [row], total: 1 };
        mount(CommissionStatements, { session, organization: { id: 'org', name: 'Business' }, request }); await user.click(await screen.findByRole('button', { name: 'View payment for Invoice link night' }));
        await screen.findByRole('dialog', { name: 'Commission payment' }); assert.equal(Boolean(screen.queryByRole('link', { name: /Pay from business/ })), expected, `${status}/${verification}`);
      }
    });

    await t.test('personal account setup creates one account, rejects expired links, and verifies readiness through the server', async () => {
      const calls = [], destinations = []; let account = { status: 'not_connected', eligibility: { eligible: false } }, expire = true;
      const request = async (path, identity, options = {}) => { calls.push({ path, method: options.method, body: options.body });
        if (path.endsWith('/onboarding')) return { url: 'https://connect.stripe.com/setup/fixture', expiresAt: new Date(Date.now() + (expire ? -1000 : 300000)).toISOString() };
        if (path.endsWith('/synchronize')) { account = { ...account, eligibility: { eligible: true }, cardReady: true }; return account; }
        if (options.method === 'POST') { account = { ...account, id: 'personal', stripeAccountId: 'acct_fixture' }; return account; }
        return account;
      };
      mount(PersonalCommissionConnection, { session, request, navigate: url => destinations.push(url) });
      await screen.findByRole('button', { name: 'Connect personal Stripe account' });
      await user.click(screen.getByRole('button', { name: 'Connect personal Stripe account' }));
      await screen.findByRole('alert'); assert.deepEqual(destinations, []);
      expire = false; await user.click(screen.getByRole('button', { name: 'Connect personal Stripe account' }));
      await waitFor(() => assert.equal(destinations.length, 1));
      assert.equal(calls.filter(call => call.path === '/account/commission-payment-profile' && call.method === 'POST').length, 1);
      await user.click(screen.getByRole('button', { name: 'Check personal readiness' }));
      await screen.findByRole('heading', { name: 'Individual Stripe account verified' });
    });

    await t.test('own earnings use account scope and separate Stripe credit from bank payout', async () => {
      const calls = [];
      const request = async path => { calls.push(path); if (path.startsWith('/account/commissions?')) return { items: [], total: 0 }; if (path.endsWith('payment-profile')) return { status: 'not_connected', eligibility: { eligible: false } };
        return { currencies: [{ currency: 'USD', verifiedEarnedCents: 1000, heldCommissionCents: 100, payableCommissionCents: 400, paidCommissionCents: 500 }], receivedPayouts: { currencies: [{ currency: 'USD', creditedCents: 700, verifiedNetCents: 500, merchantReviewedNetCents: 200, feeReviewPayments: 1 }], bankPayouts: null } }; };
      mount(MyCommissions, { session, request }); await screen.findByText('$5.00');
      assert.ok(calls.every(path => path.startsWith('/account/')));
      assert.ok(screen.getByText(/bank payout is separate/)); assert.equal(screen.queryByText('$7.00'), null);
      assert.ok(screen.getByText('Merchant-reviewed Stripe net credit')); assert.ok(screen.getByText('$2.00'));
      mount(MyCommissions, { session, request: async path => path.startsWith('/account/commissions?') ? { items: [], total: 0 } : path.endsWith('payment-profile') ? { status: 'not_connected', eligibility: { eligible: false } } : { currencies: [{ currency: 'USD', verifiedEarnedCents: 1000, paidCommissionCents: 500 }] } });
      await screen.findByText('$10.00'); assert.equal(screen.queryByText('$5.00'), null);
    });

    await t.test('customer refund request and organizer reply retain the booking and show unread and timestamped request status', async () => {
      let data = { thread: { id: 'thread', orderId: 'order', eventTitle: 'Booking night', organizationName: 'Organizer', customerName: 'Alex', unread: true, lastMessageAt: '2026-01-01T00:00:00Z', lastMessagePreview: 'Hello', refundRequest: null }, messages: { items: [], total: 0, hasMore: false }, canReply: true, canRequestRefund: true, canResolveRefund: false };
      const calls = [];
      const request = async (path, options = {}) => { calls.push({ path, ...options }); if (path.includes('/read')) return { read: true };
        if (path.includes('/orders/') && options.method === 'POST') { data = { ...data, canRequestRefund: false, thread: { ...data.thread, refundRequest: { id: 'refund', kind: options.body.kind, status: 'pending', requestedAt: '2026-01-02T12:00:00Z', reason: options.body.body } }, messages: { items: [{ id: 'm', senderSide: 'customer', senderName: 'Alex', body: options.body.body, kind: options.body.kind, createdAt: '2026-01-02T12:00:00Z' }], total: 1, hasMore: false } }; return data; }
        return path.includes('?page=') && !path.includes('/thread') ? { items: [data.thread], total: 1, unreadCount: 1 } : data;
      };
      const ui = { Button, ...dialog };
      mount(BookingMessages, { session, side: 'customer', request, ui, initialBooking: { orderId: 'order', eventTitle: 'Booking night', canRequestRefund: true } });
      await screen.findByRole('dialog', { name: 'Booking night' });
      await user.selectOptions(screen.getByLabelText('Message type'), 'refund'); await user.type(screen.getByLabelText('Reason for your request'), 'Please review my refund');
      await user.click(screen.getByRole('button', { name: 'Send refund request' }));
      await screen.findByText(/booking remains active/); await screen.findByText('Refund request · pending');
      assert.ok(calls.some(call => call.path === '/customer/orders/order/messages' && call.body.kind === 'refund' && call.body.idempotencyKey));
      assert.equal(calls.some(call => /cancel|refund-request/.test(call.path)), false);
      assert.ok(screen.getByText(/Requested /)); assert.equal(screen.queryByLabelText('Message type'), null);
      data = { ...data, canRequestRefund: false, canResolveRefund: false };
      mount(BookingMessages, { session, side: 'business', request, ui, initialThreadId: 'thread' });
      await screen.findByLabelText('Your message');
      assert.equal(screen.queryByRole('button', { name: 'Approve refund' }), null);
      assert.ok(calls.some(call => call.path === '/business/messages/thread/read'));
    });

    await t.test('customer messages hide on logout, abort an in-flight reply and discard the old session response', async () => {
      const calls = []; let finish;
      const request = async (path, options = {}) => { calls.push({ path, ...options }); if (options.method === 'POST') return new Promise(resolve => { finish = resolve; }); return { items: [], total: 0, unreadCount: 0 }; };
      mount(CustomerMessages, { session, request, initialBooking: { orderId: 'private-order', eventTitle: 'Private booking', organizationName: 'Organizer' } });
      await screen.findByRole('dialog', { name: 'Private booking' }); await user.type(screen.getByLabelText('Your message'), 'Old session message'); await user.click(screen.getByRole('button', { name: 'Send message' }));
      await waitFor(() => assert.equal(typeof finish, 'function'));
      const sent = calls.find(call => call.method === 'POST'), count = calls.length; assert.equal(sent.token, session.accessToken);
      view.rerender(React.createElement(CustomerMessages, { session: null, request }));
      assert.equal(sent.signal.aborted, true); assert.equal(screen.queryByRole('dialog'), null); assert.equal(screen.queryByRole('button', { name: /Messages/ }), null); assert.equal(calls.length, count);
      await act(async () => finish({ thread: { id: 'old-thread', eventTitle: 'Private booking' }, messages: { items: [{ id: 'old', body: 'Old session message', senderSide: 'customer' }] } }));
      const next = { accessToken: 'next-session', user: { id: 'new-customer', displayName: 'New customer' } };
      view.rerender(React.createElement(CustomerMessages, { session: next, request })); await screen.findByRole('button', { name: 'Messages' });
      assert.equal(screen.queryByText('Old session message'), null); assert.equal(screen.queryByText(/Message sent/), null); assert.equal(screen.queryByRole('dialog'), null);
      assert.ok(calls.some(call => call.token === next.accessToken));
    });

    await t.test('customer referral earnings accept a null session and never revive access from a late revoked-session response', async () => {
      const originalFetch = globalThis.fetch, pending = [], calls = [];
      try {
        globalThis.fetch = async (path, options = {}) => { calls.push({ path, ...options }); return new Promise(resolve => pending.push(resolve)); };
        mount(ReferralEarnings, { session: null }); assert.equal(calls.length, 0);
        view.rerender(React.createElement(ReferralEarnings, { session })); await waitFor(() => assert.equal(calls.length, 2));
        view.rerender(React.createElement(ReferralEarnings, { session: null })); assert.ok(calls.every(call => call.signal.aborted));
        await act(async () => { for (const resolve of pending) resolve(new Response(JSON.stringify({ data: { id: 'old-profile', canAccessCommissions: true, currencies: [{ currency: 'USD', paidCommissionCents: 1000 }] } }), { status: 200, headers: { 'content-type': 'application/json' } })); });
        assert.equal(screen.queryByRole('button', { name: 'Referral earnings' }), null);
        globalThis.fetch = async (path, options = {}) => { calls.push({ path, ...options }); return new Response(JSON.stringify({ data: { canAccessCommissions: false, currencies: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
        view.rerender(React.createElement(ReferralEarnings, { session: { accessToken: 'new-session', user: { id: 'new-user' } } }));
        await waitFor(() => assert.equal(calls.length, 4)); assert.equal(screen.queryByRole('button', { name: 'Referral earnings' }), null);
      } finally { globalThis.fetch = originalFetch; }
    });

    await t.test('approved refund recovery uses the saved server decision key and original reason', async () => {
      const saved = { id: 'refund', status: 'approved', kind: 'refund', requestedAt: '2026-01-02T12:00:00Z', reason: 'Please refund', resolution: 'Organizer approved this exception', decisionKey: '00000000-0000-4000-8000-000000000119' };
      let detail = { thread: { id: 'thread', orderId: 'order', eventTitle: 'Recovery night', refundRequest: saved }, messages: { items: [], hasMore: false }, canReply: true, canResolveRefund: true };
      const calls = [];
      const request = async (path, options = {}) => { calls.push({ path, ...options }); if (path.endsWith('/read')) return { read: true }; if (options.method === 'PATCH') { detail = { ...detail, canResolveRefund: false, thread: { ...detail.thread, refundRequest: { ...saved, status: 'resolved' } } }; return { request: detail.thread.refundRequest, refund: { status: 'succeeded' } }; } if (path.startsWith('/business/messages?')) return { items: [], unreadCount: 0 }; return detail; };
      mount(BookingMessages, { session, side: 'business', request, ui: { Button, ...dialog }, initialThreadId: 'thread' });
      await screen.findByRole('button', { name: 'Retry approved refund' });
      assert.equal(screen.queryByLabelText('Reason for your decision'), null);
      await user.click(screen.getByRole('button', { name: 'Retry approved refund' }));
      await screen.findByText('Refund request · resolved');
      assert.deepEqual(calls.find(call => call.method === 'PATCH').body, { decision: 'approve', reason: saved.resolution, idempotencyKey: saved.decisionKey });
    });
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
