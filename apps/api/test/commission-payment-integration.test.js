const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createCommissionLedgerService } = require('../src/services/commission-ledger-service');
const { createCommissionPaymentService } = require('../src/services/commission-payment-service');
const { createIndividualCommissionProfileService } = require('../src/services/individual-commission-profile-service');
const { createStripeWebhookService } = require('../src/services/stripe-webhook-service');
const schemas = require('../src/http/commission-payment-schemas');
const raw = value => JSON.parse(JSON.stringify(value));

function fakeStripe(account) {
  const livemode = account.livemode;
  const caches = new Map(), parameters = new Map(), customers = new Map(), invoices = new Map(), intents = new Map(), charges = new Map(), balances = new Map(), calls = [];
  let loseCustomerResponse = false, loseInvoiceResponse = false, loseVoidResponse = false;
  function checked(options) { assert.equal(options.stripeAccount, account.id, 'Every customer, invoice and payment lookup belongs to the person’s account'); }
  async function idempotent(name, params, options, create) {
    checked(options); calls.push({ name, params: raw(params), key: options.idempotencyKey });
    if (!caches.has(options.idempotencyKey)) { caches.set(options.idempotencyKey, create()); parameters.set(options.idempotencyKey, raw(params)); }
    else assert.deepEqual(raw(params), parameters.get(options.idempotencyKey), 'Provider retries must retain the original idempotency parameters');
    const result = caches.get(options.idempotencyKey);
    if (name === 'customer' && loseCustomerResponse) { loseCustomerResponse = false; throw new Error('Customer succeeded but response was lost'); }
    if (name === 'invoice' && loseInvoiceResponse) { loseInvoiceResponse = false; throw new Error('Provider succeeded but response was lost'); }
    return raw(result);
  }
  const stripe = { enabled: true, mode: livemode ? 'live' : 'test', ...(livemode ? {} : { sandboxSharedAccountId: 'acct_business_never_used' }), disconnectEnabled: true,
    retrieveIndividualAccount: async id => { assert.equal(id, account.id); return raw(account); },
    createAccountLink: async input => ({ object: 'v2.core.account_link', account: input.account, livemode, url: 'https://connect.stripe.com/mock-only', expires_at: '2026-10-03T12:00:00Z' }),
    disconnectAccount: async id => { assert.equal(id, account.id); return { disconnected: true }; },
    createCommissionCustomer: (params, options) => idempotent('customer', params, options, () => { const customer = { id: `cus_${randomUUID().replaceAll('-', '')}`, object: 'customer', livemode, ...params }; customers.set(customer.id, customer); return customer; }),
    retrieveCommissionCustomer: async (id, options) => { checked(options); return raw(customers.get(id)); },
    createCommissionInvoice: (params, options) => idempotent('invoice', params, options, () => {
      if (params.collection_method === 'send_invoice' && !require('zod').z.email().safeParse(customers.get(params.customer)?.email).success) {
        throw Object.assign(new Error('The customer needs a valid email when collection_method=send_invoice.'), { type: 'StripeInvalidRequestError', statusCode: 400 });
      }
      const invoice = { id: `in_${randomUUID().replaceAll('-', '')}`, object: 'invoice', livemode, status: 'draft', ...params, customer_email: customers.get(params.customer)?.email,
      subtotal: 0, total: 0, amount_due: 0, amount_paid: 0, amount_remaining: 0, lines: [], payments: [] }; invoices.set(invoice.id, invoice); return invoice; }),
    createCommissionInvoiceItem: (params, options) => idempotent('item', params, options, () => { const invoice = invoices.get(params.invoice), item = { id: `ii_${randomUUID().replaceAll('-', '')}`, object: 'invoiceitem', livemode, ...params }; invoice.lines.push(item); return item; }),
    finalizeCommissionInvoice: (id, params, options) => idempotent('finalize', params, options, () => { const invoice = invoices.get(id); invoice.total = invoice.subtotal = invoice.amount_due = invoice.amount_remaining = invoice.lines.reduce((sum, line) => sum + line.amount, 0); invoice.status = 'open'; invoice.customer_email = customers.get(invoice.customer)?.email; invoice.hosted_invoice_url = `https://invoice.stripe.com/i/${id}`; return invoice; }),
    voidCommissionInvoice: async (id, options) => {
      checked(options); const invoice = invoices.get(id); assert.notEqual(invoice.status, 'paid');
      invoice.status = 'void'; invoice.hosted_invoice_url = null;
      for (const entry of invoice.payments) { entry.status = 'canceled'; const intent = intents.get(entry.payment.payment_intent); if (intent) intent.status = 'canceled'; }
      calls.push({ name: 'void', id, key: options.idempotencyKey });
      if (loseVoidResponse) { loseVoidResponse = false; throw new Error('Void succeeded; provider response lost'); } return raw(invoice);
    },
    retrieveCommissionInvoice: async (id, options) => { checked(options); return raw(invoices.get(id)); },
    listCommissionInvoiceLines: async (id, options) => { checked(options); return { has_more: false, data: raw(invoices.get(id).lines) }; },
    listCommissionInvoicePayments: async (id, options) => { checked(options); return { has_more: false, data: raw(invoices.get(id).payments) }; },
    retrieveCommissionPaymentIntent: async (id, options) => { checked(options); return raw(intents.get(id)); },
    retrieveCharge: async (id, options) => { checked(options); return raw(charges.get(id)); },
    retrieveCommissionBalanceTransaction: async (id, options) => { checked(options); return raw(balances.get(id)); },
    constructWebhookEvent: (body, signature) => { if (signature !== 'valid') throw new Error('Forged signature'); return JSON.parse(body); },
  };
  function succeed(payment, fee = 50) {
    const invoice = invoices.get(payment.providerInvoiceId), intentId = `pi_${randomUUID().replaceAll('-', '')}`, chargeId = `ch_${randomUUID().replaceAll('-', '')}`, balanceId = `txn_${randomUUID().replaceAll('-', '')}`;
    invoice.status = 'paid'; invoice.amount_paid = invoice.total; invoice.amount_remaining = 0;
    invoice.payments = [{ id: `inpay_${randomUUID().replaceAll('-', '')}`, livemode, invoice: invoice.id, currency: invoice.currency, amount_requested: invoice.total, amount_paid: invoice.total, status: 'paid', is_default: true, payment: { type: 'payment_intent', payment_intent: intentId } }];
    intents.set(intentId, { id: intentId, object: 'payment_intent', livemode, status: 'succeeded', amount: invoice.total, amount_received: invoice.total, currency: invoice.currency, customer: invoice.customer, latest_charge: chargeId });
    charges.set(chargeId, { id: chargeId, object: 'charge', livemode, amount: invoice.total, amount_captured: invoice.total, paid: true, captured: true, disputed: false, refunded: false, amount_refunded: 0, currency: invoice.currency, customer: invoice.customer, payment_intent: intentId, balance_transaction: balanceId, payment_method_details: { type: payment.paymentMethod } });
    balances.set(balanceId, { id: balanceId, object: 'balance_transaction', type: 'charge', source: chargeId, amount: invoice.total, fee, net: invoice.total - fee, currency: invoice.currency, fee_details: [{ type: 'stripe_fee', amount: fee, currency: invoice.currency }] });
    return { invoice, intent: intents.get(intentId), charge: charges.get(chargeId), balance: balances.get(balanceId) };
  }
  return { stripe, customers, invoices, intents, calls, caches, succeed, loseNextCustomer: () => { loseCustomerResponse = true; }, loseNextInvoice: () => { loseInvoiceResponse = true; }, loseNextVoid: () => { loseVoidResponse = true; } };
}

test('commission execution is scoped, individually approved, idempotent, provider-verified and safely recoverable', { timeout: 60000 }, async t => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig(), db = require('../src/db/sequelize').createSequelize(config), m = require('../src/db/models').initModels(db);
  const now = () => new Date();
  try {
    const owner = await m.User.create({ displayName: 'Commission owner', email: `${randomUUID()}@offline.nitewide.test`, emailVerifiedAt: now() });
    const recipient = await m.User.create({ displayName: 'Commission recipient', email: `${randomUUID()}@offline.nitewide.test` });
    const other = await m.User.create({ displayName: 'Other person', email: `${randomUUID()}@offline.nitewide.test` });
    const business = await m.Organization.create({ name: 'Commission business', slug: randomUUID(), onboardingEstablished: true });
    await m.OrganizationOwner.create({ userId: owner.id, organizationId: business.id, role: 'owner' });
    const account = { id: `acct_${randomUUID().replaceAll('-', '')}`, object: 'v2.core.account', livemode: false, identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, ach_debit_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } };
    const profile = await m.IndividualCommissionProfile.create({ userId: recipient.id, name: recipient.displayName, creationRequestId: randomUUID(), stripeAccountId: account.id, verifiedAt: now(), verifiedStripeAccount: account });
    const provider = fakeStripe(account), ledger = createCommissionLedgerService({ sequelize: db, models: m }), individuals = createIndividualCommissionProfileService({ sequelize: db, models: m, stripe: provider.stripe });
    const service = createCommissionPaymentService({ sequelize: db, models: m, stripe: provider.stripe, ledger, individualProfiles: individuals });
    async function statement(amountCents = 1000, { held = false, endedHoursAgo = 49, userId = recipient.id } = {}) {
      const event = await m.Event.create({ organizationId: business.id, creatorUserId: owner.id, title: 'Commission event', slug: randomUUID(), startsAt: new Date(Date.now() - (endedHoursAgo + 2) * 3600000), endsAt: new Date(Date.now() - endedHoursAgo * 3600000) });
      const saved = await m.CommissionStatement.create({ organizationId: business.id, eventId: event.id, eventTitle: event.title, recipientUserId: userId, currency: 'USD', availableAt: new Date(+event.endsAt + 48 * 3600000) });
      const order = await m.Order.create({ buyerUserId: owner.id, eventId: event.id, status: 'paid', providerMode: 'test', providerVerificationStatus: 'verified', subtotalCents: amountCents * 10, totalCents: amountCents * 10, affiliateCommissionCents: amountCents, idempotencyKey: randomUUID() });
      const earning = await m.CommissionEarning.create({ orderId: order.id, eventId: event.id, organizationId: business.id, statementId: saved.id, recipientUserId: userId, currency: 'USD', originalCommissionCents: amountCents, unpaidCommissionCents: amountCents, refundHold: held, snapshot: { version: 1 } });
      return { statement: saved, earning, event, order };
    }
    const main = await statement();
    await t.test('owner and finance permissions and maturity hold provider work closed', async () => {
      await assert.rejects(service.approveStatement(other.id, business.id, main.statement.id), { code: 'FORBIDDEN' });
      const future = await statement(1000, { endedHoursAgo: 1 });
      await assert.rejects(service.approveStatement(owner.id, business.id, future.statement.id), { code: 'COMMISSION_SETTLEMENT_PENDING' });
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [main.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_STATEMENT_NOT_APPROVED' });
      assert.equal(provider.invoices.size, 0); assert.equal(await m.CommissionPayment.count(), 0);
    });
    await service.approveStatement(owner.id, business.id, main.statement.id);
    const quote = await service.quote(owner.id, business.id, { statementIds: [main.statement.id], paymentMethod: 'card' });
    assert.equal(schemas.commissionQuoteResponse.safeParse(raw(quote)).success, true);
    const input = { statementIds: [main.statement.id], paymentMethod: 'card', approvedTotalCents: quote.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() };
    let paymentId;
    await t.test('approval refuses missing, malformed and unverified payer email before provider writes or reservations', async () => {
      const email = owner.email, emailVerifiedAt = owner.emailVerifiedAt;
      try {
        for (const changes of [{ email: '' }, { email: 'not-an-email' }, { emailVerifiedAt: null }, { emailVerifiedAt: new Date(Date.now() + 86400000) }]) {
          await owner.update({ email, emailVerifiedAt, ...changes }, { validate: false });
          await assert.rejects(service.approve(owner.id, business.id, input), { code: 'COMMISSION_BILLING_EMAIL_REQUIRED' });
          assert.equal(provider.calls.length, 0); assert.equal(await m.CommissionPayment.count(), 0);
          assert.equal(await m.CommissionAllocation.count(), 0); assert.equal((await main.earning.reload()).reservedCommissionCents, 0);
        }
        await owner.update({ email, emailVerifiedAt });
        const changedDuringReadiness = createCommissionPaymentService({ sequelize: db, models: m, stripe: provider.stripe, ledger,
          individualProfiles: { ...individuals, synchronizeTrusted: async accountId => {
            await individuals.synchronizeTrusted(accountId);
            await owner.update({ emailVerifiedAt: null });
          } } });
        await assert.rejects(changedDuringReadiness.approve(owner.id, business.id, input), { code: 'COMMISSION_BILLING_EMAIL_REQUIRED' });
        assert.equal(provider.calls.length, 0); assert.equal(await m.CommissionPayment.count(), 0);
        assert.equal(await m.CommissionAllocation.count(), 0); assert.equal((await main.earning.reload()).reservedCommissionCents, 0);
      } finally { await owner.update({ email, emailVerifiedAt }); }
    });
    await t.test('lost customer/invoice responses and changed payer email retain one immutable approval and provider request', async () => {
      const approvedEmail = owner.email, verifiedAt = owner.emailVerifiedAt.toISOString(), customerName = business.name;
      provider.loseNextCustomer(); const customerInterrupted = await service.approve(owner.id, business.id, input); paymentId = customerInterrupted.paymentId;
      assert.equal(customerInterrupted.retryable, true); assert.equal(provider.customers.size, 1); assert.equal(provider.invoices.size, 0);
      assert.deepEqual(raw((await m.CommissionPayment.findByPk(paymentId)).billingEmailSnapshot), { version: 1, userId: owner.id, email: approvedEmail, verifiedAt, customerName });
      await owner.update({ email: `${randomUUID()}@offline.nitewide.test`, emailVerifiedAt: null });
      await business.update({ name: 'Renamed after commission approval' });
      provider.loseNextInvoice(); const interrupted = await service.approve(owner.id, business.id, input);
      assert.equal(interrupted.paymentId, paymentId);
      assert.equal(interrupted.retryable, true); assert.equal(provider.invoices.size, 1);
      const [one, two] = await Promise.all([service.approve(owner.id, business.id, input), service.approve(owner.id, business.id, input)]);
      assert.equal(one.paymentId, paymentId); assert.equal(two.paymentId, paymentId); assert.equal(await m.CommissionPayment.count(), 1); assert.equal(provider.customers.size, 1); assert.equal(provider.invoices.size, 1);
      assert.equal(await m.CommissionAllocation.count({ where: { paymentId } }), 1); assert.equal((await main.earning.reload()).reservedCommissionCents, 1000);
      const invoice = [...provider.invoices.values()][0]; assert.equal(invoice.lines.length, 2); assert.equal(invoice.auto_advance, false); assert.equal(invoice.transfer_data, undefined); assert.equal(invoice.application_fee_amount, undefined);
      assert.equal(schemas.commissionPaymentResponse.safeParse(raw(one)).success, true);
      await assert.rejects(service.approve(owner.id, business.id, { ...input, approvedTotalCents: quote.totalCents + 1 }), { code: 'COMMISSION_IDEMPOTENCY_CONFLICT' });
      const page = await service.list(owner.id, business.id); const row = page.items.find(s => s.id === main.statement.id); assert.equal(row.payment.paymentId, paymentId); assert.equal(schemas.commissionStatementPageResponse.safeParse(raw(page)).success, true);
      const customerCalls = provider.calls.filter(call => call.name === 'customer'); assert.equal(customerCalls.length, 2);
      assert.deepEqual(customerCalls[0], customerCalls[1]); assert.equal(customerCalls[0].params.email, approvedEmail);
      assert.equal(customerCalls[0].params.name, customerName); assert.notEqual(customerName, business.name);
      assert.notEqual(customerCalls[0].params.email, recipient.email); assert.notEqual(customerCalls[0].params.email, owner.email);
      const audited = await m.AuditLog.findAll({ where: { entityId: paymentId } });
      const exposed = JSON.stringify({ one, page, own: await service.ownStatements(recipient.id), audited: raw(audited), metadata: provider.calls.map(call => call.params?.metadata) });
      assert.equal(exposed.includes(approvedEmail), false); assert.equal(exposed.includes('billingEmailSnapshot'), false);
      await owner.update({ emailVerifiedAt: now() });
    });
    const saved = await m.CommissionPayment.findByPk(paymentId);
    await t.test('authorized finance manager snapshots their verified email rather than the owner or recipient', async () => {
      const manager = await m.User.create({ displayName: 'Finance manager', email: `${randomUUID()}@offline.nitewide.test`, emailVerifiedAt: now() });
      await m.OrganizationOwner.create({ userId: manager.id, organizationId: business.id, role: 'admin', financeAuthorized: true });
      const row = await statement(); await service.approveStatement(manager.id, business.id, row.statement.id);
      const quoted = await service.quote(manager.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      const approved = await service.approve(manager.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: quoted.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() });
      const payment = await m.CommissionPayment.findByPk(approved.paymentId);
      assert.equal(payment.status, 'awaiting_payment'); assert.equal(payment.approvedByUserId, manager.id);
      assert.deepEqual(raw(payment.billingEmailSnapshot), { version: 1, userId: manager.id, email: manager.email, verifiedAt: manager.emailVerifiedAt.toISOString(), customerName: business.name });
      assert.equal(provider.customers.get(payment.providerCustomerId).email, manager.email);
      assert.equal(provider.invoices.get(payment.providerInvoiceId).customer_email, manager.email);
      assert.notEqual(manager.email, owner.email); assert.notEqual(manager.email, recipient.email);
      assert.equal(JSON.stringify(approved).includes(manager.email), false);
    });
    await t.test('fake paid webhook payload and out-of-band invoice never settle an earning', async () => {
      const webhooks = createStripeWebhookService({ sequelize: db, models: m, stripe: provider.stripe, commissionPayments: service, individualCommissionProfiles: individuals });
      await assert.rejects(webhooks.receive(JSON.stringify({}), 'forged'), { code: 'INVALID_WEBHOOK' });
      const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, livemode: false, account: account.id, type: 'invoice.paid', data: { object: { id: saved.providerInvoiceId, status: 'paid', amount_paid: quote.totalCents } } };
      await webhooks.receive(JSON.stringify(event), 'valid'); assert.equal((await saved.reload()).status, 'awaiting_payment'); assert.equal((await main.earning.reload()).paidCommissionCents, 0);
      const invoice = provider.invoices.get(saved.providerInvoiceId); invoice.status = 'paid'; invoice.amount_paid = invoice.total; invoice.amount_remaining = 0;
      assert.equal((await service.reconcile(saved)).status, 'review'); assert.equal((await main.earning.reload()).paidCommissionCents, 0); assert.equal(main.earning.reservedCommissionCents, 1000);
    });
    await t.test('actual provider charge records funds received, requires invoice fee review, then settles proven net', async () => {
      provider.succeed(saved); const received = await service.reconcile(saved); assert.equal(received.status, 'paid_fee_review'); assert.equal(received.verifiedNetCents, null); assert.equal(received.recipientBankPayoutVerified, false);
      assert.equal((await main.earning.reload()).reservedCommissionCents, 1000); assert.equal(main.earning.paidCommissionCents, 0);
      const attributed = createCommissionPaymentService({ sequelize: db, models: m, stripe: provider.stripe, ledger, individualProfiles: individuals,
        invoicingFeeEvidence: async ({ invoice, stripeAccountId }) => ({ verified: true, invoiceId: invoice.id, stripeAccountId, currency: 'USD', amountCents: 0 }) });
      const settled = await attributed.reconcile(saved); assert.equal(settled.status, 'paid'); assert.ok(settled.verifiedNetCents >= 1000); assert.equal((await main.earning.reload()).paidCommissionCents, 1000); assert.equal(main.earning.reservedCommissionCents, 0);
      await attributed.reconcile(saved); assert.equal((await main.earning.reload()).paidCommissionCents, 1000);
    });
    await t.test('individual statement selection combines small balances and holds only affected purchases', async () => {
      const smallA = await statement(20), smallB = await statement(40), held = await statement(1000, { held: true });
      for (const row of [smallA, smallB, held]) await service.approveStatement(owner.id, business.id, row.statement.id);
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [smallA.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_BELOW_MINIMUM' });
      const combined = await service.quote(owner.id, business.id, { statementIds: [smallA.statement.id, smallB.statement.id], paymentMethod: 'card' }); assert.equal(combined.commissionCents, 60); assert.equal(combined.statements.length, 2);
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [held.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_STATEMENT_NOT_PAYABLE' });
      assert.equal((await held.earning.reload()).reservedCommissionCents, 0);
      const foreign = await statement(100, { userId: other.id }); await service.approveStatement(owner.id, business.id, foreign.statement.id);
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [smallB.statement.id, foreign.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_STATEMENT_SCOPE' });
    });
    await t.test('verified ticket refund invalidates a distributed unpaid invoice and re-quotes only after confirmed void', async () => {
      const row = await statement(); await service.approveStatement(owner.id, business.id, row.statement.id);
      const firstQuote = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      const first = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: firstQuote.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() });
      assert.ok(first.hostedInvoiceUrl);
      const original = await m.CommissionPayment.findByPk(first.paymentId);
      await ledger.adjustRefund({ order: row.order, refundId: randomUUID(), cumulativeRefundedTotalCents: 5000 });
      assert.ok((await original.reload()).invalidatedAt); assert.equal(original.reconciliationToken, null); assert.equal((await row.earning.reload()).reservedCommissionCents, 1000);
      assert.equal((await service.get(owner.id, business.id, original.id)).hostedInvoiceUrl, null);
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_STATEMENT_NOT_PAYABLE' });
      provider.loseNextVoid(); const closed = await service.reconcile(original);
      assert.equal(closed.status, 'failed'); assert.equal(closed.errorCode, 'COMMISSION_REQUOTE_REQUIRED'); assert.equal(provider.invoices.get(original.providerInvoiceId).status, 'void');
      assert.equal(provider.invoices.get(original.providerInvoiceId).amount_due, firstQuote.totalCents);
      assert.equal(provider.invoices.get(original.providerInvoiceId).amount_remaining, firstQuote.totalCents);
      assert.equal(provider.invoices.get(original.providerInvoiceId).amount_paid, 0);
      await row.earning.reload(); assert.equal(row.earning.unpaidCommissionCents, 500); assert.equal(row.earning.reservedCommissionCents, 0); assert.equal(row.earning.businessLossCents, 0);
      const nextQuote = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' }); assert.equal(nextQuote.commissionCents, 500); assert.notEqual(nextQuote.installmentFingerprint, firstQuote.installmentFingerprint);
      const listed = (await service.list(owner.id, business.id)).items.find(item => item.id === row.statement.id); assert.equal(listed.latestPaymentAttempt.paymentId, original.id); assert.equal(listed.latestPaymentAttempt.status, 'failed');
      const next = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: nextQuote.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() }); assert.notEqual(next.paymentId, original.id); assert.equal(next.commissionCents, 500);
    });
    await t.test('merchant-reviewed fees credit only net and expose the residual for a fresh separate approval', async () => {
      const row = await statement(); await service.approveStatement(owner.id, business.id, row.statement.id);
      const priced = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      const created = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: priced.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() });
      const record = await m.CommissionPayment.findByPk(created.paymentId); provider.succeed(record, 100);
      const review = { invoicingFeeCents: 100, evidenceReference: 'Stripe separately billed invoice fee report row sandbox-example', reason: 'Finance reviewed the recipient supplied itemized invoicing fee', idempotencyKey: randomUUID() };
      await assert.rejects(service.reviewInvoicingFee(other.id, business.id, record.id, review), { code: 'FORBIDDEN' });
      const reviewed = await service.reviewInvoicingFee(owner.id, business.id, record.id, review);
      const actualNet = priced.totalCents - 200, remainder = 1000 - actualNet;
      assert.equal(reviewed.status, 'paid_fee_review'); assert.equal(reviewed.feeEvidence, 'merchant_reviewed'); assert.equal(reviewed.verifiedNetCents, actualNet); assert.equal(reviewed.residualCents, remainder); assert.equal(schemas.commissionPaymentResponse.safeParse(raw(reviewed)).success, true);
      await row.earning.reload(); assert.equal(row.earning.paidCommissionCents, actualNet); assert.equal(row.earning.unpaidCommissionCents, remainder); assert.equal(row.earning.reservedCommissionCents, 0);
      const allocation = await m.CommissionAllocation.findOne({ where: { paymentId: record.id } }); assert.equal(allocation.amountCents, 1000); assert.equal(allocation.paidAmountCents, actualNet);
      const audits = () => m.AuditLog.count({ where: { entityId: record.id, action: 'commission_payment.invoicing_fee_merchant_reviewed' } });
      const app = require('../src/app').createApp({ sequelize: db, models: m, config, services: { stripe: provider.stripe, commissionPayments: service, individualCommissionProfiles: individuals, email: { enabled: false } } });
      const repeated = await request(app).post(`/api/business/organizations/${business.id}/commission-payments/${record.id}/invoicing-fee-review`).set('x-user-id', owner.id).send(review).expect(200); assert.equal(repeated.body.data.feeEvidence, 'merchant_reviewed'); assert.equal(schemas.commissionPaymentResponse.safeParse(repeated.body.data).success, true); assert.equal(await audits(), 1);
      await assert.rejects(service.reviewInvoicingFee(owner.id, business.id, record.id, { ...review, invoicingFeeCents: 99 }), { code: 'COMMISSION_FEE_REVIEW_CONFLICT' });
      await record.reload(); await assert.rejects(record.update({ feeReview: { ...record.feeReview, reason: 'changed' } }), /Commission fee reviews are immutable/); await record.reload();
      const reviewAudit = await m.AuditLog.findOne({ where: { entityId: record.id, action: 'commission_payment.invoicing_fee_merchant_reviewed' } }); await assert.rejects(reviewAudit.update({ after: { forged: true } }), /Commission fee review audits are immutable/);
      const invoiceCount = provider.invoices.size, residualQuote = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      assert.equal(residualQuote.commissionCents, remainder); assert.equal(provider.invoices.size, invoiceCount, 'Review never automatically charges or creates a top-up'); assert.notEqual(residualQuote.installmentFingerprint, priced.installmentFingerprint);
      const residual = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: residualQuote.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() }); assert.notEqual(residual.paymentId, record.id); assert.equal(residual.commissionCents, remainder); assert.equal(provider.invoices.size, invoiceCount + 1);
    });
    await t.test('funds already independently received after a refund preserve paid facts without an invented residual', async () => {
      const row = await statement(); await service.approveStatement(owner.id, business.id, row.statement.id);
      const priced = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      const created = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: priced.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() });
      const record = await m.CommissionPayment.findByPk(created.paymentId);
      await ledger.adjustRefund({ order: row.order, refundId: randomUUID(), cumulativeRefundedTotalCents: 5000 });
      provider.succeed(record, priced.totalCents - 950);
      const received = await service.reconcile(record); assert.equal(received.status, 'paid_fee_review'); assert.equal(received.fundsReceived, true);
      const reviewed = await service.reviewInvoicingFee(owner.id, business.id, record.id, { invoicingFeeCents: 0, evidenceReference: 'Separately billed invoicing fee reviewed zero', reason: 'Finance reconciled complete invoice fee evidence', idempotencyKey: randomUUID() });
      assert.equal(reviewed.status, 'paid'); assert.equal(reviewed.feeEvidence, 'merchant_reviewed'); assert.equal(reviewed.verifiedNetCents, 950); assert.equal(reviewed.residualCents, 0);
      await row.earning.reload(); assert.equal(row.earning.paidCommissionCents, 950); assert.equal(row.earning.unpaidCommissionCents, 0); assert.equal(row.earning.businessLossCents, 450); assert.equal(row.earning.reservedCommissionCents, 0);
      await assert.rejects(service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' }), { code: 'COMMISSION_STATEMENT_NOT_PAYABLE' });
    });
    await t.test('a provider reversal commits before a delayed success without releasing or crediting its reservation', async () => {
      const row = await statement(); await service.approveStatement(owner.id, business.id, row.statement.id);
      const priced = await service.quote(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card' });
      const created = await service.approve(owner.id, business.id, { statementIds: [row.statement.id], paymentMethod: 'card', approvedTotalCents: priced.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() });
      const record = await m.CommissionPayment.findByPk(created.paymentId), objects = provider.succeed(record);
      let enter, release; const entered = new Promise(resolve => { enter = resolve; }), pause = new Promise(resolve => { release = resolve; });
      const delayed = createCommissionPaymentService({ sequelize: db, models: m, stripe: provider.stripe, ledger, individualProfiles: individuals,
        invoicingFeeEvidence: async ({ invoice, stripeAccountId }) => { enter(); await pause; return { verified: true, invoiceId: invoice.id, stripeAccountId, currency: 'USD', amountCents: 0 }; } });
      const stale = delayed.reconcile(record); await entered;
      objects.charge.refunded = true; objects.charge.amount_refunded = record.totalCents;
      assert.equal((await service.reconcile(record)).status, 'reversed'); release(); assert.equal((await stale).status, 'reversed');
      assert.equal((await record.reload()).status, 'reversed'); await row.earning.reload(); assert.equal(row.earning.paidCommissionCents, 0); assert.equal(row.earning.reservedCommissionCents, 1000);
    });
    await t.test('profile history and routes remain own-scoped after memberships end', async () => {
      const app = require('../src/app').createApp({ sequelize: db, models: m, config, services: { stripe: provider.stripe, commissionPayments: service, individualCommissionProfiles: individuals, email: { enabled: false } } });
      const response = await request(app).get('/api/account/commission-payment-profile').set('x-user-id', recipient.id).expect(200); assert.equal(response.body.data.canAccessCommissions, true); assert.equal(response.body.data.stripeAccountId, account.id); assert.equal(schemas.commissionProfileResponse.safeParse(response.body.data).success, true);
      await request(app).get('/api/account/commissions').set('x-user-id', recipient.id).expect(200);
      const denied = await request(app).get(`/api/business/organizations/${business.id}/commission-statements`).set('x-user-id', other.id); assert.equal(denied.status, 403);
      await individuals.disable(recipient.id); assert.equal((await profile.reload()).status, 'inactive'); assert.equal((await individuals.get(recipient.id)).cardReady, false);
      await individuals.resume(recipient.id); assert.equal((await individuals.get(recipient.id)).cardReady, true);
      const dashboard = await individuals.dashboard(recipient.id); assert.ok(dashboard.url.includes(account.id)); assert.equal(dashboard.url.includes('acct_business_never_used'), false);
    });
    await t.test('new personal creation recovers its original account response and never accepts Stripe terms or bank details', async () => {
      const accounts = new Map(); let lost = true, createCalls = 0;
      const connection = { ...provider.stripe, createAccount: async (params, options) => {
        createCalls += 1; assert.equal(params.dashboard, 'full'); assert.equal(params.identity.entity_type, 'individual');
        assert.equal(params.configuration.merchant.capabilities.ach_debit_payments.requested, true);
        assert.equal(params.configuration.recipient, undefined); assert.equal(params.tos_acceptance, undefined); assert.equal(params.identity.attestations, undefined);
        assert.equal(params.external_account, undefined); assert.equal(params.bank_account, undefined);
        if (!accounts.has(options.idempotencyKey)) accounts.set(options.idempotencyKey, { ...raw(account), id: `acct_${randomUUID().replaceAll('-', '')}`, metadata: params.metadata });
        if (lost) { lost = false; throw new Error('Lost account response'); } return accounts.get(options.idempotencyKey);
      } };
      const onboarding = createIndividualCommissionProfileService({ sequelize: db, models: m, stripe: connection });
      const body = { displayName: owner.displayName, idempotencyKey: randomUUID() };
      await assert.rejects(onboarding.create(owner.id, body), /Lost account response/);
      const pending = await onboarding.get(owner.id); assert.equal(pending.creationRequestId, body.idempotencyKey); assert.equal(pending.stripeAccountId, null);
      const recovered = await onboarding.create(owner.id, body); assert.ok(recovered.stripeAccountId); assert.equal(accounts.size, 1); assert.equal(createCalls, 2);
      await assert.rejects(onboarding.create(owner.id, { ...body, idempotencyKey: randomUUID() }), { code: 'COMMISSION_PROFILE_EXISTS' });
      const unconnected = await m.User.create({ displayName: 'Customer only', email: `${randomUUID()}@offline.nitewide.test` });
      assert.equal((await onboarding.get(unconnected.id)).canAccessCommissions, false);
      await assert.rejects(onboarding.create(unconnected.id, { displayName: unconnected.displayName, idempotencyKey: randomUUID() }), { code: 'FORBIDDEN' });
    });
    await t.test('approval terms and saved provider account binding cannot be rewritten in the database', async () => {
      await assert.rejects(saved.update({ totalCents: saved.totalCents + 1 }), /Commission approval terms are immutable|commission_payments_amounts/);
      await saved.reload(); await assert.rejects(saved.update({ stripeAccountId: 'acct_wrong' }), /Commission approval terms are immutable/);
      await saved.reload(); assert.equal(saved.stripeAccountId, account.id);
      const originalSnapshot = raw(saved.billingEmailSnapshot);
      for (const billingEmailSnapshot of [null, { ...originalSnapshot, email: owner.email }, { ...originalSnapshot, userId: recipient.id }]) {
        await assert.rejects(saved.update({ billingEmailSnapshot }), /Commission billing email snapshot is immutable/);
        await saved.reload(); assert.deepEqual(raw(saved.billingEmailSnapshot), originalSnapshot);
      }
      const legacy = await m.CommissionPayment.create({ organizationId: business.id, recipientUserId: recipient.id, individualCommissionProfileId: profile.id,
        stripeAccountId: account.id, providerMode: 'test', currency: saved.currency, commissionCents: saved.commissionCents,
        feeAllowanceCents: saved.feeAllowanceCents, totalCents: saved.totalCents, feePolicy: saved.feePolicy, statementSnapshot: saved.statementSnapshot,
        paymentMethod: saved.paymentMethod, idempotencyKey: randomUUID(), approvalHash: saved.approvalHash,
        approvedByUserId: owner.id, approvedAt: now(), billingEmailSnapshot: null, providerCustomerId: 'cus_legacy_without_email' });
      await assert.rejects(legacy.update({ billingEmailSnapshot: originalSnapshot }), /Commission billing email snapshot is immutable/);
      await legacy.reload(); assert.equal(legacy.billingEmailSnapshot, null, 'migration leaves historical approval terms unknown instead of backfilling mutable profile data');
      const callsBefore = provider.calls.length;
      const reviewed = await service.reconcile(legacy);
      assert.equal(reviewed.status, 'review'); assert.equal(reviewed.errorCode, 'COMMISSION_CREATION_REVIEW'); assert.equal(reviewed.hostedInvoiceUrl, null);
      assert.equal(provider.calls.length, callsBefore); assert.equal((await legacy.reload()).providerCustomerId, 'cus_legacy_without_email');
    });
  } finally { await db.close(); }
});

test('live commission approval rejects mixed-mode earnings and recovers one invoice before verified net settlement', { timeout: 30000 }, async () => {
  assertManagedTestDatabase();
  const db = require('../src/db/sequelize').createSequelize(require('../src/config').getConfig()), m = require('../src/db/models').initModels(db);
  try {
    const owner = await m.User.create({ displayName: 'Live commission owner', email: `${randomUUID()}@offline.nitewide.test`, emailVerifiedAt: new Date() });
    const recipient = await m.User.create({ displayName: 'Live commission recipient', email: `${randomUUID()}@offline.nitewide.test` });
    const business = await m.Organization.create({ name: 'Live commission business', slug: randomUUID(), onboardingEstablished: true });
    await m.OrganizationOwner.create({ userId: owner.id, organizationId: business.id, role: 'owner' });
    const account = { id: `acct_${randomUUID().replaceAll('-', '')}`, object: 'v2.core.account', livemode: true, identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, ach_debit_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } };
    await m.IndividualCommissionProfile.create({ userId: recipient.id, name: recipient.displayName, providerMode: 'live', creationRequestId: randomUUID(), stripeAccountId: account.id, verifiedAt: new Date(), verifiedStripeAccount: account });
    const provider = fakeStripe(account), ledger = createCommissionLedgerService({ sequelize: db, models: m });
    const individuals = createIndividualCommissionProfileService({ sequelize: db, models: m, stripe: provider.stripe });
    const service = createCommissionPaymentService({ sequelize: db, models: m, stripe: provider.stripe, ledger, individualProfiles: individuals });
    async function createStatement(modes) {
      const event = await m.Event.create({ organizationId: business.id, creatorUserId: owner.id, title: 'Live commission event', slug: randomUUID(), startsAt: new Date(Date.now() - 72 * 3600000), endsAt: new Date(Date.now() - 70 * 3600000) });
      const statement = await m.CommissionStatement.create({ organizationId: business.id, eventId: event.id, eventTitle: event.title, recipientUserId: recipient.id, currency: 'USD', availableAt: new Date(Date.now() - 22 * 3600000) });
      for (const mode of modes) {
        const order = await m.Order.create({ buyerUserId: owner.id, eventId: event.id, status: 'paid', providerMode: mode, providerVerificationStatus: 'verified', subtotalCents: 10_000, totalCents: 10_000, affiliateCommissionCents: 1000, idempotencyKey: randomUUID() });
        await m.CommissionEarning.create({ orderId: order.id, eventId: event.id, organizationId: business.id, statementId: statement.id, recipientUserId: recipient.id, currency: 'USD', originalCommissionCents: 1000, unpaidCommissionCents: 1000, snapshot: { version: 1 } });
      }
      await service.approveStatement(owner.id, business.id, statement.id);
      return statement;
    }
    const mixed = await createStatement(['test', 'live']);
    await assert.rejects(service.quote(owner.id, business.id, { statementIds: [mixed.id], paymentMethod: 'card' }), { code: 'COMMISSION_MODE_MISMATCH' });
    assert.equal(provider.calls.length, 0, 'mixed-mode historical earnings never initiate real provider work');
    const statement = await createStatement(['live']);
    const quote = await service.quote(owner.id, business.id, { statementIds: [statement.id], paymentMethod: 'card' });
    assert.equal(quote.feeEstimateBasis, 'estimated_provider_fees');
    assert.equal(schemas.commissionQuoteResponse.safeParse(raw(quote)).success, true);
    const input = { statementIds: [statement.id], paymentMethod: 'card', approvedTotalCents: quote.totalCents, feeEstimateAcknowledged: true, idempotencyKey: randomUUID() };
    provider.loseNextInvoice();
    const uncertain = await service.approve(owner.id, business.id, input);
    assert.equal(uncertain.retryable, true);
    const recovered = await service.approve(owner.id, business.id, input);
    const payment = await m.CommissionPayment.findByPk(recovered.paymentId);
    assert.equal(payment.providerMode, 'live'); assert.equal(payment.feePolicy.id, 'us-standard-invoicing-starter-v1');
    assert.equal(provider.invoices.size, 1); assert.equal(provider.customers.size, 1);
    assert.equal(payment.totalCents, input.approvedTotalCents);
    assert.equal(payment.billingEmailSnapshot.email, owner.email); assert.equal(payment.billingEmailSnapshot.userId, owner.id);
    assert.equal(provider.customers.get(payment.providerCustomerId).email, owner.email);
    assert.notEqual(owner.email, recipient.email); assert.equal(JSON.stringify(recovered).includes(owner.email), false);
    provider.succeed(payment, 50);
    const webhooks = createStripeWebhookService({ sequelize: db, models: m, stripe: provider.stripe, commissionPayments: service, individualCommissionProfiles: individuals });
    const event = { id: `evt_${randomUUID()}`, livemode: true, account: account.id, type: 'invoice.paid', data: { object: { id: payment.providerInvoiceId } } };
    assert.deepEqual(await webhooks.receive(JSON.stringify({ ...event, livemode: false }), 'valid'), { received: true, ignored: true });
    await webhooks.receive(JSON.stringify(event), 'valid');
    assert.equal((await payment.reload()).status, 'paid_fee_review');
    assert.equal(payment.providerNetCents, quote.totalCents - 50);
    const settled = await service.reviewInvoicingFee(owner.id, business.id, payment.id, { invoicingFeeCents: 5, evidenceReference: 'Controlled provider billing fixture', reason: 'Offline proof of invoice fee', idempotencyKey: randomUUID() });
    assert.equal(settled.status, 'paid');
    assert.equal(settled.recipientBankPayoutVerified, false);
    const earning = await m.CommissionEarning.findOne({ where: { statementId: statement.id } });
    assert.equal(earning.paidCommissionCents, 1000); assert.equal(earning.reservedCommissionCents, 0);
    assert.equal(provider.invoices.size, 1);
  } finally { await db.close(); }
});
