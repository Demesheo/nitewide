'use strict';

// One cent-based engine for demo checkout, the public calculator and financial
// scenarios. These standard US benchmarks are modeled, not live event quotes.
const POLICY = Object.freeze({ version: '2026-09-23-competitive-v2', percentageBps: 800,
  perPaidUnitCents: 80, competitorDiscountBps: 200, preferredMarginBps: 500,
  minimumContributionCents: 100, processingPaidBy: 'platform' });
const BENCHMARK = Object.freeze({ version: 'us-standard-2026-09-23', currency: 'USD',
  verifiedAt: '2026-09-23', expiresAt: '2026-10-24T00:00:00Z',
  sources: ['https://posh.vip/university/post/ticketing-platform-fashion-shows-nightclub-events-faq',
    'https://www.eventbrite.com/organizer/pricing/'] });
// Explicit demo-only cost assumptions. Zero additional costs is NOT a verified
// production rate. Live checkout remains gated pending contracted costs/reserves.
const DEMO_COSTS = Object.freeze({ version: 'demo-us-domestic-card', currency: 'USD',
  processorBps: 290, processorFixedCents: 30, otherCostBps: 0, otherCostCents: 0,
  reserveBps: 0, reserveCents: 0, verifiedForLive: false });
const bps = (cents, rate) => Math.round(cents * rate / 10000);
const safe = value => Number.isSafeInteger(value) && value >= 0;

function quoteOrder({ items, currency = 'USD', costs = DEMO_COSTS, now = new Date(), benchmark = BENCHMARK }) {
  if (!Array.isArray(items) || !items.length) throw new RangeError('Items are required');
  let subtotalCents = 0, ceilingFeeCents = 0, poshFeeCents = 0, eventbriteServiceCents = 0;
  for (const { unitPriceCents, quantity } of items) {
    if (!safe(unitPriceCents) || !Number.isSafeInteger(quantity) || quantity < 1)
      throw new RangeError('Items require integer prices and positive integer quantities');
    // Bound intermediate multiplication as well as totals to preserve exact cents.
    if (!Number.isSafeInteger(unitPriceCents * 10000) || !safe(unitPriceCents * quantity))
      throw new RangeError('Unsafe monetary amount');
    subtotalCents += unitPriceCents * quantity;
    if (unitPriceCents) {
      ceilingFeeCents += (bps(unitPriceCents, POLICY.percentageBps) + POLICY.perPaidUnitCents) * quantity;
      poshFeeCents += (bps(unitPriceCents, 1000) + 99) * quantity;
      eventbriteServiceCents += (bps(unitPriceCents, 370) + 179) * quantity;
    }
  }
  if (!safe((subtotalCents + ceilingFeeCents + poshFeeCents + eventbriteServiceCents) * 10000))
    throw new RangeError('Unsafe order total');
  const preferredContributionCents = subtotalCents ? Math.max(100, Math.ceil(subtotalCents * 500 / 10000)) : 0;
  const unavailable = reason => ({ eligible: false, reason, subtotalCents, ceilingFeeCents,
    feeCents: null, totalCents: null, preferredContributionCents, policyVersion: POLICY.version });
  if (currency !== 'USD') return unavailable('UNSUPPORTED_CURRENCY');
  if (!subtotalCents) return { eligible: true, subtotalCents: 0, ceilingFeeCents: 0, feeCents: 0,
    totalCents: 0, discountCents: 0, processingCents: 0, otherCostCents: 0, reserveCents: 0,
    contributionCents: 0, preferredContributionCents: 0, preferredMarginMet: true, policyVersion: POLICY.version };
  const benchmarkCurrent = Boolean(benchmark && benchmark.currency === currency && Number.isFinite(Date.parse(benchmark.expiresAt))
    && Number.isFinite(+new Date(now)) && +new Date(now) < Date.parse(benchmark.expiresAt));
  const fields = ['processorBps', 'processorFixedCents', 'otherCostBps', 'otherCostCents', 'reserveBps', 'reserveCents'];
  if (!costs || costs.currency !== currency || fields.some(key => !safe(costs[key]))
    || costs.processorBps + costs.otherCostBps + costs.reserveBps >= 10000)
    return unavailable('COSTS_UNAVAILABLE');
  const eventbriteProcessingCents = bps(subtotalCents + eventbriteServiceCents, 290);
  const eventbriteFeeCents = eventbriteServiceCents + eventbriteProcessingCents;
  const benchmarkFeeCents = Math.min(poshFeeCents, eventbriteFeeCents);
  // The comparison includes ALL required buyer fees, not just Eventbrite's
  // service line. Round down so the discount is at least 2%, never less.
  const competitiveCapCents = Math.floor(benchmarkFeeCents * (10000 - POLICY.competitorDiscountBps) / 10000);
  const targetFeeCents = benchmarkCurrent ? Math.min(ceilingFeeCents, competitiveCapCents) : ceilingFeeCents;
  const costsAt = fee => {
    const total = subtotalCents + fee;
    return bps(total, costs.processorBps) + costs.processorFixedCents
      + bps(total, costs.otherCostBps) + costs.otherCostCents
      + Math.ceil(subtotalCents * costs.reserveBps / 10000) + costs.reserveCents;
  };
  // Hard $1 floor takes precedence. Never reject a valid basket merely because
  // the standard ceiling or competitive target cannot cover it. Solve the
  // smallest additional buyer fee, including processing on that added fee.
  let feeCents = targetFeeCents;
  if (feeCents - costsAt(feeCents) < POLICY.minimumContributionCents) {
    const rate = costs.processorBps + costs.otherCostBps;
    const fixed = costs.processorFixedCents + costs.otherCostCents
      + Math.ceil(subtotalCents * costs.reserveBps / 10000) + costs.reserveCents;
    const estimate = Math.ceil((subtotalCents * rate / 10000 + fixed + 100) / (1 - rate / 10000));
    if (!safe(estimate * 10000)) return unavailable('COSTS_UNAVAILABLE');
    // Independent rounding adds at most one cent. Search near the analytic
    // root, rather than assume independently rounded costs are monotonic.
    feeCents = Math.max(targetFeeCents, Math.floor(estimate - 2 / (1 - rate / 10000)));
    while (feeCents - costsAt(feeCents) < POLICY.minimumContributionCents) feeCents++;
  }
  const totalCents = subtotalCents + feeCents;
  const processingCents = bps(totalCents, costs.processorBps) + costs.processorFixedCents;
  const otherCostCents = bps(totalCents, costs.otherCostBps) + costs.otherCostCents;
  const reserveCents = Math.ceil(subtotalCents * costs.reserveBps / 10000) + costs.reserveCents;
  const contributionCents = feeCents - processingCents - otherCostCents - reserveCents;
  if (![processingCents, otherCostCents, reserveCents].every(safe)) return unavailable('COSTS_UNAVAILABLE');
  const eligible = true;
  return { eligible, reason: null, subtotalCents, ceilingFeeCents,
    feeCents, totalCents,
    discountCents: Math.max(0, ceilingFeeCents - feeCents),
    floorAdjusted: feeCents > targetFeeCents, standardCeilingExceeded: feeCents > ceilingFeeCents,
    competitiveTargetMet: benchmarkCurrent && feeCents <= competitiveCapCents, benchmarkCurrent,
    candidateFeeCents: feeCents, candidateTotalCents: totalCents,
    processingCents, otherCostCents, reserveCents, contributionCents,
    preferredContributionCents, preferredMarginMet: contributionCents >= preferredContributionCents,
    poshFeeCents, eventbriteServiceCents, eventbriteProcessingCents, eventbriteFeeCents,
    benchmarkFeeCents, benchmarkProvider: poshFeeCents <= eventbriteFeeCents ? 'Posh' : 'Eventbrite',
    policyVersion: POLICY.version, benchmarkVersion: benchmarkCurrent ? benchmark.version : null, costsVersion: costs.version };
}

// Public views never return platform contribution, reserves or processor costs.
function publicQuote(quote) {
  const { eligible, reason, subtotalCents, ceilingFeeCents, feeCents, totalCents, discountCents, policyVersion,
    floorAdjusted, standardCeilingExceeded, competitiveTargetMet, benchmarkCurrent } = quote;
  return { eligible, reason, subtotalCents, ceilingFeeCents, feeCents, totalCents, discountCents, policyVersion,
    floorAdjusted, standardCeilingExceeded, competitiveTargetMet, benchmarkCurrent };
}
module.exports = { POLICY, BENCHMARK, DEMO_COSTS, quoteOrder, publicQuote, bps };
