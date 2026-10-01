// Payment status alone is not provider evidence. Legacy/free/demo orders have
// no provider markers; marked orders must retain their verified charge binding.
const fields = ['providerMode', 'paymentAccountId', 'stripeAccountId', 'checkoutSessionId', 'stripePaymentIntentId', 'stripeChargeId'];
const columns = ['provider_mode', 'payment_account_id', 'stripe_account_id', 'checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id'];
function orderAdmissionEligible(order) {
  if (!order || order.status !== 'paid') return false;
  const marked = fields.some((field) => order[field] != null) || order.pricingPlanSnapshot?.stripeFeeDecision != null;
  if (!marked) return true;
  return order.providerMode === 'test' && order.providerVerificationStatus === 'verified'
    && typeof order.paymentAccountId === 'string' && order.paymentAccountId.length > 0
    && /^acct_[A-Za-z0-9]+$/.test(order.stripeAccountId || '')
    && /^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId || '')
    && /^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId || '');
}
function orderAdmissionSql(alias = 'o') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid SQL alias');
  return `(${alias}.status = 'paid' AND ((
    ${columns.map((column) => `${alias}.${column} IS NULL`).join(' AND ')}
    AND (${alias}.pricing_plan_snapshot->>'stripeFeeDecision') IS NULL
  ) OR (${alias}.provider_mode = 'test' AND ${alias}.provider_verification_status = 'verified'
    AND ${alias}.payment_account_id IS NOT NULL
    AND ${alias}.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
    AND ${alias}.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    AND ${alias}.stripe_charge_id ~ '^ch_[A-Za-z0-9]+$')))`;
}
module.exports = { orderAdmissionEligible, orderAdmissionSql };
