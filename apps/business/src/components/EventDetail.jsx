import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pencil, LockKeyhole, MapPin, CalendarDays, Users, Ticket, CircleDollarSign, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Empty } from './controls';
import { MultiSelect } from './MultiSelect';
import { EventPromoterInvite } from './EventPromoterInvite';
import { EventTable } from './EventTable';
import { LoadingState } from './LoadingState';
import { SalesMixPie } from './SalesMixPie';
import { ShareEventCard } from './ShareEventCard';
import { GuestlistInviteDialog } from './GuestlistInviteDialog';
import { Guestlists } from './Guestlists';
import { api, mediaSrc } from '@/lib/api';
import { money, eventDateLabel } from '@/lib/business';
import { eventPhase, saleLabels, eventTeamRoles, filterEventTeam, eventTeamSalesSlices } from '@/lib/events';
import { customerLink } from '@/lib/customer-link';

function ReferralLink({ event, session, revision, onUnauthorized, onInvited }) {
  const [link, setLink] = useState(null);
  const [invitePools, setInvitePools] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setLink(null);
    api(`/business/events/${event.id}/referral-link`, session)
      .then((value) => { if (active) setLink(value); })
      .catch(() => { if (active) setLink(null); });
    return () => { active = false; };
  }, [event.id, session]);
  useEffect(() => {
    let active = true;
    setInvitePools(null);
    api(`/business/events/${event.id}/guestlist-invite-pools`, session)
      .then((value) => { if (active) setInvitePools(value); })
      .catch(() => { if (active) setInvitePools(null); });
    return () => { active = false; };
  }, [event.id, session, revision]);
  const url = link ? new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href) : null;
  if (url) { url.searchParams.set('event', event.id); url.searchParams.set('ref', link.code); }
  const canInviteGuest = event.status === 'published' && invitePools?.open && (invitePools.direct || invitePools.own.length > 0);
  return <><ShareEventCard referralUrl={url?.toString() || ''} canInviteGuest={Boolean(canInviteGuest)} onInviteGuest={() => setInviteOpen(true)}/><GuestlistInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} eventId={event.id} invitePools={invitePools} session={session} onUnauthorized={onUnauthorized} onSuccess={onInvited}/></>;
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
  const teamHeadingRef = useRef(null);
  const [editing, setEditing] = useState(null);
  const [personId, setPersonId] = useState('');
  const [rate, setRate] = useState(0);
  const [roles, setRoles] = useState([]);
  const [editingMode, setEditingMode] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { event, people, candidates } = data;
  const editablePeople = people.filter((p) => p.status === 'active' || candidates.some((c) => c.userId === p.userId));
  const roleOptions = eventTeamRoles(people);
  const canEditPerson = event.canEdit && editablePeople.some((p) => p.userId === editing?.userId);
  const open = (person) => { setEditing(person); setPersonId(person.userId); setRate(Math.min(40, (person.commissionBps || 0) / 100)); setEditingMode(false); setRemoving(false); setError(''); };
  const cancelEdit = () => { setRate(Math.min(40, (editing?.commissionBps || 0) / 100)); setEditingMode(false); setRemoving(false); setError(''); };
  async function save(status = 'active') {
    setBusy(true); setError('');
    try {
      await api(`/business/events/${event.id}/people`, session, { method:'PUT', body:JSON.stringify({ userId:personId, commissionBps:Math.round(rate * 100), status }) });
      setEditing(null); onSaved(status === 'inactive' ? 'Referrer removed. Existing sales and approved guestlists are preserved.' : 'Event commission saved for future purchases.');
    } catch (e) { if (e.status === 401) onUnauthorized(); else setError(e.message); } finally { setBusy(false); }
  }
  const scrollToTeam = () => requestAnimationFrame(() => teamHeadingRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  return <><div ref={teamHeadingRef} className="section-heading event-people-heading"><div className="event-people-title-row"><h3>{data.scope === 'own' ? 'Your referral' : 'Team'}</h3>{event.canEdit && <EventPromoterInvite event={event} session={session} onUnauthorized={onUnauthorized}/>}</div><p>{event.canEdit ? 'Click a person to view performance or manage their event commission.' : event.canManage ? 'This event has ended. Commission rates and earned amounts are read-only.' : 'Your sales, performance, referral code and commission earnings for this event.'}</p></div>
    {data.scope !== 'own' && <div className="event-team-controls"><div className="event-team-filter-row"><MultiSelect label="Roles" selected={roles.filter((r)=>roleOptions.some((option)=>option.id===r))} onChange={setRoles} options={roleOptions}/></div></div>}
    <div className="event-team-table"><EventTable rows={filterEventTeam(people,roles)} onSelect={(p) => open(p)} onPageChange={scrollToTeam} selectRow defaultSort="salesCents" defaultDescending columns={[
      {key:'name',label:'Person',render:(p) => <><strong>{p.name}</strong>{p.status === 'inactive' && <small>Removed · history retained</small>}</>},
      {key:'role',label:'Role'},
      {key:'commissionBps',label:'Commission',numeric:true,render:(p) => `${(p.commissionBps ?? 0) / 100}%`},
      {key:'salesCents',label:'Sales',numeric:true,render:(p) => money(p.salesCents)},
      {key:'orders',label:'Orders',numeric:true},{key:'customers',label:'Customers',numeric:true},
      {key:'guestlistPlaces',label:'Guestlist requested',numeric:true},
      {key:'approvedGuestlistPlaces',label:'Guestlist approved',numeric:true},
      {key:'commissionCents',label:'Earned commission',numeric:true,render:(p) => money(p.commissionCents)},
    ]}/></div>
    <Dialog open={Boolean(editing)} onOpenChange={(v) => { if (!v && !busy) setEditing(null); }}><DialogContent className="team-member-dialog event-team-member-dialog sm:max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><span className="eyebrow">EVENT TEAM MEMBER</span><DialogTitle>{editing?.name}</DialogTitle><DialogDescription>{editing?.email ? `${editing.email} · ` : ''}{editing?.role}{editing?.status === 'inactive' ? ' · Removed from event' : ''}</DialogDescription></DialogHeader>
      {editing && <form onSubmit={(e) => {e.preventDefault(); if (canEditPerson && editingMode) save(removing ? 'inactive' : 'active');}} className="event-person-form">
        <div className="team-detail-metrics event-person-summary"><span><small>Referred sales</small><strong>{money(editing.salesCents || 0)}</strong></span><span><small>Earned commission</small><strong>{money(editing.commissionCents || 0)}</strong></span></div>
        <div className="team-detail-metrics event-person-activity"><span><small>Orders</small><strong>{editing.orders || 0}</strong></span><span><small>Customers</small><strong>{editing.customers || 0}</strong></span><span><small>Guestlist requested</small><strong>{editing.guestlistPlaces || 0}</strong></span><span><small>Guestlist approved</small><strong>{editing.approvedGuestlistPlaces || 0}</strong></span></div>
        <div className="team-detail-metrics event-person-bottom">{editing.code && <span><small>Referral code</small><code>{editing.code}</code></span>}<span><small>Event commission</small><strong>{rate}%</strong></span></div>
        {canEditPerson && !editingMode && <div className="team-role-editor"><Button type="button" variant="outline" onClick={() => setEditingMode(true)}>Edit member</Button></div>}
        {canEditPerson && editingMode && <div className="team-role-editor team-role-editor-open event-person-editor"><div className="event-person-edit"><label>Commission on future sales</label>{!removing && <><div className="event-commission-slider"><output className="event-commission-value" style={{ left: `clamp(25px, calc(8px + (100% - 16px) * ${rate / 40}), calc(100% - 25px))` }} aria-live="off">{rate}%</output><Slider aria-label="Event commission percentage" min={0} max={40} step={0.5} value={[rate]} onValueChange={([v]) => setRate(v)} disabled={busy}/></div><div className="commission-scale"><span>0%</span><span>40%</span></div><p className="hint">Changes apply only to future sales. Past commissions stay unchanged.</p></>}</div><div className="team-role-edit-actions"><div className="team-role-edit-primary"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : removing ? 'Save removal' : 'Save commission'}</Button><Button type="button" variant="outline" disabled={busy} onClick={cancelEdit}>Cancel</Button></div>{['active','default'].includes(editing.status) && <div className="team-role-edit-danger"><Button type="button" variant="destructive" disabled={busy} onClick={() => setRemoving((value) => !value)}>{removing ? 'Keep on event' : 'Remove from event'}</Button></div>}</div>{removing && <p className="event-warning">Save removal to stop new referrals. Past sales, commissions, and approved guestlists remain recorded.</p>}</div>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Close</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

export function EventDetail({ eventId, session, refreshToken, initialTab = null, initialGuestlistEntryId = null, onBack, onEdit, onUnauthorized }) {
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
  if (!data) return <LoadingState className="panel">Loading event performance…</LoadingState>;
  const {event, summary:s, scope} = data;
  const phase = eventPhase(event);
  const ownOnly = scope === 'own';
  const tiers = data.tiers.map((t) => ({...t, ...{saleState:event.offerings.find((o) => o.id === t.id)?.saleState}}));
  return <div className="event-detail" aria-busy={loading}>
    <div className="event-detail-nav"><Button variant="ghost" onClick={onBack}><ArrowLeft/> {ownOnly ? 'My events' : 'All events'}</Button><span>{ownOnly ? 'Your referrals and customers only' : 'Full event history · All sales channels'}</span></div>
    <section className="event-detail-hero"><span className={`event-detail-status status-pill ${phase}`}>{phase === 'past' ? 'Past · read only' : phase}</span>{event.imageUrl ? <img className="event-detail-flyer" src={mediaSrc(event.imageUrl)} alt={`${event.title} flyer`}/> : <div className="event-detail-flyer event-art-placeholder"><CalendarDays size={35}/></div>}<div className="event-detail-heading"><h2>{event.title}</h2><p><CalendarDays size={16}/>{eventDateLabel(event)} · {new Date(event.startsAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:event.location?.timezone || 'UTC',timeZoneName:'short'})}</p>{event.location?.name && <p className="event-detail-venue"><MapPin size={16}/>{event.location.name}</p>}{(event.location?.addressLine1 || event.location?.city) && <p className="event-detail-address">{[event.location?.addressLine1, [event.location?.city, event.location?.region, event.location?.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')}</p>}</div>{event.canEdit ? <Button variant="outline" onClick={() => onEdit(event)}><Pencil/> Edit event</Button> : phase === 'past' && <span className="event-readonly"><LockKeyhole size={16}/> Event closed</span>}{event.summary && <p className="event-detail-summary">{event.summary}</p>}</section>
    {notice && <p className="notice" role="status">{notice}</p>}
    {phase !== 'past' && <ReferralLink event={event} session={session} revision={revision} onUnauthorized={onUnauthorized} onInvited={() => saved('Guestlist invitation created.')}/>}
    <div className="event-metrics">{ownOnly ? <><Metric icon={CircleDollarSign} label="Your referred sales" value={money(s.salesCents)} detail="Ticket and package value before fees"/><Metric icon={Ticket} label="Your paid orders" value={s.orders.toLocaleString()}/><Metric icon={Users} label="Your admissions" value={s.admissions.toLocaleString()} detail="From your credited purchases"/><Metric icon={CircleDollarSign} label="Your commission" value={money(s.commissionCents)} detail="Recorded earnings · not payout status"/></> : <><Metric icon={CircleDollarSign} label="Total sales" value={money(s.salesCents)}/><Metric icon={CircleDollarSign} label="Commissions" value={money(s.commissionCents)}/><Metric icon={Ticket} label="Paid orders" value={s.orders.toLocaleString()}/><Metric icon={Users} label="Check-ins / expected" value={`${s.checkedIn.toLocaleString()} / ${(s.admissions + s.guestlistPlaces).toLocaleString()}`}/></>}</div>
    <Tabs defaultValue={initialTab || 'sales'} className="event-detail-tabs"><TabsList aria-label="Event detail sections"><TabsTrigger value="sales">Sales</TabsTrigger><TabsTrigger value="tickets">Offerings</TabsTrigger><TabsTrigger value="people">Team</TabsTrigger><TabsTrigger value="guestlist">Guestlist</TabsTrigger></TabsList>
    <TabsContent value="sales"><div className="event-chart-grid"><section className="panel"><span className="eyebrow">WHAT SELLS</span><h3>{ownOnly ? 'Your sales by ticket & package' : 'Sales by ticket & package'}</h3>{s.salesCents ? <SalesMixPie slices={data.tiers.filter((t) => t.salesCents > 0)}/> : <Empty title="Sales start here">Your ticket and package mix will appear after the first purchase.</Empty>}</section>{!ownOnly && <section className="panel"><span className="eyebrow">WHO BRINGS THE CROWD</span><h3>Sales by referral channel</h3>{s.salesCents ? <SalesMixPie slices={data.channels.map((c) => ({...c,id:c.name}))}/> : <Empty title="No sales yet">Direct and referred purchases will appear here.</Empty>}</section>}</div><EventAttendees customers={data.customers} onSelect={setCustomer}/></TabsContent>
      <TabsContent value="tickets"><section className="panel"><div className="section-heading"><div><h3>Every tier, accounted for</h3><p>Sales retain the price paid at purchase, even when a tier’s current price changes.</p></div>{event.canEdit && <Button variant="outline" onClick={() => onEdit(event, 2)}>Manage tiers</Button>}</div><EventTable rows={tiers} defaultSort="salesCents" defaultDescending columns={[
        {key:'name',label:'Tier'}, {key:'kind',label:'Type'}, {key:'saleState',label:'Availability',render:(t) => phase === 'past' ? 'Event ended' : saleLabels[t.saleState] || 'Archived'}, {key:'units',label:'Units sold',numeric:true},{key:'admissions',label:'Active admissions',numeric:true},{key:'salesCents',label:'Sales',numeric:true,render:(t) => money(t.salesCents)},
      ]}/>{!ownOnly && <div className="tier-schedule-list">{event.offerings.map((o) => <div key={o.id}><strong>{o.name}</strong><span>{money(o.priceCents)} · {o.entriesPerUnit} admissions per unit</span><small>{!o.isActive ? 'Closed manually. ' : ''}{o.releaseAfterOfferingId ? `Opens when ${event.offerings.find((t) => t.id === o.releaseAfterOfferingId)?.name || 'previous tier'} sells out or closes. ` : ''}{o.salesStartAt ? `From ${new Date(o.salesStartAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{o.salesEndAt ? `Until ${new Date(o.salesEndAt).toLocaleString('en-US',{timeZone:event.location?.timezone || 'UTC'})}. ` : ''}{!o.releaseAfterOfferingId && !o.salesStartAt && !o.salesEndAt && o.isActive ? 'Available while the event is on sale.' : ''}</small></div>)}</div>}</section></TabsContent>
      <TabsContent value="people">{!ownOnly && <section className="panel event-team-sales-mix" aria-label="Sales by team member"><div className="event-team-sales-heading"><h3>Sales by team member</h3><p>Ticket and package sales before fees, including direct purchases.</p></div>{s.salesCents > 0 ? <SalesMixPie slices={eventTeamSalesSlices(data)}/> : <Empty title="No sales yet">Team and direct sales will appear after the first purchase.</Empty>}</section>}<section className="panel"><EventPeople data={data} session={session} onSaved={saved} onUnauthorized={onUnauthorized}/></section></TabsContent>
      <TabsContent value="guestlist"><Guestlists event={event} initialEntryId={initialGuestlistEntryId} refreshToken={revision} onChanged={() => setRevision((value) => value + 1)} session={session} expire={onUnauthorized}/></TabsContent>
    </Tabs>
    <Dialog open={Boolean(customer)} onOpenChange={(v) => {if (!v) setCustomer(null);}}><DialogContent className="event-customer-dialog"><DialogHeader><DialogTitle>{customer?.name}</DialogTitle><DialogDescription>{customer?.email}</DialogDescription></DialogHeader>{customer && <><div className="event-financials"><div><span>Event spending</span><strong>{money(customer.salesCents)}</strong></div><div><span>Guestlist status</span><strong>{customer.guestlistStatuses.map((v) => v.replaceAll('_',' ')).join(', ') || 'No request'}</strong></div></div><div className="event-customer-purchases"><EventTable rows={customer.purchases.map((p,i) => ({...p,id:String(i)}))} defaultSort="salesCents" defaultDescending empty="No purchases for this event" columns={[{key:'name',label:'Purchased'},{key:'quantity',label:'Quantity',numeric:true},{key:'salesCents',label:'Amount',numeric:true,render:(p) => money(p.salesCents)},{key:'referredBy',label:'Source'}]}/></div></>}</DialogContent></Dialog>
  </div>;
}
