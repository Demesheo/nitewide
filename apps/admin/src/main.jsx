import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, Building2, CalendarDays, Users, LifeBuoy, ChartNoAxesCombined, History, MessageSquare, Menu, X } from 'lucide-react';
import { api, clearSession, readSession, signIn, verifySession } from './lib/api';
import { readRoute, changedQuery, recordQuery, returnQuery, recordReturnLabel } from './lib/navigation';
import { hasAdminPermission } from './lib/permissions';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import Directory from './components/Directory';
import RecordDetail from './components/RecordDetail';
import Analytics from './components/Analytics';
import Overview from './components/Overview';
import Support from './components/Support';
import Messages from './components/Messages';
import PageHeader from './components/PageHeader';
import { AdminBrand, AdminLoginMark } from './components/AdminBrand';
import { publicAppLink } from '../../shared/app-links.mjs';
import './styles.css';
import './rebuild.css';
import './messages.css';

const navigation = [['overview', 'Overview', LayoutDashboard], ['businesses', 'Businesses', Building2], ['events', 'Events', CalendarDays], ['people', 'People', Users], ['support', 'Support', LifeBuoy], ['analytics', 'Analytics', ChartNoAxesCombined], ['audit', 'Audit', History]];
const descriptions = { overview: 'Platform performance and the issues that need your attention.', businesses: 'Business workspaces, venues, ownership and account setup.', events: 'Events, offerings, purchases and admission history.', people: 'People and their access across the platform.', support: 'Resolve booking, admission and account issues with a retained case history.', analytics: 'Explore performance, then open individual records with report context intact.', audit: 'The history of platform changes and delivery activity.' };
const customerUrl = publicAppLink('customerUrl', import.meta.env.VITE_CUSTOMER_URL || 'http://localhost:5173');
const businessUrl = publicAppLink('businessHome', import.meta.env.VITE_BUSINESS_URL || 'http://localhost:5174');

function Login({ onAuthenticated }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const session = await signIn(email, password); if (!session.roles?.includes('internal_admin')) { clearSession(); throw new Error('This account is not authorized for Nitewide Admin.'); } onAuthenticated(session); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="login-shell"><section className="login-story"><AdminBrand /><div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Keep every night<br/>running smoothly.</h1><p>A shared workspace for business operations, support and platform performance.</p></div><small>For authorized Nitewide staff.</small></section><section className="login-panel"><form id="admin-signin-form" aria-label="Admin sign in" className="login-card" onSubmit={submit}><AdminLoginMark /><p className="eyebrow">SECURE ACCESS</p><h2>Sign in to command center</h2><p>Use an internal administrator account.</p><label htmlFor="admin-signin-email">Email<Input id="admin-signin-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/></label><label htmlFor="admin-signin-password">Password<Input id="admin-signin-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/></label>{error && <p className="error" role="alert">{error}</p>}<Button disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</Button><div className="app-links"><a href={customerUrl}>Customer app ↗</a><a href={businessUrl}>Business app ↗</a></div></form></section></main>;
}

function Dashboard({ session, onSignOut }) {
  const [query, setQuery] = useState(window.location.search); const [mobileNav, setMobileNav] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false); const [logoutError, setLogoutError] = useState('');
  const [messageUnread, setMessageUnread] = useState(0);
  const messageCountRevision = useRef(0);
  const canReadMessages = hasAdminPermission(session.user, 'support.view');
  const route = readRoute(query);
  useEffect(() => { const pop = () => setQuery(window.location.search); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    if (!canReadMessages) { setMessageUnread(0); return; }
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      const revision = ++messageCountRevision.current;
      api('/admin/support/messages?page=1&pageSize=1', { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted && messageCountRevision.current === revision) setMessageUnread(result.unreadCount || 0); })
        .catch(() => {});
    };
    refresh(); const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [canReadMessages, session.accessToken]);
  function navigate(next, replace = false) { window.history[replace ? 'replaceState' : 'pushState']({}, '', next); setQuery(next); setMobileNav(false); }
  function update(values, replace = true) { navigate(changedQuery(query, values), replace); }
  const openRecord = (resource, id, options) => navigate(recordQuery(query, resource, id, options));
  async function logout(everywhere) { setLogoutBusy(true); setLogoutError(''); try { await onSignOut(everywhere); } catch (error) { setLogoutError(error.message); } finally { setLogoutBusy(false); } }
  const allowedNavigation = navigation.filter(([id]) => id === 'analytics' ? hasAdminPermission(session.user, 'reports.view') : id === 'audit' ? hasAdminPermission(session.user, 'audit.view') : true);
  const selected = route.section === 'messages' && canReadMessages ? ['messages', 'Messages', MessageSquare] : allowedNavigation.find(([id]) => id === route.section);
  return <div className="app-shell">
    <header className="topbar">
      <Button variant="ghost" size="icon" className="menu" aria-label="Toggle navigation" aria-controls="admin-navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X/> : <Menu/>}</Button>
      <AdminBrand href="?section=overview" onClick={(event) => { event.preventDefault(); navigate('?section=overview'); }} />
      <div className="top-actions">
        {canReadMessages && <Button variant="ghost" size="icon" className="admin-message-trigger" aria-label={`Messages${messageUnread ? `, ${messageUnread} unread` : ''}`} aria-current={route.section === 'messages' ? 'page' : undefined} onClick={() => navigate('?section=messages')}>
          <MessageSquare size={19} aria-hidden="true" />
          {messageUnread > 0 && <span className="admin-message-count">{messageUnread > 9 ? '9+' : messageUnread}</span>}
        </Button>}
        <a href={businessUrl}>Business app ↗</a><span>{session.user.displayName}</span>
      </div>
    </header>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside id="admin-navigation" aria-label="Admin navigation" className={mobileNav ? 'open' : ''}>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Admin sections">{allowedNavigation.map(([id, title, Icon]) => <Button id={`admin-nav-${id}`} variant="ghost" key={id} className={route.section === id ? 'active' : ''} aria-current={route.section === id ? 'page' : undefined} onClick={() => navigate(changedQuery('', { section: id }))}><Icon size={17}/>{title}</Button>)}</nav>
      <div className="side-foot"><b>{session.user.displayName}</b><small>{session.user.email}</small><Button variant="ghost" disabled={logoutBusy} onClick={() => logout(false)}>Sign out</Button><Button variant="ghost" disabled={logoutBusy} onClick={() => logout(true)}>Sign out everywhere</Button>{logoutError && <p className="error" role="alert">{logoutError}</p>}</div>
    </aside>
    <main className={route.id ? 'workspace workspace-record' : 'workspace'}>
      {(route.id || ['support', 'analytics'].includes(route.section) || !selected) && <PageHeader title={selected?.[1] || 'Access unavailable'} description={descriptions[route.section]}/>}
      {!selected ? <p className="error" role="alert">Your staff role does not have access to this section.</p>
        : route.id ? <RecordDetail resourceKey={route.resource} id={route.id} params={route.params} onUpdate={update} onBack={() => navigate(returnQuery(query))} returnLabel={recordReturnLabel(query)} onOpenRecord={openRecord} session={session}/>
        : route.section === 'overview' ? <Overview onOpenRecord={openRecord} onNavigate={navigate}/>
        : route.section === 'analytics' ? <Analytics params={route.params} onUpdate={update} onOpenRecord={openRecord}/>
        : route.section === 'messages' ? <Messages session={session} params={route.params} onUpdate={update} onOpenCase={caseId => navigate(changedQuery('', { section: 'support', case: caseId }))} onUnreadChange={count => { messageCountRevision.current += 1; setMessageUnread(count); }}/>
        : route.section === 'support' ? <Support params={route.params} onUpdate={update} onOpenRecord={openRecord} onOpenConversation={threadId => navigate(changedQuery('', { section: 'messages', thread: threadId }))}/>
        : <Directory session={session} section={route.section} resourceKey={route.resource} params={route.params} onUpdate={update} onOpenRecord={openRecord}/>}
    </main>
  </div>;
}

function App() {
  const [session, setSession] = useState(readSession()); const [checking, setChecking] = useState(Boolean(session));
  const [verificationError, setVerificationError] = useState(''); const [verificationAttempt, setVerificationAttempt] = useState(0);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setChecking(true); setVerificationError('');
    verifySession().then((next) => {
      if (!active) return;
      if (!next.roles?.includes('internal_admin')) { clearSession(); setSession(null); }
      else setSession(next);
      setChecking(false);
    }).catch((error) => {
      if (!active) return;
      if ([401, 403].includes(error.status)) { clearSession(); setSession(null); setChecking(false); }
      else setVerificationError(error.message);
    });
    return () => { active = false; };
  }, [verificationAttempt]);
  if (verificationError) return <main className="login-panel verification-recovery"><section className="login-card"><p className="eyebrow">NITEWIDE ADMIN</p><h1>Unable to verify your session</h1><p className="error" role="alert">{verificationError}</p><p>Your sign-in is retained. Verify your session before opening the workspace.</p><Button onClick={() => setVerificationAttempt((value) => value + 1)}>Retry verification</Button><Button variant="outline" onClick={() => { clearSession(); setSession(null); setVerificationError(''); setChecking(false); }}>Return to sign in</Button></section></main>;
  if (checking) return <div className="boot" role="status">NITEWIDE <span>ADMIN</span></div>;
  if (!session) return <Login onAuthenticated={setSession}/>;
  return <Dashboard session={session} onSignOut={async (everywhere = false) => { try { await api(everywhere ? '/auth/sessions/revoke-all' : '/auth/logout', { method: 'POST' }); } catch (error) { if (error.status !== 401) throw error; } clearSession(); setSession(null); }}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
