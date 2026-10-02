const { accessScopeSql } = require('./event-affiliate-access');

// Persisted verification is meaningful only with the original merchant and
// matching payment record. EXISTS keeps duplicate evidence from multiplying sums.
// Cross-business sandbox history additionally requires the immutable server
// snapshot's strict boolean marker and original event/account bindings.
const verifiedStripeOrderSql = (o = 'o') => `(${o}.provider_mode = 'test' AND ${o}.provider_verification_status = 'verified'
  AND ${o}.payment_account_id IS NOT NULL AND ${o}.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  AND ${o}.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$' AND ${o}.stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'
  AND EXISTS (SELECT 1 FROM payment_accounts pa JOIN events merchant_event ON merchant_event.id=${o}.event_id
    WHERE pa.id=${o}.payment_account_id AND (pa.organization_id=merchant_event.organization_id
      OR (${o}.pricing_plan_snapshot #> '{merchant,sharedSandbox}' = 'true'::jsonb
        AND ${o}.pricing_plan_snapshot #>> '{merchant,organizationId}' = merchant_event.organization_id::text
        AND ${o}.pricing_plan_snapshot #>> '{merchant,paymentAccountId}' = pa.id::text
        AND ${o}.pricing_plan_snapshot #>> '{merchant,stripeAccountId}' = pa.stripe_account_id))
      AND pa.mode='test' AND pa.stripe_account_id=${o}.stripe_account_id)
  AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=${o}.id AND p.provider='stripe'
    AND p.provider_reference=${o}.stripe_payment_intent_id AND p.amount_cents=${o}.total_cents
    AND UPPER(p.currency)=UPPER(${o}.currency) AND p.metadata->>'stripeAccountId'=${o}.stripe_account_id
    AND ((${o}.status='paid' AND p.status='succeeded') OR (${o}.status='refunded' AND p.status='refunded'))))`;
const ownCommissionSql = (o = 'o') => `(EXISTS (SELECT 1 FROM event_affiliates own_ea
  WHERE own_ea.id=${o}.event_affiliate_id AND own_ea.event_id=${o}.event_id AND own_ea.user_id=:userId)
  OR (${o}.event_affiliate_id IS NULL AND EXISTS (SELECT 1 FROM org_affiliates own_oa
    JOIN events own_event ON own_event.id=${o}.event_id
    WHERE own_oa.id=${o}.org_affiliate_id AND own_oa.organization_id=own_event.organization_id AND own_oa.user_id=:userId)))`;
const demoOrderSql = (o = 'o') => `(${o}.provider_mode IS NULL AND ${o}.payment_account_id IS NULL
  AND ${o}.stripe_account_id IS NULL AND ${o}.checkout_session_id IS NULL
  AND ${o}.stripe_payment_intent_id IS NULL AND ${o}.stripe_charge_id IS NULL
  AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=${o}.id AND p.provider IN ('demo','mock')
    AND p.amount_cents=${o}.total_cents AND UPPER(p.currency)=UPPER(${o}.currency)
    AND ((${o}.status='paid' AND p.status='succeeded') OR (${o}.status='refunded' AND p.status='refunded'))))`;
const member = `EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id=e.organization_id AND oo.user_id=:userId AND oo.lifecycle_state='active')
  OR EXISTS (SELECT 1 FROM organization_employees oe WHERE oe.organization_id=e.organization_id AND oe.user_id=:userId AND oe.status='active')
  OR EXISTS (SELECT 1 FROM org_affiliates oa WHERE oa.organization_id=e.organization_id AND oa.user_id=:userId AND oa.status='active'
    AND (oa.starts_at IS NULL OR oa.starts_at<=NOW()) AND (oa.ends_at IS NULL OR oa.ends_at>=NOW()))`;
const canViewEarningsSql = `(
  EXISTS (SELECT 1 FROM org_affiliates oa JOIN organizations org ON org.id=oa.organization_id
    WHERE oa.user_id=:userId AND oa.status='active'
      AND (oa.starts_at IS NULL OR oa.starts_at<=NOW()) AND (oa.ends_at IS NULL OR oa.ends_at>=NOW())
      AND org.lifecycle_state='active' AND org.status='active')
  OR EXISTS (SELECT 1 FROM event_affiliates ea JOIN events e ON e.id=ea.event_id
    LEFT JOIN organizations org ON org.id=e.organization_id LEFT JOIN locations loc ON loc.id=e.location_id
    JOIN users creator ON creator.id=e.creator_user_id
    WHERE ea.user_id=:userId AND ea.status='active' AND e.lifecycle_state='active'
      AND (ea.starts_at IS NULL OR ea.starts_at<=NOW()) AND (ea.ends_at IS NULL OR ea.ends_at>=NOW())
      AND (e.location_id IS NULL OR loc.lifecycle_state='active')
      AND (e.organization_id IS NULL AND creator.is_active=true AND creator.lifecycle_state='active' AND creator.onboarding_pending=false
        OR org.lifecycle_state='active' AND org.status='active')
      AND (${accessScopeSql('ea')}='event' OR (${accessScopeSql('ea')}='organization' AND (${member}))
        OR (${accessScopeSql('ea')}='venue' AND EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov
          ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
          WHERE va.id=ea.venue_access_id AND va.organization_id=e.organization_id AND va.location_id=e.location_id
            AND va.user_id=:userId AND va.status='active'))))
  OR EXISTS (SELECT 1 FROM orders o WHERE o.affiliate_commission_cents>0 AND o.status IN ('paid','refunded') AND ${ownCommissionSql()})
)`;
module.exports = { verifiedStripeOrderSql, ownCommissionSql, demoOrderSql, canViewEarningsSql };
