const { Op, QueryTypes } = require('sequelize');
const QRCode = require('qrcode');
const { notFound, conflict } = require('../domain/errors');
const { walletToken, guestlistWalletToken } = require('../domain/wallet-qr');
const { createReferralLinkService } = require('./referral-link-service');
const { redactLocation } = require('../controllers/public-controller');
const { ADMISSION_WINDOW_MS } = require('../domain/admission-policy');
const { assertActiveEvent } = require('./lifecycle-service');
const { connectionHistorySql, pagedConnections } = require('./customer-connections-page-service');

function profile(user) {
  return { id: user.id, displayName: user.displayName, email: user.email, phone: user.phone,
    marketingConsentAt: user.marketingConsentAt, transactionalSmsConsentAt: user.transactionalSmsConsentAt,
    marketingSmsConsentAt: user.marketingSmsConsentAt, phoneVerifiedAt: user.phoneVerifiedAt, emailVerifiedAt: user.emailVerifiedAt };
}
function eventSummary(event, { canViewAttendeeAddress = false } = {}) {
  if (!event) return null;
  const location = event.location?.privacy === 'attendees_only' && canViewAttendeeAddress
    ? event.location.toJSON() : redactLocation(event.location);
  if (location) location.addressVisible = location.privacy === 'public' || (location.privacy === 'attendees_only' && canViewAttendeeAddress);
  return { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, status: event.status,
    imageUrl: event.imageUrl, isPremiumHost: event.organization?.planTier === 'premium', organization: event.organization ? { name: event.organization.name } : null,
    location };
}
function guestlistSummary(entry) {
  if (!entry) return null;
  return { id: entry.id, status: entry.status, partySize: entry.partySize,
    createdAt: entry.createdAt, reviewedAt: entry.reviewedAt };
}
function createCustomerAccountService({ models, tokenSecret, now = () => new Date(), referralLinks }) {
  const eventInclude = { model: models.Event, as: 'event', include: [
    { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'planTier'] },
  ] };
  async function attendeeLocationEventIds(userId, eventIds) {
    const ids = [...new Set(eventIds.filter(Boolean))];
    if (!ids.length) return new Set();
    const [orders, guests] = await Promise.all([
      models.Order.findAll({ where: { buyerUserId: userId, eventId: { [Op.in]: ids }, status: 'paid' }, attributes: ['eventId'] }),
      models.GuestlistEntry.findAll({ where: { userId, eventId: { [Op.in]: ids }, status: { [Op.in]: ['confirmed', 'checked_in'] } }, attributes: ['eventId'] }),
    ]);
    return new Set([...orders, ...guests].map((row) => row.eventId));
  }
  async function eventActiveForAdmission(event) {
    try { await assertActiveEvent(models, event); return true; }
    catch (error) { if ([403, 404].includes(error.status)) return false; throw error; }
  }
  async function guestlistStatus(userId, eventId) {
    const event = await models.Event.findByPk(eventId);
    if (!event) throw notFound('Event');
    const entry = await models.GuestlistEntry.findOne({ where: { userId, eventId }, attributes: ['id', 'status', 'partySize', 'createdAt', 'reviewedAt'] });
    let active = true;
    try { await assertActiveEvent(models, event); }
    catch (error) { if (![403, 404].includes(error.status)) throw error; active = false; }
    const requestsOpen = active && event.status === 'published' && +new Date(event.endsAt) > +now();
    return { entry: guestlistSummary(entry), maxPartySize: 20, requestsOpen };
  }
  async function updatePendingGuestlist(userId, entryId, partySize) {
    return models.GuestlistEntry.sequelize.transaction(async (transaction) => {
      const existing = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, attributes: ['eventId'], transaction });
      if (!existing) throw notFound('Guestlist request');
      const event = await models.Event.findByPk(existing.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const entry = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!entry) throw notFound('Guestlist request');
      if (entry.status !== 'pending') throw conflict('Only pending guestlist requests can be edited', 'GUESTLIST_NOT_EDITABLE');
      await assertActiveEvent(models, event, transaction);
      if (!event || event.status !== 'published' || +new Date(event.endsAt) < +now()) throw conflict('Guestlist request is closed', 'GUESTLIST_CLOSED');
      const before = { partySize: entry.partySize };
      if (entry.partySize !== partySize) {
        await entry.update({ partySize }, { transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id,
          action: 'guestlist.party_size_changed', before, after: { partySize } }, { transaction });
      }
      return { entry: guestlistSummary(entry) };
    });
  }
  async function withdrawPendingGuestlist(userId, entryId) {
    return models.GuestlistEntry.sequelize.transaction(async (transaction) => {
      const existing = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, attributes: ['eventId'], transaction });
      if (!existing) throw notFound('Guestlist request');
      const event = await models.Event.findByPk(existing.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const entry = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!entry) throw notFound('Guestlist request');
      if (entry.status !== 'pending') throw conflict('Only pending guestlist requests can be withdrawn', 'GUESTLIST_NOT_WITHDRAWABLE');
      await assertActiveEvent(models, event, transaction);
      if (event.status !== 'published' || +new Date(event.endsAt) < +now()) throw conflict('Guestlist request is closed', 'GUESTLIST_CLOSED');
      await models.AuditLog.create({ actorUserId: userId, organizationId: event?.organizationId || null, entityType: 'GuestlistEntry', entityId: entry.id,
        action: 'guestlist.withdrawn', before: { eventId: entry.eventId, partySize: entry.partySize, status: entry.status }, after: null }, { transaction });
      await entry.destroy({ transaction });
      if (models.Notification) await models.Notification.update({ dismissedAt: now() }, { where: {
        eventId: entry.eventId, kind: 'guestlist_request', metadata: { [Op.contains]: { entryId: entry.id } }, dismissedAt: { [Op.is]: null },
      }, transaction });
      return { withdrawn: true };
    });
  }
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
    const guests = await models.GuestlistEntry.findAll({ where: { userId, id: timeline.entries.filter((row) => row.kind === 'guestlist').map((row) => row.id) }, attributes: ['id', 'eventId', 'partySize', 'status', 'createdAt'], include: [eventInclude] });
    const addressEvents = await attendeeLocationEventIds(userId, [...orders, ...guests].map((row) => row.eventId));
    return { page, total: timeline.total, entries: timeline.entries, pageSize: 10, orders: orders.map((order) => ({ id: order.id, status: order.status, currency: order.currency,
      subtotalCents: order.subtotalCents, totalCents: order.totalCents, paidAt: order.paidAt,
      demo: Boolean(order.pricingPlanSnapshot?.demo), event: eventSummary(order.event, { canViewAttendeeAddress: addressEvents.has(order.eventId) }),
      items: order.items.map((item) => ({ id: item.id, name: item.nameSnapshot, quantity: item.quantity,
        lineTotalCents: item.lineTotalCents, tickets: item.tickets.filter((ticket) => ticket.holderUserId === userId).map(({ id, status, checkedInAt }) => ({ id, status, checkedInAt })) })) })),
      guestlists: guests.map((guest) => ({ id: guest.id, partySize: guest.partySize, status: guest.status, event: eventSummary(guest.event, { canViewAttendeeAddress: addressEvents.has(guest.eventId) }) })) };
  }
  async function ticket(userId, ticketId) {
    const ticket = await models.Ticket.findOne({ where: { id: ticketId, holderUserId: userId }, include: [{ model: models.OrderItem, as: 'orderItem', include: [{ model: models.Order, as: 'order', include: [eventInclude] }] }] });
    if (!ticket) throw notFound('Ticket');
    const order = ticket.orderItem.order;
    if (ticket.status !== 'valid' || order.status !== 'paid' || order.event.status !== 'published' || +new Date(order.event.endsAt) + ADMISSION_WINDOW_MS < +now() || !(await eventActiveForAdmission(order.event))) throw conflict('This ticket is not available for admission', 'TICKET_UNAVAILABLE');
    const qrToken = walletToken(ticket, tokenSecret);
    const addressEvents = await attendeeLocationEventIds(userId, [order.eventId]);
    return { id: ticket.id, event: eventSummary(order.event, { canViewAttendeeAddress: addressEvents.has(order.eventId) }), offering: ticket.orderItem.nameSnapshot,
      demo: Boolean(order.pricingPlanSnapshot?.demo), qrImage: await QRCode.toDataURL(qrToken, { width: 320, margin: 4, errorCorrectionLevel: 'M' }) };
  }
  async function guestlistPass(userId, entryId) {
    const entry = await models.GuestlistEntry.findOne({ where: { id: entryId, userId }, include: [eventInclude] });
    if (!entry) throw notFound('Guest list entry');
    const showCode = ['confirmed', 'checked_in'].includes(entry.status) && entry.qrTokenHash && entry.event.status === 'published' && +new Date(entry.event.endsAt) + ADMISSION_WINDOW_MS >= +now() && await eventActiveForAdmission(entry.event);
    const addressEvents = await attendeeLocationEventIds(userId, [entry.eventId]);
    return { id: entry.id, kind: 'guestlist', event: eventSummary(entry.event, { canViewAttendeeAddress: addressEvents.has(entry.eventId) }), partySize: entry.partySize,
      tickets: [{ id: entry.id, offering: 'Guest list entry', status: entry.status, checkedInAt: entry.checkedInAt,
        qrImage: showCode ? await QRCode.toDataURL(guestlistWalletToken(entry, tokenSecret), { width: 320, margin: 4, errorCorrectionLevel: 'M' }) : null }] };
  }
  async function purchaseTickets(userId, orderId) {
    const order = await models.Order.findOne({ where: { id: orderId, buyerUserId: userId }, include: [eventInclude,
      { model: models.OrderItem, as: 'items', include: [{ model: models.Ticket, as: 'tickets' }] }] });
    if (!order) throw notFound('Purchase');
    const admissionAvailable = order.status === 'paid' && order.event.status === 'published' && +new Date(order.event.endsAt) + ADMISSION_WINDOW_MS >= +now() && await eventActiveForAdmission(order.event);
    const tickets = [];
    for (const item of order.items) for (const credential of [...item.tickets].sort((a, b) => a.id.localeCompare(b.id))) {
      if (credential.holderUserId !== userId) continue;
      const showCode = admissionAvailable && ['valid', 'checked_in'].includes(credential.status);
      tickets.push({ id: credential.id, offering: item.nameSnapshot, status: credential.status, checkedInAt: credential.checkedInAt,
        qrImage: showCode ? await QRCode.toDataURL(walletToken(credential, tokenSecret), { width: 320, margin: 4, errorCorrectionLevel: 'M' }) : null });
    }
    const addressEvents = await attendeeLocationEventIds(userId, [order.eventId]);
    return { id: order.id, status: order.status, event: eventSummary(order.event, { canViewAttendeeAddress: addressEvents.has(order.eventId) }), demo: Boolean(order.pricingPlanSnapshot?.demo),
      subtotalCents: order.subtotalCents, totalCents: order.totalCents, currency: order.currency, tickets };
  }
  async function updateProfile(userId, input) {
    return models.User.sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user?.isActive) throw notFound('User');
      if (input.phone !== user.phone && input.confirmPhone !== input.phone) {
        throw conflict('Phone confirmation does not match', 'PROFILE_CONFIRMATION_MISMATCH');
      }
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
  async function updateIdentity(userId, input) {
    return models.User.sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user?.isActive) throw notFound('User');
      const email = input.email.trim().toLowerCase();
      if (email !== user.email && input.confirmEmail?.trim().toLowerCase() !== email) {
        throw conflict('Email confirmation does not match', 'PROFILE_CONFIRMATION_MISMATCH');
      }
      if (input.phone !== user.phone && (input.confirmPhone === undefined || input.confirmPhone !== input.phone)) {
        throw conflict('Phone confirmation does not match', 'PROFILE_CONFIRMATION_MISMATCH');
      }
      if (email !== user.email && await models.User.findOne({ where: { email }, transaction })) {
        throw conflict('This email is already in use', 'EMAIL_IN_USE');
      }
      const before = profile(user);
      const updates = { email, displayName: input.displayName.trim(), phone: input.phone };
      if (email !== user.email) updates.emailVerifiedAt = null;
      if (input.phone !== user.phone) updates.phoneVerifiedAt = null;
      try { await user.update(updates, { transaction }); }
      catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') throw conflict('This email is already in use', 'EMAIL_IN_USE');
        throw error;
      }
      await models.AuditLog.create({ actorUserId: userId, entityType: 'User', entityId: userId, action: 'user.identity_updated', before, after: profile(user) }, { transaction });
      return profile(user);
    });
  }
  async function connectionHistory(userId, options = {}) {
    if (models.Order.sequelize?.query) return connectionHistorySql(models, userId, options);
    const [orders, guests, invitations] = await Promise.all([
      models.Order.findAll({ where: { buyerUserId: userId, status: 'paid', [Op.or]: [{ eventAffiliateId: { [Op.ne]: null } }, { orgAffiliateId: { [Op.ne]: null } }] }, attributes: ['id', 'eventId', 'eventAffiliateId', 'orgAffiliateId', 'paidAt', 'createdAt'] }),
      models.GuestlistEntry.findAll({ where: { userId, eventAffiliateId: { [Op.ne]: null } }, attributes: ['id', 'eventId', 'eventAffiliateId', 'status', 'createdAt'] }),
      models.GuestlistInvitation.findAll({ where: { acceptedByUserId: userId, status: 'accepted' }, attributes: ['eventId', 'invitedByUserId', 'acceptedAt'] }),
    ]);
    const eventIds = [...new Set([...orders, ...guests].map((row) => row.eventAffiliateId).filter(Boolean))];
    const orgIds = [...new Set(orders.filter((row) => !row.eventAffiliateId).map((row) => row.orgAffiliateId).filter(Boolean))];
    const [eventRefs, orgRefs] = await Promise.all([
      models.EventAffiliate.findAll({ where: { id: eventIds }, attributes: ['id', 'userId'] }),
      models.OrgAffiliate.findAll({ where: { id: orgIds }, attributes: ['id', 'userId'] }),
    ]);
    const referrerIds = [...new Set([...eventRefs, ...orgRefs].map((row) => row.userId).concat(invitations.map((row) => row.invitedByUserId)))].filter((id) => id !== userId);
    const users = referrerIds.length ? await models.User.findAll({ where: { id: referrerIds, isActive: true }, attributes: ['id', 'displayName'] }) : [];
    const people = users.map((user) => {
      const purchases = orders.filter((row) => (row.eventAffiliateId ? eventRefs.find((ref) => ref.id === row.eventAffiliateId) : orgRefs.find((ref) => ref.id === row.orgAffiliateId))?.userId === user.id);
      const entries = guests.filter((row) => eventRefs.find((ref) => ref.id === row.eventAffiliateId)?.userId === user.id);
      const invites = invitations.filter((row) => row.invitedByUserId === user.id);
      // An invitation and its resulting entry are one guestlist event, not two.
      const guestEvents = new Set([...entries, ...invites].map((row) => row.eventId));
      const dates = [...purchases.map((row) => row.paidAt || row.createdAt), ...entries.map((row) => row.createdAt), ...invites.map((row) => row.acceptedAt)].filter(Boolean).map((date) => new Date(date).toISOString()).sort();
      return { id: user.id, name: user.displayName, bookings: purchases.length, guestlistEvents: guestEvents.size,
        connectedEvents: new Set([...purchases.map((row) => row.eventId), ...guestEvents]).size, lastConnectedAt: dates.at(-1) || null };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { eligible: referrerIds.length > 0, people };
  }
  async function connections(userId, { eventId } = {}) {
    if (eventId && models.Order.sequelize?.query) {
      const items = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await pagedConnections({ models, userId, eventId, page, pageSize: 50, now, referralLinks });
        items.push(...result.items);
        hasMore = result.hasMore;
        page += 1;
      }
      return items;
    }
    const history = await connectionHistory(userId);
    const referrerIds = history.people.map((person) => person.id);
    if (!referrerIds.length) return [];
    // Connections belong to people. Deliberately query ALL current venues and
    // event-only assignments for each referrer, not only the original venue.
    const [leaders, employees, promoters, assignments] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { userId: referrerIds } }),
      models.OrganizationEmployee.findAll({ where: { userId: referrerIds, status: 'active' } }),
      models.OrgAffiliate.findAll({ where: { userId: referrerIds, status: 'active' } }),
      models.EventAffiliate.findAll({ where: { userId: referrerIds, status: 'active' } }),
    ]);
    const organizations = [...new Set([...leaders, ...employees, ...promoters].map((row) => row.organizationId))];
    const events = await models.Event.findAll({ where: { ...(eventId ? { id: eventId } : {}), status: 'published', isDiscoverable: true, startsAt: { [Op.gt]: now() },
      [Op.or]: [{ organizationId: organizations }, { id: assignments.map((row) => row.eventId) }, { organizationId: null, creatorUserId: referrerIds }] },
      include: eventInclude.include, order: [['startsAt', 'ASC']], limit: 100 });
    const links = referralLinks || createReferralLinkService({ models, now });
    const result = [];
    for (const event of events) for (const user of history.people) {
      const eligible = [...leaders, ...employees, ...promoters].some((row) => row.userId === user.id && row.organizationId === event.organizationId)
        || assignments.some((row) => row.eventId === event.id && row.userId === user.id) || (!event.organizationId && event.creatorUserId === user.id);
      if (!eligible) continue;
      try {
        const link = await links.ownLink(user.id, event.id);
        result.push({ event: eventSummary(event), referrer: { id: user.id, name: user.name }, code: link.code });
      } catch (error) { if (![403, 404, 409].includes(error.status) && error.code !== 'INVALID_AFFILIATE') throw error; }
    }
    return result;
  }
  async function connectionsPage(userId, { eventId = null, page = 1, pageSize = 9, city = '', query = '', personIds = [] } = {}) {
    return pagedConnections({ models, userId, eventId, page, pageSize, city, query, personIds, now, referralLinks });
  }
  return { bookings, ticket, purchaseTickets, guestlistPass, guestlistStatus, updatePendingGuestlist, withdrawPendingGuestlist, updateProfile, updateIdentity, connections, connectionsPage, connectionHistory };
}
module.exports = { createCustomerAccountService, profile, eventSummary };
