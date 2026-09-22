export function workspaceAccess(data, user) {
  const canManage = Boolean(user?.isInternalAdmin || data?.organizations?.some((org) => org.canManage) || data?.events?.some((event) => event.canManage));
  return { canManage, ownOnly: Boolean(data) && !canManage };
}
