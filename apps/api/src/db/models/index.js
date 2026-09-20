const initializers = [
  require('./User').initUser, require('./Organization').initOrganization, require('./OrganizationOwner').initOrganizationOwner,
  require('./Location').initLocation, require('./Event').initEvent, require('./OrgAffiliate').initOrgAffiliate,
  require('./EventAffiliate').initEventAffiliate, require('./Offering').initOffering, require('./Order').initOrder,
  require('./OrderItem').initOrderItem, require('./Payment').initPayment, require('./Ticket').initTicket,
  require('./GuestlistEntry').initGuestlistEntry, require('./CheckIn').initCheckIn, require('./AffiliateAttribution').initAffiliateAttribution,
  require('./AuditLog').initAuditLog, require('./Boost').initBoost,
];

function initModels(sequelize) {
  for (const initialize of initializers) initialize(sequelize);
  const m = sequelize.models;

  m.User.hasMany(m.Event, { as: 'createdEvents', foreignKey: 'creatorUserId' });
  m.Event.belongsTo(m.User, { as: 'creator', foreignKey: 'creatorUserId' });
  m.Organization.belongsToMany(m.User, { as: 'owners', through: m.OrganizationOwner, foreignKey: 'organizationId', otherKey: 'userId' });
  m.User.belongsToMany(m.Organization, { as: 'ownedOrganizations', through: m.OrganizationOwner, foreignKey: 'userId', otherKey: 'organizationId' });
  m.Organization.hasMany(m.Event, { as: 'events', foreignKey: 'organizationId' }); m.Event.belongsTo(m.Organization, { as: 'organization', foreignKey: 'organizationId' });
  m.Location.hasMany(m.Event, { as: 'events', foreignKey: 'locationId' }); m.Event.belongsTo(m.Location, { as: 'location', foreignKey: 'locationId' });
  m.Organization.hasMany(m.OrgAffiliate, { as: 'orgAffiliates', foreignKey: 'organizationId' }); m.OrgAffiliate.belongsTo(m.Organization, { as: 'organization', foreignKey: 'organizationId' });
  m.User.hasMany(m.OrgAffiliate, { as: 'orgAffiliations', foreignKey: 'userId' }); m.OrgAffiliate.belongsTo(m.User, { as: 'user', foreignKey: 'userId' });
  m.Event.hasMany(m.EventAffiliate, { as: 'eventAffiliates', foreignKey: 'eventId' }); m.EventAffiliate.belongsTo(m.Event, { as: 'event', foreignKey: 'eventId' });
  m.User.hasMany(m.EventAffiliate, { as: 'eventAffiliations', foreignKey: 'userId' }); m.EventAffiliate.belongsTo(m.User, { as: 'user', foreignKey: 'userId' });
  m.EventAffiliate.belongsTo(m.OrgAffiliate, { as: 'orgAffiliate', foreignKey: 'orgAffiliateId' });
  m.Event.hasMany(m.Offering, { as: 'offerings', foreignKey: 'eventId' }); m.Offering.belongsTo(m.Event, { as: 'event', foreignKey: 'eventId' });
  m.Event.hasMany(m.Order, { as: 'orders', foreignKey: 'eventId' }); m.Order.belongsTo(m.Event, { as: 'event', foreignKey: 'eventId' });
  m.User.hasMany(m.Order, { as: 'orders', foreignKey: 'buyerUserId' }); m.Order.belongsTo(m.User, { as: 'buyer', foreignKey: 'buyerUserId' });
  m.Order.hasMany(m.OrderItem, { as: 'items', foreignKey: 'orderId' }); m.OrderItem.belongsTo(m.Order, { as: 'order', foreignKey: 'orderId' });
  m.Offering.hasMany(m.OrderItem, { as: 'orderItems', foreignKey: 'offeringId' }); m.OrderItem.belongsTo(m.Offering, { as: 'offering', foreignKey: 'offeringId' });
  m.Order.hasMany(m.Payment, { as: 'payments', foreignKey: 'orderId' }); m.Payment.belongsTo(m.Order, { as: 'order', foreignKey: 'orderId' });
  m.OrderItem.hasMany(m.Ticket, { as: 'tickets', foreignKey: 'orderItemId' }); m.Ticket.belongsTo(m.OrderItem, { as: 'orderItem', foreignKey: 'orderItemId' });
  m.Event.hasMany(m.GuestlistEntry, { as: 'guestlistEntries', foreignKey: 'eventId' }); m.GuestlistEntry.belongsTo(m.Event, { as: 'event', foreignKey: 'eventId' });
  m.Event.hasMany(m.CheckIn, { as: 'checkIns', foreignKey: 'eventId' }); m.CheckIn.belongsTo(m.Event, { as: 'event', foreignKey: 'eventId' });
  return m;
}

module.exports = { initModels };

