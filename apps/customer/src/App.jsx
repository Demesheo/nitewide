import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  CalendarDays,
  Search,
  Ticket,
  Users,
  Minus,
  Plus,
  Check,
  LoaderCircle,
  Compass,
  X,
  Share,
  Heart,
  LogIn,
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
import { DiscoveryResults } from './components/discovery-results';
import { EventArtwork } from './components/event-artwork';
import { eventAddressLines, eventDate, eventTime } from "./lib/presentation";
import { LoadingIndicator } from './components/loading-indicator';
import { upcomingSavedEvents } from './lib/saved-events';
import { useSavedEvents } from './lib/use-saved-events';
import { useDiscovery } from './lib/use-discovery';
import { AuthDialog } from "./components/auth-dialog";
import { PasswordResetDialog } from './components/password-reset-dialog';
import { OnboardingSetup } from './components/onboarding-setup';
import { Notifications } from "./components/notifications";
import { notificationTarget, loadNotificationBooking } from './lib/notification-target';
import { AccountDialog, initials } from './components/account-dialog';
import { ConnectionsPage } from './components/connections-page';
import { EventConnectionPicker } from './components/event-connection-picker';
import { useConnections } from './lib/use-connections';
import { focusEventDialogStart, openEventDialogAtTop } from './lib/dialog-focus';
import { detectCurrentCity } from "./discovery-defaults";
import { api } from "./lib/api";
import { readCheckoutAttempt, prepareCheckoutAttempt, clearCheckoutAttempt, checkCheckoutAttempt, submitCheckoutAttempt, resumePaymentCheckout, verifyPaymentCheckout, restoredCheckoutEvent, rememberCheckoutOrder, restorePaymentAttempt } from './lib/checkout-attempt';
import { businessLink } from './lib/business-link';
import { referralCodeForEvent, referralFromSearch } from './lib/referral';
import { eventShareUrl } from './lib/event-share';
import { bookingFromSearch } from './lib/booking-link';
import { parseCustomerRoute, updateCustomerRoute } from './lib/customer-route';
import { mapsUrlForLocation } from './lib/maps-link';
import { clearPassCache } from './lib/pass-cache';
import { isPremiumHost } from './lib/premium-host';
import {
  availableQuantity,
  offeringAvailabilityLabel,
  checkoutTotal,
  cityName,
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
const StripeCheckout = lazy(() => import('./components/stripe-checkout'));
const Brand = () => (
  <a href="/" aria-label="Nitewide home" className="brand">
    nitewide
  </a>
);
function validSession() {
  const session = readStorage("nitewide.session", null);
  const valid = session?.user?.id &&
    session.accessToken &&
    new Date(session.expiresAt) > new Date();
  if (!valid && session?.user?.id) clearPassCache(session.user.id);
  return valid ? session : null;
}

export default function App() {
  const initialRoute = useRef(parseCustomerRoute(window.location.search)).current;
  const [city, setCity] = useState(initialRoute.city),
    [date, setDate] = useState(initialRoute.date),
    [query, setQuery] = useState(initialRoute.query);
  const [shortcut, setShortcut] = useState(initialRoute.shortcut);
  const [submitted, setSubmitted] = useState({ city: initialRoute.city, date: initialRoute.date, query: initialRoute.query, shortcut: initialRoute.shortcut });
  const { events, previewEvents, loadState, nextCursor, moreState, previewCursor, previewState, range: discoveryRange, reload: loadEvents, loadMore } = useDiscovery(submitted);
  const [view, setView] = useState(initialRoute.tab);
  const [returnVisitor] = useState(() => Boolean(readStorage('nitewide.returning', false)));
  useEffect(() => { writeStorage('nitewide.returning', true); }, []);
  const [session, setSession] = useState(validSession),
    [authOpen, setAuthOpen] = useState(false),
    [walletOpen, setWalletOpen] = useState(false);
  const [notificationBooking, setNotificationBooking] = useState(null);
  const [bookingRoute, setBookingRoute] = useState(initialRoute.booking);
  const [passwordResetToken, setPasswordResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetPassword'));
  const [onboardingToken, setOnboardingToken] = useState(() => new URLSearchParams(window.location.search).get('onboarding'));
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('verifyEmail');
    if (!token) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('verifyEmail');
    window.history.replaceState({}, '', url);
    api('/auth/email/verify', { body: { token } })
      .then(() => setNotice('Email verified. Welcome to Nitewide.'))
      .catch((error) => setNotice(error.message || 'This verification link has expired.'));
  }, []);
  function clearResetToken() {
    const url = new URL(window.location.href);
    url.searchParams.delete('resetPassword');
    window.history.replaceState({}, '', url);
    setPasswordResetToken(null);
  }
  const emailedBookingAttempted = useRef(false);
  useEffect(() => {
    const target = bookingFromSearch(window.location.search);
    if (!target || emailedBookingAttempted.current) return;
    if (!session) { setAuthOpen(true); return; }
    emailedBookingAttempted.current = true;
    loadNotificationBooking(target, api, session.accessToken)
      .then((ticket) => {
        setSelected(null); setWalletOpen(false); setView('booked'); setBookingRoute(`${target.kind}:${target.id}`);
        setNotificationBooking({ ticket });
      })
      .catch(() => setNotice('This booking is unavailable. Check your Booked list or sign in with the account used to book.'));
  }, [session?.accessToken]);
  async function openNotification(item) {
    const target = notificationTarget(item);
    if (target?.type === 'checkout') {
      if (!target.id) throw new Error('This purchase reminder no longer has a linked checkout.');
      await resumeBooking(target.id);
      return true;
    } else if (target?.type === 'booking') {
      const ticket = await loadNotificationBooking(target, api, session.accessToken);
      setSelected(null); setWalletOpen(false); setView('booked'); setBookingRoute(`${target.kind}:${target.id}`);
      setNotificationBooking({ ticket });
      updateCustomerRoute({ tab: 'booked', eventId: null, booking: `${target.kind}:${target.id}` });
      window.scrollTo({ top: 0 });
      return true;
    } else if (target?.type === 'event') {
      openEvent(await api(`/events/${encodeURIComponent(target.id)}`));
    }
    return false;
  }
  const [connectionsRevision, setConnectionsRevision] = useState(0);
  const connectionsHistory = useConnections(session, connectionsRevision);
  const hasConnections = Boolean(session && connectionsHistory?.eligible);
  const refreshConnections = () => setConnectionsRevision((value) => value + 1);
  useEffect(() => {
    if (view === 'connections' && (!session || (connectionsHistory && !hasConnections))) navigateView('discover');
  }, [view, hasConnections, connectionsHistory, session]);
  const guestlistInviteToken = new URLSearchParams(window.location.search).get('guestlistInvite');
  const [referral, setReferral] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [checkoutRecovering, setCheckoutRecovering] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [paymentCheckout, setPaymentCheckout] = useState(null);
  const [bookingsRevision, setBookingsRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/customer/payment-config', { signal: controller.signal }).then(setPaymentConfig)
      .catch(() => { if (!controller.signal.aborted) setPaymentConfig({ enabled: false, demoEnabled: false, mode: 'disabled' }); });
    return () => controller.abort();
  }, []);
  const checkoutLock = useRef(false);
  const activeCheckoutAttempt = useRef(null);
  const recoveryBuyer = useRef(null);
  const currentCheckoutBuyer = useRef(session?.user.id);
  currentCheckoutBuyer.current = session?.user.id;
  const inviteClaimAttempted = useRef(false);
  const [selected, setSelected] = useState(null),
    [offeringId, setOfferingId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [stage, setStage] = useState("details");
  const [shareFeedback, setShareFeedback] = useState('');
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
  const [guestEntry, setGuestEntry] = useState(null);
  const [guestPartySize, setGuestPartySize] = useState(1);
  const [guestMaxPartySize, setGuestMaxPartySize] = useState(20);
  const [guestRequestsOpen, setGuestRequestsOpen] = useState(true);
  const [guestStatusLoading, setGuestStatusLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const savedCollection = useSavedEvents(session, view, [...events, ...previewEvents, ...(selected ? [selected] : [])], setNotice);
  const { saved, save } = savedCollection;
  const locationEdited = useRef(false),
    pendingAuth = useRef(null);
  const eventDialogRef = useRef(null);
  function rememberScroll() {
    window.history.replaceState({ ...window.history.state, nitewideScrollY: window.scrollY }, '', window.location.href);
  }
  function navigateView(next, { replace = false } = {}) {
    if (checkoutLock.current) return;
    rememberScroll();
    setView(next);
    setSelected(null);
    setBookingRoute(null);
    updateCustomerRoute({ tab: next, eventId: null, booking: null }, { replace });
    if (next === 'discover') requestAnimationFrame(() => document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' }));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function applyDiscovery(next) {
    rememberScroll();
    setSubmitted(next);
    setView('discover');
    updateCustomerRoute({ tab: 'discover', city: next.city, date: next.date, query: next.query, shortcut: next.shortcut, eventId: null, booking: null });
    requestAnimationFrame(() => document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' }));
  }
  useEffect(() => {
    let active = true;
    const onPopState = () => {
      if (checkoutLock.current) return;
      const route = parseCustomerRoute(window.location.search);
      setView(route.tab);
      setCity(route.city); setDate(route.date); setQuery(route.query); setShortcut(route.shortcut);
      setSubmitted({ city: route.city, date: route.date, query: route.query, shortcut: route.shortcut });
      setBookingRoute(route.booking);
      requestAnimationFrame(() => window.scrollTo({ top: window.history.state?.nitewideScrollY || 0 }));
      if (!route.eventId) { setSelected(null); return; }
      api(`/events/${encodeURIComponent(route.eventId)}`)
        .then((event) => { if (active && parseCustomerRoute(window.location.search).eventId === event.id) openEvent(event, { fromRoute: true }); })
        .catch(() => { if (active) setNotice('This event is no longer available.'); });
    };
    window.addEventListener('popstate', onPopState);
    return () => { active = false; window.removeEventListener('popstate', onPopState); };
  }, []);
  useLayoutEffect(() => {
    if (selected) focusEventDialogStart(eventDialogRef.current);
  }, [selected?.id]);
  const [locationState, setLocationState] = useState("finding");
  useEffect(() => {
    if (!selected?.id || !session?.accessToken) { setGuestEntry(null); setGuestState(''); setGuestStatusLoading(false); return; }
    const controller = new AbortController();
    setGuestStatusLoading(true);
    api(`/customer/events/${encodeURIComponent(selected.id)}/guestlist${referralCodeForEvent(referral, selected.id) ? `?affiliateCode=${encodeURIComponent(referralCodeForEvent(referral, selected.id))}` : ''}`, { token: session.accessToken, signal: controller.signal })
      .then(({ entry, maxPartySize, requestsOpen }) => {
        if (controller.signal.aborted) return;
        setGuestEntry(entry);
        setGuestState(entry?.status || '');
        setGuestPartySize(entry?.partySize || 1);
        setGuestMaxPartySize(Math.max(1, Math.min(20, maxPartySize || 1)));
        setGuestRequestsOpen(Boolean(requestsOpen));
      })
      .catch((error) => { if (!controller.signal.aborted) setGuestError(`Couldn’t check your guestlist status: ${error.message}`); })
      .finally(() => { if (!controller.signal.aborted) setGuestStatusLoading(false); });
    return () => controller.abort();
  }, [selected?.id, session?.accessToken, referral?.code]);
  useEffect(() => {
    const incoming = referralFromSearch(window.location.search);
    const eventId = initialRoute.eventId;
    if (!eventId) return;
    let active = true;
    if (incoming) {
      const sessionKey = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
      sessionStorage.setItem('nitewide.referral-session', sessionKey);
      Promise.all([
        api(`/events/${encodeURIComponent(incoming.eventId)}`),
        api(`/events/${encodeURIComponent(incoming.eventId)}/referral-visits`, { body: { code: incoming.code, sessionKey } }),
      ]).then(([event, visit]) => {
        if (!active || checkoutLock.current || parseCustomerRoute(window.location.search).eventId !== event.id) return;
        setReferral({ ...incoming, referrerName: visit.referrerName });
        openEvent(event, { fromRoute: true });
      }).catch(() => { if (active) setNotice('This referral link is no longer active. You can still browse events.'); });
    } else {
      api(`/events/${encodeURIComponent(eventId)}`)
        .then((event) => { if (active && !checkoutLock.current && parseCustomerRoute(window.location.search).eventId === event.id) openEvent(event, { fromRoute: true }); })
        .catch(() => { if (active) setNotice('This event is no longer available. You can still browse events.'); });
    }
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    detectCurrentCity().then((value) => {
      if (active) {
        if (!locationEdited.current && !initialRoute.city) {
          const detected = value || 'Orlando, FL';
          setCity(detected);
          setSubmitted((current) => ({ ...current, city: detected }));
          updateCustomerRoute({ city: detected }, { replace: true });
        }
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
        clearPassCache(session.user.id);
        setSession(null);
        writeStorage("nitewide.session", null);
        setNotice("Your session expired. Please sign in again.");
      }
    });
    const timer = setTimeout(
      () => {
        clearPassCache(session.user.id);
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
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const results = events;
  const savedUpcoming = upcomingSavedEvents(savedCollection.items, savedCollection.items.map((event) => event.id));
  const weekRange = submitted.date ? upcomingWeekRange(submitted.date) : null;
  const weeklyEvents = previewEvents;
  const offering = selected?.offerings?.find((o) => o.id === offeringId);
  const totals = checkoutRecovering && activeCheckoutAttempt.current?.bookingTotals
    ? { ...activeCheckoutAttempt.current.bookingTotals, eligible: true }
    : checkoutTotal(offering?.priceCents || 0, quantity, offering?.currency || 'USD', offering?.effectiveFeeMode || 'buyer');
  const savedCheckout = session && readCheckoutAttempt(session.user.id);
  const selectedPendingCheckout = savedCheckout?.body.eventId === selected?.id ? savedCheckout : null;
  const demoCheckoutEnabled = Boolean(paymentConfig?.demoEnabled && paymentConfig.mode === 'disabled');
  function openEvent(event, { fromRoute = false } = {}) {
    activeCheckoutAttempt.current = null;
    setCheckoutRecovering(false);
    setPaymentCheckout(null);
    setSelected(event);
    if (!fromRoute) { rememberScroll(); updateCustomerRoute({ eventId: event.id }, { eventEntry: true }); }
    setShareFeedback('');
    const first = event.offerings?.find((o) => availableQuantity(o));
    setOfferingId(first?.id || "");
    setQuantity(first?.minPerOrder || 1);
    setStage("details");
    setGuestState("");
    setGuestEntry(null);
    setGuestPartySize(1);
    setGuestError("");
  }
  async function changeGuestPartySize(event) {
    event.preventDefault();
    if (!guestEntry?.id || guestState !== 'pending') return;
    setGuestBusy(true); setGuestError('');
    try {
      const result = await api(`/customer/guestlists/${guestEntry.id}`, { token: session.accessToken, method: 'PATCH', body: { partySize: Number(guestPartySize) } });
      setGuestEntry(result.entry);
      setNotice('Guestlist party size updated.');
    } catch (error) { setGuestError(error.message); }
    finally { setGuestBusy(false); }
  }
  async function withdrawGuestRequest() {
    if (!guestEntry?.id || guestState !== 'pending' || !window.confirm('Withdraw this pending guestlist request?')) return;
    setGuestBusy(true); setGuestError('');
    try {
      await api(`/customer/guestlists/${guestEntry.id}`, { token: session.accessToken, method: 'DELETE' });
      setGuestEntry(null); setGuestState(''); setGuestPartySize(1); setNotice('Guestlist request withdrawn.'); refreshConnections();
    } catch (error) { setGuestError(error.message); }
    finally { setGuestBusy(false); }
  }
  function closeEvent() {
    if (window.history.state?.nitewideEventEntry) window.history.back();
    else { setSelected(null); updateCustomerRoute({ eventId: null }, { replace: true }); }
  }
  async function shareSelectedEvent() {
    if (!selected) return;
    const url = eventShareUrl(selected.id, window.location.origin, referralCodeForEvent(referral, selected.id));
    if (navigator.share) {
      try {
        await navigator.share({ title: selected.title, url });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareFeedback('Link copied');
    } catch {
      setShareFeedback('Could not copy link');
    }
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
  async function authSuccess(data) {
    if (session?.user?.id && session.user.id !== data.user.id) clearPassCache(session.user.id);
    setSession(data);
    writeStorage("nitewide.session", data);
    setNotice(data.verificationEmailQueued ? 'Account created. Check your email for a verification link.' : `You're in, ${data.user.displayName.split(" ")[0]}.`);
    if (guestlistInviteToken) {
      inviteClaimAttempted.current = true;
      try {
        const result = data.guestlistInvite || await api(`/guestlist-invitations/${encodeURIComponent(guestlistInviteToken)}/claim`, { token: data.accessToken, method: 'POST' });
        setNotice(result.status === 'confirmed' ? 'You are confirmed on the guestlist.' : result.status === 'full' ? 'The guestlist is full. Your invitation link can be tried again if space opens.' : 'Your account is ready, but this guestlist invitation could not be claimed.');
        if (result.status === 'confirmed') { refreshConnections(); const url = new URL(window.location.href); url.searchParams.delete('guestlistInvite'); window.history.replaceState({}, '', url); if (result.entryId) await openGuestlistEntry(result.entryId, data.accessToken); }
      } catch (error) { setNotice(`Signed in, but the guestlist invitation could not be claimed: ${error.message}`); }
    }
    const next = pendingAuth.current;
    pendingAuth.current = null;
    if (next === "checkout") setStage("checkout");
    if (next === "wallet") navigateView('booked');
  }
  useEffect(() => {
    if (!guestlistInviteToken || inviteClaimAttempted.current) return;
    if (!session) { setAuthOpen(true); return; }
    inviteClaimAttempted.current = true;
    api(`/guestlist-invitations/${encodeURIComponent(guestlistInviteToken)}/claim`, { token: session.accessToken, method: 'POST' })
      .then(async (result) => { setNotice(result.status === 'confirmed' ? 'You are confirmed on the guestlist.' : 'Your invitation is not confirmed; the guestlist may be full or closed.'); if (result.status === 'confirmed') { refreshConnections(); const url = new URL(window.location.href); url.searchParams.delete('guestlistInvite'); window.history.replaceState({}, '', url); if (result.entryId) await openGuestlistEntry(result.entryId, session.accessToken); } })
      .catch((error) => setNotice(`Guestlist invitation could not be claimed: ${error.message}`));
  }, [guestlistInviteToken, session]);
  async function checkout() {
    const pending = session && readCheckoutAttempt(session.user.id);
    if (!pending && !totals.eligible) return;
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
    } else {
      if (pending?.body.eventId === selected.id) {
        if (pending.orderId) { try { await resumeBooking(pending.orderId); } catch (error) { setDemoError(error.message); setNotice(error.message); } return; }
        const event = restoredCheckoutEvent(pending);
        if (event) openEvent(event);
        activeCheckoutAttempt.current = pending;
        setOfferingId(pending.body.items[0].offeringId); setQuantity(pending.body.items[0].quantity); setCheckoutRecovering(true);
        setReferral(pending.body.affiliateCode ? { eventId: pending.body.eventId, code: pending.body.affiliateCode, referrerName: typeof pending.referrerName === 'string' ? pending.referrerName : 'Your host' } : null);
      }
      setStage("checkout");
    }
  }
  async function resumeBooking(orderId) {
    if (checkoutLock.current || !session) return;
    checkoutLock.current = true; setDemoBusy(true); setDemoError('');
    const buyerId = session.user.id;
    try {
      const result = await api(`/customer/payment-checkouts/${encodeURIComponent(orderId)}/resume`, { token: session.accessToken, method: 'POST' });
      if (currentCheckoutBuyer.current !== buyerId) return;
      const attempt = restorePaymentAttempt(buyerId, result);
      if (result.status === 'paid') { await openPurchasedPasses(result.orderId, attempt); setCheckoutRecovering(false); return; }
      if (['cancelled', 'refunded'].includes(result.status)) { clearCheckoutAttempt(buyerId, attempt.body.idempotencyKey); throw new Error('This checkout has ended. Select your tickets again to start a new booking.'); }
      openEvent({ ...result.booking.event, offerings: attempt.eventContext.offerings });
      activeCheckoutAttempt.current = attempt;
      setOfferingId(attempt.body.items[0].offeringId); setQuantity(attempt.body.items[0].quantity);
      setReferral(null); setStage('checkout'); setCheckoutRecovering(true); setPaymentCheckout(result);
    } finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function openPurchasedPasses(orderId, attempt, token = session.accessToken) {
    const ticket = await api(`/customer/purchases/${encodeURIComponent(orderId)}/tickets`, { token });
    if (currentCheckoutBuyer.current !== attempt.buyerId) return;
    setSelected(null); setWalletOpen(false); setView('booked'); setBookingRoute(`purchase:${orderId}`);
    setNotificationBooking({ ticket });
    setPaymentCheckout(null);
    updateCustomerRoute({ tab: 'booked', eventId: null, booking: `purchase:${orderId}` });
    clearCheckoutAttempt(attempt.buyerId, attempt.body.idempotencyKey);
    activeCheckoutAttempt.current = null;
    setBookingsRevision(value => value + 1);
    refreshConnections();
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    if (!session) { recoveryBuyer.current = null; return; }
    if (recoveryBuyer.current === session.user.id) return;
    recoveryBuyer.current = session.user.id;
    const returnedOrder = new URLSearchParams(window.location.search).get('paymentOrder');
    if (returnedOrder && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(returnedOrder)) {
      resumeBooking(returnedOrder).catch(error => setNotice(`We couldn’t restore your booking: ${error.message}`));
      const url = new URL(window.location.href); url.searchParams.delete('paymentOrder'); url.searchParams.delete('session_id');
      window.history.replaceState(window.history.state, '', url);
      return;
    }
    const attempt = readCheckoutAttempt(session.user.id);
    if (!attempt) return;
    checkoutLock.current = true; setDemoBusy(true); setCheckoutRecovering(true);
    let active = true;
    (async () => {
      const resumed = attempt.mode === 'stripe' ? await resumePaymentCheckout(attempt, api, session.accessToken) : null;
      const orderId = resumed ? (resumed.status === 'paid' ? resumed.orderId : null) : await checkCheckoutAttempt(attempt, api, session.accessToken);
      if (!active) return;
      if (orderId) { await openPurchasedPasses(orderId, attempt, session.accessToken); setCheckoutRecovering(false); return; }
      // Check lost payment responses automatically, but do not drag customers
      // back into an abandoned payment form when visiting Booked or discovery.
      // The durable notification is the explicit way to continue that purchase.
      if (resumed?.orderId && !parseCustomerRoute(window.location.search).eventId) { setCheckoutRecovering(false); return; }
      let event;
      try { event = await api(`/events/${encodeURIComponent(attempt.body.eventId)}`); }
      catch (error) { event = restoredCheckoutEvent(attempt); if (!event) throw error; }
      if (!active) return;
      openEvent(event);
      activeCheckoutAttempt.current = resumed?.booking ? restorePaymentAttempt(attempt.buyerId, resumed) : resumed?.orderId ? rememberCheckoutOrder(attempt, resumed.orderId) : attempt;
      setOfferingId(attempt.body.items[0].offeringId); setQuantity(attempt.body.items[0].quantity); setStage('checkout'); setCheckoutRecovering(true);
      setReferral(attempt.body.affiliateCode ? { eventId: attempt.body.eventId, code: attempt.body.affiliateCode, referrerName: typeof attempt.referrerName === 'string' ? attempt.referrerName : 'Your host' } : null);
      if (resumed) setPaymentCheckout(resumed);
      setDemoError(resumed?.verificationStatus === 'review' ? 'Your payment needs review. Contact the event host before making another payment.' : resumed ? '' : 'Your previous attempt has no confirmed booking yet. Retry to check and complete the same booking.');
    })().catch((error) => { if (active) { if (error.terminalOrderId) { clearCheckoutAttempt(attempt.buyerId, attempt.body.idempotencyKey); setCheckoutRecovering(false); } setDemoError(`We couldn’t check your booking: ${error.message}`); setNotice(`We couldn’t check your booking: ${error.message}`); } })
      .finally(() => { if (active) { checkoutLock.current = false; setDemoBusy(false); } });
    return () => { active = false; checkoutLock.current = false; setDemoBusy(false); };
  }, [session?.user.id]);
  async function completeDemo() {
    if (checkoutLock.current) return;
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
      return;
    }
    if (!offering || (!checkoutRecovering && (availableQuantity(offering) < quantity || !totals.eligible))) return;
    checkoutLock.current = true;
    setDemoBusy(true);
    setDemoError('');
    try {
    const mode = totals.total === 0 ? 'free' : paymentConfig?.enabled && paymentConfig.mode === 'test' ? 'stripe' : demoCheckoutEnabled ? 'demo' : 'disabled';
    if (mode === 'disabled' && !checkoutRecovering) throw new Error('Payment checkout is not ready yet. Please try again later.');
    let attempt = checkoutRecovering ? activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id) : prepareCheckoutAttempt(session.user.id, {
      eventId: selected.id,
      expectedTotalCents: totals.total,
      affiliateCode: referralCodeForEvent(referral, selected.id),
      items: [{ offeringId: offering.id, quantity }],
      ...(mode === 'demo' ? { payment: { provider: 'demo', reference: crypto.randomUUID(), status: 'succeeded' } } : {}),
    }, undefined, undefined, mode, referralCodeForEvent(referral, selected.id) ? referral.referrerName : null, selected);
    if (!attempt) throw new Error('Your saved attempt is unavailable. Open Notifications to continue your purchase.');
    activeCheckoutAttempt.current = attempt;
    setCheckoutRecovering(true);
    if (attempt.mode === 'stripe') {
      const result = await resumePaymentCheckout(attempt, api, session.accessToken);
      if (currentCheckoutBuyer.current !== attempt.buyerId) return;
      attempt = result.booking ? restorePaymentAttempt(attempt.buyerId, result) : rememberCheckoutOrder(attempt, result.orderId);
      activeCheckoutAttempt.current = attempt;
      if (result.status === 'paid') { await openPurchasedPasses(result.orderId, attempt); setCheckoutRecovering(false); }
      else { setPaymentCheckout(result); setDemoError(''); }
      return;
    }
    const orderId = await submitCheckoutAttempt(attempt, api, session.accessToken);
    await openPurchasedPasses(orderId, attempt);
    setCheckoutRecovering(false);
    } catch (error) {
      if (error.checkoutRejected || error.terminalOrderId) {
        const rejected = readCheckoutAttempt(session.user.id);
        if (rejected) clearCheckoutAttempt(session.user.id, rejected.body.idempotencyKey);
        setCheckoutRecovering(false);
        setDemoError(`Booking was not completed: ${error.message} Review your selection before trying again.`);
      } else setDemoError(`We couldn’t confirm the result. Check or retry this same booking: ${error.message}`);
    }
    finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function verifyBooking() {
    if (!paymentCheckout || !session) return;
    checkoutLock.current = true; setDemoBusy(true); setDemoError('');
    try {
      const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
      const result = await verifyPaymentCheckout(paymentCheckout.orderId, api, session.accessToken);
      if (attempt) await openPurchasedPasses(result.orderId, attempt);
      setCheckoutRecovering(false); setPaymentCheckout(null);
    } catch (error) {
      if (error.paymentReview) setPaymentCheckout({ orderId: error.orderId, status: 'pending', verificationStatus: 'review' });
      if (error.terminalOrderId) {
        const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
        if (attempt) clearCheckoutAttempt(session.user.id, attempt.body.idempotencyKey);
        setCheckoutRecovering(false); setPaymentCheckout(null); setStage('details');
      }
      setDemoError(error.message);
    }
    finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function cancelPaymentBooking() {
    if (checkoutLock.current || !paymentCheckout) return;
    checkoutLock.current = true; setDemoBusy(true); setDemoError('');
    try {
      const result = await api(`/customer/payment-checkouts/${encodeURIComponent(paymentCheckout.orderId)}/cancel`, { token: session.accessToken, method: 'POST' });
      const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
      if (result.status === 'paid') { if (attempt) await openPurchasedPasses(result.orderId, attempt); }
      else if (result.status === 'cancelled') { if (attempt) clearCheckoutAttempt(session.user.id, attempt.body.idempotencyKey); activeCheckoutAttempt.current = null; setPaymentCheckout(null); setCheckoutRecovering(false); setStage('details'); setBookingsRevision(value => value + 1); }
      else { setPaymentCheckout(current => ({ ...current, ...result })); setDemoError(result.verificationStatus === 'review' ? 'Your payment needs review. Contact the event host before making another payment. Your booking reference is saved.' : 'Your payment is still being checked. Your booking is saved; check again shortly.'); }
    } catch (error) { setDemoError(error.message); }
    finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function requestGuestlist() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setGuestBusy(true);
    setGuestError("");
    try {
      const result = await api(`/events/${selected.id}/guestlist`, {
        token: session.accessToken,
        body: { partySize: guestPartySize, affiliateCode: referralCodeForEvent(referral, selected.id) },
      });
      setGuestState("pending");
      setGuestEntry(result?.entry || result);
      refreshConnections();
    } catch (error) {
      if (error.status === 401) {
        clearPassCache(session.user.id);
        setSession(null);
        writeStorage('nitewide.session', null);
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
  async function openGuestlistEntry(entryId, token = session?.accessToken) {
    if (!entryId || !token) return;
    try {
      const ticket = await api(`/customer/guestlists/${encodeURIComponent(entryId)}/pass`, { token });
      setSelected(null); setWalletOpen(false); setView('booked'); setBookingRoute(`guestlist:${entryId}`); setNotificationBooking({ ticket });
      updateCustomerRoute({ tab: 'booked', eventId: null, booking: `guestlist:${entryId}` });
      window.scrollTo({ top: 0 });
    } catch (error) { setNotice(`Your guestlist entry is in Booked, but it couldn’t open just now: ${error.message}`); }
  }
  if (onboardingToken) return <>
    <OnboardingSetup
      token={onboardingToken}
      session={session}
      onSignIn={() => setAuthOpen(true)}
      onSwitchAccount={async (signIn) => {
        if (session?.accessToken) {
          try { await api('/auth/logout', { token: session.accessToken, method: 'POST' }); }
          catch (error) { if (error.status !== 401) { setNotice(error.message); return; } }
        }
        if (session?.user?.id) clearPassCache(session.user.id); writeStorage('nitewide.session', null); setSession(null); setAuthOpen(signIn);
      }}
      onContinue={() => { setOnboardingToken(null); if (!session) setAuthOpen(true); }}
    />
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} onSuccess={authSuccess} />
    {notice && <p role="alert">{notice}</p>}
  </>;
  return (
    <>
      <PasswordResetDialog token={passwordResetToken} onClose={clearResetToken} onSuccess={() => { clearResetToken(); setNotice('Password updated. Sign in with your new password.'); setAuthOpen(true); }} />
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
                navigateView('discover');
              }}
            >
              Discover
            </button>
            <button className={view === 'booked' ? 'active' : ''} aria-current={view === 'booked' ? 'page' : undefined} onClick={() => navigateView('booked')}>Booked</button>
            <button
              className={view === 'saved' ? 'active' : ''}
              aria-current={view === 'saved' ? 'page' : undefined}
              onClick={() => {
                navigateView('saved');
              }}
            >
              Saved
            </button>
            {hasConnections && <button className={view === 'connections' ? 'active' : ''} aria-current={view === 'connections' ? 'page' : undefined} onClick={() => navigateView('connections')}>Connections</button>}
          </nav>
          <div className="header-actions">
            {session ? (
              <>
                <Notifications key={session.user.id} session={session} onNotification={openNotification} refreshKey={`${bookingsRevision}:${selected?.id || ''}:${paymentCheckout?.status || ''}`} />
                <button className="profile-avatar profile-trigger" aria-label={`Open ${session.user.displayName}'s profile`} title="Your profile" onClick={() => setWalletOpen(true)}>{initials(session.user.displayName)}</button>
              </>
            ) : (
              <Button
                className="signin-button"
                onClick={() => setAuthOpen(true)}
              >
                Log in <LogIn size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </header>
      {view === 'connections' && hasConnections && <ConnectionsPage key={session.user.id} session={session} history={connectionsHistory} saved={saved} onSave={save} onReferral={openConnection} onRefresh={refreshConnections} onVisible={savedCollection.checkVisible} />}
      {view === 'booked' && <main className="booked-page wrap" id="booked">
        <div className="booked-page-heading"><p className="eyebrow">YOUR NEXT NIGHT STARTS HERE</p><h1>Booked.</h1><p>Your tickets and guest list entries, all in one place.</p></div>
        {session ? <AccountDialog key={session.user.id} embedded open session={session} onResumeCheckout={resumeBooking} bookingsRevision={bookingsRevision} notificationBooking={notificationBooking} bookingRoute={bookingRoute} onBookingRouteChange={(value) => { setBookingRoute(value); updateCustomerRoute({ tab: 'booked', booking: value }, { replace: !value }); }} onNotificationOpened={() => setNotificationBooking(null)} onOpenChange={() => navigateView('discover')} /> : <div className="account-empty"><Ticket /><h2>Your nights are waiting.</h2><p>Sign in to see your upcoming bookings and guest list entries.</p><Button className="dark-glass-action" onClick={() => setAuthOpen(true)}>Sign in</Button></div>}
      </main>}
      {view === 'saved' && <main className="booked-page wrap" id="saved">
        <div className="booked-page-heading"><p className="eyebrow">KEEP THE GOOD NIGHTS CLOSE</p><h1>Saved.</h1><p>Your shortlist of upcoming events.</p></div>
        {savedCollection.mergeError && <p className="account-error" role="alert">Your guest saves have not synced yet. <button type="button" onClick={savedCollection.retry}>Retry sync</button></p>}
        {savedCollection.loadState === 'error' && Boolean(savedCollection.items.length) && <p className="account-error" role="alert">Couldn’t refresh Saved. Showing previously loaded nights. <button type="button" onClick={savedCollection.retry}>Try again</button></p>}
        {savedCollection.loadState === 'loading' && !savedCollection.items.length ? <LoadingIndicator>Finding your saved nights…</LoadingIndicator> : savedCollection.loadState === 'error' && !savedCollection.items.length ? <div className="account-empty"><p>We couldn’t load your saved events.</p><Button onClick={savedCollection.retry}>Try again</Button></div> : savedUpcoming.length ? <div className="event-grid">{savedUpcoming.map((event) => <EventCard key={event.id} event={event} saved onSave={() => save(event)} onOpen={() => openEvent(event)} />)}</div> : <div className="account-empty"><h2>{savedCollection.hasMore ? 'No active nights on this page.' : 'No upcoming saved events yet.'}</h2><p>{savedCollection.hasMore ? 'More saved nights may appear on the next page.' : 'Tap the heart on an event to keep it here. Past events stay out of your shortlist.'}</p><Button className="dark-glass-action" onClick={() => navigateView('discover')}>Discover events</Button></div>}
        {savedCollection.hasMore && savedCollection.loadState !== 'error' && <Button className="load-more" variant="outline" disabled={savedCollection.loadState === 'loading'} onClick={savedCollection.loadMore}>More saved nights</Button>}
      </main>}
      <main hidden={view !== 'discover'} className={returnVisitor ? 'return-visitor-discovery' : ''}>
        <section className="hero wrap">
          <div className="hero-copy">
            <h1>Find your kind of night.</h1>
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
              const next = { date: String(form.get('date') || ''), city: String(form.get('city') || ''), query: String(form.get('query') || ''), shortcut: '' };
              setShortcut('');
              applyDiscovery(next);
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
                  onInput={(event) => { setDate(event.currentTarget.value); setShortcut(''); }}
                  onChange={(event) => { setDate(event.target.value); setShortcut(''); }}
                  onBlur={(event) => setDate(event.currentTarget.value)}
                />
              </span>
              {date && (
                <button
                  type="button"
                  aria-label="Reset to next 7 days"
                  onClick={() => { setDate(''); setShortcut(''); }}
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
          <div className="discovery-shortcuts" aria-label="Quick dates">
            {[['tonight', 'Tonight'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend']].map(([value, label]) => <button key={value} type="button" aria-pressed={submitted.shortcut === value} onClick={() => { setShortcut(value); setDate(''); applyDiscovery({ city, date: '', query, shortcut: value }); }}>{label}</button>)}
          </div>
          {(submitted.city || submitted.date || submitted.query || submitted.shortcut) && <div className="active-discovery-filters" aria-label="Active filters">
            {submitted.city && <button onClick={() => { setCity(''); applyDiscovery({ ...submitted, city: '' }); }}>City: {submitted.city} <X size={13} /></button>}
            {submitted.date && <button onClick={() => { setDate(''); applyDiscovery({ ...submitted, date: '' }); }}>Date: {calendarLabel(submitted.date)} <X size={13} /></button>}
            {submitted.shortcut && <button onClick={() => { setShortcut(''); applyDiscovery({ ...submitted, shortcut: '' }); }}>{submitted.shortcut === 'weekend' ? 'This weekend' : submitted.shortcut === 'tonight' ? 'Tonight' : 'Tomorrow'} <X size={13} /></button>}
            {submitted.query && <button onClick={() => { setQuery(''); applyDiscovery({ ...submitted, query: '' }); }}>Search: {submitted.query} <X size={13} /></button>}
          </div>}
          <div className="search-caption">
            <span>Book on the web. Be there in real life.</span>
          </div>
        </div>
        <DiscoveryResults submitted={submitted} results={results} loadState={loadState} nextCursor={nextCursor} moreState={moreState} loadEvents={loadEvents} loadMore={loadMore} saved={saved} save={save} openEvent={openEvent} discoveryRange={discoveryRange} weekRange={weekRange} weeklyEvents={weeklyEvents} previewState={previewState} previewCursor={previewCursor} visible={view === 'discover'} />
        {!returnVisitor && <section className="how-section wrap">
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
        </section>}
      </main>
      <footer className="site-footer wrap">
        <div className="footer-identity">
          <Brand />
          <p className="copyright">© {new Date().getFullYear()} Nitewide</p>
        </div>
        <a className="business-nav-link footer-business" href={businessLink(import.meta.env.VITE_BUSINESS_URL, window.location)}>For business <ArrowUpRight size={14} /></a>
      </footer>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !guestBusy && !referralBusy && !checkoutLock.current) closeEvent();
        }}
      >
        <DialogContent
          data-testid="customer-event-details"
          className={`event-modal${isPremiumHost(selected) ? ' premium-host-card' : ''}`}
          data-event-stage={stage}
          ref={eventDialogRef}
          tabIndex={-1}
          onOpenAutoFocus={(event) => openEventDialogAtTop(event, eventDialogRef.current)}
        >
          <DialogHeader>
            {stage !== "details" && (
              <p className="eyebrow">
                {stage === "complete" ? "DEMO BOOKING" : "REVIEW YOUR NIGHT"}
              </p>
            )}
            <DialogTitle>
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
              {selectedPendingCheckout && <div className="checkout-summary" role="status"><strong>You have an unfinished purchase for this event.</strong><p>Resume your saved checkout to complete payment or cancel it.</p><Button disabled={demoBusy} onClick={selectedPendingCheckout.orderId ? async () => { try { await resumeBooking(selectedPendingCheckout.orderId); } catch (error) { setNotice(error.message); } } : checkout}>{demoBusy ? <LoadingIndicator>Restoring checkout…</LoadingIndicator> : 'Resume checkout'}</Button></div>}
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
                <div className="detail-location-copy">
                  <span>{selected.location?.name || "Location shared with attendees"}</span>
                  <small>
                    {eventAddressLines(selected.location).map((line, index) => (
                      <span key={index}>{line}</span>
                    ))}
                  </small>
                </div>
                <div className="detail-location-actions">
                  <button
                    type="button"
                    className={`save-button ${saved.includes(selected.id) ? "saved" : ""}`}
                    onClick={() => save(selected)}
                    aria-label={`${saved.includes(selected.id) ? "Unsave" : "Save"} ${selected.title}`}
                    aria-pressed={saved.includes(selected.id)}
                    title={saved.includes(selected.id) ? "Remove from saved" : "Save event"}
                  >
                    <Heart size={18} fill={saved.includes(selected.id) ? "currentColor" : "none"} aria-hidden="true" />
                  </button>
                  <button type="button" className="save-button event-share-button" onClick={shareSelectedEvent} aria-label={`Share ${selected.title}`} title="Share event">
                    <Share size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {mapsUrlForLocation(selected.location) && <a className="event-maps-link" href={mapsUrlForLocation(selected.location)} target="_blank" rel="noopener noreferrer"><MapPin size={15} /> Open in Maps</a>}
              {shareFeedback && <p className="event-share-feedback" role="status">{shareFeedback}</p>}
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
                        className="primary-action dark-glass-action"
                        onClick={checkout}
                        disabled={referralBusy || !availableQuantity(offering) || !totals.eligible}
                      >
                        {totals.eligible ? `Continue · ${money(totals.total, offering.currency)}` : 'Pricing unavailable'}
                        <ArrowRight />
                      </Button>
                      {!totals.eligible && <p role="alert" className="fine-print">This combination is not available at our current pricing. Try another offering or quantity.</p>}
                    </>
                  )}
                  <p className="demo-note">
                    {totals.total === 0 ? 'Free admission · No payment required.' : paymentConfig?.enabled ? 'Secure sandbox checkout · Test payments only.' : demoCheckoutEnabled ? 'Demo checkout · No payment will be collected.' : 'Payments are being prepared.'}
                  </p>
                </TabsContent>
                <TabsContent value="guestlist">
                  <div className="guestlist-panel">
                    <Users />
                    <h3>{guestState === 'pending' ? 'Awaiting host approval.' : guestState === 'confirmed' || guestState === 'checked_in' ? 'You’re on the guestlist.' : guestState === 'rejected' ? 'Request declined.' : 'Get on the guestlist.'}</h3>
                    <p>{guestState === 'pending' ? 'Your request is pending. Entry is confirmed only after the host approves it.' : guestState === 'confirmed' ? 'Your entry is approved. Open your pass in Booked.' : guestState === 'checked_in' ? 'Your party has checked in.' : guestState === 'rejected' ? 'The host declined this request. Your Booked history keeps the result.' : 'Choose 1–20 guests, including yourself. The host reviews your request before entry is confirmed.'}</p>
                    {guestError && (
                      <p className="error-message" role="alert">
                        {guestError}
                      </p>
                    )}
                    {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
                    {guestStatusLoading && <LoadingIndicator>Checking your request…</LoadingIndicator>}
                    {guestEntry && <p className="guestlist-entry-summary">{guestEntry.partySize} {guestEntry.partySize === 1 ? 'guest' : 'guests'} · {guestState === 'pending' ? 'Pending' : guestState === 'confirmed' ? 'Approved' : guestState === 'rejected' ? 'Declined' : guestState === 'checked_in' ? 'Checked in' : guestState.replace('_', ' ')}</p>}
                    {(!guestEntry || guestState === 'pending') && <form className="guestlist-party-form" onSubmit={guestEntry ? changeGuestPartySize : (event) => { event.preventDefault(); requestGuestlist(); }}>
                      <label htmlFor="guest-party-size">Party size, including you</label>
                      <select id="guest-party-size" value={guestPartySize} disabled={guestBusy || guestStatusLoading} onChange={(event) => setGuestPartySize(Number(event.target.value))}>{Array.from({ length: guestEntry ? 20 : Math.max(1, Math.min(20, session ? guestMaxPartySize : 20)) }, (_, index) => index + 1).map((size) => <option key={size} value={size}>{size} {size === 1 ? 'guest' : 'guests'}</option>)}</select>
                      <Button type="submit" disabled={guestBusy || referralBusy || guestStatusLoading || (!guestEntry && session && !guestRequestsOpen) || (guestEntry && guestPartySize === guestEntry.partySize)}>{guestBusy ? 'Updating…' : guestEntry ? 'Update party size' : session ? guestRequestsOpen ? 'Request guestlist approval' : 'Guestlist requests closed' : 'Sign in to request'}</Button>
                    </form>}
                    {guestState === 'pending' && <Button variant="ghost" disabled={guestBusy} onClick={withdrawGuestRequest}>Withdraw request</Button>}
                    {guestEntry && <Button variant="outline" onClick={() => openGuestlistEntry(guestEntry.id)}>View entry in Booked</Button>}
                    {!session && guestlistInviteToken && <p>Have an invitation? Sign in to claim it.</p>}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
          {selected && stage === "checkout" && offering && (
            <div className="checkout-review">
              <Badge variant="outline">{totals.total === 0 ? 'FREE BOOKING' : paymentConfig?.enabled ? 'SANDBOX CHECKOUT' : demoCheckoutEnabled ? 'DEMO CHECKOUT' : 'PAYMENTS UNAVAILABLE'}</Badge>
              <p>
                {totals.total === 0 ? 'Confirm your free admission. No card details are required.' : paymentConfig?.enabled ? 'Pay securely with Stripe in test mode. Use test payment details only; no real charge will be made.' : demoCheckoutEnabled ? 'This creates a demo order and admission in local test data. No card details or charge; not valid for entry.' : 'Paid booking will be available once secure payment setup is complete.'}
              </p>
              <div className="order-summary">
                <h3>{paymentCheckout?.booking?.items.length > 1 ? 'Your booking' : offering.name}</h3>
                <p>
                  {paymentCheckout?.booking ? paymentCheckout.booking.items.map(item => `${item.quantity} × ${item.name} · ${money(item.unitPriceCents, paymentCheckout.booking.currency)}`).join(' / ') : <>{quantity} × {money(offering.priceCents, offering.currency)}</>}
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
              {demoError && <p role="alert">{demoError}</p>}
              {paymentCheckout?.verificationStatus === 'review' && <p role="status" className="fine-print">Your payment needs review. Contact the event host for help before making another payment. Booking reference: {paymentCheckout.orderId}</p>}
              {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
              {paymentCheckout?.clientSecret && paymentCheckout.verificationStatus !== 'review' && paymentConfig?.enabled && <Suspense fallback={<LoadingIndicator>Loading secure payment form…</LoadingIndicator>}><StripeCheckout key={paymentCheckout.orderId} config={paymentConfig} checkout={paymentCheckout} onVerify={verifyBooking} onBusyChange={busy => { checkoutLock.current = busy; setDemoBusy(busy); }} /></Suspense>}
              {paymentCheckout ? <>{!paymentCheckout.clientSecret && paymentCheckout.verificationStatus !== 'review' && <Button className="primary-action dark-glass-action" disabled={demoBusy} onClick={completeDemo}>Resume checkout</Button>}<Button className="primary-action dark-glass-action" disabled={demoBusy} onClick={verifyBooking}>{demoBusy ? <LoadingIndicator>Checking your booking…</LoadingIndicator> : 'Check booking'}</Button>{paymentCheckout.verificationStatus !== 'review' && <Button variant="outline" disabled={demoBusy} onClick={cancelPaymentBooking}>Cancel payment attempt</Button>}<p className="fine-print">You can close this window and continue your purchase from Notifications.{paymentCheckout.verificationStatus !== 'review' && ' Cancellation is final only after the server confirms payment was not completed.'}</p></> : <Button className="primary-action dark-glass-action" onClick={completeDemo} disabled={demoBusy || (!checkoutRecovering && (!totals.eligible || (totals.total > 0 && !paymentConfig?.enabled && !demoCheckoutEnabled)))}>
                {demoBusy ? <LoadingIndicator>{checkoutRecovering ? 'Checking your booking…' : 'Preparing your booking…'}</LoadingIndicator> : <>{checkoutRecovering ? 'Check / retry booking' : totals.total === 0 ? 'Confirm free booking' : paymentConfig?.enabled ? 'Continue to payment' : demoCheckoutEnabled ? 'Confirm demo booking' : 'Payments unavailable'} <ArrowRight /></>}
              </Button>}
              <Button variant="ghost" disabled={demoBusy || checkoutRecovering} onClick={() => setStage("details")}>
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
                  navigateView('booked');
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
      <AccountDialog open={walletOpen} onOpenChange={setWalletOpen} session={session}
        onSessionChanged={(updated) => { setSession(updated); writeStorage('nitewide.session', updated); }}
        onProfile={(user) => { const updated = { ...session, user }; setSession(updated); writeStorage('nitewide.session', updated); }}
        onSignOut={async (everywhere = false) => {
          try { await api(everywhere ? '/auth/sessions/revoke-all' : '/auth/logout', { token: session.accessToken, method: 'POST' }); }
          catch (error) { if (error.status !== 401) return error.message; }
          clearPassCache(session.user.id); setWalletOpen(false); setSession(null); setReferral(null); writeStorage('nitewide.session', null); setNotice('You’re signed out.');
        }} />
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
