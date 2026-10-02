import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, LogOut, Ticket, UserRound, RefreshCw, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Tabs, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { NightCard } from './night-card';
import { LoadingIndicator } from './loading-indicator';
import { AdmissionPassView } from './admission-pass-view';
import { loadPassCache, removePassCache, savePassCache } from '../lib/pass-cache';
import { ProfilePasswordForm } from './profile-password-form';
import { GuestlistQuantity } from './guestlist-quantity';
import { customerGuestlistMaxPartySize, validGuestlistPartySize } from '../lib/guestlist-quantity';

export function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function InlineAccount({ children }) { return children; }
function withPassKind(pass, kind) { return { ...pass, kind: pass.kind || kind }; }

export function AccountDialog({ open, onOpenChange, session, onProfile, onSessionChanged, onSignOut, embedded = false, notificationBooking, bookingRoute, onBookingRouteChange, onNotificationOpened, onResumeCheckout, bookingsRevision = 0 }) {
  const Container = embedded ? InlineAccount : Dialog;
  const Content = embedded ? 'div' : DialogContent;
  const scrollContainer = useRef(null), ticketReturn = useRef(null), restoreTicketPosition = useRef(false);
  const [tab, setTab] = useState(embedded ? 'plans' : 'profile'), [period, setPeriod] = useState('upcoming'), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [working, setBusy] = useState(false), [error, setError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false), [changingPassword, setChangingPassword] = useState(false);
  const busy = working || passwordBusy;
  const [refresh, setRefresh] = useState(0), [ticket, setTicket] = useState(null), [ticketBusy, setTicketBusy] = useState('');
  const [ticketIndex, setTicketIndex] = useState(0), [cachedPass, setCachedPass] = useState(false);
  const [editingSpots, setEditingSpots] = useState(false), [requestedSpots, setRequestedSpots] = useState(1);
  const guestlistEditLock = useRef(false);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [confirmEmail, setConfirmEmail] = useState(''), [phone, setPhone] = useState(''), [confirmPhone, setConfirmPhone] = useState('');
  const [consents, setConsents] = useState({}), [message, setMessage] = useState(''), [resendCooldown, setResendCooldown] = useState(0);
  const previousBookingRoute = useRef(bookingRoute);
  useEffect(() => { setEditingSpots(false); setRequestedSpots(ticket?.partySize || 1); }, [ticket?.id]);
  useEffect(() => {
    if (!embedded) return;
    if (previousBookingRoute.current && !bookingRoute) setTicket(null);
    previousBookingRoute.current = bookingRoute;
  }, [bookingRoute, embedded]);
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
        const updated = withPassKind(await api(ticket.kind === 'guestlist' ? `/customer/guestlists/${ticket.id}/pass` : `/customer/purchases/${ticket.id}/tickets`, { token: session.accessToken, signal: controller.signal }), ticket.kind);
        if (!controller.signal.aborted) {
          setTicket(updated);
          setTicketIndex((index) => Math.min(index, Math.max(0, updated.tickets.length - 1)));
          setCachedPass(false);
          if (updated.tickets.some((row) => row.qrImage)) savePassCache(session.user.id, updated);
          else removePassCache(session.user.id, ticket.kind, updated.id);
          setData((current) => current && ({ ...current, guestlists: current.guestlists.map((guest) => updated.kind === 'guestlist' && guest.id === updated.id ? { ...guest, status: updated.status || updated.tickets[0]?.status } : guest), orders: current.orders.map((order) => order.id !== updated.id ? order : ({ ...order, items: order.items.map((item) => ({ ...item, tickets: item.tickets.map((t) => ({ ...t, ...(updated.tickets.find((row) => row.id === t.id) || {}) })) })) })) }));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.status && [401, 403, 404].includes(error.status)) {
          removePassCache(session.user.id, ticket.kind, ticket.id);
          setTicket(null);
          setError('This pass is no longer available.');
        } else if (!error.status || error.status >= 500) {
          const cached = loadPassCache(session.user.id, ticket.kind, ticket.id);
          if (cached) { setTicket(withPassKind(cached, ticket.kind)); setCachedPass(true); }
          else { setTicket((current) => current && ({ ...current, tickets: current.tickets.map((entry) => ({ ...entry, qrImage: null })) })); setCachedPass(false); setError('Could not verify this pass. Reconnect to refresh it.'); }
        }
      }
      finally { inFlight = false; }
    };
    const interval = setInterval(refreshTickets, 5000);
    window.addEventListener('focus', refreshTickets);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener('focus', refreshTickets); };
  }, [open, ticket?.id, tab, session?.accessToken]);
  useEffect(() => { setEditingProfile(false); setChangingPassword(false); if (open) { setTab(embedded ? 'plans' : 'profile'); setTicket(null); setTicketIndex(0); setCachedPass(false); setError(''); setMessage(''); } }, [open, embedded]);
  useEffect(() => {
    if (!open || !notificationBooking) return;
    const { ticket: incoming } = notificationBooking;
    const ticket = withPassKind(incoming, bookingRoute?.split(':')[0] || incoming.kind || 'purchase');
    ticketReturn.current = null; restoreTicketPosition.current = false;
    // A notification/deep link can supersede an in-flight pass request. Its
    // cleanup suppresses that request's finally handler, so clear its busy
    // state when accepting the already-loaded pass as well.
    setTab('plans'); setTicket(ticket); setTicketBusy(''); setTicketIndex(0); setCachedPass(false); savePassCache(session.user.id, ticket); setError(''); setPage(1);
    setPeriod(new Date(ticket.event.endsAt) <= new Date() ? 'past' : 'upcoming');
    onNotificationOpened?.();
  }, [open, notificationBooking, onNotificationOpened]);
  useEffect(() => {
    if (!embedded || !open || !session || !bookingRoute || notificationBooking) return;
    const [kind, id] = bookingRoute.split(':');
    if (ticket?.id === id && ticket?.kind === kind) return;
    let active = true;
    setTicket(null);
    setTicketBusy(id); setError('');
    api(kind === 'guestlist' ? `/customer/guestlists/${id}/pass` : `/customer/purchases/${id}/tickets`, { token: session.accessToken })
      .then((response) => { if (active) { const pass = withPassKind(response, kind); setTicket(pass); setTicketIndex(0); setCachedPass(false); savePassCache(session.user.id, pass); } })
      .catch((error) => {
        if (!active) return;
        if (error.status && [401, 403, 404].includes(error.status)) removePassCache(session.user.id, kind, id);
        else if (!error.status || error.status >= 500) {
          const cached = loadPassCache(session.user.id, kind, id);
          if (cached) { setTicket(withPassKind(cached, kind)); setTicketIndex(0); setCachedPass(true); return; }
        }
        setError(`This booking could not be opened: ${error.message}`);
      })
      .finally(() => { if (active) setTicketBusy(''); });
    return () => { active = false; };
  }, [embedded, open, bookingRoute, session?.accessToken, notificationBooking]);
  useEffect(() => {
    setName(session?.user.displayName || ''); setEmail(session?.user.email || ''); setConfirmEmail(''); setPhone(session?.user.phone || ''); setConfirmPhone('');
    setConsents({ marketingConsent: Boolean(session?.user.marketingConsentAt), transactionalSmsConsent: Boolean(session?.user.transactionalSmsConsentAt), marketingSmsConsent: Boolean(session?.user.marketingSmsConsentAt) });
  }, [session?.user]);
  useEffect(() => {
    if (!open || !session) return;
    if (tab === 'profile') { setBusy(false); return; }
    const controller = new AbortController(); setBusy(true); setError(''); setData(null);
    api(`/customer/bookings?period=${period}&page=${page}`, { token: session.accessToken, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, tab, period, page, refresh, bookingsRevision, session?.accessToken]);
  async function showTicket(id, kind = 'purchase') {
    ticketReturn.current = { id, top: embedded ? window.scrollY : scrollContainer.current?.scrollTop || 0 };
    setTicketBusy(id); setError('');
    try {
      const booking = kind === 'purchase' && data?.orders.find(order => order.id === id);
      if (booking?.canResumePayment && onResumeCheckout) { await onResumeCheckout(id); return; }
      const pass = withPassKind(await api(kind === 'guestlist' ? `/customer/guestlists/${id}/pass` : `/customer/purchases/${id}/tickets`, { token: session.accessToken }), kind);
      setTicket(pass); setTicketIndex(0); setCachedPass(false); setRequestedSpots(pass.partySize || 1); savePassCache(session.user.id, pass);
      if (embedded) onBookingRouteChange?.(`${kind}:${id}`);
    } catch (error) {
      if (error.status && [401, 403, 404].includes(error.status)) removePassCache(session.user.id, kind, id);
      else if (!error.status || error.status >= 500) {
        const cached = loadPassCache(session.user.id, kind, id);
        if (cached) { setTicket(withPassKind(cached, kind)); setTicketIndex(0); setCachedPass(true); if (embedded) onBookingRouteChange?.(`${kind}:${id}`); return; }
      }
      setError(error.message);
    }
    finally { setTicketBusy(''); }
  }
  async function saveRequestedSpots(event) {
    event.preventDefault();
    if (guestlistEditLock.current || ticketBusy || !ticket || ticket.kind !== 'guestlist' || ticket.tickets[0]?.status !== 'pending' || cachedPass) return;
    if (!validGuestlistPartySize(requestedSpots)) { setError(`Choose between 1 and ${customerGuestlistMaxPartySize} spots to update your request.`); return; }
    guestlistEditLock.current = true; setTicketBusy(ticket.id); setError('');
    try {
      const result = await api(`/customer/guestlists/${ticket.id}`, { token: session.accessToken, method: 'PATCH', body: { partySize: requestedSpots } });
      setTicket((current) => current?.id === ticket.id ? { ...current, partySize: result.entry.partySize } : current);
      setEditingSpots(false); setRefresh((value) => value + 1);
    } catch (error) { setError(error.message); }
    finally { guestlistEditLock.current = false; setTicketBusy(''); }
  }
  async function saveProfile(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    const changedEmail = email.trim().toLowerCase() !== session.user.email;
    const changedPhone = phone !== (session.user.phone || '');
    if (changedEmail && email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) { setBusy(false); setError('Email addresses must match.'); return; }
    if (changedPhone && phone.trim() !== confirmPhone.trim()) { setBusy(false); setError('Phone numbers must match.'); return; }
    try {
      const result = await api('/auth/profile', { token: session.accessToken, method: 'PATCH', body: { displayName: name, email, ...(changedEmail ? { confirmEmail } : {}), phone, ...(changedPhone ? { confirmPhone } : {}) } });
      onProfile(result.user || result);
      setConfirmEmail(''); setConfirmPhone('');
      setEditingProfile(false); setChangingPassword(false);
      setMessage(changedEmail ? result.verificationMessage || 'Your profile changed. Check your new email for a verification link if delivery is available.' : 'Your profile is updated.');
    }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function savePreferences(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    try { const user = await api('/customer/profile', { token: session.accessToken, method: 'PATCH', body: { displayName: session.user.displayName, phone: session.user.phone || '', ...consents } }); onProfile(user); setMessage('Your preferences are updated.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function resendVerification() {
    if (resendCooldown) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await api('/auth/email/resend', { token: session.accessToken, method: 'POST' }); setMessage(result.message || 'If verification is needed and email delivery is available, a new link will arrive shortly.'); setResendCooldown(60); }
    catch (error) { setError(error.status === 503 ? 'Email delivery is unavailable in this environment. Try again when it is enabled.' : error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!resendCooldown) return;
    const timer = setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);
  return <Container open={open && Boolean(session)} onOpenChange={onOpenChange}>
    <Content ref={scrollContainer} className={embedded ? 'booked-content' : 'account-modal'}>
      {!embedded && <DialogHeader className="account-heading">
        <span className="profile-avatar large" aria-hidden="true">{initials(session?.user.displayName)}</span>
        <div><p className="eyebrow">YOUR NITEWIDE</p><DialogTitle>Your profile.</DialogTitle><DialogDescription>{session?.user.displayName} · Account details and preferences.</DialogDescription></div>
      </DialogHeader>}
      <Tabs value={tab} onValueChange={(value) => { setTab(value); setTicket(null); setError(''); }}>
        {error && <p className="account-error" role="alert">{error} <button onClick={() => setRefresh((v) => v + 1)}>Try again</button></p>}
        <TabsContent value="plans">
          {ticket ? <section className="ticket-view">
            <Button variant="ghost" disabled={guestlistEditLock.current} onClick={() => { if (guestlistEditLock.current) return; restoreTicketPosition.current = true; setTicket(null); onBookingRouteChange?.(null); }}><ChevronLeft size={16} /> Back to my nights</Button>
            <AdmissionPassView ticket={ticket} index={Math.min(ticketIndex, Math.max(0, ticket.tickets.length - 1))} onIndex={setTicketIndex} cached={cachedPass} />
            {ticket.canResumePayment && onResumeCheckout && <Button disabled={Boolean(ticketBusy)} onClick={async () => { setTicketBusy(ticket.id); setError(''); try { await onResumeCheckout(ticket.id); } catch (error) { setError(error.message); } finally { setTicketBusy(''); } }}>{ticketBusy ? <LoadingIndicator>Restoring checkout…</LoadingIndicator> : 'Resume checkout'}</Button>}
            {ticket.kind === 'guestlist' && ticket.tickets[0]?.status === 'pending' && !cachedPass && <div className="pending-guestlist-actions">
              <p>Your request is pending review. You can change your party size or withdraw it while it is pending.</p>
              {editingSpots ? <form onSubmit={saveRequestedSpots}>
                <GuestlistQuantity id="booked-guestlist-spots" label="Spots" value={requestedSpots} max={customerGuestlistMaxPartySize} disabled={Boolean(ticketBusy)} onChange={setRequestedSpots} describedBy={requestedSpots > customerGuestlistMaxPartySize ? 'booked-guestlist-spots-help' : undefined} />
                {requestedSpots > customerGuestlistMaxPartySize && <p id="booked-guestlist-spots-help" className="guestlist-quantity-help">Your existing request is for {ticket.partySize} spots. Reduce it to {customerGuestlistMaxPartySize} or fewer to save changes.</p>}
                <Button type="submit" disabled={Boolean(ticketBusy) || !validGuestlistPartySize(requestedSpots) || requestedSpots === ticket.partySize}>{ticketBusy ? 'Saving…' : 'Save spots'}</Button>
                <Button type="button" variant="ghost" disabled={Boolean(ticketBusy)} onClick={() => setEditingSpots(false)}>Cancel</Button>
              </form> : <Button variant="outline" disabled={Boolean(ticketBusy)} onClick={() => { setRequestedSpots(ticket.partySize || 1); setEditingSpots(true); }}>Edit spots</Button>}
              <Button variant="ghost" disabled={Boolean(ticketBusy)} onClick={async () => { if (guestlistEditLock.current || ticketBusy || !window.confirm('Withdraw this pending guestlist request?')) return; guestlistEditLock.current = true; setTicketBusy(ticket.id); setError(''); try { await api(`/customer/guestlists/${ticket.id}`, { token: session.accessToken, method: 'DELETE' }); setTicket(null); setRefresh((value) => value + 1); } catch (error) { setError(error.message); } finally { guestlistEditLock.current = false; setTicketBusy(''); } }}>Withdraw request</Button>
            </div>}
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
        <TabsContent value="profile" className="profile-content-grid">
          <section className="customer-profile-details" aria-label="Profile">
          <div className="profile-details-heading"><h3>Profile</h3><p>Keep your contact information current for bookings and guestlist updates.</p></div>
          <div className="verification-row"><strong>Email verification</strong><span>{session?.user.emailVerifiedAt ? 'Verified' : 'Not verified'}</span>{!session?.user.emailVerifiedAt && <Button type="button" variant="ghost" disabled={busy || Boolean(resendCooldown)} onClick={resendVerification}>{resendCooldown ? `Retry in ${resendCooldown}s` : 'Resend'}</Button>}</div>
          <div className="customer-profile-edit-grid" data-editing={editingProfile}>
          <form className="profile-form" onSubmit={saveProfile}>
            <label>Display name<input value={name} maxLength={120} required autoComplete="name" disabled={!editingProfile || busy} onChange={(event) => setName(event.target.value)} /></label>
            <label>Email<input value={email} type="email" required autoComplete="email" disabled={!editingProfile || busy} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Phone number<input value={phone} type="tel" aria-label="Phone number" aria-describedby={phone ? 'customer-phone-verification' : undefined} autoComplete="tel" placeholder="+1 (407) 555-0123" disabled={!editingProfile || busy} onChange={(event) => setPhone(event.target.value)} />{phone && <small id="customer-phone-verification">Phone: {session?.user.phoneVerifiedAt ? 'Verified' : 'Not verified'}</small>}</label>
            <div className="profile-password-row"><label htmlFor="customer-password-display">Password<input id="customer-password-display" type="password" placeholder="••••••••" value="" readOnly disabled autoComplete="off" /></label>{editingProfile && <Button type="button" variant="outline" disabled={busy || changingPassword} aria-expanded={changingPassword} aria-controls="customer-password-editor" onClick={() => setChangingPassword(true)}>Change password</Button>}</div>
            {email.trim().toLowerCase() !== session?.user.email && <label>Confirm new email<input value={confirmEmail} type="email" required autoComplete="off" disabled={busy} onChange={(event) => setConfirmEmail(event.target.value)} /></label>}
            {phone !== (session?.user.phone || '') && <label>Confirm new phone<input value={confirmPhone} type="tel" autoComplete="off" required={Boolean(phone)} disabled={busy} onChange={(event) => setConfirmPhone(event.target.value)} /></label>}
            <div className="profile-form-actions">{editingProfile ? <><Button type="button" variant="outline" disabled={busy} onClick={() => { setName(session.user.displayName); setEmail(session.user.email); setPhone(session.user.phone || ''); setConfirmEmail(''); setConfirmPhone(''); setError(''); setEditingProfile(false); setChangingPassword(false); }}>Cancel</Button><Button disabled={busy} aria-busy={working} type="submit">{working ? 'Saving…' : 'Save details'}</Button></> : <Button type="button" variant="outline" onClick={() => { setMessage(''); setEditingProfile(true); }}><Pencil size={16} aria-hidden="true" /> Edit</Button>}</div>
          </form>
          {editingProfile && changingPassword && <div id="customer-password-editor"><ProfilePasswordForm session={session} open={open} disabled={working} onBusyChange={setPasswordBusy} onCancel={() => setChangingPassword(false)} onSessionChanged={(updated) => { onSessionChanged(updated); setChangingPassword(false); setEditingProfile(false); setMessage('Password changed. Other sessions have been signed out.'); }} /></div>}
          </div>
          </section>
          <form className="profile-form profile-preferences" onSubmit={savePreferences}>
            <h3>Settings</h3>
            <fieldset><legend>Stay in the loop</legend>{[['transactionalSmsConsent','Event and booking reminders by text'], ['marketingSmsConsent','Offers and recommendations by text'], ['marketingConsent','Offers and recommendations by email']].map(([key,label]) => <label className="consent-choice" key={key}><input type="checkbox" checked={Boolean(consents[key])} onChange={(event) => setConsents({ ...consents, [key]: event.target.checked })} />{label}</label>)}<small>Optional. Delivery depends on the messaging services enabled for this environment.</small></fieldset>
            <Button disabled={busy} aria-busy={working} type="submit">Save preferences</Button>
          </form>
          {message && <p className="profile-message" role="status">{message}</p>}
          <div className="profile-signout"><Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { setError(await onSignOut(false) || ''); } finally { setBusy(false); } }}><LogOut size={16} /> Sign out</Button><Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { setError(await onSignOut(true) || ''); } finally { setBusy(false); } }}>Sign out everywhere</Button></div>
        </TabsContent>
      </Tabs>
    </Content>
  </Container>;
}
