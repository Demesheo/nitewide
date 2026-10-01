export function workspaceAccess(data, user) {
  const canManage = Boolean(user?.isInternalAdmin || data?.scope?.canCreateIndependent || data?.organizations?.some((org) => org.canManage || org.canCreateEvents) || data?.events?.some((event) => event.canManage));
  return { canManage, ownOnly: Boolean(data) && !canManage };
}
