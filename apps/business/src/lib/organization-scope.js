export const OWNED_ORGANIZATIONS = 'owned';
export const allowsOwnedOrganizations = section => ['overview', 'analytics'].includes(section);
const organizationId = value => value === 'independent' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

export function requestedOrganization(location) {
  // Already-issued finance/team links identify a concrete destination. Promote
  // those links to the common scope instead of opening a different workspace.
  return location.paymentOrganization || location.teamOrganizationId ||
    (location.organizationIds.length === 1 ? location.organizationIds[0] : '') || location.workspaceOrganization;
}

export function resolveOrganizationScope(data, section, requested, lastOrganization) {
  const organizations = data?.organizations || [];
  const owners = organizations.filter(org => org.isOwner === true);
  const canViewOwnedOrganizations = data?.scope?.canViewOwnedOrganizations ?? owners.length > 0;
  const ids = organizations.map(org => org.id);
  if (data?.scope?.canCreateIndependent || data?.scope?.canViewIndependent) ids.push('independent');
  const last = ids.includes(lastOrganization) ? lastOrganization : ids[0] || '';
  const aggregate = requested === OWNED_ORGANIZATIONS && allowsOwnedOrganizations(section) && canViewOwnedOrganizations;
  const selection = aggregate ? OWNED_ORGANIZATIONS : ids.includes(requested) ? requested : last;
  return { selection, lastOrganization: aggregate ? last : selection, ownedOnly: aggregate,
    organizationIds: aggregate ? [] : selection ? [selection] : [],
    organizations: aggregate ? owners : organizations.filter(org => org.id === selection),
    owners, canViewOwnedOrganizations, ready: Boolean(data && selection) };
}

export const organizationPreferenceKey = userId => `nitewide.business.organization.${userId}`;
export function readOrganizationPreference(userId, storage) {
  try {
    const value = JSON.parse(storage.getItem(organizationPreferenceKey(userId)) || 'null');
    return { selection: value?.selection === OWNED_ORGANIZATIONS || organizationId(value?.selection) ? value.selection : '',
      lastOrganization: organizationId(value?.lastOrganization) ? value.lastOrganization : '' };
  } catch { return { selection: '', lastOrganization: '' }; }
}
