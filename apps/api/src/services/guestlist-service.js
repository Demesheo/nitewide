const { createQrToken } = require('../domain/qr');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');
const { assertGuestlistCapacity } = require('./guestlist-capacity');
const { createNotificationService } = require('./notification-service');
const { queueGuestlistEmail } = require('./email-events');
const { queueGuestlistReviewNeeded } = require('./business-email-events');
const { assertActiveUser, assertActiveEvent } = require('./lifecycle-service');
const { mutationTransaction } = require('./mutation-transaction');
const { createPermissionService } = require('./permission-service');
const { forbidden } = require('../domain/errors');
const { MAX_GUESTLIST_REQUEST_PARTY_SIZE, MAX_GUESTLIST_APPROVAL_PARTY_SIZE, assertGuestlistPartySize } = require('../domain/guestlist-party-size');
const { reconcileGuestlistPasses } = require('./guestlist-pass-service');

function createGuestlistService({ sequelize, models, permissions = createPermissionService(models), now = () => new Date(), email = null, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/', reviewEmailsEnabled = false }) {
  const notifications = createNotificationService(models);
  async function request(input, context = {}) {
    assertGuestlistPartySize(input.partySize, MAX_GUESTLIST_REQUEST_PARTY_SIZE);
    return mutationTransaction(sequelize, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      await assertActiveEvent(models, event, transaction);
      assertActiveUser(await models.User.findByPk(input.userId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' }));
      if (event.status !== 'published' || +new Date(event.endsAt) < +now()) throw new DomainError('Guestlist is not open', { code: 'GUESTLIST_CLOSED' });
      if (await models.GuestlistEntry.findOne({ where: { eventId: event.id, userId: input.userId }, transaction, lock: transaction.LOCK.UPDATE })) {
        throw conflict('You already have a guestlist request for this event', 'GUESTLIST_ALREADY_REQUESTED');
      }
      const requestedAt = now();
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: requestedAt, transaction });
      if (input.affiliateCode) {
        if (!affiliate.eventAffiliate) throw new DomainError('Promoter must be selected for this event', { code: 'AFFILIATE_NOT_SELECTED' });
      }
      // Pending requests reserve no spots. Capacity is enforced at approval.
      const entry = await models.GuestlistEntry.create({
        eventId: event.id, userId: input.userId, eventAffiliateId: affiliate.eventAffiliate?.id,
        source: input.affiliateCode ? 'affiliate' : 'event', partySize: input.partySize, status: 'pending', qrTokenHash: null,
      }, { transaction });
      await models.AffiliateAttribution.create({ eventId: event.id, userId: input.userId, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id, action: 'guestlist', occurredAt: requestedAt, metadata: { status: 'requested' } }, { transaction });
      await models.AuditLog.create({ actorUserId: input.userId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.requested', after: { partySize: input.partySize, source: entry.source } }, { transaction });
      await queueGuestlistEmail({ email, models, entry, event, kind: 'received', customerAppUrl, transaction });
      if (models.Notification || (reviewEmailsEnabled && email?.enabled)) {
        const requester = await models.User.findByPk(input.userId, { transaction });
        const leaders = event.organizationId
          ? (await models.OrganizationOwner.findAll({ where: { organizationId: event.organizationId }, attributes: ['userId'], transaction })).map((row) => row.userId)
          : [event.creatorUserId];
        const reviewerIds = [affiliate.eventAffiliate?.userId, ...leaders];
        const uniqueReviewers = [...new Set(reviewerIds.filter((id) => id && id !== input.userId))];
        if (models.Notification) for (const reviewerId of uniqueReviewers) await notifications.emit({ userId: reviewerId, eventId: event.id, kind: 'guestlist_request', title: 'Guestlist request', message: `${requester?.displayName || 'A customer'} requests ${input.partySize} ${input.partySize === 1 ? 'spot' : 'spots'} for ${event.title}.`, metadata: { entryId: entry.id, referrerUserId: affiliate.eventAffiliate?.userId || null } }, transaction);
        if (reviewEmailsEnabled) await queueGuestlistReviewNeeded({ email, models, reviewerIds: uniqueReviewers, entry, event, businessAppUrl, transaction });
      }
      if (context.onCreated) await context.onCreated(entry, event, transaction);
      return { entry, requiresApproval: true };
    });
  }

  async function review(input, context = {}) {
    if (!['approve', 'reject', 'cancel'].includes(input.decision)) throw new DomainError('Choose a guestlist review decision', { code: 'INVALID_GUESTLIST_DECISION', status: 422 });
    if (input.partySize !== undefined) {
      if (input.decision !== 'approve') throw new DomainError('Spots can only be adjusted when approving a request', { code: 'INVALID_GUESTLIST_DECISION', status: 422 });
      assertGuestlistPartySize(input.partySize, MAX_GUESTLIST_APPROVAL_PARTY_SIZE);
    }
    return mutationTransaction(sequelize, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      if (context.beforeReview) await context.beforeReview(event, transaction);
      const scope = await permissions.guestlistReviewScope(input.reviewedByUserId, input.eventId, transaction);
      const entry = await models.GuestlistEntry.findOne({ where: { id: input.entryId, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!entry) throw notFound('Guestlist request');
      if (!scope.canReviewAny && !scope.eventAffiliateIds.includes(entry.eventAffiliateId)) throw forbidden('You can only review guestlist requests referred by you');
      if (input.decision === 'cancel') {
        if (entry.status !== 'confirmed' || entry.checkedInAt || entry.checkedInSpots > 0) throw conflict('Only an approved, unused guestlist entry can have its approval revoked', 'GUESTLIST_NOT_CANCELLABLE');
        await entry.update({ status: 'rejected', qrTokenHash: null, reviewedByUserId: input.reviewedByUserId, reviewedAt: now(), reviewNote: input.note || null }, { transaction });
        await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId,
          entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.approval_revoked',
          before: { status: 'confirmed', partySize: entry.partySize, eventAffiliateId: entry.eventAffiliateId },
          after: { status: 'rejected', note: input.note || null } }, { transaction });
        if (models.Notification && entry.userId) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_declined', title: 'Guestlist approval revoked', message: `Your guestlist approval for ${event.title} was revoked.`, metadata: { entryId: entry.id } }, transaction);
        await queueGuestlistEmail({ email, models, entry, event, kind: 'declined', customerAppUrl, transaction });
        if (context.onReviewed) await context.onReviewed(entry, event, transaction);
        return { entry, qrToken: null };
      }
      if (input.decision === 'approve' ? !['pending', 'rejected'].includes(entry.status) : entry.status !== 'pending') throw conflict('Guestlist request cannot be reviewed in its current state', 'GUESTLIST_ALREADY_REVIEWED');
      const reviewedAt = now();
      if (input.decision === 'reject') {
        await entry.update({ status: 'rejected', reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
        await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.rejected', after: { note: input.note || null } }, { transaction });
        if (models.Notification && entry.userId) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_declined', title: 'Guestlist request declined', message: `Your request for ${event.title} was declined.`, metadata: { entryId: entry.id } }, transaction);
        await queueGuestlistEmail({ email, models, entry, event, kind: 'declined', customerAppUrl, transaction });
        if (context.onReviewed) await context.onReviewed(entry, event, transaction);
        return { entry, qrToken: null };
      }

      const approvedPartySize = assertGuestlistPartySize(input.partySize === undefined ? entry.partySize : input.partySize, MAX_GUESTLIST_APPROVAL_PARTY_SIZE);
      const before = { status: entry.status, partySize: entry.partySize };
      await assertGuestlistCapacity(models, event, entry.eventAffiliateId, approvedPartySize, transaction, reviewedAt);
      const qr = createQrToken();
      await entry.update({ partySize: approvedPartySize, status: 'confirmed', qrTokenHash: qr.hash, reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
      await reconcileGuestlistPasses(models, entry, transaction);
      await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.approved', before, after: { status: 'confirmed', partySize: entry.partySize } }, { transaction });
      if (models.Notification && entry.userId) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_approved', title: 'Guestlist approved', message: `You were approved for ${entry.partySize} ${entry.partySize === 1 ? 'spot' : 'spots'} on the guestlist for ${event.title}.`, metadata: { entryId: entry.id, partySize: entry.partySize } }, transaction);
      await queueGuestlistEmail({ email, models, entry, event, kind: 'approved', customerAppUrl, transaction });
      if (context.onReviewed) await context.onReviewed(entry, event, transaction);
      return { entry, qrToken: qr.token };
    });
  }

  return { request, review };
}
module.exports = { createGuestlistService };
