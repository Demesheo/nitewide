const { z } = require('zod');
const crypto = require('node:crypto');
const { document, TERMS_VERSION } = require('../../../shared/legal/terms.cjs');
const { document: privacy, PRIVACY_VERSION } = require('../../../shared/legal/privacy.cjs');

const termsAcceptanceFields = {
  termsAccepted: z.literal(true).describe('Explicit acceptance; required for new accounts, never inferred from marketing consent.'),
  termsVersion: z.literal(TERMS_VERSION).describe('Version displayed to the user. Stale versions must be reviewed again.'),
  privacyAcknowledged: z.literal(true).describe('Acknowledgment of the displayed privacy policy; not optional marketing consent.'),
  privacyVersion: z.literal(PRIVACY_VERSION).describe('Privacy policy version displayed with the shared signup checkbox.'),
};
const termsAcceptanceSchema = z.object(termsAcceptanceFields);
const documentSha256 = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
const privacyDocumentSha256 = crypto.createHash('sha256').update(JSON.stringify(privacy)).digest('hex');

async function recordTermsAcceptance(models, userId, input, source, acceptedAt, transaction) {
  termsAcceptanceSchema.parse(input);
  await models.AuditLog.create({
    actorUserId: userId, entityType: 'User', entityId: userId, action: 'account.terms_accepted',
    after: { version: TERMS_VERSION, documentSha256, acceptedAt: acceptedAt.toISOString(), source, explicitAcceptance: true },
  }, { transaction });
  await models.AuditLog.create({
    actorUserId: userId, entityType: 'User', entityId: userId, action: 'account.privacy_acknowledged',
    after: { version: PRIVACY_VERSION, documentSha256: privacyDocumentSha256, acknowledgedAt: acceptedAt.toISOString(), source, explicitAcknowledgment: true },
  }, { transaction });
}

module.exports = { termsAcceptanceFields, termsAcceptanceSchema, recordTermsAcceptance, TERMS_VERSION, documentSha256, PRIVACY_VERSION, privacyDocumentSha256 };
