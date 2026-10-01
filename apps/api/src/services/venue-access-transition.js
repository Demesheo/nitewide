const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');

async function revokeVenueInvitationLinks({ models, grant, actorUserId, transaction, allPools = true }) {
  await revokePendingGuestlistInvitations({ models, organizationId: grant.organizationId, locationId: grant.locationId,
    userId: grant.userId, actorUserId, directOnly: true, transaction });
  if (!allPools) return;
  const assignments = await models.EventAffiliate.findAll({ where: { venueAccessId: grant.id, accessScope: 'venue' }, transaction });
  for (const assignment of assignments) await revokePendingGuestlistInvitations({ models, eventAffiliateId: assignment.id, userId: grant.userId, actorUserId, transaction });
}
async function revokeOrganizationVenueAccess({ models, organizationId, userId, actorUserId, transaction }) {
  if (!models.VenueAccess) return;
  const grants = await models.VenueAccess.findAll({ where: { organizationId, userId, status: 'active' },
    transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']] });
  for (const grant of grants) {
    const before = grant.toJSON();
    await grant.update({ status: 'inactive' }, { transaction });
    await revokeVenueInvitationLinks({ models, grant, actorUserId, transaction });
    await models.AuditLog.create({ actorUserId, organizationId, entityType: 'VenueAccess', entityId: grant.id,
      action: 'venue.access.revoked_by_business_removal', before, after: grant.toJSON() }, { transaction });
  }
}
module.exports = { revokeVenueInvitationLinks, revokeOrganizationVenueAccess };
