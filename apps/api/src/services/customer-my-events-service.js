const { QueryTypes } = require('sequelize');
const { assertBusinessAccess } = require('./business-access-policy');
const { access, base, manages, ownGuestlistReviewAssignments } = require('./business-read-service');
const { ownCommissionSql, demoOrderSql, verifiedStripeOrderSql } = require('./business-payment-report-policy');
const { netCommissionSql } = require('./refund-report-policy');
const { assertActiveEvent } = require('./lifecycle-service');
const { eventFinished, assertEventEditable } = require('../domain/event-policy');
const { conflict } = require('../domain/errors');
const { canClaimInvitation } = require('./guestlist-invitation-policy');

function customerEvent(event) {
  // Customer operations expose business statistics, never payment account or
  // editor capabilities. Use a closed projection so future model fields remain
  // private unless deliberately added here.
  const fields = ['id', 'organizationId', 'locationId', 'imageUrl', 'title', 'slug', 'summary', 'description',
    'category', 'status', 'startsAt', 'endsAt', 'capacity', 'guestlistCapacity', 'isDiscoverable',
    'location', 'offerings', 'canManage', 'isManagedVenue', 'lifetimeSales', 'canReviewGuestlist'];
  const result = Object.fromEntries(fields.filter((key) => event[key] !== undefined).map((key) => [key, event[key]]));
  if (event.organization) result.organization = Object.fromEntries(['id', 'name', 'slug', 'planTier']
    .filter((key) => event.organization[key] !== undefined).map((key) => [key, event.organization[key]]));
  return result;
}

function createCustomerMyEventsService({ models, businessRead, businessEventRead, invitations, referralLinks, reviewGuestlist, now = () => new Date() }) {
  const select = (sql, replacements) => models.Event.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const assertAccess = (userId, transaction) => assertBusinessAccess(models, userId, transaction, undefined, { allowSuspendedOrganizations: false });
  async function eligibility(userId) {
    try { await assertAccess(userId); return { eligible: true }; }
    catch (error) { if (error.code === 'BUSINESS_ACCESS_REQUIRED') return { eligible: false }; throw error; }
  }

  // Reuse the collection/domain scopes in one query for the page, including the
  // exact venue linkage needed by a venue employee or promoter assignment.
  const ownAssignments = ownGuestlistReviewAssignments;
  // Direct invitations use access.manage, not the broader events.manage
  // review override. The remaining manager/creator SQL is shared verbatim.
  const directInvitations = manages.replace(/:canManageEvents\b/g, ':canManageBusinesses');
  async function capabilities(userId, events) {
    if (!events.length) return new Map();
    const actor = await businessRead.actor(userId);
    const rows = await select(`SELECT e.id,
      (${access.replace(/:isAdmin\b/g, 'false')} AND NOT EXISTS (SELECT 1 FROM event_affiliates removed
        WHERE removed.event_id=e.id AND removed.user_id=:userId AND (NOT EXISTS (${ownAssignments} AND ea.id=removed.id)
          OR (removed.org_affiliate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM org_affiliates linked
            WHERE linked.id=removed.org_affiliate_id AND linked.status='active'
              AND (linked.starts_at IS NULL OR linked.starts_at <= :currentTime)
              AND (linked.ends_at IS NULL OR linked.ends_at >= :currentTime)))))) AS "canShareReferral",
      (${manages} OR EXISTS (${ownAssignments})) AS "canReviewGuestlist",
      ((${manages} AND ${directInvitations}) OR EXISTS (${ownAssignments} AND COALESCE(ea.guestlist_allocation,
        (SELECT oa.default_guestlist_allocation FROM org_affiliates oa WHERE oa.id=ea.org_affiliate_id AND oa.status='active'
          AND (oa.starts_at IS NULL OR oa.starts_at<=:currentTime) AND (oa.ends_at IS NULL OR oa.ends_at>=:currentTime)),0)>0
        AND (ea.org_affiliate_id IS NULL OR EXISTS (SELECT 1 FROM org_affiliates oa WHERE oa.id=ea.org_affiliate_id AND oa.status='active'
          AND (oa.starts_at IS NULL OR oa.starts_at<=:currentTime) AND (oa.ends_at IS NULL OR oa.ends_at>=:currentTime))))) AS "canInviteGuestlist"
      FROM events e WHERE e.id IN (:ids) AND ${base}`,
    { ...actor, ids: events.map((event) => event.id), currentTime: now() });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return new Map(events.map((event) => {
      const row = byId.get(event.id);
      const readOnly = !row || event.status !== 'published' || eventFinished(event, now());
      return [event.id, { readOnly, canShareReferral: !readOnly && Boolean(row?.canShareReferral),
        canInviteGuestlist: !readOnly && Boolean(row?.canInviteGuestlist), canReviewGuestlist: !readOnly && Boolean(row?.canReviewGuestlist) }];
    }));
  }
  async function events(userId, input) {
    await assertAccess(userId);
    const page = await businessRead.events(userId, input);
    const byId = await capabilities(userId, page.items);
    return { ...page, items: page.items.map((event) => ({ ...customerEvent(event),
      scope: event.canManage ? 'event' : 'own',
      canReviewGuestlist: byId.get(event.id).canReviewGuestlist, capabilities: byId.get(event.id) })) };
  }
  async function personalEarnings(userId, eventId) {
    const [row] = await select(`SELECT COALESCE(SUM(${netCommissionSql()}),0)::bigint AS earned,
      COALESCE(SUM(${netCommissionSql()}) FILTER (WHERE ${demoOrderSql()}),0)::bigint AS demo,
      COALESCE(SUM(${netCommissionSql()}) FILTER (WHERE ${verifiedStripeOrderSql()}),0)::bigint AS sandbox
      FROM orders o WHERE o.event_id=:eventId AND o.status='paid' AND o.currency='USD' AND ${ownCommissionSql()}`, { userId, eventId });
    const earned = Number(row.earned), demo = Number(row.demo), sandbox = Number(row.sandbox);
    return { currency: 'USD', earnedCommissionCents: earned, demoCommissionCents: demo, sandboxCommissionCents: sandbox,
      unverifiedCommissionCents: earned - demo - sandbox, receivedPayouts: null, payoutsTracked: false };
  }
  async function detail(userId, eventId) {
    await assertAccess(userId);
    const data = await businessEventRead.summary(userId, eventId);
    const byId = await capabilities(userId, [data.event]);
    return { ...data, event: customerEvent(data.event), personalEarnings: await personalEarnings(userId, eventId), capabilities: byId.get(eventId) };
  }
  async function guestlist(userId, eventId, input) {
    await assertAccess(userId);
    return businessEventRead.guestlist(userId, eventId, input);
  }
  async function guestlistEntry(userId, eventId, entryId) {
    await assertAccess(userId);
    return businessEventRead.guestlistEntry(userId, eventId, entryId);
  }
  async function openEvent(event, transaction) {
    await assertActiveEvent(models, event, transaction);
    assertEventEditable(event, now());
    if (event.status !== 'published') throw conflict('This event is not accepting guestlist changes', 'GUESTLIST_CLOSED');
  }
  async function referralLink(userId, eventId) {
    await assertAccess(userId);
    return referralLinks.ownLink(userId, eventId, { assertAccess });
  }
  async function invitePools(userId, eventId) {
    await assertAccess(userId);
    const pools = await invitations.pools(userId, eventId);
    if (!pools.open) return pools;
    const event = await models.Event.findByPk(eventId);
    // Review authority alone is insufficient to issue a usable invitation.
    // Validate the small, caller-only pool set against the same authority used
    // during creation/claim. EventAffiliate is unique per event and caller.
    const direct = pools.direct && await canClaimInvitation(models, { invitedByUserId: userId }, event, undefined, now());
    const own = [];
    for (const pool of pools.own) {
      if (await canClaimInvitation(models, { invitedByUserId: userId, eventAffiliateId: pool.id }, event, undefined, now())) own.push(pool);
    }
    return { ...pools, direct, own };
  }
  async function invite(userId, eventId, input) {
    await assertAccess(userId);
    return invitations.invite(userId, eventId, input, { beforeInvite: async (event, transaction) => {
      await assertAccess(userId, transaction); await openEvent(event, transaction);
    } });
  }
  async function invitationLink(userId, eventId, entryId) {
    await assertAccess(userId);
    return invitations.link(userId, eventId, entryId, { beforeLink: async (event, transaction) => {
      await assertAccess(userId, transaction); await openEvent(event, transaction);
    } });
  }
  async function review(userId, eventId, entryId, input) {
    await assertAccess(userId);
    const result = await reviewGuestlist({ ...input, eventId, entryId, reviewedByUserId: userId }, { beforeReview: async (event, transaction) => {
      await assertAccess(userId, transaction); await openEvent(event, transaction);
    } });
    const entry = result.entry.toJSON ? result.entry.toJSON() : { ...result.entry };
    delete entry.qrTokenHash;
    return { ...result, entry };
  }
  return { eligibility, events, detail, guestlist, guestlistEntry, referralLink, invitePools, invite, invitationLink, review };
}

module.exports = { createCustomerMyEventsService, customerEvent };
