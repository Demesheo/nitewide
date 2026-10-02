const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OrganizerThread extends Model {}
class OrganizerMessage extends Model {}
class OrganizerThreadRead extends Model {}
class OrderRefundRequest extends Model {}
function initOrganizerThread(sequelize) {
  OrganizerThread.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false, unique: true },
    eventId: { type: DataTypes.UUID, allowNull: false }, organizationId: DataTypes.UUID,
    customerUserId: { type: DataTypes.UUID, allowNull: false }, lastMessageAt: { type: DataTypes.DATE, allowNull: false },
    lastMessagePreview: { type: DataTypes.STRING(200), allowNull: false },
  }, { sequelize, modelName: 'OrganizerThread', tableName: 'organizer_threads' });
}
function initOrganizerMessage(sequelize) {
  OrganizerMessage.init({ id: id(), threadId: { type: DataTypes.UUID, allowNull: false },
    senderUserId: { type: DataTypes.UUID, allowNull: false }, senderSide: { type: DataTypes.STRING(16), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false }, kind: { type: DataTypes.STRING(16), allowNull: false },
    idempotencyKey: { type: DataTypes.UUID, allowNull: false },
  }, { sequelize, modelName: 'OrganizerMessage', tableName: 'organizer_messages',
    indexes: [{ unique: true, fields: ['sender_user_id', 'idempotency_key'] }] });
}
function initOrganizerThreadRead(sequelize) {
  OrganizerThreadRead.init({ id: id(), threadId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false }, lastReadAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, modelName: 'OrganizerThreadRead', tableName: 'organizer_thread_reads',
    indexes: [{ unique: true, fields: ['thread_id', 'user_id'] }] });
}
function initOrderRefundRequest(sequelize) {
  OrderRefundRequest.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false, unique: true },
    threadId: { type: DataTypes.UUID, allowNull: false }, customerUserId: { type: DataTypes.UUID, allowNull: false },
    kind: { type: DataTypes.STRING(16), allowNull: false }, reason: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    requestedAt: { type: DataTypes.DATE, allowNull: false }, reviewedByUserId: DataTypes.UUID,
    reviewedAt: DataTypes.DATE, resolution: DataTypes.TEXT, decisionKey: DataTypes.UUID,
  }, { sequelize, modelName: 'OrderRefundRequest', tableName: 'order_refund_requests' });
}
module.exports = { initOrganizerThread, initOrganizerMessage, initOrganizerThreadRead, initOrderRefundRequest };
