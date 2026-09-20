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
