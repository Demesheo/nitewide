import { useEffect, useRef, useState } from "react";
import { Check, X, Save, UserPlus, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Choice, Empty, Field } from "./controls";
import { api } from "@/lib/api";
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { eventDateLabel } from '@/lib/business';
import { MultiSelect } from './MultiSelect';
import { guestlistEventName, guestlistStatuses, guestlistStatusesForEvent, guestlistStatusQuery, reviewableGuestlistEvents } from '@/lib/guestlists';
import { customerLink } from '@/lib/customer-link';
import { MobileTableSort } from './MobileTableSort';
import { LoadingState } from './LoadingState';
import { searchRows } from '@/lib/table-search';
import { allocationInputIsReadOnly, closeOtherAllocationEditors, focusAllocationInput, normalizeAllocationInput } from '@/lib/guestlist-allocation';

const guestColumns = [['guestName', 'Guest'], ['partyValue', 'Party'], ['sourceValue', 'Source'], ['requestedValue', 'Requested'], ['status', 'Status']].map(([key, label]) => ({ key, label }));

export function Guestlists({ events, session, expire, initialEventId = null, initialEntryId = null }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const availableEvents = reviewableGuestlistEvents(events, currentTime);
  const hasReviewableEvent = events.some((event) => event.canReviewGuestlist ?? event.canManage);
  const [eventId, setEventId] = useState(initialEventId || availableEvents[0]?.id || "");
  const [statuses, setStatuses] = useState(initialEntryId ? [] : ['pending']);
  const [entries, setEntries] = useState([]);
  const [loadedEventId, setLoadedEventId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editingAllocationKey, setEditingAllocationKey] = useState(null);
  const [invitePools, setInvitePools] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [referralUrl, setReferralUrl] = useState('');
  const [referralCopyMessage, setReferralCopyMessage] = useState('');
  const [inviteContact, setInviteContact] = useState('email');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const entryTriggerRef = useRef(null);
  const entriesEventRef = useRef(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [sortKey, setSortKey] = useState('guestName');
  const [descending, setDescending] = useState(false);
  const [search, setSearch] = useState('');
  const selected = availableEvents.find((e) => e.id === eventId);
  const availableStatuses = guestlistStatusesForEvent(selected, currentTime);
  const pendingOnly = statuses.length === 1 && statuses[0] === 'pending';
  const activeEntry = entries.find((entry) => entry.id === activeEntryId);
  useEffect(() => {
    let active = true;
    setReferralUrl('');
    setReferralCopyMessage('');
    if (!eventId || !selected) return () => { active = false; };
    api(`/business/events/${eventId}/referral-link`, session)
      .then((link) => {
        if (!active) return;
        const url = new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href);
        url.searchParams.set('event', eventId);
        url.searchParams.set('ref', link.code);
        setReferralUrl(url.toString());
      })
      .catch(() => { if (active) setReferralUrl(''); });
    return () => { active = false; };
  }, [eventId, selected, session]);
  useEffect(() => { if (initialEntryId && entries.some((entry) => entry.id === initialEntryId)) setActiveEntryId(initialEntryId); }, [initialEntryId, entries]);
  const searchableEntries = entries.map((entry) => ({ ...entry, guestName: entry.user?.displayName || 'Guest', guestEmail: entry.user?.email || entry.email || '', guestPhone: entry.user?.phone || '', partyValue: entry.partySize, sourceValue: entry.source === 'affiliate' ? entry.eventAffiliate?.user?.displayName || 'Unknown referrer' : 'Direct', requestedValue: Date.parse(entry.createdAt) }));
  const visibleEntries = searchRows(searchableEntries, search, ['guestName', 'guestEmail', 'guestPhone', 'sourceValue', 'status']);
  const sortedEntries = sortTableRows(visibleEntries, sortKey, descending);
  const pager = useTablePagination(sortedEntries, entries, `${eventId}:${statuses.join(',')}:${sortKey}:${descending}:${search}`);
  const head = (label, key) => <th scope="col"><button type="button" className="analytics-sort" onClick={() => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key === 'partyValue' || key === 'requestedValue'); } }}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected) setEventId(availableEvents[0]?.id || "");
  }, [events, currentTime, selected]);
  useEffect(() => {
    const allowed = new Set(availableStatuses.map((item) => item.id));
    setStatuses((current) => current.every((status) => allowed.has(status)) ? current : current.filter((status) => allowed.has(status)));
  }, [selected?.startsAt, currentTime]);
  useEffect(() => {
    let active = true;
    setError("");
    if (entriesEventRef.current !== eventId) {
      entriesEventRef.current = eventId;
      setEntries([]);
      setLoadedEventId(null);
      setSettings(null);
      setInvitePools(null);
    }
    if (!eventId || !selected) return;
    setLoading(true);
    Promise.all([
      api(`/business/events/${eventId}/guestlist?${guestlistStatusQuery(statuses)}`, session),
      selected.canManage
        ? api(`/business/events/${eventId}/guestlist-settings`, session)
        : null,
      api(`/business/events/${eventId}/guestlist-invite-pools`, session),
    ])
      .then(([list, limits, pools]) => {
        if (active) {
          setEntries(list);
          setLoadedEventId(eventId);
          setSettings(limits);
          setInvitePools(pools);
        }
      })
      .catch((e) => {
        if (active) {
          if (e.status === 401) expire();
          else setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, statuses, revision, session, selected?.canManage]);
  async function decide(id, decision) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/business/events/${eventId}/guestlist/${id}/decision`,
        session,
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      setNotice(
        decision === "approve"
          ? "Request approved. Admission credential created."
          : decision === 'cancel' ? 'Approval cancelled. The guestlist space is available again.' : "Request declined.",
      );
      setActiveEntryId(null);
      setConfirmCancel(false);
      setRevision((v) => v + 1);
    } catch (e) {
      if (e.status === 401) expire();
      else setError(e.message);
    } finally {
      setBusy(false);
    }
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
    } catch (err) {
      if (err.status === 401) expire();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function sendInvite(e) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const selectedPool = values.get('pool');
    setBusy(true); setError(''); setInviteResult(null);
    try {
      const result = await api(`/business/events/${eventId}/guestlist-invitations`, session, { method: 'POST', body: JSON.stringify({
        pool: selectedPool === 'direct' ? 'direct' : 'own',
        ...(selectedPool === 'direct' ? {} : { eventAffiliateId: selectedPool }),
        ...(inviteContact === 'email' ? { email: values.get('email') } : { phone: values.get('phone') }),
        partySize: Number(values.get('partySize')),
      }) });
      if (result.token) {
        const url = new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href);
        url.searchParams.set('guestlistInvite', result.token);
        setInviteResult({ status: 'pending', link: url.toString() });
      } else {
        setInviteResult({ status: 'confirmed' });
        setStatuses(['confirmed']);
      }
      setRevision((value) => value + 1);
    } catch (err) { if (err.status === 401) expire(); else setError(err.message); }
    finally { setBusy(false); }
  }
  async function copyReferralUrl() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setReferralCopyMessage('Referral link copied.');
    } catch {
      setReferralCopyMessage('Could not copy automatically. Select and copy the link above.');
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
  if (!availableEvents.length)
    return (
      <Empty title={hasReviewableEvent ? 'No recent or upcoming guestlists' : 'No guestlists assigned'}>
        {hasReviewableEvent ? 'Events appear here until 24 hours after they end. Future events are always available.' : 'Basic employees and promoters can review only requests they referred for a selected event.'}
      </Empty>
    );
  return (
    <>
      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!busy) { setInviteOpen(open); if (!open) setInviteResult(null); } }}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Invite to guestlist</DialogTitle><DialogDescription>Existing customers are confirmed now if space is available. New customers use a private link; space is checked when they sign up or claim it. No email or text is sent yet.</DialogDescription></DialogHeader>
          {inviteResult?.status === 'confirmed' ? <p role="status">This customer is confirmed on the guestlist. They can see the update in their Nitewide notifications.</p> : inviteResult?.link ? <div className="space-y-3"><p role="status">Invitation ready. Share this private link with the guest. It expires in 7 days and does not reserve a place.</p><Input readOnly aria-label="Guestlist invitation link" value={inviteResult.link}/><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(inviteResult.link)}>Copy link</Button></div> : <form className="space-y-4" onSubmit={sendInvite}>
            <label className="block text-sm">Guestlist pool<select name="pool" className="mt-1 block w-full rounded-md border border-border bg-secondary p-2" required>{invitePools?.direct && <option value="direct">Venue direct guestlist</option>}{invitePools?.own.map((pool) => <option key={pool.id} value={pool.id}>My allocation{pool.guestlistAllocation != null ? ` · ${pool.guestlistAllocation} places` : ''}</option>)}</select></label>
            <label className="block text-sm">Invite by<select value={inviteContact} onChange={(e) => setInviteContact(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-secondary p-2"><option value="email">Email</option><option value="phone">Phone</option></select></label>
            {inviteContact === 'email' ? <Field id="invite-email" name="email" label="Email address" type="email" required/> : <Field id="invite-phone" name="phone" label="Phone number" type="tel" placeholder="+14075551212" required/>}
            <Field id="invite-party" name="partySize" label="People" type="number" min="1" max="20" defaultValue="1" required/>
            {error && <p role="alert" className="error">{error}</p>}
            <div className="guestlist-invitation-actions"><Button disabled={busy || !invitePools?.direct && !invitePools?.own.length} type="submit">{busy ? 'Checking…' : 'Create invitation'}</Button></div>
          </form>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(activeEntry)} onOpenChange={(open) => { if (!open) { setActiveEntryId(null); setConfirmCancel(false); setError(''); } }}>
        {activeEntry && <DialogContent className="guestlist-detail-dialog sm:max-w-xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); entryTriggerRef.current?.focus(); }}>
          <DialogHeader>
            <span className="eyebrow">GUESTLIST REQUEST</span>
            <DialogTitle>{activeEntry.user?.displayName || 'Guest'}</DialogTitle>
            <DialogDescription>{activeEntry.user?.email || 'No email on file'}</DialogDescription>
          </DialogHeader>
          <dl className="guestlist-detail-grid">
            <div><dt>Status</dt><dd>{guestlistStatuses.find((item) => item.id === activeEntry.status)?.label || activeEntry.status}</dd></div>
            <div><dt>Party size</dt><dd>{activeEntry.partySize} {activeEntry.partySize === 1 ? 'person' : 'people'}</dd></div>
            <div><dt>Event</dt><dd>{selected?.title || 'Event'} · {selected ? eventDateLabel(selected) : '—'}</dd></div>
            <div><dt>Source</dt><dd>{activeEntry.source === 'affiliate' ? `Referred by ${activeEntry.eventAffiliate?.user?.displayName || 'Unknown referrer'}` : 'Direct'}</dd></div>
            {activeEntry.user?.phone && <div><dt>Phone</dt><dd>{activeEntry.user.phone}</dd></div>}
            {activeEntry.eventAffiliate?.code && <div><dt>Referral code</dt><dd>{activeEntry.eventAffiliate.code}</dd></div>}
            <div><dt>Requested</dt><dd>{new Date(activeEntry.createdAt).toLocaleString()}</dd></div>
            {activeEntry.reviewedAt && <div><dt>Reviewed</dt><dd>{new Date(activeEntry.reviewedAt).toLocaleString()}</dd></div>}
            {activeEntry.reviewer?.displayName && <div><dt>Reviewed by</dt><dd>{activeEntry.reviewer.displayName}</dd></div>}
            {activeEntry.reviewNote && <div><dt>Review note</dt><dd>{activeEntry.reviewNote}</dd></div>}
            {activeEntry.checkedInAt && <div><dt>Checked in</dt><dd>{new Date(activeEntry.checkedInAt).toLocaleString()}</dd></div>}
            <div><dt>Request ID</dt><dd className="guestlist-request-id">{activeEntry.id}</dd></div>
          </dl>
          {error && <p className="error" role="alert">{error}</p>}
          {confirmCancel && <p className="guestlist-cancel-warning">Cancelling invalidates this guest’s entry credential and releases {activeEntry.partySize} {activeEntry.partySize === 1 ? 'place' : 'places'} from the {activeEntry.source === 'affiliate' ? 'referrer' : 'venue'} guestlist.</p>}
          <DialogFooter className="guestlist-detail-actions">
            <DialogClose asChild><Button className="guestlist-dialog-close" variant="outline" disabled={busy}>Close</Button></DialogClose>
            {activeEntry.status === 'pending' && <>
              <Button variant="outline" disabled={busy} onClick={() => decide(activeEntry.id, 'reject')}><X /> Decline</Button>
              <Button disabled={busy} onClick={() => decide(activeEntry.id, 'approve')}><Check /> Approve</Button>
            </>}
            {activeEntry.status === 'confirmed' && (confirmCancel
              ? <><Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep approval</Button><Button variant="destructive" disabled={busy} onClick={() => decide(activeEntry.id, 'cancel')}>Confirm cancellation</Button></>
              : <Button variant="destructive" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel approval</Button>)}
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <div className="toolbar">
        <Choice
          label="Guestlist event"
          title={selected?.title}
          value={eventId}
          onChange={(v) => {
            setEventId(v);
            setNotice("");
          }}
          options={availableEvents.map((e) => [e.id, `${guestlistEventName(e.title)} · ${eventDateLabel(e)}`, e.title])}
        />
        {selected?.status === 'published' && invitePools?.open && (invitePools.direct || invitePools.own.length > 0) && <Button className="guestlist-invite-button" type="button" onClick={() => { setInviteResult(null); setInviteOpen(true); }}><UserPlus size={16}/> Invite guest</Button>}
      </div>
      {referralUrl && <section className="panel guestlist-referral-card"><div className="guestlist-referral-copy"><div><span className="eyebrow">SHARE THIS EVENT</span><h3>Your referral link</h3><p>Purchases and guestlist requests made through this link are attributed to you for this event.</p></div><Input readOnly aria-label="Your event referral link" value={referralUrl} onFocus={(event) => event.target.select()} /></div><Button type="button" variant="outline" onClick={copyReferralUrl}>{referralCopyMessage === 'Referral link copied.' ? 'Copied' : 'Copy link'}</Button>{referralCopyMessage && <p className="guestlist-referral-status" role="status">{referralCopyMessage}</p>}</section>}
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
      <section className="panel guest-experience-panel">
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
                  {head('Party', 'partyValue')}
                  {head('Source', 'sourceValue')}
                  {head('Requested', 'requestedValue')}
                  {head('Status', 'status')}
                </tr>
              </thead>
              <tbody>
                {pager.rows.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Guest">
                      <button type="button" className="guestlist-guest-link" onClick={(event) => { entryTriggerRef.current = event.currentTarget; setError(''); setConfirmCancel(false); setActiveEntryId(entry.id); }}>{entry.user?.displayName || 'Guest'}</button>
                    </td>
                    <td data-label="Party">{entry.partySize} people</td>
                    <td data-label="Source">{entry.sourceValue}</td>
                    <td data-label="Requested">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td data-label="Status"><span className="status-pill">{guestlistStatuses.find((item) => item.id === entry.status)?.label || entry.status.replaceAll('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div> : <div className="guest-experience-state"><Empty title="No matching guests">Try a different name, contact, source, or status.</Empty></div>}
          <TablePagination pager={pager}/></>
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
                readOnly={allocationInputIsReadOnly(editingAllocationKey, 'direct')}
                className={allocationInputIsReadOnly(editingAllocationKey, 'direct') ? '' : 'allocation-input-active'}
                defaultValue={settings.direct.capacity}
                key={settings.direct.capacity}
              />
              <details className="allocation-editor" onToggle={(event) => toggleAllocationEditor(event, 'direct')}>
                <summary className="allocation-edit-button"><Pencil />Edit limit</summary>
                <div className="allocation-actions"><Button variant="outline" disabled={busy} type="button" onClick={cancelAllocationEdit}>Cancel</Button><Button disabled={busy} type="submit"><Save />Save</Button></div>
              </details>
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
                  readOnly={allocationInputIsReadOnly(editingAllocationKey, p.id)}
                  className={allocationInputIsReadOnly(editingAllocationKey, p.id) ? '' : 'allocation-input-active'}
                  defaultValue={p.guestlistAllocation ?? ""}
                  placeholder={`Inherit default (${p.effectiveGuestlistAllocation})`}
                  key={`${p.guestlistAllocation ?? 'inherit'}-${p.effectiveGuestlistAllocation}`}
                />
                <details className="allocation-editor" onToggle={(event) => toggleAllocationEditor(event, p.id)}>
                  <summary className="allocation-edit-button"><Pencil />Edit allocation</summary>
                  <div className="allocation-actions"><Button variant="outline" disabled={busy} type="button" onClick={cancelAllocationEdit}>Cancel</Button><Button disabled={busy} type="submit"><Save />Save</Button></div>
                </details>
                <small>Leave blank to inherit the organization default.</small>
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
