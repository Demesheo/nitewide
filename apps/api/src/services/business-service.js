const { mutationTransaction } = require('./mutation-transaction');
const { randomUUID } = require('node:crypto');
const { assertEventEditable } = require('../domain/event-policy');
const { activeUser, assertActiveEvent, assertActiveOrganization, assertOrganizationVenue } = require('./lifecycle-service');
const { queueEventEmail, formatTime, venueName } = require('./email-events');
const { queueBusinessEventStatus } = require('./business-email-events');
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

function createBusinessService({
  models,
  permissions,
  email = null,
  customerAppUrl = 'http://localhost:5173',
  businessAppUrl = 'http://localhost:5174/app',
  now = () => new Date(),
}) {
  async function workspace() {
    throw new DomainError('This bulk workspace has been retired. Use /business/bootstrap, /business/events, and /business/reports/summary with paginated /business/reports/:table.', {
      status: 410, code: 'LEGACY_REPORT_RETIRED',
      details: { replacements: ['/business/bootstrap', '/business/events', '/business/reports/summary', '/business/reports/:table'] },
    });
  }
  async function saveEvent(userId, eventId, input) {
    return mutationTransaction(models.Event.sequelize,
      async (transaction) => {
        // Lock every involved event in UUID order, including image reuse, before
        // permission reads or child rows. Two events can reuse each other's art.
        for (const id of [...new Set([eventId, input.reusedImageFromEventId].filter(Boolean))].sort())
          await models.Event.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        const event = eventId
          ? await models.Event.findByPk(eventId, {
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          : null;
        if (eventId && !event) throw notFound("Event");
        if (eventId) await permissions.assertManageEvent(userId, eventId, transaction);
        else if (input.organizationId) await permissions.assertManageOrganization(userId, input.organizationId, transaction);
        const actor = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' });
        if (!activeUser(actor)) throw forbidden('An active account is required');
        if (!actor.isInternalAdmin) {
          if (event) await assertActiveEvent(models, event, transaction);
          else if (input.organizationId) await assertActiveOrganization(models, input.organizationId, transaction);
          else if (!actor.independentCreator) throw forbidden('Independent event creation access is required');
        }
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
              order: [['id', 'ASC']],
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
          if (asset.status !== 'ready') throw conflict('Image upload is not ready. Please upload it again.', 'MEDIA_NOT_READY');
          if (asset.uploadedByUserId !== userId) {
            // A newly uploaded image can be shared among the active managers of
            // the same organization. Unrelated uploaders still need a managed
            // source event explicitly named for reuse.
            const colleague = input.organizationId && await models.OrganizationOwner.findOne({
              where: { organizationId: input.organizationId, userId: asset.uploadedByUserId, lifecycleState: 'active' },
              transaction,
            });
            if (!colleague) {
              if (!input.reusedImageFromEventId) throw forbidden('Use an image uploaded by your organization or explicitly reuse one from an event you manage');
              const source = await permissions.assertManageEvent(userId, input.reusedImageFromEventId, transaction);
              if (source.imageAssetId !== asset.id || source.organizationId !== input.organizationId ||
                (!source.organizationId && source.creatorUserId !== userId)) throw forbidden('This image cannot be reused for the new event');
            }
          }
        }
        const before = event
          ? { ...event.toJSON(), offerings: existing.map((o) => o.toJSON()) }
          : null;
        // Venue addresses are controlled by the organization, never by editor input.
        let venueLocation;
        if (input.organizationId) {
          const organization = await models.Organization.findByPk(input.organizationId, { transaction });
          const venueLocationId = input.locationId || event?.locationId || organization?.locationId;
          await assertOrganizationVenue(models, organization, venueLocationId, transaction);
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
          reusedImageFromEventId: _reusedImageFromEventId,
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
        if (email?.enabled && saved.status === 'published' && (!event || before.status !== 'published')) {
          await queueBusinessEventStatus({ email, models, event: saved, change: 'Published', details: 'Your event is now published.',
            actionId: `published-${saved.version || saved.id}`, businessAppUrl, transaction });
        }
        if (event && before.status === 'published') {
          if (saved.status === 'cancelled') {
            await queueEventEmail({ email, models, event: saved, kind: 'cancelled',
              variables: { EVENT_DATE: formatTime(before.startsAt, previousLocation?.timezone) },
              customerAppUrl, transaction, key: `cancelled-${saved.version}` });
            await queueBusinessEventStatus({ email, models, event: saved, change: 'Cancelled', details: 'Sales have stopped. Refunds are not automatic; coordinate them separately.',
              actionId: `cancelled-${saved.version}`, businessAppUrl, transaction });
          } else if (saved.status === 'published') {
            if (Math.abs(+new Date(before.startsAt) - +new Date(saved.startsAt)) >= 15 * 60 * 1000 || Math.abs(+new Date(before.endsAt) - +new Date(saved.endsAt)) >= 15 * 60 * 1000) {
              await queueEventEmail({ email, models, event: saved, kind: 'timeChange',
                variables: {
                  OLD_TIME: `${formatTime(before.startsAt, previousLocation?.timezone)} – ${formatTime(before.endsAt, previousLocation?.timezone)}`,
                  NEW_TIME: `${formatTime(saved.startsAt, location?.timezone)} – ${formatTime(saved.endsAt, location?.timezone)}`,
                }, customerAppUrl, transaction, key: `time-${saved.version}` });
              await queueBusinessEventStatus({ email, models, event: saved, change: 'Time changed',
                details: `${formatTime(before.startsAt, previousLocation?.timezone)} → ${formatTime(saved.startsAt, location?.timezone)}`,
                actionId: `time-${saved.version}`, businessAppUrl, transaction });
            }
            if (previousLocation && venueName(previousLocation) !== venueName(location)) {
              await queueEventEmail({ email, models, event: saved, kind: 'venueChange',
                variables: { OLD_VENUE: venueName(previousLocation), NEW_VENUE: venueName(location) },
                customerAppUrl, transaction, key: `venue-${saved.version}` });
              await queueBusinessEventStatus({ email, models, event: saved, change: 'Venue changed',
                details: `${venueName(previousLocation)} → ${venueName(location)}`,
                actionId: `venue-${saved.version}`, businessAppUrl, transaction });
            }
          }
        }
        return saved;
      },
    );
  }
  return { workspace, saveEvent };
}
module.exports = { createBusinessService, aggregateSales };
