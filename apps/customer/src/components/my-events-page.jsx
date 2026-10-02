import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin, RefreshCw, Search, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { EventArtwork } from './event-artwork';
import { LoadingIndicator } from './loading-indicator';
import { MyEventDetail } from './my-event-detail';
import { api } from '../lib/api';
import { eventDate, eventTime } from '../lib/presentation';
import { eventVenueName } from '../lib/event-venue';
import { isMyEventsUnauthorized, myEventPhase, myEventsCount, myEventsListPath, myEventsMoney, validMyEventsPage } from '../lib/my-events';
import './my-events.css';

const phaseLabels = { upcoming: 'Upcoming', ongoing: 'Happening now', past: 'Past event', cancelled: 'Cancelled', draft: 'Draft' };

export function MyEventCard({ event, onOpen }) {
  const phase = myEventPhase(event);
  const own = event.scope === 'own' || (event.scope !== 'event' && !event.canManage);
  return <button type="button" className="my-event-card" onClick={() => onOpen(event.id)} aria-label={`View ${event.title} operations`}>
    <div className="my-event-card-main">
      <EventArtwork event={event} className="my-event-flyer" loading="lazy" />
      <div className="my-event-card-copy">
        <span className={`my-event-phase phase-${phase}`}>{phaseLabels[phase]}</span>
        <h2>{event.title}</h2>
        <p className="my-event-meta"><CalendarDays size={14} aria-hidden="true" /><span>{eventDate(event)} · {eventTime(event)}</span></p>
        <p className="my-event-meta"><MapPin size={14} aria-hidden="true" /><span>{eventVenueName(event)}{event.location?.city ? ` · ${event.location.city}` : ''}</span></p>
        {event.organization?.name && <p className="my-event-organization">{event.organization.name}</p>}
      </div>
    </div>
    <div className="my-event-card-bottom">
      <div className="my-event-card-stat"><span>{own ? 'Your sales' : 'Event sales'}</span><strong>{myEventsMoney(event.lifetimeSales?.salesCents)}</strong></div>
      <div className="my-event-card-stat"><span>{own ? 'Your orders' : 'Paid orders'}</span><strong>{myEventsCount(event.lifetimeSales?.paidOrders)}</strong></div>
      <span className="my-event-open"><span>View event</span><ArrowRight size={17} aria-hidden="true" /></span>
    </div>
  </button>;
}

export function MyEventsPage({ session, access, route, onRouteChange, onUnauthorized, onSignIn, onDiscover }) {
  const [search, setSearch] = useState(route.mySearch);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const token = session?.accessToken;
  const path = myEventsListPath(route);
  const ready = Boolean(token && access.eligible && !route.myEventId);
  const result = snapshot?.token === token && snapshot?.path === path && ready ? snapshot.data : null;
  useEffect(() => { setSearch(route.mySearch); }, [route.mySearch]);
  useEffect(() => {
    if (!ready) { setSnapshot(null); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api(path, { token, signal: controller.signal })
      .then(data => {
        if (!validMyEventsPage(data)) throw new Error('We couldn’t load your events. Please try again.');
        if (!controller.signal.aborted) setSnapshot({ token, path, data });
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (isMyEventsUnauthorized(cause)) { setSnapshot(null); onUnauthorized?.(cause); }
        else setError(cause.message || 'We couldn’t load your events. Please try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, path, token, revision, access.successRevision, onUnauthorized]);

  function update(changes) { onRouteChange({ ...route, myEventId: null, ...changes }); }
  function submit(event) { event.preventDefault(); update({ mySearch: search.trim().slice(0, 120), myPage: 1 }); }
  const refresh = () => setRevision(value => value + 1);
  const list = <>
    <div className="my-events-heading">
      <div><p className="eyebrow">YOUR EVENTS. YOUR PEOPLE.</p><h1>My events.</h1><p>Keep up with the nights you’re part of.</p></div>
      <span className="my-events-heading-note"><Sparkles size={16} aria-hidden="true" /> Your business access, here.</span>
    </div>
    {!session ? <div className="my-events-empty"><CalendarDays aria-hidden="true" /><h2>Sign in to your events.</h2><p>Use the account connected to your business or event team.</p><Button className="dark-glass-action" onClick={onSignIn}>Sign in</Button></div>
      : access.loading && !access.eligible ? <LoadingIndicator>Checking your event access…</LoadingIndicator>
      : access.error && !access.eligible ? <div className="my-events-error" role="alert"><p>{access.error}</p><Button variant="outline" onClick={access.recheck}>Try again</Button></div>
      : !access.eligible ? <div className="my-events-empty"><CalendarDays aria-hidden="true" /><h2>Your event access isn’t available.</h2><p>My events is available to approved business members after account setup.</p><Button className="dark-glass-action" onClick={onDiscover}>Discover events</Button></div>
      : <>
        <div className="my-events-toolbar">
          <div className="my-events-period" role="group" aria-label="Event period">
            {['upcoming', 'past'].map(status => <button type="button" key={status} aria-pressed={route.myStatus === status} onClick={() => update({ myStatus: status, myPage: 1 })}>
              {status === 'upcoming' ? 'Upcoming' : 'Past'}{result?.counts?.[status] !== undefined && <span>{myEventsCount(result.counts[status])}</span>}
            </button>)}
          </div>
          <form className="my-events-search" onSubmit={submit} role="search" aria-label="Search my events">
            <label className="my-events-search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Search your events</span><input type="search" placeholder="Search event or venue" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} /></label>
            <Button className="dark-glass-action" type="submit">Search</Button>
          </form>
          <Button className="my-events-refresh" variant="ghost" aria-label="Refresh my events" disabled={loading} onClick={refresh}><RefreshCw size={17} aria-hidden="true" /></Button>
        </div>
        <div className="my-events-results-heading"><span>{route.myStatus === 'upcoming' ? 'Upcoming & happening now' : 'Past events · read-only'}</span>{result && <span>{myEventsCount(result.total)} {result.total === 1 ? 'event' : 'events'}{route.mySearch ? ` matching “${route.mySearch}”` : ''}</span>}</div>
        {route.mySearch && <button type="button" className="my-events-clear" onClick={() => { setSearch(''); update({ mySearch: '', myPage: 1 }); }}>Clear search</button>}
        {result?.items.length > 0 && <p className="my-events-recorded-note">Recorded totals may include demo or sandbox activity and are not a payout or settlement statement.</p>}
        {error && <div className="my-events-error" role="alert"><p>{error}</p><Button variant="outline" onClick={refresh}>Try again</Button></div>}
        {loading && !result ? <LoadingIndicator>Finding your events…</LoadingIndicator> : result && <>
          {result.items.length ? <div className="my-events-grid" aria-busy={loading}>{result.items.map(event => <MyEventCard key={event.id} event={event} onOpen={myEventId => onRouteChange({ ...route, myEventId })} />)}</div>
            : <div className="my-events-empty"><CalendarDays aria-hidden="true" /><h2>{route.mySearch ? 'No events match this search.' : route.myStatus === 'past' ? 'No past events yet.' : 'No upcoming events yet.'}</h2><p>{route.mySearch ? 'Try another event name or venue.' : route.myStatus === 'past' ? 'Your past nights and their results will appear here.' : 'Events assigned to your business, venue or event team will appear here.'}</p></div>}
          {result.total > result.pageSize || route.myPage > 1 ? <nav className="my-events-pagination" aria-label="My events pages">
            <Button variant="outline" disabled={loading || route.myPage <= 1} onClick={() => update({ myPage: route.myPage - 1 })}><ChevronLeft size={16} aria-hidden="true" /> Previous</Button>
            <span>Page {route.myPage} of {Math.max(route.myPage, Math.ceil(result.total / result.pageSize), 1)}</span>
            <Button variant="outline" disabled={loading || !result.hasMore} onClick={() => update({ myPage: route.myPage + 1 })}>Next <ChevronRight size={16} aria-hidden="true" /></Button>
          </nav> : null}
        </>}
      </>}
  </>;
  return <main className="my-events-page wrap" id="my-events">
    {access.eligible && access.error && <div className="my-events-access-warning" role="status"><p>Couldn’t refresh your event access.</p><button type="button" onClick={access.recheck}>Retry access check</button></div>}
    {session && access.eligible && route.myEventId ? <MyEventDetail key={`${token}:${route.myEventId}`} session={session} eventId={route.myEventId} refreshKey={access.successRevision} onBack={() => update({})} onUnauthorized={onUnauthorized} /> : list}
  </main>;
}
