const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommissionPaymentService, quoteAmount, verifyInvoiceBinding, verifyCommissionCharge, LIVE_FEE_POLICY, SANDBOX_FEE_POLICY } = require('../src/services/commission-payment-service');
const { individualAccountMatches, individualReady } = require('../src/services/individual-commission-profile-service');
const { createStripeClient } = require('../src/payments/stripe-client');
const at = new Date('2026-10-02T12:00:00Z');
const remote = () => ({ id: 'acct_person', object: 'v2.core.account', livemode: false, identity: { entity_type: 'individual' }, dashboard: 'full',
  applied_configurations: ['merchant'], configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, ach_debit_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } },
  defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } }, requirements: { entries: [] } });
const profile = () => ({ userId: 'recipient', provider: 'stripe', providerMode: 'test', accountApiVersion: 'v2', lifecycleState: 'active', status: 'active', disconnectStatus: 'none', stripeAccountId: 'acct_person', verifiedStripeAccount: remote(), verifiedAt: at });
function evidenceFixture({ invoiceFee = null, feeEvidenceResolver = null, mode = 'test' } = {}) {
  const payment = { id: 'payment', organizationId: 'business', recipientUserId: 'recipient', individualCommissionProfileId: 'profile', stripeAccountId: 'acct_person', providerMode: 'test',
    currency: 'USD', commissionCents: 1000, feeAllowanceCents: 100, totalCents: 1100, paymentMethod: 'card', approvalHash: 'approval', approvedByUserId: 'owner', approvedAt: at,
    providerCustomerId: 'cus_business', providerInvoiceId: 'in_commission', statementSnapshot: [{ id: 'statement', eventId: 'event', eventTitle: 'Night', amountCents: 1000 }], status: 'awaiting_payment', reconciliationStatus: 'awaiting_payment',
    update: async function(values) { Object.assign(this, values); return this; } };
  const metadata = { commissionPaymentId: payment.id, organizationId: payment.organizationId, recipientUserId: payment.recipientUserId, approvalHash: payment.approvalHash };
  const invoice = { id: payment.providerInvoiceId, object: 'invoice', livemode: false, customer: payment.providerCustomerId, metadata, currency: 'usd', total: 1100, subtotal: 1100, amount_due: 1100, amount_paid: 1100, amount_remaining: 0, auto_advance: false, collection_method: 'send_invoice', status: 'paid', hosted_invoice_url: 'https://invoice.stripe.com/i/mock' };
  const invoicePayments = { has_more: false, data: [{ id: 'inpay_approved', object: 'invoice_payment', livemode: false, invoice: invoice.id, currency: 'usd', amount_requested: 1100, amount_paid: 1100, status: 'paid', is_default: true, payment: { type: 'payment_intent', payment_intent: 'pi_approved' } }] };
  const intent = { id: 'pi_approved', object: 'payment_intent', livemode: false, status: 'succeeded', amount: 1100, amount_received: 1100, currency: 'usd', customer: payment.providerCustomerId, latest_charge: 'ch_approved' };
  const charge = { id: 'ch_approved', object: 'charge', livemode: false, paid: true, captured: true, amount: 1100, amount_captured: 1100, currency: 'usd', customer: payment.providerCustomerId, payment_intent: intent.id,
    disputed: false, refunded: false, amount_refunded: 0, balance_transaction: 'txn_approved', payment_method_details: { type: 'card' } };
  const balance = { id: 'txn_approved', object: 'balance_transaction', source: charge.id, amount: 1100, fee: 50, net: 1050, currency: 'usd', type: 'charge', fee_details: [{ amount: 50, currency: 'usd', type: 'stripe_fee' }] };
  const lines = { has_more: false, data: [{ amount: 1000, currency: 'usd', metadata: { ...metadata, commissionStatementId: 'statement', eventId: 'event' } }, { amount: 100, currency: 'usd', metadata: { ...metadata, commissionFeeAllowance: 'true' } }] };
  payment.providerMode = mode;
  for (const object of [invoice, intent, charge, ...invoicePayments.data, ...lines.data]) object.livemode = mode === 'live';
  const reads = [], settlements = [];
  const scoped = (name, object) => async (_id, options) => { assert.equal(options.stripeAccount, 'acct_person'); reads.push(name); return structuredClone(object); };
  const stripe = { enabled: true, mode, retrieveCommissionInvoice: scoped('invoice', invoice), retrieveCommissionCustomer: scoped('customer', { id: payment.providerCustomerId, object: 'customer', livemode: mode === 'live', metadata }),
    listCommissionInvoiceLines: scoped('lines', lines), listCommissionInvoicePayments: scoped('payments', invoicePayments), retrieveCommissionPaymentIntent: scoped('intent', intent), retrieveCharge: scoped('charge', charge), retrieveCommissionBalanceTransaction: scoped('balance', balance) };
  const models = { CommissionPayment: { findByPk: async () => payment, findOne: async () => payment }, AuditLog: { create: async () => {} },
    User: { findByPk: async () => ({ lifecycleState: 'active' }) }, Organization: { findByPk: async () => ({ lifecycleState: 'active', status: 'active', onboardingEstablished: true }) }, OrganizationOwner: { findOne: async () => ({ role: 'owner' }) } };
  const sequelize = { transaction: async (_options, work) => work({ LOCK: { UPDATE: 'UPDATE' } }) };
  const service = createCommissionPaymentService({ sequelize, models, stripe, ledger: { assertStatementMode: async ({ providerMode }) => assert.equal(providerMode, payment.providerMode), finishPayment: async input => settlements.push(input) }, now: () => at,
    invoicingFeeEvidence: feeEvidenceResolver || (invoiceFee == null ? null : async () => ({ verified: true, invoiceId: invoice.id, stripeAccountId: payment.stripeAccountId, currency: 'USD', amountCents: invoiceFee })) });
  return { payment, invoice, invoicePayments, intent, charge, balance, lines, service, reads, settlements, stripe, models };
}
test('sandbox fee allowance is explicit, small balances carry forward and no client fee policy can bypass pricing', () => {
  assert.deepEqual(quoteAmount(1000, 'card'), { commissionCents: 1000, estimatedFeeCents: 94, totalCents: 1094, feeEstimateBasis: 'sandbox_estimate', feeReconciliationRequired: true });
  assert.throws(() => quoteAmount(49, 'card'), { code: 'COMMISSION_BELOW_MINIMUM' });
  assert.throws(() => quoteAmount(1000, 'card', { card: { bps: 0, fixedCents: 0 } }), { code: 'COMMISSION_FEE_POLICY_REQUIRED' });
});
test('live commissions verify every provider layer and keep actual net reconciliation unchanged', async () => {
  const valid = evidenceFixture({ mode: 'live', invoiceFee: 25 });
  const result = await valid.service.reconcile(valid.payment);
  assert.equal(result.status, 'paid'); assert.equal(result.verifiedNetCents, 1025); assert.equal(valid.settlements.length, 1);
  for (const select of [f => f.invoice, f => f.intent, f => f.charge, f => f.invoicePayments.data[0], f => f.lines.data[0]]) {
    const invalid = evidenceFixture({ mode: 'live', invoiceFee: 0 }); select(invalid).livemode = false;
    const rejected = await invalid.service.reconcile(invalid.payment);
    assert.equal(rejected.status, 'review'); assert.equal(rejected.errorCode, 'COMMISSION_VERIFICATION_FAILED');
    assert.equal(invalid.settlements.length, 0);
  }
  const crossMode = evidenceFixture(); crossMode.stripe.mode = 'live';
  await assert.rejects(crossMode.service.reconcile(crossMode.payment), { code: 'COMMISSION_VERIFICATION_FAILED' });
  assert.deepEqual(crossMode.reads, []);
});
test('live commission quote rounds fee components independently, caps ACH processing and never exceeds the approved gross', () => {
  for (const method of ['card', 'us_bank_account']) {
    const rail = LIVE_FEE_POLICY[method];
    const fee = gross => Math.min(rail.capCents ?? Infinity, Math.ceil(gross * rail.bps / 10000) + rail.fixedCents) + Math.ceil(gross * 40 / 10000);
    for (const commissionCents of [50, 99, 100, 999, 1000, 10_000, 61_749, 62_500, 100_000]) {
      const quote = quoteAmount(commissionCents, method, LIVE_FEE_POLICY);
      let minimum = commissionCents;
      while (minimum - fee(minimum) < commissionCents) minimum += 1;
      assert.equal(quote.totalCents, minimum, `${method}/${commissionCents} is minimal gross`);
      assert.equal(quote.estimatedFeeCents, quote.totalCents - commissionCents);
      assert.equal(quote.feeEstimateBasis, 'estimated_provider_fees');
    }
  }
  const bank = quoteAmount(100_000, 'us_bank_account', LIVE_FEE_POLICY);
  assert.equal(bank.totalCents, 100_904);
  assert.equal(bank.estimatedFeeCents, 904, 'ACH processing stops at $5 while invoice cost remains proportional');
  assert.throws(() => quoteAmount(99_999_999, 'card', LIVE_FEE_POLICY), { code: 'COMMISSION_AMOUNT_INVALID' });
});
test('live commission approval refuses an injected sandbox fee policy before creating provider work', async () => {
  const service = createCommissionPaymentService({ stripe: { enabled: true, mode: 'live' }, feePolicy: SANDBOX_FEE_POLICY });
  await assert.rejects(service.quote('owner', 'business', {}), { code: 'COMMISSION_FEE_POLICY_REQUIRED' });
  await assert.rejects(service.approve('owner', 'business', {}), { code: 'COMMISSION_FEE_POLICY_REQUIRED' });
});
test('individual readiness uses fresh full-dashboard merchant evidence, independent from business/shared accounts', () => {
  assert.equal(individualReady(profile(), 'us_bank_account', at), true);
  for (const applied of [true, '2026-10-02T11:59:00Z']) { const p = profile(); p.verifiedStripeAccount.configuration.merchant.applied = applied; assert.equal(individualAccountMatches(p.verifiedStripeAccount, p.stripeAccountId), true); }
  for (const change of [p => { p.verifiedAt = new Date(+at - 300001); }, p => { p.verifiedStripeAccount.dashboard = 'express'; }, p => { p.paymentsDisabledAt = at; }, p => { p.disconnectStatus = 'pending'; }, p => { p.verifiedStripeAccount.configuration.merchant.capabilities.ach_debit_payments.status = 'pending'; }, p => { p.verifiedStripeAccount.configuration.merchant.applied = 'invalid'; }]) {
    const p = profile(); change(p); assert.equal(individualReady(p, 'us_bank_account', at), false);
  }
});
test('verified Stripe money is held for invoicing fee review until actual net can be proved', async () => {
  const f = evidenceFixture(); const result = await f.service.reconcile(f.payment);
  assert.equal(result.status, 'paid_fee_review'); assert.equal(result.fundsReceived, true); assert.equal(result.verifiedNetCents, null); assert.equal(result.recipientBankPayoutVerified, false); assert.equal(result.netSettlementStatus, 'invoicing_fee_unknown'); assert.equal(f.settlements.length, 0);
  assert.deepEqual(f.reads, ['invoice', 'invoice', 'customer', 'lines', 'payments', 'intent', 'charge', 'balance']);
});
test('actual fully attributed fee evidence settles net once; insufficient net retains the business obligation', async () => {
  const paid = evidenceFixture({ invoiceFee: 25 }); const result = await paid.service.reconcile(paid.payment);
  assert.equal(result.status, 'paid'); assert.equal(result.verifiedNetCents, 1025); assert.equal(result.actualFeeCents, 75); assert.equal(paid.settlements.length, 1); assert.equal(paid.settlements[0].paid, true);
  await paid.service.reconcile(paid.payment); assert.equal(paid.settlements.length, 1);
  const short = evidenceFixture({ invoiceFee: 75 }); const incomplete = await short.service.reconcile(short.payment);
  assert.equal(incomplete.status, 'paid_fee_review'); assert.equal(incomplete.residualCents, 25); assert.equal(incomplete.netSettlementStatus, 'net_shortfall'); assert.equal(short.settlements.length, 1); assert.equal(short.settlements[0].settledAmountCents, 975);
});
test('invoice.paid, credits, out-of-band payment, edited items and mismatched charges cannot settle commission', async () => {
  const mutations = [f => { f.invoice.paid_out_of_band = true; }, f => { f.invoice.pre_payment_credit_notes_amount = 1; }, f => { f.invoice.amount_due = 0; }, f => { f.invoice.customer = 'cus_other'; }, f => { f.invoice.metadata = { ...f.invoice.metadata, approvalHash: 'forged' }; },
    f => { f.invoicePayments.data = []; }, f => { f.invoicePayments.data[0].is_default = false; }, f => { f.lines.data[0].amount = 1; }, f => { f.lines.has_more = true; }, f => { f.intent.amount_received = 0; }, f => { f.charge.application_fee_amount = 1; }, f => { f.charge.transfer_data = { destination: 'acct_platform' }; }, f => { f.balance.source = 'ch_other'; }, f => { f.charge.payment_method_details.type = 'link'; }, f => { f.balance.exchange_rate = 0.9; }];
  for (const change of mutations) { const f = evidenceFixture({ invoiceFee: 0 }); change(f); const result = await f.service.reconcile(f.payment); assert.equal(result.status, 'review'); assert.equal(result.errorCode, 'COMMISSION_VERIFICATION_FAILED'); assert.equal(f.settlements.length, 0); }
});
test('bank processing and failures remain reserved; only provider-confirmed void/cancellation releases', async () => {
  const f = evidenceFixture(); f.payment.paymentMethod = 'us_bank_account'; f.invoice.status = 'open'; f.invoice.amount_paid = 0; f.invoice.amount_remaining = 1100; f.invoicePayments.data[0].status = 'open'; f.invoicePayments.data[0].amount_paid = 0; f.intent.status = 'processing'; f.intent.latest_charge = null;
  assert.equal((await f.service.reconcile(f.payment)).status, 'processing'); assert.equal(f.settlements.length, 0);
  f.intent.status = 'requires_payment_method'; f.intent.last_payment_error = { code: 'payment_failed' }; assert.equal((await f.service.reconcile(f.payment)).status, 'payment_failed'); assert.equal(f.settlements.length, 0);
  f.invoice.status = 'void'; f.intent.status = 'canceled'; f.invoicePayments.data[0].status = 'canceled'; assert.equal((await f.service.reconcile(f.payment)).status, 'failed'); assert.equal(f.settlements.length, 1); assert.equal(f.settlements[0].paid, false);
  await f.service.reconcile(f.payment); assert.equal(f.settlements.length, 1);
});
test('provider disputed or refunded charge downgrades settlement without automatically paying again', async () => {
  for (const field of ['disputed', 'refunded']) { const f = evidenceFixture({ invoiceFee: 0 }); await f.service.reconcile(f.payment); f.charge[field] = true; const result = await f.service.reconcile(f.payment); assert.equal(result.status, field === 'disputed' ? 'disputed' : 'reversed'); assert.equal(f.settlements.length, 1); assert.equal(result.fundsReceived, false); }
});
test('void invoice cannot release an already received or missing previously bound payment', async () => {
  const received = evidenceFixture(); await received.service.reconcile(received.payment); received.invoice.status = 'void'; received.invoicePayments.data = [];
  assert.notEqual((await received.service.reconcile(received.payment)).status, 'failed'); assert.equal(received.settlements.length, 0);
  const lost = evidenceFixture(); lost.payment.providerPaymentIntentId = lost.intent.id; lost.payment.providerChargeId = lost.charge.id;
  lost.invoice.status = 'void'; lost.invoice.amount_paid = 0; lost.invoicePayments.data = []; lost.intent.latest_charge = null; lost.intent.status = 'canceled';
  assert.equal((await lost.service.reconcile(lost.payment)).status, 'review'); assert.equal(lost.settlements.length, 0);
});
test('a delayed positive proof cannot resurrect a newer verified reversal', async () => {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), pause = new Promise(resolve => { release = resolve; });
  const f = evidenceFixture({ feeEvidenceResolver: async ({ invoice, stripeAccountId }) => { enter(); await pause; return { verified: true, invoiceId: invoice.id, stripeAccountId, currency: 'USD', amountCents: 0 }; } });
  const staleSuccess = f.service.reconcile(f.payment); await entered;
  f.charge.refunded = true; f.charge.amount_refunded = 1100;
  assert.equal((await f.service.reconcile(f.payment)).status, 'reversed');
  release(); const result = await staleSuccess;
  assert.equal(result.status, 'reversed'); assert.equal(f.payment.status, 'reversed'); assert.equal(f.settlements.length, 0); assert.equal(result.hostedInvoiceUrl, null);
});
test('a purchase invalidation fences in-flight settlement and hides a previously issued link', async () => {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), pause = new Promise(resolve => { release = resolve; });
  const f = evidenceFixture({ feeEvidenceResolver: async ({ invoice, stripeAccountId }) => { enter(); await pause; return { verified: true, invoiceId: invoice.id, stripeAccountId, currency: 'USD', amountCents: 0 }; } });
  f.payment.providerVerificationStatus = 'verified'; f.payment.hostedInvoiceUrl = f.invoice.hosted_invoice_url;
  const beforeRefund = f.service.reconcile(f.payment); await entered;
  f.payment.invalidatedAt = at; f.payment.invalidationReason = 'purchase_refund'; f.payment.reconciliationToken = null;
  release(); const result = await beforeRefund;
  assert.equal(result.hostedInvoiceUrl, null); assert.equal(f.settlements.length, 0); assert.equal(f.payment.providerBalanceTransactionId, undefined);
});
test('invalidated unpaid original invoices release only after independent void proof, even after a lost response', async () => {
  const f = evidenceFixture(); f.payment.invalidatedAt = at; f.payment.invalidationReason = 'purchase_refund';
  f.invoice.status = 'open'; f.invoice.amount_paid = 0; f.invoice.amount_remaining = 1100; f.invoicePayments.data = [];
  let voids = 0;
  f.stripe.voidCommissionInvoice = async (id, options) => { assert.equal(id, f.invoice.id); assert.equal(options.stripeAccount, f.payment.stripeAccountId); assert.equal(options.idempotencyKey, 'commission/payment/invalidate-void'); voids += 1; f.invoice.status = 'void'; f.invoice.amount_due = 0; f.invoice.amount_remaining = 0; throw new Error('Void succeeded; response lost'); };
  const result = await f.service.reconcile(f.payment);
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'COMMISSION_REQUOTE_REQUIRED'); assert.equal(result.hostedInvoiceUrl, null); assert.equal(voids, 1); assert.equal(f.settlements.length, 1); assert.equal(f.settlements[0].paid, false);
  await f.service.reconcile(f.payment); assert.equal(voids, 1); assert.equal(f.settlements.length, 1);
});
test('an invalidated processing bank payment retains its durable reservation until provider confirmation', async () => {
  const f = evidenceFixture(); f.payment.invalidatedAt = at; f.payment.paymentMethod = 'us_bank_account'; f.invoice.status = 'open'; f.invoice.amount_paid = 0; f.invoice.amount_remaining = 1100; f.invoicePayments.data[0].status = 'open'; f.invoicePayments.data[0].amount_paid = 0; f.intent.status = 'processing'; f.intent.latest_charge = null;
  f.stripe.voidCommissionInvoice = async () => { throw new Error('Payment processing, outcome unknown'); };
  const result = await f.service.reconcile(f.payment);
  assert.equal(result.status, 'processing'); assert.equal(result.errorCode, 'COMMISSION_INVALIDATION_PENDING'); assert.equal(result.hostedInvoiceUrl, null); assert.equal(f.settlements.length, 0);
});
test('only verified unchanged payable invoice content exposes its hosted payment URL', async () => {
  const f = evidenceFixture(); f.invoice.status = 'open'; f.invoice.amount_paid = 0; f.invoice.amount_remaining = 1100; f.invoicePayments.data = [];
  const valid = await f.service.reconcile(f.payment); assert.equal(valid.hostedInvoiceUrl, f.invoice.hosted_invoice_url); assert.equal(valid.providerVerificationStatus, 'verified');
  f.lines.data[0].amount = 1;
  const edited = await f.service.reconcile(f.payment); assert.equal(edited.status, 'review'); assert.equal(edited.hostedInvoiceUrl, null); assert.equal(f.payment.hostedInvoiceUrl, null);
});
test('100 selected statements plus fee allowance are verified through two bounded pages', async () => {
  const f = evidenceFixture({ invoiceFee: 0 }), metadata = f.invoice.metadata;
  f.payment.statementSnapshot = Array.from({ length: 100 }, (_value, i) => ({ id: `statement_${i}`, eventId: `event_${i}`, eventTitle: `Event ${i}`, currency: 'USD', amountCents: 10 }));
  const lines = [...f.payment.statementSnapshot.map((s, i) => ({ id: `il_${i}`, livemode: false, amount: 10, currency: 'usd', metadata: { ...metadata, commissionStatementId: s.id, eventId: s.eventId } })), { id: 'il_fee', livemode: false, amount: 100, currency: 'usd', metadata: { ...metadata, commissionFeeAllowance: 'true' } }];
  const cursors = [];
  f.stripe.listCommissionInvoiceLines = async (_id, options, { startingAfter }) => { assert.equal(options.stripeAccount, f.payment.stripeAccountId); cursors.push(startingAfter); return startingAfter ? { has_more: false, data: lines.slice(100) } : { has_more: true, data: lines.slice(0, 100) }; };
  assert.equal((await f.service.reconcile(f.payment)).status, 'paid'); assert.deepEqual(cursors, [undefined, 'il_99']); assert.equal(f.settlements.length, 1);
});
test('merchant fee review is scoped, immutable, idempotent and credits only actual net', async () => {
  const f = evidenceFixture(); let audits = 0; f.models.AuditLog.create = async entry => { if (entry.action === 'commission_payment.invoicing_fee_merchant_reviewed') { audits += 1; assert.equal(entry.actorUserId, 'owner'); } };
  const input = { invoicingFeeCents: 75, evidenceReference: 'Stripe itemized invoice fee statement 2026-10', reason: 'Recipient supplied separately billed Invoice fee line', idempotencyKey: require('node:crypto').randomUUID() };
  const result = await f.service.reviewInvoicingFee('owner', 'business', f.payment.id, input);
  assert.equal(result.feeEvidence, 'merchant_reviewed'); assert.equal(result.providerVerificationStatus, 'verified'); assert.equal(result.status, 'paid_fee_review'); assert.equal(result.residualCents, 25); assert.equal(result.verifiedNetCents, 975); assert.equal(f.settlements[0].settledAmountCents, 975); assert.equal(audits, 1);
  await f.service.reviewInvoicingFee('owner', 'business', f.payment.id, input); assert.equal(audits, 1); assert.equal(f.settlements.length, 1);
  await assert.rejects(f.service.reviewInvoicingFee('owner', 'business', f.payment.id, { ...input, invoicingFeeCents: 74 }), { code: 'COMMISSION_FEE_REVIEW_CONFLICT' });
  f.charge.refunded = true; assert.equal((await f.service.reconcile(f.payment)).status, 'reversed');
  assert.equal((await f.service.reviewInvoicingFee('owner', 'business', f.payment.id, input)).status, 'reversed'); assert.equal(audits, 1);
});
test('manual fee review cannot replace absent or negative provider settlement evidence', async () => {
  for (const mutate of [f => { f.invoicePayments.data = []; }, f => { f.charge.disputed = true; }, f => { f.invoice.paid_out_of_band = true; }]) {
    const f = evidenceFixture(); mutate(f);
    await assert.rejects(f.service.reviewInvoicingFee('owner', 'business', f.payment.id, { invoicingFeeCents: 0, evidenceReference: 'review', reason: 'checked fees', idempotencyKey: require('node:crypto').randomUUID() }), { code: 'COMMISSION_FEE_REVIEW_NOT_READY' });
    assert.equal(f.settlements.length, 0);
  }
});
test('merchant review cannot settle stale verified funds when its independent refresh fails', async () => {
  const f = evidenceFixture(); await f.service.reconcile(f.payment);
  assert.equal(f.payment.providerVerificationStatus, 'verified'); assert.equal(f.payment.status, 'paid_fee_review');
  f.stripe.retrieveCharge = async () => { throw new Error('Provider temporarily unavailable'); };
  await assert.rejects(f.service.reviewInvoicingFee('owner', 'business', f.payment.id, { invoicingFeeCents: 0, evidenceReference: 'reviewed bill', reason: 'fee line checked', idempotencyKey: require('node:crypto').randomUUID() }), { code: 'COMMISSION_FEE_REVIEW_NOT_READY' });
  assert.equal(f.settlements.length, 0); assert.equal(f.payment.feeReview, undefined); assert.notEqual(f.payment.reconciliationToken, f.payment.verifiedObservationToken);
});
test('commission adapter forces connected-account scope, keeps customer and invoice local, and preserves zero app fee', () => {
  const calls = []; const resource = name => new Proxy({}, { get: (_target, method) => (...args) => calls.push({ name, method, args }) });
  const sdk = { customers: resource('customers'), invoices: resource('invoices'), invoiceItems: resource('invoiceItems'), invoicePayments: resource('invoicePayments'), paymentIntents: resource('paymentIntents'), balanceTransactions: resource('balanceTransactions') };
  const config = { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_PUBLISHABLE_KEY: 'pk_test_mock', STRIPE_WEBHOOK_SECRET: 'whsec_mock', STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_mock' };
  const client = createStripeClient(config, { sdk }), scope = { stripeAccount: 'acct_person', idempotencyKey: 'commission/stable' };
  client.createCommissionCustomer({ name: 'Business' }, scope); client.createCommissionInvoice({ customer: 'cus_business', auto_advance: false }, scope); client.createCommissionInvoiceItem({ invoice: 'in_local', amount: 1000 }, scope); client.finalizeCommissionInvoice('in_local', { auto_advance: false }, scope); client.listCommissionInvoicePayments('in_local', scope); client.retrieveCommissionBalanceTransaction('txn_local', scope);
  for (const call of calls) assert.deepEqual(call.args.at(-1), scope);
  for (const name of ['createCommissionCustomer', 'createCommissionInvoice', 'createCommissionInvoiceItem']) assert.throws(() => client[name]({}, {}), { code: 'PAYMENTS_NOT_READY' });
  const guarded = createStripeClient({ ...config, STRIPE_WEBHOOK_SECRET: '' }, { sdk }); assert.throws(() => guarded.createCommissionInvoice({}, scope), { code: 'PAYMENTS_NOT_ENABLED' });
  assert.equal(calls.some(c => c.args.some(a => a?.application_fee_amount || a?.transfer_data)), false);
});
