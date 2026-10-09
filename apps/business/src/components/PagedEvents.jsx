import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { money, eventDateLabel } from '@/lib/business';
import { eventPhase } from '@/lib/events';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Field, Empty } from './controls';
import { LoadingState } from './LoadingState';
import { PagedEventDetail } from './PagedEventDetail';
import { EventTable } from './EventTable';
import { ServerPager } from './ServerPager';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { workspaceScrollY, scrollWorkspaceTo } from '@/lib/workspace-scroll';

function listQuery({ page, pageSize, view, search, from, to, sort, organizationIds, venueIds }) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: view, sort });
  if (search.trim()) params.set('search', search.trim());
  if (from) params.set('from', `${from}T00:00:00.000Z`);
  if (to) { const through = new Date(`${to}T00:00:00.000Z`); through.setUTCDate(through.getUTCDate() + 1); params.set('to', through.toISOString()); }
  organizationIds.forEach((id) => params.append('organizationIds', id));
  venueIds.forEach((id) => params.append('venueIds', id));
  return params.toString();
}

function savedEventScrollY() {
  const value = window.history.state?.eventsScrollY;
  if (value == null || value === '') return null;
  const offset = Number(value);
  return Number.isFinite(offset) && offset >= 0 ? offset : null;
}

export function PagedEvents({ session, onEdit, onDuplicate, onCreate, onUnauthorized, ownOnly = false,
  initialEventId = null, initialTab = null, initialGuestlistEntryId = null,
  organizationIds = [], venueIds = [], revision = 0, onSelectionChange, onOrganizationResolved, capabilities }) {
  const collectionRef = useRef(null);
  const returnScroll = useRef(savedEventScrollY());
  const [initialLocation] = useState(readWorkspaceLocation);
  const didMount = useRef(false);
  const [selectedId, setSelectedId] = useState(initialEventId);
  const [view, setView] = useState(initialLocation.eventView);
  const [search, setSearch] = useState(initialLocation.eventSearch);
  const [settledSearch, setSettledSearch] = useState(initialLocation.eventSearch);
  const [from, setFrom] = useState(initialLocation.eventFrom);
  const [to, setTo] = useState(initialLocation.eventTo);
  const [sort, setSort] = useState(initialLocation.eventSort);
  const [page, setPage] = useState(initialLocation.eventPage);
  const [pageSize, setPageSize] = useState(initialLocation.eventPageSize);
  const [now, setNow] = useState(Date.now);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { const timer = setTimeout(() => setSettledSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    setPage(1); writeWorkspaceLocation({ eventPage: 1 }, { replace: true });
  }, [view, settledSearch, from, to, sort, pageSize, organizationIds, venueIds]);
  useEffect(() => {
    if (selectedId) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/business/events?${listQuery({ page, pageSize, view, search: settledSearch, from, to, sort, organizationIds, venueIds })}`, session, { signal: controller.signal })
      .then(setResult)
      .catch((err) => { if (err.name === 'AbortError') return; if (err.status === 401) onUnauthorized(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, page, pageSize, view, settledSearch, from, to, sort, organizationIds, venueIds, revision, retry, selectedId, onUnauthorized, now]);
  useEffect(() => {
    if (selectedId || !result || returnScroll.current == null) return;
    const y = returnScroll.current;
    returnScroll.current = null;
    const frame = requestAnimationFrame(() => scrollWorkspaceTo({ top: y, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, result]);
  function choose(id) {
    returnScroll.current = workspaceScrollY();
    window.history.replaceState({ ...window.history.state, eventsScrollY: returnScroll.current }, '', window.location.href);
    setSelectedId(id); onSelectionChange?.(id);
  }
  function back() {
    setSelectedId(null); onSelectionChange?.(null);
    window.history.replaceState({ ...window.history.state, eventsScrollY: returnScroll.current }, '', window.location.href);
  }
  if (selectedId) return <PagedEventDetail key={selectedId} organizationId={organizationIds[0]} onOrganizationResolved={onOrganizationResolved} eventId={selectedId} session={session} capabilities={capabilities} refreshToken={revision} initialTab={selectedId === initialEventId ? initialTab : null} initialGuestlistEntryId={selectedId === initialEventId ? initialGuestlistEntryId : null} onBack={back} onEdit={onEdit} onDuplicate={onDuplicate} onUnauthorized={onUnauthorized} onTabChange={(tab) => writeWorkspaceLocation({ tab })}/>;
  const rows = (result?.items || []).map((event) => ({ ...event, name: event.title, phase: eventPhase(event, now), date: Date.parse(event.startsAt), venue: event.location?.name || 'Independent event', salesCents: event.lifetimeSales?.salesCents || 0, paidOrders: event.lifetimeSales?.paidOrders || 0 }));
  const counts = result?.counts || { upcoming: 0, past: 0, draft: 0 };
  const goPage = (next) => { setPage(next); writeWorkspaceLocation({ eventPage: next }); };
  const chooseView = (next) => { setView(next); writeWorkspaceLocation({ eventView: next, eventPage: 1 }); };
  const chooseSearch = (next) => { setSearch(next); writeWorkspaceLocation({ eventSearch: next, eventPage: 1 }, { replace: true }); };
  const chooseFrom = (next) => { setFrom(next); writeWorkspaceLocation({ eventFrom: next, eventPage: 1 }); };
  const chooseTo = (next) => { setTo(next); writeWorkspaceLocation({ eventTo: next, eventPage: 1 }); };
  const chooseSort = (next) => { setSort(next); writeWorkspaceLocation({ eventSort: next, eventPage: 1 }); };
  const sortFields = { name: 'title', date: 'starts', phase: 'phase', salesCents: 'sales', paidOrders: 'orders', canManage: 'access' };
  const currentSort = Object.keys(sortFields).find((key) => sort.startsWith(`${sortFields[key]}_`)) || 'date';
  const chooseTableSort = (key, descending) => { if (sortFields[key]) chooseSort(`${sortFields[key]}_${descending ? 'desc' : 'asc'}`); };
  const choosePageSize = (size) => { setPageSize(size); setPage(1); writeWorkspaceLocation({ eventPageSize: size, eventPage: 1 }); };
  return <div className="events-workspace">
    <div className="event-summary-strip">{[['upcoming', 'On the horizon'], ['past', 'Past experiences'], ['draft', 'In the making']].map(([key, label]) => <button key={key} type="button" onClick={() => chooseView(key)} className={view === key ? 'selected' : ''}><span>{label}</span><strong>{counts[key]}</strong><CalendarDays size={20}/></button>)}</div>
    <section ref={collectionRef} className="panel event-library">
    <div className="section-heading"><div><span className="eyebrow">YOUR EVENT COLLECTION</span><h2>{ownOnly ? 'Your event activity' : 'Every event. The whole picture.'}</h2><p>{ownOnly ? 'Open an event to see your own sales, referred customers, and guestlists.' : 'Open an event for sales, people, admissions, and customer spending.'}</p></div></div>
    <Tabs value={view} onValueChange={chooseView}><TabsList aria-label="Event timeline"><TabsTrigger value="upcoming">Upcoming & live</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger><TabsTrigger value="draft">Drafts</TabsTrigger><TabsTrigger value="all">All events</TabsTrigger></TabsList></Tabs>
    <div className="event-filters"><div className="search-field"><Search size={16}/><Input aria-label="Search events" placeholder="Search" value={search} onChange={(e) => chooseSearch(e.target.value)}/></div><Field id="events-from" label="From" type="date" value={from} max={to || undefined} onChange={(e) => chooseFrom(e.target.value)}/><Field id="events-to" label="Through" type="date" value={to} min={from || undefined} onChange={(e) => chooseTo(e.target.value)}/>{(from || to || search) && <Button variant="ghost" onClick={() => {setFrom(''); setTo(''); setSearch(''); writeWorkspaceLocation({ eventFrom: null, eventTo: null, eventSearch: null, eventPage: 1 });}}>Clear filters</Button>}</div>
    {loading && <LoadingState>{result ? 'Updating events…' : 'Loading events…'}</LoadingState>}
    {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
    {rows.length ? <div className="event-library-table"><EventTable searchable={false} rows={rows} onSelect={(event) => choose(event.id)} remote={{ sort: currentSort, descending: sort.endsWith('_desc'), onSort: chooseTableSort }} columns={[
      {key:'name',label:'Event',render:(event) => <span className="event-list-name"><span className="event-mobile-status"><span className={`status-pill ${event.phase}`}>{event.phase === 'past' ? 'Past · read only' : event.phase}</span></span><span className="event-calendar"><small>{new Date(event.startsAt).toLocaleDateString('en-US',{month:'short',timeZone:event.location?.timezone || 'UTC'})}</small><strong>{new Date(event.startsAt).toLocaleDateString('en-US',{day:'2-digit',timeZone:event.location?.timezone || 'UTC'})}</strong></span><span className="event-list-meta"><strong>{event.title}</strong><small>{event.venue}</small></span></span>},
      {key:'date',label:'Date & time',className:'event-date-cell',render:(event) => <><span>{eventDateLabel(event)}</span><small>{new Date(event.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:event.location?.timezone || 'UTC'})}</small></>},
      {key:'phase',label:'Status',className:'event-status-cell',render:(event) => <span className={`status-pill ${event.phase}`}>{event.phase === 'past' ? 'Past · read only' : event.phase}</span>},
      {key:'salesCents',label:'Event sales',numeric:true,render:(event) => money(event.salesCents)},
      {key:'paidOrders',label:'Orders',numeric:true},
      {key:'canManage',label:'Access',className:'event-access-cell',render:(event) => event.canManage ? 'Event manager' : 'Your referrals'},
      {key:'id',label:'Details',className:'event-details-cell',sortable:false,render:(event) => <Button className="status-pill event-open-button" variant="ghost" size="sm" onClick={() => choose(event.id)} aria-label={`Open ${event.title}`}>Open<ArrowRight size={11} aria-hidden="true"/></Button>},
    ]}/></div> : !loading && !error && <Empty title="No events in this view"><span>{ownOnly ? 'Choose another date or ask your venue manager about event access.' : 'Choose another date or start planning your next event.'}</span>{!ownOnly && <Button variant="outline" onClick={onCreate}>Create event</Button>}</Empty>}
    <ServerPager result={result} page={page} onPageChange={goPage} onPageSizeChange={choosePageSize} disabled={loading} label="events" targetRef={collectionRef} alwaysVisible={Boolean(rows.length)}/>
  </section></div>;
}
