const permissions = {
  platform_owner: ['*'],
  support: ['directory.view', 'support.view', 'support.manage'],
  operations: ['directory.view', 'events.manage', 'support.view', 'reports.view'],
  read_only: ['directory.view', 'reports.view', 'support.view', 'audit.view'],
};
export function hasAdminPermission(user, permission) {
  if (!user?.isInternalAdmin || user.isActive === false || user.onboardingPending || (user.lifecycleState && user.lifecycleState !== 'active')) return false;
  const allowed = permissions[user.internalAdminRole || 'platform_owner'] || [];
  return allowed.includes('*') || allowed.includes(permission);
}
