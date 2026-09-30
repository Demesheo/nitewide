const { z } = require('zod');
const crypto = require('node:crypto');
const { Op, Transaction } = require('sequelize');
const { DomainError, conflict, notFound } = require('../domain/errors');
const { createPasswordRecord } = require('./auth-service');
const { queueEventEmail, formatTime } = require('./email-events');
const { createGuestlistService } = require('./guestlist-service');
const { createGuestlistInvitationService } = require('./guestlist-invitation-service');
const { assertUserAccessChange } = require('./admin-access-guards');
const { queueTeamInvitation, queuePromoterInvitation } = require('./business-email-events');
const { createAdminEditService, schemas: editSchemas } = require('./admin-edit-service');
const { createAdminOnboardingService, venueSchema } = require('./admin-onboarding-service');
const { active, assertActiveEvent, assertOrganizationVenue } = require('./lifecycle-service');
const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');

const text = (max = 160) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const optionalId = uuid.nullable().optional();
const integer = (min = 0, max = 1000000) => z.coerce.number().int().min(min).max(max);
const reasonSchema = text(500).min(3);
const plain = (record) => record?.toJSON ? record.toJSON() : record;
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const reference = (key, label, resource, required = true) => field(key, label, 'reference', { resource, required });
const select = (key, label, options, required = true) => field(key, label, 'select', { options, required });
const basics = ['id', 'createdAt', 'updatedAt'];
const retained = 'Financial and admission history is retained. Use the supported lifecycle workflow instead of deleting historical records.';
const cleanupPolicy = {
  User: { UserCredential: 'delete', UserActionToken: 'delete', Notification: 'delete', OrganizationEmployee: 'delete', OrganizationOwner: 'delete', OrgAffiliate: 'delete', EventAffiliate: 'delete', TeamInvitation: 'delete', AuditLog: 'unlink' },
  Organization: { OrganizationOwner: 'delete', OrganizationEmployee: 'delete', OrgAffiliate: 'delete', TeamInvitation: 'delete', AuditLog: 'unlink' },
  Event: { Offering: 'delete', EventAffiliate: 'delete', GuestlistInvitation: 'delete', TeamInvitation: 'delete', Notification: 'delete' },
};

const registry = {
  users: { model: 'User', label: 'Users', title: 'displayName', search: ['displayName', 'email'], attributes: [...basics, 'displayName', 'email', 'phone', 'isActive', 'isInternalAdmin'], fields: [field('displayName', 'Display name', 'text', { required: true }), field('email', 'Email', 'email', { required: true }), field('password', 'Initial password', 'password', { required: true, minLength: 12 }), field('phone', 'Phone'), field('isInternalAdmin', 'Internal administrator', 'checkbox')], schema: z.object({ displayName: text(120), email: z.string().trim().toLowerCase().email().max(320), password: z.string().min(12).max(128), phone: z.string().trim().max(32).optional(), isInternalAdmin: z.boolean().default(false) }), actions: [{ id: 'deactivate', label: 'Deactivate user', status: 'inactive' }], delete: true },
  organizations: { model: 'Organization', label: 'Organizations', title: 'name', search: ['name', 'slug'], attributes: [...basics, 'name', 'slug', 'description', 'locationId', 'planTier', 'status'], fields: [field('name', 'Name', 'text', { required: true }), field('slug', 'Slug', 'text', { required: true }), field('description', 'Description', 'textarea'), reference('locationId', 'Saved location', 'locations', false), reference('ownerUserId', 'Owner', 'users'), select('planTier', 'Plan', ['free', 'premium'])], schema: z.object({ name: text(), slug: text(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().max(10000).optional(), locationId: optionalId, ownerUserId: uuid, planTier: z.enum(['free', 'premium']).default('free') }), actions: [{ id: 'close', label: 'Close organization', status: 'closed' }], delete: true },
  locations: { model: 'Location', label: 'Locations', title: 'name', search: ['name', 'city'], attributes: [...basics, 'name', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode', 'timezone', 'privacy'], fields: [field('name', 'Location name'), field('addressLine1', 'Street address'), field('addressLine2', 'Address line 2'), field('city', 'City', 'text', { required: true }), field('region', 'State / region'), field('postalCode', 'Postal code'), field('countryCode', 'Country code', 'text', { required: true }), field('timezone', 'IANA timezone', 'text', { required: true }), select('privacy', 'Address privacy', ['public', 'attendees_only', 'private'])], schema: z.object({ name: z.string().trim().max(160).optional(), addressLine1: z.string().trim().max(255).optional(), addressLine2: z.string().trim().max(255).optional(), city: text(100), region: z.string().trim().max(100).optional(), postalCode: z.string().trim().max(32).optional(), countryCode: z.string().trim().length(2).toUpperCase().default('US'), timezone: text(64).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid IANA timezone'), privacy: z.enum(['public', 'attendees_only', 'private']).default('public') }), actions: [], delete: true },
  events: { model: 'Event', label: 'Events', title: 'title', search: ['title', 'slug'], attributes: [...basics, 'creatorUserId', 'organizationId', 'locationId', 'title', 'slug', 'summary', 'description', 'category', 'status', 'startsAt', 'endsAt', 'capacity', 'guestlistCapacity', 'isDiscoverable', 'version'], fields: [field('title', 'Title', 'text', { required: true }), field('slug', 'Slug', 'text', { required: true }), reference('creatorUserId', 'Creator', 'users'), reference('organizationId', 'Organization', 'organizations', false), reference('locationId', 'Location', 'locations', false), field('summary', 'Summary'), field('description', 'Description', 'textarea'), field('category', 'Category', 'text', { required: true }), field('startsAt', 'Starts', 'datetime-local', { required: true }), field('endsAt', 'Ends', 'datetime-local', { required: true }), field('capacity', 'Capacity', 'number'), field('guestlistCapacity', 'Guestlist capacity', 'number', { required: true }), field('isDiscoverable', 'Discoverable', 'checkbox')], schema: z.object({ title: text(180).min(2), slug: text(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), creatorUserId: uuid, organizationId: optionalId, locationId: optionalId, summary: z.string().trim().max(500).optional(), description: z.string().trim().max(20000).optional(), category: text(80), startsAt: z.coerce.date(), endsAt: z.coerce.date(), capacity: integer().nullable().optional(), guestlistCapacity: integer().default(0), isDiscoverable: z.boolean().default(true) }).refine((value) => value.endsAt > value.startsAt, 'Event end must be after its start'), actions: [{ id: 'cancel', label: 'Cancel event', status: 'cancelled' }], delete: true },
  offerings: { model: 'Offering', label: 'Offerings', title: 'name', search: ['name'], attributes: [...basics, 'eventId', 'name', 'description', 'kind', 'priceCents', 'currency', 'inventoryMode', 'quantityTotal', 'quantitySold', 'entriesPerUnit', 'minPerOrder', 'maxPerOrder', 'salesStartAt', 'salesEndAt', 'visibility', 'isActive'], fields: [reference('eventId', 'Event', 'events'), field('name', 'Name', 'text', { required: true }), field('description', 'Description', 'textarea'), select('kind', 'Kind', ['ticket', 'package', 'reservation']), field('priceCents', 'Price (cents)', 'number', { required: true }), field('currency', 'Currency code', 'text', { required: true }), select('inventoryMode', 'Inventory', ['finite', 'unlimited']), field('quantityTotal', 'Quantity available', 'number'), field('entriesPerUnit', 'Admissions per unit', 'number', { required: true }), field('minPerOrder', 'Minimum per order', 'number', { required: true }), field('maxPerOrder', 'Maximum per order', 'number', { required: true }), field('salesStartAt', 'Sales start', 'datetime-local'), field('salesEndAt', 'Sales end', 'datetime-local'), select('visibility', 'Visibility', ['public', 'hidden'])], schema: z.object({ eventId: uuid, name: text(), description: z.string().trim().max(10000).optional(), kind: z.enum(['ticket', 'package', 'reservation']).default('ticket'), priceCents: integer(0, 2147483647), currency: z.string().length(3).toUpperCase().default('USD'), inventoryMode: z.enum(['finite', 'unlimited']).default('finite'), quantityTotal: integer().nullable().optional(), entriesPerUnit: integer(1).default(1), minPerOrder: integer(1).default(1), maxPerOrder: integer(1).default(10), salesStartAt: z.coerce.date().optional(), salesEndAt: z.coerce.date().optional(), visibility: z.enum(['public', 'hidden']).default('public') }).refine((value) => value.maxPerOrder >= value.minPerOrder, 'Maximum must be at least the minimum').refine((value) => value.inventoryMode !== 'finite' || value.quantityTotal != null, 'Finite inventory requires a quantity').refine((value) => !value.salesStartAt || !value.salesEndAt || value.salesEndAt > value.salesStartAt, 'Sales end must be after sales start'), actions: [{ id: 'disable', label: 'Stop offering sales', status: 'inactive' }], delete: true },
  owners: { model: 'OrganizationOwner', label: 'Organization owners', title: 'userId', attributes: [...basics, 'organizationId', 'userId', 'role'], fields: [reference('organizationId', 'Organization', 'organizations'), reference('userId', 'User', 'users'), select('role', 'Role', ['owner', 'admin'])], schema: z.object({ organizationId: uuid, userId: uuid, role: z.enum(['owner', 'admin']).default('owner') }), actions: [], delete: true },
  employees: { model: 'OrganizationEmployee', label: 'Employees', title: 'userId', attributes: [...basics, 'organizationId', 'userId', 'status'], fields: [reference('organizationId', 'Organization', 'organizations'), reference('userId', 'User', 'users')], schema: z.object({ organizationId: uuid, userId: uuid }), actions: [{ id: 'deactivate', label: 'Deactivate employee', status: 'inactive' }], delete: true },
  organization_affiliates: { model: 'OrgAffiliate', label: 'Organization affiliates', title: 'code', search: ['code'], fields: [reference('organizationId', 'Organization', 'organizations'), reference('userId', 'User', 'users'), field('code', 'Affiliate code', 'text', { required: true }), field('defaultCommissionBps', 'Default commission (basis points)', 'number', { required: true }), field('defaultGuestlistAllocation', 'Default guestlist allocation', 'number', { required: true }), field('startsAt', 'Starts', 'datetime-local'), field('endsAt', 'Ends', 'datetime-local')], schema: z.object({ organizationId: uuid, userId: uuid, code: text(48), defaultCommissionBps: integer(0, 4000).default(0), defaultGuestlistAllocation: integer().default(0), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, 'End must be after start'), actions: [{ id: 'deactivate', label: 'Deactivate affiliate', status: 'inactive' }], delete: true },
  event_affiliates: { model: 'EventAffiliate', label: 'Event affiliates', title: 'code', search: ['code'], fields: [reference('eventId', 'Event', 'events'), reference('userId', 'User', 'users'), reference('orgAffiliateId', 'Organization affiliate', 'organization_affiliates', false), field('code', 'Affiliate code', 'text', { required: true }), field('commissionBps', 'Commission (basis points)', 'number'), field('guestlistAllocation', 'Guestlist allocation', 'number'), field('startsAt', 'Starts', 'datetime-local'), field('endsAt', 'Ends', 'datetime-local')], schema: z.object({ eventId: uuid, userId: uuid, orgAffiliateId: optionalId, code: text(48), commissionBps: integer(0, 4000).nullable().optional(), guestlistAllocation: integer().nullable().optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, 'End must be after start'), actions: [{ id: 'deactivate', label: 'Deactivate affiliate', status: 'inactive' }], delete: true },
  boosts: { model: 'Boost', label: 'Boosts', title: 'id', fields: [reference('eventId', 'Event', 'events'), field('startsAt', 'Starts', 'datetime-local', { required: true }), field('endsAt', 'Ends', 'datetime-local', { required: true }), field('budgetCents', 'Budget (cents)', 'number', { required: true })], schema: z.object({ eventId: uuid, startsAt: z.coerce.date(), endsAt: z.coerce.date(), budgetCents: integer(0, 2147483647) }).refine((value) => value.endsAt > value.startsAt, 'End must be after start'), actions: [{ id: 'cancel', label: 'Cancel boost', status: 'cancelled' }], delete: true },
  notifications: { model: 'Notification', label: 'In-app notifications', title: 'title', search: ['title', 'message'], attributes: [...basics, 'userId', 'eventId', 'kind', 'title', 'message', 'readAt', 'dismissedAt'], fields: [reference('userId', 'Recipient', 'users'), reference('eventId', 'Event', 'events', false), field('kind', 'Kind', 'text', { required: true }), field('title', 'Title', 'text', { required: true }), field('message', 'Message', 'textarea', { required: true })], schema: z.object({ userId: uuid, eventId: optionalId, kind: text(50), title: text(), message: text(500) }), actions: [{ id: 'dismiss', label: 'Dismiss notification' }], delete: true },
  guestlist: { model: 'GuestlistEntry', label: 'Guestlist entries', title: 'id', attributes: [...basics, 'eventId', 'userId', 'source', 'partySize', 'status', 'reviewedAt', 'reviewNote', 'checkedInAt'], fields: [reference('eventId', 'Event', 'events'), reference('userId', 'Guest', 'users'), reference('eventAffiliateId', 'Event affiliate pool', 'event_affiliates', false), field('partySize', 'Party size', 'number', { required: true })], schema: z.object({ eventId: uuid, userId: uuid, eventAffiliateId: optionalId, partySize: integer(1).default(1) }), actions: [{ id: 'approve', label: 'Approve guestlist request' }, { id: 'reject', label: 'Reject pending request' }, { id: 'cancel', label: 'Revoke unused approval' }], delete: true, unavailable: 'Capacity, affiliate allocation, and admission token rules are enforced by the guestlist workflow. Reviewed or admitted entries retain their history.' },
  guestlist_invitations: { model: 'GuestlistInvitation', label: 'Guestlist invitations', title: 'email', search: ['email', 'phone'], fields: [reference('eventId', 'Event', 'events'), reference('eventAffiliateId', 'Event affiliate pool', 'event_affiliates', false), field('email', 'Recipient email', 'email'), field('phone', 'Recipient phone (E.164)'), field('partySize', 'Party size', 'number', { required: true })], schema: z.object({ eventId: uuid, eventAffiliateId: optionalId, email: z.string().trim().toLowerCase().email().max(320).optional(), phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/).optional(), partySize: integer(1).default(1) }).refine((value) => value.email || value.phone, 'Enter a recipient email or phone'), actions: [{ id: 'revoke', label: 'Revoke pending invitation' }], delete: true, unavailable: 'Existing recipients are confirmed through the capacity-checked admission workflow; new recipients receive a one-time claim link. Accepted invitations retain their history.' },
  team_invitations: { model: 'TeamInvitation', label: 'Team invitations', title: 'email', search: ['email'], fields: [reference('organizationId', 'Organization (choose this or an event)', 'organizations', false), reference('eventId', 'Event (promoter invitations)', 'events', false), field('email', 'Recipient email', 'email', { required: true }), field('phone', 'Recipient phone'), select('role', 'Role', ['employee', 'manager', 'affiliate']), field('commissionBps', 'Event promoter commission (basis points)', 'number')], schema: z.object({ organizationId: optionalId, eventId: optionalId, email: z.string().trim().toLowerCase().email().max(320), phone: z.string().trim().max(32).optional(), role: z.enum(['employee', 'manager', 'affiliate']), commissionBps: integer(0, 4000).default(0) }).refine((value) => Boolean(value.organizationId) !== Boolean(value.eventId), 'Choose exactly one organization or event').refine((value) => !value.eventId || value.role === 'affiliate', 'Event invitations are for affiliate promoters'), actions: [{ id: 'revoke', label: 'Revoke pending invitation' }], delete: true, unavailable: 'Creating an invitation uses the existing token and email-outbox workflow. A manual one-time invitation link is shown when created; accepted invitations retain their history.' },
  media: { model: 'MediaAsset', label: 'Media assets', title: 'id', attributes: [...basics, 'uploadedByUserId', 'mimeType', 'sizeBytes', 'width', 'height'], fields: [], actions: [], delete: false, unavailable: 'Use the upload workflow to create validated image files. Storage cleanup must accompany media deletion and is not available through manual database edits.' },
  attributions: { model: 'AffiliateAttribution', label: 'Affiliate attribution history', title: 'action', fields: [], actions: [], delete: false, unavailable: 'Attributions are produced by checkout and guestlist workflows. Historical records are retained.' },
  credentials: { model: 'UserCredential', label: 'Credential records', title: 'userId', attributes: ['userId', 'passwordChangedAt', 'createdAt', 'updatedAt'], fields: [], actions: [], delete: false, unavailable: 'Password hashes are never exposed. Create credentials with a user, reset them through account recovery, or remove them with an unused user.' },
  account_tokens: { model: 'UserActionToken', label: 'Account action tokens', title: 'purpose', attributes: [...basics, 'userId', 'purpose', 'expiresAt', 'consumedAt'], fields: [], actions: [], delete: false, unavailable: 'Security tokens are generated and consumed by account workflows. Token values are never exposed; unused user deletion removes its tokens.' },
  email_outbox: { model: 'EmailOutbox', label: 'Email delivery history', title: 'templateAlias', attributes: [...basics, 'templateAlias', 'status', 'attemptCount', 'nextAttemptAt', 'expiresAt'], fields: [], actions: [], delete: false, unavailable: 'Email delivery is controlled by the outbox workflow. Encrypted message variables, recipient details, and provider identifiers are never exposed here.' },
  orders: { model: 'Order', label: 'Orders', title: 'id', attributes: [...basics, 'buyerUserId', 'eventId', 'status', 'currency', 'totalCents', 'paidAt'], fields: [], actions: [{ id: 'cancel', label: 'Cancel unfulfilled pending order' }], delete: false, unavailable: 'Orders are created through checkout. Only a pending order with no inventory-bearing items or in-flight/successful payment can be cancelled here. Paid order cancellation requires a provider refund workflow; all financial and admission histories are retained.' },
  order_items: { model: 'OrderItem', label: 'Order items', title: 'id', fields: [], actions: [], delete: false, unavailable: retained },
  payments: { model: 'Payment', label: 'Payments', title: 'id', attributes: [...basics, 'orderId', 'provider', 'status', 'amountCents', 'currency', 'processedAt'], fields: [], actions: [], delete: false, unavailable: 'Payments are recorded by checkout and the payment provider. Refund and provider changes are not available through manual database edits.' },
  tickets: { model: 'Ticket', label: 'Tickets', title: 'id', attributes: [...basics, 'eventId', 'orderItemId', 'holderUserId', 'status', 'checkedInAt'], fields: [], actions: [{ id: 'void', label: 'Void unused ticket', status: 'void' }], delete: false, unavailable: 'Ticket issuance requires checkout. Admission history is retained.' },
  check_ins: { model: 'CheckIn', label: 'Check-ins', title: 'id', fields: [], actions: [], delete: false, unavailable: 'Check-ins are produced by validated admission scans. Attendance history is retained.' },
  audit: { model: 'AuditLog', label: 'Audit history', title: 'action', attributes: ['id', 'actorUserId', 'organizationId', 'entityType', 'entityId', 'action', 'createdAt'], fields: [], actions: [], delete: false, unavailable: 'Audit records are append-only and record every administrative mutation.' },
};

// Lifecycle actions replace deletion. Domain cancellation remains independent.
for (const config of Object.values(registry)) config.delete = false;
for (const key of ['users', 'organizations', 'locations', 'events']) {
  registry[key].attributes = [...new Set([...(registry[key].attributes || []), 'lifecycleState', 'version'])];
  registry[key].actions = [...registry[key].actions.filter((action) => !['deactivate', 'close'].includes(action.id)), ...['suspend', 'archive', 'restore'].map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)} ${registry[key].label.toLowerCase()}`, lifecycle: true }))];
}
registry.users.fields = registry.users.fields.filter((item) => item.key !== 'password');
registry.locations.schema = venueSchema;
registry.locations.fields = registry.locations.fields.map((item) => ['name', 'addressLine1'].includes(item.key) ? { ...item, required: true } : item);
registry.users.schema = z.object({ displayName: text(120), email: z.string().trim().toLowerCase().email().max(320), phone: z.string().trim().max(32).optional(), isInternalAdmin: z.boolean().default(false) });
registry.users.attributes.push('independentCreator', 'onboardingPending', 'emailVerifiedAt');
registry.organizations.attributes.push('businessType');
registry.users.fields.push(field('independentCreator', 'Independent event creator', 'checkbox'));
registry.organizations.fields.push(select('businessType', 'Business type', ['organization', 'venue']), field('venueIds', 'Associated venues', 'references', { resource: 'locations' }));
registry.events.fields.push(select('status', 'Event status', ['draft', 'published', 'cancelled', 'completed']), reference('imageAssetId', 'Image asset', 'media', false));
for (const key of ['owners', 'employees', 'organization_affiliates', 'event_affiliates']) {
  if (registry[key].attributes) registry[key].attributes.push('version');
  if (key !== 'owners') registry[key].fields.push(select('status', 'Assignment status', ['active', 'inactive']));
}
registry.owners.attributes = [...basics, 'organizationId', 'userId', 'role', 'lifecycleState', 'version'];
registry.onboarding_invitations = { model: 'OnboardingInvitation', label: 'Account onboarding invitations', title: 'email', search: ['email'], attributes: [...basics, 'userId', 'email', 'accountMode', 'expiresAt', 'acceptedAt', 'revokedAt', 'version'], fields: [], actions: [], delete: false, unavailable: 'Account setup links are delivered by email only. Pending invitations can be resent or revoked through onboarding controls.' };

function createAdminManagementService({ models, permissions, email = null, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/app', guestlistService: suppliedGuestlistService = null, guestlistInvitationService: suppliedInvitationService = null, onboardingService: suppliedOnboardingService = null }) {
  const edits = createAdminEditService({ models, permissions, email, customerAppUrl });
  const onboarding = suppliedOnboardingService || createAdminOnboardingService({ models, permissions, email, customerAppUrl, businessAppUrl });
  let guestlistService = suppliedGuestlistService; let invitationService = suppliedInvitationService;
  const guestlistWorkflow = () => { if (!guestlistService) guestlistService = createGuestlistService({ sequelize: models.User.sequelize, models, email, customerAppUrl }); return guestlistService; };
  const invitationWorkflow = () => { if (!invitationService) invitationService = createGuestlistInvitationService({ sequelize: models.User.sequelize, models, permissions, email, customerAppUrl }); return invitationService; };
  const resource = (key) => { const config = registry[key]; if (!config || !models[config.model]) throw notFound('Management resource'); return config; };
  const managedModel = (config) => models[config.model].unscoped ? models[config.model].unscoped() : models[config.model];
  const attributes = (config) => (config.attributes || Object.keys(models[config.model].rawAttributes).filter((key) => !/hash|token|password|secret|metadata|snapshot|storageKey|providerReference|idempotency/i.test(key))).filter((key) => models[config.model].rawAttributes[key]);
  const safe = (config, record) => { const value = plain(record); const result = Object.fromEntries(attributes(config).map((key) => [key, value[key]])); if (config.model === 'UserCredential') result.id = value.userId; return result; };
  const querySchema = z.object({ page: integer(1).default(1), pageSize: integer(1, 100).default(25), search: z.string().trim().max(120).default(''), status: z.string().trim().max(40).default(''), sort: z.string().trim().max(40).default('createdAt'), direction: z.enum(['asc', 'desc']).default('desc') });
  const listOptions = {
    users: { statuses: { active: { isActive: true, lifecycleState: 'active' }, disabled: { isActive: false, lifecycleState: 'active' }, suspended: { lifecycleState: 'suspended' }, archived: { lifecycleState: 'archived' } }, sorts: ['createdAt', 'displayName', 'email'] },
    organizations: { statuses: { active: { status: 'active', lifecycleState: 'active' }, suspended: { [Op.or]: [{ status: 'suspended' }, { lifecycleState: 'suspended' }] }, closed: { status: 'closed' }, archived: { lifecycleState: 'archived' } }, sorts: ['createdAt', 'name', 'status'] },
    events: { statuses: { draft: { status: 'draft', lifecycleState: 'active' }, published: { status: 'published', lifecycleState: 'active' }, cancelled: { status: 'cancelled' }, completed: { status: 'completed' }, suspended: { lifecycleState: 'suspended' }, archived: { lifecycleState: 'archived' } }, sorts: ['createdAt', 'startsAt', 'title', 'status'] },
    orders: { statuses: { pending: { status: 'pending' }, paid: { status: 'paid' }, cancelled: { status: 'cancelled' }, refunded: { status: 'refunded' } }, sorts: ['createdAt', 'totalCents', 'status'] },
    audit: { statuses: {}, sorts: ['createdAt', 'action'] },
  };
  async function authorize(actor) { await permissions.assertInternal(actor); }
  async function getRecord(config, id, transaction) { const record = await managedModel(config).findByPk(uuid.parse(id), { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) }); if (!record) throw notFound(config.label); return record; }
  async function audit(actor, config, record, action, before, reason, transaction, extra = {}) { await models.AuditLog.create({ actorUserId: actor, organizationId: record.organizationId || (config.model === 'Organization' && action !== 'deleted' ? record.id : null), entityType: config.model, entityId: record.id, action: `admin.${config.model.toLowerCase()}.${action}`, before, after: { ...safe(config, record), adminReason: reason, ...extra } }, { transaction }); }
  async function metadata(actor) {
    await authorize(actor);
    return Object.entries(registry).filter(([, config]) => models[config.model]).map(([key, config]) => ({ key, label: config.label, title: config.title, fields: config.fields.filter((item) => !['password', 'venueIds', 'businessType', 'independentCreator', 'status', 'imageAssetId'].includes(item.key)), editFields: editSchemas[key] ? [...(config.fields || []).filter((item) => item.key !== 'password' && !['ownerUserId', ...(key === 'events' ? [] : ['organizationId', 'userId', 'eventId'])].includes(item.key)), ...(key === 'users' ? [field('confirmEmail', 'Confirm changed email', 'email'), field('confirmPhone', 'Confirm changed phone', 'tel')] : [])] : [], canEdit: Boolean(editSchemas[key]), actions: config.actions, canCreate: Boolean(config.schema), canDelete: false, unavailable: config.unavailable || null }));
  }
  async function list(actor, key, input) {
    await authorize(actor); const config = resource(key); const query = querySchema.parse(input);
    const where = {};
    const options = listOptions[key] || { statuses: {}, sorts: ['createdAt'] };
    if (query.status) {
      if (!Object.hasOwn(options.statuses, query.status)) throw new DomainError('Invalid status filter', { status: 422, code: 'VALIDATION_ERROR' });
      Object.assign(where, options.statuses[query.status]);
    }
    if (!options.sorts.includes(query.sort)) throw new DomainError('Invalid sort field', { status: 422, code: 'VALIDATION_ERROR' });
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      const matches = (config.search || []).map((name) => ({ [name]: { [Op.iLike]: pattern } }));
      if (uuid.safeParse(query.search).success) matches.push({ [models[config.model].rawAttributes.id ? 'id' : models[config.model].primaryKeyAttribute || 'userId']: query.search });
      if (!matches.length) return { ...query, total: 0, hasMore: false, items: [] };
      where[Op.and] = [{ [Op.or]: matches }];
    }
    const identifier = models[config.model].rawAttributes.id ? 'id' : models[config.model].primaryKeyAttribute || 'userId';
    const direction = query.direction.toUpperCase();
    const order = query.sort === identifier ? [[identifier, direction]] : [[query.sort, direction], [identifier, direction]];
    const result = await managedModel(config).findAndCountAll({ where, attributes: attributes(config), order, limit: query.pageSize, offset: (query.page - 1) * query.pageSize });
    return { ...query, total: result.count, hasMore: query.page * query.pageSize < result.count, items: result.rows.map((row) => safe(config, row)) };
  }
  async function detail(actor, key, id) { await authorize(actor); const config = resource(key); const record = await getRecord(config, id); const result = safe(config, record); if (key === 'organizations') result.venueIds = (await models.OrganizationVenue.findAll({ where: { organizationId: id } })).map((link) => link.locationId); return result; }
  async function validateReferences(config, input, transaction) {
    for (const descriptor of config.fields.filter((item) => item.type === 'reference')) {
      if (input[descriptor.key]) await getRecord(resource(descriptor.resource), input[descriptor.key], transaction);
    }
  }
  async function create(actor, key, body) {
    await authorize(actor); const config = resource(key);
    if (key === 'users') {
      const { reason, ...recipientInput } = body;
      const data = config.schema.strict().parse(recipientInput);
      const { isInternalAdmin, ...recipient } = data;
      return onboarding.create(actor, { kind: 'user', recipient, isInternalAdmin, reason });
    }
    if (!config.schema) throw conflict(config.unavailable || 'Creation is unavailable for this resource', 'MANAGED_WORKFLOW_REQUIRED');
    const { reason, ...input } = z.object({ reason: reasonSchema }).passthrough().parse(body);
    const parsed = config.schema.safeParse(input);
    if (!parsed.success) throw parsed.error;
    const allowed = new Set(config.fields.map((item) => item.key));
    if (Object.keys(input).some((name) => !allowed.has(name))) throw conflict('Unsupported creation field', 'PROTECTED_FIELD');
    if (key === 'guestlist') {
      await validateReferences(config, parsed.data);
      const affiliate = parsed.data.eventAffiliateId ? await getRecord(resource('event_affiliates'), parsed.data.eventAffiliateId) : null;
      if (affiliate && affiliate.eventId !== parsed.data.eventId) throw conflict('Affiliate must belong to the selected event', 'AFFILIATE_PARENT_MISMATCH');
      const result = await guestlistWorkflow().request({ eventId: parsed.data.eventId, userId: parsed.data.userId, partySize: parsed.data.partySize, affiliateCode: affiliate?.code }, { onCreated: async (entry, event, transaction) => { if (new Date(event.endsAt) <= new Date()) throw conflict('Guestlist requests are closed for ended events', 'GUESTLIST_CLOSED'); await audit(actor, config, entry, 'created', null, reason, transaction); } });
      return safe(config, result.entry);
    }
    if (key === 'guestlist_invitations') {
      await validateReferences(config, parsed.data); let createdInvitation;
      const result = await invitationWorkflow().invite(actor, parsed.data.eventId, { ...parsed.data, pool: parsed.data.eventAffiliateId ? 'own' : 'direct' }, {
        resolvePool: async (inviter, eventId, values) => {
          await authorize(inviter);
          if (!values.eventAffiliateId) return null;
          const affiliate = await getRecord(resource('event_affiliates'), values.eventAffiliateId);
          if (affiliate.eventId !== eventId || affiliate.status !== 'active' || (affiliate.startsAt && new Date(affiliate.startsAt) > new Date()) || (affiliate.endsAt && new Date(affiliate.endsAt) <= new Date())) throw conflict('Select an active affiliate pool belonging to this event', 'AFFILIATE_PARENT_MISMATCH');
          return affiliate.id;
        },
        onCreated: async (invitation, event, transaction) => {
          if (invitation.eventAffiliateId) {
            const affiliate = await getRecord(resource('event_affiliates'), invitation.eventAffiliateId, transaction);
            if (affiliate.eventId !== event.id || affiliate.status !== 'active') throw conflict('Affiliate pool changed. Reload and choose a valid pool.', 'AFFILIATE_PARENT_MISMATCH');
          }
          createdInvitation = safe(config, invitation); await audit(actor, config, invitation, 'created', null, reason, transaction);
        },
      });
      const url = result.token ? new URL(customerAppUrl) : null; if (url) url.searchParams.set('guestlistInvite', result.token);
      return { ...(createdInvitation || result.invitation), handoff: { url: url?.toString() || null, message: result.entryId ? 'The existing recipient has been confirmed through the guestlist admission workflow.' : 'Share this claim link with the intended recipient. Capacity is checked when they claim it.' } };
    }
    return models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const data = parsed.data; await validateReferences(config, data, transaction);
      let credentials;
      if (key === 'users') { credentials = await createPasswordRecord(data.password); delete data.password; }
      let ownerUserId;
      if (key === 'organizations') { ownerUserId = data.ownerUserId; delete data.ownerUserId; }
      if (key === 'events' && data.organizationId) {
        const organization = await getRecord(resource('organizations'), data.organizationId, transaction);
        if (!organization.locationId) throw conflict('Save an organization location before creating its event', 'ORGANIZATION_LOCATION_REQUIRED');
        data.locationId = data.locationId || organization.locationId;
        await assertOrganizationVenue(models, organization, data.locationId, transaction);
      }
      if (key === 'offerings') {
        const event = await getRecord(resource('events'), data.eventId, transaction);
        if (['cancelled', 'completed'].includes(event.status) || new Date(event.endsAt) <= new Date()) throw conflict('Sales cannot be created for a cancelled, completed, or ended event', 'EVENT_NOT_EDITABLE');
      }
      if (key === 'events' && new Date(data.endsAt) <= new Date()) throw conflict('Past events cannot be created', 'EVENT_FINISHED');
      if (key === 'event_affiliates' && data.orgAffiliateId) {
        const event = await getRecord(resource('events'), data.eventId, transaction);
        const affiliate = await getRecord(resource('organization_affiliates'), data.orgAffiliateId, transaction);
        if (affiliate.organizationId !== event.organizationId || affiliate.userId !== data.userId) throw conflict('Organization affiliate must belong to this event organization and selected user', 'AFFILIATE_PARENT_MISMATCH');
      }
      if (key === 'boosts') {
        const event = await getRecord(resource('events'), data.eventId, transaction);
        if (['cancelled', 'completed'].includes(event.status) || new Date(event.endsAt) <= new Date()) throw conflict('Boost requires an upcoming active event', 'EVENT_NOT_EDITABLE');
        data.organizationId = event.organizationId;
      }
      let handoff;
      if (key === 'team_invitations') {
        const event = data.eventId ? await getRecord(resource('events'), data.eventId, transaction) : null;
        if (event && (event.status === 'completed' || new Date(event.endsAt) <= new Date())) throw conflict('Past events cannot receive new team invitations', 'EVENT_FINISHED');
        const token = crypto.randomBytes(32).toString('base64url');
        data.invitedByUserId = actor;
        data.tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        data.expiresAt = new Date(Math.min(Date.now() + 7 * 86400000, event ? new Date(event.endsAt).getTime() : Infinity));
        const organization = data.organizationId ? await getRecord(resource('organizations'), data.organizationId, transaction) : null;
        const record = await models.TeamInvitation.create(data, { transaction });
        await audit(actor, config, record, 'created', null, reason, transaction);
        const queued = event
          ? await queuePromoterInvitation({ email, invitation: record, event, token, businessAppUrl, transaction })
          : await queueTeamInvitation({ email, invitation: record, organization, token, businessAppUrl, transaction });
        const url = new URL('/', businessAppUrl); url.searchParams.set('invite', token);
        handoff = { url: url.toString(), message: queued ? 'Invitation email is queued for delivery.' : 'Email delivery is disabled. Share this link manually with the intended recipient.' };
        return { ...safe(config, record), handoff };
      }
      const record = await models[config.model].create(data, { transaction });
      if (credentials) await models.UserCredential.create({ userId: record.id, ...credentials }, { transaction });
      if (ownerUserId) await models.OrganizationOwner.create({ organizationId: record.id, userId: ownerUserId, role: 'owner' }, { transaction });
      await audit(actor, config, record, 'created', null, reason, transaction);
      return safe(config, record);
    });
  }
  async function action(actor, key, id, actionId, body) {
    await authorize(actor); const config = resource(key);
    const lifecycle = ['suspend', 'archive', 'restore'].includes(actionId);
    const input = (lifecycle ? z.object({ reason: reasonSchema, version: z.number().int().min(0) }).strict() : z.object({ reason: reasonSchema }).strict()).parse(body);
    if (!config.actions.some((action) => action.id === actionId)) throw conflict('This transition is unavailable', 'UNSUPPORTED_TRANSITION');
    if (lifecycle) return models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const record = await getRecord(config, id, transaction);
      if ((record.version ?? 0) !== input.version) throw conflict('This record changed. Refresh first.', 'STALE_VERSION');
      const before = safe(config, record); const lifecycleState = actionId === 'restore' ? 'active' : actionId === 'archive' ? 'archived' : 'suspended';
      if (record.lifecycleState === lifecycleState) return before;
      const changes = { lifecycleState };
      if (key === 'users') { changes.isActive = lifecycleState === 'active'; await assertUserAccessChange({ models, actorUserId: actor, user: record, changes, transaction }); }
      if (key === 'organizations') changes.status = lifecycleState === 'active' ? 'active' : lifecycleState === 'archived' ? 'closed' : 'suspended';
      if (key === 'events' && actionId === 'restore') {
        if (record.organizationId) { const parent = await getRecord(resource('organizations'), record.organizationId, transaction); if (!active(parent) || parent.status !== 'active') throw conflict('Restore the organization before its event', 'ANCESTOR_INACTIVE'); }
        else { const creator = await getRecord(resource('users'), record.creatorUserId, transaction); if (!active(creator) || !creator.isActive || creator.onboardingPending) throw conflict('Restore the independent creator before their event', 'ANCESTOR_INACTIVE'); }
        if (record.locationId && !active(await getRecord(resource('locations'), record.locationId, transaction))) throw conflict('Restore the venue before its event', 'ANCESTOR_INACTIVE');
      }
      await record.update(changes, { transaction });
      if (lifecycleState !== 'active' && ['users', 'owners'].includes(key)) await revokePendingGuestlistInvitations({ models, actorUserId: actor, transaction,
        ...(key === 'users' ? { userId: id } : { userId: record.userId, organizationId: record.organizationId }) });
      await audit(actor, config, record, actionId, before, input.reason, transaction); return safe(config, record);
    });
    if (key === 'guestlist') {
      const entry = await getRecord(config, id);
      if ((actionId === 'approve' && entry.status === 'confirmed') || (['reject', 'cancel'].includes(actionId) && entry.status === 'rejected')) return safe(config, entry);
      const result = await guestlistWorkflow().review({ eventId: entry.eventId, entryId: entry.id, reviewedByUserId: actor, decision: actionId, note: input.reason }, { onReviewed: async (updated, event, transaction) => { if (actionId === 'approve' && (event.status !== 'published' || new Date(event.endsAt) <= new Date())) throw conflict('Only an open published event can receive guestlist approvals', 'GUESTLIST_CLOSED'); await audit(actor, config, updated, actionId, safe(config, entry), input.reason, transaction); } });
      return safe(config, result.entry);
    }
    return models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const record = await getRecord(config, id, transaction); const before = safe(config, record); let changes;
      if (key === 'users') {
        changes = { isActive: false };
        await assertUserAccessChange({ models, actorUserId: actor, user: record, changes, transaction });
      } else if (key === 'offerings') changes = { isActive: false };
      else if (key === 'employees') changes = { status: 'inactive' };
      else if (['organization_affiliates', 'event_affiliates'].includes(key)) changes = { status: 'inactive' };
      else if (key === 'notifications') changes = { dismissedAt: new Date() };
      else if (key === 'boosts') {
        if (record.status === 'completed') throw conflict('Completed boosts are historical records', 'BOOST_COMPLETED');
        changes = { status: 'cancelled' };
      }
      else if (['team_invitations', 'guestlist_invitations'].includes(key)) {
        if (record.acceptedAt || record.status === 'accepted') throw conflict('An accepted invitation retains its history. Manage the resulting membership or admission instead.', 'INVITATION_ALREADY_ACCEPTED');
        if (new Date(record.expiresAt) <= new Date()) return safe(config, record);
        changes = { expiresAt: new Date(0) };
      }
      else if (key === 'organizations') changes = { status: 'closed' };
      else if (key === 'orders') {
        if (record.status === 'cancelled') return safe(config, record);
        if (record.status !== 'pending' || record.paidAt) throw conflict('Paid or refunded orders require the payment-provider refund workflow; their financial and admission histories are retained', 'ORDER_PROVIDER_WORKFLOW_REQUIRED');
        const [items, committedPayments] = await Promise.all([
          models.OrderItem.count({ where: { orderId: id }, transaction }),
          models.Payment.count({ where: { orderId: id, status: { [Op.ne]: 'failed' } }, transaction }),
        ]);
        if (items || committedPayments) throw conflict('This order has inventory-bearing items or a payment in progress. A checkout compensation workflow is required before cancellation.', 'ORDER_COMPENSATION_REQUIRED');
        changes = { status: 'cancelled' };
      }
      else if (key === 'events') {
        if (record.status === 'completed' || new Date(record.endsAt) <= new Date()) throw conflict('Completed or ended events cannot be cancelled', 'EVENT_NOT_EDITABLE');
        changes = { status: 'cancelled' };
      } else if (key === 'tickets') {
        if (record.status !== 'valid' || await models.CheckIn.count({ where: { ticketId: id }, transaction })) throw conflict('Only an unused valid ticket can be voided; checked-in history must be retained', 'TICKET_ADMISSION_HISTORY');
        changes = { status: 'void' };
      }
      if (!changes) throw conflict('Transition requires its parent workflow', 'MANAGED_WORKFLOW_REQUIRED');
      if (Object.entries(changes).every(([name, value]) => record[name] === value) || (key === 'notifications' && record.dismissedAt)) return safe(config, record);
      await record.update(changes, { transaction });
      if (['users', 'employees', 'organization_affiliates', 'event_affiliates'].includes(key)) await revokePendingGuestlistInvitations({ models, actorUserId: actor, transaction,
        ...(key === 'users' ? { userId: id } : key === 'event_affiliates' ? { eventAffiliateId: id } : { userId: record.userId, organizationId: record.organizationId }) });
      await audit(actor, config, record, actionId, before, input.reason, transaction);
      if (key === 'events' && before.status === 'published') await queueEventEmail({ email, models, event: record, kind: 'cancelled', variables: { EVENT_DATE: formatTime(before.startsAt) }, customerAppUrl, transaction, key: `admin-cancelled-${record.updatedAt.getTime()}` });
      return safe(config, record);
    });
  }
  async function remove(actor) { await authorize(actor); throw conflict('Permanent deletion is disabled. Suspend or archive to retain history.', 'HARD_DELETE_DISABLED'); }
  const mapConflict = (handler) => async (...args) => {
    try { return await handler(...args); }
    catch (error) {
      if (error.name === 'SequelizeForeignKeyConstraintError') throw conflict('A related record changed or is still required. Refresh the record and review its dependencies.', 'RELATED_RECORD_CONFLICT');
      if (error.name === 'SequelizeUniqueConstraintError') throw conflict('A record with these identifying values already exists.', 'DUPLICATE_RECORD');
      if (['40001', '40P01'].includes(error.original?.code || error.parent?.code) || error.name === 'SequelizeOptimisticLockError') throw conflict('This record changed concurrently. Refresh and try again.', 'CONCURRENT_CHANGE');
      throw error;
    }
  };
  return { metadata, list, detail, create: mapConflict(create), update: mapConflict(edits.update), action: mapConflict(action), remove: mapConflict(remove) };
}

module.exports = { createAdminManagementService, registry };
