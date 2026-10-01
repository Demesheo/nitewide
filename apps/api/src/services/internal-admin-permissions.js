const INTERNAL_ADMIN_PERMISSIONS = Object.freeze({
  platform_owner: ['*'],
  support: ['directory.view', 'support.view', 'support.manage'],
  operations: ['directory.view', 'events.manage', 'support.view', 'reports.view'],
  read_only: ['directory.view', 'reports.view', 'support.view', 'audit.view'],
});
function internalAdminRole(user) { return user?.internalAdminRole || 'platform_owner'; }
function hasInternalPermission(user, permission) {
  if (!user?.isInternalAdmin || user.isActive === false || user.onboardingPending || (user.lifecycleState && user.lifecycleState !== 'active')) return false;
  const allowed = INTERNAL_ADMIN_PERMISSIONS[internalAdminRole(user)] || [];
  return allowed.includes('*') || allowed.includes(permission);
}
module.exports = { INTERNAL_ADMIN_PERMISSIONS, internalAdminRole, hasInternalPermission };
