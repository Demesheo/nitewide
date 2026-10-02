const { QueryTypes, Op } = require('sequelize');
const { conflict, notFound, forbidden } = require('../domain/errors');
const { assertActiveUser } = require('./lifecycle-service');
const { mutationTransaction } = require('./mutation-transaction');
const { commissionEligibility } = require('../domain/commission-eligibility');
const { commissionProfileInput, commissionOnboardingInput } = require('../http/commission-payment-schemas');

function individualAccountMatches(account, accountId) {
  const responsibilities = account?.defaults?.responsibilities;
  const applied = account?.configuration?.merchant?.applied;
  const timestampApplied = typeof applied === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(applied) && Number.isFinite(Date.parse(applied));
  return Boolean(account?.id === accountId && account.object === 'v2.core.account' && account.livemode === false && !account.closed
    && account.identity?.entity_type === 'individual' && account.dashboard === 'full'
    && responsibilities?.fees_collector === 'stripe' && responsibilities?.losses_collector === 'stripe' && responsibilities?.requirements_collector === 'stripe'
    && account.applied_configurations?.includes('merchant') && (applied === true || timestampApplied));
}
function individualReady(profile, rail = 'card', at = new Date()) {
  if (profile?.disconnectStatus && profile.disconnectStatus !== 'none') return false;
  if (!commissionEligibility({ userId: profile?.userId, individualProfile: profile, now: at }).eligible) return false;
  if (!individualAccountMatches(profile.verifiedStripeAccount, profile.stripeAccountId)) return false;
  return rail === 'card' || rail === 'us_bank_account' && profile.verifiedStripeAccount.configuration.merchant.capabilities?.ach_debit_payments?.status === 'active';
}
function safeIndividualProfile(profile, at = new Date()) {
  if (!profile) return { status: 'not_connected', providerMode: 'test', eligibility: commissionEligibility(), cardReady: false, bankReady: false, disconnectAvailable: false };
  return { id: profile.id, userId: profile.userId, displayName: profile.name, creationRequestId: profile.creationRequestId, status: profile.status,
    providerMode: profile.providerMode, stripeAccountId: profile.stripeAccountId, verifiedAt: profile.verifiedAt,
    paymentsDisabledAt: profile.paymentsDisabledAt || null, deauthorizedAt: profile.deauthorizedAt || null, disconnectStatus: profile.disconnectStatus || 'none',
    eligibility: commissionEligibility({ userId: profile.userId, individualProfile: profile, now: at }),
    cardReady: individualReady(profile, 'card', at), bankReady: individualReady(profile, 'us_bank_account', at) };
}
function createIndividualCommissionProfileService({ sequelize, models, stripe, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/app', now = () => new Date() }) {
  const transact = work => mutationTransaction(sequelize, work, { accessChange: true });
  const enabled = () => { if (stripe?.mode !== 'test') throw conflict('Individual Stripe sandbox connection is unavailable.', 'PAYMENTS_NOT_ENABLED'); };
  async function own(userId, transaction, required = true) {
    assertActiveUser(await models.User.findByPk(userId, { transaction }));
    const profile = await models.IndividualCommissionProfile.findOne({ where: { userId }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!profile && required) throw notFound('Individual commission profile');
    return profile;
  }
  const audit = (profile, actorUserId, action, transaction, after = {}) => models.AuditLog.create({ actorUserId, entityType: 'IndividualCommissionProfile', entityId: profile.id, action, after }, { transaction });
  async function canAccess(userId, transaction, profile) {
    if (profile || await models.CommissionEarning.count({ where: { recipientUserId: userId }, transaction })) return true;
    try { await require('./business-access-policy').assertBusinessAccess(models, userId, transaction); return true; }
    catch (error) { if (error.code === 'BUSINESS_ACCESS_REQUIRED') return false; throw error; }
  }
  async function get(userId) { const profile = await own(userId, undefined, false); return { ...safeIndividualProfile(profile, now()), canAccessCommissions: await canAccess(userId, undefined, profile), disconnectAvailable: Boolean(stripe?.disconnectEnabled && profile?.stripeAccountId && !profile?.deauthorizedAt) }; }
  async function create(userId, body) {
    enabled(); const input = commissionProfileInput.parse(body);
    let profile = await transact(async transaction => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', { replacements: { key: `individual-commission/${userId}` }, transaction, type: QueryTypes.SELECT });
      const existing = await own(userId, transaction, false);
      if (existing) {
        if (existing.creationRequestId !== input.idempotencyKey || existing.name !== input.displayName) throw conflict('An individual Stripe connection already exists. Refresh its status.', 'COMMISSION_PROFILE_EXISTS');
        if (existing.deauthorizedAt) throw conflict('This individual connection was disconnected.', 'COMMISSION_PROFILE_DISCONNECTED');
        return existing;
      }
      if (!await canAccess(userId, transaction)) throw forbidden('Business or historical commission access is required to connect an individual account.');
      const saved = await models.IndividualCommissionProfile.create({ userId, name: input.displayName, creationRequestId: input.idempotencyKey, provider: 'stripe', providerMode: 'test', status: 'inactive' }, { transaction });
      await audit(saved, userId, 'commission_profile.created', transaction, { providerMode: 'test' }); return saved;
    });
    if (!profile.stripeAccountId) {
      if (+now() - +new Date(profile.createdAt) >= 23 * 3600000) throw conflict('Account creation outcome needs review before another account can be created.', 'COMMISSION_PROFILE_CREATION_REVIEW');
      const remote = await stripe.createAccount({ display_name: profile.name, dashboard: 'full', identity: { country: 'us', entity_type: 'individual' },
        configuration: { merchant: { capabilities: { card_payments: { requested: true }, ach_debit_payments: { requested: true } } } },
        defaults: { currency: 'usd', responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
        metadata: { nitewide_individual_commission_profile_id: profile.id }, include: ['configuration.merchant', 'defaults', 'requirements', 'identity'] },
      { idempotencyKey: `individual-commission-account/${profile.id}` });
      if (!individualAccountMatches(remote, remote?.id) || remote.metadata?.nitewide_individual_commission_profile_id !== profile.id) throw conflict('Individual Stripe account binding needs review.', 'COMMISSION_PROFILE_VERIFICATION_FAILED');
      profile = await transact(async transaction => {
        const current = await own(userId, transaction);
        if (current.stripeAccountId && current.stripeAccountId !== remote.id || current.deauthorizedAt) throw conflict('Individual Stripe account binding changed.', 'COMMISSION_PROFILE_VERIFICATION_FAILED');
        if (await models.PaymentAccount.count({ where: { stripeAccountId: remote.id }, transaction })) throw conflict('Business accounts cannot serve as individual commission accounts.', 'COMMISSION_PROFILE_VERIFICATION_FAILED');
        if (!current.stripeAccountId) await current.update({ stripeAccountId: remote.id }, { transaction });
        return current;
      });
    }
    return get(userId);
  }
  async function synchronizeTrusted(stripeAccountId) {
    enabled(); const profile = await models.IndividualCommissionProfile.findOne({ where: { stripeAccountId, providerMode: 'test' } });
    if (!profile || profile.deauthorizedAt || profile.lifecycleState !== 'active') throw notFound('Individual commission profile');
    const observedAt = now(); const remote = await stripe.retrieveIndividualAccount(stripeAccountId);
    return transact(async transaction => {
      const current = await own(profile.userId, transaction);
      if (current.stripeAccountId !== stripeAccountId || current.deauthorizedAt) throw conflict('Individual Stripe connection changed.', 'COMMISSION_PROFILE_DISCONNECTED');
      // A delayed positive observation cannot overwrite a later restriction.
      if (current.verifiedAt && +new Date(current.verifiedAt) > +observedAt) return current;
      if (current.verifiedAt && +new Date(current.verifiedAt) === +observedAt
        && commissionEligibility({ userId: current.userId, individualProfile: { ...(current.toJSON ? current.toJSON() : current), verifiedStripeAccount: remote, verifiedAt: observedAt }, now: observedAt }).eligible) return current;
      const matches = individualAccountMatches(remote, stripeAccountId);
      await current.update({ verifiedStripeAccount: remote, verifiedAt: observedAt, status: matches && !current.paymentsDisabledAt ? 'active' : 'inactive',
        ...(remote.closed === true ? { deauthorizedAt: now(), paymentsDisabledAt: current.paymentsDisabledAt || now() } : {}) }, { transaction });
      return current;
    });
  }
  async function synchronize(userId) { const profile = await own(userId); await synchronizeTrusted(profile.stripeAccountId); return get(userId); }
  async function onboarding(userId, body = {}) {
    const input = commissionOnboardingInput.parse(body);
    enabled(); const profile = await own(userId);
    if (!profile.stripeAccountId || profile.deauthorizedAt || profile.disconnectStatus && profile.disconnectStatus !== 'none') throw conflict('Create an individual Stripe connection first.', 'COMMISSION_PROFILE_NOT_READY');
    const destination = input.returnTo === 'business' ? new URL(businessAppUrl) : new URL('/', customerAppUrl);
    if (input.returnTo === 'business') { destination.searchParams.set('section', 'payments'); destination.searchParams.set('paymentView', 'commissions'); }
    destination.searchParams.set('commissionProfileReturn', profile.id);
    const link = await stripe.createAccountLink({ account: profile.stripeAccountId, use_case: { type: 'account_onboarding', account_onboarding: { configurations: ['merchant'], return_url: destination.toString(), refresh_url: destination.toString() } } });
    const current = await own(userId);
    if (current.deauthorizedAt || current.stripeAccountId !== profile.stripeAccountId || link.livemode !== false || link.account !== profile.stripeAccountId || link.object !== 'v2.core.account_link' || !/^https:\/\//.test(link.url || '')) throw conflict('Individual onboarding link could not be verified.', 'COMMISSION_PROFILE_VERIFICATION_FAILED');
    return { url: link.url, expiresAt: new Date(link.expires_at).toISOString() };
  }
  async function disable(userId) { await transact(async transaction => { const profile = await own(userId, transaction); await profile.update({ paymentsDisabledAt: profile.paymentsDisabledAt || now(), status: 'inactive' }, { transaction }); await audit(profile, userId, 'commission_profile.disabled', transaction); }); return get(userId); }
  async function resume(userId) { const existing = await own(userId); await synchronizeTrusted(existing.stripeAccountId); await transact(async transaction => { const profile = await own(userId, transaction); if (profile.deauthorizedAt || profile.disconnectStatus && profile.disconnectStatus !== 'none' || !individualAccountMatches(profile.verifiedStripeAccount, profile.stripeAccountId)) throw conflict('Refresh individual Stripe verification first.', 'COMMISSION_PROFILE_NOT_READY'); await profile.update({ paymentsDisabledAt: null, status: 'active' }, { transaction }); await audit(profile, userId, 'commission_profile.resumed', transaction); }); return get(userId); }
  async function deauthorizeTrusted(stripeAccountId) { await transact(async transaction => { const profile = await models.IndividualCommissionProfile.findOne({ where: { stripeAccountId, providerMode: 'test' }, transaction, lock: transaction.LOCK.UPDATE }); if (!profile) return; await profile.update({ deauthorizedAt: profile.deauthorizedAt || now(), paymentsDisabledAt: profile.paymentsDisabledAt || now(), status: 'inactive', disconnectStatus: 'disconnected' }, { transaction }); await audit(profile, null, 'commission_profile.deauthorized', transaction); }); }
  async function disconnect(userId) {
    await disable(userId);
    if (!stripe?.disconnectEnabled) throw conflict('Stripe disconnection is unavailable. New payments are disabled.', 'DISCONNECT_NOT_CONFIGURED');
    const profile = await transact(async transaction => {
      const current = await own(userId, transaction);
      if (current.deauthorizedAt) return current;
      const unresolved = await models.CommissionPayment.count({ where: { individualCommissionProfileId: current.id, status: { [Op.notIn]: ['paid', 'failed', 'reversed'] } }, transaction });
      if (unresolved) throw conflict('Resolve pending commission payments before disconnecting. New payments are disabled.', 'COMMISSION_DISCONNECT_OBLIGATIONS');
      await current.update({ disconnectStatus: 'pending', disconnectRequestId: current.disconnectRequestId || require('node:crypto').randomUUID() }, { transaction });
      await audit(current, userId, 'commission_profile.disconnect_requested', transaction); return current;
    });
    if (profile.deauthorizedAt) return get(userId);
    const acknowledgment = await stripe.disconnectAccount(profile.stripeAccountId);
    if (acknowledgment?.disconnected !== true) throw conflict('Stripe disconnection outcome needs review.', 'DISCONNECT_PENDING');
    await deauthorizeTrusted(profile.stripeAccountId); return get(userId);
  }
  async function dashboard(userId) { const profile = await own(userId); await synchronizeTrusted(profile.stripeAccountId); const current = await own(userId); if (!individualAccountMatches(current.verifiedStripeAccount, current.stripeAccountId)) throw conflict('Verify your individual Stripe connection first.', 'COMMISSION_PROFILE_NOT_READY'); return { url: `https://dashboard.stripe.com/${encodeURIComponent(current.stripeAccountId)}/test/dashboard` }; }
  return { get, create, synchronize, synchronizeTrusted, onboarding, disable, resume, disconnect, dashboard, deauthorizeTrusted };
}
module.exports = { createIndividualCommissionProfileService, individualAccountMatches, individualReady, safeIndividualProfile };
