const { Op, QueryTypes, Transaction } = require('sequelize');
const { notFound, conflict, forbidden } = require('../domain/errors');
const { createPasswordRecord } = require('./auth-service');
const { queueEventEmail, formatTime } = require('./email-events');
const { assertUserAccessChange } = require('./admin-access-guards');
const { activeEventScope } = require('./lifecycle-service');

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

async function loadAdminSales(models, since, organizationId = null) {
  const sequelize = models.Order.sequelize;
  const replacements = { since, organizationId };
  const fromPaidOrders = `FROM orders AS o
    JOIN events AS e ON e.id = o.event_id
    LEFT JOIN organizations AS org ON org.id = e.organization_id
    WHERE o.status = 'paid' AND o.paid_at >= :since
      AND (CAST(:organizationId AS uuid) IS NULL OR e.organization_id = CAST(:organizationId AS uuid))`;
  const select = (sql, transaction) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
  return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async (transaction) => {
    const [summary] = await select(`SELECT COUNT(*) AS orders,
      COALESCE(SUM(o.total_cents), 0) AS "grossSalesCents",
      COALESCE(SUM(o.platform_fee_cents), 0) AS "platformFeesCents",
      COALESCE(SUM(o.affiliate_commission_cents), 0) AS "affiliateCommissionsCents"
      ${fromPaidOrders}`, transaction);
    const daily = await select(`SELECT ((o.paid_at AT TIME ZONE 'UTC')::date)::text AS id,
      COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS "salesCents"
      ${fromPaidOrders}
      GROUP BY (o.paid_at AT TIME ZONE 'UTC')::date
      ORDER BY (o.paid_at AT TIME ZONE 'UTC')::date ASC`, transaction);
    const events = await select(`SELECT e.id, e.title AS label,
      COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS "salesCents"
      ${fromPaidOrders}
      GROUP BY e.id, e.title
      ORDER BY "salesCents" DESC, e.id ASC`, transaction);
    const organizations = await select(`SELECT COALESCE(org.id::text, 'independent') AS id,
      COALESCE(org.name, 'Independent creators') AS label,
      COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS "salesCents"
      ${fromPaidOrders}
      GROUP BY org.id, org.name
      ORDER BY "salesCents" DESC, COALESCE(org.id::text, 'independent') ASC`, transaction);
    const number = (row, fields) => ({ ...row, ...Object.fromEntries(fields.map((field) => [field, Number(row[field])])) });
    return {
      summary: number(summary, ['orders', 'grossSalesCents', 'platformFeesCents', 'affiliateCommissionsCents']),
      daily: daily.map((row) => number({ ...row, label: row.id }, ['orders', 'salesCents'])),
      events: events.map((row) => number(row, ['orders', 'salesCents'])),
      organizations: organizations.map((row) => number(row, ['orders', 'salesCents'])),
    };
  });
}

function createAdminService({ models, permissions, email = null, customerAppUrl = 'http://localhost:5173' }) {
  async function workspace(userId, query) {
    await permissions.assertInternal(userId);
    const since = new Date(Date.now() - query.days * 86400000);
    const search = query.search ? `%${query.search}%` : null;
    const userWhere = search ? { [Op.or]: [{ email: { [Op.iLike]: search } }, { displayName: { [Op.iLike]: search } }] } : {};
    const orgWhere = search ? { [Op.or]: [{ name: { [Op.iLike]: search } }, { slug: { [Op.iLike]: search } }] } : {};
    const eventWhere = search ? { [Op.or]: [{ title: { [Op.iLike]: search } }, { category: { [Op.iLike]: search } }] } : {};
    const effectiveActiveEvents = activeEventScope(models);
    const baseEventInclude = [
      { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'planTier', 'status', 'lifecycleState'], required: false },
      { model: models.Location, as: 'location', attributes: ['id', 'name', 'city', 'region', 'timezone', 'lifecycleState'], required: false },
      { model: models.User, as: 'creator', attributes: ['id', 'isActive', 'onboardingPending', 'lifecycleState'], required: false },
    ];
    const orderInclude = [
      { model: models.User, as: 'buyer', attributes: ['id', 'email', 'displayName'] },
      { model: models.Event, as: 'event', attributes: ['id', 'title'], include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'], required: false }] },
      { model: models.Payment, as: 'payments', attributes: ['id', 'provider', 'status', 'amountCents', 'currency', 'processedAt'] },
    ];
    const [users, organizations, events, orders, audit, sales, counts] = await Promise.all([
      models.User.findAll({ where: userWhere, attributes: ['id', 'email', 'displayName', 'phone', 'isActive', 'isInternalAdmin', 'createdAt', 'updatedAt'], order: [['createdAt', 'DESC']], limit: query.limit }),
      models.Organization.findAll({ where: orgWhere, attributes: ['id', 'name', 'slug', 'description', 'planTier', 'status', 'createdAt', 'updatedAt'], order: [['createdAt', 'DESC']], limit: query.limit }),
      models.Event.findAll({ where: eventWhere, attributes: ['id', 'creatorUserId', 'organizationId', 'locationId', 'lifecycleState', 'title', 'slug', 'summary', 'description', 'category', 'status', 'startsAt', 'endsAt', 'capacity', 'guestlistCapacity', 'isDiscoverable', 'version', 'createdAt', 'updatedAt'], include: baseEventInclude, order: [['startsAt', 'DESC']], limit: query.limit }),
      models.Order.findAll({ attributes: ['id', 'buyerUserId', 'eventId', 'status', 'currency', 'subtotalCents', 'platformFeeCents', 'totalCents', 'affiliateCommissionCents', 'paidAt', 'createdAt', 'updatedAt'], include: orderInclude, order: [['createdAt', 'DESC']], limit: query.limit }),
      models.AuditLog.findAll({ attributes: ['id', 'actorUserId', 'organizationId', 'entityType', 'entityId', 'action', 'before', 'after', 'createdAt'], include: [{ model: models.User, as: 'actor', attributes: ['id', 'email', 'displayName'], required: false }], order: [['createdAt', 'DESC']], limit: query.limit }),
      loadAdminSales(models, since, query.organizationId || null),
      Promise.all([
        models.User.count(), models.User.count({ where: { isActive: true } }), models.User.count({ where: { isInternalAdmin: true } }),
        models.Organization.count(), models.Organization.count({ where: { status: 'suspended' } }), models.Organization.count({ where: { planTier: 'premium' } }),
        models.Event.count(), models.Event.count({ ...effectiveActiveEvents, where: { ...effectiveActiveEvents.where, status: 'published' } }), models.Event.count({ ...effectiveActiveEvents, where: { ...effectiveActiveEvents.where, status: 'draft' } }),
        models.Order.count(), models.Order.count({ where: { status: 'paid' } }), models.Payment.count({ where: { status: 'failed' } }),
        models.GuestlistEntry.count({ where: { status: 'pending' } }), models.CheckIn.count({ where: { checkedInAt: { [Op.gte]: since } } }),
      ]),
    ]);
    const [userCount, activeUsers, admins, orgCount, suspendedOrgs, premiumOrgs, eventCount, publishedEvents, draftEvents, orderCount, paidOrderCount, failedPayments, pendingGuestlist, checkIns] = counts;
    return {
      generatedAt: new Date().toISOString(), periodDays: query.days, reportOrganizationId: query.organizationId || null,
      stats: { users: userCount, activeUsers, admins, organizations: orgCount, suspendedOrganizations: suspendedOrgs, premiumOrganizations: premiumOrgs, events: eventCount, publishedEvents, draftEvents, orders: orderCount, paidOrders: paidOrderCount, failedPayments, pendingGuestlist, checkIns },
      sales,
      alerts: [
        { id: 'failed-payments', label: 'Failed payment attempts', count: failedPayments, severity: failedPayments ? 'high' : 'clear' },
        { id: 'guestlist', label: 'Guestlist approvals', count: pendingGuestlist, severity: pendingGuestlist ? 'normal' : 'clear' },
        { id: 'organizations', label: 'Suspended organizations', count: suspendedOrgs, severity: suspendedOrgs ? 'high' : 'clear' },
        { id: 'draft-events', label: 'Draft events', count: draftEvents, severity: draftEvents ? 'normal' : 'clear' },
      ],
      users: users.map(plain), organizations: organizations.map(plain), events: events.map(plain), orders: orders.map(plain), audit: audit.map(plain),
    };
  }

  async function operations(userId, query) {
    await permissions.assertInternal(userId);
    const eventInclude = { model: models.Event, as: 'event', attributes: ['id', 'title'], required: false, include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'], required: false }] };
    const personInclude = (as) => ({ model: models.User, as, attributes: ['id', 'displayName', 'email'], required: false });
    const configs = {
      failed_payments: { model: models.Payment, status: 'failed', attributes: ['id', 'orderId', 'provider', 'status', 'amountCents', 'currency', 'processedAt', 'createdAt', 'updatedAt'], include: [{ model: models.Order, as: 'order', attributes: ['id', 'status'], required: false, include: [personInclude('buyer'), eventInclude] }], fields: ['provider', '$order.buyer.display_name$', '$order.buyer.email$', '$order.event.title$', '$order.event.organization.name$'], ids: ['id', 'orderId'] },
      pending_guestlist: { model: models.GuestlistEntry, status: 'pending', attributes: ['id', 'eventId', 'userId', 'source', 'partySize', 'status', 'createdAt', 'updatedAt'], include: [personInclude('user'), eventInclude], fields: ['$user.display_name$', '$user.email$', '$event.title$', '$event.organization.name$'], ids: ['id', 'eventId', 'userId'] },
      suspended_organizations: { model: models.Organization, status: 'suspended', attributes: ['id', 'name', 'slug', 'planTier', 'status', 'createdAt', 'updatedAt'], include: [], fields: ['name', 'slug'], ids: ['id'] },
    };
    const config = configs[query.kind];
    const where = { status: config.status };
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      const matches = config.fields.map((field) => ({ [field]: { [Op.iLike]: pattern } }));
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.search)) matches.push(...config.ids.map((field) => ({ [field]: query.search })));
      where[Op.or] = matches;
    }
    const [failedPayments, pendingGuestlist, suspendedOrganizations, result] = await Promise.all([
      models.Payment.count({ where: { status: 'failed' } }),
      models.GuestlistEntry.count({ where: { status: 'pending' } }),
      models.Organization.count({ where: { status: 'suspended' } }),
      config.model.findAndCountAll({ where, attributes: config.attributes, include: config.include, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: query.pageSize, offset: (query.page - 1) * query.pageSize, distinct: true, subQuery: false }),
    ]);
    return { generatedAt: new Date().toISOString(), counts: { failedPayments, pendingGuestlist, suspendedOrganizations }, queue: { kind: query.kind, page: query.page, pageSize: query.pageSize, total: result.count, items: result.rows.map(plain) } };
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
    await models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      if (typeof record.reload === 'function') await record.reload({ transaction, lock: transaction.LOCK.UPDATE });
      if (entityType === 'user') await assertUserAccessChange({ models, actorUserId: userId, user: record, changes, transaction });
      await record.update(changes, { transaction });
      await models.AuditLog.create({
        actorUserId: userId, organizationId: record.organizationId || null, entityType: config.audit, entityId,
        action: `admin.${entityType}.updated`, before, after: { ...plain(record), adminReason: reason },
      }, { transaction });
      if (entityType === 'event' && before.status === 'published') {
        if (record.status === 'cancelled') {
          await queueEventEmail({ email, models, event: record, kind: 'cancelled',
            variables: { EVENT_DATE: formatTime(before.startsAt) },
            customerAppUrl, transaction, key: `admin-cancelled-${record.updatedAt.getTime()}` });
        } else if (record.status === 'published' && (Math.abs(+new Date(before.startsAt) - +new Date(record.startsAt)) >= 15 * 60 * 1000 || Math.abs(+new Date(before.endsAt) - +new Date(record.endsAt)) >= 15 * 60 * 1000)) {
          await queueEventEmail({ email, models, event: record, kind: 'timeChange',
            variables: {
              OLD_TIME: `${formatTime(before.startsAt)} – ${formatTime(before.endsAt)}`,
              NEW_TIME: `${formatTime(record.startsAt)} – ${formatTime(record.endsAt)}`,
            }, customerAppUrl, transaction, key: `admin-time-${record.updatedAt.getTime()}` });
        }
      }
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
  return { workspace, operations, createDemoUser, updateUser: (u, id, v) => update(u, 'user', id, v), updateOrganization: (u, id, v) => update(u, 'organization', id, v), updateEvent: (u, id, v) => update(u, 'event', id, v) };
}

module.exports = { aggregateAdminSales, createAdminService };
