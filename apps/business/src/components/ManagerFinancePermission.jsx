import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';

// This capability comes from the actor's owner membership, not the internal-admin flag.
export function ManagerFinancePermission({ organizationId, member, canGrantFinance, organizationVersion, session, onSaved, onRefresh, onUnauthorized, disabled = false }) {
  const [authorized, setAuthorized] = useState(Boolean(member.financeAuthorized));
  const [version, setVersion] = useState(organizationVersion);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setAuthorized(Boolean(member.financeAuthorized)); setVersion(organizationVersion); setStale(false); },
    [organizationId, member.id, member.financeAuthorized, organizationVersion]);
  useEffect(() => { setReason(''); setError(''); }, [organizationId, member.id]);
  if (!canGrantFinance || member.role !== 'Manager' || member.status !== 'active') return null;
  async function save() {
    if (busy || disabled || stale || !Number.isInteger(version) || reason.trim().length < 3) return;
    setBusy(true); setError('');
    try {
      const result = await api(`/business/organizations/${organizationId}/members/${member.id}/finance`, session,
        { method: 'PUT', body: JSON.stringify({ financeAuthorized: !authorized, reason: reason.trim(), version }) });
      setAuthorized(result.financeAuthorized); setVersion(result.version); setReason('');
      onSaved?.(result);
    } catch (err) {
      if (err.status === 401) onUnauthorized?.();
      else {
        setError(err.message);
        if (err.status === 409) { setStale(true); onRefresh?.(); }
      }
    } finally { setBusy(false); }
  }
  return <section className="team-role-editor team-role-editor-open" aria-label="Manager finance permission">
    <div><strong>Finance permission: {authorized ? 'Granted' : 'Not granted'}</strong>
      <p className="team-role-note">Separate from managing the team and events. This authorizes future payment-account and merchant refund controls when payments are integrated. Only owners can grant or revoke it here.</p>
      <small>Changing or removing this manager’s role clears their finance permission.</small></div>
    <label>Reason for finance change<Input value={reason} maxLength={500} disabled={busy || disabled} onChange={(event) => setReason(event.target.value)} placeholder="Explain this permission change"/></label>
    <div className="team-role-edit-actions"><Button type="button" variant="outline" disabled={busy || disabled || stale || !Number.isInteger(version) || reason.trim().length < 3} onClick={save}>
      {busy ? 'Saving…' : authorized ? 'Revoke finance permission' : 'Grant finance permission'}</Button>
      {stale && <Button type="button" variant="ghost" disabled={busy} onClick={() => onRefresh?.()}>Refresh team</Button>}</div>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
