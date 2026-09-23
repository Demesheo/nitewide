import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, LockKeyhole, MapPin, CalendarDays, Users, Ticket, CircleDollarSign, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Empty } from './controls';
import { MultiSelect } from './MultiSelect';
import { EventPromoterInvite } from './EventPromoterInvite';
import { EventTable } from './EventTable';
import { SalesMixPie } from './SalesMixPie';
import { api, mediaSrc } from '@/lib/api';
import { money, eventDateLabel } from '@/lib/business';
import { eventPhase, saleLabels, eventTeamRoles, filterEventTeam } from '@/lib/events';
import { customerLink } from '@/lib/customer-link';

function ReferralLink({ eventId, session }) {
  const [link, setLink] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api(`/business/events/${eventId}/referral-link`, session)
      .then((value) => { if (active) setLink(value); })
      .catch(() => { if (active) setLink(null); });
    return () => { active = false; };
  }, [eventId, session]);
  if (!link) return null;
  const url = new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href);
  url.searchParams.set('event', eventId);
  url.searchParams.set('ref', link.code);
  return <section className="panel"><div className="section-heading"><div><h3>Your event referral link</h3><p>Share this link. Purchases and guestlist requests made through it are attributed to you for this event.</p></div></div><div className="flex flex-wrap items-center gap-3"><code className="break-all text-sm">{url.toString()}</code><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(url.toString()).then(() => setMessage('Link copied.')).catch(() => setMessage('Could not copy; select the link above.'))}>Copy link</Button></div>{message && <p role="status">{message}</p>}</section>;
}

function Metric({ label, value, detail, icon: Icon }) {
  return <div className="event-metric"><div><span>{label}</span><Icon size={18}/></div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function EventAttendees({ customers, onSelect }) {
  return <section className="panel"><div className="section-heading"><div><h3>Attendees</h3><p>Total spend is ticket and package purchases before fees. Unrecorded purchases at the venue are excluded.</p></div></div><div className="event-attendees-table"><EventTable rows={customers} onSelect={onSelect} defaultSort="salesCents" defaultDescending columns={[
    {key:'name',label:'Customer',render:(c) => <span className="attendee-card-heading"><span className="sr-only">View attendee details for </span><span>{c.name}</span><Info className="attendee-info-icon" size={18} aria-hidden="true"/></span>},
    {key:'orders',label:'Orders',numeric:true,render:(c) => <span className="attendee-metric-value">{c.orders}</span>},
    {key:'salesCents',label:'Total spend',numeric:true,render:(c) => <span className="attendee-metric-value">{money(c.salesCents)}</span>},
    {key:'admissions',label:'Tickets',numeric:true,render:(c) => <span className="attendee-metric-value">{c.admissions}</span>},
    {key:'guestlistPlaces',label:'Guestlist spots',numeric:true,render:(c) => <span className="attendee-metric-value">{c.guestlistPlaces}</span>},
    {key:'checkedIn',label:'Checked in',numeric:true,render:(c) => <span className="attendee-metric-value">{c.checkedIn}</span>},
  ]}/></div></section>;
}

function EventPeople({ data, session, onSaved, onUnauthorized }) {
  const [editing, setEditing] = useState(null);
  const [personId, setPersonId] = useState('');
  const [rate, setRate] = useState(0);
  const [roles, setRoles] = useState([]);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { event, people, candidates } = data;
  const editablePeople = people.filter((p) => p.status === 'active' || candidates.some((c) => c.userId === p.userId));
  const roleOptions = eventTeamRoles(people);
  const canEditPerson = event.canEdit && editablePeople.some((p) => p.userId === editing?.userId);
  const open = (person) => { setEditing(person); setPersonId(person.userId); setRate(Math.min(40, (person.commissionBps || 0) / 100)); setRemoving(false); setError(''); };
  async function save(status = 'active') {
    setBusy(true); setError('');
    try {
      await api(`/business/events/${event.id}/people`, session, { method:'PUT', body:JSON.stringify({ userId:personId, commissionBps:Math.round(rate * 100), status }) });
      setEditing(null); onSaved(status === 'inactive' ? 'Referrer removed. Existing sales and approved guestlists are preserved.' : 'Event commission saved for future purchases.');
    } catch (e) { if (e.status === 401) onUnauthorized(); else setError(e.message); } finally { setBusy(false); }
  }
  return <><div className="section-heading event-people-heading"><div><h3>{data.scope === 'own' ? 'Your referral' : 'Team'}</h3><p>{event.canEdit ? 'Click a person to view performance or manage their event commission.' : event.canManage ? 'This event has ended. Commission rates and earned amounts are read-only.' : 'Your sales, performance, referral code and commission earnings for this event.'}</p></div>{event.canEdit && <EventPromoterInvite event={event} session={session} onUnauthorized={onUnauthorized}/>}</div>
    {data.scope !== 'own' && <div className="toolbar"><MultiSelect label="Roles" selected={roles.filter((r)=>roleOptions.some((option)=>option.id===r))} onChange={setRoles} options={roleOptions}/></div>}
    <EventTable rows={filterEventTeam(people,roles)} onSelect={(p) => open(p)} selectRow defaultSort="salesCents" defaultDescending columns={[
      {key:'name',label:'Person',render:(p) => <><strong>{p.name}</strong>{p.status === 'inactive' && <small>Removed · history retained</small>}</>},
      {key:'role',label:'Role'},
      {key:'commissionBps',label:'Commission',numeric:true,render:(p) => `${(p.commissionBps ?? 0) / 100}%`},
      {key:'salesCents',label:'Sales',numeric:true,render:(p) => money(p.salesCents)},
      {key:'orders',label:'Orders',numeric:true},{key:'customers',label:'Customers',numeric:true},
      {key:'guestlistPlaces',label:'Guestlist requested',numeric:true},
      {key:'approvedGuestlistPlaces',label:'Guestlist approved',numeric:true},
      {key:'commissionCents',label:'Earned commission',numeric:true,render:(p) => money(p.commissionCents)},
    ]}/>
    <Dialog open={Boolean(editing)} onOpenChange={(v) => { if (!v && !busy) setEditing(null); }}><DialogContent className="sm:max-w-lg event-person-dialog"><DialogHeader><DialogTitle>{editing?.userId ? editing.name : 'Add an event referrer'}</DialogTitle><DialogDescription>{editing?.userId ? `${editing.role} · Performance and commission for this event.` : 'Choose a team member and set their commission for this event.'}</DialogDescription></DialogHeader>
      {editing && <form onSubmit={(e) => {e.preventDefault(); if (canEditPerson) save();}} className="event-person-form">
        {editing.userId && <div className="event-financials"><div><span>Referred sales</span><strong>{money(editing.salesCents || 0)}</strong></div><div><span>Earned commission</span><strong>{money(editing.commissionCents || 0)}</strong></div><div><span>Orders</span><strong>{editing.orders || 0}</strong></div><div><span>Customers</span><strong>{editing.customers || 0}</strong></div><div><span>Guestlist requested</span><strong>{editing.guestlistPlaces || 0}</strong></div><div><span>Guestlist approved</span><strong>{editing.approvedGuestlistPlaces || 0}</strong></div></div>}
        {editing.code && <div className="field"><label>Referral code</label><code className="event-referral-code">{editing.code}</code></div>}
        <div className="commission-control"><div><label id="commission-label">Commission on ticket/package sales</label><strong>{rate}%</strong></div>{canEditPerson ? <><Slider aria-label="Event commission percentage" min={0} max={40} step={0.5} value={[rate]} onValueChange={([v]) => setRate(v)} disabled={busy}/><div className="commission-scale"><span>0%</span><span>40%</span></div><p className="hint">Applies to future referred purchases. A $100 sale earns {money(rate * 100)} at this rate. Previously recorded commissions stay unchanged.</p></> : <p className="hint">{event.canManage ? 'This record is read-only.' : 'Only an owner, manager, or event creator can change commissions.'}</p>}</div>
        {removing && <p className="event-warning">Remove this person from new referrals for this event? Their past sales, commissions, and approved guestlists will remain recorded.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Close</Button>{canEditPerson && <>{['active','default'].includes(editing.status) && (removing ? <Button type="button" variant="destructive" disabled={busy} onClick={() => save('inactive')}>Confirm removal</Button> : <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>Remove from event</Button>)}<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save commission'}</Button></>}</DialogFooter>
      </form>}
    </DialogContent></Dialog>
  </>;
}

export function EventDetail({ eventId, session, refreshToken, onBack, onEdit, onUnauthorized }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [customer, setCustomer] = useState(null);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api(`/business/events/${eventId}/detail`, session).then((value) => { if (active) setData(value); }).catch((e) => { if (active) { if (e.status === 401) onUnauthorized(); else setError(e.message); } }).finally(() => {if (active) setLoading(false);});
    return () => { active = false; };
  }, [eventId, session, revision, refreshToken]);
  const saved = (message) => {setNotice(message); setRevision((v) => v + 1);};
  if (error) return <section className="panel"><Button variant="ghost" onClick={onBack}><ArrowLeft/> Events</Button><p className="error" role="alert">{error}</p><Button onClick={() => setRevision((v) => v + 1)}>Try again</Button></section>;
  if (!data) return <p className="loading" role="status">Loading event performance…</p>;
  const {event, summary:s, scope} = data;
  const phase = eventPhase(event);
  const ownOnly = scope === 'own';
  const tiers = data.tiers.map((t) => ({...t, ...{saleState:event.offerings.find((o) => o.id === t.id)?.saleState}}));
  return <div className="event-detail" aria-busy={loading}>
    <div className="event-detail-nav"><Button variant="ghost" onClick={onBack}><ArrowLeft/> {ownOnly ? 'My events' : 'All events'}</Button><span>{ownOnly ? 'Your referrals and customers only' : 'Full event history · All sales channels'}</span></div>
    <section className="event-detail-hero"><span className={`event-detail-status status-pill ${phase}`}>{phase === 'past' ? 'Past · read only' : phase}</span>{event.imageUrl ? <img className="event-detail-flyer" src={mediaSrc(event.imageUrl)} alt={`${event.title} flyer`}/> : <div className="event-detail-flyer event-art-placeholder"><CalendarDays size={35}/></div>}<div className="event-detail-heading"><h2>{event.title}</h2><p><CalendarDays size={16}/>{eventDateLabel(event)} · {new Date(event.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:event.location?.timezone || 'UTC',timeZoneName:'short'})}</p>{event.location?.name && <p className="event-detail-venue"><MapPin size={16}/>{event.location.name}</p>}{(event.location?.addressLine1 || event.location?.city) && <p className="event-detail-address">{[event.location?.addressLine1, [event.location?.city, event.location?.region, event.location?.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')}</p>}</div>{event.canEdit ? <Button variant="outline" onClick={() => onEdit(event)}><Pencil/> Edit event</Button> : phase === 'past' && <span className="event-readonly"><LockKeyhole size={16}/> Event closed</span>}{event.summary && <p className="event-detail-summary">{event.summary}</p>}</section>
    {notice && <p className="notice" role="status">{notice}</p>}
    {phase !== 'past' && <ReferralLink eventId={event.id} session={session}/>}
    <div className="event-metrics">{ownOnly ? <><Metric icon={CircleDollarSign} label="Your referred sales" value={money(s.salesCents)} detail="Ticket and package value before fees"/><Metric icon={Ticket} label="Your paid orders" value={s.orders.toLocaleString()}/><Metric icon={Users} label="Your admissions" value={s.admissions.toLocaleString()} detail="From your credited purchases"/><Metric icon={CircleDollarSign} label="Your commission" value={money(s.commissionCents)} detail="Recorded earnings · not payout status"/></> : <><Metric icon={CircleDollarSign} label="Total sales" value={money(s.salesCents)}/><Metric icon={CircleDollarSign} label="Commissions" value={money(s.commissionCents)}/><Metric icon={Ticket} label="Paid orders" value={s.orders.toLocaleString()}/><Metric icon={Users} label="Check-ins / expected" value={`${s.checkedIn.toLocaleString()} / ${(s.admissions + s.guestlistPlaces).toLocaleString()}`}/></>}</div>
    <Tabs defaultValue="sales" className="event-detail-tabs"><TabsList aria-label="Event detail sections"><TabsTrigger value="sales">{ownOnly ? 'My sales & customers' : 'Sales overview'}</TabsTrigger><TabsTrigger value="tickets">Tickets & packages</TabsTrigger><TabsTrigger value="people">{ownOnly ? 'My referral' : 'Team'}</TabsTrigger></TabsList>
    <TabsContent value="sales"><div className="event-chart-grid"><section className="panel"><span className="eyebrow">WHAT SELLS</span><h3>{ownOnly ? 'Your sales by ticket & package' : 'Sales by ticket & package'}</h3>{s.salesCents ? <SalesMixPie slices={data.tiers.filter((t) => t.salesCents > 0)}/> : <Empty title="Sales start here">Your ticket and package mix will appear after the first purchase.</Empty>}</section>{!ownOnly && <section className="panel"><span className="eyebrow">WHO BRINGS THE CROWD</span><h3>Sales by referral channel</h3>{s.salesCents ? <SalesMixPie slices={data.channels.map((c) => ({...c,id:c.name}))}/> : <Empty title="No sales yet">Direct and referred purchases will appear here.</Empty>}</section>}</div><EventAttendees customers={data.customers} onSelect={setCustomer}/></TabsContent>
      <TabsContent value="tickets"><section className="panel"><div className="section-heading"><div><h3>Every tier, accounted for</h3><p>Sales retain the price paid at purchase, even when a tier’s current price changes.</p></div>{event.canEdit && <Button variant="outline" onClick={() => onEdit(event)}>Manage tiers</Button>}</div><EventTable rows={tiers} defaultSort="salesCents" defaultDescending columns={[
        {key:'name',label:'Tier'}, {key:'kind',label:'Type'}, {key:'saleState',label:'Availability',render:(t) => phase === 'past' ? 'Event ended' : saleLabels[t.saleState] || 'Archived'}, {key:'units',label:'Units sold',numeric:true},{key:'admissions',label:'Active admissions',numeric:true},{key:'salesCents',label:'Sales',numeric:true,render:(t) => money(t.salesCents)},
      ]}/>{!ownOnly && <div className="tier-schedule-list">{event.offerings.map((o) => <div key={o.id}><strong>{o.name}</strong><span>{money(o.priceCents)} · {o.entriesPerUnit} admissions per unit</span><small>{!o.isActive ? 'Closed manually. ' : ''}{o.releaseAfterOfferingId ? `Opens when ${event.offerings.find((t) => t.id === o.releaseAfterOfferingId)?.name || 'previous tier'} sells out or closes. ` : ''}{o.salesStartAt ? `From ${new Date(o.salesStartAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{o.salesEndAt ? `Until ${new Date(o.salesEndAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{!o.releaseAfterOfferingId && !o.salesStartAt && !o.salesEndAt && o.isActive ? 'Available while the event is on sale.' : ''}</small></div>)}</div>}</section></TabsContent>
      <TabsContent value="people"><section className="panel"><EventPeople data={data} session={session} onSaved={saved} onUnauthorized={onUnauthorized}/></section></TabsContent>
    </Tabs>
    <Dialog open={Boolean(customer)} onOpenChange={(v) => {if (!v) setCustomer(null);}}><DialogContent className="event-customer-dialog"><DialogHeader><DialogTitle>{customer?.name}</DialogTitle><DialogDescription>{customer?.email}</DialogDescription></DialogHeader>{customer && <><div className="event-financials"><div><span>Event spending</span><strong>{money(customer.salesCents)}</strong></div><div><span>Guestlist status</span><strong>{customer.guestlistStatuses.map((v) => v.replaceAll('_',' ')).join(', ') || 'No request'}</strong></div></div><EventTable rows={customer.purchases.map((p,i) => ({...p,id:String(i)}))} defaultSort="salesCents" defaultDescending empty="No purchases for this event" columns={[{key:'name',label:'Purchased'},{key:'quantity',label:'Quantity',numeric:true},{key:'salesCents',label:'Amount',numeric:true,render:(p) => money(p.salesCents)},{key:'referredBy',label:'Source'}]}/></>}</DialogContent></Dialog>
  </div>;
}
