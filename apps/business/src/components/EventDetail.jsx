import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { MultiSelect } from './MultiSelect';
import { EventPromoterInvite } from './EventPromoterInvite';
import { EventTable } from './EventTable';
import { ShareEventCard } from './ShareEventCard';
import { GuestlistInviteDialog } from './GuestlistInviteDialog';
import { api } from '@/lib/api';
import { money } from '@/lib/business';
import { eventTeamRoles, filterEventTeam } from '@/lib/events';
import { customerLink } from '@/lib/customer-link';

export function ReferralLink({ event, session, revision, onUnauthorized, onInvited }) {
  const [link, setLink] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [linkRetry, setLinkRetry] = useState(0);
  const [invitePools, setInvitePools] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePoolRevision, setInvitePoolRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLink(null);
    setLinkError('');
    api(`/business/events/${event.id}/referral-link`, session)
      .then((value) => { if (active) setLink(value); })
      .catch((error) => { if (active) { if (error.status === 401) onUnauthorized(); else setLinkError(error.message); } });
    return () => { active = false; };
  }, [event.id, session, revision, linkRetry]);
  useEffect(() => {
    let active = true;
    setInvitePools(null);
    api(`/business/events/${event.id}/guestlist-invite-pools`, session)
      .then((value) => { if (active) setInvitePools(value); })
      .catch(() => { if (active) setInvitePools(null); });
    return () => { active = false; };
  }, [event.id, session, revision, linkRetry, invitePoolRevision]);
  const url = link ? new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href) : null;
  if (url) { url.searchParams.set('event', event.id); url.searchParams.set('ref', link.code); }
  const canInviteGuest = event.status === 'published' && invitePools?.open && (invitePools.direct || invitePools.own.length > 0);
  return <><ShareEventCard referralUrl={url?.toString() || ''} canInviteGuest={Boolean(canInviteGuest)} onInviteGuest={() => { setInvitePools(null); setInvitePoolRevision((value) => value + 1); setInviteOpen(true); }} referralError={linkError} onRetryReferral={() => setLinkRetry((value) => value + 1)}/><GuestlistInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} eventId={event.id} invitePools={invitePools} session={session} onUnauthorized={onUnauthorized} onSuccess={onInvited}/></>;
}

export function EventAttendees({ customers, onSelect, remote, footer }) {
  return <section className="panel"><div className="section-heading"><div><h3>Attendees</h3><p>Total spend is ticket and package purchases before fees. Unrecorded purchases at the venue are excluded.</p></div></div><div className="event-attendees-table"><EventTable remote={remote} rows={customers} onSelect={onSelect} defaultSort="salesCents" defaultDescending columns={[
    {key:'name',label:'Customer',render:(c) => <span className="attendee-card-heading"><span className="sr-only">View attendee details for </span><span>{c.name}</span><Info className="attendee-info-icon" size={18} aria-hidden="true"/></span>},
    {key:'orders',label:'Orders',numeric:true,render:(c) => <span className="attendee-metric-value">{c.orders}</span>},
    {key:'salesCents',label:'Total spend',numeric:true,render:(c) => <span className="attendee-metric-value">{money(c.salesCents)}</span>},
    {key:'admissions',label:'Tickets',numeric:true,render:(c) => <span className="attendee-metric-value">{c.admissions}</span>},
    {key:'guestlistPlaces',label:'Guestlist spots',numeric:true,render:(c) => <span className="attendee-metric-value">{c.guestlistPlaces}</span>},
    {key:'checkedIn',label:'Checked in',numeric:true,render:(c) => <span className="attendee-metric-value">{c.checkedIn}</span>},
  ]}/></div>{footer}</section>;
}

export function EventPeople({ data, session, onSaved, onUnauthorized, remote }) {
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
  const roleOptions = remote?.roleOptions || eventTeamRoles(people);
  const canEditPerson = event.canEdit && editablePeople.some((p) => p.userId === editing?.userId);
  const commissionLocked = editing?.commissionEligibility?.eligible !== true;
  const effectiveRate = person => person?.commissionEligibility?.eligible === true ? (person.effectiveCommissionBps ?? person.commissionBps ?? 0) / 100 : 0;
  const open = (person) => { setEditing(person); setPersonId(person.userId); setRate(Math.min(40, effectiveRate(person))); setEditingMode(false); setRemoving(false); setError(''); };
  const cancelEdit = () => { setRate(Math.min(40, effectiveRate(editing))); setEditingMode(false); setRemoving(false); setError(''); };
  async function save(status = 'active') {
    setBusy(true); setError('');
    try {
      await api(`/business/events/${event.id}/people`, session, { method:'PUT', body:JSON.stringify({ userId:personId, commissionBps:Math.round(rate * 100), status }) });
      setEditing(null); onSaved(status === 'inactive' ? 'Referrer removed. Existing sales and approved guestlists are preserved.' : 'Event commission saved for future purchases.');
    } catch (e) { if (e.status === 401) onUnauthorized(); else setError(e.message); } finally { setBusy(false); }
  }
  const scrollToTeam = () => requestAnimationFrame(() => teamHeadingRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  return <><div ref={teamHeadingRef} className="section-heading event-people-heading"><div className="event-people-title-row"><h3>{data.scope === 'own' ? 'Your referral' : 'Team'}</h3>{event.canEdit && <EventPromoterInvite event={event} session={session} onUnauthorized={onUnauthorized}/>}</div><p>{event.canEdit ? 'Click a person to view performance or manage their event commission.' : event.canManage ? 'This event has ended. Commission rates and earned amounts are read-only.' : 'Your sales, performance, referral code and commission earnings for this event.'}</p></div>
    {data.scope !== 'own' && <div className="event-team-controls"><div className="event-team-filter-row"><MultiSelect label="Roles" selected={(remote?.roles || roles).filter((r)=>roleOptions.some((option)=>option.id===r))} onChange={remote?.onRoles || setRoles} options={roleOptions}/></div></div>}
    <div className="event-team-table"><EventTable remote={remote} rows={remote ? people : filterEventTeam(people,roles)} onSelect={(p) => open(p)} onPageChange={scrollToTeam} selectRow defaultSort="salesCents" defaultDescending columns={[
      {key:'name',label:'Person',render:(p) => <><strong>{p.name}</strong>{p.status === 'inactive' && <small>Removed · history retained</small>}</>},
      {key:'role',label:'Role'},
      {key:'commissionBps',label:'Commission',numeric:true,render:(p) => <>{effectiveRate(p)}%{p.commissionEligibility?.eligible !== true && <small>Stripe setup required</small>}</>},
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
        {canEditPerson && editingMode && <div className="team-role-editor team-role-editor-open event-person-editor"><div className="event-person-edit"><label>Commission on future sales</label>{!removing && <><div className="event-commission-slider"><output className="event-commission-value" style={{ left: `clamp(25px, calc(8px + (100% - 16px) * ${rate / 40}), calc(100% - 25px))` }} aria-live="off">{rate}%</output><Slider aria-label="Event commission percentage" min={0} max={40} step={0.5} value={[rate]} onValueChange={([v]) => setRate(v)} disabled={busy || commissionLocked}/></div><div className="commission-scale"><span>0%</span><span>40%</span></div><p className="hint">{commissionLocked ? 'Locked at 0% until this person completes their individual Stripe onboarding. Historical commissions remain unchanged.' : 'Changes apply only to future sales. Past commissions stay unchanged.'}</p></>}</div><div className="team-role-edit-actions"><div className="team-role-edit-primary"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : removing ? 'Save removal' : 'Save commission'}</Button><Button type="button" variant="outline" disabled={busy} onClick={cancelEdit}>Cancel</Button></div>{['active','default'].includes(editing.status) && <div className="team-role-edit-danger"><Button type="button" variant="destructive" disabled={busy} onClick={() => setRemoving((value) => !value)}>{removing ? 'Keep on event' : 'Remove from event'}</Button></div>}</div>{removing && <p className="event-warning">Save removal to stop new referrals. Past sales, commissions, and approved guestlists remain recorded.</p>}</div>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Close</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
