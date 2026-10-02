import { useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import './commissions.css';

export function CommissionDefaultRate({ organizationId, member, session, canEdit, request = api, onSaved }) {
  const [rate, setRate] = useState(String((member.defaultCommissionBps ?? member.configuredCommissionBps ?? 0) / 100));
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  if (!member.activeOrgAffiliate) return null;
  const eligible = member.commissionEligibility?.eligible === true;
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await request(`/business/organizations/${organizationId}/people/${member.id}/commission-settings`, session, { method: 'PATCH', body: JSON.stringify({ defaultCommissionBps: Math.round(Number(rate) * 100) }) }); setEditing(false); setNotice('Organization commission default saved for future orders. Event overrides retain their own terms.'); onSaved?.(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="commission-default-rate"><h3>Organization commission default</h3><p>{eligible ? `${(member.effectiveCommissionBps ?? member.defaultCommissionBps ?? 0) / 100}% effective on future eligible referrals.` : 'Effective rate is 0% until this individual’s Stripe account is verified.'}</p><p className="hint">The configured default is {(member.defaultCommissionBps ?? member.configuredCommissionBps ?? 0) / 100}%. Event-specific rates and order minimums continue to apply. Historical commissions stay recorded.</p>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{canEdit && (editing ? <form onSubmit={save}><label>Default commission percentage<input type="number" min="0" max="40" step="0.5" value={rate} disabled={busy || !eligible} onChange={event => setRate(event.target.value)} required /></label><div className="commission-actions"><Button type="submit" disabled={busy || (!eligible && Number(rate) !== 0) || Number(rate) < 0 || Number(rate) > 40}>{busy ? 'Saving default…' : 'Save organization default'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel default edit</Button></div></form> : <Button variant="outline" onClick={() => { setRate(eligible ? String((member.defaultCommissionBps ?? member.configuredCommissionBps ?? 0) / 100) : '0'); setEditing(true); }}>Edit organization commission default</Button>)}</section>;
}
