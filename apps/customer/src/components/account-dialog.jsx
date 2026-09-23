import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, LogOut, MapPin, Ticket, Users, UserRound, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { api } from '../lib/api';
import { money } from '../lib/discovery';
import { eventAddress, eventDate, eventTime } from '../lib/presentation';
import { EventArtwork } from './event-artwork';
import { NightCard } from './night-card';
import { LoadingIndicator } from './loading-indicator';
import { eventVenueName } from '../lib/event-venue';

export function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
const statusLabel = { pending: 'Awaiting approval', confirmed: 'Approved', rejected: 'Declined', checked_in: 'Checked in', no_show: 'Not attended' };

function InlineAccount({ children }) { return children; }

export function AccountDialog({ open, onOpenChange, session, initialTab = 'plans', onProfile, onSignOut, onReferral, embedded = false, notificationBooking, onNotificationOpened }) {
  const Container = embedded ? InlineAccount : Dialog;
  const Content = embedded ? 'div' : DialogContent;
  const scrollContainer = useRef(null), ticketReturn = useRef(null), restoreTicketPosition = useRef(false);
  const [tab, setTab] = useState(initialTab), [period, setPeriod] = useState('upcoming'), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [connections, setConnections] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [ticket, setTicket] = useState(null), [ticketBusy, setTicketBusy] = useState('');
  const [circlePerson, setCirclePerson] = useState('all'), [circleLimit, setCircleLimit] = useState(12);
  const circlePeople = [...new Map(connections.map((entry) => [entry.referrer.id, entry.referrer])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const circleEvents = connections.filter((entry) => circlePerson === 'all' || entry.referrer.id === circlePerson);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [consents, setConsents] = useState({}), [message, setMessage] = useState('');
  useLayoutEffect(() => {
    if (ticket) {
      if (embedded) window.scrollTo({ top: scrollContainer.current?.offsetTop || 0 });
      else scrollContainer.current?.scrollTo({ top: 0 });
    }
    else if (restoreTicketPosition.current && ticketReturn.current) {
      const { top, id } = ticketReturn.current;
      scrollContainer.current?.querySelector(`[data-ticket-id="${id}"]`)?.focus({ preventScroll: true });
      if (embedded) window.scrollTo({ top });
      else scrollContainer.current?.scrollTo({ top });
      restoreTicketPosition.current = false;
    }
  }, [ticket?.id]);
  useEffect(() => {
    if (!open || !ticket?.id || tab !== 'plans') return;
    const controller = new AbortController(); let inFlight = false;
    const refreshTickets = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const updated = await api(ticket.kind === 'guestlist' ? `/customer/guestlists/${ticket.id}/pass` : `/customer/purchases/${ticket.id}/tickets`, { token: session.accessToken, signal: controller.signal });
        if (!controller.signal.aborted) {
          setTicket(updated);
          setData((current) => current && ({ ...current, guestlists: current.guestlists.map((guest) => updated.kind === 'guestlist' && guest.id === updated.id ? { ...guest, status: updated.tickets[0].status } : guest), orders: current.orders.map((order) => order.id !== updated.id ? order : ({ ...order, items: order.items.map((item) => ({ ...item, tickets: item.tickets.map((t) => ({ ...t, ...(updated.tickets.find((row) => row.id === t.id) || {}) })) })) })) }));
        }
      } catch (error) { if (!controller.signal.aborted) setError(`Ticket status could not refresh: ${error.message}`); }
      finally { inFlight = false; }
    };
    const interval = setInterval(refreshTickets, 5000);
    window.addEventListener('focus', refreshTickets);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener('focus', refreshTickets); };
  }, [open, ticket?.id, tab, session?.accessToken]);
  useEffect(() => { if (open) { setTab(initialTab); setTicket(null); setError(''); setMessage(''); } }, [open, initialTab]);
  useEffect(() => {
    if (!open || !notificationBooking) return;
    const { ticket } = notificationBooking;
    ticketReturn.current = null; restoreTicketPosition.current = false;
    setTab('plans'); setTicket(ticket); setError(''); setPage(1);
    setPeriod(new Date(ticket.event.endsAt) <= new Date() ? 'past' : 'upcoming');
    onNotificationOpened?.();
  }, [open, notificationBooking, onNotificationOpened]);
  useEffect(() => {
    setName(session?.user.displayName || ''); setPhone(session?.user.phone || '');
    setConsents({ marketingConsent: Boolean(session?.user.marketingConsentAt), transactionalSmsConsent: Boolean(session?.user.transactionalSmsConsentAt), marketingSmsConsent: Boolean(session?.user.marketingSmsConsentAt) });
  }, [session?.user]);
  useEffect(() => {
    if (!open || !session) return;
    if (tab === 'profile') { setBusy(false); return; }
    const controller = new AbortController(); setBusy(true); setError(''); setData(null); setConnections([]);
    api(tab === 'circle' ? '/customer/connections' : `/customer/bookings?period=${period}&page=${page}`, { token: session.accessToken, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { if (tab === 'circle') setConnections(result); else setData(result); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, tab, period, page, refresh, session?.accessToken]);
  async function showTicket(id, kind = 'purchase') {
    ticketReturn.current = { id, top: embedded ? window.scrollY : scrollContainer.current?.scrollTop || 0 };
    setTicketBusy(id); setError('');
    try { setTicket(await api(kind === 'guestlist' ? `/customer/guestlists/${id}/pass` : `/customer/purchases/${id}/tickets`, { token: session.accessToken })); }
    catch (error) { setError(error.message); }
    finally { setTicketBusy(''); }
  }
  async function saveProfile(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const user = await api('/customer/profile', { token: session.accessToken, method: 'PATCH', body: { displayName: name, phone, ...consents } }); onProfile(user); setMessage('Your profile is updated.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <Container open={open && Boolean(session)} onOpenChange={onOpenChange}>
    <Content ref={scrollContainer} className={embedded ? 'booked-content' : 'account-modal'}>
      {!embedded && <DialogHeader className="account-heading">
        <span className="profile-avatar large" aria-hidden="true">{initials(session?.user.displayName)}</span>
        <div><p className="eyebrow">YOUR NITEWIDE</p><DialogTitle>A little more you.</DialogTitle><DialogDescription>{session?.user.displayName} · Your nights, your people, your plans.</DialogDescription></div>
      </DialogHeader>}
      <Tabs value={tab} onValueChange={(value) => { setTab(value); setTicket(null); setError(''); }}>
        <TabsList className={embedded ? 'sr-only' : 'account-tabs'}><TabsTrigger value="plans"><Ticket size={16} /> My nights</TabsTrigger>{!embedded && <><TabsTrigger value="circle"><Users size={16} /> Connections</TabsTrigger><TabsTrigger value="profile"><UserRound size={16} /> Profile</TabsTrigger></>}</TabsList>
        {error && <p className="account-error" role="alert">{error} <button onClick={() => setRefresh((v) => v + 1)}>Try again</button></p>}
        <TabsContent value="plans">
          {ticket ? <section className="ticket-view">
            <Button variant="ghost" onClick={() => { restoreTicketPosition.current = true; setTicket(null); }}><ChevronLeft size={16} /> Back to my nights</Button>
            <div className="purchase-ticket-heading"><EventArtwork event={ticket.event} className="booking-flyer" /><div><p className="eyebrow">{ticket.demo ? 'DEMO PURCHASE' : 'YOUR NIGHT, CONFIRMED'}</p><h3>{ticket.event.title}</h3><p>{eventDate(ticket.event)} · {eventTime(ticket.event)}</p><p>{eventVenueName(ticket.event)}</p><p aria-label="Event address">{eventAddress(ticket.event.location)}</p></div></div>
            <div className="ticket-list-summary" aria-live="polite"><strong>{ticket.tickets.filter((t) => t.status === 'checked_in').length} of {ticket.tickets.length} checked in</strong><span>Entry status updates automatically</span></div>
            <div className="admission-list">{ticket.tickets.map((entry, index) => <article key={entry.id} className={`admission-pass ${entry.status}`} aria-label={`${ticket.kind === 'guestlist' ? 'Guest list entry' : `Ticket ${index + 1}`}: ${entry.status === 'checked_in' ? 'Checked in' : entry.status}`}>
              <div className="pass-code">{entry.qrImage ? <img src={entry.qrImage} alt={`QR code for ${ticket.kind === 'guestlist' ? 'guest list entry' : `ticket ${index + 1}`}, ${entry.offering}`} /> : <div className="pass-no-code"><Ticket /><span>QR unavailable</span></div>}</div>
              <div className="pass-info"><p className="eyebrow">{ticket.kind === 'guestlist' ? 'GUEST LIST ENTRY' : `TICKET ${index + 1} OF ${ticket.tickets.length}`}</p><h4>{entry.offering}</h4><span className="pass-status">{entry.status === 'checked_in' ? <><CheckCircle2 size={16} /> Checked in</> : ['valid', 'confirmed'].includes(entry.status) ? (entry.qrImage ? 'Ready for entry' : 'Event ended or unavailable') : statusLabel[entry.status] || entry.status.replace('_', ' ')}</span><p>{entry.checkedInAt ? `Admitted ${new Date(entry.checkedInAt).toLocaleString('en-US', { timeZone: ticket.event.location?.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ticket.kind === 'guestlist' ? `${ticket.partySize} ${ticket.partySize === 1 ? 'guest' : 'guests'} · One code for your party` : 'One admission · Keep this code private'}</p><small>{ticket.demo ? 'Local demo only · No payment collected' : entry.status === 'checked_in' ? 'Entry confirmed. This code cannot be used again.' : ticket.kind === 'guestlist' ? 'Arrive together. This code checks in your entire approved party.' : 'Show this code at the door.'}</small><code>{entry.id}</code></div>
            </article>)}</div>
            {!ticket.tickets.length && <p className="account-empty">No tickets are currently assigned to you for this purchase.</p>}
            {ticket.kind !== 'guestlist' && <details className="booking-receipt purchase-receipt"><summary>Purchase receipt · {money(ticket.totalCents, ticket.currency)}</summary><p>Tickets & packages: {money(ticket.subtotalCents, ticket.currency)}<br />Service fee: {money(ticket.totalCents - ticket.subtotalCents, ticket.currency)}</p><small>Order {ticket.id}</small></details>}
          </section> : <>
            <div className="account-toolbar"><div className="period-switch" aria-label="Booking period">{['upcoming', 'past'].map((value) => <button key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); setPage(1); }}>{value === 'upcoming' ? 'Upcoming' : 'Past nights'}</button>)}</div><button className="account-refresh" aria-label="Refresh bookings" onClick={() => setRefresh((v) => v + 1)}><RefreshCw size={16} /></button></div>
            {busy && <div className="account-loading"><LoadingIndicator>Finding your nights…</LoadingIndicator></div>}
            {!busy && data && !data.orders.length && !data.guestlists.length && <div className="account-empty"><CalendarDays /><h3>{period === 'upcoming' ? 'Something to look forward to.' : 'Your stories will live here.'}</h3><p>{period === 'upcoming' ? 'Your tickets and guestlist requests appear here after booking.' : 'Past purchases and guestlist visits appear here.'}</p><Button onClick={() => onOpenChange(false)}>Explore events <ArrowRight size={16} /></Button></div>}
            {data?.entries?.map((row) => {
              const entry = (row.kind === 'guestlist' ? data.guestlists : data.orders).find((item) => item.id === row.id);
              return entry ? <NightCard key={`${row.kind}-${row.id}`} entry={entry} kind={row.kind} busy={ticketBusy} onOpen={showTicket} /> : null;
            })}
            {data && data.total > 10 && <div className="account-pagination"><Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /> Previous</Button><span>{page} / {Math.ceil(data.total / 10)}</span><Button variant="ghost" disabled={page * 10 >= data.total} onClick={() => setPage(page + 1)}>Next <ChevronRight /></Button></div>}
          </>}
        </TabsContent>
        <TabsContent value="circle"><div className="circle-intro"><p className="eyebrow">FAMILIAR FACES. NEW PLANS.</p><h3>Book another night with your connections.</h3><p>Discover upcoming events from people you’ve booked or joined a guestlist through before. Find them across venues and cities, and book with them again.</p></div>
          {busy && <div className="account-loading"><LoadingIndicator>Finding your connections…</LoadingIndicator></div>}
          {!busy && !connections.length && !error && <div className="account-empty"><Users /><h3>Your next connection starts with a night out.</h3><p>After a referred purchase or guestlist invitation, their upcoming events will appear here.</p></div>}
          {!!connections.length && <div className="account-toolbar"><Select value={circlePerson} onValueChange={(value) => { setCirclePerson(value); setCircleLimit(12); }}><SelectTrigger aria-label="Filter connections"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All connections</SelectItem>{circlePeople.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select><span>{circleEvents.length} upcoming</span></div>}
          <div className="circle-grid">{circleEvents.slice(0, circleLimit).map((entry) => <article key={`${entry.event.id}-${entry.referrer.id}`}><div className="circle-person"><span className="profile-avatar">{initials(entry.referrer.name)}</span><div><small>GO WITH</small><strong>{entry.referrer.name}</strong></div></div><h3>{entry.event.title}</h3><p>{eventDate(entry.event)} · {eventTime(entry.event)}</p><p>{eventVenueName(entry.event, entry.event.location?.city)}</p><Button onClick={async () => { setError(''); try { await onReferral(entry); } catch (error) { setError(error.message); } }}>Explore with {entry.referrer.name.split(' ')[0]} <ArrowRight size={16} /></Button></article>)}</div>
          {circleEvents.length > circleLimit && <Button className="circle-more" variant="outline" onClick={() => setCircleLimit((value) => value + 12)}>More events from connections</Button>}
        </TabsContent>
        <TabsContent value="profile"><form className="profile-form" onSubmit={saveProfile}><h3>Your details</h3><p>A familiar face, wherever the night takes you.</p><label>Display name<input value={name} maxLength={120} required autoComplete="name" onChange={(event) => setName(event.target.value)} /></label><label>Email<input value={session?.user.email || ''} disabled type="email" /></label><small>Your sign-in email is managed separately.</small><label>Phone number<input value={phone} type="tel" autoComplete="tel" placeholder="+1 (407) 555-0123" onChange={(event) => setPhone(event.target.value)} /></label><fieldset><legend>Stay in the loop</legend>{[['transactionalSmsConsent','Event and booking reminders by text'], ['marketingSmsConsent','Offers and recommendations by text'], ['marketingConsent','Offers and recommendations by email']].map(([key,label]) => <label className="consent-choice" key={key}><input type="checkbox" checked={Boolean(consents[key])} onChange={(event) => setConsents({ ...consents, [key]: event.target.checked })} />{label}</label>)}<small>Optional. Email and text delivery are coming soon; your preferences are saved.</small></fieldset><Button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'}</Button>{message && <p role="status">{message}</p>}</form><div className="profile-signout"><Button variant="ghost" onClick={onSignOut}><LogOut size={16} /> Sign out</Button></div></TabsContent>
      </Tabs>
    </Content>
  </Container>;
}
