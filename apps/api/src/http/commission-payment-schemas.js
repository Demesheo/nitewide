const { z } = require('zod');
const commissionProfileInput = z.object({ displayName: z.string().trim().min(1).max(160), idempotencyKey: z.uuid() }).strict();
const statementSelection = z.object({ statementIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Select each event statement once'), paymentMethod: z.enum(['card', 'us_bank_account']) }).strict();
const commissionApproval = statementSelection.extend({ idempotencyKey: z.uuid(), approvedTotalCents: z.number().int().min(50).max(99_999_999), feeEstimateAcknowledged: z.literal(true) }).strict();
const commissionPage = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), recipientUserId: z.uuid().optional(), currency: z.string().regex(/^[A-Za-z]{3}$/).transform(v => v.toUpperCase()).optional() }).strict();
const ownCommissionPage = commissionPage.omit({ recipientUserId: true }).extend({ organizationId: z.union([z.uuid(), z.literal('independent')]).optional() }).strict();
const commissionControl = z.object({}).strict();
const commissionOnboardingInput = z.object({ returnTo: z.enum(['business', 'customer']).default('customer') }).strict();
const commissionFeeReviewInput = z.object({ invoicingFeeCents: z.number().int().min(0).max(99_999_999), evidenceReference: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(1000), idempotencyKey: z.uuid() }).strict();
const time = z.iso.datetime({ offset: true }), cents = z.number().int().nonnegative(), uuid = z.uuid();
const eligibility = z.object({ eligible: z.boolean(), status: z.string(), reasonCode: z.string().nullable(), reason: z.string().nullable(), effectiveCommissionBps: cents.nullable() }).strict();
const commissionProfileResponse = z.object({ id: uuid.optional(), userId: uuid.optional(), displayName: z.string().optional(), creationRequestId: uuid.optional(), status: z.enum(['not_connected', 'active', 'inactive']),
  providerMode: z.literal('test'), stripeAccountId: z.string().nullable().optional(), verifiedAt: time.nullable().optional(),
  paymentsDisabledAt: time.nullable().optional(), deauthorizedAt: time.nullable().optional(), disconnectStatus: z.enum(['none', 'pending', 'disconnected']).optional(),
  eligibility, cardReady: z.boolean(), bankReady: z.boolean(), disconnectAvailable: z.boolean(), canAccessCommissions: z.boolean() }).strict();
const commissionOnboardingResponse = z.object({ url: z.url(), expiresAt: time }).strict();
const commissionDashboardResponse = z.object({ url: z.url() }).strict();
const commissionStatementResponse = z.object({ id: uuid, organizationId: uuid, eventId: uuid, recipientUserId: uuid, currency: z.string().length(3), eventTitle: z.string(),
  status: z.enum(['pending', 'approved']), availableAt: time, approvedAt: time.nullable(), originalCommissionCents: cents, unpaidCommissionCents: cents,
  paidCommissionCents: cents, refundedCommissionCents: cents, reservedCommissionCents: cents, businessLossCents: cents, heldCommissionCents: cents, payableCommissionCents: cents,
  recipientDisplayName: z.string().optional(), canApprove: z.boolean().optional(), approvalBlocker: z.string().nullable().optional(),
  payment: z.object({ paymentId: uuid, status: z.string(), netSettlementStatus: z.string(), feeEvidence: z.enum(['provider_verified', 'merchant_reviewed']).nullable(), providerVerificationStatus: z.string() }).strict().nullable(),
  latestPaymentAttempt: z.object({ paymentId: uuid, status: z.string(), netSettlementStatus: z.string(), feeEvidence: z.enum(['provider_verified', 'merchant_reviewed']).nullable(), providerVerificationStatus: z.string() }).strict().nullable() }).strict();
const commissionStatementPageResponse = z.object({ items: z.array(commissionStatementResponse), total: cents, page: z.number().int().positive(), pageSize: z.number().int().positive(), hasMore: z.boolean() }).strict();
const commissionInvoiceStatement = z.object({ id: uuid, eventId: uuid, eventTitle: z.string(), currency: z.string().length(3), amountCents: cents }).strict();
const commissionQuoteResponse = z.object({ recipientUserId: uuid, currency: z.string().length(3), statements: z.array(commissionInvoiceStatement), statementIds: z.array(uuid), installmentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  commissionCents: cents, estimatedFeeCents: cents, totalCents: cents, feeEstimateBasis: z.literal('sandbox_estimate'), feeReconciliationRequired: z.literal(true), paymentMethod: z.enum(['card', 'us_bank_account']) }).strict();
const commissionPaymentResponse = z.object({ paymentId: uuid, organizationId: uuid, recipientUserId: uuid, currency: z.string().length(3),
  status: z.enum(['creating', 'awaiting_payment', 'processing', 'payment_failed', 'paid_fee_review', 'paid', 'failed', 'review', 'disputed', 'reversed']),
  paymentMethod: z.enum(['card', 'us_bank_account']), hostedInvoiceUrl: z.url().nullable(), commissionCents: cents, estimatedFeeCents: cents, totalCents: cents,
  actualFeeCents: cents.nullable(), verifiedNetCents: z.number().int().nullable(), processingFeeCents: cents.nullable(), invoicingFeeCents: cents.nullable(),
  providerVerificationStatus: z.string(), feeEvidence: z.enum(['provider_verified', 'merchant_reviewed']).nullable(),
  feeReview: z.object({ invoicingFeeCents: cents, evidenceReference: z.string(), reason: z.string(), reviewedAt: time, reviewedByUserId: uuid }).strict().nullable(),
  netSettlementStatus: z.string(), residualCents: cents.nullable(), fundsReceived: z.boolean(), recipientBankPayoutVerified: z.literal(false), statements: z.array(commissionInvoiceStatement),
  approvedAt: time, errorCode: z.string().nullable(), retryable: z.boolean().optional() }).strict();
module.exports = { commissionProfileInput, statementSelection, commissionApproval, commissionPage, ownCommissionPage, commissionControl, commissionOnboardingInput, commissionFeeReviewInput,
  commissionProfileResponse, commissionOnboardingResponse, commissionDashboardResponse, commissionStatementResponse, commissionStatementPageResponse, commissionQuoteResponse, commissionPaymentResponse };
