const { createHash, randomUUID } = require('node:crypto');
const { Op, QueryTypes } = require('sequelize');
const { z } = require('zod');
const { conflict, notFound } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
const { assertFinanceAccess } = require('./business-payment-account-service');
const { individualReady } = require('./individual-commission-profile-service');
const { statementSelection, commissionApproval, commissionPage, commissionFeeReviewInput } = require('../http/commission-payment-schemas');
const { isStripeMode, matchesStripeLivemode } = require('../payments/stripe-mode');
const { assertActiveUser } = require('./lifecycle-service');
const providerId = value => typeof value === 'string' ? value : value?.id;
const sameCurrency = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toUpperCase() === b.toUpperCase();
const zero = value => value == null || value === 0;
const terminal = new Set(['failed', 'reversed', 'disputed']);
const RECOVERY_WINDOW_MS = 23 * 3600000;
const billingEmailSnapshotSchema = z.object({ version: z.literal(1), userId: z.uuid(), email: z.email().max(320),
  verifiedAt: z.iso.datetime(), customerName: z.string().min(1).max(160) }).strict();
function verifiedBillingEmailSnapshot(user, customerName, approvedAt) {
  assertActiveUser(user);
  const verifiedAt = user.emailVerifiedAt instanceof Date ? user.emailVerifiedAt
    : typeof user.emailVerifiedAt === 'string' ? new Date(user.emailVerifiedAt) : null;
  if (!verifiedAt || !Number.isFinite(+verifiedAt) || !Number.isFinite(+approvedAt) || +verifiedAt <= 0 || +verifiedAt > +approvedAt) {
    throw conflict('Verify your account email before approving a commission payment.', 'COMMISSION_BILLING_EMAIL_REQUIRED');
  }
  const parsed = billingEmailSnapshotSchema.safeParse({ version: 1, userId: user.id, email: user.email,
    verifiedAt: verifiedAt.toISOString(), customerName });
  if (!parsed.success) throw conflict('Verify a valid account email before approving a commission payment.', 'COMMISSION_BILLING_EMAIL_REQUIRED');
  return parsed.data;
}
function approvedBillingEmailSnapshot(payment) {
  const parsed = billingEmailSnapshotSchema.safeParse(payment.billingEmailSnapshot);
  if (!parsed.success || parsed.data.userId !== payment.approvedByUserId) return null;
  const verifiedAt = new Date(parsed.data.verifiedAt), approvedAt = new Date(payment.approvedAt);
  return Number.isFinite(+approvedAt) && +verifiedAt > 0 && +verifiedAt <= +approvedAt
    && verifiedAt.toISOString() === parsed.data.verifiedAt ? parsed.data : null;
}
// A test-only allowance, not Stripe pricing or a promise of the recipient's net.
const SANDBOX_FEE_POLICY = Object.freeze({ id: 'sandbox-commission-allowance-v1', basis: 'sandbox_estimate', card: { bps: 400, fixedCents: 50 }, us_bank_account: { bps: 200, fixedCents: 50 }, invoicingFeesIncludedInEstimate: true, exact: false });
// Standard US domestic payment and Invoicing Starter estimates. Each component
// rounds upward independently; actual retrieved net, never this estimate,
// determines settlement. Customized/international/Plus costs can differ.
const LIVE_FEE_POLICY = Object.freeze({ id: 'us-standard-invoicing-starter-v1', basis: 'estimated_provider_fees',
  card: Object.freeze({ bps: 290, fixedCents: 30 }), us_bank_account: Object.freeze({ bps: 80, fixedCents: 0, capCents: 500 }),
  invoicing: Object.freeze({ bps: 40, fixedCents: 0 }), invoicingFeesIncludedInEstimate: true, exact: false });
function quoteAmount(commissionCents, paymentMethod, policy = SANDBOX_FEE_POLICY) {
  const rail = policy?.[paymentMethod];
  if (!['sandbox_estimate', 'estimated_provider_fees'].includes(policy?.basis) || !Number.isInteger(rail?.bps) || rail.bps < 0 || rail.bps >= 10000 || !Number.isInteger(rail.fixedCents) || rail.fixedCents < 0) throw conflict('A reviewed commission fee estimate is required.', 'COMMISSION_FEE_POLICY_REQUIRED');
  if (!Number.isSafeInteger(commissionCents) || commissionCents <= 0 || commissionCents > 99_999_999) throw conflict('Commission amount is unavailable.', 'COMMISSION_AMOUNT_INVALID');
  if (commissionCents < 50) throw conflict('Carry this small balance forward to another event statement for this business, recipient and currency.', 'COMMISSION_BELOW_MINIMUM');
  let totalCents;
  if (policy.basis === 'sandbox_estimate') totalCents = Math.ceil((commissionCents + rail.fixedCents) * 10000 / (10000 - rail.bps));
  else {
    const invoicing = policy.invoicing;
    if (!Number.isInteger(invoicing?.bps) || invoicing.bps < 0 || invoicing.bps + rail.bps >= 10000
      || !Number.isInteger(invoicing.fixedCents) || invoicing.fixedCents < 0
      || rail.capCents !== undefined && (!Number.isInteger(rail.capCents) || rail.capCents < rail.fixedCents)) throw conflict('A reviewed commission fee estimate is required.', 'COMMISSION_FEE_POLICY_REQUIRED');
    const processing = gross => Math.min(rail.capCents ?? Infinity, Math.ceil(gross * rail.bps / 10000) + rail.fixedCents);
    const net = gross => gross - processing(gross) - Math.ceil(gross * invoicing.bps / 10000) - invoicing.fixedCents;
    if (net(99_999_999) < commissionCents) throw conflict('Commission amount is unavailable.', 'COMMISSION_AMOUNT_INVALID');
    // Component rounding can make adjacent net amounts non-monotone by one
    // cent, so binary search the unrounded lower bound, then check pennies.
    let low = commissionCents, high = 99_999_999;
    const unroundedNetScaled = gross => gross * 10000 - Math.min(rail.capCents === undefined ? Infinity : rail.capCents * 10000, gross * rail.bps + rail.fixedCents * 10000) - gross * invoicing.bps - invoicing.fixedCents * 10000;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (unroundedNetScaled(mid) >= commissionCents * 10000) high = mid; else low = mid + 1; }
    totalCents = low;
    while (totalCents <= 99_999_999 && net(totalCents) < commissionCents) totalCents += 1;
  }
  if (!Number.isSafeInteger(totalCents) || totalCents > 99_999_999) throw conflict('Commission amount is unavailable.', 'COMMISSION_AMOUNT_INVALID');
  if (totalCents < 50) throw conflict('Carry this small balance forward to another event statement.', 'COMMISSION_BELOW_MINIMUM');
  return { commissionCents, estimatedFeeCents: totalCents - commissionCents, totalCents, feeEstimateBasis: policy.basis, feeReconciliationRequired: true };
}
function safePayment(payment) {
  return { paymentId: payment.id, organizationId: payment.organizationId, recipientUserId: payment.recipientUserId,
    currency: payment.currency, status: payment.status, paymentMethod: payment.paymentMethod,
    hostedInvoiceUrl: !payment.invalidatedAt && payment.providerVerificationStatus === 'verified' && payment.verifiedObservationToken && payment.verifiedObservationToken === payment.reconciliationToken && ['awaiting_payment', 'payment_failed'].includes(payment.status) ? payment.hostedInvoiceUrl || null : null,
    commissionCents: payment.commissionCents, estimatedFeeCents: payment.feeAllowanceCents, totalCents: payment.totalCents,
    actualFeeCents: payment.providerFeeCents == null || payment.invoicingFeeCents == null ? null : payment.providerFeeCents + payment.invoicingFeeCents,
    verifiedNetCents: payment.providerNetCents == null || payment.invoicingFeeCents == null ? null : payment.providerNetCents - payment.invoicingFeeCents,
    processingFeeCents: payment.providerFeeCents ?? null, invoicingFeeCents: payment.invoicingFeeCents ?? null,
    providerVerificationStatus: payment.providerVerificationStatus || 'pending', feeEvidence: payment.feeEvidence || null,
    feeReview: payment.feeReview ? { invoicingFeeCents: payment.feeReview.invoicingFeeCents, evidenceReference: payment.feeReview.evidenceReference, reason: payment.feeReview.reason, reviewedAt: payment.feeReview.reviewedAt, reviewedByUserId: payment.feeReview.reviewedByUserId } : null,
    netSettlementStatus: payment.reconciliationStatus, residualCents: payment.residualCents ?? null,
    fundsReceived: ['paid', 'paid_fee_review'].includes(payment.status), recipientBankPayoutVerified: false,
    statements: payment.statementSnapshot.map(({ id, eventId, eventTitle, currency, amountCents }) => ({ id, eventId, eventTitle, currency, amountCents })), approvedAt: payment.approvedAt, errorCode: payment.errorCode || null };
}
function invoiceMetadata(payment) { return { commissionPaymentId: payment.id, organizationId: payment.organizationId, recipientUserId: payment.recipientUserId, approvalHash: payment.approvalHash }; }
function metadataMatches(object, payment) { const expected = invoiceMetadata(payment); return Object.entries(expected).every(([key, value]) => object?.metadata?.[key] === value); }
function verifyInvoiceBinding(invoice, payment) {
  return invoice?.id === payment.providerInvoiceId && invoice.object === 'invoice' && matchesStripeLivemode(invoice, payment.providerMode) && metadataMatches(invoice, payment)
    && providerId(invoice.customer) === payment.providerCustomerId && sameCurrency(invoice.currency, payment.currency)
    && invoice.total === payment.totalCents && invoice.subtotal === payment.totalCents && (invoice.amount_due === payment.totalCents || invoice.status === 'void' && invoice.amount_due === 0) && invoice.paid_out_of_band !== true && zero(invoice.application_fee_amount)
    && !invoice.transfer_data && !invoice.on_behalf_of && invoice.collection_method === 'send_invoice' && invoice.auto_advance === false
    && zero(invoice.pre_payment_credit_notes_amount) && zero(invoice.post_payment_credit_notes_amount)
    && zero(invoice.starting_balance) && zero(invoice.amount_overpaid) && (!invoice.total_discount_amounts || invoice.total_discount_amounts.length === 0)
    && (!invoice.total_taxes || invoice.total_taxes.length === 0) && (!invoice.total_pretax_credit_amounts || invoice.total_pretax_credit_amounts.length === 0);
}
function verifyCommissionCharge(payment, intent, charge, balance) {
  return intent?.object === 'payment_intent' && matchesStripeLivemode(intent, payment.providerMode) && intent.status === 'succeeded'
    && intent.amount === payment.totalCents && intent.amount_received === payment.totalCents && sameCurrency(intent.currency, payment.currency)
    && providerId(intent.customer) === payment.providerCustomerId && providerId(intent.latest_charge) === charge?.id
    && zero(intent.application_fee_amount) && !intent.transfer_data && !intent.on_behalf_of
    && charge?.object === 'charge' && matchesStripeLivemode(charge, payment.providerMode) && charge.paid === true && charge.captured === true
    && charge.amount === payment.totalCents && charge.amount_captured === payment.totalCents && sameCurrency(charge.currency, payment.currency)
    && providerId(charge.payment_intent) === intent.id && providerId(charge.customer) === payment.providerCustomerId
    && !charge.application_fee && zero(charge.application_fee_amount) && !charge.transfer && !charge.transfer_data && !charge.destination && !charge.on_behalf_of
    && charge.disputed === false && charge.refunded === false && charge.amount_refunded === 0
    && charge.payment_method_details?.type === payment.paymentMethod
    && balance?.id === providerId(charge.balance_transaction) && balance.object === 'balance_transaction'
    && providerId(balance.source) === charge.id && ['charge', 'payment'].includes(balance.type) && sameCurrency(balance.currency, payment.currency)
    && balance.amount === payment.totalCents && Number.isInteger(balance.fee) && balance.fee >= 0 && balance.fee <= balance.amount && balance.net === balance.amount - balance.fee
    && !balance.exchange_rate && Array.isArray(balance.fee_details) && balance.fee_details.every(fee => Number.isInteger(fee.amount) && fee.amount >= 0 && sameCurrency(fee.currency, payment.currency))
    && balance.fee_details.reduce((sum, fee) => sum + fee.amount, 0) === balance.fee && !balance.fee_details.some(fee => fee.type === 'application_fee' || fee.application);
}
function createCommissionPaymentService({ sequelize, models, stripe, ledger, individualProfiles, feePolicy = stripe?.mode === 'live' ? LIVE_FEE_POLICY : SANDBOX_FEE_POLICY, invoicingFeeEvidence = null, now = () => new Date() }) {
  function enabled() {
    if (!stripe?.enabled || !isStripeMode(stripe.mode)) throw conflict('Commission payments are unavailable.', 'PAYMENTS_NOT_ENABLED');
  }
  function quotePolicy() {
    if (stripe.mode === 'live' && feePolicy?.basis !== 'estimated_provider_fees' || stripe.mode === 'test' && feePolicy?.basis !== 'sandbox_estimate') throw conflict('A reviewed commission fee estimate for this payment environment is required.', 'COMMISSION_FEE_POLICY_REQUIRED');
    return feePolicy;
  }
  const transact = fn => mutationTransaction(sequelize, fn);
  async function audit(payment, action, transaction, after = {}) { await models.AuditLog.create({ actorUserId: payment.approvedByUserId, organizationId: payment.organizationId, entityType: 'CommissionPayment', entityId: payment.id, action, after: { status: payment.status, commissionCents: payment.commissionCents, totalCents: payment.totalCents, ...after } }, { transaction }); }
  async function selected(organizationId, ids, transaction) {
    const statements = await models.CommissionStatement.findAll({ where: { id: ids, organizationId }, order: [['id', 'ASC']], transaction });
    if (statements.length !== ids.length) throw notFound('Commission statement');
    if (new Set(statements.map(s => `${s.recipientUserId}/${s.currency.toUpperCase()}`)).size !== 1) throw conflict('Combine only statements for the same business, recipient and currency.', 'COMMISSION_STATEMENT_SCOPE');
    await ledger.assertStatementMode({ statementIds: ids, providerMode: stripe.mode, transaction });
    if (statements[0].currency.toUpperCase() !== 'USD') throw conflict('Commission execution currently supports USD payments only.', 'COMMISSION_CURRENCY_UNSUPPORTED');
    const summaries = await ledger.summarizeStatements({ organizationId, statementIds: ids, transaction });
    const items = [];
    for (const statement of statements) {
      const summary = summaries.find(row => row.id === statement.id);
      const amountCents = summary.payableCommissionCents;
      if (statement.status !== 'approved') throw conflict('Approve each event statement individually first.', 'COMMISSION_STATEMENT_NOT_APPROVED');
      if (!Number.isInteger(amountCents) || amountCents <= 0 || +new Date(statement.availableAt) > +now()) throw conflict('This event statement is not currently payable.', 'COMMISSION_STATEMENT_NOT_PAYABLE');
      items.push({ id: statement.id, eventId: statement.eventId, eventTitle: statement.eventTitle, currency: statement.currency, amountCents });
    }
    return { statements: items, recipientUserId: statements[0].recipientUserId, currency: statements[0].currency.toUpperCase(), amountCents: items.reduce((sum, s) => sum + s.amountCents, 0) };
  }
  async function quote(userId, organizationId, body) {
    enabled(); quotePolicy();
    const input = statementSelection.parse(body);
    return transact(async transaction => { await assertFinanceAccess(models, userId, organizationId, transaction);
      const selection = await selected(organizationId, input.statementIds, transaction);
      const attempts = await withPaymentState(selection.statements, transaction);
      const installmentFingerprint = createHash('sha256').update(JSON.stringify(attempts.map(row => [row.id, row.latestPaymentAttempt?.paymentId || null]).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
      return { recipientUserId: selection.recipientUserId, currency: selection.currency, statements: selection.statements, statementIds: input.statementIds, installmentFingerprint, ...quoteAmount(selection.amountCents, input.paymentMethod, feePolicy), paymentMethod: input.paymentMethod };
    });
  }
  async function approveStatement(userId, organizationId, statementId) {
    return transact(async transaction => { await assertFinanceAccess(models, userId, organizationId, transaction);
      const statement = await models.CommissionStatement.findOne({ where: { id: statementId, organizationId }, transaction });
      if (!statement) throw notFound('Commission statement');
      await ledger.approveStatements({ organizationId, recipientUserId: statement.recipientUserId, currency: statement.currency, statementIds: [statementId], approvedByUserId: userId, transaction });
      const rows = await ledger.summarizeStatements({ organizationId, statementIds: [statementId], transaction });
      return (await withPaymentState(rows, transaction))[0];
    });
  }
  async function list(userId, organizationId, query = {}) {
    const input = commissionPage.parse(query);
    return transact(async transaction => { await assertFinanceAccess(models, userId, organizationId, transaction); const result = await ledger.listStatements({ organizationId, ...input, transaction });
      const rows = result.rows || result.items;
      const recipients = await models.User.findAll({ where: { id: [...new Set(rows.map(row => row.recipientUserId))] }, attributes: ['id', 'displayName'], transaction });
      const enriched = await withPaymentState(rows, transaction);
      return { ...result, rows: undefined, hasMore: result.page * result.pageSize < result.total, items: enriched.map(row => ({ ...row, recipientDisplayName: recipients.find(u => u.id === row.recipientUserId)?.displayName || 'Commission recipient',
        canApprove: row.status === 'pending' && +new Date(row.availableAt) <= +now() && row.payableCommissionCents > 0,
        approvalBlocker: +new Date(row.availableAt) > +now() ? 'COMMISSION_EVENT_NOT_MATURE' : row.heldCommissionCents > 0 && row.payableCommissionCents === 0 ? 'COMMISSION_PURCHASE_HOLD' : null })) };
    });
  }
  async function withPaymentState(rows, transaction) {
    if (!rows.length) return rows;
    const payments = await sequelize.query(`SELECT DISTINCT ON (a.statement_id) a.statement_id AS "statementId",p.id AS "paymentId",p.status,p.reconciliation_status AS "netSettlementStatus",p.fee_evidence AS "feeEvidence",p.provider_verification_status AS "providerVerificationStatus"
      FROM commission_allocations a JOIN commission_payments p ON p.id=a.payment_id
      WHERE a.statement_id IN (:statementIds) AND a.status IN ('reserved','paid')
      ORDER BY a.statement_id,CASE WHEN p.status='paid' THEN 1 ELSE 0 END,p.approved_at DESC,p.id DESC LIMIT 100`,
    { replacements: { statementIds: rows.map(row => row.id) }, type: QueryTypes.SELECT, transaction });
    const latestAttempts = await sequelize.query(`SELECT DISTINCT ON (a.statement_id) a.statement_id AS "statementId",p.id AS "paymentId",p.status,p.reconciliation_status AS "netSettlementStatus",p.fee_evidence AS "feeEvidence",p.provider_verification_status AS "providerVerificationStatus"
      FROM commission_allocations a JOIN commission_payments p ON p.id=a.payment_id WHERE a.statement_id IN (:statementIds)
      ORDER BY a.statement_id,p.approved_at DESC,p.id DESC LIMIT 100`,
    { replacements: { statementIds: rows.map(row => row.id) }, type: QueryTypes.SELECT, transaction });
    return rows.map(row => {
      const current = payments.find(p => p.statementId === row.id);
      const latest = latestAttempts.find(p => p.statementId === row.id);
      const summary = p => p ? { paymentId: p.paymentId, status: p.status, netSettlementStatus: p.netSettlementStatus, feeEvidence: p.feeEvidence, providerVerificationStatus: p.providerVerificationStatus } : null;
      return { ...row, payment: summary(current), latestPaymentAttempt: summary(latest) };
    });
  }
  async function ownStatements(userId, query = {}) {
    const input = require('../http/commission-payment-schemas').ownCommissionPage.parse(query);
    if (!require('./lifecycle-service').activeUser(await models.User.findByPk(userId))) throw require('../domain/errors').forbidden('An active account is required');
    const result = await ledger.listStatements({ recipientUserId: userId, ...input });
    return { ...result, rows: undefined, hasMore: result.page * result.pageSize < result.total, items: await withPaymentState(result.rows || result.items) };
  }
  async function approve(userId, organizationId, body) {
    enabled(); quotePolicy(); const input = commissionApproval.parse(body);
    const approvalHash = createHash('sha256').update(JSON.stringify({ statementIds: [...input.statementIds].sort(), paymentMethod: input.paymentMethod, approvedTotalCents: input.approvedTotalCents, feeEstimateAcknowledged: true })).digest('hex');
    const organization = await assertFinanceAccess(models, userId, organizationId);
    const old = await models.CommissionPayment.findOne({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
    if (old) { if (old.approvalHash !== approvalHash) throw conflict('Commission retry does not match the original approval.', 'COMMISSION_IDEMPOTENCY_CONFLICT'); return reconcile(old); }
    // Reject new unverified billing identities before any provider operation.
    // Existing attempts retain their immutable approval, not a retrying user's
    // current email or an arbitrary business owner's address.
    verifiedBillingEmailSnapshot(await models.User.findByPk(userId), organization.name, now());
    const preliminary = await selected(organizationId, input.statementIds);
    const profile = await models.IndividualCommissionProfile.findOne({ where: { userId: preliminary.recipientUserId } });
    if (!profile?.stripeAccountId) throw conflict('The recipient must connect their individual Stripe account.', 'COMMISSION_PROFILE_NOT_READY');
    await individualProfiles.synchronizeTrusted(profile.stripeAccountId);
    const payment = await transact(async transaction => {
      const currentOrganization = await assertFinanceAccess(models, userId, organizationId, transaction);
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', { replacements: { key: `commission-approval/${organizationId}/${input.idempotencyKey}` }, transaction, type: QueryTypes.SELECT });
      const existing = await models.CommissionPayment.findOne({ where: { organizationId, idempotencyKey: input.idempotencyKey }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing) { if (existing.approvalHash !== approvalHash) throw conflict('Commission retry does not match the original approval.', 'COMMISSION_IDEMPOTENCY_CONFLICT'); return existing; }
      const approver = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' });
      const approvedAt = now();
      const billingEmailSnapshot = verifiedBillingEmailSnapshot(approver, currentOrganization.name, approvedAt);
      const selection = await selected(organizationId, input.statementIds, transaction);
      const currentProfile = await models.IndividualCommissionProfile.findByPk(profile.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!currentProfile || currentProfile.userId !== selection.recipientUserId || currentProfile.stripeAccountId !== profile.stripeAccountId || !individualReady(currentProfile, input.paymentMethod, now(), stripe.mode)) throw conflict('The recipient’s individual Stripe account is not verified for this payment method.', 'COMMISSION_PROFILE_NOT_READY');
      const priced = quoteAmount(selection.amountCents, input.paymentMethod, feePolicy);
      if (priced.totalCents !== input.approvedTotalCents) throw conflict('Commission amount changed. Review a fresh quote before approving.', 'COMMISSION_QUOTE_CHANGED');
      const created = await models.CommissionPayment.create({ id: randomUUID(), organizationId, recipientUserId: selection.recipientUserId, individualCommissionProfileId: profile.id,
        stripeAccountId: currentProfile.stripeAccountId, providerMode: stripe.mode, currency: selection.currency, commissionCents: priced.commissionCents,
        feeAllowanceCents: priced.estimatedFeeCents, totalCents: priced.totalCents, feePolicy, statementSnapshot: selection.statements,
        paymentMethod: input.paymentMethod, idempotencyKey: input.idempotencyKey, approvalHash, approvedByUserId: userId, approvedAt, billingEmailSnapshot, status: 'creating' }, { transaction });
      const reserved = await ledger.reserveStatements({ organizationId, recipientUserId: selection.recipientUserId, currency: selection.currency, statementIds: input.statementIds, paymentId: created.id, providerMode: stripe.mode, transaction });
      if ((reserved.amountCents ?? reserved.totalCents) !== priced.commissionCents) throw conflict('Commission reservation changed. Review a fresh quote.', 'COMMISSION_QUOTE_CHANGED');
      if (reserved.statements.some(statement => !selection.statements.some(selected => selected.id === statement.id && selected.amountCents === statement.amountCents))) throw conflict('Itemized commission amounts changed. Review a fresh quote.', 'COMMISSION_QUOTE_CHANGED');
      await audit(created, 'commission_payment.approved', transaction, { feeEstimateBasis: feePolicy.basis, feeEstimateAcknowledged: true, statementIds: input.statementIds });
      return created;
    });
    return reconcile(payment);
  }
  function staleObservation() { return conflict('A newer commission observation superseded this response.', 'COMMISSION_STALE_OBSERVATION'); }
  function observationMatches(current, observation) { return current.reconciliationToken === observation.token && +new Date(current.invalidatedAt || 0) === observation.invalidatedAt; }
  async function bind(payment, values, observation, { negative = false } = {}) {
    return transact(async transaction => { const current = await models.CommissionPayment.findByPk(payment.id, { transaction, lock: transaction.LOCK.UPDATE });
      for (const key of ['providerCustomerId', 'providerInvoiceId', 'providerPaymentIntentId', 'providerChargeId', 'providerBalanceTransactionId']) if (values[key] && current[key] && current[key] !== values[key]) throw conflict('Commission provider reference changed.', 'COMMISSION_VERIFICATION_FAILED');
      // Negative provider proof is monotone. A delayed success or transport
      // error must never resurrect a voided, refunded or disputed payment.
      if (terminal.has(current.status) || !negative && !observationMatches(current, observation)) throw staleObservation();
      await current.update(values, { transaction }); return current;
    });
  }
  async function recoverCreation(payment, observation) {
    const options = { stripeAccount: payment.stripeAccountId };
    const billing = approvedBillingEmailSnapshot(payment);
    const creationReview = async () => ({ payment: await bind(payment, { status: 'review', errorCode: 'COMMISSION_CREATION_REVIEW', reconciliationStatus: 'creation_outcome_unknown', hostedInvoiceUrl: null }, observation), blocked: true });
    function assertCreationPolicy() {
      if (payment.providerMode === 'live' && payment.feePolicy?.basis !== 'estimated_provider_fees') throw conflict('Approved live commission fee evidence is required.', 'COMMISSION_VERIFICATION_FAILED');
    }
    // Never retrofit an email onto old provider idempotency keys. Existing
    // non-draft invoices remain reconcilable without changing their customer.
    if (payment.providerInvoiceId && !payment.providerCustomerId) throw conflict('Commission invoice customer binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
    if (!payment.providerInvoiceId && (!billing || +now() - +new Date(payment.approvedAt) < 0 || +now() - +new Date(payment.approvedAt) >= RECOVERY_WINDOW_MS)) return creationReview();
    if (!payment.providerCustomerId) {
      if (!billing) return creationReview();
      assertCreationPolicy();
      const customer = await stripe.createCommissionCustomer({ name: billing.customerName, email: billing.email, metadata: invoiceMetadata(payment) }, { ...options, idempotencyKey: `commission/${payment.id}/customer` });
      if (customer?.object !== 'customer' || customer.deleted || customer.email !== billing.email || !matchesStripeLivemode(customer, payment.providerMode) || !metadataMatches(customer, payment)) throw conflict('Commission customer could not be verified.', 'COMMISSION_VERIFICATION_FAILED');
      payment = await bind(payment, { providerCustomerId: customer.id }, observation);
    }
    async function verifyBillingCustomer() {
      const customer = await stripe.retrieveCommissionCustomer(payment.providerCustomerId, options);
      if (customer?.id !== payment.providerCustomerId || customer.object !== 'customer' || customer.deleted || customer.email !== billing.email
        || !matchesStripeLivemode(customer, payment.providerMode) || !metadataMatches(customer, payment)) throw conflict('Commission billing customer could not be verified.', 'COMMISSION_VERIFICATION_FAILED');
    }
    if (!payment.providerInvoiceId) {
      assertCreationPolicy();
      await verifyBillingCustomer();
      const invoice = await stripe.createCommissionInvoice({ customer: payment.providerCustomerId, collection_method: 'send_invoice', days_until_due: 30,
        auto_advance: false, pending_invoice_items_behavior: 'exclude', currency: payment.currency.toLowerCase(), discounts: [], automatic_tax: { enabled: false },
        payment_settings: { payment_method_types: [payment.paymentMethod] }, metadata: invoiceMetadata(payment),
        description: 'Business-funded event commissions. Processing and invoicing fee allowance is estimated and reconciled separately.' },
      { ...options, idempotencyKey: `commission/${payment.id}/invoice` });
      if (invoice?.object !== 'invoice' || !matchesStripeLivemode(invoice, payment.providerMode) || !metadataMatches(invoice, payment) || providerId(invoice.customer) !== payment.providerCustomerId) throw conflict('Commission invoice could not be verified.', 'COMMISSION_VERIFICATION_FAILED');
      payment = await bind(payment, { providerInvoiceId: invoice.id }, observation);
    }
    let invoice = await stripe.retrieveCommissionInvoice(payment.providerInvoiceId, options);
    if (invoice?.id !== payment.providerInvoiceId || !matchesStripeLivemode(invoice, payment.providerMode) || !metadataMatches(invoice, payment) || providerId(invoice.customer) !== payment.providerCustomerId) throw conflict('Commission invoice could not be verified.', 'COMMISSION_VERIFICATION_FAILED');
    if (invoice.status === 'draft') {
      if (!billing) return creationReview();
      assertCreationPolicy();
      if (+now() - +new Date(payment.approvedAt) < 0 || +now() - +new Date(payment.approvedAt) >= RECOVERY_WINDOW_MS) return creationReview();
      await verifyBillingCustomer();
      for (const statement of payment.statementSnapshot) await stripe.createCommissionInvoiceItem({ customer: payment.providerCustomerId, invoice: invoice.id, currency: payment.currency.toLowerCase(), amount: statement.amountCents, discountable: false,
        description: `Event commission: ${statement.eventTitle}`, metadata: { ...invoiceMetadata(payment), commissionStatementId: statement.id, eventId: statement.eventId } }, { ...options, idempotencyKey: `commission/${payment.id}/statement/${statement.id}` });
      if (payment.feeAllowanceCents > 0) await stripe.createCommissionInvoiceItem({ customer: payment.providerCustomerId, invoice: invoice.id, currency: payment.currency.toLowerCase(), amount: payment.feeAllowanceCents, discountable: false,
        description: 'Business-funded estimated processing and invoicing fee allowance (subject to reconciliation)', metadata: { ...invoiceMetadata(payment), commissionFeeAllowance: 'true' } }, { ...options, idempotencyKey: `commission/${payment.id}/fee-allowance` });
      invoice = await stripe.finalizeCommissionInvoice(invoice.id, { auto_advance: false }, { ...options, idempotencyKey: `commission/${payment.id}/finalize` });
    }
    // Do not publish an unverified provider URL. Binding and all approved
    // itemized lines are independently checked by reconcile before exposure.
    return { payment, blocked: false };
  }
  async function verifyLines(payment) {
    const count = payment.statementSnapshot.length + (payment.feeAllowanceCents > 0 ? 1 : 0);
    if (count < 1 || count > 101) throw conflict('Commission invoice line items changed.', 'COMMISSION_VERIFICATION_FAILED');
    const lines = []; let cursor;
    // At most 100 approved statements plus one fee allowance: two bounded
    // pages, with no auto-pagination or unbounded provider requests.
    for (let page = 0; page < 2; page += 1) {
      const result = await stripe.listCommissionInvoiceLines(payment.providerInvoiceId, { stripeAccount: payment.stripeAccountId }, { startingAfter: cursor });
      if (!Array.isArray(result.data) || result.data.length > 100 || lines.length + result.data.length > count) throw conflict('Commission invoice line items changed.', 'COMMISSION_VERIFICATION_FAILED');
      lines.push(...result.data);
      if (!result.has_more) break;
      cursor = result.data.at(-1)?.id;
      if (!cursor || page === 1 || lines.length >= count) throw conflict('Commission invoice line items changed.', 'COMMISSION_VERIFICATION_FAILED');
    }
    if (lines.length !== count || new Set(lines.filter(line => line.id).map(line => line.id)).size !== lines.filter(line => line.id).length) throw conflict('Commission invoice line items changed.', 'COMMISSION_VERIFICATION_FAILED');
    const expected = [...payment.statementSnapshot.map(s => ({ id: s.id, eventId: s.eventId, amount: s.amountCents })), ...(payment.feeAllowanceCents > 0 ? [{ id: 'fee', amount: payment.feeAllowanceCents }] : [])];
    for (const line of lines) {
      const id = line.metadata?.commissionFeeAllowance === 'true' ? 'fee' : line.metadata?.commissionStatementId;
      const index = expected.findIndex(e => e.id === id && e.amount === line.amount && (e.id === 'fee' || line.metadata?.eventId === e.eventId));
      if (index < 0 || !matchesStripeLivemode(line, payment.providerMode) || !metadataMatches(line, payment) || !sameCurrency(line.currency, payment.currency) || (line.discount_amounts?.length || line.tax_amounts?.length || line.taxes?.length || line.pretax_credit_amounts?.length)) throw conflict('Commission invoice line items changed.', 'COMMISSION_VERIFICATION_FAILED');
      expected.splice(index, 1);
    }
  }
  async function readEvidence(payment) {
    const options = { stripeAccount: payment.stripeAccountId };
      const invoice = await stripe.retrieveCommissionInvoice(payment.providerInvoiceId, options);
      if (!verifyInvoiceBinding(invoice, payment)) throw conflict('Commission invoice binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
      const customer = await stripe.retrieveCommissionCustomer(payment.providerCustomerId, options);
      if (customer?.id !== payment.providerCustomerId || customer.deleted || !matchesStripeLivemode(customer, payment.providerMode) || !metadataMatches(customer, payment)) throw conflict('Commission customer binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
      await verifyLines(payment);
      const payments = await stripe.listCommissionInvoicePayments(invoice.id, options);
      if (payments.has_more || !Array.isArray(payments.data)) throw conflict('Commission payment evidence needs review.', 'COMMISSION_VERIFICATION_FAILED');
      const entries = payments.data;
      if (entries.some(e => !matchesStripeLivemode(e, payment.providerMode) || providerId(e.invoice) !== invoice.id || !sameCurrency(e.currency, payment.currency) || e.amount_requested !== payment.totalCents || e.payment?.type !== 'payment_intent')) throw conflict('Commission payment evidence needs review.', 'COMMISSION_VERIFICATION_FAILED');
      if (entries.length > 1) throw conflict('Commission invoice contains multiple payment attempts requiring review.', 'COMMISSION_VERIFICATION_FAILED');
      let intent, charge;
      const intentId = entries[0] ? providerId(entries[0].payment.payment_intent) : payment.providerPaymentIntentId;
      if (payment.providerPaymentIntentId && intentId !== payment.providerPaymentIntentId) throw conflict('Commission payment intent reference changed.', 'COMMISSION_VERIFICATION_FAILED');
      if (intentId) {
        intent = await stripe.retrieveCommissionPaymentIntent(intentId, options);
        if (intent?.id !== intentId) throw conflict('Commission payment intent reference changed.', 'COMMISSION_VERIFICATION_FAILED');
        if (!matchesStripeLivemode(intent, payment.providerMode) || intent.amount !== payment.totalCents || !sameCurrency(intent.currency, payment.currency) || providerId(intent.customer) !== payment.providerCustomerId) throw conflict('Commission payment intent binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
        if (providerId(intent.latest_charge)) {
          charge = await stripe.retrieveCharge(providerId(intent.latest_charge), options);
          if (charge?.id !== providerId(intent.latest_charge) || !matchesStripeLivemode(charge, payment.providerMode) || charge.amount !== payment.totalCents || !sameCurrency(charge.currency, payment.currency) || providerId(charge.payment_intent) !== intent.id || providerId(charge.customer) !== payment.providerCustomerId) throw conflict('Commission charge binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
        }
        if (payment.providerChargeId && charge?.id !== payment.providerChargeId) throw conflict('Previously bound commission charge is unavailable.', 'COMMISSION_VERIFICATION_FAILED');
      }
    return { invoice, entries, intent, charge };
  }
  async function reconcile(input) {
    enabled(); const id = typeof input === 'string' ? input : input.id;
    const token = randomUUID();
    let payment = await transact(async transaction => {
      const current = await models.CommissionPayment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!current) throw notFound('Commission payment');
      if (current.providerMode !== stripe.mode || !current.approvedByUserId || !current.approvedAt || !current.stripeAccountId) throw conflict('Commission payment binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
      await ledger.assertStatementMode({ statementIds: current.statementSnapshot.map(s => s.id), providerMode: current.providerMode, transaction });
      if (!terminal.has(current.status)) await current.update({ reconciliationToken: token }, { transaction });
      return current;
    });
    if (terminal.has(payment.status)) return safePayment(payment);
    const observation = { token, invalidatedAt: +new Date(payment.invalidatedAt || 0) };
    const options = { stripeAccount: payment.stripeAccountId };
    try {
      const creation = await recoverCreation(payment, observation);
      payment = creation.payment;
      if (creation.blocked || !payment.providerInvoiceId) return safePayment(payment);
      // Refund/dispute invalidation cannot change immutable approved terms.
      // Cancel the original provider invoice, then retrieve the outcome anew.
      // A lost void response, ACH processing or funds already received keeps
      // reservations until independently proved canceled or paid.
      if (payment.invalidatedAt) {
        const currentInvoice = await stripe.retrieveCommissionInvoice(payment.providerInvoiceId, options);
        // Cancel only our durably bound invoice/customer/account. An edited
        // unpaid invoice must not evade cancellation through failed amounts or
        // lines verification. Release still requires the full original proof.
        if (currentInvoice?.id !== payment.providerInvoiceId || currentInvoice.object !== 'invoice' || !matchesStripeLivemode(currentInvoice, payment.providerMode) || providerId(currentInvoice.customer) !== payment.providerCustomerId || !metadataMatches(currentInvoice, payment)) throw conflict('Commission invoice binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
        if (['open', 'uncollectible'].includes(currentInvoice.status)) {
          try { await stripe.voidCommissionInvoice(payment.providerInvoiceId, { ...options, idempotencyKey: `commission/${payment.id}/invalidate-void` }); } catch (_error) { /* Retrieve authoritative outcome, including a lost response. */ }
        }
      }
      const evidence = await readEvidence(payment);
      const { invoice, entries, intent, charge } = evidence;
      let balance;
      // Failure and reversals are negative provider evidence. They never make
      // another approval automatically debit the business payment method.
      if (charge?.disputed === true || charge?.refunded === true || charge?.amount_refunded > 0) {
        payment = await bind(payment, { status: charge.disputed ? 'disputed' : 'reversed', providerVerificationStatus: 'review', reconciliationStatus: charge.disputed ? 'chargeback_review' : 'payment_reversed', errorCode: charge.disputed ? 'COMMISSION_DISPUTED' : 'COMMISSION_REVERSED', providerPaymentIntentId: intent.id, providerChargeId: charge.id, hostedInvoiceUrl: null }, observation, { negative: true });
        return safePayment(payment);
      }
      if (invoice.status === 'void' && invoice.amount_paid === 0 && entries.every(e => e.status === 'canceled') && (!intent || intent.status === 'canceled') && (!charge || charge.paid === false && charge.captured === false)) {
        return transact(async transaction => { const locked = await models.CommissionPayment.findByPk(payment.id, { transaction, lock: transaction.LOCK.UPDATE });
          if (terminal.has(locked.status) || !observationMatches(locked, observation)) return safePayment(locked);
          if (!locked.releasedAt) { await ledger.finishPayment({ paymentId: payment.id, paid: false, transaction }); await locked.update({ status: 'failed', releasedAt: now(), providerVerificationStatus: 'verified', reconciliationStatus: 'provider_confirmed_unpaid', errorCode: payment.invalidatedAt ? 'COMMISSION_REQUOTE_REQUIRED' : 'COMMISSION_INVOICE_VOID', reconciledAt: now(), hostedInvoiceUrl: null }, { transaction }); await audit(locked, 'commission_payment.reservation_released', transaction); }
          return safePayment(locked);
        });
      }
      if (invoice.status !== 'paid') {
        if (charge?.paid === true && charge?.captured === true || payment.providerBalanceTransactionId) throw conflict('Received commission funds no longer match invoice payment state.', 'COMMISSION_VERIFICATION_FAILED');
        const processing = intent?.status === 'processing';
        const failed = intent?.status === 'requires_payment_method' && intent.last_payment_error;
        const hostedInvoiceUrl = invoice.hosted_invoice_url;
        if (hostedInvoiceUrl && !/^https:\/\/invoice\.stripe\.com\//.test(hostedInvoiceUrl)) throw conflict('Commission invoice link could not be verified.', 'COMMISSION_VERIFICATION_FAILED');
        // Finalization freezes the billing identity independently of later
        // Customer changes. Check it before offering an unpaid payment link,
        // never instead of reconciling received funds, voids or legacy invoices.
        const billing = approvedBillingEmailSnapshot(payment);
        if (hostedInvoiceUrl && !payment.invalidatedAt && !processing && billing && invoice.customer_email !== billing.email) {
          throw conflict('Commission invoice billing identity needs review.', 'COMMISSION_VERIFICATION_FAILED');
        }
        payment = await bind(payment, { status: processing ? 'processing' : failed ? 'payment_failed' : 'awaiting_payment', providerVerificationStatus: 'verified',
          verifiedObservationToken: observation.token,
          hostedInvoiceUrl: payment.invalidatedAt || processing ? null : hostedInvoiceUrl || null,
          reconciliationStatus: payment.invalidatedAt ? 'refund_invalidation_pending' : processing ? 'bank_processing' : failed ? 'provider_payment_failed' : 'awaiting_payment',
          errorCode: payment.invalidatedAt ? 'COMMISSION_INVALIDATION_PENDING' : failed ? 'COMMISSION_PAYMENT_FAILED' : null,
          ...(intent ? { providerPaymentIntentId: intent.id } : {}), ...(charge?.paid && charge?.captured ? { providerChargeId: charge.id } : {}), reconciledAt: now() }, observation);
        return safePayment(payment);
      }
      if (invoice.amount_paid !== payment.totalCents || invoice.amount_remaining !== 0 || entries.length !== 1 || entries[0].is_default !== true || entries[0].status !== 'paid' || entries[0].amount_paid !== payment.totalCents || !charge) throw conflict('Invoice marked paid without a verified Stripe charge.', 'COMMISSION_VERIFICATION_FAILED');
      if (providerId(charge.balance_transaction)) balance = await stripe.retrieveCommissionBalanceTransaction(providerId(charge.balance_transaction), options);
      if (!verifyCommissionCharge(payment, intent, charge, balance)) throw conflict('Commission charge binding needs review.', 'COMMISSION_VERIFICATION_FAILED');
      // Stripe may bill Invoicing separately. A charge BalanceTransaction is
      // proof of processing fees only, never proof that all invoice fees exist.
      // Only a server-owned, independently retrieved attribution may close net.
      const feeEvidence = !payment.feeReview && invoicingFeeEvidence && await invoicingFeeEvidence({ payment, invoice, charge, balance, stripeAccountId: payment.stripeAccountId });
      const invoiceFeeKnown = feeEvidence?.verified === true && feeEvidence.invoiceId === invoice.id && feeEvidence.stripeAccountId === payment.stripeAccountId && sameCurrency(feeEvidence.currency, payment.currency) && Number.isInteger(feeEvidence.amountCents) && feeEvidence.amountCents >= 0;
      const invoiceFee = payment.feeReview ? payment.feeReview.invoicingFeeCents : invoiceFeeKnown ? feeEvidence.amountCents : null;
      const feeEvidenceType = payment.feeReview ? 'merchant_reviewed' : invoiceFeeKnown ? 'provider_verified' : null;
      const net = invoiceFee !== null ? balance.net - invoiceFee : null;
      return transact(async transaction => { const locked = await models.CommissionPayment.findByPk(payment.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (terminal.has(locked.status) || !observationMatches(locked, observation)) return safePayment(locked);
        if (locked.providerChargeId && locked.providerChargeId !== charge.id) throw conflict('Commission charge reference changed.', 'COMMISSION_VERIFICATION_FAILED');
        if (locked.allocationsSettledAt && (locked.invoicingFeeCents !== invoiceFee || locked.providerFeeCents !== balance.fee || locked.providerNetCents !== balance.net)) throw conflict('Settled commission fee evidence changed.', 'COMMISSION_VERIFICATION_FAILED');
        const resolution = net !== null && !locked.allocationsSettledAt ? await ledger.finishPayment({ paymentId: payment.id, paid: true, settledAmountCents: Math.min(payment.commissionCents, Math.max(0, net)), transaction }) : null;
        const residualCents = net === null ? null : locked.allocationsSettledAt ? locked.residualCents : resolution?.remainingCommissionCents ?? Math.max(0, payment.commissionCents - net);
        const settled = residualCents === 0;
        await locked.update({ status: settled ? 'paid' : 'paid_fee_review', providerVerificationStatus: 'verified', providerPaymentIntentId: intent.id, providerChargeId: charge.id,
          verifiedObservationToken: observation.token,
          providerBalanceTransactionId: balance.id, providerFeeCents: balance.fee, providerNetCents: balance.net, invoicingFeeCents: invoiceFee, feeEvidence: feeEvidenceType,
          ...(net !== null && !locked.allocationsSettledAt ? { allocationsSettledAt: now() } : {}),
          residualCents, reconciliationStatus: settled ? feeEvidenceType === 'merchant_reviewed' ? 'net_settled_merchant_reviewed' : net < payment.commissionCents ? 'net_settled_after_adjustment' : 'net_settled' : net === null ? 'invoicing_fee_unknown' : 'net_shortfall',
          errorCode: settled ? null : net === null ? 'COMMISSION_INVOICING_FEE_REVIEW' : 'COMMISSION_NET_SHORTFALL', reconciledAt: now(), hostedInvoiceUrl: null }, { transaction });
        if (locked.status !== payment.status) await audit(locked, settled ? 'commission_payment.net_verified' : 'commission_payment.funds_received_fee_review', transaction, { providerChargeId: charge.id, processingFeeCents: balance.fee, invoicingFeeCents: invoiceFee });
        return safePayment(locked);
      });
    } catch (error) {
      if (error.code === 'COMMISSION_STALE_OBSERVATION') return safePayment(await models.CommissionPayment.findByPk(id));
      const code = error.code === 'COMMISSION_VERIFICATION_FAILED' ? error.code : 'COMMISSION_RECONCILIATION_PENDING';
      if (code === 'COMMISSION_VERIFICATION_FAILED') {
        try { payment = await bind(payment, { status: 'review', providerVerificationStatus: 'review', errorCode: code, reconciliationStatus: 'provider_evidence_review', hostedInvoiceUrl: null }, observation); }
        catch (bindError) { if (bindError.code !== 'COMMISSION_STALE_OBSERVATION') throw bindError; return safePayment(await models.CommissionPayment.findByPk(id)); }
      }
      payment = await models.CommissionPayment.findByPk(id);
      if (terminal.has(payment.status) || !observationMatches(payment, observation)) return safePayment(payment);
      return { ...safePayment(payment), retryable: code === 'COMMISSION_RECONCILIATION_PENDING', errorCode: code };
    }
  }
  async function reviewInvoicingFee(userId, organizationId, id, body) {
    enabled(); const input = commissionFeeReviewInput.parse(body);
    const reviewHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    await assertFinanceAccess(models, userId, organizationId);
    let payment = await models.CommissionPayment.findOne({ where: { id, organizationId } });
    if (!payment) throw notFound('Commission payment');
    function existingReview(current) {
      if (!current.feeReview) return null;
      if (current.feeReview.idempotencyKey !== input.idempotencyKey || current.feeReview.reviewHash !== reviewHash) throw conflict('This invoice already has an immutable fee review.', 'COMMISSION_FEE_REVIEW_CONFLICT');
      return safePayment(current);
    }
    if (payment.feeReview) return existingReview(payment);
    // Approval of a merchant attestation never substitutes for independent
    // verification of the original invoice payment, charge and processing fee.
    const refreshed = await reconcile(payment);
    if (refreshed.retryable || !refreshed.fundsReceived || refreshed.providerVerificationStatus !== 'verified') throw conflict('Fresh independently verified commission funds are required before fee review.', 'COMMISSION_FEE_REVIEW_NOT_READY');
    payment = await models.CommissionPayment.findByPk(id);
    const observationToken = payment.reconciliationToken;
    return transact(async transaction => {
      await assertFinanceAccess(models, userId, organizationId, transaction);
      const current = await models.CommissionPayment.findOne({ where: { id, organizationId }, transaction, lock: transaction.LOCK.UPDATE });
      if (current.feeReview) return existingReview(current);
      if (current.reconciliationToken !== observationToken || current.verifiedObservationToken !== current.reconciliationToken || current.status !== 'paid_fee_review' || current.providerVerificationStatus !== 'verified' || !current.providerChargeId || !current.providerBalanceTransactionId || current.providerFeeCents == null || current.providerNetCents == null || current.feeEvidence || current.allocationsSettledAt) throw conflict('Independently verified commission funds are required before fee review.', 'COMMISSION_FEE_REVIEW_NOT_READY');
      if (input.invoicingFeeCents > current.providerNetCents) throw conflict('Invoicing fees exceed verified charge net; this requires a separate finance review.', 'COMMISSION_NEGATIVE_NET_REVIEW');
      const net = current.providerNetCents - input.invoicingFeeCents;
      const reviewedAt = now();
      const feeReview = { ...input, reviewHash, reviewedAt: reviewedAt.toISOString(), reviewedByUserId: userId, providerChargeId: current.providerChargeId, providerBalanceTransactionId: current.providerBalanceTransactionId, processingFeeCents: current.providerFeeCents, verifiedChargeNetCents: current.providerNetCents };
      const resolution = await ledger.finishPayment({ paymentId: current.id, paid: true, settledAmountCents: Math.min(current.commissionCents, net), transaction });
      const residualCents = resolution?.remainingCommissionCents ?? Math.max(0, current.commissionCents - net);
      await current.update({ feeReview, feeEvidence: 'merchant_reviewed', invoicingFeeCents: input.invoicingFeeCents, residualCents, allocationsSettledAt: reviewedAt,
        status: residualCents ? 'paid_fee_review' : 'paid', reconciliationStatus: residualCents ? 'net_shortfall' : 'net_settled_merchant_reviewed', errorCode: residualCents ? 'COMMISSION_NET_SHORTFALL' : null, hostedInvoiceUrl: null, reconciliationToken: randomUUID() }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'CommissionPayment', entityId: id, action: 'commission_payment.invoicing_fee_merchant_reviewed',
        after: { ...feeReview, feeEvidence: 'merchant_reviewed', creditedCommissionCents: Math.min(current.commissionCents, net), residualCents, status: current.status } }, { transaction });
      return safePayment(current);
    });
  }
  async function get(userId, organizationId, id, { synchronize = false } = {}) { await assertFinanceAccess(models, userId, organizationId); const payment = await models.CommissionPayment.findOne({ where: { id, organizationId } }); if (!payment) throw notFound('Commission payment'); return synchronize ? reconcile(payment) : safePayment(payment); }
  async function sweepPendingCommissions({ limit = 25 } = {}) {
    enabled(); const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 25;
    const payments = await models.CommissionPayment.findAll({ where: { providerMode: stripe.mode, [Op.or]: [{ status: { [Op.in]: ['creating', 'awaiting_payment', 'processing', 'payment_failed', 'paid_fee_review'] } }, { status: 'review', invalidatedAt: { [Op.ne]: null } }] }, order: [['updatedAt', 'ASC'], ['id', 'ASC']], limit: boundedLimit });
    const results = []; for (const payment of payments) { results.push(await reconcile(payment)); await models.CommissionPayment.update({ updatedAt: now() }, { where: { id: payment.id } }); } return results;
  }
  async function reconcileCommissionEvent(event, profile) {
    if (!matchesStripeLivemode(event, stripe?.mode) || event.account !== profile.stripeAccountId || profile.providerMode !== stripe?.mode) throw conflict('Commission event environment does not match.', 'COMMISSION_VERIFICATION_FAILED');
    enabled(); const options = { stripeAccount: profile.stripeAccountId };
    let reference = event.data?.object?.id, payment;
    if (event.type.startsWith('invoice.')) {
      const invoice = await stripe.retrieveCommissionInvoice(reference, options);
      if (invoice?.id !== reference || !matchesStripeLivemode(invoice, stripe.mode)) throw conflict('Commission invoice event binding failed.', 'COMMISSION_VERIFICATION_FAILED');
      payment = await models.CommissionPayment.findOne({ where: { id: invoice.metadata?.commissionPaymentId || '00000000-0000-0000-0000-000000000000', stripeAccountId: profile.stripeAccountId, providerMode: stripe.mode } });
      if (!payment) return { ignored: true };
      // Recover our original idempotency key, never attach metadata lookalikes.
      if (!payment.providerInvoiceId) await reconcile(payment);
      payment = await models.CommissionPayment.findByPk(payment.id);
      if (payment.providerInvoiceId !== reference) throw conflict('Commission invoice event is not the approved invoice.', 'COMMISSION_VERIFICATION_FAILED');
    } else if (event.type.startsWith('payment_intent.')) {
      const intent = await stripe.retrieveCommissionPaymentIntent(reference, options);
      if (intent?.id !== reference || !matchesStripeLivemode(intent, stripe.mode)) throw conflict('Commission payment event binding failed.', 'COMMISSION_VERIFICATION_FAILED');
      payment = await models.CommissionPayment.findOne({ where: { providerCustomerId: providerId(intent.customer) || '', stripeAccountId: profile.stripeAccountId, providerMode: stripe.mode } });
      if (payment && (intent.amount !== payment.totalCents || !sameCurrency(intent.currency, payment.currency))) throw conflict('Commission payment event amount changed.', 'COMMISSION_VERIFICATION_FAILED');
    }
    else {
      if (event.type.startsWith('charge.dispute.')) { const dispute = await stripe.retrieveCommissionDispute(reference, options); if (dispute?.id !== reference || !matchesStripeLivemode(dispute, stripe.mode)) throw conflict('Commission dispute event binding failed.', 'COMMISSION_VERIFICATION_FAILED'); reference = providerId(dispute.charge); }
      if (event.type.startsWith('refund.')) { const refund = await stripe.retrieveRefund(reference, options); if (refund?.id !== reference || Object.hasOwn(refund, 'livemode') && !matchesStripeLivemode(refund, stripe.mode)) throw conflict('Commission refund event binding failed.', 'COMMISSION_VERIFICATION_FAILED'); reference = providerId(refund.charge); }
      const charge = await stripe.retrieveCharge(reference, options);
      if (charge?.id !== reference || !matchesStripeLivemode(charge, stripe.mode)) throw conflict('Commission charge event binding failed.', 'COMMISSION_VERIFICATION_FAILED');
      payment = await models.CommissionPayment.findOne({ where: { providerCustomerId: providerId(charge.customer) || '', stripeAccountId: profile.stripeAccountId, providerMode: stripe.mode } });
      if (payment && (charge.amount !== payment.totalCents || !sameCurrency(charge.currency, payment.currency))) throw conflict('Commission charge event amount changed.', 'COMMISSION_VERIFICATION_FAILED');
    }
    if (!payment) return { ignored: true }; return reconcile(payment);
  }
  return { list, ownStatements, approveStatement, quote, approve, get, reconcile, reviewInvoicingFee, sweepPendingCommissions, reconcileCommissionEvent };
}
module.exports = { createCommissionPaymentService, quoteAmount, safePayment, verifyInvoiceBinding, verifyCommissionCharge, SANDBOX_FEE_POLICY, LIVE_FEE_POLICY };
