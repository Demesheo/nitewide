const { DataTypes, Model } = require('sequelize');
const { id, basisPoints } = require('./helpers');
class OrgAffiliate extends Model {}
function initOrgAffiliate(sequelize) {
  OrgAffiliate.init({
    id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false },
    code: { type: DataTypes.STRING(48), allowNull: false, unique: true },
    defaultCommissionBps: basisPoints(false, 0),
    defaultGuestlistAllocation: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    startsAt: DataTypes.DATE, endsAt: DataTypes.DATE,
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
  }, { sequelize, modelName: 'OrgAffiliate', tableName: 'org_affiliates', indexes: [{ unique: true, fields: ['organization_id', 'user_id'] }] });
  return OrgAffiliate;
}
module.exports = { OrgAffiliate, initOrgAffiliate };

