const { QueryTypes } = require('sequelize');
const { activeUser } = require('./lifecycle-service');
const { currentOrganizationMembership, accessScopeSql } = require('./event-affiliate-access');
const { resolveAffiliate } = require('./affiliate-service');

// Called inside the admission transaction; browser permissions are not authority.
async function canClaimInvitation(models, invitation, event, transaction, now) {
  const inviter = await models.User.findByPk(invitation.invitedByUserId, { transaction });
  if (!activeUser(inviter)) return false;
  if (!invitation.eventAffiliateId) {
    if (inviter.isInternalAdmin) return true;
    if (!event.organizationId) return event.creatorUserId === inviter.id;
    const membership = await currentOrganizationMembership(models, event.organizationId, inviter.id, transaction, now);
    return membership?.kind === 'leader';
  }
  const affiliate = await models.EventAffiliate.findByPk(invitation.eventAffiliateId, { transaction });
  if (!affiliate || affiliate.eventId !== event.id || (!inviter.isInternalAdmin && affiliate.userId !== inviter.id)) return false;
  try {
    const resolved = await resolveAffiliate(models, { event, code: affiliate.code, transaction, now });
    return resolved.eventAffiliate?.id === affiliate.id && resolved.guestlistAllocation > 0;
  } catch (error) {
    if (error.code === 'INVALID_AFFILIATE') return false;
    throw error;
  }
}

// Removal is permanent for outstanding links, even if access is granted again.
// Organization removal does not revoke a separate, event-scoped personal grant.
async function revokePendingGuestlistInvitations({ models, userId, organizationId, eventAffiliateId, directOnly = false, actorUserId, transaction }) {
  if (!transaction) throw new Error('Guestlist invitation revocation requires a transaction');
  // The model is optional only in narrow service-unit fixtures. Every migrated
  // application runtime has it; a missing fixture must not obscure its subject.
  if (!models.GuestlistInvitation?.sequelize?.query) return 0;
  const values = { userId, organizationId, eventAffiliateId };
  let scope;
  if (eventAffiliateId) scope = 'i.event_affiliate_id = :eventAffiliateId';
  else if (organizationId && userId) scope = `i.invited_by_user_id = :userId AND EXISTS
    (SELECT 1 FROM events e WHERE e.id = i.event_id AND e.organization_id = :organizationId)
    AND (i.event_affiliate_id IS NULL ${directOnly ? '' : `OR EXISTS (SELECT 1 FROM event_affiliates ea
      WHERE ea.id = i.event_affiliate_id AND ${accessScopeSql('ea')} = 'organization')`})`;
  else if (userId) scope = 'i.invited_by_user_id = :userId';
  else throw new Error('A bounded invitation revocation scope is required');
  const rows = await models.GuestlistInvitation.sequelize.query(`UPDATE guestlist_invitations i
    SET status = 'revoked', updated_at = NOW() WHERE i.status = 'pending' AND ${scope} RETURNING i.id`,
  { replacements: values, transaction, type: QueryTypes.SELECT });
  if (rows.length) await models.AuditLog.create({ actorUserId, organizationId: organizationId || null,
    entityType: eventAffiliateId ? 'EventAffiliate' : 'User', entityId: eventAffiliateId || userId,
    action: 'guestlist.invitations.revoked', after: { count: rows.length, reason: 'inviter_access_removed' } }, { transaction });
  return rows.length;
}

module.exports = { canClaimInvitation, revokePendingGuestlistInvitations };
