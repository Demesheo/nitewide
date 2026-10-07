const { z } = require('zod');
const crypto = require('node:crypto');
const { document, TERMS_VERSION } = require('../../../shared/legal/terms.cjs');

const termsAcceptanceFields = {
  termsAccepted: z.literal(true).describe('Explicit acceptance; required for new accounts, never inferred from marketing consent.'),
  termsVersion: z.literal(TERMS_VERSION).describe('Version displayed to the user. Stale versions must be reviewed again.'),
};
const termsAcceptanceSchema = z.object(termsAcceptanceFields);
const documentSha256 = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');

async function recordTermsAcceptance(models, userId, input, source, acceptedAt, transaction) {
  termsAcceptanceSchema.parse(input);
  await models.AuditLog.create({
    actorUserId: userId, entityType: 'User', entityId: userId, action: 'account.terms_accepted',
    after: { version: TERMS_VERSION, documentSha256, acceptedAt: acceptedAt.toISOString(), source, explicitAcceptance: true },
  }, { transaction });
}

module.exports = { termsAcceptanceFields, termsAcceptanceSchema, recordTermsAcceptance, TERMS_VERSION, documentSha256 };
