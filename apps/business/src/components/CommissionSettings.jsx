import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import './commissions.css';

export function CommissionSettings({ session, organizationId, eventId, canEdit = true, request = api }) {
  const [data, setData] = useState(null), [value, setValue] = useState('10'), [inherit, setInherit] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const path = eventId ? `/business/events/${eventId}/commission-settings` : `/business/organizations/${organizationId}/commission-settings`;
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null);
    request(path, session, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setValue(String((result.minimumSubtotalCents ?? result.effectiveMinimumSubtotalCents) / 100)); setInherit(Boolean(eventId && result.minimumSubtotalCents === null)); } }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [path, session.accessToken, revision]);
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await request(path, session, { method: 'PATCH', body: JSON.stringify({ minimumSubtotalCents: inherit ? null : Math.round(Number(value) * 100) }) }); setData(result); setNotice('Commission minimum saved for future orders. Existing earnings retain their original terms.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="panel commission-settings" aria-busy={busy}><div><span className="eyebrow">FUTURE REFERRALS</span><h3>{eventId ? 'Event commission minimum' : 'Commission order minimum'}</h3><p>Commission applies only when the server verifies the order subtotal, referral rate and the individual’s Stripe account. A purchase must be at least $10 USD.</p></div>{error && <p role="alert" className="error">{error} <Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>Retry settings</Button></p>}{notice && <p role="status">{notice}</p>}{data && <form onSubmit={save}>{eventId && <label className="commission-checkbox"><input type="checkbox" checked={inherit} disabled={!canEdit || busy} onChange={event => setInherit(event.target.checked)} />Use organization minimum</label>}<label>Minimum order subtotal (USD)<input type="number" min="10" max="100000" step="0.01" required value={value} disabled={!canEdit || busy || inherit} onChange={event => setValue(event.target.value)} /></label><p className="hint">Organization and event commission rates continue to inherit existing per-person terms. Changes apply to future orders only.</p>{canEdit && <Button type="submit" disabled={busy || (!inherit && (!Number.isFinite(Number(value)) || Number(value) < 10))}>{busy ? 'Saving minimum…' : 'Save commission minimum'}</Button>}</form>}{!data && !error && <p role="status">Loading commission settings…</p>}</section>;
}
