import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { usePagedResource } from '@/hooks/usePagedResource';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ServerPager } from './ServerPager';
import { LoadingState } from './LoadingState';

const labels = { pending: 'Pending', processing: 'Processing', acceptedByProvider: 'Accepted by provider',
  delivered: 'Delivered', bounced: 'Bounced', complained: 'Complaint', suppressed: 'Suppressed', failed: 'Failed', expired: 'Expired' };

export function EventInstructions({ event, session, capabilities, onUnauthorized, onQueued }) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [preview, setPreview] = useState(null);
  const [sendKey, setSendKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const history = usePagedResource(`/business/events/${event.id}/instructions/history`, session,
    { onUnauthorized, refreshToken: revision, pageSize: 10 });
  const configured = Boolean(capabilities?.instructions);
  function change(value) { setInstructions(value); setPreview(null); setSendKey(null); setError(''); }
  async function review() {
    setBusy(true); setError('');
    try {
      const result = await api(`/business/events/${event.id}/instructions/preview`, session,
        { method: 'POST', body: JSON.stringify({ instructions }) });
      setPreview(result); setSendKey(crypto.randomUUID());
    } catch (err) { if (err.status === 401) onUnauthorized(); else setError(err.message); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!sendKey || !preview) return;
    setBusy(true); setError('');
    try {
      const result = await api(`/business/events/${event.id}/instructions`, session,
        { method: 'POST', body: JSON.stringify({ instructions, idempotencyKey: sendKey }) });
      setOpen(false); setInstructions(''); setPreview(null); setSendKey(null);
      setRevision((value) => value + 1);
      onQueued?.(`Instructions queued for ${result.queued} ${result.queued === 1 ? 'attendee' : 'attendees'}.`);
    } catch (err) { if (err.status === 401) onUnauthorized(); else setError(err.message); }
    finally { setBusy(false); }
  }
  return <><div className="event-update-action">{event.canEdit && event.status === 'published' && <Button variant="outline" disabled={!configured} onClick={() => setOpen(true)}><Mail size={16}/> Send attendee instructions</Button>}</div>
    <details className="event-instruction-history"><summary>Instruction delivery history</summary><div className="panel">
      {!configured && <p role="status">Email delivery is not configured for this workspace.</p>}
      <p className="hint">{capabilities?.deliveryTrackingConfigured ? 'Verified delivery events appear after the provider reports them.' : 'Delivery tracking is not configured. Provider acceptance does not confirm delivery.'}</p>
      {history.loading && <LoadingState>Loading delivery history…</LoadingState>}
      {history.error && <div className="error" role="alert">{history.error}<Button variant="outline" onClick={history.retry}>Try again</Button></div>}
      {history.result?.items.length ? <div className="instruction-history">{history.result.items.map((batch) => <div key={batch.id} className="instruction-history-row"><strong>{new Date(batch.createdAt).toLocaleString()}</strong><span>{batch.audienceCount} recipients</span><span>{Object.entries(batch.statusCounts).filter(([, count]) => count > 0).map(([key, count]) => `${count} ${labels[key]}`).join(' · ') || 'No queued messages'}</span></div>)}</div> : !history.loading && !history.error && <p>No instruction batches yet.</p>}
      <ServerPager result={history.result} page={history.page} onPageChange={history.setPage} disabled={history.loading} label="batches"/>
    </div></details>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent className="event-instructions-dialog"><DialogHeader><DialogTitle>Send attendee instructions</DialogTitle><DialogDescription>Everyone with a paid order or active guestlist entry is eligible. Sending cannot be recalled.</DialogDescription></DialogHeader>
      <label className="field"><span>Instructions</span><textarea value={instructions} onChange={(event) => change(event.target.value)} minLength={3} maxLength={1800} rows={5} placeholder="Arrival time, entrance, dress code, or other event-specific details"/></label>
      {preview && <div className="instruction-preview" role="status"><strong>{preview.audienceCount} eligible recipients</strong><p>{preview.messagePreview.subject}</p><p>{preview.messagePreview.body}</p><small>{preview.messagePreview.note}</small></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>{preview ? <Button disabled={busy || preview.delivery !== 'configured'} onClick={confirm}>{busy ? 'Queueing…' : `Confirm and queue ${preview.audienceCount} emails`}</Button> : <Button disabled={busy || instructions.trim().length < 3} onClick={review}>{busy ? 'Checking…' : 'Preview audience'}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  </>;
}
