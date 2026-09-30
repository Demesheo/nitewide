const { active, activeUser } = require('./lifecycle-service');

function accessScope(assignment) {
  if (assignment?.accessScope) return assignment.accessScope;
  return assignment?.orgAffiliateId || assignment?.sourceOrgAffiliateId ||
    assignment?.code?.startsWith('STAFFEV-') || assignment?.code?.startsWith('LEADEV-')
    ? 'organization' : 'event';
}

function accessScopeSql(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  return `COALESCE(${alias}.access_scope, CASE WHEN ${alias}.org_affiliate_id IS NOT NULL
    OR ${alias}.source_org_affiliate_id IS NOT NULL OR ${alias}.code LIKE 'STAFFEV-%'
    OR ${alias}.code LIKE 'LEADEV-%' THEN 'organization' ELSE 'event' END)`;
}

async function currentOrganizationMembership(models, organizationId, userId, transaction, now = new Date()) {
  if (!organizationId) return null;
  const common = { transaction };
  // Sequelize transactions use one PostgreSQL connection. Running these reads
  // concurrently on it triggers pg's concurrent-query warning and can make
  // membership checks nondeterministic under load.
  const user = await models.User.findByPk(userId, common);
  const organization = await models.Organization.findByPk(organizationId, common);
  const leader = await models.OrganizationOwner.findOne({ where: { organizationId, userId, lifecycleState: 'active' }, ...common });
  const employee = await models.OrganizationEmployee.findOne({ where: { organizationId, userId, status: 'active' }, ...common });
  const affiliate = await models.OrgAffiliate.findOne({ where: { organizationId, userId, status: 'active' }, ...common });
  if (!activeUser(user) || !active(organization) || organization.status !== 'active') return null;
  const affiliateCurrent = affiliate && (!affiliate.startsAt || affiliate.startsAt <= now) && (!affiliate.endsAt || affiliate.endsAt >= now);
  return leader ? { kind: 'leader', record: leader } : employee ? { kind: 'employee', record: employee }
    : affiliateCurrent ? { kind: 'affiliate', record: affiliate } : null;
}

module.exports = { accessScope, accessScopeSql, currentOrganizationMembership };
