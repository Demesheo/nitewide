const { Op } = require('sequelize');
const { DomainError, forbidden } = require('../domain/errors');
const { activeEventAffiliates } = require('./event-affiliate-scope');
const { venueKey, venueOptions, filterVenues } = require('./venue-scope');

const json = (record) => record?.toJSON ? record.toJSON() : record;
const amount = (value) => Number(value || 0);
const regionKey = (location) => location?.city ? [location.city, location.region, location.countryCode].filter(Boolean).join(', ') : 'Unspecified region';
const entityFor = (event) => event.organization ? { id: event.organization.id, label: event.organization.name, kind: 'organization' } : { id: `creator:${event.creatorUserId}`, label: event.creator?.displayName || 'Independent creator', kind: 'creator' };
function resolveRange(query, now = new Date()) {
  const endDate = query.endDate || now.toISOString().slice(0, 10);
  const startDate = query.startDate || new Date(Date.parse(`${endDate}T00:00:00Z`) - (query.days - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate, since: new Date(`${startDate}T00:00:00Z`), until: new Date(Date.parse(`${endDate}T00:00:00Z`) + 86400000), timezone: 'UTC' };
}

function aggregateHierarchy(eventsInput, ordersInput, { admin = false, includeCustomers = admin, search = '', venueEntities = false } = {}) {
  const groupEntity = event => venueEntities && event.organization && event.location?.name
    ? { id: venueKey(event), label: event.location.name, kind: 'venue' } : entityFor(event);
  const events = eventsInput.map(json);
  const orders = ordersInput.map(json);
  const term = search.trim().toLowerCase();
  const eligible = events.filter((event) => {
    if (!term) return true;
    const entity = groupEntity(event);
    const haystack = [regionKey(event.location), entity.label, event.title, event.category, event.summary].join(' ').toLowerCase();
    return haystack.includes(term) || (admin && orders.some((order) => order.eventId === event.id && [order.buyer?.displayName, order.buyer?.email].join(' ').toLowerCase().includes(term)));
  });
  const eventIds = new Set(eligible.map((event) => event.id));
  const byEvent = new Map(eligible.map((event) => [event.id, event]));
  const rows = new Map();
  const empty = (id, label, extra = {}) => ({ id, label, ...extra, events: 0, orders: 0, salesCents: 0, ...(admin ? { checkoutCents: 0, platformFeesCents: 0 } : {}), commissionCents: 0, units: 0, admissions: 0, customers: 0, averageOrderCents: 0, _buyers: new Set(), _events: new Set() });
  const get = (id, label, extra) => { if (!rows.has(id)) rows.set(id, empty(id, label, extra)); return rows.get(id); };
  const root = get('all', 'All selected');
  const children = new Map();
  const addChild = (parent, child) => { if (!children.has(parent)) children.set(parent, new Set()); children.get(parent).add(child); };
  for (const event of eligible) {
    const region = regionKey(event.location); const entity = groupEntity(event);
    const regionId = `region:${region}`; const entityId = `${regionId}:entity:${entity.id}`; const eventId = `event:${event.id}`;
    const r = get(regionId, region, { level: 'region', region });
    const o = get(entityId, entity.label, { level: 'entity', region, entityId: entity.id, kind: entity.kind });
    const e = get(eventId, event.title, { level: 'event', region, entityId: entity.id, eventId: event.id, status: event.status, startsAt: event.startsAt });
    for (const row of [root, r, o, e]) row._events.add(event.id);
    addChild('all', regionId); addChild(regionId, entityId); addChild(entityId, eventId);
  }
  const daily = new Map(); const category = new Map(); const offering = new Map(); const customer = new Map();
  for (const order of orders) {
    if (!eventIds.has(order.eventId)) continue;
    const event = byEvent.get(order.eventId); const region = regionKey(event.location); const entity = groupEntity(event);
    const path = ['all', `region:${region}`, `region:${region}:entity:${entity.id}`, `event:${event.id}`];
    const units = (order.items || []).reduce((sum, item) => sum + amount(item.quantity), 0);
    const admissions = (order.items || []).reduce((sum, item) => sum + amount(item.quantity) * amount(item.entriesPerUnitSnapshot), 0);
    for (const id of path) {
      const row = rows.get(id); row.orders += 1; row.salesCents += amount(order.subtotalCents); if (admin) { row.checkoutCents += amount(order.totalCents); row.platformFeesCents += amount(order.platformFeeCents); } row.commissionCents += amount(order.affiliateCommissionCents); row.units += units; row.admissions += admissions; row._buyers.add(order.buyerUserId);
    }
    const date = new Date(order.paidAt).toISOString().slice(0, 10);
    const day = daily.get(date) || { date, salesCents: 0, orders: 0 }; day.salesCents += amount(order.subtotalCents); day.orders += 1; daily.set(date, day);
    const cat = category.get(event.category) || { label: event.category || 'Other', salesCents: 0, orders: 0 }; cat.salesCents += amount(order.subtotalCents); cat.orders += 1; category.set(event.category, cat);
    for (const item of order.items || []) {
      const key = `${item.kindSnapshot}:${item.nameSnapshot}`;
      const tier = offering.get(key) || { label: item.nameSnapshot, kind: item.kindSnapshot, salesCents: 0, units: 0 };
      tier.salesCents += amount(item.lineTotalCents); tier.units += amount(item.quantity); offering.set(key, tier);
    }
    if (includeCustomers && order.buyerUserId) {
      const key = `${event.id}:${order.buyerUserId}`;
      const person = customer.get(key) || { id: key, eventId: event.id, buyerUserId: order.buyerUserId, label: order.buyer?.displayName || order.buyer?.email || 'Customer', email: order.buyer?.email || null, orders: 0, salesCents: 0, units: 0, admissions: 0 };
      person.orders += 1; person.salesCents += amount(order.subtotalCents); person.units += units; person.admissions += admissions; customer.set(key, person);
      addChild(`event:${event.id}`, `customer:${key}`);
    }
  }
  const finish = (row) => { const { _buyers, _events, ...safe } = row; return { ...safe, customers: _buyers.size, events: _events.size, averageOrderCents: row.orders ? Math.round(row.salesCents / row.orders) : 0 }; };
  const hierarchy = [...rows.values()].filter((row) => row.id !== 'all').map(finish);
  const customerRows = includeCustomers ? [...customer.values()].map((row) => ({ ...row, level: 'customer', id: `customer:${row.id}`, averageOrderCents: row.orders ? Math.round(row.salesCents / row.orders) : 0 })) : [];
  const sorted = (items) => [...items].sort((a, b) => b.salesCents - a.salesCents || a.label.localeCompare(b.label));
  return {
    summary: finish(root),
    hierarchy: sorted(hierarchy).concat(sorted(customerRows)),
    children: Object.fromEntries([...children].map(([key, value]) => [key, [...value]])),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    category: sorted(category.values()), offerings: sorted(offering.values()),
  };
}

function aggregateReferrals(ordersInput, affiliatesInput, membershipsInput = [], employeesInput = [], guestsInput = []) {
  const affiliates = new Map(affiliatesInput.map((raw) => { const row = json(raw); return [row.id, row]; }));
  const roles = new Map();
  const people = new Map(); const customers = new Map();
  for (const raw of membershipsInput) {
    const membership = json(raw);
    const role = membership.role === 'owner' ? 'Owner' : 'Manager';
    roles.set(membership.userId, role === 'Owner' ? role : roles.get(membership.userId) || role);
    if (!membership.user) continue;
    const existing = people.get(membership.userId);
    if (existing) { existing.role = roles.get(membership.userId); continue; }
    people.set(membership.userId, { id: membership.userId, label: membership.user.displayName || role, role, orders: 0, salesCents: 0, units: 0, customers: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0, _buyers: new Set() });
  }
  for (const raw of employeesInput) {
    const employee = json(raw);
    if (roles.has(employee.userId)) continue;
    roles.set(employee.userId, 'Employee');
    if (!employee.user) continue;
    people.set(employee.userId, { id: employee.userId, label: employee.user.displayName || 'Employee', role: 'Employee', orders: 0, salesCents: 0, units: 0, customers: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0, _buyers: new Set() });
  }
  for (const affiliate of affiliates.values()) {
    if (people.has(affiliate.userId)) continue;
    people.set(affiliate.userId, { id: affiliate.userId, label: json(affiliate.user)?.displayName || affiliate.role || 'Promoter', role: roles.get(affiliate.userId) || affiliate.role || 'Promoter', orders: 0, salesCents: 0, units: 0, customers: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0, _buyers: new Set() });
  }
  for (const raw of ordersInput) {
    const order = json(raw);
    const affiliate = affiliates.get(order.eventAffiliateId || order.orgAffiliateId);
    if (!affiliate) continue;
    const user = json(affiliate.user) || {};
    const key = affiliate.userId;
    const person = people.get(key) || { id: key, label: user.displayName || affiliate.role || 'Promoter', role: roles.get(key) || affiliate.role || 'Promoter', orders: 0, salesCents: 0, units: 0, customers: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0, _buyers: new Set() };
    person.orders += 1; person.salesCents += amount(order.subtotalCents); person.commissionCents += amount(order.affiliateCommissionCents); person.units += (order.items || []).reduce((sum, item) => sum + amount(item.quantity), 0); person._buyers.add(order.buyerUserId); people.set(key, person);
    if (order.buyerUserId) {
      const customerKey = `${key}:${order.buyerUserId}`;
      const buyer = json(order.buyer) || {};
      const customer = customers.get(customerKey) || { id: customerKey, personId: key, label: buyer.displayName || buyer.email || 'Customer', email: buyer.email || null, orders: 0, salesCents: 0, units: 0 };
      customer.orders += 1; customer.salesCents += amount(order.subtotalCents); customer.units += (order.items || []).reduce((sum, item) => sum + amount(item.quantity), 0); customers.set(customerKey, customer);
    }
  }
  for (const raw of guestsInput) {
    const guest = json(raw);
    const affiliate = affiliates.get(guest.eventAffiliateId);
    if (!affiliate) continue;
    const user = json(affiliate.user) || {};
    const key = affiliate.userId;
    const person = people.get(key) || { id: key, label: user.displayName || affiliate.role || 'Promoter', role: roles.get(key) || affiliate.role || 'Promoter', orders: 0, salesCents: 0, units: 0, customers: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0, _buyers: new Set() };
    person.guestlistRequests += 1;
    person.guestlistPlaces += amount(guest.partySize);
    if (['confirmed', 'checked_in'].includes(guest.status)) person.approvedGuestlistPlaces += amount(guest.partySize);
    if (guest.userId) person._buyers.add(guest.userId);
    people.set(key, person);
    if (guest.userId) {
      const customerKey = `${key}:${guest.userId}`;
      const guestUser = json(guest.user) || {};
      const customer = customers.get(customerKey) || { id: customerKey, personId: key, label: guestUser.displayName || guestUser.email || 'Customer', email: guestUser.email || null, orders: 0, salesCents: 0, units: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0 };
      customer.guestlistRequests = amount(customer.guestlistRequests) + 1;
      customer.guestlistPlaces = amount(customer.guestlistPlaces) + amount(guest.partySize);
      if (['confirmed', 'checked_in'].includes(guest.status)) customer.approvedGuestlistPlaces = amount(customer.approvedGuestlistPlaces) + amount(guest.partySize);
      customers.set(customerKey, customer);
    }
  }
  return { people: [...people.values()].map(({ _buyers, ...person }) => ({ ...person, customers: _buyers.size })).sort((a, b) => b.salesCents - a.salesCents), customers: [...customers.values()].sort((a, b) => b.salesCents - a.salesCents) };
}

function createAnalyticsService({ models, permissions, now = () => new Date() }) {
  async function report(userId, query, admin = false) {
    if (admin) await permissions.assertInternal(userId);
    const range = resolveRange(query, now());
    const [user, memberships, employees, orgAffiliates, eventAffiliates] = admin ? [null, [], [], [], []] : await Promise.all([
      models.User.findByPk(userId), models.OrganizationOwner.findAll({ where: { userId } }), models.OrganizationEmployee.findAll({ where: { userId, status: 'active' } }), models.OrgAffiliate.findAll({ where: { userId, status: 'active' } }), models.EventAffiliate.findAll({ where: { userId, status: 'active' } }),
    ]);
    if (!admin && !user?.isActive) throw forbidden('An active account is required');
    const currentEventAffiliates = admin ? [] : await activeEventAffiliates(models, eventAffiliates, memberships, employees);
    const managedOrgIds = new Set(memberships.map((row) => row.organizationId));
    const ownOrgAffiliateIds = new Set(orgAffiliates.map((row) => row.id));
    const ownEventAffiliateIds = new Set(currentEventAffiliates.map((row) => row.id));
    const accessWhere = admin || user.isInternalAdmin ? {} : { [Op.or]: [
      { creatorUserId: userId, organizationId: null }, { organizationId: { [Op.in]: [...managedOrgIds, ...employees.map((row) => row.organizationId), ...orgAffiliates.map((row) => row.organizationId)] } }, { id: { [Op.in]: currentEventAffiliates.map((row) => row.eventId) } },
    ] };
    const rawEvents = await models.Event.findAll({ where: accessWhere, attributes: ['id', 'title', 'summary', 'category', 'status', 'startsAt', 'organizationId', 'creatorUserId', 'locationId'], include: [
      { model: models.Location, as: 'location', attributes: ['id', 'name', 'addressLine1', 'city', 'region', 'countryCode'] },
      { model: models.Organization, as: 'organization', attributes: ['id', 'name'], required: false },
      { model: models.User, as: 'creator', attributes: ['id', 'displayName'], required: false },
    ], limit: 5001 });
    if (rawEvents.length > 5000) throw new DomainError('Narrow the report: more than 5,000 events are in scope', { status: 422 });
    const allEvents = rawEvents.map(json).filter((event) => event.status !== 'draft' || admin || user.isInternalAdmin || managedOrgIds.has(event.organizationId) || (!event.organizationId && event.creatorUserId === userId) || currentEventAffiliates.some((affiliate) => affiliate.eventId === event.id));
    const options = { regions: [...new Set(allEvents.map((event) => regionKey(event.location)))].sort(), organizations: [...new Map(allEvents.map((event) => { const entity = entityFor(event); return [entity.kind === 'creator' ? 'independent' : entity.id, { id: entity.kind === 'creator' ? 'independent' : entity.id, label: entity.kind === 'creator' ? 'Independent creators' : entity.label }]; })).values()].sort((a, b) => a.label.localeCompare(b.label)) };
    const selectedEvents = allEvents.filter((event) => (!query.regions.length || query.regions.includes(regionKey(event.location))) && (!query.organizationIds.length || query.organizationIds.includes(event.organizationId || 'independent')));
    options.venues = venueOptions(selectedEvents).map(({ id, label, organizationId }) => ({ id, label, organizationId }));
    const events = filterVenues(selectedEvents, query.venueIds);
    const eventIds = events.map((event) => event.id);
    if (!admin) {
      const historical = await models.EventAffiliate.findAll({ where: { userId, eventId: { [Op.in]: eventIds } }, attributes: ['id'] });
      historical.forEach((row) => ownEventAffiliateIds.add(row.id));
    }
    const rawOrders = await models.Order.findAll({ where: { eventId: { [Op.in]: eventIds }, status: 'paid', currency: 'USD', paidAt: { [Op.gte]: range.since, [Op.lt]: range.until } }, attributes: ['id', 'eventId', 'buyerUserId', 'subtotalCents', ...(admin ? ['totalCents', 'platformFeeCents'] : []), 'affiliateCommissionCents', 'orgAffiliateId', 'eventAffiliateId', 'paidAt'], include: [
      { model: models.OrderItem, as: 'items', attributes: ['nameSnapshot', 'kindSnapshot', 'quantity', 'entriesPerUnitSnapshot', 'lineTotalCents'] },
      { model: models.User, as: 'buyer', attributes: ['id', 'displayName', 'email'] },
    ], limit: 20001 });
    if (rawOrders.length > 20000) throw new DomainError('Narrow the date, region, or organization filters: report exceeds 20,000 orders', { status: 422 });
    const rawGuests = await models.GuestlistEntry.findAll({ where: { eventId: { [Op.in]: eventIds }, createdAt: { [Op.gte]: range.since, [Op.lt]: range.until } }, attributes: ['id', 'eventId', 'userId', 'eventAffiliateId', 'partySize', 'status', 'createdAt'], include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }], limit: 20001 });
    if (rawGuests.length > 20000) throw new DomainError('Narrow the date, region, or organization filters: report exceeds 20,000 guestlist requests', { status: 422 });
    const eventById = new Map(events.map((event) => [event.id, event]));
    const orders = rawOrders.map(json).filter((order) => admin || user.isInternalAdmin || (() => {
      const event = eventById.get(order.eventId);
      const creditedAffiliateId = order.eventAffiliateId || order.orgAffiliateId;
      return event && ((!event.organizationId && event.creatorUserId === userId) || managedOrgIds.has(event.organizationId) || ownEventAffiliateIds.has(creditedAffiliateId) || ownOrgAffiliateIds.has(creditedAffiliateId));
    })());
    const orgIds = [...new Set(events.map((event) => event.organizationId).filter(Boolean))];
    const [orgRefs, eventRefs, teamMemberships, teamEmployees] = admin ? [[], [], [], []] : await Promise.all([
      models.OrgAffiliate.findAll({ where: { organizationId: { [Op.in]: orgIds } }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }] }),
      models.EventAffiliate.findAll({ where: { eventId: { [Op.in]: eventIds } }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }] }),
      models.OrganizationOwner.findAll({ where: { organizationId: { [Op.in]: orgIds.filter((id) => managedOrgIds.has(id)) } }, attributes: ['userId', 'organizationId', 'role'], include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }] }),
      models.OrganizationEmployee.findAll({ where: { status: 'active', [Op.or]: [
        { organizationId: { [Op.in]: orgIds.filter((id) => user.isInternalAdmin || managedOrgIds.has(id)) } },
        { organizationId: { [Op.in]: orgIds.filter((id) => employees.some((row) => row.organizationId === id)) }, userId },
      ] }, attributes: ['userId', 'organizationId', 'status'], include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }] }),
    ]);
    const scopedMemberships = teamMemberships.map(json);
    const scopedEmployees = teamEmployees.map(json);
    const refById = new Map([...orgRefs, ...eventRefs].map((raw) => { const ref = json(raw); return [ref.id, ref]; }));
    const matchedEvents = query.search ? events.filter((event) => {
      const term = query.search.toLowerCase();
      return [regionKey(event.location), entityFor(event).label, event.location?.name, event.title, event.category, event.summary].join(' ').toLowerCase().includes(term) || orders.some((order) => {
        if (order.eventId !== event.id) return false;
        const ref = refById.get(order.eventAffiliateId || order.orgAffiliateId);
        return [order.buyer?.displayName, order.buyer?.email, ref?.user?.displayName].filter(Boolean).join(' ').toLowerCase().includes(term);
      });
    }) : events;
    const matchedEventIds = new Set(matchedEvents.map((event) => event.id));
    const visibleOrders = orders.filter((order) => matchedEventIds.has(order.eventId));
    const visibleGuests = rawGuests.map(json).filter((guest) => {
      if (!matchedEventIds.has(guest.eventId)) return false;
      if (admin || user.isInternalAdmin) return true;
      const event = eventById.get(guest.eventId);
      return Boolean(event && ((!event.organizationId && event.creatorUserId === userId) || managedOrgIds.has(event.organizationId) || ownEventAffiliateIds.has(guest.eventAffiliateId)));
    });
    const matchedOrganizationIds = new Set(matchedEvents.map((event) => event.organizationId).filter(Boolean));
    const scopedRefs = admin ? [] : [...orgRefs, ...eventRefs].filter((raw) => {
      const ref = json(raw);
      const event = eventById.get(ref.eventId);
      const inSelection = ref.eventId ? matchedEventIds.has(ref.eventId) : matchedOrganizationIds.has(ref.organizationId);
      return inSelection && (user.isInternalAdmin || ref.userId === userId || managedOrgIds.has(ref.organizationId || event?.organizationId) || (!event?.organizationId && event?.creatorUserId === userId));
    }).map((raw) => { const ref = json(raw); const event = eventById.get(ref.eventId); return { ...ref, role: event && !event.organizationId && event.creatorUserId === ref.userId ? 'Creator' : undefined }; });
    return { range: { startDate: range.startDate, endDate: range.endDate, timezone: 'UTC', currency: 'USD' }, options, ...aggregateHierarchy(matchedEvents, visibleOrders, { admin, includeCustomers: true, venueEntities: !admin }), ...(admin ? {} : { referrals: aggregateReferrals(visibleOrders, scopedRefs, scopedMemberships.filter((row) => matchedOrganizationIds.has(row.organizationId)), scopedEmployees.filter((row) => matchedOrganizationIds.has(row.organizationId)), visibleGuests) }), scope: admin ? 'platform' : managedOrgIds.size || user.isInternalAdmin || allEvents.some((event) => !event.organizationId && event.creatorUserId === userId) ? 'managed_or_mixed' : 'own' };
  }
  return { adminReport: (userId, query) => report(userId, query, true), businessReport: (userId, query) => report(userId, query, false) };
}
module.exports = { regionKey, resolveRange, aggregateHierarchy, aggregateReferrals, createAnalyticsService };
