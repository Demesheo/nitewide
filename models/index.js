import sequelize from '../config/database.js';
import User from './User.js';
import Organization from './Organization.js';
import Event from './Event.js';
import Guestlist from './Guestlist.js';
import Ticket from './Ticket.js';
import OrgAffiliate from './OrgAffiliate.js';
import EventAffiliate from './EventAffiliate.js';

// Initialize all models
User.initModel(sequelize);
Organization.initModel(sequelize);
Event.initModel(sequelize);
Guestlist.initModel(sequelize);
Ticket.initModel(sequelize);
OrgAffiliate.initModel(sequelize);
EventAffiliate.initModel(sequelize);

// --------------------
// Associations
// --------------------

// User → Organization
User.hasMany(Organization, { foreignKey: 'ownerId', as: 'ownedOrganizations' });
Organization.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// User → Event
User.hasMany(Event, { foreignKey: 'ownerId', as: 'ownedEvents' });
Event.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// User → Ticket
User.hasMany(Ticket, { foreignKey: 'buyerId', as: 'purchasedTickets' });
Ticket.belongsTo(User, { foreignKey: 'buyerId', as: 'buyer' });

// Event → Ticket
Event.hasMany(Ticket, { foreignKey: 'eventId', as: 'tickets' });
Ticket.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

// Event → Guestlist
Event.hasMany(Guestlist, { foreignKey: 'eventId', as: 'guestlists' });
Guestlist.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

// Guestlist → User
User.hasMany(Guestlist, { foreignKey: 'userId', as: 'guestEntries' });
Guestlist.belongsTo(User, { foreignKey: 'userId', as: 'orgAffiliate' });

// Organization → Event
Organization.hasMany(Event, { foreignKey: 'organizationId', as: 'events' });
Event.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });

// --------------------
// Affiliate associations
// --------------------

// OrgAffiliate → User & Organization
User.hasMany(OrgAffiliate, { foreignKey: 'userId', as: 'orgAffiliations' });
OrgAffiliate.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Organization.hasMany(OrgAffiliate, { foreignKey: 'organizationId', as: 'orgAffiliates' });
OrgAffiliate.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });

// EventAffiliate → User & Event
User.hasMany(EventAffiliate, { foreignKey: 'userId', as: 'eventAffiliations' });
EventAffiliate.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Event.hasMany(EventAffiliate, { foreignKey: 'eventId', as: 'eventAffiliates' });
EventAffiliate.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

export {
  sequelize,
  User,
  Organization,
  Event,
  Guestlist,
  Ticket,
  OrgAffiliate,
  EventAffiliate,
};
