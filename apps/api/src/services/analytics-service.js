const { DomainError } = require('../domain/errors');
const { venueKey } = require('./venue-scope');

const json = (record) => record?.toJSON ? record.toJSON() : record;
const amount = (value) => Number(value || 0);
const regionKey = (location) => location?.city ? [location.city, location.region, location.countryCode].filter(Boolean).join(', ') : 'Unspecified region';
const entityFor = (event) => event.organization ? { id: event.organization.id, label: event.organization.name, kind: 'organization' } : { id: `creator:${event.creatorUserId}`, label: event.creator?.displayName || 'Independent creator', kind: 'creator' };
function resolveRange(query, now = new Date()) {
  const endDate = query.endDate || now.toISOString().slice(0, 10);
  const startDate = query.startDate || new Date(Date.parse(`${endDate}T00:00:00Z`) - (query.days - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate, since: new Date(`${startDate}T00:00:00Z`), until: new Date(Date.parse(`${endDate}T00:00:00Z`) + 86400000), timezone: 'UTC' };
}

function aggregateHierarchy(eventsInput, ordersInput, { admin = false, includeCustomers = admin, search = '', venueEntities = false, guests = [] } = {}) {
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
  const empty = (id, label, extra = {}) => ({ id, label, ...extra, events: 0, orders: 0, salesCents: 0, ...(admin ? { checkoutCents: 0, platformFeesCents: 0 } : {}), commissionCents: 0, units: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0, customers: 0, averageOrderCents: 0, _buyers: new Set(), _events: new Set() });
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
    const admissions = (order.items || []).reduce((sum, item) => sum + (item.tickets ? item.tickets.filter((t) => ['valid', 'checked_in'].includes(t.status)).length : amount(item.quantity) * amount(item.entriesPerUnitSnapshot)), 0);
    const checkedIn = (order.items || []).reduce((sum, item) => sum + (item.tickets || []).filter((t) => t.status === 'checked_in').length, 0);
    for (const id of path) {
      const row = rows.get(id); row.orders += 1; row.salesCents += amount(order.subtotalCents); if (admin) { row.checkoutCents += amount(order.totalCents); row.platformFeesCents += amount(order.platformFeeCents); } row.commissionCents += amount(order.affiliateCommissionCents); row.units += units; row.admissions += admissions; row._buyers.add(order.buyerUserId);
      row.checkedIn += checkedIn;
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
      const person = customer.get(key) || { id: key, eventId: event.id, buyerUserId: order.buyerUserId, label: order.buyer?.displayName || order.buyer?.email || 'Customer', email: order.buyer?.email || null, orders: 0, salesCents: 0, units: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0 };
      person.orders += 1; person.salesCents += amount(order.subtotalCents); person.units += units; person.admissions += admissions; customer.set(key, person);
      person.checkedIn += checkedIn;
      addChild(`event:${event.id}`, `customer:${key}`);
    }
  }
  for (const guest of guests.map(json)) {
    const event = byEvent.get(guest.eventId);
    if (!event || !['confirmed', 'checked_in'].includes(guest.status)) continue;
    const region = regionKey(event.location), entity = groupEntity(event);
    for (const id of ['all', `region:${region}`, `region:${region}:entity:${entity.id}`, `event:${event.id}`]) {
      rows.get(id).guestlistPlaces += amount(guest.partySize);
      if (guest.status === 'checked_in') rows.get(id).checkedIn += amount(guest.partySize);
    }
    if (includeCustomers && guest.userId) {
      const key = `${event.id}:${guest.userId}`;
      const person = customer.get(key) || { id: key, eventId: event.id, buyerUserId: guest.userId, label: guest.user?.displayName || 'Guest', email: guest.user?.email || null, orders: 0, salesCents: 0, units: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0 };
      person.guestlistPlaces += amount(guest.partySize);
      if (guest.status === 'checked_in') person.checkedIn += amount(guest.partySize);
      customer.set(key, person);
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

function createAnalyticsService({ permissions }) {
  const retired = () => {
    throw new DomainError('This bulk analytics endpoint has been retired. Use SQL-backed summary and paginated report tables.', {
      status: 410, code: 'LEGACY_REPORT_RETIRED', details: { replacements: ['/admin/reports/summary', '/admin/reports/:table', '/business/reports/summary', '/business/reports/:table'] },
    });
  };
  return { adminReport: async (userId) => { await permissions.assertInternal(userId); return retired(); },
    businessReport: async () => retired() };
}
module.exports = { regionKey, resolveRange, aggregateHierarchy, aggregateReferrals, createAnalyticsService };
