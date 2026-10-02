const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class CommissionPayment extends Model {}
function initCommissionPayment(sequelize) {
  CommissionPayment.init({
    id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, recipientUserId: { type: DataTypes.UUID, allowNull: false },
    individualCommissionProfileId: { type: DataTypes.UUID, allowNull: false }, stripeAccountId: { type: DataTypes.STRING(160), allowNull: false },
    providerMode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'test' }, currency: { type: DataTypes.STRING(3), allowNull: false },
    commissionCents: cents(false), feeAllowanceCents: cents(false), totalCents: cents(false),
    feePolicy: { type: DataTypes.JSONB, allowNull: false }, statementSnapshot: { type: DataTypes.JSONB, allowNull: false },
    paymentMethod: { type: DataTypes.STRING(24), allowNull: false }, idempotencyKey: { type: DataTypes.UUID, allowNull: false },
    approvalHash: { type: DataTypes.STRING(64), allowNull: false }, approvedByUserId: { type: DataTypes.UUID, allowNull: false }, approvedAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'creating' },
    providerCustomerId: DataTypes.STRING(160), providerInvoiceId: { type: DataTypes.STRING(160), unique: true },
    providerPaymentIntentId: { type: DataTypes.STRING(160), unique: true }, providerChargeId: { type: DataTypes.STRING(160), unique: true },
    providerBalanceTransactionId: { type: DataTypes.STRING(160), unique: true }, hostedInvoiceUrl: DataTypes.TEXT,
    providerVerificationStatus: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    providerFeeCents: cents(true), providerNetCents: cents(true), invoicingFeeCents: cents(true), residualCents: cents(true),
    reconciliationStatus: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'awaiting_payment' },
    releasedAt: DataTypes.DATE, errorCode: DataTypes.STRING(80), reconciledAt: DataTypes.DATE,
    invalidatedAt: DataTypes.DATE, invalidationReason: DataTypes.STRING(80), reconciliationToken: DataTypes.UUID,
    feeEvidence: DataTypes.STRING(24), feeReview: DataTypes.JSONB,
    allocationsSettledAt: DataTypes.DATE,
    verifiedObservationToken: DataTypes.UUID,
  }, { sequelize, modelName: 'CommissionPayment', tableName: 'commission_payments', indexes: [
    { unique: true, fields: ['organization_id', 'idempotency_key'] }, { fields: ['status', 'updated_at', 'id'] },
  ] });
  return CommissionPayment;
}
module.exports = { CommissionPayment, initCommissionPayment };
