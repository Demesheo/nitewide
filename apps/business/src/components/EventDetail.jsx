import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, LockKeyhole, MapPin, CalendarDays, Users, Ticket, CircleDollarSign } from 'lucide-react';
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

function Metric({ label, value, detail, icon: Icon }) {
  return <div className="event-metric"><div><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{detail}</small></div>;
}

function EventAttendees({ customers, onSelect }) {
  return <section className="panel"><div className="section-heading"><div><h3>Attendees</h3><p>Total spend is ticket and package purchases before fees. Unrecorded purchases at the venue are excluded.</p></div></div><EventTable rows={customers} onSelect={onSelect} defaultSort="salesCents" defaultDescending columns={[
    {key:'name',label:'Customer'}, {key:'orders',label:'Orders',numeric:true},{key:'salesCents',label:'Total spend',numeric:true,render:(c) => money(c.salesCents)},{key:'admissions',label:'Ticket admissions',numeric:true},{key:'guestlistPlaces',label:'Guestlist places',numeric:true},{key:'checkedIn',label:'Checked in',numeric:true},
  ]}/></section>;
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
  return <><div className="section-heading event-people-heading"><div><h3>Team</h3><p>{event.canEdit ? 'Click a person to view performance or manage their event commission.' : event.canManage ? 'This event has ended. Commission rates and earned amounts are read-only.' : 'Your sales, performance and commission earnings for this event.'}</p></div>{event.canEdit && <EventPromoterInvite event={event} session={session} onUnauthorized={onUnauthorized}/>}</div>
    <div className="toolbar"><MultiSelect label="Roles" selected={roles.filter((r)=>roleOptions.some((option)=>option.id===r))} onChange={setRoles} options={roleOptions}/></div>
    <EventTable rows={filterEventTeam(people,roles)} onSelect={(p) => open(p)} selectRow defaultSort="salesCents" defaultDescending columns={[
      {key:'name',label:'Person',render:(p) => <><strong>{p.name}</strong>{p.status === 'inactive' && <small>Removed · history retained</small>}</>},
      {key:'role',label:'Role'},
      {key:'commissionBps',label:'Commission',numeric:true,render:(p) => `${(p.commissionBps ?? 0) / 100}%`},
      {key:'salesCents',label:'Sales',numeric:true,render:(p) => money(p.salesCents)},
      {key:'orders',label:'Orders',numeric:true},{key:'customers',label:'Customers',numeric:true},
      {key:'commissionCents',label:'Earned commission',numeric:true,render:(p) => money(p.commissionCents)},
    ]}/>
    <Dialog open={Boolean(editing)} onOpenChange={(v) => { if (!v && !busy) setEditing(null); }}><DialogContent className="sm:max-w-lg event-person-dialog"><DialogHeader><DialogTitle>{editing?.userId ? editing.name : 'Add an event referrer'}</DialogTitle><DialogDescription>{editing?.userId ? `${editing.role} · Performance and commission for this event.` : 'Choose a team member and set their commission for this event.'}</DialogDescription></DialogHeader>
      {editing && <form onSubmit={(e) => {e.preventDefault(); if (canEditPerson) save();}} className="event-person-form">
        {editing.userId && <div className="event-financials"><div><span>Referred sales</span><strong>{money(editing.salesCents || 0)}</strong></div><div><span>Earned commission</span><strong>{money(editing.commissionCents || 0)}</strong></div><div><span>Orders</span><strong>{editing.orders || 0}</strong></div><div><span>Customers</span><strong>{editing.customers || 0}</strong></div></div>}
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
  const tiers = data.tiers.map((t) => ({...t, ...{saleState:event.offerings.find((o) => o.id === t.id)?.saleState}}));
  return <div className="event-detail" aria-busy={loading}>
    <div className="event-detail-nav"><Button variant="ghost" onClick={onBack}><ArrowLeft/> All events</Button><span>Full event history · {scope === 'own' ? 'Your referrals only' : 'All sales channels'}</span></div>
    <section className="event-detail-hero">{event.imageUrl ? <img className="event-detail-flyer" src={mediaSrc(event.imageUrl)} alt={`${event.title} flyer`}/> : <div className="event-detail-flyer event-art-placeholder"><CalendarDays size={35}/></div>}<div className="event-detail-heading"><span className={`status-pill ${phase}`}>{phase === 'past' ? 'Past · read only' : phase}</span><h2>{event.title}</h2><p><CalendarDays size={16}/>{eventDateLabel(event)} · {new Date(event.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:event.location?.timezone || 'UTC',timeZoneName:'short'})}</p><p><MapPin size={16}/>{[event.location?.name, event.location?.addressLine1, event.location?.city].filter(Boolean).join(' · ')}</p>{event.summary && <p>{event.summary}</p>}</div>{event.canEdit ? <Button variant="outline" onClick={() => onEdit(event)}><Pencil/> Edit event</Button> : phase === 'past' && <span className="event-readonly"><LockKeyhole size={16}/> Event closed</span>}</section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="event-metrics"><Metric icon={CircleDollarSign} label="Ticket & package sales" value={money(s.salesCents)} detail="Face value · excludes customer fees"/><Metric icon={Ticket} label="Paid orders" value={s.orders.toLocaleString()} detail={`${s.customers} paying customers`}/><Metric icon={Users} label="Admission credentials" value={s.admissions.toLocaleString()} detail={`${s.guestlistPlaces} additional approved guestlist places`}/><Metric icon={Users} label="Checked in" value={s.checkedIn.toLocaleString()} detail="Ticket admissions + guestlist party members"/></div>
    <Tabs defaultValue="sales" className="event-detail-tabs"><TabsList aria-label="Event detail sections"><TabsTrigger value="sales">Sales overview</TabsTrigger><TabsTrigger value="tickets">Tickets & packages</TabsTrigger><TabsTrigger value="people">Team</TabsTrigger></TabsList>
      <TabsContent value="sales"><div className="event-chart-grid"><section className="panel"><span className="eyebrow">WHAT SELLS</span><h3>Sales by ticket & package</h3>{s.salesCents ? <SalesMixPie slices={data.tiers.filter((t) => t.salesCents > 0)}/> : <Empty title="Sales start here">Your ticket and package mix will appear after the first purchase.</Empty>}</section><section className="panel"><span className="eyebrow">WHO BRINGS THE CROWD</span><h3>Sales by referral channel</h3>{s.salesCents ? <SalesMixPie slices={data.channels.map((c) => ({...c,id:c.name}))}/> : <Empty title="No sales yet">Direct and referred purchases will appear here.</Empty>}</section></div><section className="panel"><div className="section-heading"><div><h3>Revenue at a glance</h3><p>Recorded paid orders for the full event. This is a sales report, not a payout balance.</p></div></div><div className="event-financials"><div><span>Customer payments, including fees</span><strong>{money(s.customerPaidCents)}</strong></div><div><span>Customer platform fees</span><strong>{money(s.platformFeeCents)}</strong></div><div><span>Recorded referral commissions</span><strong>{money(s.commissionCents)}</strong></div><div><span>Sales after referral commissions</span><strong>{money(s.salesCents - s.commissionCents)}</strong><small>Before Stripe processing and other adjustments</small></div></div></section><EventAttendees customers={data.customers} onSelect={setCustomer}/></TabsContent>
      <TabsContent value="tickets"><section className="panel"><div className="section-heading"><div><h3>Every tier, accounted for</h3><p>Sales retain the price paid at purchase, even when a tier’s current price changes.</p></div>{event.canEdit && <Button variant="outline" onClick={() => onEdit(event)}>Manage tiers</Button>}</div><EventTable rows={tiers} defaultSort="salesCents" defaultDescending columns={[
        {key:'name',label:'Tier'}, {key:'kind',label:'Type'}, {key:'saleState',label:'Availability',render:(t) => phase === 'past' ? 'Event ended' : saleLabels[t.saleState] || 'Archived'}, {key:'units',label:'Units sold',numeric:true},{key:'admissions',label:'Active admissions',numeric:true},{key:'salesCents',label:'Sales',numeric:true,render:(t) => money(t.salesCents)},
      ]}/><div className="tier-schedule-list">{event.offerings.map((o) => <div key={o.id}><strong>{o.name}</strong><span>{money(o.priceCents)} · {o.entriesPerUnit} admissions per unit</span><small>{o.releaseAfterOfferingId ? `Opens after ${event.offerings.find((t) => t.id === o.releaseAfterOfferingId)?.name || 'previous tier'} sells out. ` : ''}{o.salesStartAt ? `From ${new Date(o.salesStartAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{o.salesEndAt ? `Until ${new Date(o.salesEndAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{!o.releaseAfterOfferingId && !o.salesStartAt && !o.salesEndAt ? 'Available while the event is on sale.' : ''}</small></div>)}</div></section></TabsContent>
      <TabsContent value="people"><section className="panel"><EventPeople data={data} session={session} onSaved={saved} onUnauthorized={onUnauthorized}/></section></TabsContent>
    </Tabs>
    <Dialog open={Boolean(customer)} onOpenChange={(v) => {if (!v) setCustomer(null);}}><DialogContent className="event-customer-dialog"><DialogHeader><DialogTitle>{customer?.name}</DialogTitle><DialogDescription>{customer?.email}</DialogDescription></DialogHeader>{customer && <><div className="event-financials"><div><span>Event spending</span><strong>{money(customer.salesCents)}</strong></div><div><span>Guestlist status</span><strong>{customer.guestlistStatuses.map((v) => v.replaceAll('_',' ')).join(', ') || 'No request'}</strong></div></div><EventTable rows={customer.purchases.map((p,i) => ({...p,id:String(i)}))} defaultSort="salesCents" defaultDescending empty="No purchases for this event" columns={[{key:'name',label:'Purchased'},{key:'quantity',label:'Quantity',numeric:true},{key:'salesCents',label:'Amount',numeric:true,render:(p) => money(p.salesCents)},{key:'referredBy',label:'Source'}]}/></>}</DialogContent></Dialog>
  </div>;
}
