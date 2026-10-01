const { QueryTypes, Transaction } = require('sequelize');
const { venueOptions } = require('./venue-scope');
const { createBusinessReportService } = require('./business-report-service');
const { pageResult } = require('./business-read-service');
const { DomainError } = require('../domain/errors');

const numeric = value => value == null ? null : Number(value);
const modeled = field => `CASE WHEN vo.pricing_plan_snapshot->'pricingDecision'->>'${field}' ~ '^${field === 'contributionCents' ? '-?' : ''}[0-9]{1,12}$'
  THEN (vo.pricing_plan_snapshot->'pricingDecision'->>'${field}')::bigint END`;
// Historical buyer-paid snapshots have no absorbed fee field. Only the
// explicitly recorded new fee-mode decision contributes a business deduction.
const absorbedFees = `COALESCE(${modeled('businessFeeCents')},0)`;
const finance = `COALESCE(SUM(vo.subtotal_cents),0)::bigint AS "faceValueSalesCents",
  COALESCE(SUM(vo.platform_fee_cents),0)::bigint AS "addedBuyerFeesCents",
  COALESCE(SUM(${absorbedFees}),0)::bigint AS "businessAbsorbedFeesCents",
  COALESCE(SUM(vo.platform_fee_cents+${absorbedFees}),0)::bigint AS "combinedFeesCents",
  COALESCE(SUM(vo.total_cents),0)::bigint AS "customerPaidCents",
  COALESCE(SUM(vo.affiliate_commission_cents),0)::bigint AS "recordedCommissionsCents",
  COALESCE(SUM(vo.subtotal_cents-${absorbedFees}-vo.affiliate_commission_cents),0)::bigint AS "businessProceedsBeforeProviderCents",
  CASE WHEN COUNT(*)=COUNT(${modeled('processingCents')}) THEN COALESCE(SUM(${modeled('processingCents')}),0)::bigint END AS "modeledProcessingCents",
  CASE WHEN COUNT(*)=COUNT(${modeled('contributionCents')}) THEN COALESCE(SUM(${modeled('contributionCents')}),0)::bigint END AS "modeledContributionCents",
  COUNT(*) FILTER (WHERE ${modeled('processingCents')} IS NOT NULL AND ${modeled('contributionCents')} IS NOT NULL)::integer AS "modeledOrders"`;
const sorts = { sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC',
  name_asc: 'label ASC, id ASC', name_desc: 'label DESC, id ASC', orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC',
  units_asc: 'units ASC, id ASC', units_desc: 'units DESC, id ASC', customers_asc: 'customers ASC, id ASC', customers_desc: 'customers DESC, id ASC',
  events_asc: 'events ASC, id ASC', events_desc: 'events DESC, id ASC', paid_asc: '"paidAt" ASC, id ASC', paid_desc: '"paidAt" DESC, id ASC',
  fees_asc: '"addedBuyerFeesCents" ASC, id ASC', fees_desc: '"addedBuyerFeesCents" DESC, id ASC' };
const moneyFields = ['salesCents','units','commissionCents','faceValueSalesCents','addedBuyerFeesCents','businessAbsorbedFeesCents','combinedFeesCents','customerPaidCents',
  'recordedCommissionsCents','businessProceedsBeforeProviderCents','modeledProcessingCents','modeledContributionCents'];
const directorySql = `SELECT org.id::text AS id,org.id::text AS "businessId",org.id AS "organizationId",NULL::uuid AS "creatorUserId",
  org.name AS label,org.business_type AS "businessType",org.lifecycle_state AS "lifecycleState",org.status::text AS status FROM organizations org
  UNION ALL SELECT 'creator:'||u.id::text,'creator:'||u.id::text,NULL::uuid,u.id,u.display_name,'legacy_creator',u.lifecycle_state,
  CASE WHEN u.is_active THEN 'active' ELSE 'suspended' END FROM users u
  WHERE u.independent_creator OR EXISTS (SELECT 1 FROM events legacy WHERE legacy.organization_id IS NULL AND legacy.creator_user_id=u.id)`;
// Match venueKey's compact JSON identity in SQL. Normalized fields contain
// only ASCII alphanumerics, so no JSON escaping or platform-wide lookup array
// is needed to apply selected aggregate keys.
const cleanVenue = column => `REGEXP_REPLACE(LOWER(COALESCE(${column},'')),'[^a-z0-9]','','g')`;
const venueIdentitySql = `encode(digest('["'||COALESCE(e.organization_id::text,'creator:'||e.creator_user_id::text)||'","'||
  ${['loc.name','loc.address_line1','loc.city','loc.region','loc.country_code'].map(cleanVenue).join(`||'","'||`)}||'"]','sha256'),'hex')`;

function createAdminReportService({ models, permissions, businessRead, now = () => new Date() }) {
  const db = models.Event?.sequelize;
  const select = (sql, replacements = {}, { transaction } = {}) => db.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const authorize = (userId, transaction) => permissions.assertInternalPermission(userId,'reports.view',transaction);
  async function historicalVenues(options = {},limit = null) {
    const rows = await select(`SELECT DISTINCT e.organization_id AS "organizationId",e.creator_user_id AS "creatorUserId",e.location_id AS "locationId",
      jsonb_build_object('id',loc.id,'name',loc.name,'addressLine1',loc.address_line1,'city',loc.city,'region',loc.region,'countryCode',loc.country_code) AS location
      FROM events e LEFT JOIN locations loc ON loc.id=e.location_id
      ${limit ? 'ORDER BY "organizationId","creatorUserId","locationId" LIMIT :limit' : ''}`,limit ? { limit } : {},options);
    const venues = venueOptions(rows);
    venues.hasMore = Boolean(limit && rows.length>=limit);
    return venues;
  }
  const historicalRead = { actor: businessRead.actor,filters: async (actor,input,options) => {
    const filter = await businessRead.filters(actor,{ ...input,venueIds: [] },options);
    if (input.businessId) {
      const creator = input.businessId.startsWith('creator:');
      filter.sql += creator ? ' AND e.organization_id IS NULL AND e.creator_user_id=:reportBusinessId' : ' AND e.organization_id=:reportBusinessId';
      filter.values.reportBusinessId = creator ? input.businessId.slice(8) : input.businessId;
    }
    if (!input.venueIds?.length) return filter;
    return { sql: `${filter.sql} AND ${venueIdentitySql} IN (:adminVenueIds)`,values: { ...filter.values,adminVenueIds: input.venueIds } };
  } };
  const shared = createBusinessReportService({ models,businessRead: historicalRead,includeHistorical: true,now });
  async function snapshot(userId,callback,options = {}) {
    if (options.transaction) { await authorize(userId,options.transaction); return callback(options); }
    await authorize(userId);
    return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },async transaction => {
      await authorize(userId,transaction); await db.query('SET LOCAL jit=off',{ transaction });
      return callback({ ...options,transaction });
    });
  }
  async function bootstrap(userId) {
    return snapshot(userId,async options => {
      const organizations = await select('SELECT id,name AS label FROM organizations ORDER BY label,id LIMIT 101',{},options);
      const businesses = await select(`SELECT * FROM (${directorySql}) b ORDER BY label,id LIMIT 101`,{},options);
      const venues = await historicalVenues(options,101);
      const regions = await select(`SELECT DISTINCT CASE WHEN NULLIF(TRIM(loc.city),'') IS NULL THEN 'Unspecified region'
        ELSE CONCAT_WS(', ',NULLIF(TRIM(loc.city),''),NULLIF(TRIM(loc.region),''),NULLIF(TRIM(loc.country_code),'')) END AS label
        FROM events e LEFT JOIN locations loc ON loc.id=e.location_id ORDER BY label LIMIT 101`,{},options);
      return { organizations: organizations.slice(0,100),businesses: businesses.slice(0,100),venues: venues.slice(0,100),regions: regions.slice(0,100).map(row => row.label),
        directory: { path: '/admin/reports/businesses',pageSize: 20 },optionsTruncated: { organizations: organizations.length>100,businesses: businesses.length>100,venues: venues.hasMore,regions: regions.length>100 },
        drilldown: ['businesses','events','offerings','purchases'],
        optionalEntryPoints: ['venues','regions','team','customers'] };
    });
  }
  async function summary(userId,input,options = {}) {
    return snapshot(userId,async scoped => {
      const result = await shared.summary(userId,input,scoped);
      const { cte,values } = await shared.source(userId,input,scoped);
      const [financial] = await select(`${cte} SELECT ${finance} FROM visible_orders vo`,values,scoped);
      for (const key of moneyFields) if (key in financial) financial[key] = numeric(financial[key]);
      return { ...result,financial: { ...financial,matchedFaceValueSalesCents: result.summary.salesCents,unknownModeledOrders: result.summary.orders-financial.modeledOrders,
        providerConfirmedProcessingCents: null,providerConfirmedApplicationFeesCents: null,providerConfirmedBusinessProceedsCents: null,refundCents: null,
        feeBasis: input.offeringId || input.offeringKind ? 'selected_orders_not_allocated_to_offering' : 'recorded_order_once',
        processingBasis: 'historical_pricing_model',contributionBasis: 'historical_pricing_model',
        businessProceedsBasis: 'recorded_face_value_less_absorbed_fee_and_commission_before_provider_adjustments',
        providerBasis: 'unavailable_pending_payment_integration',refundBasis: 'unavailable_pending_refund_integration' } };
    },options);
  }
  async function prepareTable(userId,kind,input,options = {}) {
    await authorize(userId,options.transaction);
    if (!['businesses','offerings','purchases'].includes(kind)) {
      const prepared = await shared.prepareTable(userId,kind,input,options);
      if (kind === 'events') prepared.sql = prepared.sql.replace('report_rows AS (',() => `admin_finance AS (SELECT vo.event_id,${finance} FROM visible_orders vo GROUP BY vo.event_id),report_rows AS (`)
        .replace('SELECT * FROM report_rows',() => `SELECT rows.*,e.organization_id AS "organizationId",e.creator_user_id AS "creatorUserId",
          COALESCE(e.organization_id::text,'creator:'||e.creator_user_id::text) AS "businessId",e.location_id AS "locationId",
          COALESCE(f."faceValueSalesCents",0)::bigint AS "faceValueSalesCents",COALESCE(f."addedBuyerFeesCents",0)::bigint AS "addedBuyerFeesCents",
          COALESCE(f."businessAbsorbedFeesCents",0)::bigint AS "businessAbsorbedFeesCents",COALESCE(f."combinedFeesCents",0)::bigint AS "combinedFeesCents",
          COALESCE(f."customerPaidCents",0)::bigint AS "customerPaidCents",COALESCE(f."recordedCommissionsCents",0)::bigint AS "recordedCommissionsCents",
          COALESCE(f."businessProceedsBeforeProviderCents",0)::bigint AS "businessProceedsBeforeProviderCents",
          CASE WHEN f.event_id IS NULL THEN 0 ELSE f."modeledProcessingCents" END AS "modeledProcessingCents",
          CASE WHEN f.event_id IS NULL THEN 0 ELSE f."modeledContributionCents" END AS "modeledContributionCents"
          FROM report_rows rows JOIN events e ON e.id=rows."eventId" LEFT JOIN admin_finance f ON f.event_id=rows."eventId"`)
        .replace(/\bid ASC/g,'rows.id ASC');
      const previous = prepared.mapRow;
      prepared.mapRow = row => { const result = { ...previous(row),aggregateKey: ['venues','regions'].includes(kind) ? previous(row).id : null,
        ...(kind === 'team' ? { userId: row.id } : {}),...(kind === 'customers' ? { customerId: row.buyerUserId } : {}) };
        for (const key of moneyFields) if (key in result && key !== 'commissionCents') result[key] = numeric(result[key]); return result; };
      return prepared;
    }
    const { cte,values,range } = await shared.source(userId,input,options);
    let base;
    if (kind === 'businesses') base = `WITH directory AS (${directorySql}),
      event_totals AS (SELECT COALESCE(se.organization_id::text,'creator:'||se.creator_user_id::text) AS id,COUNT(*)::integer AS events FROM report_events se GROUP BY 1),
      sales AS (SELECT COALESCE(se.organization_id::text,'creator:'||se.creator_user_id::text) AS id,COUNT(*)::integer AS orders,
        COUNT(DISTINCT vo.buyer_user_id)::integer AS customers,SUM(vo.report_sales_cents)::bigint AS "salesCents",${finance}
        FROM visible_orders vo JOIN report_events se ON se.id=vo.event_id GROUP BY 1),
      items AS (SELECT COALESCE(se.organization_id::text,'creator:'||se.creator_user_id::text) AS id,SUM(oi.quantity)::bigint AS units
        FROM visible_items oi JOIN visible_orders vo ON vo.id=oi.order_id JOIN report_events se ON se.id=vo.event_id GROUP BY 1)
      SELECT b.*,COALESCE(e.events,0)::integer AS events,COALESCE(s.orders,0)::integer AS orders,COALESCE(s.customers,0)::integer AS customers,
        COALESCE(s."salesCents",0)::bigint AS "salesCents",COALESCE(i.units,0)::bigint AS units,
        COALESCE(s."faceValueSalesCents",0)::bigint AS "faceValueSalesCents",COALESCE(s."addedBuyerFeesCents",0)::bigint AS "addedBuyerFeesCents",
        COALESCE(s."businessAbsorbedFeesCents",0)::bigint AS "businessAbsorbedFeesCents",COALESCE(s."combinedFeesCents",0)::bigint AS "combinedFeesCents",
        COALESCE(s."customerPaidCents",0)::bigint AS "customerPaidCents",COALESCE(s."recordedCommissionsCents",0)::bigint AS "recordedCommissionsCents",
        COALESCE(s."businessProceedsBeforeProviderCents",0)::bigint AS "businessProceedsBeforeProviderCents",
        CASE WHEN s.id IS NULL THEN 0 ELSE s."modeledProcessingCents" END AS "modeledProcessingCents",
        CASE WHEN s.id IS NULL THEN 0 ELSE s."modeledContributionCents" END AS "modeledContributionCents"
      FROM directory b LEFT JOIN event_totals e ON e.id=b.id LEFT JOIN sales s ON s.id=b.id LEFT JOIN items i ON i.id=b.id
      WHERE (:directorySearch = '' OR b.label ILIKE :directoryPattern ESCAPE '\\' OR e.id IS NOT NULL)
        AND (:allBusinesses OR b.id IN (:directoryBusinessIds) OR (:includeIndependentBusinesses AND b."organizationId" IS NULL)) AND (NOT :requireEventMatch OR e.id IS NOT NULL)
        AND (NOT :directoryActivityOnly OR s.orders>0)`;
    else if (kind === 'offerings') base = `SELECT oi.offering_id AS id,oi.offering_id AS "offeringId",vo.event_id AS "eventId",se.organization_id AS "organizationId",
      COALESCE(se.organization_id::text,'creator:'||se.creator_user_id::text) AS "businessId",MIN(oi.name_snapshot) AS label,MIN(oi.kind_snapshot) AS kind,
      ARRAY_AGG(DISTINCT oi.name_snapshot ORDER BY oi.name_snapshot) AS "historicalNames",SUM(oi.line_total_cents)::bigint AS "salesCents",
      SUM(oi.quantity)::bigint AS units,COUNT(DISTINCT vo.id)::integer AS orders,COUNT(DISTINCT vo.buyer_user_id)::integer AS customers,
      NULL::bigint AS "commissionCents",NULL::bigint AS "addedBuyerFeesCents",'unavailable_at_offering_level'::text AS "commissionBasis",'not_allocated_to_offering'::text AS "feeBasis"
      FROM visible_items oi JOIN visible_orders vo ON vo.id=oi.order_id JOIN report_events se ON se.id=vo.event_id
      GROUP BY oi.offering_id,vo.event_id,se.organization_id,se.creator_user_id`;
    else base = `SELECT vo.id,vo.id AS "orderId",vo.event_id AS "eventId",se.title AS "eventTitle",se.organization_id AS "organizationId",
      COALESCE(se.organization_id::text,'creator:'||se.creator_user_id::text) AS "businessId",vo.buyer_user_id AS "customerId",u.display_name AS label,u.email,
      vo.paid_at AS "paidAt",vo.status,vo.currency,vo.report_sales_cents AS "salesCents",vo.subtotal_cents AS "faceValueSalesCents",
      vo.platform_fee_cents AS "addedBuyerFeesCents",vo.total_cents AS "customerPaidCents",vo.affiliate_commission_cents AS "recordedCommissionsCents",
      ${absorbedFees} AS "businessAbsorbedFeesCents",vo.platform_fee_cents+${absorbedFees} AS "combinedFeesCents",
      vo.subtotal_cents-${absorbedFees}-vo.affiliate_commission_cents AS "businessProceedsBeforeProviderCents",${modeled('processingCents')} AS "modeledProcessingCents",
      ${modeled('contributionCents')} AS "modeledContributionCents",COALESCE(vo.pricing_plan_snapshot->>'demo','false')='true' AS demo,
      1::integer AS orders,1::integer AS customers,totals.units,totals.items,'recorded_order_once'::text AS "feeBasis"
      FROM visible_orders vo JOIN report_events se ON se.id=vo.event_id JOIN users u ON u.id=vo.buyer_user_id
      JOIN (SELECT order_id,SUM(quantity)::bigint AS units,jsonb_agg(jsonb_build_object('id',id,'offeringId',offering_id,'name',name_snapshot,
        'kind',kind_snapshot,'quantity',quantity,'salesCents',line_total_cents) ORDER BY id) AS items FROM visible_items GROUP BY order_id) totals ON totals.order_id=vo.id`;
    const selected = input.businessId ? [input.businessId] : input.organizationIds?.length ? input.organizationIds : input.organizationId ? [input.organizationId] : [];
    const real = selected.filter(id => id !== 'independent');
    const tableValues = { ...values,directorySearch: input.search || '',directoryPattern: `%${(input.search || '').replace(/[\\%_]/g,'\\$&')}%`,
      allBusinesses: !selected.length,directoryBusinessIds: real.length ? real : ['no-match'],includeIndependentBusinesses: selected.includes('independent'),
      directoryActivityOnly: input.activityOnly === 'true',
      requireEventMatch: Boolean(input.eventId || input.personId || input.offeringId || input.offeringKind || input.customerId || input.regions?.length || input.venueIds?.length || input.activityOnly === 'true') };
    const allowed = kind === 'businesses' ? ['sales','name','orders','units','customers','events','fees'] : kind === 'offerings' ? ['sales','name','orders','units','customers'] : ['sales','name','orders','units','customers','paid','fees'];
    const sort = allowed.includes(input.sort.replace(/_(asc|desc)$/,'')) ? sorts[input.sort] : null;
    if (!sort) throw new DomainError('Unsupported sort for this report table',{ status: 400,code: 'UNSUPPORTED_REPORT_SORT' });
    const reportCte = `${cte},report_rows AS (${base})`;
    const mapRow = row => { const result = { ...row,aggregateKey: null }; for (const key of moneyFields) if (key in result) result[key] = numeric(result[key]); return result; };
    return { sql: `${reportCte} SELECT * FROM report_rows ORDER BY ${sort}`,countSql: `${reportCte} SELECT COUNT(*)::integer AS total FROM report_rows`,values: tableValues,range,sort,mapRow };
  }
  async function table(userId,kind,input,options = {}) {
    return snapshot(userId,async scoped => {
      const prepared = await prepareTable(userId,kind,input,scoped);
      const [count] = await select(prepared.countSql,prepared.values,scoped);
      const rows = await select(`${prepared.sql} LIMIT :limit OFFSET :offset`,{ ...prepared.values,limit: input.pageSize,offset: (input.page-1)*input.pageSize },scoped);
      return { ...pageResult(rows.map(prepared.mapRow),count.total,input.page,input.pageSize),range: prepared.range };
    },options);
  }
  return { bootstrap,summary,table,reports: { summary,table,prepareTable,authorize } };
}
module.exports = { createAdminReportService };
