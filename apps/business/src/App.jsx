import { useCallback, useEffect, useRef, useState } from "react";
import { TermsLink } from '../../shared/terms-and-conditions.jsx';
import {
  BarChart3,
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  CreditCard,
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
import { BusinessSetupProgress } from '@/components/BusinessSetupProgress';
import { BusinessAnalytics } from "@/components/BusinessAnalytics";
import { MultiSelect } from "@/components/MultiSelect";
import { Notifications } from "@/components/Notifications";
import { Messages, ContactNitewide } from '@/components/Messages';
import { TeamInviteLanding } from "@/components/Team";
import { BusinessTeam } from "@/components/BusinessTeam";
import { BusinessPayments } from "@/components/BusinessPayments";
import { OnboardingSetup } from "@/components/OnboardingSetup";
import { BusinessProfile } from "@/components/BusinessProfile";
import { BusinessSignIn } from "@/components/BusinessSignIn";
import { OrganizationRequestDialog } from '@/components/OrganizationRequestDialog';
import { BusinessBrand as Brand } from "@/components/BusinessBrand";
import { LoadingState } from "@/components/LoadingState";
import { Admissions } from "@/components/Admissions";
import { api, readSession, SESSION_KEY } from "@/lib/api";
import { workspaceAccess } from "@/lib/workspace-access";
import { writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { reusableDraft } from '@/lib/event-reuse';
import { useWorkspaceNavigation } from '@/hooks/useWorkspaceNavigation';
import { useBusinessBootstrap } from '@/hooks/useBusinessBootstrap';
import { useOrganizationScope } from '@/hooks/useOrganizationScope';
import { OWNED_ORGANIZATIONS, allowsOwnedOrganizations } from '@/lib/organization-scope';
import { downloadBusinessReport, reportQuery, browserReportTimezone } from '@/lib/report-client';
import { PreparedExports } from '@/components/PreparedExports';

const navigation = [
  ["overview", LayoutDashboard, "Overview"],
  ["analytics", BarChart3, "Analytics"],
  ["events", CalendarDays, "Events"],
  ["admissions", QrCode, "Admissions"],
  ["payments", CreditCard, "Payments"],
  ["team", Users, "Organization"],
];
export default function App() {
  const [session, setSession] = useState(readSession);
  const [onboardingToken, setOnboardingToken] = useState(() => new URLSearchParams(window.location.search).get('onboarding'));
  const [onboardingSignIn, setOnboardingSignIn] = useState(false);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const { page, setPage, selectedVenues, setSelectedVenues,
    days, eventToOpen, guestlistEntryToOpen, eventTabToOpen, eventNavigationRevision,
    navigate: navigateRoute, chooseVenues, chooseDays, selectEvent } = useWorkspaceNavigation();
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const verificationAttempted = useRef(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [organizationRequestOpen, setOrganizationRequestOpen] = useState(false);
  const [messageThread, setMessageThread] = useState(null);
  const [supportThread, setSupportThread] = useState(null);
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
    setSupportThread(null);
    setEditor(null);
    setMobileNav(false);
    setProfileOpen(false);
    setOrganizationRequestOpen(false);
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
  const invitationWorkspace = useRef(null);
  useEffect(() => {
    const destination = invitationWorkspace.current;
    if (!destination || !data?.organizations.some(org => org.id === destination.organizationId)) return;
    invitationWorkspace.current = null;
    navigateRoute(destination.section, destination.eventId, null, null, { workspaceOrganization: destination.organizationId });
  }, [data, navigateRoute]);
  const organizationScope = useOrganizationScope(data, session?.user?.id, page);
  const selectedOrganizations = organizationScope.organizationIds;
  const previousPage = useRef(page);
  useEffect(() => {
    // Venue/payment changes have their own workspaces. Re-read saved milestones
    // on return, including browser Back, rather than showing the old bootstrap.
    if (page === 'overview' && previousPage.current !== 'overview') setRevision(value => value + 1);
    previousPage.current = page;
  }, [page, setRevision]);
  useEffect(() => {
    if (data && page === 'payments' && !data.organizations?.some(org => org.canManageFinance) && !data.scope?.canViewEarnings) navigateRoute('overview');
  }, [data, page, navigateRoute]);
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
  function navigate(value, eventId = null, entryId = null, eventTab = null, destination = {}) {
    const hint = destination.workspaceOrganization || destination.paymentOrganization || destination.teamOrganizationId || destination.organizationIds?.[0];
    const { paymentOrganization, teamOrganizationId, organizationIds, ...rest } = destination;
    navigateRoute(value, eventId, entryId, eventTab, { ...rest, workspaceOrganization: organizationScope.forSection(value, hint) }); setMobileNav(false);
  }
  function chooseOrganization(id) {
    setEditor(null); setNotice('');
    navigate(page, null, null, null, { workspaceOrganization: id });
  }
  function resolveEventOrganization(id, eventId, tab, entryId) {
    if (id !== 'independent' && !data?.organizations.some(org => org.id === id)) {
      setNotice('Your organization access has changed. Refresh your workspace to open this event.');
      navigate('events'); return;
    }
    navigate('events', eventId, entryId, tab, { workspaceOrganization: id });
  }
  if (onboardingToken && onboardingSignIn) return <BusinessSignIn invitationOnly onSession={login} notice={loginNotice || 'Sign in with the email address on your invitation. You will return to the invitation to accept access.'} />;
  if (onboardingToken) return <><OnboardingSetup token={onboardingToken} session={session} onSignIn={() => setOnboardingSignIn(true)} onSwitchAccount={async (signIn) => { if (!await signOut()) setOnboardingSignIn(signIn); }} onContinue={() => { setOnboardingToken(null); writeWorkspaceLocation({ onboarding: null }, { replace: true }); setRevision((value) => value + 1); }} />{notice && <p role="alert">{notice}</p>}</>;
  if (inviteToken) return <TeamInviteLanding token={inviteToken} session={session} onSession={login} onAccepted={(updated, accepted) => {
    login(updated); setInviteToken(null); writeWorkspaceLocation({ invite: null }, { replace: true }); setNotice('Invitation accepted. Your access is ready.');
    const section = accepted?.eventId ? 'events' : 'team';
    // A newly accepted membership may not be in the previous bootstrap yet.
    // Select it once the server confirms the refreshed organization grants.
    if (accepted?.organizationId) invitationWorkspace.current = { section, eventId: accepted.eventId || null, organizationId: accepted.organizationId };
    navigate(section, accepted?.eventId || null, null, null, { workspaceOrganization: accepted?.organizationId });
    setRevision((value) => value + 1);
  }} />;
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
      : page === "payments"
        ? "Your payments, clearly."
        : "The right people. A great night.";
  const hasIndependentWorkspace = Boolean(data?.scope?.canCreateIndependent);
  const activeOrg = organizationScope.organizations.length === 1 && !organizationScope.ownedOnly ? organizationScope.organizations[0] : null;
  const scopedVenues = data.venues.filter(venue => organizationScope.ownedOnly
    ? organizationScope.owners.some(org => org.id === venue.organizationId)
    : venue.organizationId === activeOrg?.id || organizationScope.selection === 'independent' && !venue.organizationId);
  const showVenueSelector = scopedVenues.length > 1;
  const scopedData = { ...data, organizations: organizationScope.organizations, scope: { ...data.scope, canCreateIndependent: organizationScope.selection === 'independent' && hasIndependentWorkspace } };
  const access = workspaceAccess(scopedData, session.user);
  const canManage = organizationScope.ownedOnly || access.canManage;
  const ownOnly = !organizationScope.ownedOnly && access.ownOnly;
  const canManageTeam = data
    ? Boolean(activeOrg && (session.user.isInternalAdmin || activeOrg.canManage || activeOrg.canCreateEvents))
    : Boolean(session.user.isInternalAdmin || session.roles?.some((role) => ['organization_owner', 'venue_manager'].includes(role)));
  const canViewPayments = Boolean(data.organizations?.some(org => org.canManageFinance) || data.scope?.canViewEarnings);
  const visibleNavigation = navigation.filter(([id]) => id !== 'payments' || canViewPayments);
  const visiblePage = page === 'payments' && !canViewPayments ? 'overview' : page;
  const sidebarContent = <>
        <Brand />
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>{organizationScope.ownedOnly ? 'Your organizations' : activeOrg?.name || (organizationScope.selection === 'independent' ? 'Independent events' : 'Your business')}</strong>
            <small>
              {ownOnly ? 'Your venue activity' : activeOrg
                ? `${activeOrg.planTier === "premium" ? "Premium" : "Free"} workspace`
                : "Owned organizations only"}
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
      {organizationRequestOpen && <OrganizationRequestDialog session={session} onClose={() => setOrganizationRequestOpen(false)} onUnauthorized={expire}/>}
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
          <BusinessProfile session={session} capabilities={data?.capabilities} onLogout={(everywhere) => signOut(false, everywhere)} onSessionChanged={(updated) => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated)); setProfileOpen(false); setNotice('Password changed. Other sessions have been signed out.'); setSession(updated); }} onUpdated={(user) => { const updated = { ...session, user: { ...session.user, ...user } }; sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated)); setSession(updated); }} />
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
            <Notifications session={session} onNavigate={navigate} onMessage={setMessageThread} onSupportMessage={setSupportThread} capabilities={data?.capabilities} />
            <Messages session={session} initialThreadId={messageThread} initialSupportThreadId={supportThread} onSupportOpened={() => setSupportThread(null)} supportContext={selectedOrganizations.length === 1 ? { organizationId: selectedOrganizations[0], organizationName: data?.organizations?.find(org => org.id === selectedOrganizations[0])?.name } : undefined} onOpened={() => setMessageThread(null)} />
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
          <div className="workspace-organization-control">
            <label htmlFor="workspace-organization">Organization</label>
            <Choice id="workspace-organization" label="Workspace organization" value={organizationScope.selection} onChange={chooseOrganization}
              options={[
                ...data.organizations.map(org => [org.id, org.name]),
                ...(hasIndependentWorkspace || data.scope?.canViewIndependent ? [['independent', 'Independent events']] : []),
                ...(allowsOwnedOrganizations(page) && organizationScope.canViewOwnedOrganizations ? [[OWNED_ORGANIZATIONS, 'All organizations', 'Only organizations where you are an owner']] : []),
              ]}/>
            {organizationScope.ownedOnly && <span className="hint">Only organizations where you are an owner.</span>}
          </div>
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
                      ? canManageTeam ? "Manage your organizations or start a separate one." : "Start your own organization without changing your existing roles."
                    : page === "admissions"
                      ? "Scan passes or admit guests manually for your events."
                    : page === "payments"
                      ? "Review your authorized business payments and personal commissions."
                    : "Review requests and keep every guestlist in balance."}
              </p>
            </div>
            {canManage && !organizationScope.ownedOnly && (visiblePage === "overview" || visiblePage === "events") && (
              <Button onClick={() => setEditor({})}>
                <Plus />
                Create event
              </Button>
            )}
            {visiblePage === "team" && <Button variant="outline" onClick={() => setOrganizationRequestOpen(true)}>Start an organization</Button>}
          </div>}
          {visiblePage !== "analytics" && visiblePage !== "team" && visiblePage !== "admissions" && visiblePage !== "payments" && <div className="page-controls">
            {showVenueSelector && <MultiSelect label="Venues" options={scopedVenues} selected={selectedVenues} onChange={chooseVenues} />}
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
                try { await downloadBusinessReport(session, reportQuery({ days, organizationIds: selectedOrganizations, ownedOnly: organizationScope.ownedOnly, venueIds: selectedVenues, timezone: browserReportTimezone() })); }
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
          {organizationScope.ready && (
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
              {visiblePage === "overview" && data && <>
                {!organizationScope.ownedOnly && <BusinessSetupProgress organizations={organizationScope.organizations} progress={data.setupProgress} selectedOrganizations={selectedOrganizations}
                  onOrganization={(id) => navigate('team', null, null, null, { teamOrganizationId: id })}
                  onPayments={(id) => navigate('payments', null, null, null, { paymentOrganization: id })}
                  onEvents={(id) => navigate('events', null, null, null, { organizationIds: [id] })}
                  onCreate={(id) => setEditor({ organizationId: id })}/>}
                <BusinessOverview key={organizationScope.selection} session={session} days={days} organizationIds={selectedOrganizations} ownedOnly={organizationScope.ownedOnly} venueIds={selectedVenues} ownOnly={ownOnly} revision={revision} onNavigate={navigate} onUnauthorized={expire}/>
              </>}
              {visiblePage === "analytics" && data && <BusinessAnalytics key={organizationScope.selection} session={session} ownOnly={ownOnly}
                organizationIds={selectedOrganizations} ownedOnly={organizationScope.ownedOnly} venues={scopedVenues}
                onEvent={(id) => navigate('events', id)} onUnauthorized={expire}/>}
              {visiblePage === "admissions" && <Admissions key={organizationScope.selection} organizationId={organizationScope.selection} session={session} onAdmitted={refreshAdmissions} onUnauthorized={expire} onOpenEvent={(id) => navigate('events', id)}/>}
              {visiblePage === "events" && data && (
                <PagedEvents
                  key={`${organizationScope.selection}:${eventNavigationRevision}`}
                  session={session}
                  ownOnly={ownOnly}
                  initialEventId={eventToOpen}
                  initialTab={eventTabToOpen}
                  initialGuestlistEntryId={guestlistEntryToOpen}
                  onUnauthorized={expire}
                  onEdit={(event, initialStep = 0) => setEditor({ event, initialStep })}
                  onDuplicate={(source, choices) => setEditor({ duplicateSource: source, copyChoices: choices,
                    presetDraft: reusableDraft(source, choices, organizationScope.organizations, scopedVenues) })}
                  onCreate={() => setEditor({})}
                  organizationIds={selectedOrganizations}
                  venueIds={selectedVenues}
                  revision={revision}
                  capabilities={data.capabilities}
                  onSelectionChange={selectEvent}
                  onOrganizationResolved={resolveEventOrganization}
                />
              )}
              {visiblePage === "team" && data && (canManageTeam
                ? <BusinessTeam key={activeOrg.id} session={session} organizations={[activeOrg]} onUnauthorized={expire} />
                : <p className="hint">Team and venue management are available only where you are an owner or authorized manager.</p>)}
              {visiblePage === "payments" && canViewPayments && <BusinessPayments key={organizationScope.selection} session={session} organizations={activeOrg ? [activeOrg] : []} organizationId={organizationScope.selection} canViewEarnings={Boolean(data.scope?.canViewEarnings)} />}
            </div>
          )}
          {!organizationScope.ready && <p className="hint">No active organization is available. You can request a separate organization from the Organization tab.</p>}
          <footer className="app-footer">
            <ContactNitewide session={session}/>
            <TermsLink/>
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
          organizations={organizationScope.organizations}
          venues={scopedVenues}
          canCreateIndependent={organizationScope.selection === 'independent' && hasIndependentWorkspace}
          defaultOrganization={
            editor.organizationId || activeOrg?.id || null
          }
          session={session}
          onClose={() => setEditor(null)}
          onReloadLatest={() => { setEditor(null); setRevision((value) => value + 1); setNotice('The latest event is loading. Your unsaved edits are kept in this tab.'); }}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            setSelectedVenues([]);
            setRevision((r) => r + 1);
            navigate('events');
          }}
        />
      )}
    </div>
  );
}
