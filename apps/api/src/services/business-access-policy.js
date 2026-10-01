const { QueryTypes } = require('sequelize');
const { DomainError } = require('../domain/errors');
const { activeUser } = require('./lifecycle-service');
const { accessScopeSql } = require('./event-affiliate-access');

const MESSAGE = 'Business access is required. Request access or accept your business invitation before signing in.';
// This is an entry gate, not an operational permission grant. Suspended
// merchants retain admission access; individual services still enforce scope.
async function assertBusinessAccess(models, userId, transaction, suppliedUser) {
  const user = suppliedUser || await models.User.findByPk(userId, { transaction });
  const denied = () => { throw new DomainError(MESSAGE, { code: 'BUSINESS_ACCESS_REQUIRED', status: 403 }); };
  if (!activeUser(user)) return denied();
  // Existing explicitly provisioned legacy creators remain supported. Merely
  // owning a customer account or having created an event is never sufficient.
  if (user.isInternalAdmin || user.independentCreator) return user;
  const available = "org.lifecycle_state IN ('active','suspended') AND org.status IN ('active','suspended')";
  const member = (column = 'e.organization_id') => `EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id=${column} AND oo.user_id=:userId AND oo.lifecycle_state='active')
    OR EXISTS (SELECT 1 FROM organization_employees oe WHERE oe.organization_id=${column} AND oe.user_id=:userId AND oe.status='active')
    OR EXISTS (SELECT 1 FROM org_affiliates oa WHERE oa.organization_id=${column} AND oa.user_id=:userId AND oa.status='active' AND (oa.starts_at IS NULL OR oa.starts_at<=NOW()) AND (oa.ends_at IS NULL OR oa.ends_at>=NOW()))`;
  const [result] = await models.User.sequelize.query(`SELECT (
    EXISTS (SELECT 1 FROM organizations org WHERE ${available} AND (${member('org.id')}))
    OR EXISTS (SELECT 1 FROM venue_access va JOIN organizations org ON org.id=va.organization_id
      JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
      JOIN locations loc ON loc.id=va.location_id AND loc.lifecycle_state='active'
      WHERE va.user_id=:userId AND va.status='active' AND ${available})
    OR EXISTS (SELECT 1 FROM event_affiliates ea JOIN events e ON e.id=ea.event_id
      LEFT JOIN organizations org ON org.id=e.organization_id LEFT JOIN locations loc ON loc.id=e.location_id
      JOIN users creator ON creator.id=e.creator_user_id
      WHERE ea.user_id=:userId AND ea.status='active' AND e.lifecycle_state='active'
        AND (ea.starts_at IS NULL OR ea.starts_at<=NOW()) AND (ea.ends_at IS NULL OR ea.ends_at>=NOW())
        AND (e.location_id IS NULL OR loc.lifecycle_state='active')
        AND (e.organization_id IS NULL AND creator.is_active=true AND creator.lifecycle_state='active' AND creator.onboarding_pending=false OR ${available})
        AND (${accessScopeSql('ea')}='event' OR (${accessScopeSql('ea')}='organization' AND (${member()}))
          OR (${accessScopeSql('ea')}='venue' AND EXISTS (SELECT 1 FROM venue_access va
            JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
            WHERE va.id=ea.venue_access_id AND va.organization_id=e.organization_id AND va.location_id=e.location_id
              AND va.user_id=:userId AND va.status='active'))))
    ) AS allowed`, { replacements: { userId }, transaction, type: QueryTypes.SELECT });
  if (!result?.allowed) return denied();
  return user;
}
module.exports = { assertBusinessAccess, BUSINESS_ACCESS_MESSAGE: MESSAGE };
