'use strict';

const assumptions = Object.freeze({
  venues: 80,
  nightsPerWeek: 4,
  weeksPerYear: 52,
  vipGmvPerVenueNight: 5_000,
  vipActiveNightShare: 1 / 3,
  averageVipTransaction: 150,
  gaGmvPerVenueNight: 300,
  averageGaTransaction: 20,
  buyerFeeRate: 0.075,
  buyerFixedFee: 0.85,
  promoterAttributedTransactionShare: 0.25,
  vipGrossPromoterKickback: 50,
  gaGrossPromoterKickback: 5,
  nitewideKickbackFeeRate: 0.10,
  premiumAdoptionShare: 0.50,
  premiumMonthlyPrice: 249,
  stripeRate: 0.029,
  stripeFixedFee: 0.30,
  otherDirectCostReserveRate: 0.005,
  annualOperatingBudget: 300_000,
  valuationGoal: 50_000_000,
});

function calculate(input = assumptions) {
  const venueNights = input.venues * input.nightsPerWeek * input.weeksPerYear;
  const vipGmv = venueNights * input.vipGmvPerVenueNight * input.vipActiveNightShare;
  const gaGmv = venueNights * input.gaGmvPerVenueNight;
  const faceValueGmv = vipGmv + gaGmv;
  const vipTransactions = vipGmv / input.averageVipTransaction;
  const gaTransactions = gaGmv / input.averageGaTransaction;
  const transactions = vipTransactions + gaTransactions;

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
  const grossPlatformRevenue = buyerFees + promoterServiceFeeRevenue + premiumRevenue;
  const processorAdjustedContribution = grossPlatformRevenue - stripeCosts;
  const otherDirectCostReserve = faceValueGmv * input.otherDirectCostReserveRate;
  const operatingContribution = processorAdjustedContribution - otherDirectCostReserve - input.annualOperatingBudget;
  const requiredRevenueMultiple = input.valuationGoal / grossPlatformRevenue;

  return {
    venueNights,
    vipGmv,
    gaGmv,
    faceValueGmv,
    vipTransactions,
    gaTransactions,
    transactions,
    buyerFees,
    customerCheckoutVolume,
    stripeCosts,
    grossPromoterKickbacks,
    promoterServiceFeeRevenue,
    promoterNetRewards,
    premiumOrganizations,
    premiumRevenue,
    grossPlatformRevenue,
    processorAdjustedContribution,
    otherDirectCostReserve,
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
    'Modeled transactions': Math.round(result.transactions).toLocaleString('en-US'),
    'Buyer service fees': currency(result.buyerFees),
    'Nitewide promoter fees': currency(result.promoterServiceFeeRevenue),
    'Premium subscription revenue': currency(result.premiumRevenue),
    'Gross platform revenue': currency(result.grossPlatformRevenue),
    'Stripe processing estimate': currency(result.stripeCosts),
    'Processor-adjusted contribution': currency(result.processorAdjustedContribution),
    'Other direct-cost reserve': currency(result.otherDirectCostReserve),
    'Annual operating budget': currency(result.annualOperatingBudget),
    'Illustrative operating contribution': currency(result.operatingContribution),
    'Revenue multiple required for $50M': `${result.requiredRevenueMultiple.toFixed(1)}x`,
  });
}

module.exports = { assumptions, calculate };
