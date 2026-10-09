const { QueryTypes } = require('sequelize');
const { pageResult } = require('./business-read-service');
const { resolvePaidRange } = require('./business-report-period');
const { notFound } = require('../domain/errors');
const { persistedCommissionTerms } = require('./commission-profile-repository');
const { shareableTeamInvitation } = require('../domain/team-invitation-token');
const { netSubtotalSql, commissionExpenseSql: netCommissionSql, financialOrderSql } = require('./refund-report-policy');

const membersSql = `WITH team AS (
  SELECT DISTINCT ON (user_id) user_id, role, status, joined, finance_authorized, payment_disconnect_authorized FROM (
    SELECT user_id, CASE WHEN role = 'owner' THEN 'Owner' ELSE 'Manager' END AS role,
      'active' AS status, created_at AS joined, CASE WHEN role = 'owner' THEN 1 ELSE 2 END AS priority,
      CASE WHEN role = 'owner' THEN true ELSE finance_authorized END AS finance_authorized,
      CASE WHEN role = 'owner' THEN true ELSE payment_disconnect_authorized END AS payment_disconnect_authorized
      FROM organization_owners WHERE organization_id = :organizationId AND lifecycle_state = 'active'
    UNION ALL SELECT user_id, 'Employee', 'active', created_at, 3, false, false FROM organization_employees
      WHERE organization_id = :organizationId AND status = 'active'
    UNION ALL SELECT user_id, 'Promoter', 'active', created_at, 4, false, false FROM org_affiliates
      WHERE organization_id = :organizationId AND status = 'active' AND code NOT LIKE '%-STAFF'
  ) roles ORDER BY user_id, priority ASC
), sales AS (
  SELECT credited.user_id, COUNT(*) FILTER (WHERE o.status='paid')::integer AS orders, SUM(${netSubtotalSql()})::bigint AS "salesCents",
    SUM(${netCommissionSql()})::bigint AS "commissionCents", COUNT(DISTINCT o.buyer_user_id) FILTER (WHERE o.status='paid')::integer AS customers
  FROM orders o JOIN events e ON e.id = o.event_id
  LEFT JOIN event_affiliates ea ON ea.id = o.event_affiliate_id
  LEFT JOIN org_affiliates oa ON oa.id = o.org_affiliate_id
  CROSS JOIN LATERAL (SELECT COALESCE(ea.user_id, oa.user_id) AS user_id) credited
  WHERE e.organization_id = :organizationId AND ${financialOrderSql()} AND o.currency = 'USD'
    AND o.paid_at >= :since AND o.paid_at < :until AND credited.user_id IS NOT NULL
  GROUP BY credited.user_id
), rows AS (
  SELECT team.user_id AS id, u.display_name AS name, u.email, team.role, team.status, team.joined,
    team.finance_authorized AS "financeAuthorized",
    team.payment_disconnect_authorized AS "paymentDisconnectAuthorized",
    COALESCE(rate_oa.default_commission_bps,0)::integer AS "configuredCommissionBps",
    COALESCE(rate_oa.default_commission_bps,0)::integer AS "defaultCommissionBps",rate_oa.id IS NOT NULL AS "activeOrgAffiliate",
    COALESCE(sales.orders,0)::integer AS orders, COALESCE(sales."salesCents",0)::bigint AS "salesCents",
    COALESCE(sales."commissionCents",0)::bigint AS "commissionCents", COALESCE(sales.customers,0)::integer AS customers
  FROM team JOIN users u ON u.id = team.user_id LEFT JOIN sales ON sales.user_id = team.user_id
  LEFT JOIN org_affiliates rate_oa ON rate_oa.organization_id=:organizationId AND rate_oa.user_id=team.user_id AND rate_oa.status='active'
  WHERE u.lifecycle_state = 'active' AND u.is_active = true)
SELECT * FROM rows WHERE (:search = '' OR name ILIKE :searchPattern ESCAPE '\\' OR email ILIKE :searchPattern ESCAPE '\\')
  AND (:allRoles OR role IN (:roles))`;

const sorts = {
  name_asc: 'name ASC, id ASC', name_desc: 'name DESC, id ASC', role_asc: 'role ASC, name ASC, id ASC', role_desc: 'role DESC, name ASC, id ASC',
  email_asc: 'email ASC, id ASC', email_desc: 'email DESC, id ASC',
  status_asc: 'status ASC, name ASC, id ASC', status_desc: 'status DESC, name ASC, id ASC',
  sales_desc: '"salesCents" DESC, id ASC', sales_asc: '"salesCents" ASC, id ASC',
  orders_desc: 'orders DESC, id ASC', orders_asc: 'orders ASC, id ASC',
  customers_desc: 'customers DESC, id ASC', customers_asc: 'customers ASC, id ASC',
};

function createBusinessTeamReadService({ models, permissions, stripe = null, now = () => new Date() }) {
  const select = (sql, replacements) => models.Organization.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  async function page(userId, organizationId, input) {
    await permissions.assertManageOrganization(userId, organizationId);
    const [organization, owner] = await Promise.all([
      models.Organization.findByPk(organizationId),
      models.OrganizationOwner.findOne({ where: { userId, organizationId, role: 'owner', lifecycleState: 'active' } }),
    ]);
    if (!organization) throw notFound('Organization');
    const range = await resolvePaidRange(select, { days: 30, timezone: input.timezone }, now());
    const selectedRoles = input.roles?.length ? input.roles : input.role !== 'all' ? [input.role] : [];
    const values = { organizationId, since: range.since, until: range.until, roles: selectedRoles.length ? selectedRoles : ['Owner', 'Manager', 'Employee', 'Promoter'],
      allRoles: selectedRoles.length === 0, search: input.search,
      searchPattern: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize };
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM (${membersSql}) team_rows`, values);
    const rows = await select(`SELECT * FROM (${membersSql}) team_rows ORDER BY ${sorts[input.sort]} LIMIT :pageSize OFFSET :offset`, values);
    return { ...pageResult(await Promise.all(rows.map(async (row) => {
      const terms = await persistedCommissionTerms(models, row.id, Number(row.configuredCommissionBps || 0), { now: now(), mode: stripe?.mode || 'disabled' });
      return { ...row, ...terms, commissionBps: terms.effectiveCommissionBps,
        salesCents: Number(row.salesCents), commissionCents: Number(row.commissionCents) };
    })),
      count.total, input.page, input.pageSize), range, organizationVersion: organization.version, canGrantFinance: Boolean(owner),canManageCommissionDefaults:Boolean(await permissions.canManageFinance(userId,organizationId)) };
  }
  async function invitations(userId, organizationId, input) {
    await permissions.assertManageOrganization(userId, organizationId);
    const values = { organizationId, currentTime: now(), pageSize: input.pageSize,
      offset: (input.page - 1) * input.pageSize };
    const predicate = `i.organization_id = :organizationId AND i.accepted_at IS NULL AND i.expires_at > :currentTime`;
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM team_invitations i WHERE ${predicate}`, values);
    const rows = await select(`SELECT i.id, i.email, COALESCE(NULLIF(i.name,''), u.display_name) AS name, i.phone, i.role,
      i.organization_id AS "organizationId", i.event_id AS "eventId", i.token_hash AS "tokenHash",
      i.expires_at AS "expiresAt", i.created_at AS "createdAt"
      FROM team_invitations i LEFT JOIN users u ON u.email = i.email WHERE ${predicate}
      ORDER BY i.created_at DESC, i.id DESC LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows.map(row => shareableTeamInvitation(row)), count.total, input.page, input.pageSize);
  }
  return { page, invitations };
}

module.exports = { createBusinessTeamReadService };
