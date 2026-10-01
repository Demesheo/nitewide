const { z } = require('zod');
const { checkout } = require('./schemas');

const paymentCheckoutSchema = checkout.omit({ payment: true }).strict();
const refundSchema = z.object({ reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(100) }).strict();
const createProfile = z.object({ name: z.string().trim().min(1).max(160), idempotencyKey: z.uuid() }).strict();
const selection = z.object({ paymentAccountId: z.uuid().nullable() }).strict();
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
const refundSummary = z.object({ refundId: z.uuid(), orderId: z.uuid(), status: z.string(), retryable: z.boolean().optional() }).strict();
const paymentAccount = z.object({ id: z.uuid(), organizationId: z.uuid(), name: z.string(), stripeAccountId: z.string().nullable(),
  mode: z.literal('test'), chargesEnabled: z.boolean(), payoutsEnabled: z.boolean(), detailsSubmitted: z.boolean(),
  cardPaymentsActive: z.boolean(), controllerMatches: z.boolean(), synchronizedAt: time.nullable(),
  lifecycleState: z.enum(['active', 'suspended', 'archived']), createdAt: time, updatedAt: time,
  requirements: z.object({ currentlyDue: z.array(z.string()), disabledReason: z.string().nullable() }).strict(),
  paymentsReady: z.boolean() }).strict();
const paymentAccountPage = z.object({ items: z.array(paymentAccount), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), pageSize: z.number().int().positive(), hasMore: z.boolean(),
  defaultPaymentAccountId: z.uuid().nullable(), canManageFinance: z.literal(true) }).strict();
const onboardingLink = z.object({ url: z.url(), expiresAt: time }).strict();
const webhookAcknowledgment = z.object({ received: z.literal(true), replayed: z.boolean().optional(), ignored: z.boolean().optional() }).strict();

module.exports = { paymentCheckoutSchema, refundSchema, createProfile, selection, paymentAccountQuery,
  paymentConfiguration, checkoutSummary, checkoutPreparation, refundSummary, paymentAccount, paymentAccountPage,
  onboardingLink, webhookAcknowledgment };
