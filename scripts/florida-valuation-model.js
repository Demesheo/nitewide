'use strict';

const assumptions = Object.freeze({
  venues: 80,
  nightsPerWeek: 4,
  weeksPerYear: 52,
  vipGmvPerVenueNight: 5_000,
  vipActiveNightShare: 1 / 3,
  averageVipTransaction: 400,
  gaGmvPerVenueNight: 500,
  averageGaTransaction: 20,
  nonNightclubEventsPerNightclubEvent: 0.10,
  nonNightclubGmvPerEvent: 5_000,
  averageNonNightclubTransaction: 40,
  buyerFeeRate: 0.08,
  buyerFixedFee: 0.89,
  promoterAttributedTransactionShare: 0.50,
  vipGrossPromoterKickback: 50,
  gaGrossPromoterKickback: 5,
  nitewideKickbackFeeRate: 0.10,
  premiumAdoptionShare: 0.50,
  premiumMonthlyPrice: 249,
  stripeRate: 0.029,
  stripeFixedFee: 0.30,
  otherDirectCostReserveRate: 0.005,
  annualOperatingBudget: 300_000,
  customerPurchaseConversionRate: 0.10,
  averageEventCardsPerDiscoveryPage: 10,
  customerAdCardRatio: 0.12,
  customerMinimumAdCards: 2,
  adsenseFillRate: 0.75,
  adsenseViewabilityRate: 0.70,
  adNetwork: 'Google AdSense',
  customerAdEcpm: 2.50,
  freeBusinessPageviewsPerOrganizationMonth: 300,
  businessAdSlotsPerEligiblePage: 2,
  businessAdEcpm: 4,
  aggregatedInsightsCustomers: 4,
  aggregatedInsightsMonthlyPrice: 1_000,
  adsAndInsightsDirectCostRate: 0.20,
  valuationGoal: 50_000_000,
});

function customerAdSlotsPerPage(input) {
  const requested = input.averageEventCardsPerDiscoveryPage < 12
    ? input.customerMinimumAdCards
    : Math.ceil(input.averageEventCardsPerDiscoveryPage * input.customerAdCardRatio);
  const contentSafeMaximum = Math.max(0, input.averageEventCardsPerDiscoveryPage - 1);
  return Math.min(requested, contentSafeMaximum);
}

function calculate(input = assumptions) {
  const venueNights = input.venues * input.nightsPerWeek * input.weeksPerYear;
  const vipGmv = venueNights * input.vipGmvPerVenueNight * input.vipActiveNightShare;
  const gaGmv = venueNights * input.gaGmvPerVenueNight;
  const nonNightclubEvents = venueNights * input.nonNightclubEventsPerNightclubEvent;
  const nonNightclubGmv = nonNightclubEvents * input.nonNightclubGmvPerEvent;
  const faceValueGmv = vipGmv + gaGmv + nonNightclubGmv;
  const vipTransactions = vipGmv / input.averageVipTransaction;
  const gaTransactions = gaGmv / input.averageGaTransaction;
  const nonNightclubTransactions = nonNightclubGmv / input.averageNonNightclubTransaction;
  const transactions = vipTransactions + gaTransactions + nonNightclubTransactions;

  const buyerFees = faceValueGmv * input.buyerFeeRate + transactions * input.buyerFixedFee;
  const customerCheckoutVolume = faceValueGmv + buyerFees;
  const stripeCosts = customerCheckoutVolume * input.stripeRate + transactions * input.stripeFixedFee;

  const vipGrossKickbacks = vipTransactions * input.promoterAttributedTransactionShare * input.vipGrossPromoterKickback;
  const gaGrossKickbacks = gaTransactions * input.promoterAttributedTransactionShare * input.gaGrossPromoterKickback;
  const grossPromoterKickbacks = vipGrossKickbacks + gaGrossKickbacks;
  const promoterServiceFeeRevenue = grossPromoterKickbacks * input.nitewideKickbackFeeRate;
  const promoterNetRewards = grossPromoterKickbacks - promoterServiceFeeRevenue;

  const premiumOrganizations = input.venues * input.premiumAdoptionShare;
  const premiumRevenue = premiumOrganizations * input.premiumMonthlyPrice * 12;
  const freeOrganizations = input.venues - premiumOrganizations;
  const customerDiscoveryPageviews = transactions / input.customerPurchaseConversionRate;
  const customerAdSlots = customerAdSlotsPerPage(input);
  const customerAdRequests = customerDiscoveryPageviews * customerAdSlots;
  const customerAdsenseRevenue = customerAdRequests * input.adsenseFillRate * input.adsenseViewabilityRate * input.customerAdEcpm / 1_000;
  const businessEligiblePageviews = freeOrganizations * input.freeBusinessPageviewsPerOrganizationMonth * 12;
  const businessAdRequests = businessEligiblePageviews * input.businessAdSlotsPerEligiblePage;
  const businessAdsenseRevenue = businessAdRequests * input.adsenseFillRate * input.adsenseViewabilityRate * input.businessAdEcpm / 1_000;
  const adsenseRevenue = customerAdsenseRevenue + businessAdsenseRevenue;
  const aggregatedInsightsRevenue = input.aggregatedInsightsCustomers * input.aggregatedInsightsMonthlyPrice * 12;
  const privacySafeMonetizationRevenue = adsenseRevenue + aggregatedInsightsRevenue;
  const grossPlatformRevenue = buyerFees + promoterServiceFeeRevenue + premiumRevenue + privacySafeMonetizationRevenue;
  const processorAdjustedContribution = grossPlatformRevenue - stripeCosts;
  const otherDirectCostReserve = faceValueGmv * input.otherDirectCostReserveRate;
  const adsAndInsightsDirectCosts = privacySafeMonetizationRevenue * input.adsAndInsightsDirectCostRate;
  const operatingContribution = processorAdjustedContribution - otherDirectCostReserve - adsAndInsightsDirectCosts - input.annualOperatingBudget;
  const requiredRevenueMultiple = input.valuationGoal / grossPlatformRevenue;

  return {
    venueNights,
    vipGmv,
    gaGmv,
    nonNightclubEvents,
    nonNightclubGmv,
    faceValueGmv,
    vipTransactions,
    gaTransactions,
    nonNightclubTransactions,
    transactions,
    buyerFees,
    customerCheckoutVolume,
    stripeCosts,
    grossPromoterKickbacks,
    promoterServiceFeeRevenue,
    promoterNetRewards,
    premiumOrganizations,
    premiumRevenue,
    freeOrganizations,
    customerDiscoveryPageviews,
    customerAdSlots,
    customerAdRequests,
    customerAdsenseRevenue,
    businessEligiblePageviews,
    businessAdRequests,
    businessAdsenseRevenue,
    adsenseRevenue,
    adNetwork: input.adNetwork,
    aggregatedInsightsRevenue,
    personalDataSaleRevenue: 0,
    privacySafeMonetizationRevenue,
    grossPlatformRevenue,
    processorAdjustedContribution,
    otherDirectCostReserve,
    adsAndInsightsDirectCosts,
    annualOperatingBudget: input.annualOperatingBudget,
    operatingContribution,
    requiredRevenueMultiple,
  };
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

if (require.main === module) {
  const result = calculate();
  console.table({
    'Face-value GMV': currency(result.faceValueGmv),
    'Non-nightclub events': Math.round(result.nonNightclubEvents).toLocaleString('en-US'),
    'Non-nightclub GMV': currency(result.nonNightclubGmv),
    'Modeled transactions': Math.round(result.transactions).toLocaleString('en-US'),
    'Buyer service fees': currency(result.buyerFees),
    'Nitewide promoter fees': currency(result.promoterServiceFeeRevenue),
    'Premium subscription revenue': currency(result.premiumRevenue),
    'Contextual AdSense revenue': currency(result.adsenseRevenue),
    'Aggregated insights revenue': currency(result.aggregatedInsightsRevenue),
    'Personal-data sale revenue': currency(result.personalDataSaleRevenue),
    'Gross platform revenue': currency(result.grossPlatformRevenue),
    'Stripe processing estimate': currency(result.stripeCosts),
    'Processor-adjusted contribution': currency(result.processorAdjustedContribution),
    'Other direct-cost reserve': currency(result.otherDirectCostReserve),
    'Annual operating budget': currency(result.annualOperatingBudget),
    'Illustrative operating contribution': currency(result.operatingContribution),
    'Revenue multiple required for $50M': `${result.requiredRevenueMultiple.toFixed(1)}x`,
  });
}

module.exports = { assumptions, calculate, customerAdSlotsPerPage };
