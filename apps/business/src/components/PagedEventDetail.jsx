import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, CircleDollarSign, LockKeyhole, MapPin, Pencil, Ticket, Users } from 'lucide-react';
import { api, mediaSrc } from '@/lib/api';
import { money, eventDateLabel } from '@/lib/business';
import { eventPhase, saleLabels } from '@/lib/events';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { EventTable } from './EventTable';
import { LoadingState } from './LoadingState';
import { ReferralLink } from './EventDetail';
import { EventSales } from './EventSales';
import { EventTeam } from './EventTeam';
import { Guestlists } from './Guestlists';
import { EventInstructions } from './EventInstructions';
import { EventReuseActions } from './EventReuseActions';
import { EventPaymentAccount } from './PaymentAccounts';

function Metric({ label, value, detail, icon: Icon }) {
  return <div className="event-metric"><div><span>{label}</span><Icon size={18}/></div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function PagedEventDetail({ eventId, session, capabilities, refreshToken, initialTab = null,
  initialGuestlistEntryId = null, organizationId, onOrganizationResolved, onBack, onEdit, onDuplicate, onUnauthorized, onTabChange }) {
  const resolveOrganization = useRef(onOrganizationResolved);
  resolveOrganization.current = onOrganizationResolved;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState(['sales', 'tickets', 'people', 'guestlist'].includes(initialTab) ? initialTab : 'sales');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/business/events/${eventId}/summary`, session, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        const eventOrganization = value.event.organizationId || 'independent';
        if (organizationId && eventOrganization !== organizationId && resolveOrganization.current) {
          resolveOrganization.current(eventOrganization, eventId, initialTab, initialGuestlistEntryId); return;
        }
        setData(value);
      })
      .catch((err) => { if (err.name === 'AbortError') return; if (err.status === 401) onUnauthorized(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId, organizationId, session, refreshToken, revision, onUnauthorized]);
  function saved(message) { setNotice(message); setRevision((value) => value + 1); }
  function chooseTab(value) { setTab(value); onTabChange?.(value); }
  // Native touch/assistive clicks can omit the mousedown/focus sequence used
  // by the tab primitive. The completed click must activate its own section.
  function clickTab(value) { if (value !== tab) chooseTab(value); }
  if (error) return <section className="panel"><Button variant="ghost" onClick={onBack}><ArrowLeft/> Events</Button><p className="error" role="alert">{error}</p><Button onClick={() => setRevision((value) => value + 1)}>Try again</Button></section>;
  if (!data) return <LoadingState className="panel">Loading event summary…</LoadingState>;
  const { event, summary, scope } = data;
  const ownOnly = scope === 'own';
  const phase = eventPhase(event);
  const tiers = data.tiers.map((tier) => ({ ...tier, saleState: event.offerings.find((item) => item.id === tier.id)?.saleState }));
  return <div className="event-detail" aria-busy={loading}>
    <div className="event-detail-nav"><Button variant="ghost" onClick={onBack}><ArrowLeft/> {ownOnly ? 'My events' : 'All events'}</Button><span>{ownOnly ? 'Your referrals and customers only' : 'Full event history · All sales channels'}</span></div>
    <section className="event-detail-hero"><span className={`event-detail-status status-pill ${phase}`}>{phase === 'past' ? 'Past · read only' : phase}</span>
      {event.imageUrl ? <img className="event-detail-flyer" src={mediaSrc(event.imageUrl)} alt={`${event.title} flyer`}/> : <div className="event-detail-flyer event-art-placeholder"><CalendarDays size={35}/></div>}
      <div className="event-detail-heading"><h2>{event.title}</h2><p><CalendarDays size={16}/>{eventDateLabel(event)} · {new Date(event.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:event.location?.timezone || 'UTC'})}</p>{event.location?.name && <p className="event-detail-venue"><MapPin size={16}/>{event.location.name}</p>}{(event.location?.addressLine1 || event.location?.city) && <p className="event-detail-address">{[event.location?.addressLine1, [event.location?.city, event.location?.region, event.location?.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')}</p>}</div>
      {event.canEdit ? <Button variant="outline" onClick={() => onEdit(event)}><Pencil/> Edit event</Button> : phase === 'past' && <span className="event-readonly"><LockKeyhole size={16}/> Event closed</span>}
      {event.summary && <p className="event-detail-summary">{event.summary}</p>}
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <EventPaymentAccount key={`${event.id}:${event.paymentAccountId || ''}`} event={event} session={session} onSaved={saved} />
    {event.canManage && <EventInstructions event={event} session={session} capabilities={capabilities} onUnauthorized={onUnauthorized} onQueued={saved}/>}
    {event.canManage && <EventReuseActions event={event} session={session} onDuplicate={onDuplicate} onSaved={setNotice}/>}
    {phase !== 'past' && <ReferralLink event={event} session={session} revision={revision} onUnauthorized={onUnauthorized} onInvited={() => saved('Guestlist invitation created.')}/>}
    <div className="event-metrics">{ownOnly ? <><Metric icon={CircleDollarSign} label="Your referred sales" value={money(summary.salesCents)} detail="Before customer fees"/><Metric icon={Ticket} label="Your paid orders" value={summary.orders.toLocaleString()}/><Metric icon={Users} label="Your admissions" value={summary.admissions.toLocaleString()}/><Metric icon={CircleDollarSign} label="Your commission" value={money(summary.commissionCents)} detail="Recorded, not payout status"/></> : <><Metric icon={CircleDollarSign} label="Total sales" value={money(summary.salesCents)}/><Metric icon={CircleDollarSign} label="Commissions" value={money(summary.commissionCents)}/><Metric icon={Ticket} label="Paid orders" value={summary.orders.toLocaleString()}/><Metric icon={Users} label="Check-ins / expected" value={`${summary.checkedIn.toLocaleString()} / ${(summary.admissions + summary.guestlistPlaces).toLocaleString()}`}/></>}</div>
    <Tabs value={tab} onValueChange={chooseTab} className="event-detail-tabs"><TabsList aria-label="Event detail sections"><TabsTrigger value="sales" onClick={() => clickTab('sales')}>Sales</TabsTrigger><TabsTrigger value="tickets" onClick={() => clickTab('tickets')}>Offerings</TabsTrigger><TabsTrigger value="people" onClick={() => clickTab('people')}>Team</TabsTrigger><TabsTrigger value="guestlist" onClick={() => clickTab('guestlist')}>Guestlist</TabsTrigger></TabsList>
      <TabsContent value="sales"><EventSales data={data} session={session} onUnauthorized={onUnauthorized} refreshToken={revision}/></TabsContent>
      <TabsContent value="tickets"><section className="panel"><div className="section-heading"><div><h3>Every tier, accounted for</h3><p>Sales retain the price paid at purchase, even after a tier changes.</p></div>{event.canEdit && <Button variant="outline" onClick={() => onEdit(event, 2)}>Manage tiers</Button>}</div><EventTable rows={tiers} defaultSort="salesCents" defaultDescending columns={[
        {key:'name',label:'Tier'}, {key:'kind',label:'Type'}, {key:'saleState',label:'Availability',render:(tier) => phase === 'past' ? 'Event ended' : saleLabels[tier.saleState] || 'Archived'}, {key:'units',label:'Units sold',numeric:true}, {key:'admissions',label:'Active admissions',numeric:true}, {key:'salesCents',label:'Sales',numeric:true,render:(tier) => money(tier.salesCents)},
      ]}/>{!ownOnly && <div className="tier-schedule-list">{event.offerings.map((offering) => <div key={offering.id}><strong>{offering.name}</strong><span>{money(offering.priceCents)} · {offering.entriesPerUnit} admissions per unit</span><small>{!offering.isActive ? 'Closed manually. ' : ''}{offering.releaseAfterOfferingId ? `Opens after ${event.offerings.find((item) => item.id === offering.releaseAfterOfferingId)?.name || 'the prior tier'} sells out or closes. ` : ''}{offering.salesStartAt ? `From ${new Date(offering.salesStartAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{offering.salesEndAt ? `Until ${new Date(offering.salesEndAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}</small></div>)}</div>}</section></TabsContent>
      <TabsContent value="people"><EventTeam event={event} scope={scope} session={session} teamSales={data.teamSales || []} onUnauthorized={onUnauthorized} onSaved={saved} refreshToken={revision}/></TabsContent>
      <TabsContent value="guestlist"><Guestlists event={event} session={session} expire={onUnauthorized} onChanged={() => setRevision((value) => value + 1)} refreshToken={revision} initialEntryId={initialGuestlistEntryId}/></TabsContent>
    </Tabs>
  </div>;
}
