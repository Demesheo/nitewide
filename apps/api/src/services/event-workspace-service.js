const { Op } = require('sequelize');
const { randomUUID } = require('node:crypto');
const { forbidden, notFound, conflict } = require('../domain/errors');
const { assertEventEditable, eventFinished, offeringSaleState } = require('../domain/event-policy');
const { employeeReferralCode, leaderReferralCode } = require('./affiliate-service');

function summarizeEvent({ orders, offerings, people, guests }) {
  const tiers = new Map(offerings.map((o) => [o.id, { id: o.id, name: o.name, kind: o.kind, units: 0, salesCents: 0, admissions: 0 }]));
  const referrals = new Map(people.map((p) => [p.userId, { ...p, salesCents: 0, orders: 0, commissionCents: 0, customerIds: new Set() }]));
  const customers = new Map();
  const channels = new Map();
  const customer = (id, user) => {
    if (!customers.has(id)) customers.set(id, { id, name: user?.displayName || 'Customer', email: user?.email || '', salesCents: 0, paidCents: 0, orders: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0, guestlistStatuses: [], purchases: [] });
    return customers.get(id);
  };
  const summary = { salesCents: 0, customerPaidCents: 0, platformFeeCents: 0, commissionCents: 0, orders: orders.length, admissions: 0, checkedIn: 0, guestlistPlaces: 0, customers: 0 };
  for (const order of orders) {
    const person = people.find((p) => order.eventAffiliateId ? p.id === order.eventAffiliateId : p.orgAffiliateId === order.orgAffiliateId && order.orgAffiliateId);
    const channelName = person?.role || (order.eventAffiliateId || order.orgAffiliateId ? 'Other referral' : 'Direct');
    if (!channels.has(channelName)) channels.set(channelName, { name: channelName, salesCents: 0, orders: 0 });
    channels.get(channelName).salesCents += order.subtotalCents;
    channels.get(channelName).orders += 1;
    summary.salesCents += order.subtotalCents;
    summary.customerPaidCents += order.totalCents;
    summary.platformFeeCents += order.platformFeeCents;
    summary.commissionCents += order.affiliateCommissionCents;
    const buyer = customer(order.buyerUserId, order.buyer);
    buyer.salesCents += order.subtotalCents;
    buyer.paidCents += order.totalCents;
    buyer.orders += 1;
    if (person) {
      const row = referrals.get(person.userId);
      row.salesCents += order.subtotalCents;
      row.orders += 1;
      row.commissionCents += order.affiliateCommissionCents;
      row.customerIds.add(order.buyerUserId);
    }
    for (const item of order.items || []) {
      if (!tiers.has(item.offeringId)) tiers.set(item.offeringId, { id: item.offeringId, name: item.nameSnapshot, kind: item.kindSnapshot, units: 0, admissions: 0, salesCents: 0 });
      const tier = tiers.get(item.offeringId);
      tier.units += item.quantity;
      tier.salesCents += item.lineTotalCents;
      const validTickets = (item.tickets || []).filter((t) => ['valid', 'checked_in'].includes(t.status));
      tier.admissions += validTickets.length;
      summary.admissions += validTickets.length;
      buyer.purchases.push({ name: item.nameSnapshot, quantity: item.quantity, salesCents: item.lineTotalCents, paidAt: order.paidAt, referredBy: person?.name || (order.eventAffiliateId || order.orgAffiliateId ? 'Other referral' : 'Direct') });
      for (const ticket of validTickets) {
        const holder = customer(ticket.holderUserId, ticket.holder || (ticket.holderUserId === order.buyerUserId ? order.buyer : null));
        holder.admissions += 1;
        if (ticket.status === 'checked_in') { holder.checkedIn += 1; summary.checkedIn += 1; }
      }
    }
  }
  for (const guest of guests) {
    const row = customer(guest.userId, guest.user);
    row.guestlistStatuses.push(guest.status);
    if (['confirmed', 'checked_in'].includes(guest.status)) {
      row.guestlistPlaces += guest.partySize;
      summary.guestlistPlaces += guest.partySize;
      if (guest.status === 'checked_in') { row.checkedIn += guest.partySize; summary.checkedIn += guest.partySize; }
    }
  }
  summary.customers = new Set(orders.map((o) => o.buyerUserId)).size;
  return { summary, tiers: [...tiers.values()], people: [...referrals.values()].map(({ customerIds, ...p }) => ({ ...p, customers: customerIds.size })), customers: [...customers.values()], channels: [...channels.values()] };
}

function createEventWorkspaceService({ models: m, permissions, now = () => new Date() }) {
  async function roster(event) {
    if (!event.organizationId) return [];
    const include = [{ model: m.User, as: 'user', attributes: ['id', 'displayName', 'email', 'isActive'] }];
    const [leaders, employees, promoters] = await Promise.all([
      m.OrganizationOwner.findAll({ where: { organizationId: event.organizationId }, include }),
      m.OrganizationEmployee.findAll({ where: { organizationId: event.organizationId, status: 'active' }, include }),
      m.OrgAffiliate.findAll({ where: { organizationId: event.organizationId, status: 'active' }, include }),
    ]);
    const members = new Map();
    for (const [records, type] of [[leaders, 'leader'], [employees, 'Employee'], [promoters, 'Promoter']]) {
      for (const row of records) {
        if (!row.user?.isActive) continue;
        const old = members.get(row.userId);
        if (old) { if (type === 'Promoter') old.orgAffiliateId = row.id; if (type === 'Employee') old.defaultReferralCode ||= employeeReferralCode(row.id); continue; }
        members.set(row.userId, { userId: row.userId, name: row.user.displayName, email: row.user.email, role: type === 'leader' ? row.role === 'owner' ? 'Owner' : 'Manager' : type, orgAffiliateId: type === 'Promoter' ? row.id : null, defaultReferralCode: type === 'leader' ? leaderReferralCode(row.id) : type === 'Employee' ? employeeReferralCode(row.id) : null });
      }
    }
    return [...members.values()];
  }
  async function detail(userId, eventId) {
    const event = await m.Event.findByPk(eventId, { include: [{ model: m.Location, as: 'location' }, { model: m.Organization, as: 'organization' }, { model: m.Offering, as: 'offerings' }] });
    if (!event) throw notFound('Event');
    const user = await m.User.findByPk(userId);
    if (!user?.isActive) throw forbidden();
    const canManage = Boolean(user.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await permissions.canManageOrganization(userId, event.organizationId)));
    const members = await roster(event);
    const assignments = await m.EventAffiliate.findAll({ where: { eventId }, include: [{ model: m.User, as: 'user', attributes: ['id', 'displayName', 'email'] }, { model: m.OrgAffiliate, as: 'orgAffiliate' }] });
    const ownAssignments = assignments.filter((a) => a.userId === userId).map((a) => a.id);
    const ownOrg = event.organizationId ? await m.OrgAffiliate.findOne({ where: { organizationId: event.organizationId, userId } }) : null;
    if (!canManage && !members.some((p) => p.userId === userId) && !ownAssignments.length) throw forbidden('Event access required');
    const allPeople = assignments.map((a) => ({ id: a.id, userId: a.userId, name: a.user.displayName, role: members.find((p) => p.userId === a.userId)?.role || (a.userId === event.creatorUserId && !event.organizationId ? 'Creator' : 'Promoter'), orgAffiliateId: a.orgAffiliateId, status: a.status, code: a.code, commissionBps: a.commissionBps ?? a.orgAffiliate?.defaultCommissionBps ?? 0 }));
    // Show the full current venue team, even without an event assignment or sales.
    // Owners, managers and employees can refer at 0% immediately.
    for (const member of members) if (!allPeople.some((p) => p.userId === member.userId)) allPeople.push({ ...member, id: null, code: member.defaultReferralCode, status: member.defaultReferralCode ? 'default' : 'not_selected', commissionBps: 0 });
    const orderWhere = { eventId, status: 'paid' };
    if (!canManage) orderWhere[Op.or] = [{ eventAffiliateId: ownAssignments }, ...(ownOrg ? [{ eventAffiliateId: null, orgAffiliateId: ownOrg.id }] : [])];
    const guestWhere = { eventId };
    if (!canManage) guestWhere.eventAffiliateId = ownAssignments;
    const [orders, guests] = await Promise.all([
      m.Order.findAll({ where: orderWhere, include: [{ model: m.User, as: 'buyer', attributes: ['id', 'displayName', 'email'] }, { model: m.OrderItem, as: 'items', include: [{ model: m.Ticket, as: 'tickets', attributes: ['holderUserId', 'status'], include: [{ model: m.User, as: 'holder', attributes: ['displayName', 'email'] }] }] }], order: [['paidAt', 'DESC']] }),
      m.GuestlistEntry.findAll({ where: guestWhere, attributes: ['userId', 'status', 'partySize'], include: [{ model: m.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
    ]);
    const people = canManage ? allPeople : allPeople.filter((p) => p.userId === userId);
    const offerings = [...event.offerings].sort((a, b) => a.sortOrder - b.sortOrder);
    const report = summarizeEvent({ orders, offerings, people, guests });
    const serialized = event.toJSON();
    serialized.offerings = offerings.map((o) => { const { accessCodeHash, ...tier } = o.toJSON(); if (!canManage) delete tier.quantitySold; return { ...tier, saleState: offeringSaleState(o, offerings, now()) }; });
    return { event: { ...serialized, canManage, canEdit: canManage && !eventFinished(event, now()) }, scope: canManage ? 'event' : 'own', candidates: canManage ? members : [], ...report };
  }
  async function savePerson(userId, eventId, input) {
    await permissions.assertManageEvent(userId, eventId);
    return m.Event.sequelize.transaction(async (transaction) => {
      const event = await m.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      assertEventEditable(event, now());
      const person = input.userId ? await m.User.findByPk(input.userId, { transaction }) : await m.User.findOne({ where: { email: input.email.toLowerCase() }, transaction });
      if (!person?.isActive) throw notFound('Active user');
      let assignment = await m.EventAffiliate.findOne({ where: { eventId, userId: person.id }, transaction, lock: transaction.LOCK.UPDATE });
      const members = await roster(event);
      const member = members.find((p) => p.userId === person.id);
      if (event.organizationId && !member && !assignment) throw forbidden('Invite this promoter to the event first.');
      if (!assignment && input.status === 'inactive' && !member?.defaultReferralCode) throw notFound('Event referrer');
      const before = assignment?.toJSON() || null;
      const values = { commissionBps: input.commissionBps, status: input.status };
      if (assignment) await assignment.update(values, { transaction });
      else assignment = await m.EventAffiliate.create({ ...values, eventId, userId: person.id, orgAffiliateId: member?.orgAffiliateId || null, code: `NW-${randomUUID()}`, guestlistAllocation: 0 }, { transaction });
      await m.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'EventAffiliate', entityId: assignment.id, action: input.status === 'inactive' ? 'event.referrer.removed' : 'event.referrer.updated', before, after: assignment.toJSON() }, { transaction });
      return assignment;
    });
  }
  return { detail, savePerson };
}
module.exports = { createEventWorkspaceService, summarizeEvent };
