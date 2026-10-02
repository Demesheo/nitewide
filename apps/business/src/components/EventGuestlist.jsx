import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { usePagedResource } from '@/hooks/usePagedResource';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { LoadingState } from './LoadingState';
import { ServerPager } from './ServerPager';
import { Empty } from './controls';
import { GuestlistApprovalQuantity } from './GuestlistApprovalQuantity';

const statuses = ['all', 'pending', 'confirmed', 'rejected', 'checked_in', 'no_show'];
const decisionLabel = { approve: 'Approve', reject: 'Decline', cancel: 'Revoke approval' };

export function EventGuestlist({ event, session, onUnauthorized, onChanged, refreshToken = 0, initialEntryId = null }) {
  const panel = useRef(null);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const decisionPendingRef = useRef(false);
  const [approvalDraft, setApprovalDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [allocation, setAllocation] = useState(null);
  const entries = usePagedResource(`/business/events/${event.id}/guestlist-page?status=${status}&search=${encodeURIComponent(search)}`,
    session, { onUnauthorized, refreshToken: `${refreshToken}:${revision}` });
  const settings = usePagedResource(event.canManage ? `/business/events/${event.id}/guestlist-settings-page` : null,
    session, { onUnauthorized, refreshToken: `${refreshToken}:${revision}` });
  const rows = entries.result?.items || [];
  const selectedEntry = rows.find((row) => row.id === selected?.id) || selected;
  const canReviewEntry = event.canReviewGuestlist !== false;
  const approvalDraftKey = selectedEntry ? `${event.id}:${selectedEntry.id}:${selectedEntry.status}:${selectedEntry.partySize}:${selectedEntry.reviewedAt || ''}` : null;
  const approvalPartySize = approvalDraft?.key === approvalDraftKey ? approvalDraft.value : Math.min(20, Math.max(1, Number(selectedEntry?.partySize) || 1));
  function openReview(row, nextDecision) {
    if (busy || decisionPendingRef.current) return;
    setSelected(row); setDecision(nextDecision); setApprovalDraft(null); setError('');
  }
  useEffect(() => {
    if (!initialEntryId) return;
    const controller = new AbortController();
    api(`/business/events/${event.id}/guestlist-page/${initialEntryId}`, session, { signal: controller.signal })
      .then((row) => { setStatus('all'); openReview(row, null); })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [event.id, initialEntryId, session]);
  async function decide() {
    if (!selectedEntry || !decision || busy || decisionPendingRef.current || !canReviewEntry) return;
    const partySize = selectedEntry.status === 'pending' ? approvalPartySize : selectedEntry.partySize;
    decisionPendingRef.current = true;
    setBusy(true); setError('');
    try {
      await api(`/business/events/${event.id}/guestlist/${selectedEntry.id}/decision`, session,
        { method: 'POST', body: JSON.stringify({ decision, ...(decision === 'approve' && selectedEntry.status === 'pending' ? { partySize } : {}) }) });
      setNotice(decision === 'approve' ? `Guest approved for ${partySize} ${partySize === 1 ? 'spot' : 'spots'}.` : decision === 'cancel' ? 'Approval revoked.' : 'Request declined.');
      setSelected(null); setDecision(null); setApprovalDraft(null); setRevision((value) => value + 1); onChanged?.();
    } catch (err) { if (err.status === 401) onUnauthorized(); else setError(err.message); }
    finally { decisionPendingRef.current = false; setBusy(false); }
  }
  async function saveAllocation() {
    if (!allocation) return;
    setBusy(true); setError('');
    try {
      const isDirect = allocation.kind === 'direct';
      const value = allocation.value === '' ? null : Number(allocation.value);
      await api(isDirect ? `/business/events/${event.id}/guestlist-capacity`
        : `/business/events/${event.id}/affiliates/${allocation.id}/guestlist-allocation`, session,
      { method: 'PATCH', body: JSON.stringify(isDirect ? { guestlistCapacity: value } : { guestlistAllocation: value }) });
      setNotice('Guestlist allocation updated.'); setAllocation(null); setRevision((r) => r + 1); onChanged?.();
    } catch (err) { if (err.status === 401) onUnauthorized(); else setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="event-guestlist-content">
    {notice && <p className="notice" role="status">{notice}</p>}
    <section ref={panel} className="panel"><div className="section-heading"><div><h3>Guestlist requests</h3><p>Review requests in your authorized allocation.</p></div></div>
      <div className="event-filters"><label className="field"><span>Status</span><select aria-label="Guestlist status" value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><div className="search-field"><Search size={16}/><Input aria-label="Search guestlist" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest or email"/></div></div>
      {entries.loading && <LoadingState>Loading guestlist…</LoadingState>}
      {entries.error && <div className="error" role="alert">{entries.error}<Button variant="outline" onClick={entries.retry}>Try again</Button></div>}
      {rows.length ? <div className="table-wrap responsive-event-table"><table><thead><tr><th scope="col">Guest</th><th scope="col">Spots</th><th scope="col">Source</th><th scope="col">Requested</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="Guest">{row.guestName}<small>{row.guestEmail}</small></td><td data-label="Spots">{row.partySize}</td><td data-label="Source">{row.referrerName || 'Direct'}</td><td data-label="Requested">{new Date(row.createdAt).toLocaleString()}</td><td data-label="Status">{row.status.replaceAll('_', ' ')}</td><td data-label="Action">{row.status === 'pending' && canReviewEntry ? <><Button size="sm" disabled={busy} onClick={() => openReview(row, 'approve')}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => openReview(row, 'reject')}>Decline</Button></> : row.status === 'confirmed' && !row.checkedInAt && !(row.checkedInSpots > 0) && canReviewEntry && event.canManage && event.status === 'published' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => openReview(row, 'cancel')}>Revoke</Button> : null}</td></tr>)}</tbody></table></div> : !entries.loading && !entries.error && <Empty title="No requests found">Choose another status or search.</Empty>}
      <ServerPager result={entries.result} page={entries.page} onPageChange={entries.setPage} disabled={entries.loading} label="requests" targetRef={panel}/>
    </section>
    {event.canManage && <section className="panel"><div className="section-heading"><div><h3>Guestlist allocations</h3><p>Direct and promoter pools stay separate.</p></div></div>
      {settings.loading && <LoadingState>Loading allocations…</LoadingState>}
      {settings.error && <div className="error" role="alert">{settings.error}<Button variant="outline" onClick={settings.retry}>Try again</Button></div>}
      {settings.result && <><div className="allocation-row"><strong>Direct pool</strong><span>{settings.result.direct.used} approved / {settings.result.direct.capacity} places</span>{event.canEdit && <Button variant="outline" onClick={() => setAllocation({ kind: 'direct', value: String(settings.result.direct.capacity), min: settings.result.direct.used })}>Edit</Button>}</div>
        {settings.result.promoters.items.map((person) => <div className="allocation-row" key={person.id}><strong>{person.name}</strong><span>{person.used} approved / {person.effectiveGuestlistAllocation} places</span>{event.canEdit && <Button variant="outline" onClick={() => setAllocation({ kind: 'promoter', id: person.id, name: person.name, value: person.guestlistAllocation == null ? '' : String(person.guestlistAllocation), min: person.used })}>Edit</Button>}</div>)}
        <ServerPager result={settings.result.promoters} page={settings.page} onPageChange={settings.setPage} disabled={settings.loading} label="promoters"/>
      </>}
    </section>}
    <Dialog open={Boolean(selectedEntry)} onOpenChange={(open) => { if (!open && !busy && !decisionPendingRef.current) { setSelected(null); setDecision(null); setApprovalDraft(null); setError(''); } }}><DialogContent showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy || decisionPendingRef.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy || decisionPendingRef.current) event.preventDefault(); }}><DialogHeader><DialogTitle>{decision ? `${decisionLabel[decision]} guestlist request?` : 'Guestlist request'}</DialogTitle><DialogDescription>{selectedEntry?.guestName} · {selectedEntry?.partySize} {selectedEntry?.status === 'pending' ? 'requested places' : 'places'} · {selectedEntry?.status.replaceAll('_', ' ')}.</DialogDescription></DialogHeader>{selectedEntry && <p>{selectedEntry.guestEmail} · {selectedEntry.referrerName || 'Direct pool'}</p>}{selectedEntry?.status === 'pending' && canReviewEntry && decision !== 'reject' && <div className="guestlist-approval-row"><div className="guestlist-approval-label">Approved spots<small>{approvalPartySize} {approvalPartySize === 1 ? 'entry pass' : 'entry passes'} on approval</small></div><GuestlistApprovalQuantity value={approvalPartySize} disabled={busy} onChange={(value) => setApprovalDraft({ key: approvalDraftKey, value })}/></div>}{error && <p className="error" role="alert">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => { if (decisionPendingRef.current) return; setSelected(null); setDecision(null); setApprovalDraft(null); setError(''); }}>{decision ? 'Keep as is' : 'Close'}</Button>{canReviewEntry && (decision ? <Button disabled={busy} onClick={decide}>{busy ? 'Saving…' : decisionLabel[decision]}</Button> : selectedEntry?.status === 'pending' ? <><Button disabled={busy} onClick={() => setDecision('approve')}>Approve</Button><Button variant="outline" disabled={busy} onClick={() => setDecision('reject')}>Decline</Button></> : null)}</DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(allocation)} onOpenChange={(open) => { if (!open && !busy) setAllocation(null); }}><DialogContent><DialogHeader><DialogTitle>Edit {allocation?.kind === 'direct' ? 'direct pool' : allocation?.name}</DialogTitle><DialogDescription>Approved places cannot exceed the new limit. Blank promoter allocation inherits its organization default.</DialogDescription></DialogHeader><label className="field"><span>Places</span><Input type="number" min={allocation?.min || 0} value={allocation?.value ?? ''} onChange={(e) => setAllocation((current) => ({ ...current, value: e.target.value }))}/></label>{error && <p className="error" role="alert">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAllocation(null)}>Cancel</Button><Button disabled={busy || (allocation?.kind === 'direct' && allocation?.value === '') || (allocation?.value !== '' && Number(allocation?.value) < Number(allocation?.min || 0))} onClick={saveAllocation}>Save allocation</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
