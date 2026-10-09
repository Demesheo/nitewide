import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TermsLink } from '../../shared/terms-and-conditions.jsx';
import { ArrowUpRight, ArrowRight, MapPin, Search, Ticket, Users, Minus, Plus, Check, Compass, X, Share, Heart, LogIn } from "lucide-react";
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
import { RundownPage } from './components/rundown-page';
import { loadRundownEvent } from './lib/rundown-event';
import { DiscoveryCitySearch } from './components/discovery-city-search';
import { DiscoveryDateSearch } from './components/discovery-date-search';
import { DiscoveryControls } from './components/discovery-controls';
import { qualifiedDiscoveryCity } from './lib/discovery-selection';
import { EventArtwork } from './components/event-artwork';
import { eventAddressLines, eventDate, eventTime } from "./lib/presentation";
import { LoadingIndicator } from './components/loading-indicator';
import { ManualCopyLink, useClipboardCopy } from '../../shared/clipboard-copy.jsx';
import { upcomingSavedEvents } from './lib/saved-events';
import { useSavedEvents } from './lib/use-saved-events';
import { useDiscovery } from './lib/use-discovery';
import { useCurrentCity } from './lib/use-current-city';
import { AuthDialog } from "./components/auth-dialog";
import { PasswordResetDialog } from './components/password-reset-dialog';
import { OnboardingSetup } from './components/onboarding-setup';
import { Notifications } from "./components/notifications";
import { Messages, ContactNitewide } from './components/messages';
import { notificationTarget, loadNotificationBooking } from './lib/notification-target';
import { AccountDialog, initials } from './components/account-dialog';
import { ConnectionsPage } from './components/connections-page';
import { MyEventsAccessState } from './components/my-events-access-state';
import { useMyEventsAccess } from './lib/use-my-events-access';
import './components/my-events-navigation.css';
import { EventConnectionPicker } from './components/event-connection-picker';
import { useConnections } from './lib/use-connections';
import { focusEventDialogStart, openEventDialogAtTop } from './lib/dialog-focus';
import { detectCurrentCity, discoveryAreaStorageKey, initialDiscoveryCity } from "./discovery-defaults";
import { api } from "./lib/api";
import { readCheckoutAttempt, prepareCheckoutAttempt, clearCheckoutAttempt, checkCheckoutAttempt, submitCheckoutAttempt, resumePaymentCheckout, checkPaymentCheckout, verifyPaymentCheckout, restoredCheckoutEvent, rememberCheckoutOrder, restorePaymentAttempt } from './lib/checkout-attempt';
import { businessLink } from './lib/business-link';
import { referralCodeForEvent, referralFromSearch } from './lib/referral';
import { eventShareUrl } from './lib/event-share';
import { bookingFromSearch } from './lib/booking-link';
import { canApplyInitialEvent, parseCustomerRoute, rundownContextKeyFromSearch, rundownIdFromSearch, rundownPreviewFromSearch, updateCustomerRoute } from './lib/customer-route';
import { mapsUrlForLocation } from './lib/maps-link';
import { clearPassCache } from './lib/pass-cache';
import { GuestlistInvitationPage } from './components/guestlist-invitation-page';
import { GuestlistQuantity } from './components/guestlist-quantity';
import { customerGuestlistMaxPartySize, customerGuestlistPartyLimit, validGuestlistPartySize } from './lib/guestlist-quantity';
import brandLogo from './assets/nitewide-logo-v1.png';
import { isPremiumHost } from './lib/premium-host';
import {
  availableQuantity,
  offeringAvailabilityLabel,
  offeringPrice,
  feeLabel,
  checkoutTotal,
  cityName,
  upcomingWeekRange,
  money,
  priceLabel,
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
const MyEventsPage = lazy(() => import('./components/my-events-page').then(module => ({ default: module.MyEventsPage })));
const Brand = () => (
  <a href="/" aria-label="Nitewide home" className="brand">
    <img className="brand-logo" src={brandLogo} alt="" aria-hidden="true" width="192" height="192" decoding="async" draggable="false" />
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
  const invitation = new URLSearchParams(window.location.search).get('guestlistInvite');
  return invitation ? <GuestlistInvitationPage token={invitation}/> : <CustomerApp/>;
}

function CustomerApp() {
  const initialRoute = useRef(parseCustomerRoute(window.location.search)).current;
  const [rundownId, setRundownId] = useState(() => rundownIdFromSearch(window.location.search));
  const [rundownPreview, setRundownPreview] = useState(() => rundownPreviewFromSearch(window.location.search));
  const rundownEventRequest = useRef(null);
  useEffect(() => () => rundownEventRequest.current?.abort(), []);
  const initialCity = useRef(initialDiscoveryCity(initialRoute, readStorage(discoveryAreaStorageKey, ''),
    new URLSearchParams(window.location.search).has('city') || initialRoute.tab === 'my-events')).current;
  const [city, setCity] = useState(initialCity),
    [date, setDate] = useState(initialRoute.date),
    [query, setQuery] = useState(initialRoute.query);
  const [submitted, setSubmitted] = useState({ city: initialCity, date: initialRoute.date, query: initialRoute.query, shortcut: initialRoute.shortcut, scope: initialRoute.scope, sort: initialRoute.sort });
  const submittedRef = useRef(submitted);
  submittedRef.current = submitted;
  const holdCityMenuOnBlur = useRef(false);
  const [cityMenuDismissal, setCityMenuDismissal] = useState(0);
  const { events, previewEvents, loadState, nextCursor, moreState, previewCursor, previewState, area: discoveryArea, distanceOrigin, resolutionStatus, hasUpcomingAreaEvents, reload: loadEvents, loadMore } = useDiscovery(rundownId || rundownPreview ? { ...submitted, city: '' } : submitted);
  const [view, setView] = useState(initialRoute.tab);
  const showingRundown = view === 'discover' && Boolean(rundownId || rundownPreview);
  const [returnVisitor] = useState(() => Boolean(readStorage('nitewide.returning', false)));
  useEffect(() => { writeStorage('nitewide.returning', true); }, []);
  const [session, setSession] = useState(validSession),
    [authOpen, setAuthOpen] = useState(false),
    [walletOpen, setWalletOpen] = useState(() => new URLSearchParams(window.location.search).has('commissionProfileReturn'));
  const currentSessionToken = useRef(session?.accessToken);
  currentSessionToken.current = session?.accessToken;
  const [notificationBooking, setNotificationBooking] = useState(null);
  const [messageBooking, setMessageBooking] = useState(null), [messageThread, setMessageThread] = useState(null);
  const [supportThread, setSupportThread] = useState(null);
  useEffect(() => { setSupportThread(null); }, [session?.accessToken]);
  const [bookingRoute, setBookingRoute] = useState(initialRoute.booking);
  const [myEventsRoute, setMyEventsRoute] = useState({ myEventId: initialRoute.myEventId, myStatus: initialRoute.myStatus, myPage: initialRoute.myPage, mySearch: initialRoute.mySearch });
  const myEventsAccess = useMyEventsAccess(session, view === 'my-events');
  const hasMyEvents = Boolean(session && myEventsAccess.eligible);
  const handleMyEventsUnauthorized = useCallback((error) => {
    setMyEventsRoute(current => ({ ...current, myEventId: null }));
    if (parseCustomerRoute(window.location.search).tab === 'my-events') updateCustomerRoute({ myEventId: null }, { replace: true });
    myEventsAccess.invalidate();
    if (error?.status === 401) {
      if (session?.user?.id) clearPassCache(session.user.id);
      writeStorage('nitewide.session', null);
      setSession(null);
    }
  }, [myEventsAccess.invalidate, session?.user?.id]);
  const previousMyEventsSession = useRef(session?.accessToken);
  useEffect(() => {
    if (previousMyEventsSession.current && !session?.accessToken) {
      setMyEventsRoute(current => ({ ...current, myEventId: null }));
      if (parseCustomerRoute(window.location.search).tab === 'my-events') updateCustomerRoute({ myEventId: null }, { replace: true });
    }
    previousMyEventsSession.current = session?.accessToken;
  }, [session?.accessToken]);
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
    currentCity.cancel();
    if (['guestlist_request', 'referral_purchase'].includes(item.kind) && item.eventId) {
      const next = { myEventId: item.eventId, myStatus: 'upcoming', myPage: 1, mySearch: '' };
      rememberScroll(); setSelected(null); setWalletOpen(false); setBookingRoute(null); setView('my-events'); setMyEventsRoute(next);
      updateCustomerRoute({ tab: 'my-events', ...next });
      window.scrollTo({ top: 0 });
      return false;
    }
    const target = notificationTarget(item);
    if (target?.type === 'support-message') {
      setSupportThread(target.id);
    } else if (target?.type === 'message') {
      setMessageThread(target.id);
    } else if (target?.type === 'checkout') {
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
  const navigationRefreshKey = JSON.stringify([view,
    view === 'my-events' ? myEventsRoute : null,
    view === 'booked' ? bookingRoute : null,
    showingRundown ? rundownId || rundownPreview : null]);
  const connectionsHistory = useConnections(session, `${connectionsRevision}:${navigationRefreshKey}`);
  const hasConnections = Boolean(session && connectionsHistory?.eligible);
  const refreshConnections = () => setConnectionsRevision((value) => value + 1);
  useEffect(() => {
    if (view === 'connections' && (!session || (connectionsHistory && !hasConnections))) navigateView('discover');
  }, [view, hasConnections, connectionsHistory, session]);
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
  const [selected, setSelected] = useState(null),
    [offeringId, setOfferingId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [stage, setStage] = useState("details");
  const previousPreviewToken = useRef(session?.accessToken);
  useEffect(() => {
    if (rundownPreview && previousPreviewToken.current !== session?.accessToken) {
      rundownEventRequest.current?.abort();
      setSelected(null); setReferral(null);
    }
    previousPreviewToken.current = session?.accessToken;
  }, [rundownPreview, session?.accessToken]);
  const [shareFeedback, setShareFeedback] = useState('');
  const { copy: copyLink, manualLink } = useClipboardCopy(selected?.id);
  const [shareAsCopy, setShareAsCopy] = useState(null);
  const selectedShareLink = selected ? eventShareUrl(selected.id, window.location.origin, referralCodeForEvent(referral, selected.id)) : '';
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
  const [guestMaxPartySize, setGuestMaxPartySize] = useState(customerGuestlistMaxPartySize);
  const guestRequestLock = useRef(false);
  const [guestRequestsOpen, setGuestRequestsOpen] = useState(true);
  const [guestStatusLoading, setGuestStatusLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const savedCollection = useSavedEvents(session, view, [...events, ...previewEvents, ...(selected ? [selected] : [])], setNotice);
  const { saved, save } = savedCollection;
  const locationEdited = useRef(false),
    pendingAuth = useRef(null);
  const currentCity = useCurrentCity({
    onStart: () => { locationEdited.current = true; },
    onDetected: (detectedCity) => {
      if (view !== 'discover') return;
      applyDiscovery({ ...submittedRef.current, city: detectedCity }, { preserveLocation: true, scrollResults: false });
      setLocationState('detected');
    },
  });
  const eventDialogRef = useRef(null);
  function rememberScroll() {
    window.history.replaceState({ ...window.history.state, nitewideScrollY: window.scrollY }, '', window.location.href);
  }
  function navigateView(next, { replace = false } = {}) {
    if (checkoutLock.current) return;
    rundownEventRequest.current?.abort();
    setRundownId(null);
    setRundownPreview(null);
    currentCity.cancel();
    rememberScroll();
    setView(next);
    setSelected(null);
    setBookingRoute(null);
    const operatorRoute = { myEventId: null, myStatus: 'upcoming', myPage: 1, mySearch: '' };
    setMyEventsRoute(operatorRoute);
    updateCustomerRoute({ tab: next, eventId: null, referralCode: null, rundownId: null, rundownPreview: null, booking: null, ...(next === 'my-events' ? operatorRoute : {}), ...(next === 'discover' ? submitted : {}) }, { replace });
    if (next === 'discover') requestAnimationFrame(() => document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' }));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function applyDiscovery(next, { preserveDraft = false, scrollResults = true, preserveLocation = false } = {}) {
    rundownEventRequest.current?.abort();
    setRundownId(null);
    setRundownPreview(null);
    locationEdited.current = true;
    if (!preserveLocation) currentCity.cancel();
    const selectedCity = qualifiedDiscoveryCity(next.city);
    next = { ...next, city: selectedCity || next.city.trim(), shortcut: '', scope: next.scope === 'city' ? 'city' : 'nearby', sort: ['distance', 'date'].includes(next.sort) ? next.sort : 'recommended' };
    if (!preserveDraft) setCity(next.city);
    if (selectedCity) writeStorage(discoveryAreaStorageKey, selectedCity);
    rememberScroll();
    setSubmitted(next);
    setView('discover');
    updateCustomerRoute({ tab: 'discover', rundownId: null, rundownPreview: null, referralCode: null, city: next.city, date: next.date, query: next.query, shortcut: next.shortcut, scope: next.scope, sort: next.sort, eventId: null, booking: null });
    if (scrollResults) requestAnimationFrame(() => document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' }));
  }
  function changeDiscoveryControls(changes) {
    setCityMenuDismissal((revision) => revision + 1);
    applyDiscovery({ ...submitted, ...changes }, { preserveDraft: true, scrollResults: false, preserveLocation: true });
  }
  function retainCityMenuForControl(event) {
    // Native selects and controls below the in-flow menu must stay in place
    // through pointer activation, including Safari blur-to-null.
    const control = event.target.closest?.('button, input, select');
    holdCityMenuOnBlur.current = Boolean(event.target.closest?.('[data-discovery-control]') && !control?.disabled);
  }
  function dismissCityMenuForControl() {
    if (!holdCityMenuOnBlur.current) return;
    holdCityMenuOnBlur.current = false;
    setCityMenuDismissal((revision) => revision + 1);
  }
  useEffect(() => {
    let active = true;
    const onPopState = () => {
      if (checkoutLock.current) return;
      rundownEventRequest.current?.abort();
      const route = parseCustomerRoute(window.location.search);
      setRundownId(rundownIdFromSearch(window.location.search));
      setRundownPreview(rundownPreviewFromSearch(window.location.search));
      locationEdited.current = true;
      currentCity.cancel();
      setView(route.tab);
      if (route.tab !== 'my-events') {
        const qualifiedCity = qualifiedDiscoveryCity(route.city);
        const selectedCity = qualifiedCity || route.city;
        if (qualifiedCity) writeStorage(discoveryAreaStorageKey, qualifiedCity);
        setCity(selectedCity); setDate(route.date); setQuery(route.query);
        setSubmitted({ city: selectedCity, date: route.date, query: route.query, shortcut: route.shortcut, scope: route.scope, sort: route.sort });
      }
      setBookingRoute(route.booking);
      setMyEventsRoute({ myEventId: route.myEventId, myStatus: route.myStatus, myPage: route.myPage, mySearch: route.mySearch });
      requestAnimationFrame(() => window.scrollTo({ top: window.history.state?.nitewideScrollY || 0 }));
      if (!route.eventId) { setSelected(null); setReferral(null); return; }
      // Do not leave a different event's details/credit visible while history
      // restores this link. A recovered checkout retains ownership instead.
      if (activeCheckoutAttempt.current?.body.eventId !== route.eventId) { setSelected(null); setReferral(null); }
      const controller = new AbortController();
      rundownEventRequest.current = controller;
      const incoming = referralFromSearch(window.location.search);
      loadRundownEvent({ eventId: route.eventId, code: incoming?.code, signal: controller.signal, sessionKey: referralSessionKey() }, api)
        .then(({ event, referral: source }) => {
          if (active && !controller.signal.aborted && canApplyInitialEvent({ eventId: event.id, routeEventId: parseCustomerRoute(window.location.search).eventId, checkoutLocked: checkoutLock.current, checkoutEventId: activeCheckoutAttempt.current?.body.eventId })) {
            setReferral(source); openEvent(event, { fromRoute: true });
          }
        })
        .catch(() => { if (active && !controller.signal.aborted) setNotice('This event link is no longer available.'); });
    };
    window.addEventListener('popstate', onPopState);
    return () => { active = false; window.removeEventListener('popstate', onPopState); };
  }, []);
  useLayoutEffect(() => {
    if (selected) focusEventDialogStart(eventDialogRef.current);
  }, [selected?.id]);
  const [locationState, setLocationState] = useState(initialCity || new URLSearchParams(window.location.search).has('city') || initialRoute.tab === 'my-events' ? 'selected' : 'finding');
  useEffect(() => {
    if (!selected?.id || !session?.accessToken) { setGuestEntry(null); setGuestState(''); setGuestPartySize(1); setGuestMaxPartySize(customerGuestlistMaxPartySize); setGuestRequestsOpen(true); setGuestStatusLoading(false); return; }
    const controller = new AbortController();
    setGuestStatusLoading(true);
    api(`/customer/events/${encodeURIComponent(selected.id)}/guestlist${referralCodeForEvent(referral, selected.id) ? `?affiliateCode=${encodeURIComponent(referralCodeForEvent(referral, selected.id))}` : ''}`, { token: session.accessToken, signal: controller.signal })
      .then(({ entry, maxPartySize, requestsOpen }) => {
        if (controller.signal.aborted) return;
        setGuestEntry(entry);
        setGuestState(entry?.status || '');
        setGuestPartySize(entry?.partySize || 1);
        setGuestMaxPartySize(customerGuestlistPartyLimit(maxPartySize));
        setGuestRequestsOpen(Boolean(requestsOpen));
      })
      .catch((error) => { if (!controller.signal.aborted) setGuestError(`Couldn’t check your guestlist status: ${error.message}`); })
      .finally(() => { if (!controller.signal.aborted) setGuestStatusLoading(false); });
    return () => controller.abort();
  }, [selected?.id, session?.accessToken, referral?.code]);
  useEffect(() => {
    const incoming = referralFromSearch(window.location.search);
    const initialRundown = rundownContextKeyFromSearch(window.location.search);
    const eventId = initialRoute.eventId;
    if (!eventId) return;
    const controller = new AbortController();
    rundownEventRequest.current = controller;
    let active = true;
    const canApply = (event) => active && !controller.signal.aborted
      && rundownContextKeyFromSearch(window.location.search) === initialRundown
      && referralFromSearch(window.location.search)?.code === incoming?.code
      && canApplyInitialEvent({
      eventId: event.id,
      routeEventId: parseCustomerRoute(window.location.search).eventId,
      checkoutLocked: checkoutLock.current,
      checkoutEventId: activeCheckoutAttempt.current?.body.eventId,
    });
    loadRundownEvent({ eventId, code: incoming?.code, sessionKey: referralSessionKey(), signal: controller.signal }, api)
      .then(({ event, referral: source }) => {
        if (!canApply(event)) return;
        setReferral(source); openEvent(event, { fromRoute: true });
      }).catch(() => { if (active && !controller.signal.aborted) setNotice('This event link is no longer available. You can still browse events.'); });
    return () => { active = false; controller.abort(); };
  }, []);
  useEffect(() => {
    const explicitCity = new URLSearchParams(window.location.search).has('city');
    if (rundownContextKeyFromSearch(window.location.search) || initialCity || explicitCity || initialRoute.tab === 'my-events') {
      const selectedCity = qualifiedDiscoveryCity(initialCity);
      if (selectedCity) writeStorage(discoveryAreaStorageKey, selectedCity);
      return;
    }
    let active = true;
    const controller = new AbortController();
    detectCurrentCity({ signal: controller.signal }).then((value) => {
      if (active) {
        const detectedCity = qualifiedDiscoveryCity(value);
        if (!locationEdited.current && detectedCity) {
          setCity(detectedCity);
          setSubmitted((current) => ({ ...current, city: detectedCity }));
          writeStorage(discoveryAreaStorageKey, detectedCity);
          updateCustomerRoute({ city: detectedCity }, { replace: true });
        }
        setLocationState(detectedCity ? "detected" : "unavailable");
      }
    });
    return () => {
      active = false;
      controller.abort();
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
  function openEvent(event, { fromRoute = false, referralCode } = {}) {
    activeCheckoutAttempt.current = null;
    setCheckoutRecovering(false);
    setPaymentCheckout(null);
    setDemoError('');
    setSelected(event);
    if (!fromRoute) {
      const alreadyOpen = parseCustomerRoute(window.location.search).eventId === event.id;
      if (!alreadyOpen) rememberScroll();
      updateCustomerRoute({ eventId: event.id, referralCode: referralCode !== undefined ? referralCode : referralCodeForEvent(referral, event.id) || null }, { replace: alreadyOpen, eventEntry: alreadyOpen ? Boolean(window.history.state?.nitewideEventEntry) : true });
    }
    setShareFeedback('');
    const first = event.offerings?.find((o) => availableQuantity(o));
    setOfferingId(first?.id || "");
    setQuantity(first?.minPerOrder || 1);
    setStage("details");
    setGuestState("");
    setGuestEntry(null);
    setGuestPartySize(1);
    setGuestMaxPartySize(customerGuestlistMaxPartySize);
    setGuestRequestsOpen(true);
    setGuestError("");
  }
  async function changeGuestPartySize(event) {
    event.preventDefault();
    if (guestRequestLock.current || guestBusy || guestStatusLoading || !guestEntry?.id || guestState !== 'pending') return;
    if (!validGuestlistPartySize(guestPartySize, guestMaxPartySize)) { setGuestError(`Choose between 1 and ${guestMaxPartySize} guests to update your request.`); return; }
    guestRequestLock.current = true;
    setGuestBusy(true); setGuestError('');
    try {
      const result = await api(`/customer/guestlists/${guestEntry.id}`, { token: session.accessToken, method: 'PATCH', body: { partySize: Number(guestPartySize) } });
      setGuestEntry(result.entry);
      setNotice('Guestlist party size updated.');
    } catch (error) { setGuestError(error.message); }
    finally { guestRequestLock.current = false; setGuestBusy(false); }
  }
  async function withdrawGuestRequest() {
    if (guestRequestLock.current || guestBusy || guestStatusLoading || !guestEntry?.id || guestState !== 'pending' || !window.confirm('Withdraw this pending guestlist request?')) return;
    guestRequestLock.current = true;
    setGuestBusy(true); setGuestError('');
    try {
      await api(`/customer/guestlists/${guestEntry.id}`, { token: session.accessToken, method: 'DELETE' });
      setGuestEntry(null); setGuestState(''); setGuestPartySize(1); setNotice('Guestlist request withdrawn.'); refreshConnections();
    } catch (error) { setGuestError(error.message); }
    finally { guestRequestLock.current = false; setGuestBusy(false); }
  }
  function closeEvent() {
    if (window.history.state?.nitewideEventEntry) window.history.back();
    else { setSelected(null); setReferral(null); updateCustomerRoute({ eventId: null, referralCode: null }, { replace: true }); }
  }
  function referralSessionKey() {
    try {
      const key = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
      sessionStorage.setItem('nitewide.referral-session', key);
      return key;
    } catch { return crypto.randomUUID(); }
  }
  async function openRundownEvent(card) {
    if (checkoutLock.current || (!rundownId && !rundownPreview) || (rundownPreview && !session?.accessToken)) return;
    const contextKey = rundownContextKeyFromSearch(window.location.search);
    const previewToken = rundownPreview ? session.accessToken : null;
    rundownEventRequest.current?.abort();
    const controller = new AbortController();
    rundownEventRequest.current = controller;
    try {
      const { event, referral: source } = await loadRundownEvent({ eventId: card.id, code: card.referralCode, signal: controller.signal, sessionKey: referralSessionKey() }, api);
      if (controller.signal.aborted || checkoutLock.current || rundownContextKeyFromSearch(window.location.search) !== contextKey
        || (previewToken && currentSessionToken.current !== previewToken)) return;
      setReferral(source);
      openEvent(event, { referralCode: source?.code || null });
    } catch {
      if (!controller.signal.aborted) setNotice('This event link is no longer available. Please refresh the rundown and try again.');
    }
  }
  async function shareSelectedEvent() {
    if (!selected) return;
    const url = selectedShareLink;
    if (navigator.share && shareAsCopy !== selected.id) {
      try {
        await navigator.share({ title: selected.title, url });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
        // A failed share sheet has already consumed the tap. Copy only on a
        // fresh tap, never after awaiting navigator.share().
        setShareAsCopy(selected.id);
        setShareFeedback('Sharing is unavailable. Tap Share again to copy the link.');
        return;
      }
    }
    try {
      await copyLink(url);
      setShareFeedback('Link copied');
    } catch (error) {
      setShareFeedback(error.message);
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
    setWalletOpen(false); openEvent(event, { referralCode: visit.code });
  }
  async function chooseEventConnection(entry) {
    if (referralBusy || entry === undefined) return;
    setReferralError('');
    const syncReferral = code => updateCustomerRoute({ referralCode: code }, { replace: true, eventEntry: Boolean(window.history.state?.nitewideEventEntry) });
    if (entry === null) { setReferral(null); syncReferral(null); return; }
    if (entry.event.id !== selected?.id) return;
    const controller = new AbortController();
    referralRequest.current?.abort(); referralRequest.current = controller;
    setReferralPending(`${session?.accessToken}:${selected.id}`);
    try {
      const sessionKey = sessionStorage.getItem('nitewide.referral-session') || crypto.randomUUID();
      sessionStorage.setItem('nitewide.referral-session', sessionKey);
      const visit = await api(`/events/${encodeURIComponent(entry.event.id)}/referral-visits`, { signal: controller.signal, body: { code: entry.code, sessionKey } });
      if (!controller.signal.aborted) {
        setReferral({ eventId: entry.event.id, code: visit.code, referrerName: visit.referrerName });
        syncReferral(visit.code);
      }
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
    const next = pendingAuth.current;
    pendingAuth.current = null;
    if (next === "checkout") setStage("checkout");
    if (next === "wallet") navigateView('booked');
  }
  async function checkout() {
    if (checkoutLock.current) return;
    const pending = session && readCheckoutAttempt(session.user.id);
    if (!pending && !totals.eligible) return;
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
    } else {
      if (pending?.body.eventId === selected.id) {
        if (pending.orderId) {
          try { await resumeBooking(pending.orderId); }
          catch (error) {
            setDemoError(error.message);
            if (error.terminalOrderId) setStage('checkout');
            else setNotice(error.message);
          }
          return;
        }
        const event = restoredCheckoutEvent(pending);
        if (event) openEvent(event, { referralCode: pending.body.affiliateCode || null });
        activeCheckoutAttempt.current = pending;
        setOfferingId(pending.body.items[0].offeringId); setQuantity(pending.body.items[0].quantity); setCheckoutRecovering(true);
        setReferral(pending.body.affiliateCode ? { eventId: pending.body.eventId, code: pending.body.affiliateCode, referrerName: typeof pending.referrerName === 'string' ? pending.referrerName : 'Your host' } : null);
      }
      setStage("checkout");
    }
  }
  function retireCheckoutAttempt(attempt) {
    if (!attempt) return;
    clearCheckoutAttempt(attempt.buyerId, attempt.body.idempotencyKey);
    if (currentCheckoutBuyer.current !== attempt.buyerId) return;
    if (activeCheckoutAttempt.current?.body.idempotencyKey === attempt.body.idempotencyKey) activeCheckoutAttempt.current = null;
    setCheckoutRecovering(false);
    setPaymentCheckout(null);
  }
  async function resumeBooking(orderId) {
    if (checkoutLock.current || !session) return;
    checkoutLock.current = true; setDemoBusy(true); setDemoError('');
    const buyerId = session.user.id;
    try {
      const result = await resumePaymentCheckout({ orderId }, api, session.accessToken);
      if (currentCheckoutBuyer.current !== buyerId) return;
      const attempt = restorePaymentAttempt(buyerId, result);
      if (result.status === 'paid') { await openPurchasedPasses(result.orderId, attempt); setCheckoutRecovering(false); return; }
      openEvent({ ...result.booking.event, offerings: attempt.eventContext.offerings }, { referralCode: attempt.body.affiliateCode || null });
      activeCheckoutAttempt.current = attempt;
      setOfferingId(attempt.body.items[0].offeringId); setQuantity(attempt.body.items[0].quantity);
      setReferral(attempt.body.affiliateCode ? { eventId: attempt.body.eventId, code: attempt.body.affiliateCode, referrerName: attempt.referrerName || 'Your host' } : null);
      setStage('checkout'); setCheckoutRecovering(true); setPaymentCheckout(result);
    } catch (error) {
      if (error.terminalOrderId && currentCheckoutBuyer.current === buyerId) {
        const attempt = [activeCheckoutAttempt.current, readCheckoutAttempt(buyerId)].find(value => value?.orderId === error.terminalOrderId);
        retireCheckoutAttempt(attempt);
      }
      throw error;
    } finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function openPurchasedPasses(orderId, attempt, token = session.accessToken) {
    const ticket = await api(`/customer/purchases/${encodeURIComponent(orderId)}/tickets`, { token });
    if (currentCheckoutBuyer.current !== attempt.buyerId) return;
    setSelected(null); setWalletOpen(false); setView('booked'); setRundownId(null); setRundownPreview(null); setBookingRoute(`purchase:${orderId}`);
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
      openEvent(event, { referralCode: attempt.body.affiliateCode || null });
      activeCheckoutAttempt.current = resumed?.booking ? restorePaymentAttempt(attempt.buyerId, resumed) : resumed?.orderId ? rememberCheckoutOrder(attempt, resumed.orderId) : attempt;
      setOfferingId(attempt.body.items[0].offeringId); setQuantity(attempt.body.items[0].quantity); setStage('checkout'); setCheckoutRecovering(true);
      setReferral(attempt.body.affiliateCode ? { eventId: attempt.body.eventId, code: attempt.body.affiliateCode, referrerName: typeof attempt.referrerName === 'string' ? attempt.referrerName : 'Your host' } : null);
      if (resumed) setPaymentCheckout(resumed);
      setDemoError(resumed?.verificationStatus === 'review' ? 'Your payment needs review. Contact the event host before making another payment.' : resumed ? '' : 'Your previous attempt has no confirmed booking yet. Retry to check and complete the same booking.');
    })().catch((error) => { if (active) { if (error.terminalOrderId) retireCheckoutAttempt(attempt); setDemoError(`We couldn’t check your booking: ${error.message}`); setNotice(`We couldn’t check your booking: ${error.message}`); } })
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
    const mode = totals.total === 0 ? 'free' : paymentConfig?.enabled && ['test', 'live'].includes(paymentConfig.mode) ? 'stripe' : demoCheckoutEnabled ? 'demo' : 'disabled';
    if (mode === 'disabled' && !checkoutRecovering) throw new Error('Checkout is unavailable right now. Please try again later.');
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
        const rejected = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
        retireCheckoutAttempt(rejected);
        setDemoError(`Booking was not completed: ${error.message} Review your selection before trying again.`);
      } else setDemoError(`We couldn’t confirm the result. Check or retry this same booking: ${error.message}`);
    }
    finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function checkBookingPayment(afterConfirmation = false) {
    if (!paymentCheckout || !session) throw new Error('Sign in again to check your saved booking.');
    const buyerId = session.user.id;
    setDemoError('');
    try {
      const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
      const result = await (afterConfirmation ? verifyPaymentCheckout : checkPaymentCheckout)(paymentCheckout.orderId, api, session.accessToken);
      if (currentCheckoutBuyer.current !== buyerId) throw new Error('Your account changed. Sign in to recover this booking.');
      if (result.status === 'pending') return true;
      if (!attempt) throw new Error('Your payment is complete. Open Booked to see your passes.');
      await openPurchasedPasses(result.orderId, attempt);
      setCheckoutRecovering(false);
      return false;
    } catch (error) {
      if (currentCheckoutBuyer.current !== buyerId) throw error;
      if (error.paymentReview) setPaymentCheckout({ orderId: error.orderId, status: 'pending', verificationStatus: 'review' });
      if (error.terminalOrderId) {
        const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
        retireCheckoutAttempt(attempt);
        setStage('details');
      }
      if (error.paymentReview) setDemoError(error.message);
      if (error.terminalOrderId) setNotice(error.message);
      throw error;
    }
  }
  async function cancelPaymentBooking() {
    if (checkoutLock.current || !paymentCheckout) return;
    checkoutLock.current = true; setDemoBusy(true); setDemoError('');
    try {
      const result = await api(`/customer/payment-checkouts/${encodeURIComponent(paymentCheckout.orderId)}/cancel`, { token: session.accessToken, method: 'POST' });
      const attempt = activeCheckoutAttempt.current || readCheckoutAttempt(session.user.id);
      if (result.status === 'paid') { if (attempt) await openPurchasedPasses(result.orderId, attempt); }
      else if (result.status === 'cancelled') { retireCheckoutAttempt(attempt); setStage('details'); setBookingsRevision(value => value + 1); }
      else { setPaymentCheckout(current => ({ ...current, ...result })); setDemoError(result.verificationStatus === 'review' ? 'Your payment needs review. Contact the event host before making another payment. Your booking reference is saved.' : 'Your payment is still being checked. Your booking is saved; check again shortly.'); }
    } catch (error) { setDemoError(error.message); }
    finally { checkoutLock.current = false; setDemoBusy(false); }
  }
  async function requestGuestlist() {
    if (guestRequestLock.current || guestBusy || referralBusy || guestStatusLoading || !selected) return;
    if (!session) {
      setAuthOpen(true);
      return;
    }
    if (!guestRequestsOpen) return;
    if (!validGuestlistPartySize(guestPartySize, guestMaxPartySize)) { setGuestError(`Choose between 1 and ${guestMaxPartySize} guests.`); return; }
    guestRequestLock.current = true;
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
      guestRequestLock.current = false;
      setGuestBusy(false);
    }
  }
  async function openGuestlistEntry(entryId, token = session?.accessToken) {
    if (!entryId || !token) return;
    try {
      const ticket = await api(`/customer/guestlists/${encodeURIComponent(entryId)}/pass`, { token });
      setSelected(null); setWalletOpen(false); setView('booked'); setRundownId(null); setRundownPreview(null); setBookingRoute(`guestlist:${entryId}`); setNotificationBooking({ ticket });
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
      <a className="skip-link" href={`#${showingRundown ? 'rundown' : view === 'my-events' ? 'my-events' : view === 'connections' ? 'connections' : view === 'booked' ? 'booked' : view === 'saved' ? 'saved' : 'discover'}`}>
        Skip to events
      </a>
      <header className="site-header" data-operator-nav={hasMyEvents}>
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation" data-view={view} data-connections={hasConnections} data-my-events={hasMyEvents} style={{ '--tab-count': 3 + Number(hasConnections) + Number(hasMyEvents), '--tab-index': view === 'booked' ? 1 : view === 'saved' ? 2 : view === 'connections' ? 3 : view === 'my-events' ? 3 + Number(hasConnections) : 0 }}>
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
            {hasMyEvents && <button className={view === 'my-events' ? 'active' : ''} aria-current={view === 'my-events' ? 'page' : undefined} onClick={() => navigateView('my-events')}>My events</button>}
          </nav>
          <div className="header-actions">
            {session ? (
              <>
                <Notifications key={session.user.id} session={session} onNotification={openNotification} refreshKey={navigationRefreshKey} />
                <Messages key={`messages:${session.user.id}`} session={session} refreshKey={navigationRefreshKey} initialBooking={messageBooking} initialThreadId={messageThread} initialSupportThreadId={supportThread} onSupportOpened={() => setSupportThread(null)} supportContext={selected ? { eventId: selected.id, eventTitle: selected.title } : undefined} onOpened={() => { setMessageBooking(null); setMessageThread(null); }} />
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
      {view === 'my-events' && (session && myEventsAccess.eligible ? <Suspense fallback={<main className="booked-page wrap" id="my-events"><LoadingIndicator>Opening your events…</LoadingIndicator></main>}><MyEventsPage key={session.accessToken} session={session} access={myEventsAccess} route={myEventsRoute} onRouteChange={(next) => {
        rememberScroll();
        setMyEventsRoute(next);
        setSelected(null);
        setBookingRoute(null);
        updateCustomerRoute({ tab: 'my-events', ...next });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }} onUnauthorized={handleMyEventsUnauthorized} onSignIn={() => setAuthOpen(true)} onDiscover={() => navigateView('discover')} /></Suspense> : <MyEventsAccessState session={session} access={myEventsAccess} onSignIn={() => setAuthOpen(true)} onDiscover={() => navigateView('discover')} />)}
      {view === 'connections' && hasConnections && <ConnectionsPage key={session.user.id} session={session} history={connectionsHistory} saved={saved} onSave={save} onReferral={openConnection} onRefresh={refreshConnections} onVisible={savedCollection.checkVisible} />}
      {view === 'booked' && <main className="booked-page wrap" id="booked">
        <div className="booked-page-heading"><p className="eyebrow">YOUR NEXT NIGHT STARTS HERE</p><h1>Booked.</h1><p>Your tickets and guest list entries, all in one place.</p></div>
        {session ? <AccountDialog key={session.user.id} embedded open session={session} onContactOrganizer={setMessageBooking} onResumeCheckout={resumeBooking} bookingsRevision={bookingsRevision} notificationBooking={notificationBooking} bookingRoute={bookingRoute} onBookingRouteChange={(value) => { setBookingRoute(value); updateCustomerRoute({ tab: 'booked', booking: value }, { replace: !value }); }} onNotificationOpened={() => setNotificationBooking(null)} onOpenChange={() => navigateView('discover')} /> : <div className="account-empty"><Ticket /><h2>Your nights are waiting.</h2><p>Sign in to see your upcoming bookings and guest list entries.</p><Button className="dark-glass-action" onClick={() => setAuthOpen(true)}>Sign in</Button></div>}
      </main>}
      {view === 'saved' && <main className="booked-page wrap" id="saved">
        <div className="booked-page-heading"><p className="eyebrow">KEEP THE GOOD NIGHTS CLOSE</p><h1>Saved.</h1><p>Your shortlist of upcoming events.</p></div>
        {savedCollection.mergeError && <p className="account-error" role="alert">Your guest saves have not synced yet. <button type="button" onClick={savedCollection.retry}>Retry sync</button></p>}
        {savedCollection.loadState === 'error' && Boolean(savedCollection.items.length) && <p className="account-error" role="alert">Couldn’t refresh Saved. Showing previously loaded nights. <button type="button" onClick={savedCollection.retry}>Try again</button></p>}
        {savedCollection.loadState === 'loading' && !savedCollection.items.length ? <LoadingIndicator>Finding your saved nights…</LoadingIndicator> : savedCollection.loadState === 'error' && !savedCollection.items.length ? <div className="account-empty"><p>We couldn’t load your saved events.</p><Button onClick={savedCollection.retry}>Try again</Button></div> : savedUpcoming.length ? <div className="event-grid">{savedUpcoming.map((event) => <EventCard key={event.id} event={event} saved onSave={() => save(event)} onOpen={() => openEvent(event)} />)}</div> : <div className="account-empty"><h2>{savedCollection.hasMore ? 'No active nights on this page.' : 'No upcoming saved events yet.'}</h2><p>{savedCollection.hasMore ? 'More saved nights may appear on the next page.' : 'Tap the heart on an event to keep it here. Past events stay out of your shortlist.'}</p><Button className="dark-glass-action" onClick={() => navigateView('discover')}>Discover events</Button></div>}
        {savedCollection.hasMore && savedCollection.loadState !== 'error' && <Button className="load-more" variant="outline" disabled={savedCollection.loadState === 'loading'} onClick={savedCollection.loadMore}>More saved nights</Button>}
      </main>}
      {showingRundown && <RundownPage rundownId={rundownId} preview={rundownPreview} session={session} onSignIn={() => setAuthOpen(true)} onOpenEvent={openRundownEvent} />}
      <main hidden={view !== 'discover' || showingRundown} className={returnVisitor ? 'return-visitor-discovery' : ''}
        onPointerDownCapture={retainCityMenuForControl} onMouseDownCapture={retainCityMenuForControl}
        onClickCapture={dismissCityMenuForControl} onPointerCancelCapture={dismissCityMenuForControl}>
        <section className="hero wrap">
          <div className="hero-copy">
            <h1>Find your kind of night.</h1>
            <a className="text-link" href="#discover">
              Find your next night <ArrowDown />
            </a>
          </div>
        </section>
        <div className="wrap search-wrap">
          {currentCity.error && <p className="discovery-area-hint" role="status">We couldn’t find your city. Enter a city and state or region.</p>}
          <form
            className="search-bar"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const next = { date: String(form.get('date') || ''), city: String(form.get('discovery-place-query') || ''), query: String(form.get('query') || ''), shortcut: '', scope: submitted.scope, sort: submitted.sort };
              applyDiscovery(next);
            }}
          >
            <DiscoveryCitySearch value={city} onChange={(value) => { locationEdited.current = true; currentCity.cancel(); setCity(value); }}
              onLocate={currentCity.locate} locating={currentCity.locating}
              holdMenuOnBlur={holdCityMenuOnBlur} dismissRevision={cityMenuDismissal}
              describedBy={city !== submitted.city ? 'discovery-area-hint' : undefined} placeholder={locationState === 'finding' ? 'Finding your city…' : 'City, state or region'}/>
            <DiscoveryDateSearch value={date} onChange={setDate}/>
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
          <DiscoveryControls city={submitted.city} scope={submitted.scope} disabled={!qualifiedDiscoveryCity(submitted.city)} onChange={changeDiscoveryControls}/>
          {city !== submitted.city && <p id="discovery-area-hint" className="discovery-area-hint">Apply your selection to update results.</p>}
          {(submitted.date || submitted.query) && <div className="active-discovery-filters" aria-label="Active filters">
            {submitted.date && <button onClick={() => { setDate(''); applyDiscovery({ ...submitted, date: '' }); }}>Date: {calendarLabel(submitted.date)} <X size={13} /></button>}
            {submitted.query && <button onClick={() => { setQuery(''); applyDiscovery({ ...submitted, query: '' }); }}>Search: {submitted.query} <X size={13} /></button>}
          </div>}
          <div className="search-caption">
            <span>Book on the web. Be there in real life.</span>
          </div>
        </div>
        <DiscoveryResults submitted={submitted} area={discoveryArea} distanceOrigin={distanceOrigin} resolutionStatus={resolutionStatus} hasUpcomingAreaEvents={hasUpcomingAreaEvents} results={results} loadState={loadState} nextCursor={nextCursor} moreState={moreState} loadEvents={loadEvents} loadMore={loadMore} saved={saved} save={save} openEvent={openEvent} weekRange={weekRange} weeklyEvents={weeklyEvents} previewState={previewState} previewCursor={previewCursor} visible={view === 'discover' && !showingRundown} onFiltersChange={changeDiscoveryControls}/>
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
        <Brand />
        <a className="business-nav-link footer-business" href={businessLink(import.meta.env.VITE_BUSINESS_URL, window.location)}>
          For business <ArrowUpRight size={16} aria-hidden="true" />
        </a>
        <p className="copyright">© {new Date().getFullYear()} Nitewide</p>
        <nav className="footer-secondary-links" aria-label="Support and legal">
          <ContactNitewide session={session} />
          <TermsLink />
        </nav>
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
              <ManualCopyLink link={manualLink}/>
              {session && <EventConnectionPicker key={`${session.user.id}:${selected.id}`} session={session} eventId={selected.id} referral={referral} busy={referralBusy} onSelect={chooseEventConnection} />}
              {referralError && <p className="error-message" role="alert">{referralError}</p>}
              <Tabs defaultValue="tickets">
                <TabsList className="booking-tabs">
                  <TabsTrigger value="tickets">Tickets & tables</TabsTrigger>
                  <TabsTrigger value="guestlist">Guestlist</TabsTrigger>
                </TabsList>
                <TabsContent value="tickets">
                  <div className="offerings">
                    {selected.offerings?.map((item) => {
                      const itemQuantity = offeringId === item.id ? quantity : item.minPerOrder || 1;
                      const itemPrice = offeringPrice(item, itemQuantity);
                      const availabilityLabel = offeringAvailabilityLabel(item, selected.offerings, itemQuantity);
                      return <button
                        disabled={!availableQuantity(item) || !itemPrice.eligible}
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
                          <span className="upfront-total">{itemPrice.eligible ? priceLabel(itemPrice.total, item.currency) : 'Pricing unavailable'}{itemPrice.eligible && itemPrice.total > 0 && <> <small>total{itemQuantity > 1 ? ` for ${itemQuantity}` : ''}</small></>}</span>
                          {availabilityLabel && (itemPrice.eligible || availabilityLabel !== 'Pricing unavailable') && <small className={availableQuantity(item) > 0 && itemPrice.eligible ? 'fee-caption' : undefined}>{availabilityLabel}</small>}
                        </strong>
                      </button>;
                    })}
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
                        disabled={demoBusy || referralBusy || !availableQuantity(offering) || !totals.eligible}
                      >
                        {totals.eligible ? totals.total === 0 ? 'Claim free admission' : `Continue · ${money(totals.total, offering.currency)}` : 'Pricing unavailable'}
                        <ArrowRight />
                      </Button>
                      {!totals.eligible && <p role="alert" className="fine-print">This combination is not available at our current pricing. Try another offering or quantity.</p>}
                    </>
                  )}
                  <p className="demo-note">
                    {totals.total === 0 ? 'Free admission · No payment required.' : paymentConfig?.enabled && paymentConfig.mode === 'live' ? 'Secure checkout with Stripe.' : paymentConfig?.enabled && paymentConfig.mode === 'test' ? 'Secure sandbox checkout · Test payments only.' : demoCheckoutEnabled ? 'Demo checkout · No payment will be collected.' : paymentConfig ? 'Checkout is unavailable right now. Please try again later.' : 'Checking checkout availability…'}
                  </p>
                </TabsContent>
                <TabsContent value="guestlist">
                  <div className="guestlist-panel">
                    <Users />
                    <h3>{guestState === 'pending' ? 'Awaiting host approval.' : guestState === 'confirmed' || guestState === 'checked_in' ? 'You’re on the guestlist.' : guestState === 'rejected' ? 'Request declined.' : 'Get on the guestlist.'}</h3>
                    <p>{guestState === 'pending' ? 'Your request is pending. Entry is confirmed only after the host approves it.' : guestState === 'confirmed' ? 'Your entry is approved. Open your pass in Booked.' : guestState === 'checked_in' ? 'Your party has checked in.' : guestState === 'rejected' ? 'The host declined this request. Your Booked history keeps the result.' : 'Choose 1–5 guests, including yourself. The host reviews your request before entry is confirmed.'}</p>
                    {guestError && (
                      <p className="error-message" role="alert">
                        {guestError}
                      </p>
                    )}
                    {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
                    {guestStatusLoading && <LoadingIndicator>Checking your request…</LoadingIndicator>}
                    {guestEntry && <p className="guestlist-entry-summary">{guestEntry.partySize} {guestEntry.partySize === 1 ? 'guest' : 'guests'} · {guestState === 'pending' ? 'Pending' : guestState === 'confirmed' ? 'Approved' : guestState === 'rejected' ? 'Declined' : guestState === 'checked_in' ? 'Checked in' : guestState.replace('_', ' ')}</p>}
                    {(!guestEntry || guestState === 'pending') && <form className="guestlist-party-form" onSubmit={guestEntry ? changeGuestPartySize : (event) => { event.preventDefault(); requestGuestlist(); }}>
                      <GuestlistQuantity id="guest-party-size" label="Party size, including you" value={guestPartySize} max={session ? guestMaxPartySize : customerGuestlistMaxPartySize} disabled={guestBusy || referralBusy || guestStatusLoading} onChange={setGuestPartySize} describedBy={guestPartySize > guestMaxPartySize ? 'guest-party-size-help' : undefined} />
                      {guestPartySize > guestMaxPartySize && <p id="guest-party-size-help" className="guestlist-quantity-help">Your existing request is for {guestEntry?.partySize || guestPartySize} guests. Reduce the party size to {guestMaxPartySize} or fewer to update it.</p>}
                      <Button type="submit" disabled={guestBusy || referralBusy || guestStatusLoading || !validGuestlistPartySize(guestPartySize, session ? guestMaxPartySize : customerGuestlistMaxPartySize) || (!guestEntry && session && !guestRequestsOpen) || (guestEntry && guestPartySize === guestEntry.partySize)}>{guestBusy ? 'Updating…' : guestEntry ? 'Update party size' : session ? guestRequestsOpen ? 'Request guestlist approval' : 'Guestlist requests closed' : 'Sign in to request'}</Button>
                    </form>}
                    {guestState === 'pending' && <Button variant="ghost" disabled={guestBusy} onClick={withdrawGuestRequest}>Withdraw request</Button>}
                    {guestEntry && <Button variant="outline" onClick={() => openGuestlistEntry(guestEntry.id)}>View entry in Booked</Button>}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
          {selected && stage === "checkout" && offering && (
            <div className="checkout-review">
              <Badge variant="outline">{totals.total === 0 ? 'FREE BOOKING' : paymentConfig?.enabled && paymentConfig.mode === 'test' ? 'SANDBOX CHECKOUT' : paymentConfig?.enabled && paymentConfig.mode === 'live' ? 'SECURE CHECKOUT' : demoCheckoutEnabled ? 'DEMO CHECKOUT' : 'CHECKOUT'}</Badge>
              <p>
                {totals.total === 0 ? 'Confirm your free admission. No card details are required.' : paymentConfig?.enabled && paymentConfig.mode === 'live' ? 'Pay securely with Stripe. Review your total before confirming your payment.' : paymentConfig?.enabled && paymentConfig.mode === 'test' ? 'Pay securely with Stripe in test mode. Use test payment details only; no real charge will be made.' : demoCheckoutEnabled ? 'This creates a demo order and admission in local test data. No card details or charge; not valid for entry.' : paymentConfig ? 'Checkout is unavailable right now. Please try again later.' : 'Checking checkout availability…'}
              </p>
              <div className="order-summary">
                <h3>{paymentCheckout?.booking?.items.length > 1 ? 'Your booking' : offering.name}</h3>
                <p>
                  {paymentCheckout?.booking ? paymentCheckout.booking.items.map(item => `${item.quantity} × ${item.name} · ${priceLabel(item.unitPriceCents, paymentCheckout.booking.currency)}`).join(' / ') : <>{quantity} × {priceLabel(offering.priceCents, offering.currency)}</>}
                </p>
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{priceLabel(totals.subtotal, offering.currency)}</dd>
                  </div>
                  {totals.fee > 0 && <div>
                    <dt>
                      Service fee
                    </dt>
                    <dd>{money(totals.fee, offering.currency)}</dd>
                  </div>}
                  <div className="order-total">
                    <dt>{totals.total === 0 ? 'Total' : 'Total paid in full'}</dt>
                    <dd>{priceLabel(totals.total, offering.currency)}{feeLabel(totals, offering.currency) && <small className="fee-caption">{feeLabel(totals, offering.currency)}</small>}</dd>
                  </div>
                </dl>
              </div>
              <p className="fine-print">
                Booking as {session?.user.email}.
              </p>
              {totals.floorAdjusted && <p className="fine-print">A minimum-cost adjustment is included in the service fee to cover this order. Processing is included; no additional processing charge applies.</p>}
              {demoError && <p role="alert">{demoError}</p>}
              {paymentCheckout?.verificationStatus === 'review' && <p role="status" className="fine-print">Your payment needs review. Contact the event host for help before making another payment. Booking reference: {paymentCheckout.orderId}</p>}
              {referralCodeForEvent(referral, selected.id) && <p className="connection-context">Booking with <strong>{referral.referrerName}</strong></p>}
              {paymentCheckout?.clientSecret && paymentCheckout.verificationStatus !== 'review' && paymentConfig?.enabled && <Suspense fallback={<LoadingIndicator>Loading secure payment form…</LoadingIndicator>}><StripeCheckout key={paymentCheckout.orderId} config={paymentConfig} checkout={paymentCheckout} amount={money(totals.total, offering.currency)} onCheck={() => checkBookingPayment()} onVerify={() => checkBookingPayment(true)} onBusyChange={busy => { checkoutLock.current = busy; setDemoBusy(busy); }} /></Suspense>}
              {paymentCheckout ? <>{!paymentCheckout.clientSecret && paymentCheckout.verificationStatus !== 'review' && <Button className="primary-action dark-glass-action" disabled={demoBusy} onClick={completeDemo}>{demoBusy ? <LoadingIndicator>Checking your booking…</LoadingIndicator> : `Pay ${money(totals.total, offering.currency)}`}</Button>}{paymentCheckout.verificationStatus !== 'review' && <Button variant="outline" disabled={demoBusy} onClick={cancelPaymentBooking}>Cancel payment attempt</Button>}<p className="fine-print">You can close this window and continue your purchase from Notifications.{paymentCheckout.verificationStatus !== 'review' && ' Cancellation is final only after the server confirms payment was not completed.'}</p></> : <Button className="primary-action dark-glass-action" onClick={completeDemo} disabled={demoBusy || (!checkoutRecovering && (!totals.eligible || (totals.total > 0 && !paymentConfig?.enabled && !demoCheckoutEnabled)))}>
                {demoBusy ? <LoadingIndicator>{checkoutRecovering ? 'Checking your booking…' : 'Preparing your booking…'}</LoadingIndicator> : <>{checkoutRecovering ? 'Check / retry booking' : totals.total === 0 ? 'Claim admission' : paymentConfig?.enabled ? 'Continue to payment' : demoCheckoutEnabled ? 'Confirm demo booking' : 'Continue to payment'} <ArrowRight /></>}
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
