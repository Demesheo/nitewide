const { Op, Transaction, fn, col } = require("sequelize");
const { randomUUID } = require('node:crypto');
const { assertEventEditable, eventFinished } = require('../domain/event-policy');
const { activeEventAffiliates } = require('./event-affiliate-scope');
const {
  forbidden,
  conflict,
  notFound,
  DomainError,
} = require("../domain/errors");

// Order snapshots, not today's tier price, are the source of historical sales truth.
function aggregateSales(orders, events, affiliates, memberships, employees = [], guests = []) {
  const byEvent = new Map(
    events.map((e) => [
      e.id,
      { id: e.id, name: e.title, salesCents: 0, orders: 0, units: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0 },
    ]),
  );
  const packages = new Map();
  const people = new Map();
  const daily = new Map();
  for (const membership of memberships) {
    const role = membership.role === 'owner' ? 'Owner' : 'Manager';
    if (people.has(membership.userId)) {
      if (role === 'Owner') people.get(membership.userId).role = role;
      continue;
    }
    people.set(membership.userId, { id: membership.userId, name: membership.user?.displayName || role, role, salesCents: 0, orders: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0 });
  }
  for (const employee of employees) {
    if (people.has(employee.userId)) continue;
    people.set(employee.userId, { id: employee.userId, name: employee.user?.displayName || 'Employee', role: 'Employee', salesCents: 0, orders: 0, commissionCents: 0, guestlistRequests: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0 });
  }
  for (const a of affiliates) {
    const membership = memberships.find((m) => m.userId === a.userId && m.organizationId === a.organizationId);
    const employee = employees.some((e) => e.userId === a.userId && e.organizationId === a.organizationId);
    if (!people.has(a.userId))
      people.set(a.userId, {
        id: a.userId,
        name: a.user?.displayName || "Promoter",
        role: membership ? membership.role === 'owner' ? 'Owner' : 'Manager' : employee ? "Employee" : a.role || "Promoter",
        salesCents: 0,
        orders: 0,
        commissionCents: 0,
        guestlistRequests: 0,
        guestlistPlaces: 0,
        approvedGuestlistPlaces: 0,
      });
    else if (membership?.role === 'owner') people.get(a.userId).role = 'Owner';
    else if (membership && people.get(a.userId).role !== 'Owner') people.get(a.userId).role = 'Manager';
    else if (employee && people.get(a.userId).role === 'Promoter') people.get(a.userId).role = 'Employee';
  }
  const summary = {
    salesCents: 0,
    orders: 0,
    units: 0,
    admissions: 0,
    checkedIn: 0,
    guestlistPlaces: 0,
    commissionCents: 0,
    directSalesCents: 0,
  };
  for (const o of orders) {
    const sales = Number(o.subtotalCents);
    summary.salesCents += sales;
    summary.orders += 1;
    summary.commissionCents += Number(o.affiliateCommissionCents);
    const e = byEvent.get(o.eventId);
    if (e) {
      e.salesCents += sales;
      e.orders++;
    }
    const day = new Date(o.paidAt || o.createdAt).toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + sales);
    const affiliate = affiliates.find(
      (a) => a.id === (o.eventAffiliateId || o.orgAffiliateId),
    );
    if (affiliate) {
      const person = people.get(affiliate.userId);
      person.salesCents += sales;
      person.orders++;
      person.commissionCents += Number(o.affiliateCommissionCents);
    } else summary.directSalesCents += sales;
    for (const item of o.items || []) {
      const key = `${item.kindSnapshot}:${item.nameSnapshot}`;
      const entry = packages.get(key) || {
        id: key,
        name: item.nameSnapshot,
        kind: item.kindSnapshot,
        salesCents: 0,
        units: 0,
      };
      entry.salesCents += Number(item.lineTotalCents);
      entry.units += item.quantity;
      packages.set(key, entry);
      summary.units += item.quantity;
      const admissions = item.tickets ? item.tickets.filter((t) => ['valid', 'checked_in'].includes(t.status)).length : item.quantity * item.entriesPerUnitSnapshot;
      summary.admissions += admissions;
      if (e) e.admissions += admissions;
      const checkedIn = (item.tickets || []).filter((t) => t.status === 'checked_in').length;
      summary.checkedIn += checkedIn;
      if (e) e.checkedIn += checkedIn;
      if (e) e.units += item.quantity;
    }
  }
  const affiliateById = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate]));
  for (const guest of guests) {
    if (['confirmed', 'checked_in'].includes(guest.status)) {
      const spots = Number(guest.partySize || 0);
      const event = byEvent.get(guest.eventId);
      summary.guestlistPlaces += spots;
      if (event) event.guestlistPlaces += spots;
      if (guest.status === 'checked_in') { summary.checkedIn += spots; if (event) event.checkedIn += spots; }
    }
    const affiliate = affiliateById.get(guest.eventAffiliateId);
    const person = affiliate && people.get(affiliate.userId);
    if (!person) continue;
    person.guestlistRequests += 1;
    person.guestlistPlaces += Number(guest.partySize || 0);
    if (['confirmed', 'checked_in'].includes(guest.status)) person.approvedGuestlistPlaces += Number(guest.partySize || 0);
  }
  const sorted = (values) =>
    [...values].sort(
      (a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name),
    );
  return {
    summary,
    events: sorted(byEvent.values()),
    packages: sorted(packages.values()),
    people: sorted(people.values()),
    daily: [...daily]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, salesCents]) => ({ date, salesCents })),
  };
}

const { venueOptions, filterVenues } = require('./venue-scope');
function createBusinessService({
  models,
  permissions,
  now = () => new Date(),
}) {
  async function context(userId) {
    let [user, memberships, employees, orgAffiliates, eventAffiliates] =
      await Promise.all([
        models.User.findByPk(userId),
        models.OrganizationOwner.findAll({ where: { userId } }),
        models.OrganizationEmployee.findAll({ where: { userId, status: 'active' } }),
        models.OrgAffiliate.findAll({ where: { userId, status: "active" } }),
        models.EventAffiliate.findAll({ where: { userId, status: "active" } }),
      ]);
    if (!user?.isActive) throw forbidden("An active account is required");
    eventAffiliates = await activeEventAffiliates(models, eventAffiliates, memberships, employees);
    const managedOrgIds = memberships.map((m) => m.organizationId);
    const ownedOrgIds = memberships.filter((m) => m.role === 'owner').map((m) => m.organizationId);
    const orgIds = [
      ...new Set([
        ...managedOrgIds,
        ...employees.map((e) => e.organizationId),
        ...orgAffiliates.map((a) => a.organizationId),
      ]),
    ];
    const where = user.isInternalAdmin
      ? {}
      : {
          [Op.or]: [
            { creatorUserId: userId, organizationId: null },
            { organizationId: orgIds },
            { id: eventAffiliates.map((a) => a.eventId) },
          ],
        };
    return {
      user,
      managedOrgIds,
      ownedOrgIds,
      orgIds,
      orgAffiliates,
      eventAffiliates,
      where,
    };
  }
  const canManage = (ctx, event) =>
    Boolean(
      ctx.user.isInternalAdmin ||
      (!event.organizationId && event.creatorUserId === ctx.user.id) ||
      ctx.managedOrgIds.includes(event.organizationId),
    );
  async function workspace(userId, query) {
    const ctx = await context(userId);
    const selectedOrganizations = query.organizationIds?.length ? query.organizationIds : query.organizationId ? [query.organizationId] : [];
    const selectedIds = selectedOrganizations.filter((id) => id !== 'independent');
    const filter = selectedOrganizations.length ? { [Op.or]: [
      ...(selectedIds.length ? [{ organizationId: { [Op.in]: selectedIds } }] : []),
      ...(selectedOrganizations.includes('independent') ? [{ organizationId: null }] : []),
    ] } : {};
    const foundEvents = await models.Event.findAll({
      where: { [Op.and]: [ctx.where, filter] },
      include: [
        { model: models.Location, as: "location" },
        { model: models.Offering, as: "offerings" },
      ],
      order: [["startsAt", "DESC"]],
      limit: 501,
    });
    if (foundEvents.length > 500)
      throw new DomainError(
        "Choose an organization to narrow this workspace (500 event limit)",
        { status: 422 },
      );
    const accessibleEvents = foundEvents.filter((event) => event.status !== 'draft' || canManage(ctx, event) || ctx.eventAffiliates.some((affiliate) => affiliate.eventId === event.id));
    const venues = venueOptions(accessibleEvents);
    const events = filterVenues(accessibleEvents, query.venueIds);
    const organizationIds = [
      ...new Set([
        ...ctx.orgIds,
        ...events.map((e) => e.organizationId).filter(Boolean),
      ]),
    ];
    const organizations = await models.Organization.findAll({
      where: ctx.user.isInternalAdmin ? {} : { id: organizationIds },
      include: [{ model: models.Location, as: 'location' }],
      order: [["name", "ASC"]],
    });
    const eventIds = events.map((e) => e.id);
    const managedEventIds = events
      .filter((e) => canManage(ctx, e))
      .map((e) => e.id);
    const [allOrgAffiliates, allEventAffiliates, memberships, employees] =
      await Promise.all([
        models.OrgAffiliate.findAll({
          where: {
            organizationId: [
              ...new Set(events.map((e) => e.organizationId).filter(Boolean)),
            ],
          },
          include: [
            {
              model: models.User,
              as: "user",
              attributes: ["id", "displayName"],
            },
          ],
        }),
        models.EventAffiliate.findAll({
          where: { eventId: eventIds },
          include: [
            {
              model: models.User,
              as: "user",
              attributes: ["id", "displayName"],
            },
          ],
        }),
        models.OrganizationOwner.findAll({
          where: { organizationId: organizationIds },
          include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }],
        }),
        models.OrganizationEmployee.findAll({
          where: { organizationId: organizationIds, status: 'active' },
          include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }],
        }),
      ]);
    const affiliateEvents = allEventAffiliates.map((a) => ({
      ...a.toJSON(),
      organizationId: events.find((e) => e.id === a.eventId)?.organizationId,
      role: !events.find((e) => e.id === a.eventId)?.organizationId && events.find((e) => e.id === a.eventId)?.creatorUserId === a.userId ? 'Creator' : 'Promoter',
    }));
    const affiliates = [
      ...allOrgAffiliates.map((a) => a.toJSON()),
      ...affiliateEvents,
    ];
    const ownOrgIds = ctx.orgAffiliates.map((a) => a.id);
    // Current venue staff can still see their own historical referrals after
    // an event-specific assignment is deactivated; this grants no new event
    // access because the event list was scoped above.
    const ownEventIds = (await models.EventAffiliate.findAll({ where: { userId, eventId: eventIds }, attributes: ['id'] })).map((row) => row.id);
    const eventSales = await models.Order.findAll({
      where: { eventId: eventIds, status: 'paid', currency: 'USD', [Op.or]: [
        { eventId: managedEventIds }, { eventAffiliateId: ownEventIds }, { eventAffiliateId: null, orgAffiliateId: ownOrgIds },
      ] },
      attributes: ['eventId', [fn('SUM', col('subtotal_cents')), 'salesCents'], [fn('COUNT', col('id')), 'paidOrders']],
      group: ['eventId'], raw: true,
    });
    const lifetimeSales = new Map(eventSales.map((row) => [row.eventId, { salesCents: Number(row.salesCents), paidOrders: Number(row.paidOrders) }]));
    const until = now();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - query.days + 1);
    since.setUTCHours(0, 0, 0, 0);
    const orders = await models.Order.findAll({
      where: {
        eventId: eventIds,
        status: "paid",
        currency: "USD",
        paidAt: { [Op.between]: [since, until] },
        [Op.or]: [
          { eventId: managedEventIds },
          { orgAffiliateId: ownOrgIds },
          { eventAffiliateId: ownEventIds },
        ],
      },
      include: [{ model: models.OrderItem, as: "items", include: [{ model: models.Ticket, as: 'tickets', attributes: ['status'] }] }],
      order: [["paidAt", "ASC"]],
      limit: 10001,
    });
    if (orders.length > 10000)
      throw new DomainError(
        "Choose a shorter sales period (10,000 order report limit)",
        { status: 422 },
      );
    const visibleOrders = orders.filter((order) => ctx.user.isInternalAdmin || managedEventIds.includes(order.eventId) || (order.eventAffiliateId ? ownEventIds.includes(order.eventAffiliateId) : ownOrgIds.includes(order.orgAffiliateId)));
    const guestlists = await models.GuestlistEntry.findAll({
      where: { eventId: eventIds, createdAt: { [Op.between]: [since, until] }, [Op.or]: [
        { eventId: managedEventIds }, { eventAffiliateId: ownEventIds },
      ] },
      attributes: ['eventId', 'userId', 'eventAffiliateId', 'partySize', 'status', 'createdAt'],
      limit: 10001,
    });
    if (guestlists.length > 10000) throw new DomainError('Choose a shorter period (10,000 guestlist report limit)', { status: 422 });
    const visibleAffiliates = affiliates.filter(
      (a) =>
        a.userId === userId ||
        ctx.user.isInternalAdmin ||
        ctx.managedOrgIds.includes(a.organizationId) ||
        managedEventIds.includes(a.eventId) ||
        events.some(
          (e) => e.organizationId === a.organizationId && canManage(ctx, e),
        ),
    );
    const reportOrganizationIds = new Set(events.map((event) => event.organizationId).filter(Boolean));
    const visibleMemberships = memberships.filter((membership) => reportOrganizationIds.has(membership.organizationId) && (ctx.user.isInternalAdmin || ctx.managedOrgIds.includes(membership.organizationId) || membership.userId === userId));
    const visibleEmployees = employees.filter((employee) => reportOrganizationIds.has(employee.organizationId) && (ctx.user.isInternalAdmin || ctx.managedOrgIds.includes(employee.organizationId) || employee.userId === userId));
    const report = aggregateSales(
      visibleOrders,
      events,
      visibleAffiliates,
      visibleMemberships,
      visibleEmployees,
      guestlists,
    );
    const daily = new Map(report.daily.map((d) => [d.date, d.salesCents]));
    report.daily = Array.from({ length: query.days }, (_, i) => {
      const day = new Date(since);
      day.setUTCDate(day.getUTCDate() + i);
      const date = day.toISOString().slice(0, 10);
      return { date, salesCents: daily.get(date) || 0 };
    });
    return {
      venues,
      organizations: organizations.map((o) => ({
        id: o.id,
        name: o.name,
        planTier: o.planTier,
        location: o.location,
        canManage: Boolean(
          ctx.user.isInternalAdmin || ctx.managedOrgIds.includes(o.id),
        ),
        canInviteManager: Boolean(ctx.user.isInternalAdmin || ctx.managedOrgIds.includes(o.id)),
      })),
      events: events.map((e) => ({
        ...e.toJSON(),
        canManage: canManage(ctx, e),
        canEdit: canManage(ctx, e) && !eventFinished(e, now()),
        lifetimeSales: lifetimeSales.get(e.id) || { salesCents: 0, paidOrders: 0 },
        canReviewGuestlist: canManage(ctx, e) || ctx.eventAffiliates.some((affiliate) => affiliate.eventId === e.id),
        offerings: [...e.offerings].sort((a, b) => a.sortOrder - b.sortOrder).map((o) => {
          const data = o.toJSON();
          delete data.accessCodeHash;
          if (!canManage(ctx, e)) delete data.quantitySold;
          return data;
        }),
      })),
      report,
      range: {
        since,
        until,
        days: query.days,
        timezone: "UTC",
        currency: "USD",
      },
      scope: managedEventIds.length === events.length && events.length
        ? "managed"
        : managedEventIds.length || ctx.managedOrgIds.length || ctx.user.isInternalAdmin
          ? "mixed"
          : "own",
    };
  }
  async function saveEvent(userId, eventId, input) {
    if (eventId) await permissions.assertManageEvent(userId, eventId);
    else if (input.organizationId)
      await permissions.assertManageOrganization(userId, input.organizationId);
    else {
      const user = await models.User.findByPk(userId);
      if (!user?.isActive) throw forbidden();
    }
    return models.Event.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (transaction) => {
        const event = eventId
          ? await models.Event.findByPk(eventId, {
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          : null;
        if (eventId && !event) throw notFound("Event");
        if (event) assertEventEditable(event, now());
        if (input.endsAt <= now() || input.status === 'completed') throw conflict('Create or edit events with a future end time. Past events are read-only.');
        if (event && event.organizationId !== input.organizationId)
          throw forbidden("Event organization cannot be changed");
        if (event && (input.version == null || input.version !== event.version))
          throw conflict(
            "This event changed. Close and reopen the editor to load the latest version.",
          );
        const existing = event
          ? await models.Offering.findAll({
              where: { eventId },
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          : [];
        const byId = new Map(existing.map((o) => [o.id, o]));
        for (const tier of input.offerings) {
          if (tier.id && !byId.has(tier.id))
            throw forbidden("Tier does not belong to this event");
          const old = byId.get(tier.id);
          if (
            tier.inventoryMode === "finite" &&
            tier.quantityTotal < (old?.quantitySold || 0)
          )
            throw conflict(
              `${tier.name}: inventory cannot be less than units already sold`,
            );
          if (
            old?.quantitySold &&
            (old.kind !== tier.kind ||
              old.entriesPerUnit !== tier.entriesPerUnit)
          )
            throw conflict(
              `${tier.name}: sold tier type and admission count cannot be changed`,
            );
          if (old && old.currency !== "USD")
            throw conflict("This editor supports USD tiers only");
          if (tier.visibility === "password" && !old?.accessCodeHash)
            throw conflict("Password tiers require an existing access code");
        }
        const removedTiers = existing.filter((o) => !input.offerings.some((t) => t.id === o.id));
        for (const removed of removedTiers) {
          // Keep historical orders even if a refunded tier's counter reaches zero.
          // The event + offering locks also serialize this check with checkout.
          if (removed.quantitySold > 0 || await models.OrderItem.count({
            where: { offeringId: removed.id }, transaction,
          })) throw conflict(
            `${removed.name}: tiers with sales or order history cannot be removed. Turn off sales instead.`,
            "TIER_HAS_SALES",
          );
        }
        if (event) {
          const used =
            Number(
              await models.GuestlistEntry.sum("partySize", {
                where: {
                  eventId,
                  eventAffiliateId: null,
                  status: ["confirmed", "checked_in"],
                },
                transaction,
              }),
            ) || 0;
          if (input.guestlistCapacity < used)
            throw conflict(
              `Direct guestlist already has ${used} approved guests`,
            );
        }
        if (input.imageAssetId && input.imageAssetId !== event?.imageAssetId) {
          const asset = await models.MediaAsset.findByPk(input.imageAssetId, {
            transaction,
          });
          if (!asset) throw notFound('Image');
        }
        const before = event
          ? { ...event.toJSON(), offerings: existing.map((o) => o.toJSON()) }
          : null;
        // Venue addresses are controlled by the organization, never by editor input.
        let venueLocation;
        if (input.organizationId) {
          const organization = await models.Organization.findByPk(input.organizationId, { transaction });
          const venueLocationId = event?.locationId || organization?.locationId;
          venueLocation = venueLocationId ? await models.Location.findByPk(venueLocationId, { transaction }) : null;
          if (!venueLocation) throw conflict('This organization needs a saved venue address before creating an event.');
        }
        // Independent locations are copied on write to preserve other events.
        const previousLocation = event?.locationId ? await models.Location.findByPk(event.locationId, { transaction }) : null;
        const sameAddress = previousLocation && input.location && ['addressLine1', 'city', 'region', 'postalCode', 'countryCode'].every((key) => (previousLocation[key] || '') === (input.location[key] || ''));
        const coordinates = sameAddress ? { addressLine2: previousLocation.addressLine2, latitude: previousLocation.latitude, longitude: previousLocation.longitude, geo: previousLocation.geo } : {};
        const location = venueLocation || await models.Location.create({ ...input.location, ...coordinates }, {
          transaction,
        });
        const {
          offerings,
          location: _location,
          version: _version,
          ...fields
        } = input;
        fields.slug = event?.slug || `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150) || 'event'}-${randomUUID().slice(0, 8)}`;
        fields.category = event?.category || 'other';
        const saved = event
          ? await event.update(
              { ...fields, locationId: location.id },
              { transaction },
            )
          : await models.Event.create(
              { ...fields, creatorUserId: userId, locationId: location.id },
              { transaction },
            );
        const savedTiers = [];
        for (const [sortOrder, tier] of offerings.entries()) {
          const { id, releaseAfterIndex, ...values } = tier;
          values.releaseAfterOfferingId = releaseAfterIndex == null ? null : savedTiers[releaseAfterIndex].id;
          if (id)
            savedTiers.push(await byId
              .get(id)
              .update({ ...values, sortOrder }, { transaction }));
          else
            savedTiers.push(await models.Offering.create(
              { ...values, eventId: saved.id, currency: "USD", sortOrder },
              { transaction },
            ));
        }
        // Re-link retained tiers first, then delete only verified unsold tiers.
        if (removedTiers.length) await models.Offering.destroy({
          where: { id: removedTiers.map((tier) => tier.id), eventId: saved.id }, transaction,
        });
        await models.AuditLog.create(
          {
            actorUserId: userId,
            organizationId: saved.organizationId,
            entityType: "Event",
            entityId: saved.id,
            action: event ? "event.updated" : "event.created",
            before,
            after: { ...saved.toJSON(), offerings, location: input.location },
          },
          { transaction },
        );
        return saved;
      },
    );
  }
  return { workspace, saveEvent };
}
module.exports = { createBusinessService, aggregateSales };
