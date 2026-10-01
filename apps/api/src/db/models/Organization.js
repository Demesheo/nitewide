const { DataTypes, Model } = require('sequelize');
const { BUSINESS_SLUG_PATTERN } = require('../../domain/business-slug');
const { id } = require('./helpers');

class Organization extends Model {}
function initOrganization(sequelize) {
  Organization.init({
    id: id(),
    lifecycleState: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'archived']] } },
    businessType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'organization', validate: { isIn: [['organization', 'venue', 'independent_creator']] } },
    onboardingEstablished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    website: { type: DataTypes.STRING(2048), allowNull: true },
    socialLinks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(180), allowNull: false, unique: true, validate: { is: BUSINESS_SLUG_PATTERN } },
    description: DataTypes.TEXT,
    locationId: { type: DataTypes.UUID, allowNull: true },
    planTier: { type: DataTypes.ENUM('free', 'premium'), allowNull: false, defaultValue: 'free' },
    status: { type: DataTypes.ENUM('active', 'suspended', 'closed'), allowNull: false, defaultValue: 'active' },
  }, { sequelize, modelName: 'Organization', tableName: 'organizations', version: true, hooks: {
    async afterSave(organization, options) {
      if (organization.locationId && sequelize.models.OrganizationVenue) await sequelize.models.OrganizationVenue.findOrCreate({ where: { organizationId: organization.id, locationId: organization.locationId }, transaction: options.transaction });
    },
  } });
  return Organization;
}
module.exports = { Organization, initOrganization };
