const { z } = require('zod');
const { CHECK_MESSAGES } = require('../diagnostics/payment-preflight');

const count = z.number().int().nonnegative();
const inspectionStatus = z.enum(['ready', 'blocked', 'unavailable', 'not-checked']);
// Remote CLI validation admits only fixed diagnostic vocabulary. Even a
// malformed remote response cannot introduce secret-bearing free text.
const paymentPreflightReport = z.object({
  scope: z.literal('payment-preflight'),
  mode: z.enum(['disabled', 'sandbox-ready', 'configuration-blocked']),
  checkedAt: z.iso.datetime({ offset: true }),
  checks: z.array(z.object({ code: z.enum(Object.keys(CHECK_MESSAGES)),
    status: z.enum(['pass', 'warn', 'fail', 'not-checked']), message: z.enum(Object.values(CHECK_MESSAGES)) }).strict()).max(100),
  schema: z.object({ status: inspectionStatus, missingTableCount: count, missingColumnCount: count, missingMigrationCount: count }).strict(),
  routing: z.object({ status: inspectionStatus, activePaidEventCount: count, readyEventCount: count, blockedEventCount: count,
    eventSpecificCount: count, organizationDefaultCount: count, sharedSandboxCount: count }).strict(),
  workers: z.object({ status: inspectionStatus, healthyWorkerCount: count, matchingWorkerCount: count, mismatchedWorkerCount: count }).strict(),
  runtime: z.object({ revision: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict(),
  evidence: z.object({ keyPairIdentity: z.literal('not-verified'), webhookDelivery: z.literal('not-verified'), providerReadiness: z.literal('stored-snapshot-only') }).strict(),
}).strict();
const paymentPreflightQuery = z.object({
  requirePaid: z.enum(['true', 'false']).default('false'),
  expectRevision: z.string().regex(/^[a-f0-9]{40}$/).optional(),
}).strict();

module.exports = { paymentPreflightReport, paymentPreflightQuery };
