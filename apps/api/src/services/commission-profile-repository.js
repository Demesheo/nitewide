const { commissionTerms } = require('../domain/commission-eligibility');

async function individualCommissionContext(models, userId, { transaction, now = new Date(), lock } = {}) {
  const individualProfile = userId && models.IndividualCommissionProfile
    ? await models.IndividualCommissionProfile.findOne({ where: { userId }, transaction, ...(lock ? { lock } : {}) }) : null;
  return { userId, individualProfile, now };
}
async function persistedCommissionTerms(models, userId, configuredCommissionBps = 0, options) {
  return commissionTerms(configuredCommissionBps, await individualCommissionContext(models, userId, options));
}
// The SQL projection is used only for ordering/pagination. Response eligibility
// is still evaluated by the shared domain guard against the persisted profile.
function commissionEligibilitySql(alias = 'cp', time = ':commissionNow') {
  const a = `${alias}.verified_stripe_account`;
  return `${alias}.lifecycle_state='active' AND ${alias}.status='active' AND ${alias}.provider='stripe' AND ${alias}.provider_mode='test'
    AND ${alias}.deauthorized_at IS NULL AND ${alias}.payments_disabled_at IS NULL AND ${alias}.disconnect_status='none'
    AND ${alias}.verified_at BETWEEN CAST(${time} AS timestamptz)-INTERVAL '5 minutes' AND CAST(${time} AS timestamptz)
    AND ${alias}.stripe_account_id=${a}->>'id' AND ${a}->>'object'='v2.core.account' AND ${a}->'livemode'='false'::jsonb
    AND COALESCE(${a}->'closed','false'::jsonb)='false'::jsonb AND ${a}#>>'{identity,entity_type}'='individual' AND ${a}->>'dashboard'='full'
    AND ${a}#>>'{defaults,responsibilities,fees_collector}'='stripe' AND ${a}#>>'{defaults,responsibilities,losses_collector}'='stripe'
    AND ${a}#>>'{defaults,responsibilities,requirements_collector}'='stripe'
    AND ${a}->'applied_configurations' @> '["merchant"]'::jsonb AND commission_merchant_applied_ready(${a}#>'{configuration,merchant,applied}',CAST(${time} AS timestamptz))
    AND ${a}#>>'{configuration,merchant,capabilities,card_payments,status}'='active'
    AND ${a}#>>'{configuration,merchant,capabilities,stripe_balance,payouts,status}'='active'
    AND ${a}#>'{requirements,entries}'='[]'::jsonb`;
}
module.exports = { individualCommissionContext, persistedCommissionTerms, commissionEligibilitySql };
