import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  CircleUserRound,
  Command,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Choice, Empty } from "@/components/controls";
import { EventEditor } from "@/components/EventEditor";
import { Events } from '@/components/Events';
import { Analytics } from "@/components/Analytics";
import { MultiSelect } from "@/components/MultiSelect";
import { SalesMixPie } from "@/components/SalesMixPie";
import { TeamPerformanceTable } from "@/components/TeamPerformanceTable";
import { PersonalOverview } from "@/components/PersonalOverview";
import { Notifications } from "@/components/Notifications";
import { Team, TeamInviteLanding } from "@/components/Team";
import { BusinessProfile } from "@/components/BusinessProfile";
import { LoadingState } from "@/components/LoadingState";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import { api, readSession, SESSION_KEY } from "@/lib/api";
import { csv, eventDateLabel, money } from "@/lib/business";
import { salesMixSlices } from "@/lib/sales-mix";
import { sortTableRows } from "@/lib/table-sort";
import { workspaceAccess } from "@/lib/workspace-access";
import { reviewableGuestlistEvents } from "@/lib/guestlists";

const navigation = [
  ["overview", LayoutDashboard, "Overview"],
  ["analytics", BarChart3, "Analytics"],
  ["events", CalendarDays, "Events"],
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
function SignIn({ onSession, notice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      onSession(
        await api("/auth/sign-in", null, {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
          }),
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <section className="signin-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">THE BUSINESS BEHIND THE NIGHT</span>
          <h1>
            Great nights.
            <br />
            <em>
              Even better
              <br />
              business.
            </em>
          </h1>
          <p>
            Your events, your people, your performance.
            <br />
            One clear view of everything that matters.
          </p>
          <div className="story-pills">
            <span>
              <BarChart3 size={16} />
              Real-time insights
            </span>
            <span>
              <Ticket size={16} />
              Built for experiences
            </span>
          </div>
        </div>
        <div className="story-footer">
          A new standard for going out.
          <span>Made for the people who make it happen.</span>
        </div>
        <div className="orb orb-one" />
        <div className="orb orb-two" />
      </section>
      <section className="signin-form">
        <div className="signin-box">
          <a className="signin-back" href={import.meta.env.VITE_BUSINESS_HOME || '/'}>← About Nitewide Business</a>
          <span className="login-mark">
            <ShieldCheck />
          </span>
          <span className="eyebrow">YOUR BUSINESS, CONNECTED</span>
          <h2>Welcome back.</h2>
          <p>Sign in to make your next experience exceptional.</p>
          <form onSubmit={submit}>
            <label className="field">
              <span>Work email</span>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="you@yourbusiness.com"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
              />
            </label>
            {(error || notice) && (
              <p role="alert" className="error">
                {error || notice}
              </p>
            )}
            <Button disabled={busy} type="submit" size="lg">
              {busy && <LoaderCircle className="nw-loading-icon" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in to Nitewide"}
              {!busy && <ArrowRight />}
            </Button>
          </form>
          <div className="signin-note">
            <ShieldCheck size={16} />
            <span>
              One Nitewide identity. Access is based on your organization and
              event permissions.
            </span>
          </div>
          <p className="support-note">
            New organizer? Use your existing Nitewide customer account to create
            an independent event. Venue access requires an owner or manager
            assignment.
          </p>
        </div>
        <small>
          © {new Date().getFullYear()} Nitewide · Business, after hours.
        </small>
      </section>
    </main>
  );
}
function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function RankBars({ rows, empty, total }) {
  if (!rows.length) return <Empty title="No sales yet">{empty}</Empty>;
  return (
    <div className="rank-bars">
      {rows.slice(0, 6).map((r, i) => (
        <div className="rank-row" key={r.id}>
          <div>
            <span className="rank-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="rank-name">
              <span className="rank-title"><span className="rank-title-name" title={r.name}>{r.name}</span>{r.dateLabel && <span className="rank-date">· {r.dateLabel}</span>}</span>
              <small>
                {r.units ?? r.orders} {r.units != null ? "units" : "orders"}
              </small>
            </span>
            <strong>{money(r.salesCents)}</strong>
          </div>
          <div className="rank-track">
            <span
              style={{
                width: `${total ? Math.max(1, (r.salesCents / total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function SalesMix({ rows, total, empty }) {
  const slices = salesMixSlices(rows);
  if (!slices.length) return <Empty title="No sales yet">{empty}</Empty>;
  return (
    <>
      <SalesMixPie slices={slices}/>
      <RankBars rows={rows} total={total} empty={empty}/>
    </>
  );
}
function Performance({ data, onEvents }) {
  const { report } = data;
  const s = report.summary;
  const eventDates = new Map(data.events.map((event) => [event.id, eventDateLabel(event)]));
  const eventRows = report.events.filter((event) => event.salesCents).map((event) => ({ ...event, dateLabel: eventDates.get(event.id) }));
  return (
    <>
      <div className="metric-grid">
        <Metric
          label="Gross sales"
          value={money(s.salesCents)}
          detail="Paid order subtotals · USD"
          icon={CircleDollarSign}
        />
        <Metric
          label="Paid orders"
          value={s.orders.toLocaleString()}
          detail={`${s.units.toLocaleString()} tickets & packages sold`}
          icon={Ticket}
        />
        <Metric
          label="Average order"
          value={money(s.orders ? Math.round(s.salesCents / s.orders) : 0)}
          detail="Before customer checkout fees"
          icon={BarChart3}
        />
        <Metric
          label="Promoter commissions"
          value={money(s.commissionCents)}
          detail="Recorded commission · not payout status"
          icon={Users}
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE BIG PICTURE</span>
              <h2>Sales over time</h2>
              <p>Every experience adds up.</p>
            </div>
            <span className="legend-dot">Gross sales</span>
          </div>
          <div className="chart-summary">
            <strong>{money(s.salesCents)}</strong>
            <span>in the selected period</span>
          </div>
          <div
            className="revenue-chart"
            role="img"
            aria-label={`Daily gross sales in USD over ${data.range.days} days. Total ${money(s.salesCents)}. Use Export report for the daily data.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={report.daily}
                margin={{ left: 0, right: 12, top: 15, bottom: 0 }}
                accessibilityLayer
              >
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a69aff" stopOpacity={0.34} />
                    <stop
                      offset="100%"
                      stopColor="#a69aff"
                      stopOpacity={0.01}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#292a37"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) =>
                    new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })
                  }
                  tick={{ fill: "#9393a6", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={35}
                />
                <YAxis
                  tickFormatter={(v) =>
                    `$${v >= 100000 ? `${Math.round(v / 100000)}k` : Math.round(v / 100)}`
                  }
                  tick={{ fill: "#9393a6", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                />
                <Tooltip
                  formatter={(v) => [money(v), "Gross sales"]}
                  contentStyle={{
                    background: "#20202c",
                    border: "1px solid #3b394d",
                    borderRadius: 12,
                    color: "#fafafa",
                  }}
                />
                <Area
                  dataKey="salesCents"
                  type="linear"
                  stroke="#b2a6ff"
                  strokeWidth={2.5}
                  fill="url(#salesFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-footnote">
            <span>Sales booked by payment date</span>
            <span>UTC · USD · fees excluded</span>
          </div>
        </section>
        <section className="panel breakdown-panel">
          <Tabs defaultValue="packages">
            <div className="section-heading">
              <div>
                <span className="eyebrow">WHAT’S WORKING</span>
                <h2>Sales mix</h2>
              </div>
            </div>
            <TabsList className="report-tabs">
              <TabsTrigger value="packages">Tickets & packages</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
            <TabsContent value="packages">
              <SalesMix
                rows={report.packages}
                total={s.salesCents}
                empty="Your ticket and package sales will appear here."
              />
            </TabsContent>
            <TabsContent value="events" className="event-sales-mix">
              <SalesMix
                rows={eventRows}
                total={s.salesCents}
                empty="Publish an event and make your first sale."
              />
            </TabsContent>
          </Tabs>
          <p className="hint">
            Top 6 by gross sales. Export includes every row.
          </p>
        </section>
      </div>
      <TeamPerformanceTable report={report} summary={s} onEvents={onEvents}/>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [page, setPage] = useState("overview");
  const [selectedOrganizations, setSelectedOrganizations] = useState([]);
  const [selectedVenues, setSelectedVenues] = useState([]);
  const [hasIndependentWorkspace, setHasIndependentWorkspace] = useState(false);
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null);
  const [eventToOpen, setEventToOpen] = useState(null);
  const [guestlistEntryToOpen, setGuestlistEntryToOpen] = useState(null);
  const [eventTabToOpen, setEventTabToOpen] = useState(null);
  const [eventNavigationRevision, setEventNavigationRevision] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuTrigger = useRef(null);
  useEffect(() => {
    // Each phone destination starts at its heading, not the previous page's scroll offset.
    if (window.matchMedia("(max-width: 850px)").matches) window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);
  useEffect(() => {
    const screen = window.matchMedia("(min-width: 851px)");
    const closeOnDesktop = () => { if (screen.matches) setMobileNav(false); };
    screen.addEventListener("change", closeOnDesktop);
    return () => screen.removeEventListener("change", closeOnDesktop);
  }, []);
  const signOut = useCallback((expired = false) => {
    window.history.replaceState(null, '', '/sign-in');
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setData(null);
    setEditor(null);
    setMobileNav(false);
    setProfileOpen(false);
    setSelectedOrganizations([]);
    setSelectedVenues([]);
    setHasIndependentWorkspace(false);
    setNotice("");
    setError("");
    setPage("overview");
    setLoginNotice(
      expired ? "Your session has expired. Please sign in again." : "",
    );
  }, []);
  const expire = useCallback(() => signOut(true), [signOut]);
  useEffect(() => {
    window.history.replaceState(null, '', session ? '/app' : '/sign-in');
  }, [session]);
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
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ days });
    selectedOrganizations.forEach((id) => query.append('organizationIds', id));
    selectedVenues.forEach((id) => query.append('venueIds', id));
    api(`/business/workspace?${query}`, session, { signal: controller.signal })
      .then((result) => { setData(result); if (!selectedOrganizations.length && !selectedVenues.length) setHasIndependentWorkspace(result.events.some((event) => !event.organizationId)); })
      .catch((err) => {
        if (err.name === "AbortError") return;
        if (err.status === 401) expire();
        else setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, selectedOrganizations, selectedVenues, days, revision, expire]);
  function login(value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    setSession(value);
    setLoginNotice("");
  }
  function navigate(value, eventId = null, entryId = null, eventTab = null) {
    setPage(value);
    setEventToOpen(eventId);
    setGuestlistEntryToOpen(entryId);
    setEventTabToOpen(eventTab);
    setEventNavigationRevision((revision) => revision + 1);
    setMobileNav(false);
  }
  function exportReport() {
    const r = data.report;
    const rows = [
      [
        "Nitewide sales report",
        `USD · UTC · ${data.range.since} to ${data.range.until}`,
      ],
      [
        "Section",
        "Name / date",
        "Role / kind",
        "Sales USD",
        "Orders / units",
        "Commission USD",
      ],
    ];
    for (const [name, entries] of [
      ["Event", r.events],
      ["Offering", r.packages],
      ["Person", r.people],
    ])
      for (const entry of entries)
        rows.push([
          name,
          entry.name,
          entry.role || entry.kind || "",
          (entry.salesCents / 100).toFixed(2),
          entry.orders ?? entry.units,
          entry.commissionCents == null
            ? ""
            : (entry.commissionCents / 100).toFixed(2),
        ]);
    for (const day of r.daily)
      rows.push(["Daily", day.date, "", (day.salesCents / 100).toFixed(2)]);
    const url = URL.createObjectURL(
      new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `nitewide-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (inviteToken) return <TeamInviteLanding token={inviteToken} session={session} onSession={login} onAccepted={(updated, accepted) => { login(updated); setInviteToken(null); setNotice('Invitation accepted. Your access is ready.'); setPage(accepted?.eventId ? 'events' : 'team'); setRevision((value) => value + 1); }} />;
  if (!session) return <SignIn onSession={login} notice={loginNotice} />;
  const title =
    page === "overview"
      ? "A clearer view of your business."
      : page === "analytics"
        ? "Know what moves your business."
      : page === "events"
        ? "Set the stage for something great."
      : page === "team"
        ? "Your organization, together."
        : "The right people. A great night.";
  const activeOrg = selectedOrganizations.length === 1 ? data?.organizations.find((o) => o.id === selectedOrganizations[0]) : data?.organizations.length === 1 && !hasIndependentWorkspace ? data.organizations[0] : null;
  const showVenueSelector = (data?.venues?.length || 0) > 1;
  const showOrganizationSelector = (data?.organizations.length || 0) + Number(hasIndependentWorkspace) > 1;
  const { canManage, ownOnly } = workspaceAccess(data, session.user);
  const canManageTeam = Boolean(session.user.isInternalAdmin || data?.organizations?.some((org) => org.canManage));
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
          <BusinessProfile session={session} onUpdated={(user) => { const updated = { ...session, user: { ...session.user, ...user } }; sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated)); setSession(updated); }} />
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
            <Notifications session={session} onNavigate={navigate} />
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
          <div className="page-heading">
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
                    : "Review requests and keep every guestlist in balance."}
              </p>
            </div>
            {canManage && (visiblePage === "overview" || visiblePage === "events") && (
              <Button onClick={() => setEditor({})}>
                <Plus />
                Create event
              </Button>
            )}
          </div>
          {visiblePage !== "analytics" && visiblePage !== "team" && <div className="page-controls">
            {showOrganizationSelector && <MultiSelect
              label="Organizations"
              selected={selectedOrganizations}
              onChange={(ids) => { setSelectedOrganizations(ids); setSelectedVenues([]); }}
              options={[
                ...(hasIndependentWorkspace ? [{ id: 'independent', label: 'Independent events' }] : []),
                ...(data?.organizations || []).map((o) => ({ id: o.id, label: o.name })),
              ]}
            />}
            {showVenueSelector && <MultiSelect label="Venues" options={data.venues} selected={selectedVenues} onChange={setSelectedVenues} />}
            {page !== "events" && <div>
              <Choice
                label="Sales period"
                value={days}
                onChange={setDays}
                options={[
                  ["7", "Last 7 days"],
                  ["30", "Last 30 days"],
                  ["90", "Last 90 days"],
                  ["365", "Last 365 days"],
                ]}
              />
              <Button
                variant="outline"
                disabled={!data || loading || Boolean(error)}
                onClick={exportReport}
              >
                <ArrowDownToLine />
                Export report
              </Button>
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
          {data && !error && (
            <div
              className={loading ? "content-updating" : ""}
              aria-busy={loading}
            >
              {data.scope === "mixed" && (
                <p className="scope-note">
                  <ShieldCheck size={16} />
                  Sales include managed events and your own referrals only.
                  Organization event editing requires owner or manager access.
                </p>
              )}
              {visiblePage === "overview" && (
                ownOnly ? <PersonalOverview data={data} onEvents={(eventId) => navigate('events', eventId)} onAnalytics={() => navigate('analytics')} onGuestlists={() => { const event = reviewableGuestlistEvents(data.events)[0]; navigate('events', event?.id || null, null, event ? 'guestlist' : null); }}/> : <Performance data={data} onEvents={() => navigate("events")} />
              )}
              {visiblePage === "analytics" && <Analytics session={session} ownOnly={ownOnly} />}
              {visiblePage === "events" && (
                <Events
                  key={eventNavigationRevision}
                  data={data}
                  session={session}
                  ownOnly={ownOnly}
                  initialEventId={eventToOpen}
                  initialTab={eventTabToOpen}
                  initialGuestlistEntryId={guestlistEntryToOpen}
                  onUnauthorized={expire}
                  onEdit={setEditor}
                  onCreate={() => setEditor({})}
                />
              )}
              {visiblePage === "team" && canManageTeam && <Team session={session} organizations={data.organizations.filter((org) => org.canManage)} onUnauthorized={expire} />}
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
          key={editor.id || "new"}
          event={editor.id ? editor : null}
          organizations={data.organizations}
          defaultOrganization={
            selectedOrganizations.length === 1 && selectedOrganizations[0] === "independent"
              ? null
              : activeOrg?.canManage
                ? activeOrg.id
                : data.organizations.find((o) => o.canManage)?.id || null
          }
          session={session}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            setSelectedOrganizations([]);
            setSelectedVenues([]);
            setRevision((r) => r + 1);
            setPage("events");
          }}
        />
      )}
    </div>
  );
}
