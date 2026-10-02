const { QueryTypes } = require('sequelize');
const { quoteOrder,DEMO_COSTS,effectiveFeeMode,MINIMUM_FEE_ELIGIBLE_SUBTOTAL_CENTS } = require('@nitewide/pricing');
const { DomainError } = require('./errors');
const { effectiveCommissionBps, assertCommissionEligible } = require('./commission-eligibility');

function editorPricingIssues({ eventFeeMode = 'buyer',offerings = [],commissionBps = 0,costs = DEMO_COSTS,now = new Date() }) {
  const issues = [];
  const issue = (index,field,code,message) => issues.push({ index,field,code,message });
  offerings.forEach((offering,index) => {
    if (offering.isActive === false) return;
    if ((offering.currency || 'USD') !== 'USD') { issue(index,'currency','UNSUPPORTED_CURRENCY','Active offerings currently support USD only.'); return; }
    let mode;
    try { mode = effectiveFeeMode(eventFeeMode,offering.feeMode || 'inherit'); }
    catch { issue(index,'feeMode','INVALID_FEE_MODE','Choose buyer-paid or business-absorbed fees.'); return; }
    const minimum = offering.minPerOrder ?? 1,maximum = offering.maxPerOrder ?? 10;
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum<1 || maximum<minimum || maximum>100) {
      issue(index,'minPerOrder','INVALID_QUANTITY','Choose a whole quantity range from 1 through 100.'); return;
    }
    if (!Number.isSafeInteger(offering.priceCents) || offering.priceCents<0 || offering.priceCents>100000000) {
      issue(index,'priceCents','INVALID_PRICE','Choose a valid non-negative price in cents.'); return;
    }
    if (!offering.priceCents) return; // Free admission has no paid-order margin floor.
    if (mode === 'absorbed' && offering.priceCents*minimum<MINIMUM_FEE_ELIGIBLE_SUBTOTAL_CENTS) {
      issue(index,'minPerOrder','ABSORBED_MINIMUM_SUBTOTAL','Business-absorbed fees require a $10 minimum order subtotal. Increase the price or minimum quantity.'); return;
    }
    // Bound the editor's real allowed range. All quantities are checked because
    // cent rounding and competitive caps can change at individual boundaries.
    for (let quantity=minimum;quantity<=maximum;quantity++) {
      let quote;
      try { quote = quoteOrder({ items: [{ unitPriceCents: offering.priceCents,quantity,feeMode: mode }],currency: offering.currency || 'USD',commissionBps,costs,now }); }
      catch { issue(index,'priceCents','PRICING_CONFIGURATION_UNAVAILABLE','The modeled fee or commission configuration is unavailable.'); break; }
      if (!quote.eligible || quote.contributionCents<100 || quote.businessProceedsCents<=0) {
        issue(index,'priceCents',quote.reason || 'PRICING_NOT_VIABLE',`This price and quantity (${quantity}) do not leave positive business proceeds and the modeled $1 platform contribution after configured fees and commissions.`); break;
      }
    }
  });
  return issues;
}
function validateEditorPricing(input) {
  const issues = editorPricingIssues(input);
  if (issues.length) throw new DomainError(issues[0].message,{ status: 422,code: 'PRICING_EDITOR_INVALID',details: { issues,economicsBasis: 'modeled_demo_costs' } });
  return true;
}
async function configuredCommissionBps({ models,eventId,organizationId,transaction }) {
  const [row] = await models.Event.sequelize.query(`SELECT COALESCE(MAX(rate),0)::integer AS rate FROM (
    SELECT oa.default_commission_bps AS rate FROM org_affiliates oa WHERE oa.organization_id=:organizationId AND oa.status='active'
    UNION ALL SELECT COALESCE(ea.commission_bps,oa.default_commission_bps,0) AS rate
      FROM event_affiliates ea LEFT JOIN org_affiliates oa ON oa.id=ea.org_affiliate_id
      WHERE ea.event_id=:eventId AND ea.status='active') rates`,
  { replacements: { organizationId: organizationId || null,eventId: eventId || null },transaction,type: QueryTypes.SELECT });
  return effectiveCommissionBps(Number(row.rate));
}
async function assertEditorPricing({ models,eventId,organizationId,eventFeeMode = 'buyer',offerings,transaction,now = new Date() }) {
  const commissionBps = await configuredCommissionBps({ models,eventId,organizationId,transaction });
  return validateEditorPricing({ eventFeeMode,offerings,commissionBps,now });
}
async function assertCommissionPricing({ models,organizationId,eventId,commissionBps,transaction,now = new Date() }) {
  if (!Number.isSafeInteger(commissionBps) || commissionBps<0 || commissionBps>4000) throw new DomainError('Choose a commission from 0% through 40%.',{ status: 422,code: 'INVALID_COMMISSION' });
  assertCommissionEligible(commissionBps);
  if (!organizationId && !eventId) throw new DomainError('A business or event scope is required for commission changes.',{ status: 422,code: 'COMMISSION_SCOPE_REQUIRED' });
  const replacements = { eventId: eventId || null,organizationId: organizationId || null,now };
  // Price edits lock the same event before replacing its offerings. Lock even
  // an empty event, so a concurrent first offering cannot evade the terms
  // check. Organization-wide writes also hold the exclusive authorization
  // fence, serializing new event creation with a commission change.
  if (transaction) await models.Event.sequelize.query(`SELECT e.id FROM events e
    WHERE e.lifecycle_state='active' AND e.status IN ('draft','published') AND e.ends_at>:now
      AND (:eventId IS NULL OR e.id=:eventId) AND (:organizationId IS NULL OR e.organization_id=:organizationId)
    ORDER BY e.id FOR SHARE OF e`,{ replacements,transaction,type: QueryTypes.SELECT });
  const rows = await models.Event.sequelize.query(`SELECT e.id AS "eventId",e.fee_mode AS "eventFeeMode",o.id AS "offeringId",o.fee_mode AS "feeMode",o.name,o.price_cents AS "priceCents",
    o.currency,o.min_per_order AS "minPerOrder",o.max_per_order AS "maxPerOrder",o.is_active AS "isActive"
    FROM events e JOIN offerings o ON o.event_id=e.id WHERE e.lifecycle_state='active' AND e.status IN ('draft','published') AND e.ends_at>:now
      AND o.is_active AND o.price_cents>0 AND (:eventId IS NULL OR e.id=:eventId) AND (:organizationId IS NULL OR e.organization_id=:organizationId)
    ORDER BY e.id,o.id ${transaction ? 'FOR SHARE OF o' : ''}`,{ replacements,transaction,type: QueryTypes.SELECT });
  for (const offering of rows) {
    try { validateEditorPricing({ eventFeeMode: offering.eventFeeMode,offerings: [offering],commissionBps,now }); }
    catch (error) {
      if (error.code === 'PRICING_EDITOR_INVALID') {
        error.message = `${offering.name}: ${error.message}`;
        error.details = { ...error.details,eventId: offering.eventId,offeringId: offering.offeringId,offeringName: offering.name };
      }
      throw error;
    }
  }
  return true;
}
module.exports = { editorPricingIssues,validateEditorPricing,configuredCommissionBps,assertEditorPricing,assertCommissionPricing };
