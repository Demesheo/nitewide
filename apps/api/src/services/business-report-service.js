const { QueryTypes } = require('sequelize');
const { base, orderAccess, guestAccess, pageResult } = require('./business-read-service');
const { venueKey } = require('./venue-scope');
const { calendarPeriod: period, resolvePaidRange } = require('./business-report-period');

const number = (value) => Number(value || 0);
const regionExpression = `CASE WHEN NULLIF(TRIM(loc.city), '') IS NULL THEN 'Unspecified region'
  ELSE CONCAT_WS(', ', NULLIF(TRIM(loc.city), ''), NULLIF(TRIM(loc.region), ''), NULLIF(TRIM(loc.country_code), '')) END`;
const cleanSql = (column) => `REGEXP_REPLACE(LOWER(COALESCE(${column},'')), '[^a-z0-9]', '', 'g')`;
const venueGroupExpression = `CONCAT_WS('|', COALESCE(e.organization_id::text, 'creator:' || e.creator_user_id::text),
  ${cleanSql('loc.name')}, ${cleanSql('loc.address_line1')}, ${cleanSql('loc.city')},
  ${cleanSql('loc.region')}, ${cleanSql('loc.country_code')})`;

function topWithOther(rows, limit = 12) {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  const other = rows.slice(limit).reduce((result, row) => ({ ...result,
    salesCents: result.salesCents + number(row.salesCents),
    orders: result.orders + number(row.orders), units: result.units + number(row.units) }),
  { id: 'other', label: 'Other', salesCents: 0, orders: 0, units: 0 });
  return [...top, other];
}

function csvRow(values) {
  return values.map((value) => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',') + '\r\n';
}

function createBusinessReportService({ models, businessRead, now = () => new Date() }) {
  const select = (sql, replacements) => models.Event.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

  async function source(userId, input) {
    const actor = await businessRead.actor(userId);
    const filter = await businessRead.filters(actor, input);
    const range = await resolvePaidRange(select, input, now());
    const conditions = [filter.sql];
    const values = { ...filter.values, since: range.since, until: range.until, timezone: range.timezone,
      search: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, regions: input.regions,
      hasPerson: Boolean(input.personId), personId: input.personId || null,
      hasOffering: Boolean(input.offeringKind && input.offeringName), offeringKind: input.offeringKind || '',
      offeringName: input.offeringName || '' };
    if (input.eventId) { conditions.push('AND e.id = :reportEventId'); values.reportEventId = input.eventId; }
    if (input.regions.length) conditions.push(`AND ${regionExpression} IN (:regions)`);
    if (input.search) conditions.push(`AND (e.title ILIKE :search ESCAPE '\\' OR e.summary ILIKE :search ESCAPE '\\'
      OR loc.name ILIKE :search ESCAPE '\\' OR org.name ILIKE :search ESCAPE '\\'
      OR ${regionExpression} ILIKE :search ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM orders o JOIN users buyer ON buyer.id = o.buyer_user_id
        LEFT JOIN event_affiliates ea ON ea.id = o.event_affiliate_id
        LEFT JOIN org_affiliates oa ON oa.id = o.org_affiliate_id
        LEFT JOIN users promoter ON promoter.id = COALESCE(ea.user_id, oa.user_id)
        WHERE o.event_id = e.id AND o.status = 'paid' AND o.currency = 'USD'
          AND o.paid_at >= :since AND o.paid_at < :until AND ${orderAccess}
          AND (buyer.display_name ILIKE :search ESCAPE '\\' OR buyer.email ILIKE :search ESCAPE '\\'
            OR promoter.display_name ILIKE :search ESCAPE '\\'))) `);
    const cte = `WITH scoped_events AS (
      SELECT e.id, e.title, e.status, e.starts_at, e.organization_id, e.creator_user_id, e.location_id,
        ${regionExpression} AS region, ${venueGroupExpression} AS venue_group,
        loc.name AS venue_name, loc.timezone AS venue_timezone, loc.address_line1 AS venue_address, loc.city AS venue_city,
        loc.region AS venue_region, loc.country_code AS venue_country
      FROM events e LEFT JOIN locations loc ON loc.id = e.location_id
      LEFT JOIN organizations org ON org.id = e.organization_id
      WHERE ${base} ${conditions.join(' ')}),
      eligible_orders AS (
        SELECT o.* FROM orders o JOIN scoped_events se ON se.id = o.event_id JOIN events e ON e.id = o.event_id
        LEFT JOIN event_affiliates ea ON ea.id = o.event_affiliate_id
        LEFT JOIN org_affiliates oa ON oa.id = o.org_affiliate_id
        WHERE o.status = 'paid' AND o.currency = 'USD' AND o.paid_at >= :since AND o.paid_at < :until AND ${orderAccess}
          AND (NOT :hasPerson OR COALESCE(ea.user_id, oa.user_id) = :personId)),
      visible_items AS (
        SELECT oi.* FROM order_items oi JOIN eligible_orders eo ON eo.id = oi.order_id
        WHERE NOT :hasOffering OR (oi.kind_snapshot = :offeringKind AND oi.name_snapshot = :offeringName)),
      visible_orders AS (
        SELECT eo.*, CASE WHEN :hasOffering THEN COALESCE(item_totals.sales_cents,0) ELSE eo.subtotal_cents END AS report_sales_cents,
          CASE WHEN :hasOffering THEN NULL ELSE eo.affiliate_commission_cents END AS report_commission_cents
        FROM eligible_orders eo LEFT JOIN (SELECT order_id, SUM(line_total_cents)::bigint AS sales_cents
          FROM visible_items GROUP BY order_id) item_totals ON item_totals.order_id = eo.id
        WHERE NOT :hasOffering OR item_totals.order_id IS NOT NULL),
      visible_guests AS (
        SELECT g.* FROM guestlist_entries g JOIN scoped_events se ON se.id = g.event_id JOIN events e ON e.id = g.event_id
        LEFT JOIN event_affiliates ea ON ea.id = g.event_affiliate_id
        WHERE g.created_at >= :since AND g.created_at < :until AND ${guestAccess}
          AND NOT :hasOffering AND (NOT :hasPerson OR ea.user_id = :personId)),
      report_events AS (
        SELECT se.* FROM scoped_events se WHERE (NOT :hasPerson AND NOT :hasOffering)
          OR EXISTS (SELECT 1 FROM visible_orders vo WHERE vo.event_id = se.id)
          OR (:hasPerson AND EXISTS (SELECT 1 FROM visible_guests vg WHERE vg.event_id = se.id)))`;
    return { cte, values, range };
  }

  async function summary(userId, input) {
    const { cte, values, range } = await source(userId, input);
    const [event] = input.eventId ? await select(`${cte} SELECT id, title AS label, starts_at AS "startsAt",
      venue_timezone AS "venueTimezone" FROM scoped_events`, values) : [];
    const [financial] = await select(`${cte} SELECT COALESCE(SUM(report_sales_cents),0)::bigint AS "salesCents",
      COALESCE(SUM(report_commission_cents),0)::bigint AS "commissionCents",
      COALESCE(SUM(report_sales_cents) FILTER (WHERE event_affiliate_id IS NULL AND org_affiliate_id IS NULL),0)::bigint AS "directSalesCents",
      COUNT(*)::integer AS orders, COUNT(DISTINCT buyer_user_id)::integer AS customers FROM visible_orders`, values);
    const [units] = await select(`${cte} SELECT COALESCE(SUM(oi.quantity),0)::bigint AS units
      FROM visible_items oi JOIN visible_orders vo ON vo.id = oi.order_id`, values);
    const [tickets] = await select(`${cte} SELECT COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions,
      COUNT(*) FILTER (WHERE t.status = 'checked_in')::integer AS "checkedIn"
      FROM tickets t JOIN visible_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id`, values);
    const [guests] = await select(`${cte} SELECT COALESCE(SUM(party_size) FILTER (WHERE status IN ('confirmed','checked_in')),0)::integer AS "guestlistPlaces",
      COALESCE(SUM(party_size) FILTER (WHERE status = 'checked_in'),0)::integer AS "checkedIn" FROM visible_guests`, values);
    const [eventCount] = await select(`${cte} SELECT COUNT(*)::integer AS events FROM report_events`, values);
    const [activeEventCount] = await select(`${cte} SELECT COUNT(*)::integer AS events FROM report_events se
      JOIN events e ON e.id = se.id WHERE e.status = 'published' AND e.ends_at >= :currentTime`, { ...values, currentTime: now() });
    const daily = await select(`${cte} SELECT to_char(paid_at AT TIME ZONE :timezone,'YYYY-MM-DD') AS date,
      SUM(report_sales_cents)::bigint AS "salesCents", COUNT(*)::integer AS orders
      FROM visible_orders GROUP BY 1 ORDER BY 1`, values);
    const channels = await select(`${cte} SELECT CASE WHEN event_affiliate_id IS NULL AND org_affiliate_id IS NULL THEN 'Direct' ELSE 'Referral' END AS label,
      SUM(report_sales_cents)::bigint AS "salesCents", COUNT(*)::integer AS orders
      FROM visible_orders GROUP BY 1 ORDER BY "salesCents" DESC, label ASC`, values);
    const regionalMix = await select(`${cte}, region_sales AS (
      SELECT se.region AS id, se.region AS label, SUM(vo.report_sales_cents)::bigint AS "salesCents"
      FROM visible_orders vo JOIN report_events se ON se.id = vo.event_id GROUP BY se.region),
      ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY "salesCents" DESC, id) AS rank FROM region_sales)
      SELECT id, label, "salesCents" FROM ranked WHERE rank <= 6
      UNION ALL SELECT 'other', 'Other regions', SUM("salesCents")::bigint FROM ranked WHERE rank > 6 HAVING COUNT(*) > 0`, values);
    const category = await select(`${cte}, category_totals AS (
      SELECT COALESCE(NULLIF(e.category,''),'Other') AS label,
        SUM(vo.report_sales_cents)::bigint AS "salesCents", COUNT(*)::integer AS orders
      FROM visible_orders vo JOIN events e ON e.id = vo.event_id GROUP BY 1),
      ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY "salesCents" DESC, label ASC) AS rank FROM category_totals)
      SELECT label, "salesCents", orders FROM ranked WHERE rank <= 12
      UNION ALL SELECT 'Other categories', SUM("salesCents")::bigint, SUM(orders)::integer
      FROM ranked WHERE rank > 12 HAVING COUNT(*) > 0 ORDER BY "salesCents" DESC, label ASC`, values);
    const offerings = await select(`${cte}, offering_totals AS (
      SELECT oi.kind_snapshot AS kind, oi.name_snapshot AS label,
        SUM(oi.line_total_cents)::bigint AS "salesCents", SUM(oi.quantity)::bigint AS units, COUNT(DISTINCT vo.id)::integer AS orders
      FROM visible_items oi JOIN visible_orders vo ON vo.id = oi.order_id GROUP BY oi.kind_snapshot, oi.name_snapshot),
      ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY "salesCents" DESC, label ASC, kind ASC) AS rank FROM offering_totals)
      SELECT kind, label, "salesCents", units, orders FROM ranked WHERE rank <= 12
      UNION ALL SELECT 'other', 'Other', SUM("salesCents")::bigint, SUM(units)::bigint, SUM(orders)::integer
      FROM ranked WHERE rank > 12 HAVING COUNT(*) > 0 ORDER BY "salesCents" DESC, label ASC`, values);
    const eventMix = await select(`${cte}, event_totals AS (
      SELECT se.id, se.title AS label, se.starts_at AS "startsAt", se.venue_timezone AS "venueTimezone",
        SUM(vo.report_sales_cents)::bigint AS "salesCents", COUNT(*)::integer AS orders
      FROM visible_orders vo JOIN report_events se ON se.id = vo.event_id GROUP BY se.id, se.title, se.starts_at, se.venue_timezone),
      ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY "salesCents" DESC, id ASC) AS rank FROM event_totals)
      SELECT id::text, label, "startsAt", "venueTimezone", "salesCents", orders FROM ranked WHERE rank <= 6
      UNION ALL SELECT 'other', 'Other events', NULL::timestamptz, NULL::text, SUM("salesCents")::bigint, SUM(orders)::integer
      FROM ranked WHERE rank > 6 HAVING COUNT(*) > 0 ORDER BY "salesCents" DESC, label ASC`, values);
    const [person] = input.personId ? (await table(userId, 'team', { ...input, sort: 'name_asc', page: 1, pageSize: 1,
      roles: [], personSearch: '' })).items : [];
    const summaryRow = { salesCents: number(financial.salesCents),
      commissionCents: input.offeringKind ? null : number(financial.commissionCents),
      commissionBasis: input.offeringKind ? 'unavailable_at_offering_level' : 'recorded_order',
      directSalesCents: number(financial.directSalesCents), orders: financial.orders, customers: financial.customers,
      units: number(units.units), admissions: tickets.admissions, checkedIn: tickets.checkedIn + guests.checkedIn,
      guestlistPlaces: guests.guestlistPlaces, events: eventCount.events, activeEvents: activeEventCount.events,
      averageOrderCents: financial.orders ? Math.round(number(financial.salesCents) / financial.orders) : 0 };
    const byDate = new Map(daily.map((row) => [row.date, row]));
    const series = [];
    for (let day = new Date(`${range.startDate}T00:00:00.000Z`); day.toISOString().slice(0, 10) <= range.endDate; day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      const row = byDate.get(date);
      series.push({ date, orders: row?.orders || 0, salesCents: number(row?.salesCents) });
    }
    return { range, event: event || null, person: person ? { id: person.id, label: person.label, role: person.role } : null,
      summary: summaryRow, daily: series,
      regionalMix: regionalMix.map((row) => ({ ...row, level: 'region', salesCents: number(row.salesCents) })),
      channels: channels.map((row) => ({ ...row, salesCents: number(row.salesCents) })),
      category: category.map((row) => ({ ...row, salesCents: number(row.salesCents) })),
      offerings: offerings.map((row) => ({ ...row, salesCents: number(row.salesCents), units: number(row.units) })),
      eventMix: eventMix.map((row) => ({ ...row, salesCents: number(row.salesCents) })) };
  }

  function groupTable(kind) {
    const key = kind === 'regions' ? 'region' : 'venue_group';
    const groupKey = (alias) => `${alias}.${key}`;
    const eligible = kind === 'regions' ? '' : 'WHERE se.location_id IS NOT NULL';
    return `SELECT groups.id, groups.label, groups.region, groups."organizationId", groups."creatorUserId",
      groups."venueName", groups."venueAddress", groups."venueCity", groups."venueRegion", groups."venueCountry",
      groups.events, COALESCE(os.orders,0)::integer AS orders,
      COALESCE(os."salesCents",0)::bigint AS "salesCents", COALESCE(os."commissionCents",0)::bigint AS "commissionCents",
      COALESCE(os.customers,0)::integer AS customers, COALESCE(its.units,0)::bigint AS units,
      COALESCE(ts.admissions,0)::integer AS admissions,
      COALESCE(ts."checkedIn",0)::integer + COALESCE(gs."checkedIn",0)::integer AS "checkedIn",
      COALESCE(gs."guestlistPlaces",0)::integer AS "guestlistPlaces"
      FROM (SELECT ${groupKey('se')} AS id, MIN(${kind === 'regions' ? 'se.region' : "COALESCE(NULLIF(se.venue_name,''), NULLIF(se.venue_address,''), NULLIF(se.venue_city,''), 'Event location')"}) AS label,
        MIN(se.region) AS region, MIN(se.organization_id::text) AS "organizationId",
        MIN(se.creator_user_id::text) AS "creatorUserId", MIN(se.venue_name) AS "venueName",
        MIN(se.venue_address) AS "venueAddress", MIN(se.venue_city) AS "venueCity",
        MIN(se.venue_region) AS "venueRegion", MIN(se.venue_country) AS "venueCountry",
        COUNT(*)::integer AS events FROM report_events se ${eligible} GROUP BY ${groupKey('se')}) groups
      LEFT JOIN (SELECT ${groupKey('se')} AS id, COUNT(*)::integer AS orders,
        SUM(vo.report_sales_cents)::bigint AS "salesCents", SUM(vo.report_commission_cents)::bigint AS "commissionCents",
        COUNT(DISTINCT vo.buyer_user_id)::integer AS customers
        FROM visible_orders vo JOIN report_events se ON se.id = vo.event_id GROUP BY ${groupKey('se')}) os ON os.id = groups.id
      LEFT JOIN (SELECT ${groupKey('se')} AS id, SUM(oi.quantity)::bigint AS units
        FROM visible_items oi JOIN visible_orders vo ON vo.id = oi.order_id JOIN report_events se ON se.id = vo.event_id
        GROUP BY ${groupKey('se')}) its ON its.id = groups.id
      LEFT JOIN (SELECT ${groupKey('se')} AS id,
        COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions,
        COUNT(*) FILTER (WHERE t.status = 'checked_in')::integer AS "checkedIn"
        FROM tickets t JOIN visible_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id
        JOIN report_events se ON se.id = vo.event_id GROUP BY ${groupKey('se')}) ts ON ts.id = groups.id
      LEFT JOIN (SELECT ${groupKey('se')} AS id,
        SUM(g.party_size) FILTER (WHERE g.status IN ('confirmed','checked_in'))::integer AS "guestlistPlaces",
        SUM(g.party_size) FILTER (WHERE g.status = 'checked_in')::integer AS "checkedIn"
        FROM visible_guests g JOIN report_events se ON se.id = g.event_id GROUP BY ${groupKey('se')}) gs ON gs.id = groups.id`;
  }

  const tableSql = {
    regions: {
      base: groupTable('regions'),
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC', name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC' },
    },
    venues: {
      base: groupTable('venues'),
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC', name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC' },
    },
    events: {
      base: `SELECT se.id, se.id AS "eventId", se.title AS label, se.region, se.venue_name AS "venueName",
        se.venue_timezone AS "venueTimezone",
        se.status, se.starts_at AS "startsAt", COALESCE(os.orders,0)::integer AS orders,
        COALESCE(os."salesCents",0)::bigint AS "salesCents", COALESCE(os."commissionCents",0)::bigint AS "commissionCents",
        COALESCE(os.customers,0)::integer AS customers, COALESCE(its.units,0)::bigint AS units,
        COALESCE(ts.admissions,0)::integer AS admissions, COALESCE(ts."checkedIn",0)::integer + COALESCE(gs."checkedIn",0)::integer AS "checkedIn",
        COALESCE(gs."guestlistPlaces",0)::integer AS "guestlistPlaces"
        FROM report_events se
        LEFT JOIN (SELECT event_id, COUNT(*)::integer AS orders, SUM(report_sales_cents)::bigint AS "salesCents",
          SUM(report_commission_cents)::bigint AS "commissionCents", COUNT(DISTINCT buyer_user_id)::integer AS customers
          FROM visible_orders GROUP BY event_id) os ON os.event_id = se.id
        LEFT JOIN (SELECT vo.event_id, SUM(oi.quantity)::bigint AS units FROM visible_items oi JOIN visible_orders vo ON vo.id = oi.order_id GROUP BY vo.event_id) its ON its.event_id = se.id
        LEFT JOIN (SELECT vo.event_id, COUNT(*) FILTER (WHERE t.status IN ('valid','checked_in'))::integer AS admissions,
          COUNT(*) FILTER (WHERE t.status = 'checked_in')::integer AS "checkedIn"
          FROM tickets t JOIN visible_items oi ON oi.id = t.order_item_id JOIN visible_orders vo ON vo.id = oi.order_id GROUP BY vo.event_id) ts ON ts.event_id = se.id
        LEFT JOIN (SELECT event_id, SUM(party_size) FILTER (WHERE status IN ('confirmed','checked_in'))::integer AS "guestlistPlaces",
          SUM(party_size) FILTER (WHERE status = 'checked_in')::integer AS "checkedIn" FROM visible_guests GROUP BY event_id) gs ON gs.event_id = se.id`,
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC', name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC', starts_asc: '"startsAt" ASC, id ASC', starts_desc: '"startsAt" DESC, id ASC' },
    },
    offerings: {
      base: `SELECT (oi.kind_snapshot || ':' || oi.name_snapshot) AS id, oi.name_snapshot AS label,
        oi.kind_snapshot AS kind, SUM(oi.line_total_cents)::bigint AS "salesCents",
        SUM(oi.quantity)::bigint AS units, COUNT(DISTINCT vo.id)::integer AS orders
        FROM visible_items oi JOIN visible_orders vo ON vo.id = oi.order_id
        GROUP BY oi.kind_snapshot, oi.name_snapshot`,
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC', name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC' },
    },
    team: {
      base: `WITH managed_events AS (
          SELECT se.* FROM report_events se WHERE :isAdmin
            OR (se.organization_id IS NULL AND se.creator_user_id = :userId)
            OR EXISTS (SELECT 1 FROM organization_owners viewer WHERE viewer.organization_id = se.organization_id
              AND viewer.user_id = :userId AND viewer.lifecycle_state = 'active')),
        participants AS (
          SELECT oo.user_id, 5 AS priority FROM organization_owners oo JOIN managed_events se ON se.organization_id = oo.organization_id
            WHERE oo.lifecycle_state = 'active' AND oo.role = 'owner'
          UNION ALL SELECT oo.user_id, 4 FROM organization_owners oo JOIN managed_events se ON se.organization_id = oo.organization_id
            WHERE oo.lifecycle_state = 'active' AND oo.role = 'admin'
          UNION ALL SELECT oe.user_id, 3 FROM organization_employees oe JOIN managed_events se ON se.organization_id = oe.organization_id
            WHERE oe.status = 'active'
          UNION ALL SELECT ea.user_id, 1 FROM event_affiliates ea JOIN managed_events se ON se.id = ea.event_id
            WHERE ea.status = 'active'
          UNION ALL SELECT oa.user_id, 1 FROM org_affiliates oa JOIN managed_events se ON se.organization_id = oa.organization_id
            WHERE oa.status = 'active'
          UNION ALL SELECT ea.user_id, 1 FROM event_affiliates ea JOIN report_events se ON se.id = ea.event_id
            WHERE ea.user_id = :userId AND ea.status = 'active'
          UNION ALL SELECT oa.user_id, 1 FROM org_affiliates oa JOIN report_events se ON se.organization_id = oa.organization_id
            WHERE oa.user_id = :userId AND oa.status = 'active'
          UNION ALL SELECT se.creator_user_id, 2 FROM managed_events se WHERE se.organization_id IS NULL
          UNION ALL SELECT COALESCE(ea.user_id, oa.user_id), 1 FROM visible_orders vo
            LEFT JOIN event_affiliates ea ON ea.id = vo.event_affiliate_id
            LEFT JOIN org_affiliates oa ON oa.id = vo.org_affiliate_id
            WHERE COALESCE(ea.user_id, oa.user_id) IS NOT NULL
          UNION ALL SELECT ea.user_id, 1 FROM visible_guests g
            JOIN event_affiliates ea ON ea.id = g.event_affiliate_id),
        people AS (SELECT user_id, MAX(priority) AS priority FROM participants GROUP BY user_id),
        credited_sales AS (SELECT COALESCE(ea.user_id, oa.user_id) AS user_id,
          COUNT(*)::integer AS orders, SUM(vo.report_sales_cents)::bigint AS "salesCents",
          SUM(vo.report_commission_cents)::bigint AS "commissionCents",
          COUNT(DISTINCT vo.buyer_user_id)::integer AS customers
          FROM visible_orders vo LEFT JOIN event_affiliates ea ON ea.id = vo.event_affiliate_id
          LEFT JOIN org_affiliates oa ON oa.id = vo.org_affiliate_id
          WHERE COALESCE(ea.user_id, oa.user_id) IS NOT NULL GROUP BY 1),
        guest_totals AS (SELECT ea.user_id, COUNT(*)::integer AS "guestlistRequests",
          SUM(g.party_size)::integer AS "guestlistPlaces",
          COALESCE(SUM(g.party_size) FILTER (WHERE g.status IN ('confirmed','checked_in')),0)::integer AS "approvedGuestlistPlaces"
          FROM visible_guests g JOIN event_affiliates ea ON ea.id = g.event_affiliate_id GROUP BY ea.user_id)
        SELECT p.user_id::text AS id, u.display_name AS label,
          CASE p.priority WHEN 5 THEN 'Owner' WHEN 4 THEN 'Manager' WHEN 3 THEN 'Employee' WHEN 2 THEN 'Creator' ELSE 'Promoter' END AS role,
          COALESCE(s.orders,0)::integer AS orders, COALESCE(s."salesCents",0)::bigint AS "salesCents",
          COALESCE(s."commissionCents",0)::bigint AS "commissionCents", COALESCE(s.customers,0)::integer AS customers,
          COALESCE(g."guestlistRequests",0)::integer AS "guestlistRequests",
          COALESCE(g."guestlistPlaces",0)::integer AS "guestlistPlaces",
          COALESCE(g."approvedGuestlistPlaces",0)::integer AS "approvedGuestlistPlaces"
        FROM people p JOIN users u ON u.id = p.user_id AND u.lifecycle_state = 'active' AND u.is_active = true
          LEFT JOIN credited_sales s ON s.user_id = p.user_id LEFT JOIN guest_totals g ON g.user_id = p.user_id
        WHERE NOT :hasPerson OR p.user_id = :personId`,
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC',
        name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC',
        role_asc: 'role ASC, id ASC', role_desc: 'role DESC, id ASC',
        orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC' },
    },
    customers: {
      base: `SELECT vo.buyer_user_id::text AS id,
        vo.buyer_user_id AS "buyerUserId", u.display_name AS label, u.email,
        COUNT(*)::integer AS orders, SUM(vo.report_sales_cents)::bigint AS "salesCents",
        COALESCE(SUM((SELECT SUM(oi.quantity) FROM visible_items oi WHERE oi.order_id = vo.id)),0)::bigint AS units
        FROM visible_orders vo JOIN users u ON u.id = vo.buyer_user_id
        GROUP BY vo.buyer_user_id, u.display_name, u.email`,
      sorts: { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC', name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC' },
    },
  };

  async function table(userId, kind, input) {
    const { cte, values, range } = await source(userId, input);
    const definition = tableSql[kind];
    const field = input.sort.replace(/_(asc|desc)$/, '');
    const direction = input.sort.endsWith('_asc') ? 'ASC' : 'DESC';
    const commonColumns = { customers: 'customers', units: 'units', checkins: '"checkedIn"', average: '("salesCents"::numeric / NULLIF(orders,0))', events: 'events' };
    const allowed = {
      regions: ['customers', 'units', 'checkins', 'average', 'events'], venues: ['customers', 'units', 'checkins', 'average', 'events'],
      events: ['customers', 'units', 'checkins', 'average'], offerings: ['units'], customers: ['units'], team: ['guestlist', 'commission', 'contribution'],
    };
    const teamColumns = { guestlist: '"guestlistPlaces"', commission: '"commissionCents"', contribution: '"salesCents"' };
    const extraColumn = allowed[kind].includes(field) ? (commonColumns[field] || teamColumns[field]) : null;
    const sort = definition.sorts[input.sort] || (extraColumn ? `${extraColumn} ${direction} NULLS LAST, id ASC` : null);
    if (!sort) { const error = new Error('Unsupported sort for this report table'); error.status = 400; throw error; }
    const predicate = kind === 'team' ? ` WHERE (:personSearch = '' OR label ILIKE :personPattern ESCAPE '\\')
      AND (:allRoles OR role IN (:roles))` : kind === 'events' && input.activityOnly === 'true' ? ' WHERE orders > 0' : '';
    const tableValues = { ...values, personSearch: input.personSearch || '',
      personPattern: `%${(input.personSearch || '').replace(/[\\%_]/g, '\\$&')}%`,
      allRoles: !input.roles?.length, roles: input.roles?.length ? input.roles : ['Owner'] };
    const [count] = await select(`${cte} SELECT COUNT(*)::integer AS total FROM (${definition.base}) report_rows${predicate}`, tableValues);
    const rows = await select(`${cte} SELECT * FROM (${definition.base}) report_rows${predicate} ORDER BY ${sort} LIMIT :pageSize OFFSET :offset`,
      { ...tableValues, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize });
    const items = rows.map((row) => {
      const result = { ...row, salesCents: number(row.salesCents),
        commissionCents: input.offeringKind ? null : number(row.commissionCents),
        commissionBasis: input.offeringKind ? 'unavailable_at_offering_level' : 'recorded_order', units: number(row.units) };
      if (kind === 'venues') result.id = venueKey({ organizationId: row.organizationId,
        creatorUserId: row.creatorUserId, location: { name: row.venueName, addressLine1: row.venueAddress,
          city: row.venueCity, region: row.venueRegion, countryCode: row.venueCountry } });
      return result;
    });
    return { ...pageResult(items, count.total, input.page, input.pageSize), range };
  }

  async function exportCsv(userId, input, response) {
    const selected = input.exportTable;
    const query = { ...input, sort: selected ? input.sort : 'sales_desc', page: 1, pageSize: 100 };
    // Resolve authorization, filters and a first bounded page before opening the stream.
    const first = await table(userId, selected || 'events', query);
    const report = !selected || selected === 'team' ? await summary(userId, input) : null;
    response.set('Content-Type', 'text/csv; charset=utf-8');
    response.set('Content-Disposition', `attachment; filename="nitewide-business-${selected ? `${selected}-` : ''}${first.range.startDate}-${first.range.endDate}.csv"`);
    response.set('Cache-Control', 'no-store');
    const write = async (values) => {
      if (response.destroyed) return false;
      if (!response.write(csvRow(values))) await new Promise((resolve) => {
        const finish = () => { response.off('drain', finish); response.off('close', finish); resolve(); };
        response.once('drain', finish);
        response.once('close', finish);
      });
      return !response.destroyed;
    };
    try {
      if (selected) {
        const usd = (value) => (number(value) / 100).toFixed(2);
        const expected = (row) => number(row.admissions) + number(row.guestlistPlaces);
        const average = (row) => usd(row.orders ? Math.round(row.salesCents / row.orders) : 0);
        const localStart = (row) => row.startsAt ? new Intl.DateTimeFormat('en-US', {
          timeZone: row.venueTimezone || 'UTC', year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        }).format(new Date(row.startsAt)) : '';
        const columns = {
          regions: { header: ['Region', 'Events', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
            row: (row) => [row.label, row.events, row.orders, usd(row.salesCents), row.customers, row.units, row.checkedIn, expected(row), average(row)] },
          venues: { header: ['Venue / creator', 'Events', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
            row: (row) => [row.label, row.events, row.orders, usd(row.salesCents), row.customers, row.units, row.checkedIn, expected(row), average(row)] },
          events: { header: ['Event', 'Status', 'Starts at', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
            row: (row) => [row.label, row.status, localStart(row), row.orders, usd(row.salesCents), row.customers, row.units, row.checkedIn, expected(row), average(row)] },
          offerings: { header: ['Offering', 'Kind', 'Units', 'Orders', 'Sales USD'],
            row: (row) => [row.label, row.kind, row.units, row.orders, usd(row.salesCents)] },
          team: { header: ['Name', 'Role', 'Attributed sales USD', 'Paid orders', 'Guestlist places', 'Approved guestlist places', 'Commission USD', 'Contribution %'],
            row: (row) => [row.label, row.role, usd(row.salesCents), row.orders, row.guestlistPlaces, row.approvedGuestlistPlaces,
              row.commissionCents == null ? '' : usd(row.commissionCents),
              report.summary.salesCents ? (row.salesCents / report.summary.salesCents * 100).toFixed(1) : '0.0'] },
          customers: { header: ['Customer', 'Email', 'Paid orders', 'Sales USD', 'Units'],
            row: (row) => [row.label, row.email, row.orders, usd(row.salesCents), row.units] },
        };
        const definition = columns[selected];
        if (!(await write(definition.header))) return;
        let current = first;
        let page = 1;
        while (!response.destroyed) {
          for (const row of current.items) if (!(await write(definition.row(row)))) return;
          if (!current.hasMore) break;
          page += 1;
          current = await table(userId, selected, { ...query, page });
        }
        if (!response.destroyed) response.end();
        return;
      }
      await write(['Nitewide business report', 'USD', report.range.timezone, `Paid ${report.range.startDate} through ${report.range.endDate}`]);
      await write(['Section', 'Name / date', 'Role / kind', 'Event', 'Sales USD', 'Orders / units', 'Commission USD', 'Checked in', 'Expected']);
      const tableRows = {
        events: (row) => ['Event', row.label, row.region, row.eventId, (row.salesCents / 100).toFixed(2), row.orders,
          row.commissionCents == null ? '' : (row.commissionCents / 100).toFixed(2), row.checkedIn, row.admissions + row.guestlistPlaces],
        offerings: (row) => ['Offering', row.label, row.kind, '', (row.salesCents / 100).toFixed(2), row.units, '', '', ''],
        team: (row) => ['Person', row.label, row.role, '', (row.salesCents / 100).toFixed(2), row.orders,
          row.commissionCents == null ? '' : (row.commissionCents / 100).toFixed(2), '', ''],
      };
      for (const kind of Object.keys(tableRows)) {
        let page = 1;
        let current = kind === 'events' ? first : await table(userId, kind, { ...query, page });
        while (!response.destroyed) {
          for (const row of current.items) if (!(await write(tableRows[kind](row)))) return;
          if (!current.hasMore) break;
          page += 1;
          current = await table(userId, kind, { ...query, page });
        }
      }
      for (const day of report.daily) if (!(await write(['Daily', day.date, '', '', (day.salesCents / 100).toFixed(2), day.orders, '', '', '']))) return;
      response.end();
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else throw error;
    }
  }

  return { summary, table, exportCsv, source, tableSql };
}

module.exports = { createBusinessReportService, period, topWithOther, csvRow };
