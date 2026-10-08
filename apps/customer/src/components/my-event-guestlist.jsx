import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, UsersRound } from 'lucide-react';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';
import { api } from '../lib/api';
import { myEventAccessLost, myEventGuestDate, myEventGuestPageQuery, myEventGuestlistStatuses, myEventGuestStatus, myEventOperationsClosed } from '../lib/my-event-actions';
import { MyEventInviteDialog } from './my-event-invite-dialog';
import { MyEventGuestDetail } from './my-event-guest-detail';

export function MyEventGuestlist({ session, detail, capabilities, onChanged, onUnauthorized, onClosed }) {
  const event = detail.event || detail.summary;
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState(null);
  const entryRef = useRef(null), inviteRef = useRef(null), panelRef = useRef(null), restoreEntry = useRef(false);
  const loadedRevision = useRef(-1);
  const callbacks = useRef({ onChanged, onUnauthorized, onClosed });
  callbacks.current = { onChanged, onUnauthorized, onClosed };
  const title = detail.scope === 'event' ? 'Event guestlist' : 'Your guestlist';
  const query = myEventGuestPageQuery({ page, search, statuses });

  function handleFailure(error, eventResource = false) {
    if (myEventAccessLost(error, eventResource)) { callbacks.current.onUnauthorized?.(error); return; }
    if (myEventOperationsClosed(error)) {
      callbacks.current.onClosed?.();
      Promise.resolve(callbacks.current.onChanged?.()).catch(() => {});
    }
  }
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.resolve().then(() => controller.signal.aborted ? undefined : api(`/customer/my-events/${event.id}/guestlist-page?${query}`, { token: session.accessToken, signal: controller.signal }))
      .then((data) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        loadedRevision.current = revision;
        setResult(data);
      })
      .catch((error) => { if (!controller.signal.aborted) { loadedRevision.current = revision; setError(error.message); handleFailure(error, true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [event.id, session.accessToken, query, revision]);
  useEffect(() => {
    if (restoreEntry.current && !selected && !loading && loadedRevision.current === revision) {
      const trigger = entryRef.current;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      else panelRef.current?.focus({ preventScroll: true });
      restoreEntry.current = false;
    }
  }, [selected, loading, result, error, revision]);

  async function changed(decision) {
    setRevision((value) => value + 1);
    setNotice(decision === 'approve' ? 'Request approved. Entry passes are ready.' : decision === 'reject' ? 'Request denied.' : decision === 'cancel' ? 'Approval revoked. Unused passes are invalid and the spots are available again.' : 'Invitation created. The guestlist is updated.');
    try { await callbacks.current.onChanged?.(); }
    catch (error) { setError(`Your change was saved. Event totals could not refresh: ${error.message || 'Try again.'}`); }
  }
  function refresh() { setRevision((value) => value + 1); Promise.resolve(callbacks.current.onChanged?.()).catch(() => {}); }
  function submitSearch(event) {
    event.preventDefault(); setSearch(draftSearch.trim()); setPage(1); setRevision((value) => value + 1);
  }
  function toggleStatus(id) { setStatuses((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setPage(1); }
  function changePage(next) {
    setPage(next);
    panelRef.current?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / (result?.pageSize || 10)));
  const rows = result?.items || [];
  const first = result?.total ? (page - 1) * result.pageSize + 1 : 0;
  const last = result ? Math.min(result.total, page * result.pageSize) : 0;

  return <section className="my-event-guestlist my-event-guestlist-panel" ref={panelRef} tabIndex={-1} aria-labelledby="my-event-guestlist-heading">
    <div className="my-event-guestlist-heading"><div><span className="my-event-action-eyebrow">GUEST EXPERIENCE</span><h2 id="my-event-guestlist-heading">{title}</h2><p>{detail.scope === 'event' ? 'Requests and invitations within your event permissions.' : 'Requests and invitations assigned to your own allocation.'}</p></div>{!capabilities.readOnly && capabilities.canInviteGuestlist && <Button ref={inviteRef} type="button" onClick={() => { setNotice(''); setInviting(true); }}><Plus aria-hidden="true" />Invite a guest</Button>}</div>
    {capabilities.readOnly && <p className="my-event-readonly-note">View guestlist history. Invitations, sharing and guestlist review are closed.</p>}
    <div className="my-event-guestlist-controls"><form className="my-event-guest-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="my-event-guest-search">Search guestlist</label><div className="my-event-guest-search-input"><Search size={18} aria-hidden="true" /><input id="my-event-guest-search" name="search" type="search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} maxLength={120} placeholder="Name, contact or referrer" /></div><Button type="submit" variant="outline" disabled={loading}>Search</Button></form><details className="my-event-status-filter"><summary>Request status <span>{statuses.length ? `${statuses.length} selected` : 'All'}</span><ChevronDown size={16} aria-hidden="true" /></summary><fieldset><legend className="sr-only">Filter guestlist statuses</legend>{myEventGuestlistStatuses.map(({ id, label }) => <label key={id}><input type="checkbox" checked={statuses.includes(id)} onChange={() => toggleStatus(id)} /><span>{label}</span></label>)}<Button type="button" variant="ghost" disabled={!statuses.length} onClick={() => { setStatuses([]); setPage(1); }}>Show all statuses</Button></fieldset></details></div>
    {notice && <p className="my-event-action-notice" role="status">{notice}</p>}
    {error && <div className="my-event-action-failure"><p className="my-event-action-error" role="alert">{error}</p><Button type="button" variant="outline" disabled={loading} onClick={() => { setRevision((value) => value + 1); Promise.resolve(callbacks.current.onChanged?.()).catch(() => {}); }}>Retry guestlist</Button></div>}
    <div className="my-event-guestlist-body" aria-busy={loading}>
      {loading && <div className="my-event-guestlist-loading"><LoadingIndicator>{result ? 'Updating guestlist…' : 'Loading guestlist…'}</LoadingIndicator></div>}
      {!loading && !error && !rows.length && <div className="my-event-guest-empty"><UsersRound size={28} aria-hidden="true" /><h3>{search || statuses.length ? 'No matching guests' : 'Your guestlist starts here'}</h3><p>{search || statuses.length ? 'Try another search or show all request statuses.' : capabilities.readOnly ? 'There are no guestlist entries for this event.' : 'Guestlist requests and invitations will appear here.'}</p>{(search || statuses.length > 0) && <Button type="button" variant="outline" onClick={() => { setDraftSearch(''); setSearch(''); setStatuses([]); setPage(1); }}>Clear filters</Button>}</div>}
      {rows.length > 0 && <div className="my-event-guest-grid">{rows.map((entry) => <article key={entry.id} className="my-event-guest-card"><div className="my-event-guest-card-heading"><h3>{entry.guestName || 'Guest'}</h3><span className="my-event-guest-status" data-status={entry.status}>{myEventGuestStatus(entry.status)}</span></div><p className="my-event-guest-contact">{entry.guestEmail || entry.guestPhone || 'No contact details on file'}</p><div className="my-event-guest-card-facts"><span><strong>{entry.partySize || 1}</strong> {(entry.partySize || 1) === 1 ? 'spot' : 'spots'}{Number(entry.checkedInSpots) > 0 && <small>{entry.checkedInSpots} admitted</small>}</span><span>{entry.source === 'affiliate' || entry.eventAffiliateId ? entry.referrerName || 'Unknown referrer' : 'Direct guestlist'}</span></div><div className="my-event-guest-card-footer"><time dateTime={entry.createdAt || undefined}>{myEventGuestDate(entry.createdAt)}</time><Button type="button" variant="outline" disabled={loading || Boolean(error)} aria-label={`Details for ${entry.guestName || 'Guest'}`} onClick={(event) => { entryRef.current = event.currentTarget; setSelected(entry); }}>Details</Button></div></article>)}</div>}
    </div>
    {result && !error && <div className="my-event-guest-pager" role="group" aria-label="Guestlist pagination"><span role="status">{first}–{last} of {result.total} {result.total === 1 ? 'guest' : 'guests'}</span><div><Button type="button" variant="outline" disabled={loading || page <= 1} onClick={() => changePage(page - 1)}><ChevronLeft aria-hidden="true" />Previous</Button><span>Page {page} of {totalPages}</span><Button type="button" variant="outline" disabled={loading || !result.hasMore} onClick={() => changePage(page + 1)}>Next<ChevronRight aria-hidden="true" /></Button></div></div>}
    {inviting && <MyEventInviteDialog session={session} detail={detail} capabilities={capabilities} returnRef={inviteRef} onClose={() => setInviting(false)} onChanged={changed} onRefresh={refresh} onFailure={handleFailure} />}
    {selected && <MyEventGuestDetail session={session} detail={detail} capabilities={capabilities} selected={selected} returnRef={entryRef} onClose={() => { restoreEntry.current = true; setSelected(null); }} onChanged={changed} onFailure={handleFailure} />}
  </section>;
}
