const { Op } = require('sequelize');
const { notFound, conflict, forbidden } = require('../domain/errors');
const { createPasswordRecord } = require('./auth-service');

const plain = (record) => record?.toJSON ? record.toJSON() : record;
const money = (value) => Number(value || 0);

function aggregateAdminSales(orders) {
  const daily = new Map();
  const events = new Map();
  const organizations = new Map();
  const summary = { orders: 0, grossSalesCents: 0, platformFeesCents: 0, affiliateCommissionsCents: 0 };
  for (const raw of orders) {
    const order = plain(raw);
    summary.orders += 1;
    summary.grossSalesCents += money(order.totalCents);
    summary.platformFeesCents += money(order.platformFeeCents);
    summary.affiliateCommissionsCents += money(order.affiliateCommissionCents);
    const date = new Date(order.paidAt || order.createdAt).toISOString().slice(0, 10);
    const event = plain(order.event) || {};
    const organization = plain(event.organization) || {};
    const add = (map, id, label) => {
      const row = map.get(id) || { id, label, orders: 0, salesCents: 0 };
      row.orders += 1; row.salesCents += money(order.totalCents); map.set(id, row);
    };
    add(daily, date, date);
    add(events, event.id || 'unknown', event.title || 'Unknown event');
    add(organizations, organization.id || 'independent', organization.name || 'Independent creators');
  }
  const values = (map) => [...map.values()].sort((a, b) => b.salesCents - a.salesCents);
  return { summary, daily: [...daily.values()].sort((a, b) => a.id.localeCompare(b.id)), events: values(events), organizations: values(organizations) };
}

function createAdminService({ models, permissions }) {
  async function workspace(userId, query) {
    await permissions.assertInternal(userId);
    const since = new Date(Date.now() - query.days * 86400000);
    const search = query.search ? `%${query.search}%` : null;
    const userWhere = search ? { [Op.or]: [{ email: { [Op.iLike]: search } }, { displayName: { [Op.iLike]: search } }] } : {};
    const orgWhere = search ? { [Op.or]: [{ name: { [Op.iLike]: search } }, { slug: { [Op.iLike]: search } }] } : {};
    const eventWhere = search ? { [Op.or]: [{ title: { [Op.iLike]: search } }, { category: { [Op.iLike]: search } }] } : {};
    const reportEventIds = query.organizationId ? (await models.Event.findAll({ where: { organizationId: query.organizationId }, attributes: ['id'] })).map((event) => event.id) : null;
    const baseEventInclude = [
      { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'planTier', 'status'], required: false },
      { model: models.Location, as: 'location', attributes: ['id', 'name', 'city', 'region', 'timezone'], required: false },
    ];
    const orderInclude = [
      { model: models.User, as: 'buyer', attributes: ['id', 'email', 'displayName'] },
      { model: models.Event, as: 'event', attributes: ['id', 'title'], include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'], required: false }] },
      { model: models.Payment, as: 'payments', attributes: ['id', 'provider', 'status', 'amountCents', 'currency', 'processedAt'] },
    ];
    const [users, organizations, events, orders, audit, paidOrders, counts] = await Promise.all([
      models.User.findAll({ where: userWhere, attributes: ['id', 'email', 'displayName', 'phone', 'isActive', 'isInternalAdmin', 'createdAt', 'updatedAt'], order: [['createdAt', 'DESC']], limit: query.limit }),
      models.Organization.findAll({ where: orgWhere, attributes: ['id', 'name', 'slug', 'description', 'planTier', 'status', 'createdAt', 'updatedAt'], order: [['createdAt', 'DESC']], limit: query.limit }),
      models.Event.findAll({ where: eventWhere, attributes: ['id', 'creatorUserId', 'organizationId', 'title', 'slug', 'summary', 'description', 'category', 'status', 'startsAt', 'endsAt', 'capacity', 'guestlistCapacity', 'isDiscoverable', 'version', 'createdAt', 'updatedAt'], include: baseEventInclude, order: [['startsAt', 'DESC']], limit: query.limit }),
      models.Order.findAll({ attributes: ['id', 'buyerUserId', 'eventId', 'status', 'currency', 'subtotalCents', 'platformFeeCents', 'totalCents', 'affiliateCommissionCents', 'paidAt', 'createdAt', 'updatedAt'], include: orderInclude, order: [['createdAt', 'DESC']], limit: query.limit }),
      models.AuditLog.findAll({ attributes: ['id', 'actorUserId', 'organizationId', 'entityType', 'entityId', 'action', 'before', 'after', 'createdAt'], include: [{ model: models.User, as: 'actor', attributes: ['id', 'email', 'displayName'], required: false }], order: [['createdAt', 'DESC']], limit: query.limit }),
      models.Order.findAll({ where: { status: 'paid', paidAt: { [Op.gte]: since }, ...(reportEventIds ? { eventId: { [Op.in]: reportEventIds } } : {}) }, attributes: ['id', 'totalCents', 'platformFeeCents', 'affiliateCommissionCents', 'paidAt', 'createdAt'], include: [{ model: models.Event, as: 'event', attributes: ['id', 'title'], include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'], required: false }] }] }),
      Promise.all([
        models.User.count(), models.User.count({ where: { isActive: true } }), models.User.count({ where: { isInternalAdmin: true } }),
        models.Organization.count(), models.Organization.count({ where: { status: 'suspended' } }), models.Organization.count({ where: { planTier: 'premium' } }),
        models.Event.count(), models.Event.count({ where: { status: 'published' } }), models.Event.count({ where: { status: 'draft' } }),
        models.Order.count(), models.Order.count({ where: { status: 'paid' } }), models.Payment.count({ where: { status: 'failed' } }),
        models.GuestlistEntry.count({ where: { status: 'pending' } }), models.CheckIn.count({ where: { checkedInAt: { [Op.gte]: since } } }),
      ]),
    ]);
    const [userCount, activeUsers, admins, orgCount, suspendedOrgs, premiumOrgs, eventCount, publishedEvents, draftEvents, orderCount, paidOrderCount, failedPayments, pendingGuestlist, checkIns] = counts;
    return {
      generatedAt: new Date().toISOString(), periodDays: query.days, reportOrganizationId: query.organizationId || null,
      stats: { users: userCount, activeUsers, admins, organizations: orgCount, suspendedOrganizations: suspendedOrgs, premiumOrganizations: premiumOrgs, events: eventCount, publishedEvents, draftEvents, orders: orderCount, paidOrders: paidOrderCount, failedPayments, pendingGuestlist, checkIns },
      sales: aggregateAdminSales(paidOrders),
      alerts: [
        { id: 'failed-payments', label: 'Failed payments', count: failedPayments, severity: failedPayments ? 'high' : 'clear' },
        { id: 'guestlist', label: 'Guestlist approvals', count: pendingGuestlist, severity: pendingGuestlist ? 'normal' : 'clear' },
        { id: 'organizations', label: 'Suspended organizations', count: suspendedOrgs, severity: suspendedOrgs ? 'high' : 'clear' },
        { id: 'draft-events', label: 'Draft events', count: draftEvents, severity: draftEvents ? 'normal' : 'clear' },
      ],
      users: users.map(plain), organizations: organizations.map(plain), events: events.map(plain), orders: orders.map(plain), audit: audit.map(plain),
    };
  }

  async function update(userId, entityType, entityId, input) {
    await permissions.assertInternal(userId);
    const configs = {
      user: { model: models.User, audit: 'User', protected: ['email'] },
      organization: { model: models.Organization, audit: 'Organization', protected: ['slug'] },
      event: { model: models.Event, audit: 'Event', protected: ['creatorUserId', 'organizationId', 'locationId', 'slug'] },
    };
    const config = configs[entityType];
    const record = await config.model.findByPk(entityId);
    if (!record) throw notFound(config.audit);
    if (entityType === 'user' && entityId === userId && (input.isInternalAdmin === false || input.isActive === false)) throw conflict('You cannot disable your own administrator access', 'SELF_ADMIN_LOCKOUT');
    if (entityType === 'user' && record.isInternalAdmin && record.isActive && (input.isInternalAdmin === false || input.isActive === false) && await models.User.count({ where: { isInternalAdmin: true, isActive: true } }) <= 1) throw conflict('At least one active administrator is required', 'LAST_ADMIN');
    const { reason, ...changes } = input;
    if (entityType === 'event') {
      const startsAt = changes.startsAt || record.startsAt;
      const endsAt = changes.endsAt || record.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) throw conflict('Event end must be after its start', 'INVALID_EVENT_TIME');
      if (changes.guestlistCapacity !== undefined && changes.guestlistCapacity < record.guestlistCapacity) {
        const approved = await models.GuestlistEntry.sum('partySize', { where: { eventId: entityId, source: 'event', status: { [Op.in]: ['confirmed', 'checked_in'] } } }) || 0;
        if (changes.guestlistCapacity < approved) throw conflict('Guestlist capacity cannot fall below approved guests', 'GUESTLIST_CAPACITY');
      }
      if (changes.capacity !== undefined && changes.capacity !== null && (record.capacity === null || changes.capacity < record.capacity)) {
        const soldAdmissions = await models.Ticket.count({ where: { eventId: entityId, status: { [Op.in]: ['valid', 'checked_in', 'transferred'] } } });
        if (changes.capacity < soldAdmissions) throw conflict('Event capacity cannot fall below issued tickets', 'EVENT_CAPACITY');
      }
    }
    const before = plain(record);
    await models.User.sequelize.transaction(async (transaction) => {
      await record.update(changes, { transaction });
      await models.AuditLog.create({
        actorUserId: userId, organizationId: record.organizationId || null, entityType: config.audit, entityId,
        action: `admin.${entityType}.updated`, before, after: { ...plain(record), adminReason: reason },
      }, { transaction });
    });
    return plain(record);
  }
  async function createDemoUser(userId, input) {
    await permissions.assertInternal(userId);
    if (process.env.NODE_ENV === 'production') throw forbidden('Demo user creation is disabled in production');
    const password = await createPasswordRecord(input.password);
    return models.User.sequelize.transaction(async (transaction) => {
      const user = await models.User.create({ email: input.email, displayName: input.displayName, isInternalAdmin: input.role === 'internal_admin' }, { transaction });
      await models.UserCredential.create({ userId: user.id, ...password }, { transaction });
      if (['organization_owner', 'venue_manager'].includes(input.role)) {
        const organization = await models.Organization.findByPk(input.organizationId, { transaction });
        if (!organization) throw notFound('Organization');
        await models.OrganizationOwner.create({ organizationId: input.organizationId, userId: user.id, role: input.role === 'organization_owner' ? 'owner' : 'admin' }, { transaction });
      }
      if (input.role === 'employee') await models.OrganizationEmployee.create({ organizationId: input.organizationId, userId: user.id, status: 'active' }, { transaction });
      if (input.role === 'organization_promoter') {
        const organization = await models.Organization.findByPk(input.organizationId, { transaction });
        if (!organization) throw notFound('Organization');
        await models.OrgAffiliate.create({ organizationId: input.organizationId, userId: user.id, code: `demo-${user.id.slice(0, 8)}`, defaultCommissionBps: 1000, defaultGuestlistAllocation: 20, status: 'active' }, { transaction });
      }
      if (input.role === 'event_promoter') {
        const event = await models.Event.findByPk(input.eventId, { transaction });
        if (!event) throw notFound('Event');
        await models.EventAffiliate.create({ eventId: input.eventId, userId: user.id, code: `demo-${user.id.slice(0, 8)}`, commissionBps: 1000, guestlistAllocation: 20, status: 'active' }, { transaction });
      }
      if (input.role === 'event_creator') {
        const start = new Date(Date.now() + 14 * 86400000); const end = new Date(start.getTime() + 4 * 3600000);
        await models.Event.create({ creatorUserId: user.id, organizationId: null, title: `${input.displayName} Demo Event`, slug: `demo-${user.id.slice(0, 8)}`, summary: 'Admin-created demo event', description: 'Draft fixture for testing the independent creator workflow.', category: 'other', status: 'draft', startsAt: start, endsAt: end, guestlistCapacity: 0, isDiscoverable: false }, { transaction });
      }
      await models.AuditLog.create({ actorUserId: userId, organizationId: input.organizationId || null, entityType: 'User', entityId: user.id, action: 'admin.demo_user.created', after: { email: input.email, displayName: input.displayName, role: input.role, organizationId: input.organizationId || null, eventId: input.eventId || null } }, { transaction });
      return { id: user.id, email: user.email, displayName: user.displayName, role: input.role };
    });
  }
  return { workspace, createDemoUser, updateUser: (u, id, v) => update(u, 'user', id, v), updateOrganization: (u, id, v) => update(u, 'organization', id, v), updateEvent: (u, id, v) => update(u, 'event', id, v) };
}

module.exports = { aggregateAdminSales, createAdminService };
