const { z } = require('zod');
const { Op } = require('sequelize');
const { forbidden, conflict, notFound } = require('../domain/errors');
const { activeUser, assertActiveOrganization } = require('./lifecycle-service');
const { mutationTransaction } = require('./mutation-transaction');
const { eventFinished } = require('../domain/event-policy');
const { unsettledMerchantWhere } = require('../domain/payment-merchant-policy');
const RESPONSIBILITIES = Object.freeze({ fees_collector: 'stripe', losses_collector: 'stripe' });
const profileInput = z.object({ name: z.string().trim().min(1).max(160), idempotencyKey: z.uuid() }).strict();
function controllerMatches(account) {
  const r = account.defaults?.responsibilities;
  return account.object === 'v2.core.account' && account.dashboard === 'full' && r?.fees_collector === 'stripe' && r?.losses_collector === 'stripe' && r?.requirements_collector === 'stripe';
}
function providerState(remote, accountId, observedAt = new Date()) {
  const matches = remote.id === accountId && remote.livemode === false && !remote.closed && controllerMatches(remote)
    && remote.applied_configurations?.includes('merchant') && remote.configuration?.merchant?.applied === true;
  const capabilities = remote.configuration?.merchant?.capabilities;
  const active = matches && capabilities?.card_payments?.status === 'active';
  const entries = remote.requirements?.entries;
  const due = Array.isArray(entries) ? entries.filter(e=>['currently_due','past_due'].includes(e.minimum_deadline?.status) && e.awaiting_action_from === 'user').map(e=>e.description).filter(v=>typeof v === 'string') : null;
  return { accountApiVersion:'v2', chargesEnabled:Boolean(active),payoutsEnabled:Boolean(matches && capabilities?.stripe_balance?.payouts?.status === 'active'),
    detailsSubmitted:Boolean(active && due && due.length === 0),cardPaymentsActive:Boolean(active),controllerMatches:Boolean(matches),
    capabilities:capabilities || {},requirements:{currently_due:due || [],disabled_reason:!matches ? 'account_configuration_unavailable' : !active ? capabilities?.card_payments?.status || 'capability_unavailable' : null},
    synchronizedAt:observedAt,...(remote.closed === true ? {lifecycleState:'archived'} : {}) };
}
// Equal timestamps cannot establish which response is newer. Permit a safety
// downgrade at that boundary, but never let an equal observation grant access.
function observationCanApply(current, values) {
  if (!current.synchronizedAt) return true;
  const difference = +values.synchronizedAt - +new Date(current.synchronizedAt);
  if (difference > 0) return true;
  if (difference < 0) return false;
  return !values.chargesEnabled || !values.detailsSubmitted || !values.cardPaymentsActive || !values.controllerMatches || values.lifecycleState === 'archived';
}
function paymentsReady(account, now = new Date()) {
  return Boolean(account && !account.paymentsDisabledAt && (!account.disconnectStatus || account.disconnectStatus === 'none') && account.accountApiVersion === 'v2' && account.lifecycleState === 'active' && account.mode === 'test' && account.stripeAccountId && account.detailsSubmitted && account.chargesEnabled && account.cardPaymentsActive && account.controllerMatches && account.synchronizedAt && +now - +new Date(account.synchronizedAt) <= 300000 && +new Date(account.synchronizedAt) <= +now);
}
function safeProfile(account, observedAt = new Date()) {
  const fields = ['id','organizationId','name','stripeAccountId','mode','chargesEnabled','payoutsEnabled','detailsSubmitted','cardPaymentsActive','controllerMatches','synchronizedAt','lifecycleState','createdAt','updatedAt'];
  const a = account.toJSON ? account.toJSON() : account;
  return { ...Object.fromEntries(fields.map(key=>[key,a[key]])), paymentsDisabledAt:a.paymentsDisabledAt || null,
    disconnectStatus:a.disconnectStatus || 'none', disconnectRequestId:a.disconnectRequestId || null,
    disconnectedAt:a.disconnectedAt || null, disconnectErrorCode:a.disconnectErrorCode || null,
    requirements: { currentlyDue: a.requirements?.currently_due || [], disabledReason: a.requirements?.disabled_reason || null }, paymentsReady: paymentsReady(a, observedAt) };
}
async function synchronizeAccount(account, stripe, { models, now } = {}) {
  if (!models) throw new Error('Payment account synchronization requires scoped models.');
  return createBusinessPaymentAccountService({models,stripe,...(now ? {now} : {})}).synchronizeTrusted(account.stripeAccountId);
}
async function resolvePaymentAccount({ models, event, transaction, stripe, refresh = true, now = () => new Date() }) {
  if (refresh && transaction) throw new Error('Synchronize Stripe outside the payment mutation transaction.');
  if (!event.organizationId || !models.PaymentAccount) throw conflict('Select a business payment account before paid publication.', 'PAYMENTS_NOT_READY');
  const org = await assertActiveOrganization(models, event.organizationId, transaction);
  const shared = stripe?.mode === 'test' && stripe.sandboxSharedAccountId;
  const id = event.paymentAccountId || org.defaultPaymentAccountId;
  let account = (shared || id) && await models.PaymentAccount.findOne({ where: shared
    ? { stripeAccountId: shared, mode: 'test', lifecycleState: 'active' }
    : { id, organizationId: event.organizationId, lifecycleState: 'active' }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!account) throw conflict('Select a business payment account before paid publication.', 'PAYMENTS_NOT_READY');
  if (shared && account.organizationId !== event.organizationId) await assertActiveOrganization(models, account.organizationId, transaction);
  if (refresh) account = await synchronizeAccount(account, stripe, {models,now});
  if (!paymentsReady(account,now())) throw conflict('Complete Stripe onboarding, then refresh the payment profile to verify charge readiness.', 'PAYMENTS_NOT_READY');
  return account;
}
async function assertFinanceAccess(models, userId, organizationId, transaction) {
  const user = await models.User.findByPk(userId, { transaction });
  if (!activeUser(user)) throw forbidden('An active account is required');
  const org = await assertActiveOrganization(models, organizationId, transaction);
  if (org.onboardingEstablished === false) throw forbidden('Complete Nitewide business onboarding before managing payment accounts.');
  const membership = await models.OrganizationOwner.findOne({ where: { organizationId, userId, lifecycleState: 'active' }, transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
  if (!membership || !(membership.role === 'owner' || membership.role === 'admin' && membership.financeAuthorized)) throw forbidden('Business owner or authorized finance manager access required');
  return org;
}
function createBusinessPaymentAccountService({ models, stripe = null, businessAppUrl = 'http://localhost:5174/app',now = () => new Date() }) {
  const sharedAccountId = stripe?.mode === 'test' && stripe.sandboxSharedAccountId;
  const assertNormalSelection = () => {
    if (sharedAccountId) throw conflict('Shared sandbox testing routes new payments through one merchant. Disable that server setting before changing account selection.', 'SANDBOX_SHARED_MERCHANT');
  };
  const transact = fn => mutationTransaction(models.Organization.sequelize, fn, { accessChange: true });
  const audit = (userId,organizationId,entityId,action,after,transaction) => models.AuditLog?.create({ actorUserId:userId,organizationId,entityType:'PaymentAccount',entityId,action,after },{transaction});
  async function validatePublishedMerchant(event,transaction) {
    if (event.status !== 'published' || eventFinished(event, now()) || event.lifecycleState && event.lifecycleState !== 'active') return;
    const offerings = await models.Offering.findAll({where:{eventId:event.id},transaction});
    if (offerings.some(o=>o.isActive !== false && o.priceCents>0)) {
      if (stripe?.enabled !== true) throw conflict('Configure verified sandbox checkout before changing a published paid merchant.','PAYMENTS_NOT_READY');
      await resolvePaymentAccount({models,event,stripe,transaction,refresh:false});
    }
  }
  const get = async (org, id, transaction) => { const a = await models.PaymentAccount.findOne({ where: { id, organizationId: org, lifecycleState: 'active' }, transaction, ...(transaction ? {lock:transaction.LOCK.UPDATE}: {}) }); if (!a) throw notFound('Payment account'); return a; };
  async function list(userId, organizationId, input = {}) {
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(input.page), pageSize = z.coerce.number().int().min(1).max(50).default(20).parse(input.pageSize);
    if (sharedAccountId) {
      // Read provider status before opening locks, without granting callers
      // management access to the other organization's canonical profile.
      await assertFinanceAccess(models,userId,organizationId);
      await synchronizeTrusted(sharedAccountId);
    }
    return transact(async transaction => { const org = await assertFinanceAccess(models,userId,organizationId,transaction);
      const membership = await models.OrganizationOwner.findOne({where:{organizationId,userId,lifecycleState:'active'},transaction});
      const { rows, count } = await models.PaymentAccount.findAndCountAll({ where: { organizationId }, order: [['createdAt','ASC'],['id','ASC']], limit: pageSize, offset: (page-1)*pageSize, transaction });
      const shared = sharedAccountId && await models.PaymentAccount.findOne({where:{stripeAccountId:sharedAccountId,mode:'test',lifecycleState:'active'},transaction});
      return { items: rows.map(a=>safeProfile(a,now())), total: count, page, pageSize, hasMore: page*pageSize<count, defaultPaymentAccountId: org.defaultPaymentAccountId, canManageFinance: true,
        canDisconnectPayments:membership.role === 'owner' || Boolean(membership.paymentDisconnectAuthorized),
        ...(sharedAccountId ? {sharedSandboxAccount:{stripeAccountId:sharedAccountId,paymentsReady:Boolean(stripe.enabled && paymentsReady(shared,now()))}} : {}) }; });
  }
  async function create(userId, organizationId, body) {
    if (!stripe || stripe.mode !== 'test') throw conflict('Stripe sandbox is not configured.', 'PAYMENTS_NOT_ENABLED');
    const input = profileInput.parse(body);
    const profile = await transact(async transaction => { await assertFinanceAccess(models,userId,organizationId,transaction);
      const existing = await models.PaymentAccount.findByPk(input.idempotencyKey,{ transaction });
      if (existing) { if (existing.organizationId !== organizationId || existing.name !== input.name) throw conflict('Payment profile retry does not match.', 'IDEMPOTENCY_CONFLICT'); return existing; }
      const saved = await models.PaymentAccount.create({ id: input.idempotencyKey, organizationId, name: input.name, mode: 'test',accountApiVersion:'v2' },{ transaction });
      await audit(userId,organizationId,saved.id,'business.payment_account.created',{name:saved.name,mode:'test'},transaction);return saved; });
    if (!profile.stripeAccountId) {
      const remote = await stripe.createAccount({ display_name:input.name,dashboard:'full',identity:{country:'us'},configuration:{merchant:{capabilities:{card_payments:{requested:true}}}},
        defaults:{responsibilities:RESPONSIBILITIES},include:['configuration.merchant','defaults','requirements'],metadata: { nitewide_payment_account_id: profile.id } },{ idempotencyKey: `nitewide-account-v2-${profile.id}` });
      if (remote.livemode !== false || remote.closed || !controllerMatches(remote)) throw conflict('Unexpected Stripe account configuration.', 'PAYMENTS_NOT_READY');
      await transact(async transaction => { await assertFinanceAccess(models,userId,organizationId,transaction); const current = await get(organizationId,profile.id,transaction); await current.update({ stripeAccountId: remote.id },{ transaction }); profile.stripeAccountId = remote.id; });
    }
    return safeProfile(profile,now());
  }
  async function synchronize(userId, organizationId, id) {
    await assertFinanceAccess(models,userId,organizationId); const profile = await get(organizationId,id);
    if (!stripe || stripe.mode !== 'test' || !profile.stripeAccountId) throw conflict('Stripe sandbox account is not connected.', 'PAYMENTS_NOT_READY');
    const observedAt = now();
    const remote = await stripe.retrieveAccount(profile.stripeAccountId);
    return transact(async transaction => {
      await assertFinanceAccess(models,userId,organizationId,transaction); const current = await get(organizationId,id,transaction);
      if (current.stripeAccountId !== profile.stripeAccountId) throw conflict('Payment account changed; refresh again.');
      const values = providerState(remote,current.stripeAccountId,observedAt);
      if (observationCanApply(current,values)) await current.update(values,{transaction});
      return safeProfile(current,now());
    });
  }
  async function onboarding(userId,organizationId,id) {
    await assertFinanceAccess(models,userId,organizationId); const profile = await get(organizationId,id);
    if (profile.disconnectStatus !== 'none') throw conflict('This account is disconnecting. Complete or check disconnection first.', 'DISCONNECT_PENDING');
    if (!stripe || stripe.mode !== 'test' || !profile.stripeAccountId) throw conflict('Create a Stripe sandbox account first.', 'PAYMENTS_NOT_READY');
    const url = new URL(businessAppUrl); url.searchParams.set('section','payments'); url.searchParams.delete('teamOrganizationId'); url.searchParams.set('paymentAccountReturn',id); url.searchParams.set('paymentOrganization',organizationId);
    const link = await stripe.createAccountLink({ account: profile.stripeAccountId,use_case:{type:'account_onboarding',account_onboarding:{configurations:['merchant'],return_url:url.toString(),refresh_url:url.toString()}} });
    await assertFinanceAccess(models,userId,organizationId);
    if (link.livemode !== false || link.account !== profile.stripeAccountId || link.object !== 'v2.core.account_link') throw conflict('Unexpected Stripe onboarding link.','PAYMENTS_NOT_READY');
    return { url: link.url, expiresAt: new Date(link.expires_at).toISOString() };
  }
  async function selectDefault(userId,organizationId,id) {
    return transact(async transaction => {
      const org = await assertFinanceAccess(models,userId,organizationId,transaction);
      if (id) await get(organizationId,id,transaction);
      if (org.defaultPaymentAccountId === id) return { defaultPaymentAccountId: id };
      assertNormalSelection();
      const unbound = await models.Event.findAll({ where: { organizationId, paymentAccountId: null }, order: [['id','ASC']], transaction, lock: transaction.LOCK.UPDATE });
      if (unbound.length && await models.Order.count({ where: unsettledMerchantWhere({ [Op.in]: unbound.map(event => event.id) }), transaction })) {
        throw conflict('Resolve pending Stripe checkouts, payments needing review, and outstanding refunds before changing the default payment account.', 'PAYMENT_ACCOUNT_LOCKED');
      }
      // Completed orders and refunds retain their saved merchant identifiers.
      // This changes only routing for subsequent checkouts, never old records.
      await org.update({ defaultPaymentAccountId: id }, { transaction });
      for (const event of unbound) await validatePublishedMerchant(event, transaction);
      await audit(userId,organizationId,id || organizationId,'business.payment_account.default_selected',{paymentAccountId:id},transaction);
      return { defaultPaymentAccountId: id };
    });
  }
  async function selectEvent(userId,eventId,id) { return transact(async transaction => { const event = await models.Event.findByPk(eventId,{ transaction, lock: transaction.LOCK.UPDATE }); if (!event) throw notFound('Event');
    await assertFinanceAccess(models,userId,event.organizationId,transaction); if (id) await get(event.organizationId,id,transaction);
    if (event.paymentAccountId !== id) assertNormalSelection();
    if (event.paymentAccountId !== id && await models.Order.count({ where: unsettledMerchantWhere(eventId), transaction })) throw conflict('Resolve pending Stripe checkouts, payments needing review, and outstanding refunds before changing this event’s payment account.', 'PAYMENT_ACCOUNT_LOCKED');
    await event.update({ paymentAccountId: id },{ transaction });await validatePublishedMerchant(event,transaction);
    await audit(userId,event.organizationId,id || eventId,'business.payment_account.event_selected',{eventId,paymentAccountId:id},transaction); return { paymentAccountId: id }; }); }
  async function synchronizeTrusted(stripeAccountId) {
    const profile = await models.PaymentAccount.findOne({ where:{stripeAccountId,mode:'test',lifecycleState:'active'} });
    if (!profile || !stripe || stripe.mode !== 'test') throw notFound('Payment account');
    const observedAt = now();
    const remote = await stripe.retrieveAccount(stripeAccountId);
    return transact(async transaction => {
      await assertActiveOrganization(models,profile.organizationId,transaction);
      const current = await get(profile.organizationId,profile.id,transaction);
      const values = providerState(remote,current.stripeAccountId,observedAt);
      if (observationCanApply(current,values)) await current.update(values,{transaction});
      return current;
    });
  }
  return { list,create,onboarding,synchronize,selectDefault,selectEvent,synchronizeTrusted, resolveForEvent: (event, options = {}) => resolvePaymentAccount({ models,event,stripe,now,...options }) };
}
module.exports = { createBusinessPaymentAccountService, resolvePaymentAccount, synchronizeAccount, assertFinanceAccess, paymentsReady, controllerMatches, providerState, observationCanApply, safeProfile, RESPONSIBILITIES };
