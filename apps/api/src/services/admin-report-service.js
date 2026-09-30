const { QueryTypes } = require('sequelize');
const { venueOptions, venueFilter } = require('./venue-scope');
const { createBusinessReportService } = require('./business-report-service');

function createAdminReportService({ models, permissions, businessRead }) {
  const select = (sql, replacements = {}, { transaction } = {}) => models.Event.sequelize.query(sql,
    { replacements, transaction, type: QueryTypes.SELECT });
  async function historicalVenues(options = {}) {
    const rows = await select(`SELECT DISTINCT e.organization_id AS "organizationId", e.creator_user_id AS "creatorUserId",
      e.location_id AS "locationId", jsonb_build_object('id',loc.id,'name',loc.name,'addressLine1',loc.address_line1,
      'city',loc.city,'region',loc.region,'countryCode',loc.country_code) AS location
      FROM events e LEFT JOIN locations loc ON loc.id=e.location_id`, {}, options);
    return venueOptions(rows);
  }
  const historicalRead = { actor: businessRead.actor,
    filters: async (actor, input, options) => {
      const filter = await businessRead.filters(actor, { ...input, venueIds: [] }, options);
      if (!input.venueIds?.length) return filter;
      const venues = await historicalVenues(options);
      const selected = venueFilter(venues, input.venueIds);
      return { sql: `${filter.sql} AND ${selected.sql}`, values: { ...filter.values, ...selected.values } };
    },
  };
  const reports = createBusinessReportService({ models, businessRead: historicalRead, includeHistorical: true });
  async function bootstrap(userId) {
    await permissions.assertInternal(userId);
    const organizations = await select(`SELECT DISTINCT org.id,org.name AS label FROM organizations org
      JOIN events e ON e.organization_id=org.id ORDER BY label,org.id`);
    const venues = await historicalVenues();
    const regions = await select(`SELECT DISTINCT CASE WHEN NULLIF(TRIM(loc.city), '') IS NULL
      THEN 'Unspecified region' ELSE CONCAT_WS(', ', NULLIF(TRIM(loc.city), ''), NULLIF(TRIM(loc.region), ''),
      NULLIF(TRIM(loc.country_code), '')) END AS label
      FROM events e LEFT JOIN locations loc ON loc.id=e.location_id ORDER BY label`);
    return { organizations, venues, regions: regions.map((row) => row.label) };
  }
  return { bootstrap, reports,
    summary: async (userId, input) => { await permissions.assertInternal(userId); return reports.summary(userId, input); },
    table: async (userId, kind, input) => { await permissions.assertInternal(userId); return reports.table(userId, kind, input); },
  };
}
module.exports = { createAdminReportService };
