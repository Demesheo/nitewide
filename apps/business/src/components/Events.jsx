import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field, Empty } from './controls';
import { eventDateLabel, money } from '@/lib/business';
import { eventPhase, selectEvents } from '@/lib/events';
import { EventTable } from './EventTable';
import { EventDetail } from './EventDetail';

export function Events({ data, session, onEdit, onCreate, onUnauthorized, ownOnly = false, initialEventId = null, initialTab = null, initialGuestlistEntryId = null }) {
  const collectionRef = useRef(null);
  const [selectedId, setSelectedId] = useState(initialEventId);
  const [view, setView] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (selectedId && selectedId !== initialEventId && !data.events.some((e) => e.id === selectedId)) setSelectedId(null); }, [data, selectedId, initialEventId]);
  if (selectedId) return <EventDetail key={selectedId} eventId={selectedId} session={session} refreshToken={data} initialTab={selectedId === initialEventId ? initialTab : null} initialGuestlistEntryId={selectedId === initialEventId ? initialGuestlistEntryId : null} onBack={() => setSelectedId(null)} onEdit={onEdit} onUnauthorized={onUnauthorized}/>;
  const rows = selectEvents(data.events, { view, search, from, to }, now).map((e) => ({ ...e, name: e.title, phase: eventPhase(e, now), date: Date.parse(e.startsAt), venue: e.location?.name || 'Independent event', salesCents:e.lifetimeSales?.salesCents || 0, paidOrders:e.lifetimeSales?.paidOrders || 0 }));
  const counts = { upcoming: data.events.filter((e) => ['upcoming', 'live'].includes(eventPhase(e, now))).length, past: data.events.filter((e) => eventPhase(e, now) === 'past').length, draft: data.events.filter((e) => eventPhase(e, now) === 'draft').length };
  const scrollToCollection = () => requestAnimationFrame(() => collectionRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  return <div className="events-workspace">
    <div className="event-summary-strip">{[['upcoming', 'On the horizon'], ['past', 'Past experiences'], ['draft', 'In the making']].map(([key, label]) => <button key={key} onClick={() => setView(key)} className={view === key ? 'selected' : ''}><span>{label}</span><strong>{counts[key]}</strong><CalendarDays size={20}/></button>)}</div>
    <section ref={collectionRef} className="panel event-library"><div className="section-heading"><div><span className="eyebrow">YOUR EVENT COLLECTION</span><h2>{ownOnly ? 'Your event activity' : 'Every event. The whole picture.'}</h2><p>{ownOnly ? 'Open an event to see your own sales, referred customers, and guestlists.' : 'Open an event for sales, people, admissions, and customer spending.'}</p></div></div>
      <Tabs value={view} onValueChange={setView}><TabsList aria-label="Event timeline"><TabsTrigger value="upcoming">Upcoming & live</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger><TabsTrigger value="draft">Drafts</TabsTrigger><TabsTrigger value="all">All events</TabsTrigger></TabsList></Tabs>
      <div className="event-filters"><div className="search-field"><Search size={16}/><Input aria-label="Search events" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)}/></div><Field id="events-from" label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}/><Field id="events-to" label="Through" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}/>{(from || to || search) && <Button variant="ghost" onClick={() => {setFrom(''); setTo(''); setSearch('');}}>Clear filters</Button>}</div>
      {rows.length ? <div className="event-library-table"><EventTable searchable={false} rows={rows} onSelect={(e) => setSelectedId(e.id)} onPageChange={scrollToCollection} defaultSort="date" defaultDescending={false} columns={[
        {key:'name',label:'Event',render:(e) => <span className="event-list-name"><span className="event-mobile-status"><span className={`status-pill ${e.phase}`}>{e.phase === 'past' ? 'Past · read only' : e.phase}</span></span><span className="event-calendar"><small>{new Date(e.startsAt).toLocaleDateString('en-US',{month:'short',timeZone:e.location?.timezone || 'UTC'})}</small><strong>{new Date(e.startsAt).toLocaleDateString('en-US',{day:'2-digit',timeZone:e.location?.timezone || 'UTC'})}</strong></span><span className="event-list-meta"><strong>{e.title}</strong><small>{e.venue}</small></span></span>},
        {key:'date',label:'Date & time',className:'event-date-cell',render:(e) => <><span>{eventDateLabel(e)}</span><small>{new Date(e.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:e.location?.timezone || 'UTC',timeZoneName:'short'})}</small></>},
        {key:'phase',label:'Status',className:'event-status-cell',render:(e) => <span className={`status-pill ${e.phase}`}>{e.phase === 'past' ? 'Past · read only' : e.phase}</span>},
        {key:'salesCents',label:'Event sales',numeric:true,render:(e) => money(e.salesCents)},
        {key:'paidOrders',label:'Orders',numeric:true},
        {key:'canManage',label:'Access',className:'event-access-cell',render:(e) => e.canManage ? 'Event manager' : 'Your referrals'},
        {key:'id',label:'Details',className:'event-details-cell',render:(e) => <Button className="status-pill event-open-button" variant="ghost" size="sm" onClick={() => setSelectedId(e.id)} aria-label={`Open ${e.title}`}>Open<ArrowRight size={11} aria-hidden="true"/></Button>},
      ]}/></div> : <Empty title="No events in this view"><span>{ownOnly ? 'Choose another date or ask your venue manager about event access.' : 'Choose another date or start planning your next event.'}</span>{!ownOnly && <Button variant="outline" onClick={onCreate}>Create event</Button>}</Empty>}
    </section>
  </div>;
}
