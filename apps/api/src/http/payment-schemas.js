const { z } = require('zod');
const { checkout } = require('./schemas');

const paymentCheckoutSchema = checkout.omit({ payment: true }).strict();
const refundSchema = z.object({ reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(100) }).strict();
const createProfile = z.object({ name: z.string().trim().min(1).max(160), idempotencyKey: z.uuid() }).strict();
const selection = z.object({ paymentAccountId: z.uuid().nullable() }).strict();
const paymentControl = z.object({ reason:z.string().trim().min(3).max(500), confirmed:z.literal(true), idempotencyKey:z.uuid() }).strict();
const disconnectPermission = z.object({paymentDisconnectAuthorized:z.boolean(),reason:z.string().trim().min(3).max(500),version:z.number().int().nonnegative()}).strict();
const paymentAccountQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const time = z.iso.datetime({ offset: true });
const paymentConfiguration = z.object({ configured: z.boolean(), enabled: z.boolean(), mode: z.enum(['disabled', 'test']),
  publishableKey: z.string().nullable(), demoEnabled: z.boolean() }).strict();
const checkoutSummary = z.object({ orderId: z.uuid(), status: z.string(), verificationStatus: z.string().nullable().optional(),
  retryable: z.boolean().optional() }).strict();
const checkoutPreparation = checkoutSummary.extend({ clientSecret: z.string().optional(), stripeAccountId: z.string().optional(),
  expiresAt: time.optional() }).strict();
const checkoutResumption = checkoutPreparation.extend({ booking: z.object({
  idempotencyKey: z.string().min(8).max(100), event: z.object({ id: z.uuid(), title: z.string(), startsAt: time, endsAt: time }).passthrough(),
  subtotalCents: z.number().int().nonnegative(), totalCents: z.number().int().nonnegative(), currency: z.string().length(3),
  items: z.array(z.object({ offeringId: z.uuid(), name: z.string(), kind: z.string(), quantity: z.number().int().positive(), unitPriceCents: z.number().int().nonnegative() }).strict()),
}).strict() }).strict();
const refundSummary = z.object({ refundId: z.uuid(), orderId: z.uuid(), status: z.string(), retryable: z.boolean().optional() }).strict();
const paymentAccount = z.object({ id: z.uuid(), organizationId: z.uuid(), name: z.string(), stripeAccountId: z.string().nullable(),
  mode: z.literal('test'), chargesEnabled: z.boolean(), payoutsEnabled: z.boolean(), detailsSubmitted: z.boolean(),
  cardPaymentsActive: z.boolean(), controllerMatches: z.boolean(), synchronizedAt: time.nullable(),
  lifecycleState: z.enum(['active', 'suspended', 'archived']), createdAt: time, updatedAt: time,
  requirements: z.object({ currentlyDue: z.array(z.string()), disabledReason: z.string().nullable() }).strict(),
  paymentsDisabledAt:time.nullable(), disconnectStatus:z.enum(['none','pending','disconnected']), disconnectRequestId:z.uuid().nullable(),
  disconnectedAt:time.nullable(),disconnectErrorCode:z.string().nullable(),paymentsReady: z.boolean() }).strict();
const paymentAccountPage = z.object({ items: z.array(paymentAccount), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), pageSize: z.number().int().positive(), hasMore: z.boolean(),
  defaultPaymentAccountId: z.uuid().nullable(), canManageFinance: z.literal(true),canDisconnectPayments:z.boolean(),
  sharedSandboxAccount:z.object({stripeAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),paymentsReady:z.boolean()}).strict().optional() }).strict();
const onboardingLink = z.object({ url: z.url(), expiresAt: time }).strict();
const webhookAcknowledgment = z.object({ received: z.literal(true), replayed: z.boolean().optional(), ignored: z.boolean().optional() }).strict();
const count = z.number().int().nonnegative();
const disconnectImpact = z.object({account:paymentAccount,pendingPayments:count,reviewPayments:count,unresolvedRefunds:count,
  unfulfilledPaidBookings:count,historicalBookings:count,affectedEvents:count,blockedReasons:z.array(z.string()),
  providerDisconnectConfigured:z.boolean(),canDisconnect:z.boolean()}).strict();
const disconnectResult = z.object({account:paymentAccount,retryable:z.boolean()}).strict();
const paymentOverviewCurrency = z.object({ currency: z.string().length(3),
  collectedCents: count.describe('All-time verified sandbox customer payment totals, including subsequently refunded orders.'),
  refundedCents: count.describe('Cumulative provider-verified full and partial sandbox refunds.'),
  netCollectedCents: count.describe('Collected customer payments less verified refunds. This is not the merchant Stripe balance or net proceeds.'),
  paidOrders: count, refundedOrders: count, pendingOrders: count, reviewOrders: count }).strict();
const paymentOverview = z.object({ organizationId: z.uuid(), period: z.literal('all_time'), mode: z.literal('test'),
  currencies: z.array(paymentOverviewCurrency), pendingOrders: count, reviewOrders: count,
  merchantBalance: z.null().describe('Unavailable: merchant balances are owned by Stripe and are not tracked here.'),
  payouts: z.null().describe('Unavailable: merchant payouts are owned by Stripe and are not tracked here.') }).strict();
const earningsCurrency = z.object({ currency: z.string().length(3), verifiedEarnedCents: count, verifiedRefundedCents: count,
  demoEarnedCents: count, demoRefundedCents: count, verifiedPaidOrders: count, verifiedRefundedOrders: count,
  demoPaidOrders: count, demoRefundedOrders: count, unpaidCommissionCents: count, heldCommissionCents: count,
  payableCommissionCents: count, reservedCommissionCents: count, paidCommissionCents: count, businessLossCents: count }).strict();
const paymentEarnings = z.object({ period: z.literal('all_time'), scope: z.literal('own'), currencies: z.array(earningsCurrency),
  receivedPayouts: z.object({ currencies: z.array(z.object({currency:z.string().length(3),creditedCents:count,verifiedNetCents:count,merchantReviewedNetCents:count,feeReviewPayments:count}).strict()),bankPayouts:z.null() }).strict(),
  dashboardConnected: z.null().describe('Unavailable until individual Stripe onboarding and recipient connectivity are implemented.'),
  dashboardUrl: z.null(), payoutsUnavailableReason: z.literal('bank_payouts_not_tracked') }).strict();
const emptyPaymentQuery = z.object({}).strict();

module.exports = { paymentCheckoutSchema, refundSchema, createProfile, selection, paymentAccountQuery,
  paymentControl,disconnectPermission,disconnectImpact,disconnectResult,
  paymentConfiguration, checkoutSummary, checkoutPreparation, checkoutResumption, refundSummary, paymentAccount, paymentAccountPage,
  onboardingLink, webhookAcknowledgment, paymentOverviewCurrency, paymentOverview, earningsCurrency, paymentEarnings, emptyPaymentQuery };
