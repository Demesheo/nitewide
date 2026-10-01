const { conflict, forbidden } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');
const { activeUser, assertActiveEvent, assertActiveOrganization } = require('./lifecycle-service');
const { queueEventEmail, formatTime, venueName } = require('./email-events');
const { queueBusinessEventStatus } = require('./business-email-events');
const { assertEditorPricing } = require('../domain/editor-pricing-policy');

async function authorizeEventWrite({ models, permissions, userId, event, organizationId, locationId, transaction, now = new Date() }) {
  const actor = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' });
  if (!activeUser(actor)) throw forbidden('An active account is required');
  if (actor.isInternalAdmin && permissions.assertInternalPermission) await permissions.assertInternalPermission(userId, 'events.manage', transaction);
  else if (event) await permissions.assertManageEvent(userId, event.id, transaction);
  else if (organizationId) {
    if (permissions.assertCreateEvent) await permissions.assertCreateEvent(userId, organizationId, locationId, transaction);
    else await permissions.assertManageOrganization(userId, organizationId, transaction);
  }
  if (!actor.isInternalAdmin) {
    if (event) await assertActiveEvent(models, event, transaction);
    else if (organizationId) await assertActiveOrganization(models, organizationId, transaction);
    else if (!actor.independentCreator) throw forbidden('Independent event creation access is required');
  }
  if (event) assertEventEditable(event, now);
  return actor;
}

async function assertDirectCapacity({ models, eventId, capacity, transaction }) {
  const used = Number(await models.GuestlistEntry.sum('partySize', { where: {
    eventId, eventAffiliateId: null, status: ['confirmed', 'checked_in'],
  }, transaction })) || 0;
  if (capacity < used) throw conflict(`Direct guestlist already has ${used} approved guests`);
}

async function persistOffering({ models, eventId, values, previous = null, transaction, pricingValidated = false }) {
  if (values.inventoryMode === 'finite' && values.quantityTotal < (previous?.quantitySold || 0)) throw conflict(`${values.name}: inventory cannot be less than units already sold`);
  if (previous?.quantitySold && (previous.kind !== values.kind || previous.entriesPerUnit !== values.entriesPerUnit)) throw conflict(`${values.name}: sold tier type and admission count cannot be changed`);
  if (values.maxPerOrder < values.minPerOrder) throw conflict('Maximum quantity must be at least the minimum');
  if (values.salesStartAt && values.salesEndAt && values.salesEndAt <= values.salesStartAt) throw conflict('Sales end must be after sales start');
  if (values.visibility === 'password' && !previous?.accessCodeHash) throw conflict('Password tiers require an existing access code');
  if (!pricingValidated) {
    // Legacy and record-level offering writes use the same price protections as
    // the full editor. That editor validates its whole draft once, before writes.
    const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!event) throw conflict('Select an existing event', 'EVENT_NOT_FOUND');
    await assertEditorPricing({ models, eventId, organizationId: event.organizationId,
      eventFeeMode: event.feeMode || 'buyer', offerings: [{ ...(previous?.toJSON ? previous.toJSON() : previous || {}), ...values }], transaction });
  }
  return previous ? previous.update(values, { transaction }) : models.Offering.create({ ...values, eventId }, { transaction });
}

// Both API generations call this inside the transaction that saves the event.
// The outbox, audit and lifecycle-sensitive publication rules cannot diverge.
async function recordEventMutation({ models, email, userId, saved, before, offerings = [], location, previousLocation,
  customerAppUrl, businessAppUrl, transaction, adminReason = null }) {
  await models.AuditLog.create({ actorUserId: userId, organizationId: saved.organizationId, entityType: 'Event', entityId: saved.id,
    action: `${adminReason ? 'admin.' : ''}${before ? 'event.updated' : 'event.created'}`, before,
    after: { ...saved.toJSON(), offerings, location, ...(adminReason ? { adminReason } : {}) } }, { transaction });
  if (email?.enabled && saved.status === 'published' && (!before || before.status !== 'published')) {
    await queueBusinessEventStatus({ email, models, event: saved, change: 'Published', details: 'Your event is now published.',
      actionId: `published-${saved.version || saved.id}`, businessAppUrl, transaction });
  }
  if (before?.status !== 'published') return;
  if (saved.status === 'cancelled') {
    await queueEventEmail({ email, models, event: saved, kind: 'cancelled', variables: { EVENT_DATE: formatTime(before.startsAt, previousLocation?.timezone) }, customerAppUrl, transaction, key: `cancelled-${saved.version}` });
    await queueBusinessEventStatus({ email, models, event: saved, change: 'Cancelled', details: 'Sales have stopped. Refunds are not automatic; coordinate them separately.', actionId: `cancelled-${saved.version}`, businessAppUrl, transaction });
  } else if (saved.status === 'published') {
    if (Math.abs(+new Date(before.startsAt) - +new Date(saved.startsAt)) >= 15 * 60 * 1000 || Math.abs(+new Date(before.endsAt) - +new Date(saved.endsAt)) >= 15 * 60 * 1000) {
      await queueEventEmail({ email, models, event: saved, kind: 'timeChange', variables: { OLD_TIME: `${formatTime(before.startsAt, previousLocation?.timezone)} – ${formatTime(before.endsAt, previousLocation?.timezone)}`, NEW_TIME: `${formatTime(saved.startsAt, location?.timezone)} – ${formatTime(saved.endsAt, location?.timezone)}` }, customerAppUrl, transaction, key: `time-${saved.version}` });
      await queueBusinessEventStatus({ email, models, event: saved, change: 'Time changed', details: `${formatTime(before.startsAt, previousLocation?.timezone)} → ${formatTime(saved.startsAt, location?.timezone)}`, actionId: `time-${saved.version}`, businessAppUrl, transaction });
    }
    if (previousLocation && venueName(previousLocation) !== venueName(location)) {
      await queueEventEmail({ email, models, event: saved, kind: 'venueChange', variables: { OLD_VENUE: venueName(previousLocation), NEW_VENUE: venueName(location) }, customerAppUrl, transaction, key: `venue-${saved.version}` });
      await queueBusinessEventStatus({ email, models, event: saved, change: 'Venue changed', details: `${venueName(previousLocation)} → ${venueName(location)}`, actionId: `venue-${saved.version}`, businessAppUrl, transaction });
    }
  }
}
module.exports = { authorizeEventWrite, assertDirectCapacity, persistOffering, recordEventMutation };
