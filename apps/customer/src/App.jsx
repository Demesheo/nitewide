import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  CalendarDays,
  Search,
  Ticket,
  Wine,
  Users,
  Minus,
  Plus,
  Check,
  LoaderCircle,
  Compass,
  X,
  LocateFixed,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { EventCard } from "./components/event-card";
import { EventArtwork } from './components/event-artwork';
import { eventAddress, eventDate, eventTime } from "./lib/presentation";
import { LoadingIndicator } from './components/loading-indicator';
import { upcomingSavedEvents } from './lib/saved-events';
import { AuthDialog } from "./components/auth-dialog";
import { Notifications } from "./components/notifications";
import { AccountDialog, initials } from './components/account-dialog';
import { ConnectionsPage } from './components/connections-page';
import { EventConnectionPicker } from './components/event-connection-picker';
import { useConnections } from './lib/use-connections';
import { focusEventDialogStart, openEventDialogAtTop } from './lib/dialog-focus';
import { detectCurrentCity } from "./discovery-defaults";
import { api } from "./lib/api";
import { businessLink } from './lib/business-link';
import { referralCodeForEvent, referralFromSearch } from './lib/referral';
import {
  availableQuantity,
  offeringAvailabilityLabel,
  checkoutTotal,
  cityName,
  filterDiscoveryEvents,
  discoveryDateRange,
  filterUpcomingWeek,
  upcomingWeekRange,
  money,
  readStorage,
  writeStorage,
} from "./lib/discovery";

const calendarLabel = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const Brand = () => (
  <a href="/" aria-label="Nitewide home" className="brand">
    nitewide
  </a>
);
function validSession() {
  const session = readStorage("nitewide.session", null);
  return session?.user?.id &&
    session.accessToken &&
    new Date(session.expiresAt) > new Date()
    ? session
    : null;
}

export default function App() {
  const [events, setEvents] = useState([]),
    [loadState, setLoadState] = useState("loading");
  const [city, setCity] = useState(""),
    [date, setDate] = useState(""),
    [query, setQuery] = useState("");
  const [saved, setSaved] = useState(() => readStorage("nitewide.saved", [])),
    [view, setView] = useState("discover");
  const [session, setSession] = useState(validSession),
    [authOpen, setAuthOpen] = useState(false),
    [walletOpen, setWalletOpen] = useState(false);
  const [accountTab, setAccountTab] = useState('plans');
  const [connectionsRevision, setConnectionsRevision] = useState(0);
  const connectionsHistory = useConnections(session, connectionsRevision);
  const hasConnections = Boolean(session && connectionsHistory?.eligible);
  const refreshConnections = () => setConnectionsRevision((value) => value + 1);
  useEffect(() => {
    if (view === 'connections' && !hasConnections) setView('discover');
  }, [view, hasConnections]);
  const guestlistInviteToken = new URLSearchParams(window.location.search).get('guestlistInvite');
  const [referral, setReferral] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');
  const inviteClaimAttempted = useRef(false);
  const [selected, setSelected] = useState(null),
    [offeringId, setOfferingId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [stage, setStage] = useState("details");
  const [booking, setBooking] = useState(null);
  const [referralPending, setReferralPending] = useState(null), [referralError, setReferralError] = useState('');
  const referralRequest = useRef(null);
  const referralBusy = referralPending === `${session?.accessToken}:${selected?.id}`;
  useEffect(() => {
    setReferralError('');
    return () => { referralRequest.current?.abort(); };
  }, [selected?.id, session?.accessToken]);
  const [guestState, setGuestState] = useState(""),
    [guestBusy, setGuestBusy] = useState(false),
    [guestError, setGuestError] = useState("");
  const [limit, setLimit] = useState(9),
    [notice, setNotice] = useState("");
  const locationEdited = useRef(false),
    pendingAuth = useRef(null);
  const eventDialogRef = useRef(null);
  const eventTitleRef = useRef(null);
  useLayoutEffect(() => {
    if (selected) focusEventDialogStart(eventDialogRef.current, eventTitleRef.current);
  }, [selected?.id]);
  const [locationState, setLocationState] = useState("finding");
  async function loadEvents() {
    setLoadState("loading");
    try {
      const loaded = await api("/events?limit=100");
      setEvents(
        loaded.map((event) => ({
          ...event,
          offerings: [...(event.offerings || [])].sort(
            (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
          ),
        })),
      );
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }
  useEffect(() => {
    loadEvents();
  }, []);
  useEffect(() => {
    const incoming = referralFromSearch(window.location.search);
    if (!incoming) return;
    let active = true;
    const sessionKey = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
    sessionStorage.setItem('nitewide.referral-session', sessionKey);
    Promise.all([
      api(`/events/${encodeURIComponent(incoming.eventId)}`),
      api(`/events/${encodeURIComponent(incoming.eventId)}/referral-visits`, { body: { code: incoming.code, sessionKey } }),
    ]).then(([event, visit]) => {
      if (!active) return;
      setReferral({ ...incoming, referrerName: visit.referrerName });
      openEvent(event);
    }).catch(() => { if (active) setNotice('This referral link is no longer active. You can still browse events.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    detectCurrentCity().then((value) => {
      if (active) {
        if (!locationEdited.current) setCity(value || "Orlando, FL");
        setLocationState(value ? "detected" : "fallback");
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    api("/auth/me", {
      token: session.accessToken,
      signal: controller.signal,
    }).then((data) => {
      setSession((current) => { if (!current || current.user.id !== data.user.id) return current; const updated = { ...current, user: data.user }; writeStorage('nitewide.session', updated); return updated; });
    }).catch((error) => {
      if (error.status === 401) {
        setSession(null);
        writeStorage("nitewide.session", null);
        setNotice("Your session expired. Please sign in again.");
      }
    });
    const timer = setTimeout(
      () => {
        setSession(null);
        writeStorage("nitewide.session", null);
      },
      Math.max(0, new Date(session.expiresAt) - new Date()),
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [session?.accessToken]);
  useEffect(() => {
    setLimit(9);
  }, [city, date, query, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const filters = {
    city,
    date,
    query,
    savedIds: view === "saved" ? saved : null,
  };
  const results = filterDiscoveryEvents(events, filters);
  const discoveryRange = discoveryDateRange(date);
  const savedUpcoming = upcomingSavedEvents(events, saved);
  const weekRange = date ? upcomingWeekRange(date) : null;
  const weeklyEvents = date ? filterUpcomingWeek(events, filters) : [];
  const offering = selected?.offerings?.find((o) => o.id === offeringId);
  const totals = checkoutTotal(offering?.priceCents || 0, quantity, offering?.currency || 'USD');
  function openEvent(event) {
    setSelected(event);
    const first = event.offerings?.find((o) => availableQuantity(o));
    setOfferingId(first?.id || "");
    setQuantity(first?.minPerOrder || 1);
    setStage("details");
    setGuestState("");
    setGuestError("");
  }
  async function openConnection(entry) {
    const sessionKey = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
    sessionStorage.setItem('nitewide.referral-session', sessionKey);
    const [event, visit] = await Promise.all([
      api(`/events/${encodeURIComponent(entry.event.id)}`),
      api(`/events/${encodeURIComponent(entry.event.id)}/referral-visits`, { body: { code: entry.code, sessionKey } }),
    ]);
    setReferral({ eventId: event.id, code: visit.code, referrerName: visit.referrerName });
    setWalletOpen(false); openEvent(event);
  }
  async function chooseEventConnection(entry) {
    if (referralBusy || entry === undefined) return;
    setReferralError('');
    if (entry === null) { setReferral(null); return; }
    if (entry.event.id !== selected?.id) return;
    const controller = new AbortController();
    referralRequest.current?.abort(); referralRequest.current = controller;
    setReferralPending(`${session?.accessToken}:${selected.id}`);
    try {
      const sessionKey = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
      sessionStorage.setItem('nitewide.referral-session', sessionKey);
      const visit = await api(`/events/${encodeURIComponent(entry.event.id)}/referral-visits`, { signal: controller.signal, body: { code: entry.code, sessionKey } });
      if (!controller.signal.aborted) setReferral({ eventId: entry.event.id, code: visit.code, referrerName: visit.referrerName });
    } catch (error) {
      if (!controller.signal.aborted) setReferralError(`Couldn’t apply this connection. ${error.message}`);
    } finally { if (referralRequest.current === controller) setReferralPending(null); }
  }
  function selectOffering(id) {
    setOfferingId(id);
    const item = selected.offerings.find((o) => o.id === id);
    setQuantity(item.minPerOrder || 1);
  }
  function save(event) {
    const next = saved.includes(event.id)
      ? saved.filter((id) => id !== event.id)
      : [...saved, event.id];
    setSaved(next);
    writeStorage("nitewide.saved", next);
  }
  async function authSuccess(data) {
    setSession(data);
    writeStorage("nitewide.session", data);
    setNotice(`You're in, ${data.user.displayName.split(" ")[0]}.`);
    if (guestlistInviteToken) {
      inviteClaimAttempted.current = true;
      try {
        const result = data.guestlistInvite || await api(`/guestlist-invitations/${encodeURIComponent(guestlistInviteToken)}/claim`, { token: data.accessToken, method: 'POST' });
        setNotice(result.status === 'confirmed' ? 'You are confirmed on the guestlist.' : result.status === 'full' ? 'The guestlist is full. Your invitation link can be tried again if space opens.' : 'Your account is ready, but this guestlist invitation could not be claimed.');
        if (result.status === 'confirmed') { refreshConnections(); const url = new URL(window.location.href); url.searchParams.delete('guestlistInvite'); window.history.replaceState({}, '', url); }
      } catch (error) { setNotice(`Signed in, but the guestlist invitation could not be claimed: ${error.message}`); }
    }
    const next = pendingAuth.current;
    pendingAuth.current = null;
    if (next === "checkout") setStage("checkout");
    if (next === "wallet") setWalletOpen(true);
  }
  useEffect(() => {
    if (!guestlistInviteToken || inviteClaimAttempted.current) return;
    if (!session) { setAuthOpen(true); return; }
    inviteClaimAttempted.current = true;
    api(`/guestlist-invitations/${encodeURIComponent(guestlistInviteToken)}/claim`, { token: session.accessToken, method: 'POST' })
      .then((result) => { setNotice(result.status === 'confirmed' ? 'You are confirmed on the guestlist.' : 'Your invitation is not confirmed; the guestlist may be full or closed.'); if (result.status === 'confirmed') { refreshConnections(); const url = new URL(window.location.href); url.searchParams.delete('guestlistInvite'); window.history.replaceState({}, '', url); } })
      .catch((error) => setNotice(`Guestlist invitation could not be claimed: ${error.message}`));
  }, [guestlistInviteToken, session]);
  function checkout() {
    if (!totals.eligible) return;
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
    } else setStage("checkout");
  }
  async function completeDemo() {
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
      return;
    }
    if (!offering || availableQuantity(offering) < quantity || !totals.eligible) return;
    setDemoBusy(true);
    setDemoError('');
    try {
    const result = await api('/orders', { token: session.accessToken, body: {
      eventId: selected.id, idempotencyKey: crypto.randomUUID(),
      expectedTotalCents: totals.total,
      affiliateCode: referralCodeForEvent(referral, selected.id),
      items: [{ offeringId: offering.id, quantity }],
      payment: { provider: 'demo', reference: crypto.randomUUID(), status: 'succeeded' },
    } });
    const receipt = {
      id: result.order.id,
      userId: session.user.id,
      event: {
        title: selected.title,
        startsAt: selected.startsAt,
        location: selected.location,
      },
      offering: offering.name,
      quantity,
      total: result.order.totalCents,
      currency: offering.currency,
      createdAt: new Date().toISOString(),
    };
    setBooking(receipt);
    setStage("complete");
    refreshConnections();
    await loadEvents();
    } catch (error) { setDemoError(error.message); }
    finally { setDemoBusy(false); }
  }
  async function requestGuestlist() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setGuestBusy(true);
    setGuestError("");
    try {
      await api(`/events/${selected.id}/guestlist`, {
        token: session.accessToken,
        body: { partySize: 1, affiliateCode: referralCodeForEvent(referral, selected.id) },
      });
      setGuestState("pending");
      refreshConnections();
    } catch (error) {
      if (error.status === 401) {
        setSession(null);
        setAuthOpen(true);
      }
      setGuestError(
        error.status === 409
          ? "You already have a guestlist request for this event."
          : error.message,
      );
    } finally {
      setGuestBusy(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#discover">
        Skip to events
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation" data-view={view} data-connections={hasConnections}>
            <button
              className={view === "discover" ? "active" : ""}
              aria-current={view === 'discover' ? 'page' : undefined}
              onClick={() => {
                setView("discover");
                document
                  .getElementById("discover")
                  .scrollIntoView({ behavior: "smooth" });
              }}
            >
              Discover
            </button>
            <button className={view === 'booked' ? 'active' : ''} aria-current={view === 'booked' ? 'page' : undefined} onClick={() => { setView('booked'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Booked</button>
            <button
              className={view === 'saved' ? 'active' : ''}
              aria-current={view === 'saved' ? 'page' : undefined}
              onClick={() => {
                setView("saved");
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Saved
            </button>
            {hasConnections && <button className={view === 'connections' ? 'active' : ''} aria-current={view === 'connections' ? 'page' : undefined} onClick={() => { setView('connections'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Connections</button>}
          </nav>
          <div className="header-actions">
            {!session && <a className="business-nav-link" href={businessLink(import.meta.env.VITE_BUSINESS_URL, window.location)}>For business <ArrowUpRight size={14} /></a>}
            {session ? (
              <>
                <Notifications session={session} onEvent={(eventId) => api(`/events/${encodeURIComponent(eventId)}`).then(openEvent).catch((error) => setNotice(error.message))} />
                <button className="profile-avatar profile-trigger" aria-label={`Open ${session.user.displayName}'s profile`} title="Your profile and plans" onClick={() => { setAccountTab('profile'); setWalletOpen(true); }}>{initials(session.user.displayName)}</button>
              </>
            ) : (
              <Button
                className="signin-button"
                onClick={() => setAuthOpen(true)}
              >
                Sign in <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </div>
      </header>
      {view === 'connections' && hasConnections && <ConnectionsPage key={session.user.id} session={session} history={connectionsHistory} saved={saved} onSave={save} onReferral={openConnection} onRefresh={refreshConnections} />}
      {view === 'booked' && <main className="booked-page wrap" id="booked">
        <div className="booked-page-heading"><p className="eyebrow">YOUR NEXT NIGHT STARTS HERE</p><h1>Booked.</h1><p>Your tickets and guest list entries, all in one place.</p></div>
        {session ? <AccountDialog embedded open session={session} onOpenChange={() => setView('discover')} /> : <div className="account-empty"><Ticket /><h2>Your nights are waiting.</h2><p>Sign in to see your upcoming bookings and guest list entries.</p><Button onClick={() => setAuthOpen(true)}>Sign in</Button></div>}
      </main>}
      {view === 'saved' && <main className="booked-page wrap" id="saved">
        <div className="booked-page-heading"><p className="eyebrow">KEEP THE GOOD NIGHTS CLOSE</p><h1>Saved.</h1><p>Your shortlist of upcoming events.</p></div>
        {loadState === 'loading' ? <LoadingIndicator>Finding your saved nights…</LoadingIndicator> : loadState === 'error' ? <div className="account-empty"><p>We couldn’t load your saved events.</p><Button onClick={loadEvents}>Try again</Button></div> : savedUpcoming.length ? <div className="event-grid">{savedUpcoming.map((event) => <EventCard key={event.id} event={event} saved onSave={() => save(event)} onOpen={() => openEvent(event)} />)}</div> : <div className="account-empty"><h2>No upcoming saved events yet.</h2><p>Tap the heart on an event to keep it here. Past events stay out of your shortlist.</p><Button onClick={() => setView('discover')}>Discover events</Button></div>}
      </main>}
      <main hidden={view !== 'discover'}>
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="live-dot" />
              GOOD COMPANY. GREAT NIGHTS.
            </p>
            <h1>
              The night
              <br />
              <span className="hero-accent">is yours.</span>
            </h1>
            <p className="hero-description">
              Tickets, tables, guestlists. Your night starts here.
            </p>
            <div className="hero-tags">
              <span>
                <Ticket size={15} />
                Tickets
              </span>
              <i />
              <span>
                <Wine size={15} />
                VIP tables
              </span>
              <i />
              <span>
                <Users size={15} />
                Guestlists
              </span>
            </div>
            <a className="text-link" href="#discover">
              Find your next night <ArrowDown />
            </a>
          </div>
        </section>
        <div className="wrap search-wrap">
          <form
            className="search-bar"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setDate(form.get("date") || "");
              setCity(form.get("city") || "");
              setQuery(form.get("query") || "");
              setView("discover");
              document
                .getElementById("discover")
                .scrollIntoView({ behavior: "smooth" });
            }}
          >
            <label className="search-field">
              <MapPin />
              <span>
                <b>WHERE TO?</b>
                <input
                  aria-label="City"
                  name="city"
                  list="cities"
                  value={city}
                  placeholder={
                    locationState === "finding"
                      ? "Finding your city…"
                      : "All cities"
                  }
                  onChange={(event) => {
                    locationEdited.current = true;
                    setCity(event.target.value);
                  }}
                />
              </span>
            </label>
            <datalist id="cities">
              {[
                ...new Set([
                  "Orlando, FL",
                  "Miami, FL",
                  "Fort Lauderdale, FL",
                  "Tampa, FL",
                  ...events.map(
                    (e) => `${cityName(e)}, ${e.location?.region || ""}`,
                  ),
                ]),
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <label className="search-field date-field">
              <CalendarDays />
              <span>
                <b>{date ? 'WHEN?' : 'NEXT 7 DAYS'}</b>
                <input
                  aria-label="Event date"
                  name="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </span>
              {date && (
                <button
                  type="button"
                  aria-label="Reset to next 7 days"
                  onClick={() => setDate("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <label className="search-field keyword-field">
              <Search />
              <span>
                <b>SEARCH</b>
                <input
                  aria-label="Search"
                  name="query"
                  value={query}
                  placeholder="Search anything…"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </span>
            </label>
            <Button className="search-submit" type="submit">
              Find my night
              <ArrowRight size={19} />
            </Button>
          </form>
          <div className="search-caption">
            <span>
              <LocateFixed size={12} />
              {locationState === "fallback"
                ? "Showing Orlando. Choose any city to explore."
                : "Your plans start here."}
            </span>
            <span>Book on the web. Be there in real life.</span>
          </div>
        </div>
        <section id="discover" className="discovery wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GO WHERE THE NIGHT TAKES YOU</p>
              <h2>
                {view === "saved"
                  ? "Your shortlist."
                  : "Find your kind of night."}
              </h2>
            </div>
          </div>
          <div aria-live="polite" className="results-summary">
            {loadState === "ready" && (
              <>
                {results.length}{" "}
                {results.length === 1 ? "experience" : "experiences"}
                {city ? ` in ${city.split(",")[0]}` : ""} ·{" "}
                {date
                  ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : `Next 7 days · ${calendarLabel(discoveryRange.start)} – ${calendarLabel(discoveryRange.end)}`}
              </>
            )}
          </div>
          {loadState === "loading" ? (
            <div className="event-grid" aria-label="Loading events" role="status" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : loadState === "error" ? (
            <div className="empty-state">
              <Compass />
              <h3>The night’s still out there.</h3>
              <p>
                We couldn’t load events. Check your connection and try again.
              </p>
              <Button onClick={loadEvents}>Try again</Button>
            </div>
          ) : results.length ? (
            <>
              <div className="event-grid">
                {results.slice(0, limit).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    saved={saved.includes(event.id)}
                    onSave={() => save(event)}
                    onOpen={() => openEvent(event)}
                  />
                ))}
              </div>
              {results.length > limit && (
                <Button
                  variant="outline"
                  className="load-more"
                  onClick={() => setLimit(limit + 9)}
                >
                  More nights, more possibilities <Plus size={17} />
                </Button>
              )}
            </>
          ) : (
            <div className="empty-state">
              <CalendarDays />
              <h3>{date ? 'No experiences on this date.' : 'No experiences in the next 7 days.'}</h3>
              <p>{date ? 'Upcoming events for the following week are shown below.' : 'Try another date, city, or search.'}</p>
            </div>
          )}
        </section>
        {loadState === "ready" &&
          date &&
          !results.length &&
          view === "discover" && (
            <section className="upcoming-preview wrap">
              <div className="section-heading">
                <h2>Upcoming this week.</h2>
              </div>
              <p className="results-summary">
                {calendarLabel(weekRange.start)} –{" "}
                {calendarLabel(weekRange.end)} · {weeklyEvents.length}{" "}
                {weeklyEvents.length === 1 ? "experience" : "experiences"}
                {city ? ` in ${city.split(",")[0]}` : " across all cities"}
              </p>
              <div className="event-grid">
                {weeklyEvents.slice(0, limit).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    saved={saved.includes(event.id)}
                    onSave={() => save(event)}
                    onOpen={() => openEvent(event)}
                  />
                ))}
              </div>
              {!weeklyEvents.length && (
                <div className="empty-state">
                  <CalendarDays />
                  <h3>No matches in this seven-day window.</h3>
                  <p>
                    Try another city or search to find more events.
                  </p>
                </div>
              )}
              {weeklyEvents.length > limit && (
                <Button
                  variant="outline"
                  className="load-more"
                  onClick={() => setLimit(limit + 9)}
                >
                  Show more from this week <Plus size={17} />
                </Button>
              )}
            </section>
          )}
        <section className="how-section wrap">
          <div>
            <p className="eyebrow">FIND YOUR VIBE</p>
            <h2>
              Your night.
              <br />
              On your terms.
            </h2>
          </div>
          <div className="how-steps">
            {[
              [
                Compass,
                "Discover your scene",
                "Find events that match your energy.",
              ],
              [
                Ticket,
                "Book your spot",
                "Tickets, tables, or a place on the guestlist.",
              ],
              [
                ArrowUpRight,
                "Make your entrance",
                "Your entry pass, ready when you are.",
              ],
            ].map(([Icon, title, description]) => (
              <div key={title}>
                <span className="step-icon">
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer wrap">
        <div className="footer-identity">
          <Brand />
          <p className="copyright">© {new Date().getFullYear()} Nitewide</p>
        </div>
        <div className="footer-markets">
          <p>Orlando · Miami · Fort Lauderdale · Tampa</p>
          <small>Event availability varies by city.</small>
        </div>
        {session && <a className="business-nav-link footer-business" href={businessLink(import.meta.env.VITE_BUSINESS_URL, window.location)}>For business <ArrowUpRight size={14} /></a>}
      </footer>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !guestBusy && !referralBusy) setSelected(null);
        }}
      >
        <DialogContent
          className="event-modal"
          ref={eventDialogRef}
          onOpenAutoFocus={(event) => openEventDialogAtTop(event, eventDialogRef.current, eventTitleRef.current)}
        >
          <DialogHeader>
            <p className="eyebrow">
              {stage === "complete"
                ? "DEMO BOOKING"
                : stage === "checkout"
                  ? "REVIEW YOUR NIGHT"
                  : "YOUR NIGHT STARTS HERE"}
            </p>
            <DialogTitle ref={eventTitleRef} tabIndex={-1}>
              {stage === "complete"
                ? "Consider the plan made."
                : selected?.title}
            </DialogTitle>
            <DialogDescription>
              {selected &&
                `${eventDate(selected)} · ${eventTime(selected)} · ${cityName(selected)}`}
            </DialogDescription>
          </DialogHeader>
          {selected && stage === "details" && (
            <>
              <div className="detail-art">
                <EventArtwork event={selected} />
              </div>
              <p className="detail-description">
                {selected.description ||
                  selected.summary ||
                  "Make room for a memorable night."}
              </p>
              <div className="detail-location">
                <MapPin size={17} />
                <span>
                  {selected.location?.name || "Location shared with attendees"}
                  <small>
                    {eventAddress(selected.location)}
                  </small>
                </span>
              </div>
              {session && <EventConnectionPicker key={`${session.user.id}:${selected.id}`} session={session} eventId={selected.id} referral={referral} busy={referralBusy} onSelect={chooseEventConnection} />}
              {referralError && <p className="error-message" role="alert">{referralError}</p>}
              <Tabs defaultValue="tickets">
                <TabsList className="booking-tabs">
                  <TabsTrigger value="tickets">Tickets & tables</TabsTrigger>
                  <TabsTrigger value="guestlist">Guestlist</TabsTrigger>
                </TabsList>
                <TabsContent value="tickets">
                  <div className="offerings">
                    {selected.offerings?.map((item) => (
                      <button
                        disabled={!availableQuantity(item)}
                        key={item.id}
                        className={`offering ${offeringId === item.id ? "selected" : ""}`}
                        aria-pressed={offeringId === item.id}
                        onClick={() => selectOffering(item.id)}
                      >
                        <span className="radio-indicator">
                          {offeringId === item.id && <span />}
                        </span>
                        <span>
                          <b>{item.name}</b>
                          <small>
                            {item.description ||
                              `Admission for ${item.entriesPerUnit} per ${item.kind}`}
                          </small>
                        </span>
                        <strong>
                          {money(item.priceCents, item.currency)}
                          <small>
                            {offeringAvailabilityLabel(item, selected.offerings)}
                          </small>
                        </strong>
                      </button>
                    ))}
                  </div>
                  {offering && (
                    <>
                      <div className="quantity-row">
                        <span>Quantity</span>
                        <div>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Decrease quantity"
                            disabled={quantity <= (offering.minPerOrder || 1)}
                            onClick={() => setQuantity(quantity - 1)}
                          >
                            <Minus />
                          </Button>
                          <span aria-live="polite">{quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Increase quantity"
                            disabled={quantity >= availableQuantity(offering)}
                            onClick={() => setQuantity(quantity + 1)}
                          >
                            <Plus />
                          </Button>
                        </div>
                      </div>
                      {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
                      <Button
                        className="primary-action"
                        onClick={checkout}
                        disabled={referralBusy || !availableQuantity(offering) || !totals.eligible}
                      >
                        {totals.eligible ? `Continue · ${money(totals.total, offering.currency)}` : 'Pricing unavailable'}
                        <ArrowRight />
                      </Button>
                      {!totals.eligible && <p role="alert" className="fine-print">This combination is not available at our current pricing. Try another offering or quantity.</p>}
                      {totals.discount > 0 && <p className="fine-print">A {money(totals.discount, offering.currency)} competitive fee discount is included.</p>}
                    </>
                  )}
                  <p className="demo-note">
                    Demo checkout · No payment will be collected.
                  </p>
                </TabsContent>
                <TabsContent value="guestlist">
                  <div className="guestlist-panel">
                    <Users />
                    <h3>
                      {guestState === "pending"
                        ? "You’re on their radar."
                        : "Get on the guestlist."}
                    </h3>
                    <p>
                      {guestState === "pending"
                        ? "Your request has been sent to the host. Entry is only confirmed after approval."
                        : "Request a spot for yourself. The venue or promoter will review it before confirming your entry."}
                    </p>
                    {guestError && (
                      <p className="error-message" role="alert">
                        {guestError}
                      </p>
                    )}
                    {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
                    <Button
                      disabled={
                        guestBusy || referralBusy ||
                        guestState === "pending" ||
                        !selected.guestlistCapacity
                      }
                      onClick={requestGuestlist}
                    >
                      {guestBusy ? (
                        <LoadingIndicator>Requesting approval…</LoadingIndicator>
                      ) : guestState === "pending" ? (
                        "Awaiting approval"
                      ) : !selected.guestlistCapacity ? (
                        "Guestlist not available"
                      ) : session ? (
                        "Request guestlist approval"
                      ) : (
                        "Sign in to request"
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
          {selected && stage === "checkout" && offering && (
            <div className="checkout-review">
              <Badge variant="outline">DEMO CHECKOUT</Badge>
              <p>
                This creates a demo order and admission in local test data. No card details or charge; not valid for entry.
              </p>
              <div className="order-summary">
                <h3>{offering.name}</h3>
                <p>
                  {quantity} × {money(offering.priceCents, offering.currency)}
                </p>
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{money(totals.subtotal, offering.currency)}</dd>
                  </div>
                  <div>
                    <dt>
                      Service fee <small>(standard 8% + $0.80 per paid ticket/package; discounts and minimum-cost adjustments may apply)</small>
                    </dt>
                    <dd>{money(totals.fee, offering.currency)}</dd>
                  </div>
                  <div className="order-total">
                    <dt>Total paid in full</dt>
                    <dd>{money(totals.total, offering.currency)}</dd>
                  </div>
                </dl>
              </div>
              <p className="fine-print">
                Booking as {session?.user.email}. Taxes and any additional
                charges must be finalized before live payments launch.
              </p>
              {totals.floorAdjusted && <p className="fine-print">A minimum-cost adjustment is included in the service fee to cover this order. Processing is included; no additional processing charge applies.</p>}
              {totals.discount > 0 && <p className="fine-print">Includes a {money(totals.discount, offering.currency)} competitive fee discount.</p>}
              {demoError && <p role="alert">{demoError}</p>}
              {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
              <Button className="primary-action" onClick={completeDemo} disabled={demoBusy || !totals.eligible}>
                {demoBusy ? <LoadingIndicator>Recording demo order…</LoadingIndicator> : <>Confirm demo booking <ArrowRight /></>}
              </Button>
              <Button variant="ghost" onClick={() => setStage("details")}>
                Back to tickets & tables
              </Button>
            </div>
          )}
          {stage === "complete" && booking && (
            <div className="confirmation">
              <div className="confirmation-icon">
                <Check size={32} />
              </div>
              <h3>Your demo night is booked.</h3>
              <p>
                {booking.offering} · {booking.quantity}{" "}
                {booking.quantity === 1
                  ? "package / ticket"
                  : "packages / tickets"}
              </p>
              <div className="demo-ticket">
                <Ticket size={30} />
                <b>{booking.id}</b>
                <span>DEMO ONLY · NOT VALID FOR ENTRY</span>
              </div>
              <p>No charge was made. Your demo order and tickets are saved to your account and recorded in business reporting.</p>
              <Button
                className="primary-action"
                onClick={() => {
                  setSelected(null);
                  setAccountTab('plans');
                  setWalletOpen(true);
                }}
              >
                View my bookings <ArrowRight />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AuthDialog
        open={authOpen}
        guestlistInviteToken={guestlistInviteToken}
        onOpenChange={(value) => {
          setAuthOpen(value);
          if (!value) pendingAuth.current = null;
        }}
        onSuccess={authSuccess}
      />
      <AccountDialog open={walletOpen} onOpenChange={setWalletOpen} session={session} initialTab={accountTab}
        onProfile={(user) => { const updated = { ...session, user }; setSession(updated); writeStorage('nitewide.session', updated); }}
        onSignOut={() => { setWalletOpen(false); setSession(null); setReferral(null); writeStorage('nitewide.session', null); setNotice('You’re signed out.'); }}
        onReferral={openConnection} />
      {notice && (
        <div className="toast-message" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </>
  );
}
function ArrowDown() {
  return <ArrowRight size={16} style={{ transform: "rotate(90deg)" }} />;
}
