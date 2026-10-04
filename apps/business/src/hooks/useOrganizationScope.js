import { useEffect, useMemo, useState } from 'react';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { organizationPreferenceKey, readOrganizationPreference, requestedOrganization, resolveOrganizationScope } from '@/lib/organization-scope';

export function useOrganizationScope(data, userId, section) {
  const [location, setLocation] = useState(readWorkspaceLocation);
  const [preference, setPreference] = useState({ userId: null, selection: '', lastOrganization: '' });
  const saved = useMemo(() => {
    if (!userId) return { selection: '', lastOrganization: '' };
    if (preference.userId === userId) return preference;
    try { return readOrganizationPreference(userId, window.localStorage); }
    catch { return { selection: '', lastOrganization: '' }; }
  }, [userId, preference]);
  useEffect(() => {
    const restore = () => setLocation(readWorkspaceLocation());
    window.addEventListener('popstate', restore);
    window.addEventListener('nitewide:workspace-location', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('nitewide:workspace-location', restore); };
  }, []);
  const requested = requestedOrganization(location) || saved.selection;
  const scope = useMemo(() => resolveOrganizationScope(data, section, requested, saved.lastOrganization), [data, section, requested, saved.lastOrganization]);
  useEffect(() => {
    if (!scope.ready || !userId) return;
    const next = { selection: scope.selection, lastOrganization: scope.lastOrganization };
    try { window.localStorage.setItem(organizationPreferenceKey(userId), JSON.stringify(next)); } catch { /* URL remains usable when storage is blocked. */ }
    setPreference(previous => previous.userId === userId && previous.selection === next.selection && previous.lastOrganization === next.lastOrganization ? previous : { ...next, userId });
    writeWorkspaceLocation({ workspaceOrganization: scope.selection, organizationIds: [], teamOrganizationId: null, paymentOrganization: null }, { replace: true });
  }, [scope.ready, scope.selection, scope.lastOrganization, userId]);
  return { ...scope, forSection: (target, hint) => resolveOrganizationScope(data, target, hint || scope.selection, scope.lastOrganization).selection };
}
