import { useState } from 'react';
import { api } from '../lib/api';
import { Button } from '../../../business/src/components/ui/button';
import { Input } from '../../../business/src/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../business/src/components/ui/dialog';
import '../../../business/src/components/venue-workspace/venues.css';

const fields = [['name', 'Venue name', true, 180], ['addressLine1', 'Street address', true, 180], ['addressLine2', 'Address line 2 (optional)', false, 180], ['city', 'City', true, 100], ['region', 'State / region', false, 100], ['postalCode', 'Postal code', false, 24], ['countryCode', 'Country code', true, 2], ['timezone', 'Venue time zone', true, 64]];
const initialValues = (record) => ({ name: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: 'US', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, privacy: 'public', ...Object.fromEntries([...fields.map(([key]) => key), 'privacy'].map((key) => [key, record?.[key]]).filter(([, value]) => value != null)) });

export default function VenueForm({ businessId, businessVersion, record, onClose, onSaved, request = api, basePath = '/admin/businesses' }) {
  const [values, setValues] = useState(() => initialValues(record));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const venue = Object.fromEntries(Object.entries(values).filter(([key, value]) => (!record?.addressLocked || key === 'name') && (!record || value !== (record[key] ?? ''))));
    try {
      await request(`${basePath}/${businessId}/venues${record ? '/' + record.id : ''}`, { method: record ? 'PATCH' : 'POST', body: JSON.stringify(record ? { ...venue, reason, version: record.version } : { venue, reason, version: businessVersion }) });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="venue-dialog management-dialog">
    <DialogHeader><DialogTitle>{record ? 'Edit venue' : 'Create business venue'}</DialogTitle><DialogDescription>This venue belongs to this business. Its own staff access does not grant access to other venues or business finances.</DialogDescription></DialogHeader>
    <form onSubmit={submit}>{record?.addressLocked && <p className="notice">This venue has event history. You can rename it. To change its address, create a new venue and move upcoming events through the event editor so history and attendee notices are preserved.</p>}<div className="management-form">{fields.map(([key, title, required, maxLength]) => <label key={key} htmlFor={`venue-${key}`}>{title}<Input id={`venue-${key}`} value={values[key]} required={required} disabled={record?.addressLocked && key !== 'name'} maxLength={maxLength} onChange={(event) => setValues((prior) => ({ ...prior, [key]: key === 'countryCode' ? event.target.value.toUpperCase() : event.target.value }))}/></label>)}<label htmlFor="venue-privacy">Address visibility<select id="venue-privacy" value={values.privacy} disabled={record?.addressLocked} onChange={(event) => setValues((prior) => ({ ...prior, privacy: event.target.value }))}><option value="public">Public</option><option value="attendees_only">Attendees only</option><option value="private">Private</option></select></label></div>
      <label className="management-reason" htmlFor="venue-reason">Required audit reason<textarea id="venue-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      {error && <p className="error" role="alert">{error}</p>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : record ? 'Save venue changes' : 'Create venue'}</Button></div>
    </form>
  </DialogContent></Dialog>;
}

export function VenueLifecycleDialog({ venue, action, request = api, basePath = '/admin/businesses', onClose, onSaved }) {
  const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const title = `${action[0].toUpperCase()}${action.slice(1)} venue`;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request(`${basePath}/${venue.organizationId}/venues/${venue.id}/${action}`, { method: 'POST', body: JSON.stringify({ reason, version: venue.version }) }); onSaved(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="venue-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{venue.name}. Historical events, purchases and staff assignments are retained.</DialogDescription></DialogHeader><form onSubmit={submit}><p className="notice">Venue access changes do not cancel existing events. Event cancellation remains a separate action.</p><label htmlFor="venue-lifecycle-reason">Required audit reason<textarea id="venue-lifecycle-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label><label htmlFor="venue-lifecycle-confirm"><input id="venue-lifecycle-confirm" type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>I confirm this action for {venue.name}.</label>{error && <p className="error" role="alert">{error}</p>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !confirmed}>{busy ? 'Applying…' : title}</Button></div></form></DialogContent></Dialog>;
}
