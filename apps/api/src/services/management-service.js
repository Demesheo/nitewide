const { notFound, conflict } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');
const { queueEventTermsChanged } = require('./business-email-events');
const { mutationTransaction } = require('./mutation-transaction');
const { assertActiveUser } = require('./lifecycle-service');
const { authorizeEventWrite, assertDirectCapacity, persistOffering, recordEventMutation } = require('./event-mutation-policy');
const { createEventWorkspaceService } = require('./event-workspace-service');
const { fn, col } = require('sequelize');
const { assertCommissionPricing } = require('../domain/editor-pricing-policy');
const { createBusinessSlug } = require('../domain/business-slug');

function createManagementService({ models, permissions, email = null, businessAppUrl = 'http://localhost:5174/app', customerAppUrl = 'http://localhost:5173' }) {
  const eventWorkspace = createEventWorkspaceService({ models, permissions, email, businessAppUrl });
  const eventMutation = (userId, eventId, work, accessChange = false) => mutationTransaction(models.Event.sequelize, async (transaction) => {
    await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
    const event = await models.Event.findByPk(eventId, { transaction });
    if (!event) throw notFound('Event');
    await authorizeEventWrite({ models, permissions, userId, event, transaction });
    return work(event, transaction);
  }, { accessChange });
  return {
    createOrganization: async (userId, ids, input) => {
      const organization = await mutationTransaction(models.Organization.sequelize, async (transaction) => {
        await permissions.assertInternal(userId, transaction);
        assertActiveUser(await models.User.findByPk(userId, { transaction }));
        const org = await models.Organization.create({ ...input, slug: createBusinessSlug(input.name) }, { transaction });
        await models.OrganizationOwner.create({ organizationId: org.id, userId: userId, role: 'owner' }, { transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId: org.id, entityType: 'Organization', entityId: org.id, action: 'organization.created', after: org.toJSON() }, { transaction });
        return org;
      }, { accessChange: true });
      return organization;
    },
    addOrgAffiliate: async (userId, ids, input) => { const data = await mutationTransaction(models.Organization.sequelize, async (transaction) => {
      await permissions.assertManageOrganization(userId, ids.organizationId, transaction);
      await require('./lifecycle-service').assertActiveOrganization(models, ids.organizationId, transaction);
      assertActiveUser(await models.User.findByPk(input.userId, { transaction }));
      await assertCommissionPricing({ models, organizationId: ids.organizationId, commissionBps: input.defaultCommissionBps ?? 0, transaction });
      const before = await models.OrgAffiliate.findOne({ where: { organizationId: ids.organizationId, userId: input.userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (before?.status === 'active') throw conflict('This organization referrer is already active');
      const data = before ? await before.update({ ...input, status: 'active' }, { transaction }) : await models.OrgAffiliate.create({ ...input, organizationId: ids.organizationId }, { transaction });
      const [leader, employee] = await Promise.all([
        models.OrganizationOwner.findOne({ where: { organizationId: ids.organizationId, userId: input.userId, lifecycleState: 'active' }, transaction }),
        models.OrganizationEmployee.findOne({ where: { organizationId: ids.organizationId, userId: input.userId, status: 'active' }, transaction }),
      ]);
      await require('./event-affiliate-transition').setOrganizationAssignmentsActive({ models, organizationId: ids.organizationId, userId: input.userId, actorUserId: userId, active: true, staffRole: Boolean(leader || employee), transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: ids.organizationId, entityType: 'OrgAffiliate', entityId: data.id, action: 'organization.referrer.added', after: data.toJSON() }, { transaction });
      return data;
    }, { accessChange: true }); return data; },
    createEvent: async (userId, ids, input) => {
      const data = await mutationTransaction(models.Event.sequelize, async (transaction) => {
      await authorizeEventWrite({ models, permissions, userId, organizationId: input.organizationId, locationId: input.locationId, transaction });
      let locationId = input.locationId;
      if (input.organizationId) {
        const org = await models.Organization.findByPk(input.organizationId, { transaction });
        if (!org?.locationId && !locationId) throw conflict('This organization needs a saved venue address before creating an event.');
        locationId = locationId || org.locationId;
        await require('./lifecycle-service').assertOrganizationVenue(models, org, locationId, transaction);
      }
      assertEventEditable(input);
      if (locationId && !input.organizationId) {
        const location = await models.Location.findByPk(locationId, { transaction });
        if (!location || location.lifecycleState !== 'active') throw conflict('Select an active venue', 'VENUE_INACTIVE');
      }
      const saved = await models.Event.create({ ...input, locationId, creatorUserId: userId }, { transaction });
      await recordEventMutation({ models, email, userId, saved, before: null, customerAppUrl, businessAppUrl, transaction });
      return saved;
      }); return data;
    },
    addOffering: async (userId, ids, input) => eventMutation(userId, ids.eventId, async (event, transaction) => {
      const data = await persistOffering({ models, eventId: event.id, values: input, transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Offering', entityId: data.id, action: 'offering.created', after: data.toJSON() }, { transaction });
      return data;
    }),
    addEventAffiliate: async (userId, ids, input) => eventWorkspace.savePerson(userId, ids.eventId, { ...input, commissionBps: input.commissionBps ?? 0, status: 'active' }, { legacyCreate: true }),
    updateGuestlistCapacity: async (userId, ids, input) => {
      const data = await eventMutation(userId, ids.eventId, async (event, transaction) => {
        if (!event) throw notFound('Event');
        assertEventEditable(event);
        await assertDirectCapacity({ models, eventId: event.id, capacity: input.guestlistCapacity, transaction });
        const before = { guestlistCapacity: event.guestlistCapacity };
        await event.update({ guestlistCapacity: input.guestlistCapacity }, { transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Event', entityId: event.id, action: 'event.guestlist_capacity.updated', before, after: { guestlistCapacity: event.guestlistCapacity } }, { transaction });
        return event;
      });
      return data;
    },
    updateAffiliateGuestlistAllocation: async (userId, ids, input) => {
      const data = await eventMutation(userId, ids.eventId, async (event, transaction) => {
        const lockedEvent = await models.Event.findByPk(event.id, { transaction, lock: transaction.LOCK.UPDATE });
        assertEventEditable(lockedEvent);
        const affiliate = await models.EventAffiliate.findOne({ where: { id: ids.eventAffiliateId, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
        if (!affiliate) throw notFound('Event promoter');
        const parent = input.guestlistAllocation === null && affiliate.orgAffiliateId ? await models.OrgAffiliate.findByPk(affiliate.orgAffiliateId, { transaction, lock: transaction.LOCK.UPDATE }) : null;
        const limit = input.guestlistAllocation ?? parent?.defaultGuestlistAllocation ?? 0;
        const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId: affiliate.id, status: ['confirmed', 'checked_in'] }, transaction })) || 0;
        if (limit < used) throw conflict(`Promoter guestlist already has ${used} approved guests`);
        const before = { guestlistAllocation: affiliate.guestlistAllocation };
        await affiliate.update({ guestlistAllocation: input.guestlistAllocation }, { transaction });
        const audit = await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'EventAffiliate', entityId: affiliate.id, action: 'event_affiliate.guestlist_allocation.updated', before, after: { guestlistAllocation: affiliate.guestlistAllocation } }, { transaction });
        await queueEventTermsChanged({ email, models, userId: affiliate.userId, event: lockedEvent,
          term: 'Guestlist allocation', oldValue: String(before.guestlistAllocation ?? 'Inherited'), newValue: String(affiliate.guestlistAllocation ?? 'Inherited'),
          actionId: audit.id, businessAppUrl, transaction });
        return affiliate;
      });
      return data;
    },
    guestlistSettings: async (userId, ids) => {
      const event = await permissions.assertManageEvent(userId, ids.eventId);
      const [usage, affiliates] = await Promise.all([
        models.GuestlistEntry.findAll({ attributes: ['eventAffiliateId', [fn('SUM', col('party_size')), 'used']],
          where: { eventId: event.id, status: ['confirmed', 'checked_in'] }, group: ['eventAffiliateId'], raw: true }),
        models.EventAffiliate.findAll({
          where: { eventId: event.id },
          include: [
            { model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] },
            { model: models.OrgAffiliate, as: 'orgAffiliate', attributes: ['id', 'defaultGuestlistAllocation'], required: false },
          ],
          order: [['createdAt', 'ASC']],
        }),
      ]);
      const usageByPool = new Map(usage.map((row) => [row.eventAffiliateId, Number(row.used) || 0]));
      const promoters = affiliates.map((affiliate) => ({
        id: affiliate.id,
        code: affiliate.code,
        status: affiliate.status,
        user: affiliate.user,
        guestlistAllocation: affiliate.guestlistAllocation,
        effectiveGuestlistAllocation: affiliate.guestlistAllocation ?? affiliate.orgAffiliate?.defaultGuestlistAllocation ?? 0,
        used: usageByPool.get(affiliate.id) || 0,
      }));
      return { eventId: event.id, title: event.title, direct: { capacity: event.guestlistCapacity, used: usageByPool.get(null) || 0 }, promoters };
    },
    eventAnalytics: async (userId, ids, input) => {
      await permissions.assertManageEvent(userId, ids.eventId);
      const [row] = await models.Event.sequelize.query(`
        SELECT COALESCE(SUM(subtotal_cents),0)::bigint AS "grossSalesCents",
          COALESCE(SUM(affiliate_commission_cents),0)::bigint AS "affiliateCommissionCents",
          COUNT(*)::integer AS "paidOrders",
          (SELECT COUNT(*)::integer FROM tickets WHERE event_id=:eventId) AS "ticketsSold",
          (SELECT COUNT(*)::integer FROM check_ins WHERE event_id=:eventId) AS "checkedIn",
          (SELECT COALESCE(SUM(party_size),0)::integer FROM guestlist_entries WHERE event_id=:eventId AND status IN ('confirmed','checked_in')) AS "guestlistConfirmed",
          (SELECT COUNT(*)::integer FROM guestlist_entries WHERE event_id=:eventId AND status='pending') AS "guestlistPending"
        FROM orders WHERE event_id=:eventId AND status='paid'
      `, { replacements: { eventId: ids.eventId }, type: require('sequelize').QueryTypes.SELECT });
      return { ...row, grossSalesCents: Number(row.grossSalesCents), affiliateCommissionCents: Number(row.affiliateCommissionCents), attendanceRate: row.ticketsSold ? row.checkedIn / row.ticketsSold : 0 };
    },
    adminOverview: async (userId, ids, input) => { await permissions.assertInternal(userId); const [users, organizations, events, paidOrders] = await Promise.all([models.User.count(), models.Organization.count(), models.Event.count(), models.Order.count({ where: { status: 'paid' } })]); return { users, organizations, events, paidOrders }; },
  };
}
module.exports = { createManagementService };
