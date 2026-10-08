import { useEffect, useRef, useState } from "react";
import { Check, X, Save, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, Field } from "./controls";
import { api } from "@/lib/api";
import { guestlistInvitationLink } from '@/lib/guestlist-invitation-link';
import { usePagedResource } from '@/hooks/usePagedResource';
import { ServerPager } from './ServerPager';
import { eventDateLabel } from '@/lib/business';
import { MultiSelect } from './MultiSelect';
import { compactGuestlistSourceName, guestlistStatuses, guestlistStatusesForEvent } from '@/lib/guestlists';
import { MobileTableSort } from './MobileTableSort';
import { LoadingState } from './LoadingState';
import { allocationInputIsReadOnly, closeOtherAllocationEditors, focusAllocationInput, normalizeAllocationInput } from '@/lib/guestlist-allocation';
import { GuestlistApprovalQuantity } from './GuestlistApprovalQuantity';
import { ManualCopyLink, useClipboardCopy, usePrefetchedLink } from '../../../shared/clipboard-copy.jsx';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';

const guestColumns = [['guestName', 'Guest'], ['partyValue', 'Spots'], ['sourceValue', 'Source'], ['requestedValue', 'Request'], ['status', 'Status']].map(([key, label]) => ({ key, label }));

export function Guestlists({ event, session, expire, initialEntryId = null, refreshToken = 0, onChanged }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const eventId = event.id;
  const [statuses, setStatuses] = useState(initialEntryId ? [] : ['pending']);
  const [entries, setEntries] = useState([]);
  const [loadedEventId, setLoadedEventId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editingAllocationKey, setEditingAllocationKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState(null);
  const { copy, manualLink } = useClipboardCopy(`${eventId}:${activeEntryId ?? ''}:${session.accessToken}`);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [approvalDraft, setApprovalDraft] = useState(null);
  const decisionPendingRef = useRef(false);
  const entryTriggerRef = useRef(null);
  const initialEntryHandledRef = useRef(false);
  const entriesEventRef = useRef(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyingId, setCopyingId] = useState(null);
  const [copiedEntryId, setCopiedEntryId] = useState(null);
  useEffect(() => setCopiedEntryId(null), [activeEntryId, eventId]);
  const [revision, setRevision] = useState(0);
  const [sortKey, setSortKey] = useState('guestName');
  const [descending, setDescending] = useState(false);
  const [search, setSearch] = useState('');
  const selected = event;
  const canEditAllocations = selected?.canEdit !== false;
  const availableStatuses = guestlistStatusesForEvent(selected, currentTime);
  const pendingOnly = statuses.length === 1 && statuses[0] === 'pending';
  const [linkedEntry, setLinkedEntry] = useState(null);
  const activeEntry = entries.find((entry) => entry.id === activeEntryId) || (linkedEntry?.id === activeEntryId ? linkedEntry : null);
  const canCopy = entry => entry?.hasInvitation && ['confirmed', 'checked_in'].includes(entry.status);
  const invitation = usePrefetchedLink(`${eventId}:${activeEntryId}:${session.accessToken}:${activeEntry?.status}:${revision}:${refreshToken}`, Boolean(canCopy(activeEntry)), async signal => {
    const { token } = await api(`/business/events/${eventId}/guestlist/${activeEntryId}/invitation-link`, session, { signal });
    if (typeof token !== 'string' || !token) throw new Error('The invitation link is unavailable. Please try again.');
    return guestlistInvitationLink(token);
  }, err => { if (err.status === 401) expire(); });
  const canReviewEntry = selected.canReviewGuestlist !== false;
  const approvalDraftKey = activeEntry ? `${eventId}:${activeEntry.id}:${activeEntry.status}:${activeEntry.partySize}:${activeEntry.reviewedAt || ''}` : null;
  const approvalPartySize = approvalDraft?.key === approvalDraftKey ? approvalDraft.value : Math.min(20, Math.max(1, Number(activeEntry?.partySize) || 1));
  useEffect(() => {
    if (!initialEntryHandledRef.current && initialEntryId && entries.some((entry) => entry.id === initialEntryId)) {
      initialEntryHandledRef.current = true;
      setActiveEntryId(initialEntryId);
    }
  }, [initialEntryId, entries]);
  const searchableEntries = entries.map((entry) => ({ ...entry, guestName: entry.user?.displayName || 'Guest', guestEmail: entry.user?.email || entry.email || '', guestPhone: entry.user?.phone || '', partyValue: entry.partySize, sourceValue: entry.source === 'affiliate' ? entry.eventAffiliate?.user?.displayName || 'Unknown referrer' : 'Direct', requestedValue: Date.parse(entry.createdAt) }));
  const visibleEntries = searchableEntries;
  const pager = { rows: searchableEntries };
  const panelRef = useRef(null);
  const params = new URLSearchParams({ search, sortKey, descending: String(descending) });
  statuses.forEach((status) => params.append('statuses', status));
  const list = usePagedResource('/business/events/' + eventId + '/guestlist-page?' + params, session, { onUnauthorized: expire, refreshToken: revision + ':' + refreshToken, pageSize: 10 });
  const pools = usePagedResource(selected.canManage ? '/business/events/' + eventId + '/guestlist-settings-page' : null, session, { onUnauthorized: expire, refreshToken: revision + ':' + refreshToken, pageSize: 10 });
  const adapt = (row) => ({ ...row, user: { displayName: row.guestName, email: row.guestEmail, phone: row.guestPhone }, reviewer: row.reviewerName ? { displayName: row.reviewerName } : null, eventAffiliate: row.eventAffiliateId ? { user: { displayName: row.referrerName } } : null });
  useEffect(() => { setLoading(list.loading); if (list.result) { setEntries(list.result.items.map(adapt)); setLoadedEventId(eventId); } if (list.error) setError(list.error); }, [list.result, list.loading, list.error, eventId]);
  useEffect(() => { if (pools.result) setSettings({ ...pools.result, promoters: pools.result.promoters.items.map((row) => ({ ...row, user: { displayName: row.name } })) }); if (pools.error) setError(pools.error); }, [pools.result, pools.error]);
  useEffect(() => { if (!initialEntryId) return; const controller = new AbortController();
    api('/business/events/' + eventId + '/guestlist-page/' + initialEntryId, session, { signal: controller.signal }).then((row) => { setLinkedEntry(adapt(row)); setActiveEntryId(row.id); }).catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [eventId, initialEntryId, session]);
  const head = (label, key) => <th scope="col"><button type="button" className="analytics-sort" onClick={() => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key === 'partyValue' || key === 'requestedValue'); } }}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const allowed = new Set(availableStatuses.map((item) => item.id));
    setStatuses((current) => current.every((status) => allowed.has(status)) ? current : current.filter((status) => allowed.has(status)));
  }, [selected?.startsAt, currentTime]);
  async function decide(id, decision) {
    if (busy || decisionPendingRef.current || !canReviewEntry || activeEntry?.id !== id) return;
    const partySize = activeEntry.status === 'pending' ? approvalPartySize : activeEntry.partySize;
    decisionPendingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/business/events/${eventId}/guestlist/${id}/decision`,
        session,
        { method: "POST", body: JSON.stringify({ decision, ...(decision === 'approve' && activeEntry.status === 'pending' ? { partySize } : {}) }) },
      );
      setNotice(
        decision === "approve"
          ? `Request approved for ${partySize} ${partySize === 1 ? 'spot' : 'spots'}. Admission credential created.`
          : decision === 'cancel' ? 'Approval revoked. The guestlist space is available again.' : "Request declined.",
      );
      setActiveEntryId(null);
      setConfirmCancel(false);
      setConfirmDecline(false);
      setApprovalDraft(null);
      setRevision((v) => v + 1);
      onChanged?.();
    } catch (e) {
      if (e.status === 401) expire();
      else setError(e.message);
    } finally {
      decisionPendingRef.current = false;
      setBusy(false);
    }
  }
  async function copyInvitation(entry) {
    if (copyingId || !canCopy(entry) || !invitation.link) return;
    setCopyingId(entry.id); setError(''); setNotice('');
    try {
      await copy(invitation.link);
      setCopiedEntryId(entry.id);
      setNotice('Link copied. Share it privately with the guest.');
    } catch (err) {
      if (err.status === 401) expire();
      else setError(err.message || 'Could not copy the link. Please try again.');
    } finally { setCopyingId(null); }
  }
  async function saveLimit(e, promoter) {
    e.preventDefault();
    const form = e.currentTarget;
    const value = new FormData(form).get("limit");
    setBusy(true);
    setError("");
    try {
      await api(
        `/business/events/${eventId}/${promoter ? `affiliates/${promoter.id}/guestlist-allocation` : "guestlist-capacity"}`,
        session,
        {
          method: "PATCH",
          body: JSON.stringify(
            promoter
              ? { guestlistAllocation: normalizeAllocationInput(value) }
              : { guestlistCapacity: Number(value) },
          ),
        },
      );
      setNotice("Guestlist allocation updated.");
      form.querySelector('.allocation-editor')?.removeAttribute('open');
      setEditingAllocationKey(null);
      setRevision((v) => v + 1);
      onChanged?.();
    } catch (err) {
      if (err.status === 401) expire();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function cancelAllocationEdit(event) {
    event.currentTarget.form?.reset();
    const editor = event.currentTarget.closest('details');
    if (editor) editor.open = false;
    setEditingAllocationKey(null);
  }
  function toggleAllocationEditor(event, key) {
    const editor = event.currentTarget;
    if (!editor.open) {
      setEditingAllocationKey((current) => String(current ?? '') === String(key) ? null : current);
      return;
    }
    closeOtherAllocationEditors(editor.closest('.allocation-grid'), editor);
    setEditingAllocationKey(String(key));
    focusAllocationInput(editor.closest('form')?.querySelector('input[name="limit"]'));
  }
  return (
    <>
      <Dialog open={Boolean(activeEntry)} onOpenChange={(open) => { if (!open && !busy && !decisionPendingRef.current) { setActiveEntryId(null); setConfirmCancel(false); setConfirmDecline(false); setApprovalDraft(null); setError(''); } }}>
        {activeEntry && <DialogContent className="team-member-dialog guestlist-detail-dialog sm:max-w-xl max-h-[90vh] overflow-y-auto" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy || decisionPendingRef.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy || decisionPendingRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); entryTriggerRef.current?.focus(); }}>
          <DialogHeader>
            <span className="eyebrow">GUESTLIST REQUEST</span>
            <DialogTitle>{activeEntry.user?.displayName || 'Guest'}</DialogTitle>
            <DialogDescription>{activeEntry.user?.email || 'No email on file'}</DialogDescription>
            <p className="guestlist-detail-event"><strong>{selected?.title || 'Event'}</strong><span>{selected ? eventDateLabel(selected) : '—'}</span></p>
          </DialogHeader>
          <dl className="guestlist-detail-grid">
            <div><dt>Status</dt><dd><span className="status-pill guestlist-status" data-guestlist-status={activeEntry.status}>{guestlistStatuses.find((item) => item.id === activeEntry.status)?.label || activeEntry.status}</span></dd></div>
            <div><dt>{activeEntry.status === 'pending' ? 'Requested spots' : 'Spots'}</dt><dd>{activeEntry.partySize}{activeEntry.checkedInSpots > 0 ? ` · ${activeEntry.checkedInSpots} admitted` : ''}</dd></div>
            <div><dt>Source</dt><dd>{activeEntry.source === 'affiliate' ? `Referred by ${activeEntry.eventAffiliate?.user?.displayName || 'Unknown referrer'}` : 'Direct'}</dd></div>
            {activeEntry.user?.phone && <div><dt>Phone</dt><dd>{activeEntry.user.phone}</dd></div>}
            <div><dt>Requested</dt><dd>{new Date(activeEntry.createdAt).toLocaleString()}</dd></div>
            {activeEntry.reviewedAt && <div><dt>Reviewed</dt><dd>{new Date(activeEntry.reviewedAt).toLocaleString()}</dd></div>}
            {activeEntry.reviewer?.displayName && <div><dt>Reviewed by</dt><dd>{activeEntry.reviewer.displayName}</dd></div>}
            {activeEntry.reviewNote && <div><dt>Review note</dt><dd>{activeEntry.reviewNote}</dd></div>}
            {activeEntry.checkedInAt && <div><dt>Checked in</dt><dd>{new Date(activeEntry.checkedInAt).toLocaleString()}</dd></div>}
          </dl>
          {activeEntry.status === 'pending' && canReviewEntry && <div className="guestlist-approval-row"><div className="guestlist-approval-label">Approved spots<small>{approvalPartySize} {approvalPartySize === 1 ? 'entry pass' : 'entry passes'} on approval</small></div><GuestlistApprovalQuantity value={approvalPartySize} disabled={busy || confirmDecline} onChange={(value) => setApprovalDraft({ key: approvalDraftKey, value })}/></div>}
          {error && <p className="error" role="alert">{error}</p>}
          {invitation.error && <p className="error" role="alert">{invitation.error}</p>}
          <ManualCopyLink link={canCopy(activeEntry) && invitation.link ? manualLink : ''}/>
          {confirmDecline && <p className="guestlist-cancel-warning">Decline this guestlist request? The guest will be notified and no entry credential will be issued.</p>}
          {confirmCancel && <p className="guestlist-cancel-warning">Revoking approval invalidates this guest’s entry credential and releases {activeEntry.partySize} {activeEntry.partySize === 1 ? 'place' : 'places'} from the {activeEntry.source === 'affiliate' ? 'referrer' : 'venue'} guestlist. You can approve this request again later if space is available.</p>}
          <DialogFooter className={`guestlist-detail-actions${canCopy(activeEntry) && !confirmCancel ? ' guest-detail-copy-actions' : ''}`}>
            {canReviewEntry && <>
            {activeEntry.status === 'pending' && (confirmDecline
              ? <><Button variant="outline" disabled={busy} onClick={() => setConfirmDecline(false)}>Keep request</Button><Button variant="destructive" disabled={busy} onClick={() => decide(activeEntry.id, 'reject')}>Confirm decline</Button></>
              : <><Button variant="outline" disabled={busy} onClick={() => setConfirmDecline(true)}><X /> Decline</Button><Button disabled={busy} onClick={() => decide(activeEntry.id, 'approve')}><Check /> Approve</Button></>)}
            {activeEntry.status === 'rejected' && <Button disabled={busy} onClick={() => decide(activeEntry.id, 'approve')}><Check /> Approve</Button>}
            {activeEntry.status === 'confirmed' && !activeEntry.checkedInAt && !(activeEntry.checkedInSpots > 0) && (confirmCancel
              ? <><Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep approval</Button><Button variant="destructive" disabled={busy} onClick={() => decide(activeEntry.id, 'cancel')}>Confirm revocation</Button></>
              : <Button variant="destructive" disabled={busy} onClick={() => setConfirmCancel(true)}>Revoke approval</Button>)}
            </>}
            {canCopy(activeEntry) && !confirmCancel && (invitation.error ? <Button className="clipboard-copy-button" variant="outline" disabled={busy} onClick={invitation.retry}>Retry loading invitation link</Button> : <CopyLinkButton component={Button} className="clipboard-copy-button" disabled={busy || Boolean(copyingId) || !invitation.link} onClick={() => copyInvitation(activeEntry)} copied={copiedEntryId === activeEntry.id} copying={copyingId === activeEntry.id || invitation.loading} loadingLabel={invitation.loading ? 'Preparing link…' : 'Copying…'}/>)}
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section ref={panelRef} className="panel guest-experience-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">GUEST EXPERIENCE</span>
            <h2>Your guestlist</h2>
            <p>
              Approvals respect the independent venue and referrer allocations.
            </p>
          </div>
          <div className="guest-experience-filters">
            <MultiSelect label="Request status" options={availableStatuses} selected={statuses.filter((status) => availableStatuses.some((item) => item.id === status))} onChange={setStatuses} />
          </div>
        </div>
        <div className="guest-experience-content" aria-busy={loading}>
          <MobileTableSort columns={guestColumns} value={sortKey} descending={descending} onChange={(key) => { setSortKey(key); setDescending(['partyValue', 'requestedValue'].includes(key)); }} onToggle={() => setDescending(!descending)}/>
          <div className="table-search"><div className="search-field"><Search size={16} aria-hidden="true"/><Input aria-label="Search guestlist" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/></div></div>
          {loading && loadedEventId === eventId && <LoadingState className="guest-experience-refresh">Updating requests…</LoadingState>}
          {loading && loadedEventId !== eventId ? (
            <LoadingState className="guest-experience-state">Loading requests…</LoadingState>
          ) : !entries.length ? (
            <div className="guest-experience-state"><Empty
              title={
                pendingOnly
                  ? "You’re all caught up"
                  : "No guests in this view"
              }
            >
              {pendingOnly
                ? "New requests will appear here, ready for your review."
                : "Choose another event or status."}
            </Empty></div>
          ) : (
          <>{visibleEntries.length ? <div className="guestlist-table-surface"><div className="table-wrap responsive-event-table">
            <table>
              <thead>
                <tr>
                  {head('Guest', 'guestName')}
                  {head('Spots', 'partyValue')}
                  {head('Source', 'sourceValue')}
                  {head('Request', 'requestedValue')}
                  {head('Status', 'status')}
                </tr>
              </thead>
              <tbody>
                {pager.rows.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Guest">
                      <button type="button" className="guestlist-guest-link" onClick={(event) => { if (busy || decisionPendingRef.current) return; entryTriggerRef.current = event.currentTarget; setError(''); setConfirmCancel(false); setConfirmDecline(false); setApprovalDraft(null); setActiveEntryId(entry.id); }}>{entry.user?.displayName || 'Guest'}</button>
                      <span className="guestlist-mobile-status status-pill guestlist-status" data-guestlist-status={entry.status}>{guestlistStatuses.find((item) => item.id === entry.status)?.label || entry.status.replaceAll('_', ' ')}</span>
                    </td>
                    <td data-label="Spots">{entry.partySize}{entry.checkedInSpots > 0 && <small className="block">{entry.checkedInSpots} admitted</small>}</td>
                    <td data-label="Source"><span className="guestlist-source-full">{entry.sourceValue}</span><span className="guestlist-source-compact">{compactGuestlistSourceName(entry.sourceValue)}</span></td>
                    <td data-label="Request">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td data-label="Status"><span className="status-pill guestlist-status" data-guestlist-status={entry.status}>{guestlistStatuses.find((item) => item.id === entry.status)?.label || entry.status.replaceAll('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div> : <div className="guest-experience-state"><Empty title="No matching guests">Try a different name, contact, source, or status.</Empty></div>}
          <ServerPager result={list.result} page={list.page} onPageChange={list.setPage} disabled={list.loading} label="requests" targetRef={panelRef}/></>
          )}
        </div>
      </section>
      {settings && !loading && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CAPACITY CONTROL</span>
              <h2>Separate pools. Clear limits.</h2>
              <p>
                Each referrer allocation is additional to the direct
                guestlist—not deducted from it. Counts are people, including
                party members.
              </p>
            </div>
          </div>
          <div className="allocation-grid">
            <form onSubmit={(e) => saveLimit(e)} className="allocation">
              <h3>Venue guestlist</h3>
              <p>
                {settings.direct.used} approved / {settings.direct.capacity}{" "}
                available total
              </p>
              <Field
                id="direct-limit"
                name="limit"
                type="number"
                label="Direct limit"
                min={settings.direct.used}
                required
                readOnly={!canEditAllocations || allocationInputIsReadOnly(editingAllocationKey, 'direct')}
                className={allocationInputIsReadOnly(editingAllocationKey, 'direct') ? '' : 'allocation-input-active'}
                defaultValue={settings.direct.capacity}
                key={settings.direct.capacity}
              />
              {canEditAllocations && <details className="allocation-editor" onToggle={(event) => toggleAllocationEditor(event, 'direct')}>
                <summary className="allocation-edit-button"><Pencil />Edit limit</summary>
                <div className="allocation-actions"><Button variant="outline" disabled={busy} type="button" onClick={cancelAllocationEdit}>Cancel</Button><Button disabled={busy} type="submit"><Save />Save</Button></div>
              </details>}
              <small>Direct requests use this venue guestlist pool.</small>
            </form>
            {settings.promoters.map((p) => (
              <form
                className="allocation"
                key={p.id}
                onSubmit={(e) => saveLimit(e, p)}
              >
                <h3>{p.user?.displayName || p.code}</h3>
                <p>
                  {p.used} approved / {p.effectiveGuestlistAllocation} allocated
                  · {p.status}
                </p>
                <Field
                  id={`allocation-${p.id}`}
                  name="limit"
                  type="number"
                  label="Event allocation"
                  min={p.used}
                  readOnly={!canEditAllocations || allocationInputIsReadOnly(editingAllocationKey, p.id)}
                  className={allocationInputIsReadOnly(editingAllocationKey, p.id) ? '' : 'allocation-input-active'}
                  defaultValue={p.guestlistAllocation ?? ""}
                  placeholder={`Inherit default (${p.effectiveGuestlistAllocation})`}
                  key={`${p.guestlistAllocation ?? 'inherit'}-${p.effectiveGuestlistAllocation}`}
                />
                {canEditAllocations && <details className="allocation-editor" onToggle={(event) => toggleAllocationEditor(event, p.id)}>
                  <summary className="allocation-edit-button"><Pencil />Edit allocation</summary>
                  <div className="allocation-actions"><Button variant="outline" disabled={busy} type="button" onClick={cancelAllocationEdit}>Cancel</Button><Button disabled={busy} type="submit"><Save />Save</Button></div>
                </details>}
                <small>Leave blank to inherit the organization default.</small>
              </form>
            ))}
          </div>
          <ServerPager result={pools.result?.promoters} page={pools.page} onPageChange={pools.setPage} disabled={pools.loading} label="promoters"/>
        </section>
      )}
    </>
  );
}
