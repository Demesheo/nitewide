const { QueryTypes } = require('sequelize');
const { forbidden, notFound } = require('../domain/errors');
const { activeUser } = require('./lifecycle-service');
const { eventFinished, offeringSaleState } = require('../domain/event-policy');
const { base, organizationMember,manages,orderAccess, guestAccess, pageResult } = require('./business-read-service');
const { hasInternalPermission } = require('./internal-admin-permissions');
const { commissionTerms, effectiveCommissionBps } = require('../domain/commission-eligibility');
const { unsettledMerchantSql } = require('../domain/payment-merchant-policy');

function createBusinessEventReadService({ models, now = () => new Date() }) {
  const select = (sql, replacements) => models.Event.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  async function scope(userId, eventId) {
    const user = await models.User.findByPk(userId);
    if (!activeUser(user)) throw forbidden('An active account is required');
    const replacements = { userId, eventId, isAdmin: hasInternalPermission(user, 'events.manage'),canManageEvents: hasInternalPermission(user, 'events.manage') };
    const rows = await select(`SELECT e.id, e.organization_id AS "organizationId",e.location_id AS "locationId",e.creator_user_id AS "creatorUserId",
      EXISTS (SELECT 1 FROM organization_venues ov WHERE ov.organization_id=e.organization_id AND ov.location_id=e.location_id) AS "isManagedVenue",
      (:isAdmin OR ${organizationMember}) AS "organizationWideAccess",
      ${manages} AS "canManage",
      EXISTS (SELECT 1 FROM organization_owners finance WHERE finance.organization_id=e.organization_id AND finance.user_id=:userId AND finance.lifecycle_state='active' AND (finance.role='owner' OR finance.role='admin' AND finance.finance_authorized)) AS "canManageFinance",
      NOT EXISTS (SELECT 1 FROM orders merchant_order WHERE merchant_order.event_id=e.id AND ${unsettledMerchantSql('merchant_order')}) AS "canChangePaymentAccount"
      FROM events e WHERE e.id = :eventId AND ${base}`, replacements);
    if (!rows.length) throw notFound('Event');
    return { ...replacements, canManage: rows[0].canManage, canManageFinance: rows[0].canManageFinance, canChangePaymentAccount: rows[0].canChangePaymentAccount, organizationWideAccess: rows[0].organizationWideAccess,organizationId: rows[0].organizationId,locationId: rows[0].locationId,isManagedVenue: rows[0].isManagedVenue };
  }
  const scopedOrders = `SELECT o.* FROM orders o JOIN events e ON e.id = o.event_id
    WHERE o.event_id = :eventId AND o.status = 'paid' AND o.currency = 'USD' AND ${orderAccess}`;
  const scopedGuests = `SELECT g.* FROM guestlist_entries g JOIN events e ON e.id = g.event_id
    WHERE g.event_id = :eventId AND ${guestAccess}`;

  async function summary(userId, eventId) {
    const auth = await scope(userId, eventId);
    const event = await models.Event.findByPk(eventId, { include: [
      { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization' },
      { model: models.Offering, as: 'offerings' } ] });
    const offerings = [...event.offerings].sort((a, b) => a.sortOrder - b.sortOrder);
    const serialized = event.toJSON();
    if (serialized.organization && !auth.organizationWideAccess) serialized.organization.locationId = null;
    serialized.offerings = offerings.map((offering) => {
      const { accessCodeHash, ...tier } = offering.toJSON();
      if (!auth.canManage) delete tier.quantitySold;
      return { ...tier, saleState: offeringSaleState(offering, offerings, now()) };
    });
    const [sales] = await select(`WITH visible_orders AS (${scopedOrders}) SELECT
      COALESCE(SUM(subtotal_cents),0)::bigint AS "salesCents", COALESCE(SUM(affiliate_commission_cents),0)::bigint AS "commissionCents",
      COUNT(*)::integer AS orders, COUNT(DISTINCT buyer_user_id)::integer AS customers FROM visible_orders`, auth);
    const [tickets] = await select(`WITH visible_orders AS (${scopedOrders}) SELECT
      COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions,
      COUNT(*) FILTER (WHERE t.status = 'checked_in')::integer AS "checkedIn"
      FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id`, auth);
    const [guests] = await select(`WITH visible_guests AS (${scopedGuests}) SELECT
      COALESCE(SUM(party_size) FILTER (WHERE status IN ('confirmed','checked_in')),0)::integer AS "guestlistPlaces",
      COALESCE(SUM(CASE WHEN status = 'checked_in' THEN party_size ELSE checked_in_spots END) FILTER (WHERE status IN ('confirmed','checked_in')),0)::integer AS "checkedIn"
      FROM visible_guests`, auth);
    const sold = await select(`WITH visible_orders AS (${scopedOrders}),
      item_sales AS (SELECT oi.offering_id AS id, SUM(oi.quantity)::integer AS units,
        SUM(oi.line_total_cents)::bigint AS "salesCents" FROM order_items oi
        JOIN visible_orders vo ON vo.id = oi.order_id GROUP BY oi.offering_id),
      admissions AS (SELECT oi.offering_id AS id, COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions
        FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id
        GROUP BY oi.offering_id)
      SELECT s.*, COALESCE(a.admissions,0)::integer AS admissions FROM item_sales s LEFT JOIN admissions a ON a.id = s.id`, auth);
    const byOffering = new Map(sold.map((row) => [row.id, row]));
    const tiers = offerings.map((offering) => ({ id: offering.id, name: offering.name, kind: offering.kind,
      units: Number(byOffering.get(offering.id)?.units || 0), salesCents: Number(byOffering.get(offering.id)?.salesCents || 0),
      admissions: Number(byOffering.get(offering.id)?.admissions || 0) }));
    const channels = await select(`WITH visible_orders AS (${scopedOrders}) SELECT
      CASE WHEN event_affiliate_id IS NULL AND org_affiliate_id IS NULL THEN 'Direct' ELSE 'Referral' END AS name,
      SUM(subtotal_cents)::bigint AS "salesCents", COUNT(*)::integer AS orders FROM visible_orders GROUP BY 1 ORDER BY 1`, auth);
    const teamSales = await select(`WITH visible_orders AS (${scopedOrders}), sales AS (
      SELECT COALESCE(ea.user_id, oa.user_id)::text AS id, COALESCE(u.display_name, 'Direct sales') AS name,
        SUM(vo.subtotal_cents)::bigint AS "salesCents"
      FROM visible_orders vo LEFT JOIN event_affiliates ea ON ea.id = vo.event_affiliate_id
      LEFT JOIN org_affiliates oa ON oa.id = vo.org_affiliate_id
      LEFT JOIN users u ON u.id = COALESCE(ea.user_id, oa.user_id) GROUP BY 1, 2),
      ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY "salesCents" DESC, name, id) AS rank FROM sales WHERE id IS NOT NULL)
      SELECT id, name, "salesCents" FROM ranked WHERE rank <= 6
      UNION ALL SELECT 'direct', name, "salesCents" FROM sales WHERE id IS NULL
      UNION ALL SELECT 'other','Other referrals',SUM("salesCents")::bigint FROM ranked WHERE rank > 6 HAVING COUNT(*) > 0`, auth);
    return { event: { ...serialized, canManage: auth.canManage,canManageFinance: Boolean(auth.canManageFinance),canChangePaymentAccount: Boolean(auth.canChangePaymentAccount && auth.canManageFinance),isManagedVenue: Boolean(auth.isManagedVenue),canEdit: auth.canManage && !eventFinished(event, now()) },
      scope: auth.canManage ? 'event' : 'own',
      summary: { salesCents: Number(sales.salesCents), commissionCents: Number(sales.commissionCents),
        orders: sales.orders, customers: sales.customers, admissions: tickets.admissions,
        checkedIn: tickets.checkedIn + guests.checkedIn, guestlistPlaces: guests.guestlistPlaces },
      tiers, teamSales: teamSales.map((row) => ({ ...row, salesCents: Number(row.salesCents) })), channels: channels.map((row) => ({ ...row, salesCents: Number(row.salesCents) })) };
  }

  async function purchases(userId, eventId, { page, pageSize, search = '' }) {
    const auth = await scope(userId, eventId);
    const values = { ...auth, pageSize, offset: (page - 1) * pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%` };
    const predicate = search ? `AND (u.display_name ILIKE :search ESCAPE '\\' OR u.email ILIKE :search ESCAPE '\\')` : '';
    const [count] = await select(`WITH visible_orders AS (${scopedOrders}) SELECT COUNT(*)::integer AS total
      FROM visible_orders vo JOIN users u ON u.id = vo.buyer_user_id WHERE true ${predicate}`, values);
    const rows = await select(`WITH visible_orders AS (${scopedOrders}) SELECT vo.id, vo.buyer_user_id AS "buyerUserId",
      u.display_name AS customer, u.email, vo.subtotal_cents AS "salesCents", vo.paid_at AS "paidAt",
      COALESCE((SELECT string_agg(oi.quantity::text || ' × ' || oi.name_snapshot, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = vo.id),'') AS items,
      COALESCE(ref_user.display_name, 'Direct') AS "referredBy",
      (vo.pricing_plan_snapshot->>'demo')::boolean IS TRUE AS demo
      FROM visible_orders vo JOIN users u ON u.id = vo.buyer_user_id
      LEFT JOIN event_affiliates ea ON ea.id = vo.event_affiliate_id LEFT JOIN users ref_user ON ref_user.id = ea.user_id
      WHERE true ${predicate} ORDER BY vo.paid_at DESC NULLS LAST, vo.id DESC LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows.map((r) => ({ ...r, salesCents: Number(r.salesCents) })), count.total, page, pageSize);
  }

  async function attendees(userId, eventId, { page, pageSize, search = '', sortKey = 'salesCents', descending = 'true' }) {
    const auth = await scope(userId, eventId);
    const values = { ...auth, pageSize, offset: (page - 1) * pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%` };
    const cte = `WITH visible_orders AS (${scopedOrders}), visible_guests AS (${scopedGuests}),
      attendee_ids AS (SELECT buyer_user_id AS id FROM visible_orders
        UNION SELECT t.holder_user_id FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id WHERE t.status IN ('valid','checked_in')
        UNION SELECT user_id FROM visible_guests),
      attendees AS (SELECT u.id, u.display_name AS name, u.email FROM attendee_ids ids JOIN users u ON u.id = ids.id)`;
    const predicate = search ? `WHERE a.name ILIKE :search ESCAPE '\\' OR a.email ILIKE :search ESCAPE '\\'` : '';
    const [count] = await select(`${cte} SELECT COUNT(*)::integer AS total FROM attendees a ${predicate}`, values);
    const rows = await select(`${cte} SELECT a.id, a.name, a.email,
      COALESCE((SELECT SUM(vo.subtotal_cents) FROM visible_orders vo WHERE vo.buyer_user_id = a.id),0)::bigint AS "salesCents",
      (SELECT COUNT(*)::integer FROM visible_orders vo WHERE vo.buyer_user_id = a.id) AS orders,
      (SELECT COUNT(*)::integer FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id WHERE t.holder_user_id = a.id AND t.status IN ('valid','checked_in')) AS admissions,
      (SELECT COUNT(*)::integer FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id WHERE t.holder_user_id = a.id AND t.status = 'checked_in') +
        COALESCE((SELECT SUM(CASE WHEN g.status = 'checked_in' THEN g.party_size ELSE g.checked_in_spots END) FROM visible_guests g WHERE g.user_id = a.id AND g.status IN ('confirmed','checked_in')),0)::integer AS "checkedIn",
      COALESCE((SELECT SUM(g.party_size) FROM visible_guests g WHERE g.user_id = a.id AND g.status IN ('confirmed','checked_in')),0)::integer AS "guestlistPlaces"
      FROM attendees a ${predicate} ORDER BY ${({name: 'a.name', orders: 'orders', salesCents: '"salesCents"', admissions: 'admissions', guestlistPlaces: '"guestlistPlaces"', checkedIn: '"checkedIn"'})[sortKey] || '"salesCents"'} ${descending === 'false' ? 'ASC' : 'DESC'}, a.name ASC, a.id ASC LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows.map((r) => ({ ...r, salesCents: Number(r.salesCents) })), count.total, page, pageSize);
  }

  async function attendee(userId, eventId, attendeeId, { page, pageSize, sortKey = 'salesCents', descending = 'true' }) {
    const auth = await scope(userId, eventId);
    const values = { ...auth, attendeeId, pageSize, offset: (page - 1) * pageSize };
    const [visible] = await select(`WITH visible_orders AS (${scopedOrders}), visible_guests AS (${scopedGuests})
      SELECT 1 AS found WHERE EXISTS (SELECT 1 FROM visible_orders vo WHERE vo.buyer_user_id = :attendeeId)
      OR EXISTS (SELECT 1 FROM visible_guests g WHERE g.user_id = :attendeeId)
      OR EXISTS (SELECT 1 FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id
        WHERE t.holder_user_id = :attendeeId AND t.status IN ('valid','checked_in'))`, values);
    if (!visible) throw notFound('Attendee');
    const user = await models.User.findByPk(attendeeId, { attributes: ['id', 'displayName', 'email'] });
    if (!user) throw notFound('Attendee');
    const [count] = await select(`WITH visible_orders AS (${scopedOrders}) SELECT COUNT(*)::integer AS total
      FROM order_items oi JOIN visible_orders vo ON vo.id = oi.order_id WHERE vo.buyer_user_id = :attendeeId`, values);
    const purchases = await select(`WITH visible_orders AS (${scopedOrders}) SELECT oi.id, oi.name_snapshot AS name,
      oi.quantity, oi.line_total_cents AS "salesCents", vo.paid_at AS "paidAt", COALESCE(ref.display_name, 'Direct') AS "referredBy"
      FROM order_items oi JOIN visible_orders vo ON vo.id = oi.order_id
      LEFT JOIN event_affiliates ea ON ea.id = vo.event_affiliate_id LEFT JOIN org_affiliates oa ON oa.id = vo.org_affiliate_id
      LEFT JOIN users ref ON ref.id = COALESCE(ea.user_id, oa.user_id) WHERE vo.buyer_user_id = :attendeeId
      ORDER BY ${({name: 'oi.name_snapshot', quantity: 'oi.quantity', salesCents: 'oi.line_total_cents', referredBy: "COALESCE(ref.display_name,'Direct')"})[sortKey] || 'oi.line_total_cents'} ${descending === 'false' ? 'ASC' : 'DESC'}, oi.id ASC LIMIT :pageSize OFFSET :offset`, values);
    const guestlist = await select(`WITH visible_guests AS (${scopedGuests}) SELECT status, party_size AS "partySize" FROM visible_guests WHERE user_id = :attendeeId`, values);
    return { id: user.id, name: user.displayName, email: user.email,
      guestlistStatuses: guestlist.map((row) => row.status),
      purchases: pageResult(purchases.map((row) => ({ ...row, salesCents: Number(row.salesCents) })), count.total, page, pageSize) };
  }

  async function guestlist(userId, eventId, { page, pageSize, search = '', status = 'all', statuses = [], sortKey = 'requestedValue', descending = 'true' }) {
    const auth = await scope(userId, eventId);
    const values = { ...auth, pageSize, offset: (page - 1) * pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%`, status, statuses };
    const predicate = `${statuses.length ? 'AND g.status IN (:statuses)' : status === 'all' ? '' : 'AND g.status = :status'} ${search ? `AND (COALESCE(g.guest_name,u.display_name) ILIKE :search ESCAPE '\\' OR COALESCE(g.guest_email,u.email) ILIKE :search ESCAPE '\\'
      OR COALESCE(g.guest_phone,u.phone) ILIKE :search ESCAPE '\\' OR COALESCE(ref_user.display_name,'Direct') ILIKE :search ESCAPE '\\'
      OR (CASE g.status WHEN 'confirmed' THEN 'Approved' WHEN 'rejected' THEN 'Declined' ELSE g.status::text END) ILIKE :search ESCAPE '\\')` : ''}`;
    const [count] = await select(`WITH visible_guests AS (${scopedGuests}) SELECT COUNT(*)::integer AS total
      FROM visible_guests g LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN event_affiliates ea ON ea.id = g.event_affiliate_id LEFT JOIN users ref_user ON ref_user.id = ea.user_id
      WHERE true ${predicate}`, values);
    const rows = await select(`WITH visible_guests AS (${scopedGuests}) SELECT g.id, g.event_id AS "eventId", g.user_id AS "userId",
      g.event_affiliate_id AS "eventAffiliateId", g.source, g.party_size AS "partySize", g.status,
      g.created_at AS "createdAt", g.reviewed_at AS "reviewedAt", g.review_note AS "reviewNote", g.checked_in_at AS "checkedInAt",
      COALESCE(g.guest_name,u.display_name,'Guest') AS "guestName", COALESCE(g.guest_email,u.email) AS "guestEmail", COALESCE(g.guest_phone,u.phone) AS "guestPhone", reviewer.display_name AS "reviewerName", ref_user.display_name AS "referrerName",
      g.checked_in_spots AS "checkedInSpots", EXISTS (SELECT 1 FROM guestlist_invitations i WHERE i.guestlist_entry_id=g.id AND i.status='accepted') AS "hasInvitation"
      FROM visible_guests g LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN users reviewer ON reviewer.id = g.reviewed_by_user_id
      LEFT JOIN event_affiliates ea ON ea.id = g.event_affiliate_id LEFT JOIN users ref_user ON ref_user.id = ea.user_id
      WHERE true ${predicate} ORDER BY ${({guestName: "COALESCE(g.guest_name,u.display_name,'Guest')", partyValue: 'g.party_size', sourceValue: "COALESCE(ref_user.display_name,'Direct')", requestedValue: 'g.created_at', status: 'g.status'})[sortKey] || 'g.created_at'} ${descending === 'false' ? 'ASC' : 'DESC'}, g.id DESC LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows, count.total, page, pageSize);
  }

  async function guestlistEntry(userId, eventId, entryId) {
    const auth = await scope(userId, eventId);
    const [row] = await select(`WITH visible_guests AS (${scopedGuests}) SELECT g.id, g.event_id AS "eventId", g.user_id AS "userId",
      g.event_affiliate_id AS "eventAffiliateId", g.source, g.party_size AS "partySize", g.status,
      g.created_at AS "createdAt", g.reviewed_at AS "reviewedAt", g.review_note AS "reviewNote", g.checked_in_at AS "checkedInAt",
      COALESCE(g.guest_name,u.display_name,'Guest') AS "guestName", COALESCE(g.guest_email,u.email) AS "guestEmail", COALESCE(g.guest_phone,u.phone) AS "guestPhone", reviewer.display_name AS "reviewerName", ref_user.display_name AS "referrerName",
      g.checked_in_spots AS "checkedInSpots", EXISTS (SELECT 1 FROM guestlist_invitations i WHERE i.guestlist_entry_id=g.id AND i.status='accepted') AS "hasInvitation"
      FROM visible_guests g LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN users reviewer ON reviewer.id = g.reviewed_by_user_id
      LEFT JOIN event_affiliates ea ON ea.id = g.event_affiliate_id LEFT JOIN users ref_user ON ref_user.id = ea.user_id
      WHERE g.id = :entryId`, { ...auth, entryId });
    if (!row) throw notFound('Guestlist request');
    return row;
  }

  async function people(userId, eventId, { page, pageSize, search = '', roles = [], sortKey = 'salesCents', descending = 'true' }) {
    const auth = await scope(userId, eventId);
    const values = { ...auth, pageSize, offset: (page - 1) * pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%` };
    const cte = `WITH visible_orders AS (${scopedOrders}), visible_guests AS (${scopedGuests}),
      member_ids AS (SELECT user_id AS id FROM event_affiliates WHERE event_id = :eventId
        UNION SELECT user_id FROM organization_owners WHERE organization_id = :organizationId AND lifecycle_state = 'active'
        UNION SELECT user_id FROM organization_employees WHERE organization_id = :organizationId AND status = 'active'
        UNION SELECT user_id FROM org_affiliates WHERE organization_id = :organizationId AND status = 'active'
        UNION SELECT va.user_id FROM venue_access va JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
          WHERE va.organization_id=:organizationId AND va.location_id=:locationId AND va.status='active'
        UNION SELECT :userId WHERE :organizationId IS NULL AND :canManage),
      members AS (SELECT u.id, u.display_name AS name, u.email, ea.id AS "assignmentId", ea.code,
        ea.status, COALESCE(ea.commission_bps, rate_oa.default_commission_bps, 0) AS "configuredCommissionBps", oa.id AS "orgAffiliateId",
        (oo.id IS NOT NULL OR oe.id IS NOT NULL OR oa.id IS NOT NULL OR va.id IS NOT NULL OR
          (u.id = :userId AND :organizationId IS NULL AND :canManage)) AS "isCurrentMember",
        CASE WHEN oo.role = 'owner' THEN 'Owner' WHEN oo.id IS NOT NULL OR va.role='manager' THEN 'Manager'
          WHEN oe.id IS NOT NULL OR va.role='employee' THEN 'Employee' WHEN u.id = :userId AND :organizationId IS NULL AND :canManage THEN 'Creator'
          ELSE 'Promoter' END AS role
        FROM member_ids mi JOIN users u ON u.id = mi.id
        LEFT JOIN event_affiliates ea ON ea.event_id = :eventId AND ea.user_id = u.id
        LEFT JOIN organization_owners oo ON oo.organization_id = :organizationId AND oo.user_id = u.id AND oo.lifecycle_state = 'active'
        LEFT JOIN organization_employees oe ON oe.organization_id = :organizationId AND oe.user_id = u.id AND oe.status = 'active'
        LEFT JOIN org_affiliates oa ON oa.organization_id = :organizationId AND oa.user_id = u.id AND oa.status = 'active'
        LEFT JOIN org_affiliates rate_oa ON rate_oa.id = ea.org_affiliate_id
        LEFT JOIN venue_access va ON va.organization_id=:organizationId AND va.location_id=:locationId AND va.user_id=u.id AND va.status='active'
          AND EXISTS (SELECT 1 FROM organization_venues ov WHERE ov.organization_id=va.organization_id AND ov.location_id=va.location_id)
        WHERE (:canManage OR u.id = :userId))`;
    values.roles = roles;
    const predicate = `WHERE true ${search ? `AND (m.name ILIKE :search ESCAPE '\\' OR m.email ILIKE :search ESCAPE '\\')` : ''} ${roles.length ? 'AND m.role IN (:roles)' : ''}`;
    const [count] = await select(`${cte} SELECT COUNT(*)::integer AS total FROM members m ${predicate}`, values);
    const rows = await select(`${cte} SELECT m.id AS "userId", m."assignmentId" AS id, m.name, m.email, m.role,
      CASE WHEN m.status IS NOT NULL THEN m.status ELSE 'default' END AS status,
      m.code, m."configuredCommissionBps", ${effectiveCommissionBps(0)}::integer AS "commissionBps", m."orgAffiliateId", m."isCurrentMember",
      COALESCE((SELECT SUM(vo.subtotal_cents) FROM visible_orders vo WHERE vo.event_affiliate_id = m."assignmentId"
        OR (vo.event_affiliate_id IS NULL AND vo.org_affiliate_id = m."orgAffiliateId")),0)::bigint AS "salesCents",
      (SELECT COUNT(*)::integer FROM visible_orders vo WHERE vo.event_affiliate_id = m."assignmentId"
        OR (vo.event_affiliate_id IS NULL AND vo.org_affiliate_id = m."orgAffiliateId")) AS orders,
      (SELECT COUNT(DISTINCT vo.buyer_user_id)::integer FROM visible_orders vo WHERE vo.event_affiliate_id = m."assignmentId"
        OR (vo.event_affiliate_id IS NULL AND vo.org_affiliate_id = m."orgAffiliateId")) AS customers,
      COALESCE((SELECT SUM(vo.affiliate_commission_cents) FROM visible_orders vo WHERE vo.event_affiliate_id = m."assignmentId"
        OR (vo.event_affiliate_id IS NULL AND vo.org_affiliate_id = m."orgAffiliateId")),0)::bigint AS "commissionCents",
      (SELECT COUNT(*)::integer FROM visible_guests g WHERE g.event_affiliate_id = m."assignmentId") AS "guestlistRequests",
      COALESCE((SELECT SUM(g.party_size) FROM visible_guests g WHERE g.event_affiliate_id = m."assignmentId"),0)::integer AS "guestlistPlaces",
      COALESCE((SELECT SUM(g.party_size) FROM visible_guests g WHERE g.event_affiliate_id = m."assignmentId" AND g.status IN ('confirmed','checked_in')),0)::integer AS "approvedGuestlistPlaces"
      FROM members m ${predicate} ORDER BY ${({name: 'm.name', role: 'm.role', commissionBps: '"commissionBps"', salesCents: '"salesCents"', orders: 'orders', customers: 'customers', guestlistPlaces: '"guestlistPlaces"', approvedGuestlistPlaces: '"approvedGuestlistPlaces"', commissionCents: '"commissionCents"'})[sortKey] || '"salesCents"'} ${descending === 'false' ? 'ASC' : 'DESC'}, m.name ASC, m.id ASC LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows.map((r) => {
      const terms = commissionTerms(Number(r.configuredCommissionBps || 0));
      return { ...r, ...terms, commissionBps: terms.effectiveCommissionBps, id: r.id || r.userId,
        salesCents: Number(r.salesCents), commissionCents: Number(r.commissionCents) };
    }), count.total, page, pageSize);
  }

  async function guestlistSettings(userId, eventId, { page, pageSize, search = '' }) {
    const auth = await scope(userId, eventId);
    if (!auth.canManage) throw forbidden('Event manager access required');
    const event = await models.Event.findByPk(eventId, { attributes: ['id', 'guestlistCapacity'] });
    const values = { ...auth, pageSize, offset: (page - 1) * pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%` };
    const [direct] = await select(`SELECT COALESCE(SUM(party_size),0)::integer AS used FROM guestlist_entries
      WHERE event_id = :eventId AND event_affiliate_id IS NULL AND status IN ('confirmed','checked_in')`, values);
    const predicate = search ? `AND (u.display_name ILIKE :search ESCAPE '\\' OR u.email ILIKE :search ESCAPE '\\')` : '';
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM event_affiliates ea JOIN users u ON u.id = ea.user_id
      WHERE ea.event_id = :eventId ${predicate}`, values);
    const rows = await select(`SELECT ea.id, ea.code, ea.status, ea.guestlist_allocation AS "guestlistAllocation",
      COALESCE(ea.guestlist_allocation, oa.default_guestlist_allocation, 0)::integer AS "effectiveGuestlistAllocation",
      u.id AS "userId", u.display_name AS name, u.email,
      COALESCE((SELECT SUM(g.party_size) FROM guestlist_entries g WHERE g.event_affiliate_id = ea.id
        AND g.status IN ('confirmed','checked_in')),0)::integer AS used
      FROM event_affiliates ea JOIN users u ON u.id = ea.user_id
      LEFT JOIN org_affiliates oa ON oa.id = ea.org_affiliate_id
      WHERE ea.event_id = :eventId ${predicate}
      ORDER BY u.display_name ASC, ea.id ASC LIMIT :pageSize OFFSET :offset`, values);
    return { direct: { capacity: event.guestlistCapacity, used: direct.used },
      promoters: pageResult(rows, count.total, page, pageSize) };
  }

  return { summary, purchases, attendees, attendee, guestlist, guestlistEntry, people, guestlistSettings, scope };
}
module.exports = { createBusinessEventReadService };
