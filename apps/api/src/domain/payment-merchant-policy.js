const { Op, literal } = require('sequelize');

// A mock/free booking does not establish a Stripe merchant. A real checkout
// attempt does. Saved order/refund merchant IDs remain immutable; only
// unresolved activity temporarily locks routing for subsequent transactions.
function merchantHistorySql(alias) {
  if (!/^[a-z_]+$/i.test(alias)) throw new Error('Invalid merchant history alias');
  alias = `"${alias}"`;
  return `(${['payment_account_id', 'stripe_account_id', 'checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id']
    .map(field => `${alias}.${field} IS NOT NULL`).join(' OR ')} OR ${alias}.provider_mode IN ('test','live'))`;
}
function unsettledMerchantSql(alias) {
  const history = merchantHistorySql(alias);
  alias = `"${alias}"`;
  return `((${history} AND (${alias}.status = 'pending'
    OR ${alias}.provider_verification_status IS DISTINCT FROM 'verified'))
    OR EXISTS (SELECT 1 FROM refunds merchant_refund WHERE merchant_refund.order_id = ${alias}.id
      AND merchant_refund.status NOT IN ('succeeded','canceled','cancelled')))`;
}
function unsettledMerchantWhere(eventId) {
  return { eventId, [Op.and]: [literal(unsettledMerchantSql('Order'))] };
}

module.exports = { merchantHistorySql, unsettledMerchantSql, unsettledMerchantWhere };
