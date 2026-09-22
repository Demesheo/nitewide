import { useEffect, useRef, useState } from "react";
import { Check, X, Users, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Choice, Empty, Field } from "./controls";
import { api } from "@/lib/api";
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { eventDateLabel } from '@/lib/business';
import { MultiSelect } from './MultiSelect';
import { guestlistEventName, guestlistStatuses, guestlistStatusesForEvent, guestlistStatusQuery, reviewableGuestlistEvents } from '@/lib/guestlists';

export function Guestlists({ events, session, expire }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const availableEvents = reviewableGuestlistEvents(events, currentTime);
  const hasReviewableEvent = events.some((event) => event.canReviewGuestlist ?? event.canManage);
  const [eventId, setEventId] = useState(availableEvents[0]?.id || "");
  const [statuses, setStatuses] = useState(['pending']);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const entryTriggerRef = useRef(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [sortKey, setSortKey] = useState('guestName');
  const [descending, setDescending] = useState(false);
  const selected = availableEvents.find((e) => e.id === eventId);
  const availableStatuses = guestlistStatusesForEvent(selected, currentTime);
  const pendingOnly = statuses.length === 1 && statuses[0] === 'pending';
  const activeEntry = entries.find((entry) => entry.id === activeEntryId);
  const sortedEntries = sortTableRows(entries.map((entry) => ({ ...entry, guestName: entry.user?.displayName || 'Guest', partyValue: entry.partySize, sourceValue: entry.source === 'affiliate' ? entry.eventAffiliate?.user?.displayName || 'Unknown referrer' : 'Direct', requestedValue: Date.parse(entry.createdAt) })), sortKey, descending);
  const pager = useTablePagination(sortedEntries, entries, `${eventId}:${statuses.join(',')}:${sortKey}:${descending}`);
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
    setEntries([]);
    setSettings(null);
    if (!eventId || !selected) return;
    setLoading(true);
    Promise.all([
      api(`/business/events/${eventId}/guestlist?${guestlistStatusQuery(statuses)}`, session),
      selected.canManage
        ? api(`/business/events/${eventId}/guestlist-settings`, session)
        : null,
    ])
      .then(([list, limits]) => {
        if (active) {
          setEntries(list);
          setSettings(limits);
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
    const value = new FormData(e.currentTarget).get("limit");
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
              ? { guestlistAllocation: value === "" ? null : Number(value) }
              : { guestlistCapacity: Number(value) },
          ),
        },
      );
      setNotice("Guestlist allocation updated.");
      setRevision((v) => v + 1);
    } catch (err) {
      if (err.status === 401) expire();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!availableEvents.length)
    return (
      <Empty title={hasReviewableEvent ? 'No recent or upcoming guestlists' : 'No guestlists assigned'}>
        {hasReviewableEvent ? 'Events appear here until 24 hours after they end. Future events are always available.' : 'Basic employees and promoters can review only requests they referred for a selected event.'}
      </Empty>
    );
  return (
    <>
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
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Close</Button></DialogClose>
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
        <MultiSelect label="Request status" options={availableStatuses} selected={statuses.filter((status) => availableStatuses.some((item) => item.id === status))} onChange={setStatuses} />
      </div>
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
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">GUEST EXPERIENCE</span>
            <h2>
              {pendingOnly
                ? "A good night starts with a yes."
                : "Your guestlist"}
            </h2>
            <p>
              Approvals respect the independent venue and referrer allocations.
            </p>
          </div>
          <Users size={22} />
        </div>
        {loading ? (
          <p className="loading" role="status">
            Loading requests…
          </p>
        ) : !entries.length ? (
          <Empty
            title={
              pendingOnly
                ? "You’re all caught up"
                : "No guests in this view"
            }
          >
            {pendingOnly
              ? "New requests will appear here, ready for your review."
              : "Choose another event or status."}
          </Empty>
        ) : (
          <><div className="table-wrap">
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
                    <td>
                      <button type="button" className="guestlist-guest-link" onClick={(event) => { entryTriggerRef.current = event.currentTarget; setError(''); setConfirmCancel(false); setActiveEntryId(entry.id); }}>{entry.user?.displayName || 'Guest'}</button>
                    </td>
                    <td>{entry.partySize} people</td>
                    <td>{entry.sourceValue}</td>
                    <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td><span className="status-pill">{guestlistStatuses.find((item) => item.id === entry.status)?.label || entry.status.replaceAll('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div><TablePagination pager={pager}/></>
        )}
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
                defaultValue={settings.direct.capacity}
                key={settings.direct.capacity}
              />
              <Button variant="outline" disabled={busy} type="submit">
                <Save />
                Save limit
              </Button>
              <small className="allocation-note-placeholder">
                Direct requests use this venue guestlist pool.
              </small>
            </form>
            {settings.promoters.map((p) => (
              <form
                className="allocation"
                key={`${p.id}-${p.guestlistAllocation}`}
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
                  defaultValue={p.guestlistAllocation ?? ""}
                  placeholder={`Inherit default (${p.effectiveGuestlistAllocation})`}
                />
                <Button variant="outline" disabled={busy} type="submit">
                  <Save />
                  Save allocation
                </Button>
                <small>Leave blank to inherit the organization default.</small>
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
