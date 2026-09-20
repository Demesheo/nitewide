const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class AuditLog extends Model {}
function initAuditLog(sequelize) {
  AuditLog.init({
    id: id(), actorUserId: DataTypes.UUID, organizationId: DataTypes.UUID,
    entityType: { type: DataTypes.STRING(80), allowNull: false }, entityId: { type: DataTypes.UUID, allowNull: false }, action: { type: DataTypes.STRING(80), allowNull: false },
    before: DataTypes.JSONB, after: DataTypes.JSONB, requestId: DataTypes.STRING(100), ipAddress: DataTypes.INET,
  }, { sequelize, modelName: 'AuditLog', tableName: 'audit_logs', updatedAt: false, indexes: [{ fields: ['entity_type', 'entity_id', 'created_at'] }, { fields: ['organization_id', 'created_at'] }] });
  return AuditLog;
}
module.exports = { AuditLog, initAuditLog };

