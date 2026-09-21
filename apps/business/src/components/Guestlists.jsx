import { useEffect, useState } from "react";
import { Check, X, Users, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Choice, Empty, Field } from "./controls";
import { api } from "@/lib/api";
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';

export function Guestlists({ events, session, expire }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [status, setStatus] = useState("pending");
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [sortKey, setSortKey] = useState('guestName');
  const [descending, setDescending] = useState(false);
  const selected = events.find((e) => e.id === eventId);
  const sortedEntries = sortTableRows(entries.map((entry) => ({ ...entry, guestName: entry.user?.displayName || 'Guest', partyValue: entry.partySize, sourceValue: entry.eventAffiliate?.code || 'Direct guestlist', requestedValue: Date.parse(entry.createdAt) })), sortKey, descending);
  const pager = useTablePagination(sortedEntries, entries, `${eventId}:${status}:${sortKey}:${descending}`);
  const head = (label, key) => <th scope="col"><button type="button" className="analytics-sort" onClick={() => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key === 'partyValue' || key === 'requestedValue'); } }}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
  useEffect(() => {
    if (!selected) setEventId(events[0]?.id || "");
  }, [events, selected]);
  useEffect(() => {
    let active = true;
    setError("");
    setEntries([]);
    setSettings(null);
    if (!eventId || !selected) return;
    setLoading(true);
    Promise.all([
      api(`/business/events/${eventId}/guestlist?status=${status}`, session),
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
  }, [eventId, status, revision, session, selected?.canManage]);
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
          : "Request declined.",
      );
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
  if (!events.length)
    return (
      <Empty title="Your guestlists start here">
        Create an event to start accepting requests.
      </Empty>
    );
  return (
    <>
      <div className="toolbar">
        <Choice
          label="Guestlist event"
          value={eventId}
          onChange={(v) => {
            setEventId(v);
            setNotice("");
          }}
          options={events.map((e) => [e.id, e.title])}
        />
        <Choice
          label="Request status"
          value={status}
          onChange={setStatus}
          options={[
            ["pending", "Awaiting approval"],
            ["confirmed", "Approved"],
            ["rejected", "Declined"],
            ["checked_in", "Checked in"],
          ]}
        />
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
              {status === "pending"
                ? "A good night starts with a yes."
                : "Your guestlist"}
            </h2>
            <p>
              Approvals respect the independent venue and promoter allocations.
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
              status === "pending"
                ? "You’re all caught up"
                : "No guests in this view"
            }
          >
            {status === "pending"
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
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pager.rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.user?.displayName || "Guest"}</strong>
                      <small>{entry.user?.email}</small>
                    </td>
                    <td>{entry.partySize} people</td>
                    <td>{entry.eventAffiliate?.code || "Direct guestlist"}</td>
                    <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td>
                      {status === "pending" ? (
                        <div className="row-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            aria-label={`Decline ${entry.user?.displayName || "guest"}`}
                            onClick={() => decide(entry.id, "reject")}
                          >
                            <X />
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            aria-label={`Approve ${entry.user?.displayName || "guest"}`}
                            onClick={() => decide(entry.id, "approve")}
                          >
                            <Check />
                            Approve
                          </Button>
                        </div>
                      ) : (
                        <span className="status-pill">
                          {entry.status.replace("_", " ")}
                        </span>
                      )}
                    </td>
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
                Each promoter allocation is additional to the direct
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
