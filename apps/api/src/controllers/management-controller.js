const { notFound, conflict } = require('../domain/errors');

function createManagementController({ models, permissions }) {
  return {
    createOrganization: async (req, res) => {
      const organization = await models.Organization.sequelize.transaction(async (transaction) => {
        const org = await models.Organization.create(req.body, { transaction });
        await models.OrganizationOwner.create({ organizationId: org.id, userId: req.userId, role: 'owner' }, { transaction });
        await models.AuditLog.create({ actorUserId: req.userId, organizationId: org.id, entityType: 'Organization', entityId: org.id, action: 'organization.created', after: org.toJSON() }, { transaction });
        return org;
      });
      res.status(201).json({ data: organization });
    },
    addOrgAffiliate: async (req, res) => { await permissions.assertManageOrganization(req.userId, req.params.organizationId); const data = await models.OrgAffiliate.create({ ...req.body, organizationId: req.params.organizationId }); res.status(201).json({ data }); },
    createEvent: async (req, res) => {
      if (req.body.organizationId) await permissions.assertManageOrganization(req.userId, req.body.organizationId);
      const data = await models.Event.create({ ...req.body, creatorUserId: req.userId }); res.status(201).json({ data });
    },
    addOffering: async (req, res) => { await permissions.assertManageEvent(req.userId, req.params.eventId); const data = await models.Offering.create({ ...req.body, eventId: req.params.eventId }); res.status(201).json({ data }); },
    addEventAffiliate: async (req, res) => { await permissions.assertManageEvent(req.userId, req.params.eventId); const data = await models.EventAffiliate.create({ ...req.body, eventId: req.params.eventId }); res.status(201).json({ data }); },
    updateGuestlistCapacity: async (req, res) => {
      await permissions.assertManageEvent(req.userId, req.params.eventId);
      const data = await models.Event.sequelize.transaction(async (transaction) => {
        const event = await models.Event.findByPk(req.params.eventId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!event) throw notFound('Event');
        const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventId: event.id, eventAffiliateId: null, status: ['confirmed', 'checked_in'] }, transaction })) || 0;
        if (req.body.guestlistCapacity < used) throw conflict(`Direct guestlist already has ${used} approved guests`);
        const before = { guestlistCapacity: event.guestlistCapacity };
        await event.update({ guestlistCapacity: req.body.guestlistCapacity }, { transaction });
        await models.AuditLog.create({ actorUserId: req.userId, organizationId: event.organizationId, entityType: 'Event', entityId: event.id, action: 'event.guestlist_capacity.updated', before, after: { guestlistCapacity: event.guestlistCapacity } }, { transaction });
        return event;
      });
      res.json({ data });
    },
    updateAffiliateGuestlistAllocation: async (req, res) => {
      const event = await permissions.assertManageEvent(req.userId, req.params.eventId);
      const data = await models.Event.sequelize.transaction(async (transaction) => {
        await models.Event.findByPk(event.id, { transaction, lock: transaction.LOCK.UPDATE });
        const affiliate = await models.EventAffiliate.findOne({ where: { id: req.params.eventAffiliateId, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
        if (!affiliate) throw notFound('Event promoter');
        const parent = req.body.guestlistAllocation === null && affiliate.orgAffiliateId ? await models.OrgAffiliate.findByPk(affiliate.orgAffiliateId, { transaction, lock: transaction.LOCK.UPDATE }) : null;
        const limit = req.body.guestlistAllocation ?? parent?.defaultGuestlistAllocation ?? 0;
        const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId: affiliate.id, status: ['confirmed', 'checked_in'] }, transaction })) || 0;
        if (limit < used) throw conflict(`Promoter guestlist already has ${used} approved guests`);
        const before = { guestlistAllocation: affiliate.guestlistAllocation };
        await affiliate.update({ guestlistAllocation: req.body.guestlistAllocation }, { transaction });
        await models.AuditLog.create({ actorUserId: req.userId, organizationId: event.organizationId, entityType: 'EventAffiliate', entityId: affiliate.id, action: 'event_affiliate.guestlist_allocation.updated', before, after: { guestlistAllocation: affiliate.guestlistAllocation } }, { transaction });
        return affiliate;
      });
      res.json({ data });
    },
    guestlistSettings: async (req, res) => {
      const event = await permissions.assertManageEvent(req.userId, req.params.eventId);
      const [directUsed, affiliates] = await Promise.all([
        models.GuestlistEntry.sum('partySize', { where: { eventId: event.id, eventAffiliateId: null, status: ['confirmed', 'checked_in'] } }),
        models.EventAffiliate.findAll({
          where: { eventId: event.id },
          include: [
            { model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] },
            { model: models.OrgAffiliate, as: 'orgAffiliate', attributes: ['id', 'defaultGuestlistAllocation'], required: false },
          ],
          order: [['createdAt', 'ASC']],
        }),
      ]);
      const promoters = await Promise.all(affiliates.map(async (affiliate) => ({
        id: affiliate.id,
        code: affiliate.code,
        status: affiliate.status,
        user: affiliate.user,
        guestlistAllocation: affiliate.guestlistAllocation,
        effectiveGuestlistAllocation: affiliate.guestlistAllocation ?? affiliate.orgAffiliate?.defaultGuestlistAllocation ?? 0,
        used: Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId: affiliate.id, status: ['confirmed', 'checked_in'] } })) || 0,
      })));
      res.json({ data: { eventId: event.id, title: event.title, direct: { capacity: event.guestlistCapacity, used: Number(directUsed) || 0 }, promoters } });
    },
    eventAnalytics: async (req, res) => {
      await permissions.assertManageEvent(req.userId, req.params.eventId);
      const [orders, ticketsSold, checkedIn, guestlistConfirmed, guestlistPending] = await Promise.all([
        models.Order.findAll({ where: { eventId: req.params.eventId, status: 'paid' }, attributes: ['subtotalCents', 'platformFeeCents', 'affiliateCommissionCents'] }),
        models.Ticket.count({ where: { eventId: req.params.eventId } }), models.CheckIn.count({ where: { eventId: req.params.eventId } }),
        models.GuestlistEntry.sum('partySize', { where: { eventId: req.params.eventId, status: ['confirmed', 'checked_in'] } }),
        models.GuestlistEntry.count({ where: { eventId: req.params.eventId, status: 'pending' } }),
      ]);
      const totals = orders.reduce((acc, order) => { acc.grossSalesCents += order.subtotalCents; acc.platformFeesCents += order.platformFeeCents; acc.affiliateCommissionCents += order.affiliateCommissionCents; return acc; }, { grossSalesCents: 0, platformFeesCents: 0, affiliateCommissionCents: 0 });
      res.json({ data: { ...totals, paidOrders: orders.length, ticketsSold, checkedIn, guestlistConfirmed: Number(guestlistConfirmed) || 0, guestlistPending, attendanceRate: ticketsSold ? checkedIn / ticketsSold : 0 } });
    },
    adminOverview: async (req, res) => { await permissions.assertInternal(req.userId); const [users, organizations, events, paidOrders] = await Promise.all([models.User.count(), models.Organization.count(), models.Event.count(), models.Order.count({ where: { status: 'paid' } })]); res.json({ data: { users, organizations, events, paidOrders } }); },
  };
}
module.exports = { createManagementController };
