const { QueryTypes } = require('sequelize');
const { forbidden } = require('../domain/errors');
const { activeUser } = require('./lifecycle-service');
const { venueOptions } = require('./venue-scope');
const { eventFinished } = require('../domain/event-policy');
const { resolvePaidRange } = require('./business-report-period');
const { accessScopeSql } = require('./event-affiliate-access');
const { hasInternalPermission } = require('./internal-admin-permissions');
const { venueMemberSql,venueManagerSql } = require('./venue-access-policy');
const { canViewEarningsSql } = require('./business-payment-report-policy');
const { netSubtotalSql, commissionExpenseSql: netCommissionSql, financialOrderSql } = require('./refund-report-policy');
const { paymentsReady } = require('./business-payment-account-service');

// Every collection and aggregate starts from this SQL scope. In particular, a
// revoked automatic assignment cannot keep a former staff member in an event.
const organizationMember = `(
  EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id = e.organization_id AND oo.user_id = :userId AND oo.lifecycle_state = 'active')
  OR EXISTS (SELECT 1 FROM organization_employees oe WHERE oe.organization_id = e.organization_id AND oe.user_id = :userId AND oe.status = 'active')
  OR EXISTS (SELECT 1 FROM org_affiliates oa WHERE oa.organization_id = e.organization_id AND oa.user_id = :userId AND oa.status = 'active'
    AND (oa.starts_at IS NULL OR oa.starts_at <= NOW()) AND (oa.ends_at IS NULL OR oa.ends_at >= NOW()))
)`;
const access = `(
  :isAdmin OR (e.organization_id IS NULL AND e.creator_user_id = :userId)
  OR ${organizationMember}
  OR ${venueMemberSql('e')}
  OR EXISTS (SELECT 1 FROM event_affiliates ea WHERE ea.event_id = e.id AND ea.user_id = :userId AND ea.status = 'active'
    AND (ea.starts_at IS NULL OR ea.starts_at <= NOW()) AND (ea.ends_at IS NULL OR ea.ends_at >= NOW())
    AND (${accessScopeSql('ea')} = 'event' OR ${organizationMember}))
)`;
const manages = `(:canManageEvents OR (e.organization_id IS NULL AND e.creator_user_id = :userId)
  OR EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id = e.organization_id AND oo.user_id = :userId AND oo.lifecycle_state = 'active')
  OR ${venueManagerSql('e')})`;
const base = `e.lifecycle_state = 'active'
  AND (e.organization_id IS NULL OR EXISTS (SELECT 1 FROM organizations org WHERE org.id = e.organization_id AND org.lifecycle_state = 'active' AND org.status = 'active'))
  AND (e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations loc WHERE loc.id = e.location_id AND loc.lifecycle_state = 'active'))
  AND (e.organization_id IS NOT NULL OR EXISTS (SELECT 1 FROM users creator WHERE creator.id = e.creator_user_id AND creator.lifecycle_state = 'active' AND creator.is_active = true AND creator.onboarding_pending = false))
  AND ${access}
  AND (e.status <> 'draft' OR :isAdmin OR ${manages} OR EXISTS (SELECT 1 FROM event_affiliates draft_ea WHERE draft_ea.event_id = e.id AND draft_ea.user_id = :userId AND draft_ea.status = 'active'
    AND (draft_ea.starts_at IS NULL OR draft_ea.starts_at <= NOW()) AND (draft_ea.ends_at IS NULL OR draft_ea.ends_at >= NOW())
    AND (${accessScopeSql('draft_ea')} = 'event' OR ${organizationMember})))`;
const orderAccess = `(:isAdmin OR ${manages}
  OR EXISTS (SELECT 1 FROM event_affiliates own_ea WHERE own_ea.id = o.event_affiliate_id AND own_ea.user_id = :userId)
  OR (o.event_affiliate_id IS NULL AND EXISTS (SELECT 1 FROM org_affiliates own_oa WHERE own_oa.id = o.org_affiliate_id AND own_oa.user_id = :userId AND own_oa.status = 'active')))`;
const guestAccess = `(:isAdmin OR ${manages} OR EXISTS (SELECT 1 FROM event_affiliates own_ea WHERE own_ea.id = g.event_affiliate_id AND own_ea.user_id = :userId))`;
// Match guestlistReviewScope: a venue assignment is valid only through its
// exact, still-active venue grant, just as organization assignments require
// current membership. Share this between business/customer read capabilities.
const ownGuestlistReviewAssignments = `SELECT ea.id FROM event_affiliates ea WHERE ea.event_id=e.id AND ea.user_id=:userId AND ea.status='active'
  AND (ea.starts_at IS NULL OR ea.starts_at<=NOW()) AND (ea.ends_at IS NULL OR ea.ends_at>=NOW())
  AND (${accessScopeSql('ea')}='event' OR (${accessScopeSql('ea')}='organization' AND ${organizationMember})
    OR (${accessScopeSql('ea')}='venue' AND EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov
      ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
      WHERE va.id=ea.venue_access_id AND va.organization_id=e.organization_id AND va.location_id=e.location_id
        AND va.user_id=:userId AND va.status='active')))`;

const pageResult = (items, total, page, pageSize) => ({ items, total: Number(total || 0), page, pageSize, hasMore: page * pageSize < Number(total || 0) });
const cents = (value) => Number(value || 0);
const cleanVenue = column => `REGEXP_REPLACE(LOWER(COALESCE(${column},'')),'[^a-z0-9]','','g')`;
const venueIdentitySql = `encode(digest('["'||COALESCE(e.organization_id::text,'creator:'||e.creator_user_id::text)||'","'||
  ${['name','address_line1','city','region','country_code'].map(column => cleanVenue(`filter_location.${column}`)).join(`||'","'||`)}||'"]','sha256'),'hex')`;

function createBusinessReadService({ models, email = null, stripe = null, deliveryTrackingConfigured = false, now = () => new Date(), internalReadPermission = 'reports.view' }) {
  const select = (sql, replacements, { transaction } = {}) => models.Event.sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  async function actor(userId, { transaction } = {}) {
    const user = await models.User.findByPk(userId, { transaction, attributes: ['id', 'isActive', 'lifecycleState', 'onboardingPending', 'isInternalAdmin', 'internalAdminRole', 'independentCreator'] });
    if (!activeUser(user)) throw forbidden('An active account is required');
    const memberships = await models.OrganizationOwner.findAll({ transaction, where: { userId, lifecycleState: 'active' }, attributes: ['organizationId'] });
    return { userId, isAdmin: hasInternalPermission(user, internalReadPermission), canManageBusinesses: hasInternalPermission(user, 'access.manage'), canManageEvents: hasInternalPermission(user, 'events.manage'), user,
      managedOrgIds: new Set(memberships.map((row) => row.organizationId)) };
  }
  async function organizations(scope, { transaction } = {}) {
    const broadAccess = `(:isAdmin OR ${organizationMember.replace(/\be\.organization_id\b/g,'org.id')})`;
    const rows = await select(`SELECT org.id, org.name, org.plan_tier AS "planTier",
      EXISTS (SELECT 1 FROM organization_owners owner_scope WHERE owner_scope.organization_id=org.id AND owner_scope.user_id=:userId AND owner_scope.lifecycle_state='active' AND owner_scope.role='owner') AS "isOwner",
      CASE WHEN ${broadAccess} THEN org.location_id ELSE NULL END AS "locationId",
      ${broadAccess} AS "organizationWideAccess",
      EXISTS (SELECT 1 FROM organization_owners finance WHERE finance.organization_id=org.id AND finance.user_id=:userId AND finance.lifecycle_state='active' AND (finance.role='owner' OR finance.role='admin' AND finance.finance_authorized)) AS "canManageFinance",
      (:canManageEvents OR EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id=org.id AND oo.user_id=:userId AND oo.lifecycle_state='active')
        OR EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
          JOIN locations venue_location ON venue_location.id=va.location_id AND venue_location.lifecycle_state='active'
          WHERE va.organization_id=org.id AND va.user_id=:userId AND va.status='active' AND va.role='manager')) AS "canCreateEvents",
      (${scope.canManageBusinesses ? 'true' : `EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id = org.id AND oo.user_id = :userId AND oo.lifecycle_state = 'active')`}) AS "canManage"
      FROM organizations org WHERE org.lifecycle_state = 'active' AND org.status = 'active' AND
      (${broadAccess}
      OR EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
        JOIN locations venue_location ON venue_location.id=va.location_id AND venue_location.lifecycle_state='active'
        WHERE va.organization_id=org.id AND va.user_id=:userId AND va.status='active')
      OR EXISTS (SELECT 1 FROM events e WHERE e.organization_id=org.id AND ${base}))
      ORDER BY org.name ASC, org.id ASC LIMIT 101`, scope, { transaction });
    const locations = await models.Location.findAll({ transaction, where: { id: rows.map((r) => r.locationId).filter(Boolean), lifecycleState: 'active' } });
    const byId = new Map(locations.map((r) => [r.id, r]));
    const result = rows.slice(0,100).map((r) => ({ ...r, location: byId.get(r.locationId) || null, canInviteManager: r.canManage }));
    result.hasMore = rows.length>100;
    return result;
  }
  async function venues(scope, orgs, { transaction } = {}) {
    const locations = await select(`SELECT DISTINCT e.organization_id AS "organizationId", e.creator_user_id AS "creatorUserId", e.location_id AS "locationId",
      EXISTS (SELECT 1 FROM organization_venues link WHERE link.organization_id=e.organization_id AND link.location_id=e.location_id) AS "isManagedVenue"
      FROM events e WHERE ${base} AND e.location_id IS NOT NULL
      UNION SELECT DISTINCT ov.organization_id, NULL::uuid, ov.location_id, true
      FROM organization_venues ov JOIN locations loc ON loc.id = ov.location_id AND loc.lifecycle_state = 'active'
      WHERE ov.organization_id IN (:organizationIds) AND (:isAdmin OR ${organizationMember.replace(/\be\.organization_id\b/g,'ov.organization_id')} OR ${venueMemberSql('ov')})
      ORDER BY "organizationId","locationId" LIMIT 101`,
    { ...scope, organizationIds: orgs.map((o) => o.id).length ? orgs.map((o) => o.id) : ['00000000-0000-0000-0000-000000000000'] }, { transaction });
    const placeRows = await models.Location.findAll({ transaction, where: { id: [...new Set(locations.map((r) => r.locationId))], lifecycleState: 'active' } });
    const byId = new Map(placeRows.map((r) => [r.id, r]));
    const result = venueOptions(locations.slice(0,100).filter((r) => byId.has(r.locationId)).map((r) => ({ ...r, location: byId.get(r.locationId) })));
    result.hasMore = locations.length>100;
    return result;
  }
  async function bootstrap(userId) {
    const scope = await actor(userId);
    const [earningsAccess] = await select(`SELECT ${canViewEarningsSql} AS "canViewEarnings",
      EXISTS (SELECT 1 FROM events e WHERE e.organization_id IS NULL AND ${base}) AS "canViewIndependent",
      EXISTS (SELECT 1 FROM organization_owners portfolio_owner JOIN organizations portfolio_org ON portfolio_org.id=portfolio_owner.organization_id
        WHERE portfolio_owner.user_id=:userId AND portfolio_owner.lifecycle_state='active' AND portfolio_owner.role='owner'
          AND portfolio_org.lifecycle_state='active' AND portfolio_org.status='active') AS "canViewOwnedOrganizations"`, scope);
    const orgs = await organizations(scope);
    const venueOptions = await venues(scope,orgs);
    return { organizations: orgs, venues: venueOptions, setupProgress: await setupProgress(scope, orgs), optionsTruncated: { organizations: orgs.hasMore,venues: venueOptions.hasMore },
      capabilities: { emailConfigured: Boolean(email?.enabled), deliveryTrackingConfigured,
        smsConfigured: false, instructions: Boolean(email?.enabled), notifications: true },
      scope: { canCreateIndependent: Boolean(scope.canManageBusinesses || scope.user.independentCreator), canViewIndependent: Boolean(earningsAccess?.canViewIndependent), canViewOwnedOrganizations: Boolean(earningsAccess?.canViewOwnedOrganizations), isInternalAdmin: Boolean(scope.user.isInternalAdmin), canViewEarnings: Boolean(earningsAccess?.canViewEarnings) } };
  }
  async function setupProgress(scope, orgs) {
    // Organization onboarding belongs to owners/organization managers, not
    // promoters, employees, or managers restricted to one venue. One bounded
    // query reads milestones, independent of report dates and event pagination.
    const managed = orgs.filter(org => org.canManage);
    if (!managed.length) return [];
    const shared = stripe?.mode === 'test' && stripe.sandboxSharedAccountId || null;
    const rows = await select(`SELECT org.id, org.onboarding_established AS "onboardingEstablished",
      EXISTS (SELECT 1 FROM organization_venues ov JOIN locations loc ON loc.id=ov.location_id
        WHERE ov.organization_id=org.id AND loc.lifecycle_state='active') AS "venueAdded",
      EXISTS (SELECT 1 FROM events e WHERE e.organization_id=org.id AND ${access} AND ${manages}
        AND (e.status IN ('published','completed') OR EXISTS (SELECT 1 FROM audit_logs a
          WHERE a.entity_type='Event' AND a.entity_id=e.id AND a.organization_id=org.id
            AND (a.after->>'status'='published' OR a.before->>'status'='published')))) AS "firstEventPublished",
      CASE WHEN merchant.id IS NOT NULL THEN jsonb_build_object(
        'stripeAccountId',pa.stripe_account_id, 'accountApiVersion',pa.account_api_version,
        'mode',pa.mode, 'lifecycleState',pa.lifecycle_state, 'detailsSubmitted',pa.details_submitted,
        'chargesEnabled',pa.charges_enabled, 'cardPaymentsActive',pa.card_payments_active,
        'controllerMatches',pa.controller_matches, 'synchronizedAt',pa.synchronized_at,
        'paymentsDisabledAt',pa.payments_disabled_at, 'disconnectStatus',pa.disconnect_status
      ) ELSE NULL END AS "paymentAccount"
      FROM organizations org
      LEFT JOIN payment_accounts pa ON ${shared ? "pa.stripe_account_id=:shared AND pa.mode='test' AND pa.lifecycle_state='active'" : 'pa.id=org.default_payment_account_id AND pa.organization_id=org.id'}
      LEFT JOIN organizations merchant ON merchant.id=pa.organization_id AND merchant.lifecycle_state='active' AND merchant.status='active'
      WHERE org.id IN (:ids) AND org.lifecycle_state='active' AND org.status='active'
        AND (:canManageBusinesses OR EXISTS (SELECT 1 FROM organization_owners setup_owner
          WHERE setup_owner.organization_id=org.id AND setup_owner.user_id=:userId AND setup_owner.lifecycle_state='active'))`,
    { ...scope, ids: managed.map(org => org.id), shared });
    const byId = new Map(managed.map(org => [org.id, org]));
    const observedAt = now();
    return rows.map(row => {
      const org = byId.get(row.id), account = row.paymentAccount;
      let stripeStatus = 'not_connected';
      if (!stripe?.enabled || stripe.mode !== 'test') stripeStatus = 'unavailable';
      else if (account?.paymentsDisabledAt || account && (account.lifecycleState !== 'active' || account.disconnectStatus !== 'none')) stripeStatus = 'disabled';
      else if (paymentsReady(account, observedAt)) stripeStatus = 'ready';
      else if (account && paymentsReady({ ...account, synchronizedAt: observedAt }, observedAt)) stripeStatus = 'needs_refresh';
      else if (account) stripeStatus = 'needs_attention';
      // Account identifiers, requirements and financial data stay on the
      // finance-authorized routes. The checklist is guidance, never a gate.
      return { organizationId: org.id, accessAccepted: true, organizationConfigured: Boolean(org.name?.trim()),
        venueAdded: row.venueAdded, firstEventPublished: row.firstEventPublished,
        stripe: { status: stripeStatus, canManage: Boolean(org.canManageFinance && row.onboardingEstablished), sharedSandbox: Boolean(shared) } };
    });
  }
  async function filters(scope, input = {}, { dates = false, transaction } = {}) {
    const clauses = [];
    const values = { ...scope };
    // Recheck actual ownership for every aggregate and export. Finance grants,
    // manager roles and internal admin permissions never expand this scope.
    if (input.ownedOnly === 'true') clauses.push(`EXISTS (SELECT 1 FROM organization_owners owner_scope
      JOIN organizations owner_org ON owner_org.id=owner_scope.organization_id AND owner_org.lifecycle_state='active' AND owner_org.status='active'
      WHERE owner_scope.organization_id=e.organization_id AND owner_scope.user_id=:userId AND owner_scope.lifecycle_state='active' AND owner_scope.role='owner')`);
    const organizationIds = input.organizationIds?.length ? input.organizationIds : input.organizationId ? [input.organizationId] : [];
    if (organizationIds.length) {
      const real = organizationIds.filter((id) => id !== 'independent');
      clauses.push(`(e.organization_id ${real.length ? 'IN (:organizationIds)' : 'IS NULL AND FALSE'} ${organizationIds.includes('independent') ? 'OR e.organization_id IS NULL' : ''})`);
      if (real.length) values.organizationIds = real;
    }
    if (input.venueIds?.length) {
      // The surrounding event scope remains authoritative. Selected physical
      // venue keys are matched in SQL, without materializing every actor venue.
      clauses.push(`EXISTS (SELECT 1 FROM locations filter_location WHERE filter_location.id=e.location_id AND ${venueIdentitySql} IN (:selectedVenueIds))`);
      values.selectedVenueIds = input.venueIds;
    }
    if (dates) {
      if (input.from) { clauses.push('e.starts_at >= :from'); values.from = input.from; }
      if (input.to) { clauses.push('e.starts_at < :to'); values.to = input.to; }
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
  }
  async function events(userId, input) {
    const scope = await actor(userId);
    const filter = await filters(scope, input, { dates: true });
    const countFilter = await filters(scope, input);
    const values = { ...filter.values, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize, search: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, currentTime: now() };
    let conditions = filter.sql;
    if (input.search) conditions += ` AND (e.title ILIKE :search ESCAPE '\\' OR e.summary ILIKE :search ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM locations search_location WHERE search_location.id = e.location_id
        AND (search_location.name ILIKE :search ESCAPE '\\' OR search_location.city ILIKE :search ESCAPE '\\')))`;
    if (input.status === 'upcoming') conditions += ` AND e.ends_at > :currentTime AND e.status = 'published'`;
    else if (input.status === 'past') conditions += ` AND (e.status = 'completed' OR e.ends_at <= :currentTime)`;
    else if (input.status === 'draft') conditions += ` AND e.status = 'draft' AND e.ends_at > :currentTime`;
    else if (input.status !== 'all') { conditions += ' AND e.status = :status'; values.status = input.status; }
    const phase = `CASE WHEN e.status = 'completed' OR e.ends_at <= :currentTime THEN 'past' WHEN e.status = 'cancelled' THEN 'cancelled' WHEN e.status = 'draft' THEN 'draft' WHEN e.starts_at <= :currentTime THEN 'live' ELSE 'upcoming' END`;
    const sort = {
      starts_desc: 'e.starts_at DESC, e.id DESC', starts_asc: 'e.starts_at ASC, e.id ASC',
      title_asc: 'e.title ASC, e.id ASC', title_desc: 'e.title DESC, e.id DESC',
      phase_asc: `${phase} ASC, e.starts_at ASC, e.id ASC`, phase_desc: `${phase} DESC, e.starts_at DESC, e.id DESC`,
      sales_asc: 'COALESCE(sales."salesCents", 0) ASC, e.id ASC', sales_desc: 'COALESCE(sales."salesCents", 0) DESC, e.id DESC',
      orders_asc: 'COALESCE(sales."paidOrders", 0) ASC, e.id ASC', orders_desc: 'COALESCE(sales."paidOrders", 0) DESC, e.id DESC',
      access_asc: `${manages} ASC, e.id ASC`, access_desc: `${manages} DESC, e.id DESC`,
    }[input.sort] || 'e.starts_at ASC, e.id ASC';
    const salesSort = /^(sales|orders)_/.test(input.sort);
    const salesJoin = salesSort ? `LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(${netSubtotalSql()}),0)::bigint AS "salesCents", COUNT(*)::integer AS "paidOrders"
      FROM orders o WHERE o.event_id = e.id AND o.status = 'paid' AND o.currency = 'USD' AND ${orderAccess}
    ) sales ON true` : '';
    const [counts] = await select(`SELECT
      COUNT(*) FILTER (WHERE e.status = 'published' AND e.ends_at > :currentTime)::integer AS upcoming,
      COUNT(*) FILTER (WHERE e.status = 'completed' OR e.ends_at <= :currentTime)::integer AS past,
      COUNT(*) FILTER (WHERE e.status = 'draft' AND e.ends_at > :currentTime)::integer AS draft
      FROM events e WHERE ${base}${countFilter.sql}`, { ...countFilter.values, currentTime: values.currentTime });
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM events e WHERE ${base}${conditions}`, values);
    const ids = await select(`SELECT e.id,${manages} AS "canManage",
      EXISTS (SELECT 1 FROM organization_venues ov WHERE ov.organization_id=e.organization_id AND ov.location_id=e.location_id) AS "isManagedVenue"
      FROM events e ${salesJoin} WHERE ${base}${conditions} ORDER BY ${sort} LIMIT :pageSize OFFSET :offset`, values);
    if (!ids.length) return { ...pageResult([], count.total, input.page, input.pageSize), counts };
    const rows = await models.Event.findAll({ where: { id: ids.map((r) => r.id) }, include: [
      { model: models.Location, as: 'location' }, { model: models.Offering, as: 'offerings' } ] });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const sales = await select(`SELECT o.event_id AS id, COALESCE(SUM(${netSubtotalSql()}),0)::bigint AS "salesCents", COUNT(*)::integer AS "paidOrders"
      FROM orders o JOIN events e ON e.id = o.event_id WHERE o.event_id IN (:ids) AND o.status = 'paid' AND o.currency = 'USD' AND ${orderAccess}
      GROUP BY o.event_id`, { ...scope, ids: ids.map((r) => r.id) });
    const bySales = new Map(sales.map((r) => [r.id, r]));
    const reviewable = await select(`SELECT e.id FROM events e
      WHERE e.id IN (:ids) AND EXISTS (${ownGuestlistReviewAssignments})`,
    { ...scope, ids: ids.map((r) => r.id) });
    const reviewIds = new Set(reviewable.map((row) => row.id));
    const items = ids.map(({ id,canManage: scopedManage,isManagedVenue }) => {
      const event = byId.get(id);
      const editable = Boolean(scope.canManageEvents || (!event.organizationId && event.creatorUserId === userId) || scope.managedOrgIds.has(event.organizationId));
      const result = event.toJSON();
      const canManage = scopedManage ?? editable;
      result.offerings = result.offerings.sort((a, b) => a.sortOrder - b.sortOrder).map(({ accessCodeHash, ...tier }) => {
        if (!canManage) delete tier.quantitySold;
        return tier;
      });
      const sale = bySales.get(id);
      return { ...result, canManage,isManagedVenue: Boolean(isManagedVenue),canEdit: canManage && !eventFinished(event, now()),
        lifetimeSales: sale ? { salesCents: Number(sale.salesCents), paidOrders: sale.paidOrders } : { salesCents: 0, paidOrders: 0 },
        canReviewGuestlist: canManage || reviewIds.has(id) };
    });
    return { ...pageResult(items, count.total, input.page, input.pageSize), counts };
  }
  async function overview(userId, input) {
    const scope = await actor(userId);
    const filter = await filters(scope, input);
    const range = await resolvePaidRange(select, input, now());
    const values = { ...filter.values, since: range.since, until: range.until, timezone: range.timezone };
    const cte = `WITH scoped_events AS (SELECT e.id FROM events e WHERE ${base}${filter.sql}),
      visible_orders AS (
        SELECT o.id, o.event_id, o.buyer_user_id, ${netSubtotalSql()} AS subtotal_cents, ${netCommissionSql()} AS affiliate_commission_cents,
          o.event_affiliate_id, o.org_affiliate_id, o.paid_at,o.status
        FROM orders o JOIN events e ON e.id = o.event_id JOIN scoped_events se ON se.id = e.id
        WHERE ${financialOrderSql()} AND o.currency = 'USD' AND o.paid_at >= :since AND o.paid_at < :until AND ${orderAccess}),
      visible_guests AS (
        SELECT g.id, g.event_id, g.user_id, g.party_size, g.status, g.checked_in_spots
        FROM guestlist_entries g JOIN events e ON e.id = g.event_id JOIN scoped_events se ON se.id = e.id
        WHERE g.created_at >= :since AND g.created_at < :until AND ${guestAccess})`;
    const [financial] = await select(`${cte}
      SELECT COALESCE(SUM(subtotal_cents),0)::bigint AS "salesCents", COUNT(*) FILTER (WHERE status='paid')::integer AS orders,
      COALESCE(SUM(affiliate_commission_cents),0)::bigint AS "commissionCents",
      COALESCE(SUM(subtotal_cents) FILTER (WHERE event_affiliate_id IS NULL AND org_affiliate_id IS NULL),0)::bigint AS "directSalesCents",
      COUNT(DISTINCT buyer_user_id) FILTER (WHERE status='paid')::integer AS customers FROM visible_orders`, values);
    const [items] = await select(`${cte} SELECT COALESCE(SUM(oi.quantity),0)::bigint AS units
      FROM order_items oi JOIN visible_orders vo ON vo.id = oi.order_id WHERE vo.status='paid'`, values);
    const [tickets] = await select(`${cte} SELECT COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions,
      COUNT(*) FILTER (WHERE t.status = 'checked_in')::integer AS "checkedIn"
      FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id`, values);
    const [guests] = await select(`${cte} SELECT COALESCE(SUM(party_size) FILTER (WHERE status IN ('confirmed','checked_in')),0)::integer AS "guestlistPlaces",
      COALESCE(SUM(CASE WHEN status = 'checked_in' THEN party_size ELSE checked_in_spots END) FILTER (WHERE status IN ('confirmed','checked_in')),0)::integer AS "checkedIn" FROM visible_guests`, values);
    const days = await select(`${cte} SELECT to_char(paid_at AT TIME ZONE :timezone, 'YYYY-MM-DD') AS date,
      SUM(subtotal_cents)::bigint AS "salesCents" FROM visible_orders GROUP BY 1 ORDER BY 1`, values);
    const daily = new Map(days.map((row) => [row.date, cents(row.salesCents)]));
    const series = Array.from({ length: input.days }, (_, i) => {
      const day = new Date(`${range.startDate}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + i);
      const date = day.toISOString().slice(0, 10);
      return { date, salesCents: daily.get(date) || 0 };
    });
    const summary = { salesCents: cents(financial.salesCents), orders: financial.orders,
      commissionCents: cents(financial.commissionCents), directSalesCents: cents(financial.directSalesCents),
      customers: financial.customers, units: cents(items.units), admissions: tickets.admissions,
      checkedIn: tickets.checkedIn + guests.checkedIn, guestlistPlaces: guests.guestlistPlaces };
    return { summary, daily: series, range: { ...range, days: input.days }, scope: scope.isAdmin || scope.managedOrgIds.size ? 'mixed' : 'own' };
  }
  async function needsAttention(userId, input) {
    const scope = await actor(userId);
    const filter = await filters(scope, input);
    const currentTime = now();
    const guestlistAttentionCutoff = new Date(currentTime.getTime() - 60 * 60 * 1000);
    const values = { ...filter.values, currentTime, guestlistAttentionCutoff };
    const scoped = `WITH scoped_events AS (SELECT e.id, e.organization_id FROM events e WHERE ${base}${filter.sql})`;
    const pending = await select(`${scoped} SELECT g.id, g.event_id AS "eventId", e.title, g.party_size AS "partySize",
      g.created_at AS "createdAt", u.display_name AS "personName"
      FROM guestlist_entries g JOIN scoped_events se ON se.id = g.event_id JOIN events e ON e.id = g.event_id
      JOIN users u ON u.id = g.user_id WHERE g.status = 'pending' AND e.ends_at >= :guestlistAttentionCutoff AND ${guestAccess}
      ORDER BY g.created_at ASC, g.id ASC LIMIT 4`, values);
    const [pendingCount] = await select(`${scoped} SELECT COUNT(*)::integer AS count FROM guestlist_entries g
      JOIN scoped_events se ON se.id = g.event_id JOIN events e ON e.id = g.event_id
      WHERE g.status = 'pending' AND e.ends_at >= :guestlistAttentionCutoff AND ${guestAccess}`, values);
    const upcoming = await select(`SELECT e.id AS "eventId", e.title, e.starts_at AS "startsAt"
      FROM events e WHERE ${base}${filter.sql} AND e.status = 'published' AND e.starts_at >= :currentTime
      ORDER BY e.starts_at ASC, e.id ASC LIMIT 4`, values);
    const [upcomingCount] = await select(`SELECT COUNT(*)::integer AS count FROM events e WHERE ${base}${filter.sql}
      AND e.status = 'published' AND e.starts_at >= :currentTime`, values);
    const low = await select(`SELECT ofr.id, e.id AS "eventId", e.title, ofr.name, ofr.quantity_total - ofr.quantity_sold AS remaining
      FROM offerings ofr JOIN events e ON e.id = ofr.event_id WHERE ${base}${filter.sql} AND ${manages}
      AND e.status = 'published' AND e.ends_at >= :currentTime AND ofr.is_active = true AND ofr.inventory_mode = 'finite'
      AND ofr.quantity_total - ofr.quantity_sold <= GREATEST(5, CEIL(ofr.quantity_total * 0.1))
      ORDER BY remaining ASC, ofr.id ASC LIMIT 4`, values);
    const [lowCount] = await select(`SELECT COUNT(*)::integer AS count FROM offerings ofr JOIN events e ON e.id = ofr.event_id
      WHERE ${base}${filter.sql} AND ${manages} AND e.status = 'published' AND e.ends_at >= :currentTime
      AND ofr.is_active = true AND ofr.inventory_mode = 'finite'
      AND ofr.quantity_total - ofr.quantity_sold <= GREATEST(5, CEIL(ofr.quantity_total * 0.1))`, values);
    const invites = await select(`SELECT ti.id, ti.organization_id AS "organizationId", ti.event_id AS "eventId", ti.email,
      ti.role, ti.created_at AS "createdAt", COALESCE(e.title, org.name) AS title
      FROM team_invitations ti LEFT JOIN events e ON e.id = ti.event_id LEFT JOIN organizations org ON org.id = ti.organization_id
      WHERE ti.accepted_at IS NULL AND ti.expires_at > :currentTime
      AND (:isAdmin OR (ti.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id = ti.organization_id AND oo.user_id = :userId AND oo.lifecycle_state = 'active'))
      OR (ti.event_id IS NOT NULL AND e.organization_id IS NULL AND e.creator_user_id = :userId))
      ORDER BY ti.created_at DESC, ti.id DESC LIMIT 4`, values);
    const [inviteCount] = await select(`SELECT COUNT(*)::integer AS count FROM team_invitations ti LEFT JOIN events e ON e.id = ti.event_id
      WHERE ti.accepted_at IS NULL AND ti.expires_at > :currentTime
      AND (:isAdmin OR (ti.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id = ti.organization_id AND oo.user_id = :userId AND oo.lifecycle_state = 'active'))
      OR (ti.event_id IS NOT NULL AND e.organization_id IS NULL AND e.creator_user_id = :userId))`, values);
    return { counts: { pendingGuestlist: pendingCount.count, pendingInvitations: inviteCount.count,
      upcomingEvents: upcomingCount.count, lowInventory: lowCount.count },
      items: [
        ...pending.map((row) => ({ kind: 'pending_guestlist', ...row })),
        ...invites.map((row) => ({ kind: 'pending_invitation', ...row })),
        ...upcoming.map((row) => ({ kind: 'upcoming_event', ...row })),
        ...low.map((row) => ({ kind: 'low_inventory', ...row })),
      ] };
  }
  return { bootstrap, events, overview, needsAttention, actor, filters };
}

module.exports = { createBusinessReadService, organizationMember,access, manages, base, orderAccess, guestAccess, ownGuestlistReviewAssignments, pageResult };
