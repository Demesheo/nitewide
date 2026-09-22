const { Op, QueryTypes } = require('sequelize');
const QRCode = require('qrcode');
const { notFound, conflict } = require('../domain/errors');
const { walletToken, guestlistWalletToken } = require('../domain/wallet-qr');
const { createReferralLinkService } = require('./referral-link-service');
const { redactLocation } = require('../controllers/public-controller');

function profile(user) {
  return { id: user.id, displayName: user.displayName, email: user.email, phone: user.phone,
    marketingConsentAt: user.marketingConsentAt, transactionalSmsConsentAt: user.transactionalSmsConsentAt,
    marketingSmsConsentAt: user.marketingSmsConsentAt, phoneVerifiedAt: user.phoneVerifiedAt };
}
function eventSummary(event) {
  if (!event) return null;
  return { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, status: event.status,
    imageUrl: event.imageUrl, isPremiumHost: event.organization?.planTier === 'premium', organization: event.organization ? { name: event.organization.name } : null,
    location: redactLocation(event.location) };
}
function createCustomerAccountService({ models, tokenSecret, now = () => new Date() }) {
  const eventInclude = { model: models.Event, as: 'event', include: [
    { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'planTier'] },
  ] };
  async function bookings(userId, { page = 1, period = 'upcoming' } = {}) {
    // Paginate the combined timeline BEFORE loading ticket details, so guest
    // list entries neither repeat across pages nor fall behind later purchases.
    const comparator = period === 'past' ? '<' : '>=';
    const direction = period === 'past' ? 'DESC' : 'ASC';
    const [timeline] = await models.Order.sequelize.query(`WITH combined AS (
      SELECT o.id, 'purchase' AS kind, e.starts_at FROM orders o JOIN events e ON e.id = o.event_id WHERE o.buyer_user_id = :userId AND e.ends_at ${comparator} :now
      UNION ALL
      SELECT g.id, 'guestlist' AS kind, e.starts_at FROM guestlist_entries g JOIN events e ON e.id = g.event_id WHERE g.user_id = :userId AND e.ends_at ${comparator} :now
    ) SELECT (SELECT COUNT(*)::int FROM combined) AS total,
      COALESCE((SELECT json_agg(p) FROM (SELECT id, kind FROM combined ORDER BY starts_at ${direction}, id ASC, kind ASC LIMIT 10 OFFSET :offset) p), '[]'::json) AS entries`,
    { replacements: { userId, now: now(), offset: (page - 1) * 10 }, type: QueryTypes.SELECT });
    const orders = await models.Order.findAll({ where: { buyerUserId: userId, id: timeline.entries.filter((row) => row.kind === 'purchase').map((row) => row.id) }, include: [eventInclude,
      { model: models.OrderItem, as: 'items', separate: true, include: [{ model: models.Ticket, as: 'tickets', attributes: ['id', 'holderUserId', 'status', 'checkedInAt'] }] }] });
    const guests = await models.GuestlistEntry.findAll({ where: { userId, id: timeline.entries.filter((row) => row.kind === 'guestlist').map((row) => row.id) }, attributes: ['id', 'partySize', 'status', 'createdAt'], include: [eventInclude] });
    return { page, total: timeline.total, entries: timeline.entries, pageSize: 10, orders: orders.map((order) => ({ id: order.id, status: order.status, currency: order.currency,
      subtotalCents: order.subtotalCents, totalCents: order.totalCents, paidAt: order.paidAt,
      demo: Boolean(order.pricingPlanSnapshot?.demo), event: eventSummary(order.event),
      items: order.items.map((item) => ({ id: item.id, name: item.nameSnapshot, quantity: item.quantity,
        lineTotalCents: item.lineTotalCents, tickets: item.tickets.filter((ticket) => ticket.holderUserId === userId).map(({ id, status, checkedInAt }) => ({ id, status, checkedInAt })) })) })),
      guestlists: guests.map((guest) => ({ id: guest.id, partySize: guest.partySize, status: guest.status, event: eventSummary(guest.event) })) };
  }
  async function ticket(userId, ticketId) {
    const ticket = await models.Ticket.findOne({ where: { id: ticketId, holderUserId: userId }, include: [{ model: models.OrderItem, as: 'orderItem', include: [{ model: models.Order, as: 'order', include: [eventInclude] }] }] });
    if (!ticket) throw notFound('Ticket');
    const order = ticket.orderItem.order;
    if (ticket.status !== 'valid' || order.status !== 'paid' || order.event.status !== 'published' || new Date(order.event.endsAt) <= now()) throw conflict('This ticket is not available for admission', 'TICKET_UNAVAILABLE');
    const qrToken = walletToken(ticket, tokenSecret);
    return { id: ticket.id, event: eventSummary(order.event), offering: ticket.orderItem.nameSnapshot,
      demo: Boolean(order.pricingPlanSnapshot?.demo), qrImage: await QRCode.toDataURL(qrToken, { width: 320, margin: 4, errorCorrectionLevel: 'M' }) };
  }
  async function guestlistPass(userId, entryId) {
    const entry = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, include: [eventInclude] });
    if (!entry) throw notFound('Guest list entry');
    const showCode = ['confirmed', 'checked_in'].includes(entry.status) && entry.qrTokenHash && entry.event.status === 'published' && new Date(entry.event.endsAt) > now();
    return { id: entry.id, kind: 'guestlist', event: eventSummary(entry.event), partySize: entry.partySize,
      tickets: [{ id: entry.id, offering: 'Guest list entry', status: entry.status, checkedInAt: entry.checkedInAt,
        qrImage: showCode ? await QRCode.toDataURL(guestlistWalletToken(entry, tokenSecret), { width: 320, margin: 4, errorCorrectionLevel: 'M' }) : null }] };
  }
  async function purchaseTickets(userId, orderId) {
    const order = await models.Order.findOne({ where: { id: orderId, buyerUserId: userId }, include: [eventInclude,
      { model: models.OrderItem, as: 'items', include: [{ model: models.Ticket, as: 'tickets' }] }] });
    if (!order) throw notFound('Purchase');
    const admissionAvailable = order.status === 'paid' && order.event.status === 'published' && new Date(order.event.endsAt) > now();
    const tickets = [];
    for (const item of order.items) for (const credential of [...item.tickets].sort((a, b) => a.id.localeCompare(b.id))) {
      if (credential.holderUserId !== userId) continue;
      const showCode = admissionAvailable && ['valid', 'checked_in'].includes(credential.status);
      tickets.push({ id: credential.id, offering: item.nameSnapshot, status: credential.status, checkedInAt: credential.checkedInAt,
        qrImage: showCode ? await QRCode.toDataURL(walletToken(credential, tokenSecret), { width: 320, margin: 4, errorCorrectionLevel: 'M' }) : null });
    }
    return { id: order.id, status: order.status, event: eventSummary(order.event), demo: Boolean(order.pricingPlanSnapshot?.demo),
      subtotalCents: order.subtotalCents, totalCents: order.totalCents, currency: order.currency, tickets };
  }
  async function updateProfile(userId, input) {
    return models.User.sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user?.isActive) throw notFound('User');
      const before = profile(user);
      const updates = { displayName: input.displayName, phone: input.phone };
      if (input.phone !== user.phone) updates.phoneVerifiedAt = null;
      for (const [flag, column] of [['marketingConsent','marketingConsentAt'], ['transactionalSmsConsent','transactionalSmsConsentAt'], ['marketingSmsConsent','marketingSmsConsentAt']]) {
        updates[column] = input[flag] ? (user[column] || now()) : null;
      }
      // Future SMS provider: verify a changed number before delivering opted-in messages.
      await user.update(updates, { transaction });
      await models.AuditLog.create({ actorUserId: userId, entityType: 'User', entityId: userId, action: 'user.profile_updated', before, after: profile(user) }, { transaction });
      return profile(user);
    });
  }
  async function connections(userId) {
    const [orders, guests, invitations] = await Promise.all([
      models.Order.findAll({ where: { buyerUserId: userId, status: 'paid' }, attributes: ['eventAffiliateId', 'orgAffiliateId'], group: ['eventAffiliateId', 'orgAffiliateId'] }),
      models.GuestlistEntry.findAll({ where: { userId, status: { [Op.in]: ['confirmed', 'checked_in', 'no_show'] } }, attributes: ['eventAffiliateId'], group: ['eventAffiliateId'] }),
      models.GuestlistInvitation.findAll({ where: { acceptedByUserId: userId, status: 'accepted' }, attributes: ['invitedByUserId'], group: ['invitedByUserId'] }),
    ]);
    const eventIds = [...new Set([...orders, ...guests].map((row) => row.eventAffiliateId).filter(Boolean))];
    const orgIds = [...new Set(orders.filter((row) => !row.eventAffiliateId).map((row) => row.orgAffiliateId).filter(Boolean))];
    const [eventRefs, orgRefs] = await Promise.all([
      models.EventAffiliate.findAll({ where: { id: eventIds }, attributes: ['userId'] }),
      models.OrgAffiliate.findAll({ where: { id: orgIds }, attributes: ['userId'] }),
    ]);
    const referrerIds = [...new Set([...eventRefs, ...orgRefs].map((row) => row.userId).concat(invitations.map((row) => row.invitedByUserId)))].filter((id) => id !== userId);
    if (!referrerIds.length) return [];
    // Connections belong to people. Deliberately query ALL current venues and
    // event-only assignments for each referrer, not only the original venue.
    const [leaders, employees, promoters, assignments, users] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { userId: referrerIds } }),
      models.OrganizationEmployee.findAll({ where: { userId: referrerIds, status: 'active' } }),
      models.OrgAffiliate.findAll({ where: { userId: referrerIds, status: 'active' } }),
      models.EventAffiliate.findAll({ where: { userId: referrerIds, status: 'active' } }),
      models.User.findAll({ where: { id: referrerIds, isActive: true }, attributes: ['id', 'displayName'] }),
    ]);
    const organizations = [...new Set([...leaders, ...employees, ...promoters].map((row) => row.organizationId))];
    const events = await models.Event.findAll({ where: { status: 'published', isDiscoverable: true, startsAt: { [Op.gt]: now() },
      [Op.or]: [{ organizationId: organizations }, { id: assignments.map((row) => row.eventId) }, { organizationId: null, creatorUserId: referrerIds }] },
      include: eventInclude.include, order: [['startsAt', 'ASC']], limit: 100 });
    const links = createReferralLinkService({ models, now });
    const result = [];
    for (const event of events) for (const user of users) {
      const eligible = [...leaders, ...employees, ...promoters].some((row) => row.userId === user.id && row.organizationId === event.organizationId)
        || assignments.some((row) => row.eventId === event.id && row.userId === user.id) || (!event.organizationId && event.creatorUserId === user.id);
      if (!eligible) continue;
      try {
        const link = await links.ownLink(user.id, event.id);
        result.push({ event: eventSummary(event), referrer: { id: user.id, name: user.displayName }, code: link.code });
      } catch (error) { if (![403, 404, 409].includes(error.status) && error.code !== 'INVALID_AFFILIATE') throw error; }
    }
    return result;
  }
  return { bookings, ticket, purchaseTickets, guestlistPass, updateProfile, connections };
}
module.exports = { createCustomerAccountService, profile, eventSummary };
