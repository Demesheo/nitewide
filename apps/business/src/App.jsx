import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Command,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Choice } from "@/components/controls";
import { EventEditor } from "@/components/EventEditor";
import { PagedEvents } from '@/components/PagedEvents';
import { BusinessOverview } from '@/components/BusinessOverview';
import { BusinessAnalytics } from "@/components/BusinessAnalytics";
import { MultiSelect } from "@/components/MultiSelect";
import { Notifications } from "@/components/Notifications";
import { TeamInviteLanding } from "@/components/Team";
import { BusinessTeam } from "@/components/BusinessTeam";
import { OnboardingSetup } from "@/components/OnboardingSetup";
import { BusinessProfile } from "@/components/BusinessProfile";
import { BusinessSignIn } from "@/components/BusinessSignIn";
import { LoadingState } from "@/components/LoadingState";
import { Admissions } from "@/components/Admissions";
import { api, readSession, SESSION_KEY } from "@/lib/api";
import { workspaceAccess } from "@/lib/workspace-access";
import { writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { reusableDraft } from '@/lib/event-reuse';
import { useWorkspaceNavigation } from '@/hooks/useWorkspaceNavigation';
import { useBusinessBootstrap } from '@/hooks/useBusinessBootstrap';
import { downloadBusinessReport, reportQuery, browserReportTimezone } from '@/lib/report-client';
import { PreparedExports } from '@/components/PreparedExports';

const navigation = [
  ["overview", LayoutDashboard, "Overview"],
  ["analytics", BarChart3, "Analytics"],
  ["events", CalendarDays, "Events"],
  ["admissions", QrCode, "Admissions"],
  ["team", Users, "Organization"],
];
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Command size={21} />
      </span>
      <span>
        nitewide<span className="brand-sub">BUSINESS</span>
      </span>
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState(readSession);
  const [onboardingToken, setOnboardingToken] = useState(() => new URLSearchParams(window.location.search).get('onboarding'));
  const [onboardingSignIn, setOnboardingSignIn] = useState(false);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const { page, setPage, selectedOrganizations, setSelectedOrganizations, selectedVenues, setSelectedVenues,
    days, eventToOpen, guestlistEntryToOpen, eventTabToOpen, eventNavigationRevision,
    navigate: navigateRoute, chooseOrganizations, chooseVenues, chooseDays, selectEvent } = useWorkspaceNavigation();
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const verificationAttempted = useRef(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuTrigger = useRef(null);
  useEffect(() => {
    const screen = window.matchMedia("(min-width: 851px)");
    const closeOnDesktop = () => { if (screen.matches) setMobileNav(false); };
    screen.addEventListener("change", closeOnDesktop);
    return () => screen.removeEventListener("change", closeOnDesktop);
  }, []);
  const signOut = useCallback(async (expired = false, everywhere = false, accessNotice = '') => {
    if (!expired && session?.accessToken) {
      try { await api(everywhere ? '/auth/sessions/revoke-all' : '/auth/logout', session, { method: 'POST' }); }
      catch (error) { if (error.status !== 401) { setNotice(error.message); return error.message; } }
    }
    if (!onboardingToken && !inviteToken) window.history.replaceState(null, '', '/sign-in');
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setEditor(null);
    setMobileNav(false);
    setProfileOpen(false);
    setSelectedOrganizations([]);
    setSelectedVenues([]);
    setNotice("");
    setPage("overview");
    setLoginNotice(
      accessNotice || (expired ? "Your session has expired. Please sign in again." : ""),
    );
  }, [onboardingToken, inviteToken, session]);
  const expire = useCallback(() => signOut(true), [signOut]);
  const requireBusinessAccess = useCallback(() => signOut(true, false, 'Your Nitewide account does not have active Business access. Request access below, or accept your invitation to complete onboarding.'), [signOut]);
  const { data, loading, error, revision, setRevision } = useBusinessBootstrap(session, onboardingToken || inviteToken, expire, requireBusinessAccess);
  useEffect(() => {
    if (!session || onboardingToken || inviteToken) return;
    const accessChanged = (event) => { if (event.detail?.accessToken === session.accessToken) requireBusinessAccess(); };
    window.addEventListener('nitewide:business-access-required', accessChanged);
    return () => window.removeEventListener('nitewide:business-access-required', accessChanged);
  }, [session, onboardingToken, inviteToken, requireBusinessAccess]);
  const refreshAdmissions = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!session) return;
    window.addEventListener('focus', refreshAdmissions);
    return () => window.removeEventListener('focus', refreshAdmissions);
  }, [session, refreshAdmissions]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('verifyEmail');
    if (!token || verificationAttempted.current) return;
    verificationAttempted.current = true;
    api('/auth/email/verify', null, { method: 'POST', body: JSON.stringify({ token }) })
      .then(async () => {
        setLoginNotice('Email verified. You can sign in now.');
        setNotice('Email verified.');
        if (session) {
          try {
            const identity = await api('/auth/me', session);
            const updated = { ...session, user: { ...session.user, ...identity.user }, roles: identity.roles };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated)); setSession(updated);
          } catch { /* Verification succeeded even if the existing session expired. */ }
        }
      })
      .catch((error) => { setLoginNotice(error.message); setNotice(error.message); })
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('verifyEmail');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
      });
  }, []);
  useEffect(() => {
    if (!session) return;
    const remaining = new Date(session.expiresAt) - new Date();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [session, expire]);
  function login(value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    setSession(value);
    setOnboardingSignIn(false);
    setLoginNotice("");
    if (!onboardingToken && !inviteToken && window.location.pathname === '/sign-in') writeWorkspaceLocation({}, { replace: true });
  }
  function navigate(value, eventId = null, entryId = null, eventTab = null) {
    navigateRoute(value, eventId, entryId, eventTab); setMobileNav(false);
  }
  if (onboardingToken && onboardingSignIn) return <BusinessSignIn invitationOnly onSession={login} notice={loginNotice || 'Sign in with the email address on your invitation. You will return to the invitation to accept access.'} />;
  if (onboardingToken) return <><OnboardingSetup token={onboardingToken} session={session} onSignIn={() => setOnboardingSignIn(true)} onSwitchAccount={async (signIn) => { if (!await signOut()) setOnboardingSignIn(signIn); }} onContinue={() => { setOnboardingToken(null); writeWorkspaceLocation({ onboarding: null }, { replace: true }); setRevision((value) => value + 1); }} />{notice && <p role="alert">{notice}</p>}</>;
  if (inviteToken) return <TeamInviteLanding token={inviteToken} session={session} onSession={login} onAccepted={(updated, accepted) => { login(updated); setInviteToken(null); writeWorkspaceLocation({ invite: null }, { replace: true }); setNotice('Invitation accepted. Your access is ready.'); navigate(accepted?.eventId ? 'events' : 'team', accepted?.eventId || null); setRevision((value) => value + 1); }} />;
  if (!session || new URLSearchParams(window.location.search).has('resetPassword')) return <BusinessSignIn onSession={login} notice={loginNotice} />;
  if (!data) return <main className="business-access-gate"><Brand /><section className="business-access-gate-card" aria-label="Business access check">
    {error ? <><h1>We couldn’t open your workspace.</h1><p className="error" role="alert">{error}</p><div className="business-access-gate-actions"><Button onClick={() => setRevision((value) => value + 1)}>Try again</Button><Button variant="outline" onClick={() => signOut(true, false, 'Sign in to try opening your Business workspace again.')}>Return to sign in</Button></div></>
      : <><h1>Checking your Business access.</h1><LoadingState>Opening your workspace…</LoadingState></>}
  </section></main>;
  const title =
    page === "overview"
      ? "A clearer view of your business."
      : page === "analytics"
        ? "Know what moves your business."
      : page === "events"
        ? "Set the stage for something great."
      : page === "team"
        ? "Your organization, together."
      : page === "admissions"
        ? "A smooth start to their night."
        : "The right people. A great night.";
  const hasIndependentWorkspace = Boolean(data?.scope?.canCreateIndependent);
  const activeOrg = selectedOrganizations.length === 1 ? data?.organizations.find((o) => o.id === selectedOrganizations[0]) : data?.organizations.length === 1 && !hasIndependentWorkspace ? data.organizations[0] : null;
  const showVenueSelector = (data?.venues?.length || 0) > 1;
  const showOrganizationSelector = (data?.organizations.length || 0) + Number(hasIndependentWorkspace) > 1;
  const { canManage, ownOnly } = workspaceAccess(data, session.user);
  const canManageTeam = data
    ? Boolean(session.user.isInternalAdmin || data.organizations?.some((org) => org.canManage || org.canCreateEvents))
    : Boolean(session.user.isInternalAdmin || session.roles?.some((role) => ['organization_owner', 'venue_manager'].includes(role)));
  const visibleNavigation = navigation.filter(([id]) => id !== 'team' || canManageTeam);
  const visiblePage = page === 'team' && !canManageTeam ? 'overview' : page;
  const sidebarContent = <>
        <Brand />
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>{activeOrg?.name || (selectedOrganizations.length === 1 && selectedOrganizations[0] === 'independent' ? 'Independent events' : 'Your business')}</strong>
            <small>
              {ownOnly ? 'Your venue activity' : activeOrg
                ? `${activeOrg.planTier === "premium" ? "Premium" : "Free"} workspace`
                : "All your experiences"}
            </small>
          </div>
        </div>
        <span className="nav-label">{ownOnly ? 'YOUR WORKSPACE' : 'MANAGE'}</span>
        <nav aria-label="Main navigation">
          {visibleNavigation.map(([id, Icon, label]) => (
            <button
              key={id}
              className={visiblePage === id ? "active" : ""}
              aria-current={visiblePage === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {ownOnly && id === 'analytics' ? 'My analytics' : ownOnly && id === 'events' ? 'My events' : label}
              {visiblePage === id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-symbol">✦</span>
          <h3>Built for your next chapter.</h3>
          <p>From a single night to a city of experiences.</p>
        </div>
        <div className="profile">
          <span className="avatar">
            {session.user.displayName
              .split(" ")
              .map((v) => v[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div>
            <strong>{session.user.displayName}</strong>
            <small>Nitewide account</small>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Sign out"
            onClick={() => signOut()}
          >
            <LogOut size={17} />
          </Button>
        </div>
  </>;
  return (
    <div className="app-shell">
      <aside className="sidebar desktop-sidebar">{sidebarContent}</aside>
      <Dialog open={mobileNav} onOpenChange={setMobileNav}>
        <DialogContent className="business-nav-drawer" onCloseAutoFocus={(event) => { event.preventDefault(); menuTrigger.current?.focus(); }}>
          <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
          <DialogDescription className="sr-only">Your authorized workspace, pages, and account.</DialogDescription>
          <div className="sidebar mobile-nav-content">{sidebarContent}</div>
        </DialogContent>
      </Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="business-profile-dialog">
          <DialogTitle className="sr-only">Your profile</DialogTitle>
          <DialogDescription className="sr-only">View and edit your Nitewide account details.</DialogDescription>
          <BusinessProfile session={session} capabilities={data?.capabilities} onLogout={(everywhere) => signOut(false, everywhere)} onUpdated={(user) => { const updated = { ...session, user: { ...session.user, ...user } }; sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated)); setSession(updated); }} />
        </DialogContent>
      </Dialog>
      <nav className="mobile-bottom-nav" aria-label="Business navigation">
        {visibleNavigation.map(([id, Icon, label]) => <button type="button" key={id} aria-current={visiblePage === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20} aria-hidden="true"/><span>{label}</span></button>)}
      </nav>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              className="mobile-menu"
              ref={menuTrigger}
              aria-haspopup="dialog"
              aria-expanded={mobileNav}
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </Button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{visibleNavigation.find(([id]) => id === visiblePage)?.[2] || 'Overview'}</strong>
          </div>
          <div className="topbar-right">
            <Notifications session={session} onNavigate={navigate} capabilities={data?.capabilities} />
            <span className="live-label">
              <span />
              Connected workspace
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Your profile"
              aria-expanded={profileOpen}
              aria-haspopup="dialog"
              onClick={() => setProfileOpen(true)}
            >
              <CircleUserRound size={20} />
            </Button>
          </div>
        </header>
        <main className="main-content">
          {<div className="page-heading">
            <div>
              <span className="eyebrow">
                {visiblePage === "overview"
                  ? ownOnly ? 'YOUR REFERRALS, IN FOCUS' : `YOUR BUSINESS, IN FOCUS`
                  : page === "analytics"
                    ? "SALES INTELLIGENCE"
                  : "NITEWIDE BUSINESS"}
              </span>
              <h1>{ownOnly && visiblePage === 'overview' ? 'Your performance, clearly.' : ownOnly && visiblePage === 'analytics' ? 'Know your impact.' : title}</h1>
              <p>
                {visiblePage === "overview"
                  ? ownOnly ? `Welcome back, ${session.user.displayName.split(" ")[0]}. These are your credited referrals and guestlists.` : `Welcome back, ${session.user.displayName.split(" ")[0]}. Here’s where things stand.`
                  : page === "analytics"
                    ? ownOnly ? 'See only your referred sales, customers, and events.' : "Explore sales, events, team referrals, and the customers behind your authorized orders."
                  : page === "events"
                    ? ownOnly ? 'Your events and the people you brought in.' : "Create, refine, and bring your experiences to life."
                    : page === "team"
                      ? "Invite employees and promoters into your authorized organizations."
                    : page === "admissions"
                      ? "Scan passes or admit guests manually for your events."
                    : "Review requests and keep every guestlist in balance."}
              </p>
            </div>
            {canManage && (visiblePage === "overview" || visiblePage === "events") && (
              <Button onClick={() => setEditor({})}>
                <Plus />
                Create event
              </Button>
            )}
          </div>}
          {visiblePage !== "analytics" && visiblePage !== "team" && visiblePage !== "admissions" && <div className="page-controls">
            {showOrganizationSelector && <MultiSelect
              label="Organizations"
              selected={selectedOrganizations}
              onChange={chooseOrganizations}
              options={[
                ...(hasIndependentWorkspace ? [{ id: 'independent', label: 'Independent events' }] : []),
                ...(data?.organizations || []).map((o) => ({ id: o.id, label: o.name })),
              ]}
            />}
            {showVenueSelector && <MultiSelect label="Venues" options={data.venues} selected={selectedVenues} onChange={chooseVenues} />}
            {page !== "events" && <div>
              <Choice
                label="Sales period"
                value={days}
                onChange={chooseDays}
                options={[
                  ["7", "Last 7 days"],
                  ["30", "Last 30 days"],
                  ["90", "Last 90 days"],
                  ["365", "Last 365 days"],
                ]}
              />
              <Button variant="outline" disabled={!data || loading || exporting} onClick={async () => {
                setExporting(true);
                try { await downloadBusinessReport(session, reportQuery({ days, organizationIds: selectedOrganizations, venueIds: selectedVenues, timezone: browserReportTimezone() })); }
                catch (err) { setNotice(err.message); }
                finally { setExporting(false); }
              }}><ArrowDownToLine/>{exporting ? 'Preparing…' : 'Export report'}</Button>
            </div>}
          </div>}
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              {notice}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X />
              </Button>
            </div>
          )}
          <PreparedExports session={session}/>
          {error && (
            <div className="error" role="alert">
              {error}
              <Button
                variant="outline"
                onClick={() => setRevision((r) => r + 1)}
              >
                Try again
              </Button>
            </div>
          )}
          {loading && <LoadingState className="workspace-loading">{data ? 'Updating your workspace…' : 'Opening your workspace…'}</LoadingState>}
          {(data || visiblePage === 'admissions') && (
            <div
              className={loading ? "content-updating" : ""}
              aria-busy={loading}
            >
              {data?.scope === "mixed" && visiblePage !== 'admissions' && (
                <p className="scope-note">
                  <ShieldCheck size={16} />
                  Sales include managed events and your own referrals only.
                  Organization event editing requires owner or manager access.
                </p>
              )}
              {visiblePage === "overview" && data && <BusinessOverview session={session} days={days} organizationIds={selectedOrganizations} venueIds={selectedVenues} ownOnly={ownOnly} revision={revision} onNavigate={navigate} onUnauthorized={expire}/>}
              {visiblePage === "analytics" && data && <BusinessAnalytics session={session} ownOnly={ownOnly}
                organizations={data.organizations} venues={data.venues} canCreateIndependent={data.scope.canCreateIndependent}
                onEvent={(id) => navigate('events', id)} onUnauthorized={expire}/>}
              {visiblePage === "admissions" && <Admissions session={session} onAdmitted={refreshAdmissions} onUnauthorized={expire} onOpenEvent={(id) => navigate('events', id)}/>}
              {visiblePage === "events" && data && (
                <PagedEvents
                  key={eventNavigationRevision}
                  session={session}
                  ownOnly={ownOnly}
                  initialEventId={eventToOpen}
                  initialTab={eventTabToOpen}
                  initialGuestlistEntryId={guestlistEntryToOpen}
                  onUnauthorized={expire}
                  onEdit={(event, initialStep = 0) => setEditor({ event, initialStep })}
                  onDuplicate={(source, choices) => setEditor({ duplicateSource: source, copyChoices: choices,
                    presetDraft: reusableDraft(source, choices, data.organizations, data.venues) })}
                  onCreate={() => setEditor({})}
                  organizationIds={selectedOrganizations}
                  venueIds={selectedVenues}
                  revision={revision}
                  capabilities={data.capabilities}
                  onSelectionChange={selectEvent}
                />
              )}
              {visiblePage === "team" && data && canManageTeam && <BusinessTeam session={session} organizations={data.organizations.filter((org) => org.canManage || org.canCreateEvents)} onUnauthorized={expire} />}
            </div>
          )}
          <footer className="app-footer">
            <span>Nitewide Business</span>
            <span>Made for the people who make it happen.</span>
          </footer>
        </main>
      </div>
      {editor && data && (
        <EventEditor
          key={editor.event?.id || editor.duplicateSource?.id || "new"}
          event={editor.event || null}
          duplicateSource={editor.duplicateSource || null}
          copyChoices={editor.copyChoices || null}
          presetDraft={editor.presetDraft || null}
          initialStep={editor.initialStep ?? 0}
          organizations={data.organizations}
          venues={data.venues}
          canCreateIndependent={data.scope.canCreateIndependent}
          defaultOrganization={
            selectedOrganizations.length === 1 && selectedOrganizations[0] === "independent"
              ? null
              : activeOrg?.canManage
                ? activeOrg.id
                : data.organizations.find((o) => o.canManage || o.canCreateEvents)?.id || null
          }
          session={session}
          onClose={() => setEditor(null)}
          onReloadLatest={() => { setEditor(null); setRevision((value) => value + 1); setNotice('The latest event is loading. Your unsaved edits are kept in this tab.'); }}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            setSelectedOrganizations([]);
            setSelectedVenues([]);
            setRevision((r) => r + 1);
            setPage("events");
            writeWorkspaceLocation({ section: 'events', event: null, entry: null, tab: null });
          }}
        />
      )}
    </div>
  );
}
