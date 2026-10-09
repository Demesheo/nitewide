const { QueryTypes } = require('sequelize');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
const { assertFinanceAccess, safeProfile, paymentsReady } = require('./business-payment-account-service');
const { lockBusiness, bumpBusiness } = require('./business-membership-policy');
const { activeUser } = require('./lifecycle-service');
const { paymentControl, disconnectPermission } = require('../http/payment-schemas');
const { isStripeMode } = require('../payments/stripe-mode');

async function assertDisconnectAccess(models, userId, organizationId, transaction) {
  const organization = await assertFinanceAccess(models, userId, organizationId, transaction);
  const membership = await models.OrganizationOwner.findOne({ where: { userId, organizationId, lifecycleState: 'active' }, transaction });
  if (membership.role !== 'owner' && !membership.paymentDisconnectAuthorized) throw forbidden('Only an owner or a manager explicitly authorized to disconnect payments can do this.');
  return { organization, membership };
}

function createBusinessPaymentDisconnectService({ models, stripe, paymentAccounts, now = () => new Date() }) {
  const db = models.PaymentAccount?.sequelize || models.Organization?.sequelize;
  const profile = account => safeProfile(account,now(),stripe?.mode || 'disabled');
  const transact = fn => mutationTransaction(db, fn, { accessChange: true });
  const audit = (userId, organizationId, id, action, after, transaction) => models.AuditLog.create({ actorUserId:userId, organizationId,
    entityType:'PaymentAccount', entityId:id, action, after }, { transaction });
  const sharedMerchant = account => stripe?.mode === 'test' && stripe.sandboxSharedAccountId && account.stripeAccountId === stripe.sandboxSharedAccountId;
  const sharedWarning = 'Disable shared sandbox routing before disabling or disconnecting its merchant; all test businesses are using it.';
  const matchingMode = account => isStripeMode(stripe?.mode) && account.mode === stripe.mode;
  async function get(organizationId, id, transaction) {
    const account = await models.PaymentAccount.findOne({ where:{ id, organizationId }, transaction, ...(transaction ? {lock:transaction.LOCK.UPDATE} : {}) });
    if (!account) throw notFound('Payment account');
    return account;
  }
  async function obligations(organization, account, transaction) {
    const replacements = { id:account.id, organizationId:organization.id, isDefault:organization.defaultPaymentAccountId === account.id, now:now() };
    const [counts] = await db.query(`SELECT
      (SELECT COUNT(*)::integer FROM orders WHERE payment_account_id=:id AND status='pending') AS "pendingPayments",
      (SELECT COUNT(*)::integer FROM orders WHERE payment_account_id=:id AND provider_verification_status='review') AS "reviewPayments",
      (SELECT COUNT(*)::integer FROM refunds WHERE payment_account_id=:id AND status NOT IN ('succeeded','canceled','cancelled')) AS "unresolvedRefunds",
      (SELECT COUNT(*)::integer FROM orders o JOIN events e ON e.id=o.event_id WHERE o.payment_account_id=:id AND o.status='paid'
        AND (e.ends_at>:now OR e.status='cancelled')) AS "unfulfilledPaidBookings",
      (SELECT COUNT(*)::integer FROM orders WHERE payment_account_id=:id AND status IN ('paid','refunded')) AS "historicalBookings",
      (SELECT COUNT(*)::integer FROM events e WHERE e.organization_id=:organizationId AND e.lifecycle_state='active'
        AND e.status='published' AND e.ends_at>:now AND (e.payment_account_id=:id OR (e.payment_account_id IS NULL AND :isDefault))
        AND EXISTS (SELECT 1 FROM offerings f WHERE f.event_id=e.id AND f.is_active=true AND f.price_cents>0)) AS "affectedEvents"`,
      { replacements, type:QueryTypes.SELECT, transaction });
    return counts;
  }
  function blockers(counts) {
    const result = [];
    if (counts.pendingPayments) result.push('Pending payments must finish or expire.');
    if (counts.reviewPayments) result.push('Payments needing review must be reconciled.');
    if (counts.unresolvedRefunds) result.push('Pending or failed refunds must be resolved.');
    if (counts.unfulfilledPaidBookings) result.push('Paid bookings for future or cancelled events must be fulfilled or fully refunded.');
    return result;
  }
  async function impact(userId, organizationId, id) {
    return transact(async transaction => {
      const {organization} = await assertDisconnectAccess(models,userId,organizationId,transaction);
      const account = await get(organizationId,id,transaction);
      const counts = await obligations(organization,account,transaction);
      const blockedReasons = blockers(counts);
      if (sharedMerchant(account)) blockedReasons.push(sharedWarning);
      if (!matchingMode(account)) blockedReasons.push('This payment connection belongs to a different Stripe mode.');
      return { account:profile(account), ...counts, blockedReasons,
        providerDisconnectConfigured:Boolean(matchingMode(account) && stripe.disconnectEnabled),
        canDisconnect:Boolean(account.lifecycleState === 'active' && account.stripeAccountId && matchingMode(account) && stripe.disconnectEnabled && !blockedReasons.length) };
    });
  }
  async function disable(userId, organizationId, id, body) {
    const input = paymentControl.parse(body);
    return transact(async transaction => {
      await assertDisconnectAccess(models,userId,organizationId,transaction);
      const account = await get(organizationId,id,transaction);
      if (sharedMerchant(account)) throw conflict(sharedWarning, 'SANDBOX_SHARED_MERCHANT');
      if (account.lifecycleState !== 'active') throw conflict('This payment connection is no longer active.', 'PAYMENTS_NOT_READY');
      await account.update({paymentsDisabledAt:account.paymentsDisabledAt || now(),controlVersion:account.controlVersion+1},{transaction});
      await audit(userId,organizationId,id,'business.payment_account.disabled',{reason:input.reason,requestId:input.idempotencyKey},transaction);
      return profile(account);
    });
  }
  async function resume(userId, organizationId, id, body) {
    const input = paymentControl.parse(body);
    const version = await transact(async transaction => {
      await assertDisconnectAccess(models,userId,organizationId,transaction);
      const account = await get(organizationId,id,transaction);
      if (account.lifecycleState !== 'active' || account.disconnectStatus !== 'none') throw conflict('A disconnected or disconnecting account cannot be resumed.', 'DISCONNECT_PENDING');
      if (!matchingMode(account)) throw conflict('This payment connection belongs to a different Stripe mode.', 'PAYMENTS_NOT_READY');
      return account.controlVersion;
    });
    // Network work stays outside authorization/event locks. The final write
    // rechecks both authority and status; fresh provider readiness is required.
    await paymentAccounts.synchronize(userId,organizationId,id);
    return transact(async transaction => {
      await assertDisconnectAccess(models,userId,organizationId,transaction);
      const account = await get(organizationId,id,transaction);
      if (account.controlVersion !== version) throw conflict('The payment controls changed while Stripe readiness was checked. Refresh before resuming.', 'PAYMENT_ACCOUNT_CHANGED');
      if (account.disconnectStatus !== 'none' || !paymentsReady({...account.toJSON(),paymentsDisabledAt:null},now(),stripe?.mode || 'disabled')) throw conflict('Verify Stripe readiness before resuming payments.', 'PAYMENTS_NOT_READY');
      if (account.paymentsDisabledAt) {
        await account.update({paymentsDisabledAt:null,disconnectErrorCode:null,controlVersion:account.controlVersion+1},{transaction});
        await audit(userId,organizationId,id,'business.payment_account.resumed',{reason:input.reason},transaction);
      }
      return profile(account);
    });
  }
  async function disconnect(userId, organizationId, id, body) {
    const input = paymentControl.parse(body);
    const prepared = await transact(async transaction => {
      const {organization} = await assertDisconnectAccess(models,userId,organizationId,transaction);
      const account = await get(organizationId,id,transaction);
      if (sharedMerchant(account)) throw conflict(sharedWarning, 'SANDBOX_SHARED_MERCHANT');
      if (account.disconnectStatus === 'disconnected') return {account,call:false};
      if (account.lifecycleState !== 'active') throw conflict('This payment connection is no longer active.', 'PAYMENTS_NOT_READY');
      if (!matchingMode(account) || !stripe.disconnectEnabled || !account.stripeAccountId) throw conflict('Stripe disconnection is unavailable. You can disable new payments instead.', 'DISCONNECT_NOT_CONFIGURED');
      if (account.disconnectStatus === 'pending' && account.disconnectRequestId !== input.idempotencyKey) throw conflict('A disconnection is already pending. Refresh and retry that request.', 'DISCONNECT_PENDING');
      const blockedReasons = blockers(await obligations(organization,account,transaction));
      if (blockedReasons.length) throw conflict(blockedReasons.join(' '), 'DISCONNECT_OBLIGATIONS');
      // A short persisted lease prevents double clicks across tabs/instances.
      // A lost response is UNKNOWN, not evidence of disconnection. Retry the
      // stored request after the lease or let the signed webhook finalize it.
      if (account.disconnectStatus === 'pending' && +now() - +new Date(account.disconnectAttemptAt) < 60000) return {account,call:false};
      await account.update({paymentsDisabledAt:account.paymentsDisabledAt || now(),disconnectStatus:'pending',disconnectRequestId:input.idempotencyKey,
        disconnectAttemptAt:now(),disconnectErrorCode:null},{transaction});
      await audit(userId,organizationId,id,'business.payment_account.disconnect_requested',{reason:input.reason,requestId:input.idempotencyKey},transaction);
      return {account,call:true};
    });
    if (!prepared.call) return {account:profile(prepared.account),retryable:prepared.account.disconnectStatus === 'pending'};
    // The committed intent is the authorization point for this external action.
    // Checkout's shared fence cannot create another order after disable commits.
    let errorCode;
    try { const result = await stripe.disconnectAccount(prepared.account.stripeAccountId); if (result?.disconnected !== true) throw new Error('Unconfirmed provider response'); }
    catch (error) {
      errorCode = ['DISCONNECT_NOT_SUPPORTED','DISCONNECT_OBLIGATIONS'].includes(error.code) ? error.code : 'DISCONNECT_UNCONFIRMED';
    }
    return transact(async transaction => {
      const account = await get(organizationId,id,transaction);
      if (account.disconnectStatus === 'disconnected') return {account:profile(account),retryable:false};
      if (account.disconnectRequestId !== input.idempotencyKey) throw conflict('Disconnection state changed. Refresh before retrying.', 'DISCONNECT_PENDING');
      if (errorCode) {
        // A slow failure from an older lease cannot clear a newer attempt.
        if (+new Date(account.disconnectAttemptAt) !== +new Date(prepared.account.disconnectAttemptAt)) return {account:profile(account),retryable:account.disconnectStatus === 'pending'};
        await account.update({disconnectErrorCode:errorCode,disconnectStatus:errorCode === 'DISCONNECT_UNCONFIRMED' ? 'pending' : 'none'}, {transaction});
        await audit(userId,organizationId,id,'business.payment_account.disconnect_unconfirmed',{code:errorCode,requestId:input.idempotencyKey},transaction);
      } else {
        await account.update({disconnectStatus:'disconnected',disconnectedAt:now(),lifecycleState:'archived',chargesEnabled:false,payoutsEnabled:false,
          detailsSubmitted:false,cardPaymentsActive:false,controllerMatches:false,disconnectErrorCode:null},{transaction});
        await audit(userId,organizationId,id,'business.payment_account.disconnected',{requestId:input.idempotencyKey},transaction);
      }
      return {account:profile(account),retryable:account.disconnectStatus === 'pending'};
    });
  }
  async function grant(userId, organizationId, memberUserId, body) {
    const input = disconnectPermission.parse(body);
    return transact(async transaction => {
      const {membership} = await assertDisconnectAccess(models,userId,organizationId,transaction);
      if (membership.role !== 'owner') throw forbidden('Only business owners can grant disconnection permission.');
      const organization = await lockBusiness(models,organizationId,transaction,input.version);
      const user = await models.User.findByPk(memberUserId,{transaction});
      const member = await models.OrganizationOwner.findOne({where:{organizationId,userId:memberUserId,role:'admin',lifecycleState:'active'},transaction,lock:transaction.LOCK.UPDATE});
      if (!activeUser(user) || !member || !member.financeAuthorized) throw conflict('Grant finance access to an active manager first.', 'MANAGER_REQUIRED');
      await member.update({paymentDisconnectAuthorized:input.paymentDisconnectAuthorized},{transaction});
      const version = await bumpBusiness(models,organization,transaction);
      await models.AuditLog.create({actorUserId:userId,organizationId,entityType:'OrganizationOwner',entityId:member.id,
        action:'business.payment_disconnect_permission_changed',after:{userId:memberUserId,paymentDisconnectAuthorized:input.paymentDisconnectAuthorized,reason:input.reason}},{transaction});
      return {paymentDisconnectAuthorized:member.paymentDisconnectAuthorized,version};
    });
  }
  return {impact,disable,resume,disconnect,grant};
}
module.exports = {createBusinessPaymentDisconnectService,assertDisconnectAccess};
