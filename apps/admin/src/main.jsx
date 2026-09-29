import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, clearSession, readSession, signIn, verifySession } from './lib/api';
import { exportCsv, filterRecords, formatDate, formatMoney, initials } from './lib/admin';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge as ShadBadge } from './components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Card } from './components/ui/card';
import { DataTable as Table } from './components/DataTable';
import Analytics from './components/Analytics';
import Operations from './components/Operations';
import Management from './components/Management';
import './styles.css';

const NAV = [['overview', 'Overview'], ['operations', 'Operations'], ['management', 'Management'], ['reports', 'Reports & analytics'], ['organizations', 'Organizations'], ['events', 'Events'], ['orders', 'Orders & payments'], ['users', 'Users'], ['audit', 'Audit log']];
const OPERATION_KINDS = ['failed_payments', 'pending_guestlist', 'suspended_organizations'];
function initialOperationQueue() { if (typeof window === 'undefined') return null; const kind = new URLSearchParams(window.location.search).get('queue'); return OPERATION_KINDS.includes(kind) ? kind : null; }
const editable = {
  users: [['displayName', 'Display name', 'text'], ['phone', 'Phone', 'text'], ['isActive', 'Active', 'checkbox'], ['isInternalAdmin', 'Internal admin', 'checkbox']],
  organizations: [['name', 'Name', 'text'], ['description', 'Description', 'textarea'], ['planTier', 'Plan', 'select', ['free', 'premium']], ['status', 'Status', 'select', ['active', 'suspended', 'closed']]],
  events: [['title', 'Title', 'text'], ['summary', 'Summary', 'textarea'], ['category', 'Category', 'text'], ['status', 'Status', 'select', ['draft', 'published', 'cancelled', 'completed']], ['startsAt', 'Starts (UTC)', 'datetime-local'], ['endsAt', 'Ends (UTC)', 'datetime-local'], ['capacity', 'Capacity', 'number'], ['guestlistCapacity', 'Guestlist capacity', 'number'], ['isDiscoverable', 'Discoverable', 'checkbox']],
};

function Login({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = await signIn(email, password);
      if (!session.roles?.includes('internal_admin')) { clearSession(); throw new Error('This account is not authorized for Nitewide Admin.'); }
      onAuthenticated(session);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="login-shell">
    <section className="login-story"><a className="brand" href="/"><span>N</span>NITEWIDE <em>ADMIN</em></a><div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Keep every night<br/>running smoothly.</h1><p>One secure workspace for marketplace health, partner operations, sales intelligence, and accountable interventions.</p></div><small>Restricted to authorized Nitewide administrators.</small></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}><p className="eyebrow">SECURE ACCESS</p><h2>Sign in to command center</h2><p>Use an internal administrator account.</p><label>Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required/></label><label>Password<Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required/></label>{error && <div className="error" role="alert">{error}</div>}<Button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</Button><div className="app-links"><a href={import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173"}>Customer app ↗</a><a href={import.meta.env.VITE_BUSINESS_URL || "http://localhost:5174"}>Business app ↗</a></div></form></section>
  </main>;
}

function Stat({ label, value, note }) { return <Card className="stat"><span>{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></Card>; }
function Badge({ value }) { return <ShadBadge variant="outline" className={`badge ${String(value).replaceAll('_', '-')}`}>{String(value)}</ShadBadge>; }
function Empty({ label = 'No records match these filters.' }) { return <div className="empty">{label}</div>; }
function eventLifecycle(record) {
  if (record.lifecycleState && record.lifecycleState !== 'active') return record.lifecycleState;
  if (record.organizationId && (record.organization?.lifecycleState !== 'active' || record.organization?.status !== 'active')) return 'organization unavailable';
  if (record.locationId && record.location?.lifecycleState !== 'active') return 'venue unavailable';
  if (!record.organizationId && (!record.creator || record.creator.lifecycleState !== 'active' || !record.creator.isActive || record.creator.onboardingPending)) return 'creator unavailable';
  return 'active';
}

function SalesChart({ rows = [] }) {
  const max = Math.max(1, ...rows.map((row) => row.salesCents));
  return <><div className="bars" aria-hidden="true">{rows.slice(-14).map((row) => <div className="bar-cell" key={row.id} title={`${row.label}: ${formatMoney(row.salesCents)}`}><div className="bar" style={{ height: `${Math.max(4, row.salesCents / max * 100)}%` }}/><small>{row.label.slice(5)}</small></div>)}</div><table className="sr-only"><caption>Paid sales by UTC day</caption><thead><tr><th>Date</th><th>Paid orders</th><th>Gross sales</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.label}</td><td>{row.orders}</td><td>{formatMoney(row.salesCents)}</td></tr>)}</tbody></table></>;
}

function EditDialog({ kind, record, onClose, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(editable[kind].map(([key,,type]) => {
    let value = record[key] ?? '';
    if (type === 'datetime-local' && value) value = new Date(value).toISOString().slice(0, 16);
    return [key, value];
  })));
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); const payload = { reason };
    for (const [key,,type] of editable[kind]) { let value = values[key]; if (type === 'number') value = value === '' ? null : Number(value); if (type === 'datetime-local') value = `${value}:00Z`; payload[key] = value; }
    try { await api(`/admin/${kind}/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); onSaved(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="dialog"><form onSubmit={save}><DialogHeader className="dialog-head"><div><p className="eyebrow">ADMIN OVERRIDE</p><DialogTitle>Edit {kind.slice(0, -1)}</DialogTitle><DialogDescription>{record.id}</DialogDescription></div></DialogHeader><div className="form-grid">{editable[kind].map(([key,label,type,options]) => <label key={key} className={type === 'textarea' ? 'wide' : ''}>{type === 'checkbox' ? <span className="check"><input type="checkbox" checked={Boolean(values[key])} onChange={(e) => setValues({ ...values, [key]: e.target.checked })}/>{label}</span> : <>{label}{type === 'select' ? <select value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>{options.map((option) => <option key={option}>{option}</option>)}</select> : type === 'textarea' ? <textarea value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}/> : <Input type={type} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}/>}</>}</label>)}</div><label>Required audit reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength="3" required placeholder="Why is this intervention necessary?"/></label><p className="guardrail">Protected IDs, ownership, slugs, credential secrets, payment references, and financial amounts cannot be changed here.</p>{error && <div className="error">{error}</div>}<DialogFooter className="dialog-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save audited change'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function DemoUserDialog({ data, onClose, onCreated }) {
  const [form, setForm] = useState({ displayName: '', email: '', password: 'NitewideDemo!2026', role: 'customer', organizationId: '', eventId: '' });
  const [error, setError] = useState(''); const [created, setCreated] = useState(null); const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { const result = await api('/admin/demo-users', { method: 'POST', body: JSON.stringify({ ...form, organizationId: form.organizationId || null, eventId: form.eventId || null }) }); setCreated(result); await onCreated(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  const needsOrg = ['organization_owner', 'venue_manager', 'employee', 'organization_promoter'].includes(form.role);
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="dialog"><form onSubmit={submit}><DialogHeader><p className="eyebrow">DEMO IDENTITY</p><DialogTitle>Create a role-ready demo user</DialogTitle><DialogDescription>This creates real local credentials and the memberships needed for the selected role.</DialogDescription></DialogHeader>{created ? <div className="success"><b>{created.displayName} is ready.</b><span>{created.email}</span><span>Role: {created.role.replaceAll('_', ' ')}</span><small>Password is the value you entered and is never returned by the API.</small></div> : <><div className="form-grid"><label>Display name<Input value={form.displayName} onChange={set('displayName')} required/></label><label>Email<Input type="email" value={form.email} onChange={set('email')} required/></label><label>Password<Input type="text" minLength="12" value={form.password} onChange={set('password')} required/></label><label>Role<select value={form.role} onChange={set('role')}><option value="customer">Customer</option><option value="internal_admin">Internal admin</option><option value="organization_owner">Organization owner</option><option value="venue_manager">Venue manager</option><option value="employee">Employee / host</option><option value="organization_promoter">Organization promoter</option><option value="event_promoter">Event promoter</option><option value="event_creator">Independent event creator</option></select></label>{needsOrg && <label className="wide">Organization<select value={form.organizationId} onChange={set('organizationId')} required><option value="">Choose an organization</option>{data.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}{form.role === 'event_promoter' && <label className="wide">Event<select value={form.eventId} onChange={set('eventId')} required><option value="">Choose an event</option>{data.events.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.organization?.name || 'Independent'}</option>)}</select></label>}</div><p className="guardrail">Use non-production email addresses. Public registration can still create customer identities only.</p>{error && <div className="error">{error}</div>}</>}<DialogFooter className="dialog-actions"><Button type="button" variant="outline" onClick={onClose}>{created ? 'Done' : 'Cancel'}</Button>{!created && <Button disabled={busy}>{busy ? 'Creating…' : 'Create demo user'}</Button>}</DialogFooter></form></DialogContent></Dialog>;
}

function Dashboard({ session, onSignOut }) {
  const [section, setSection] = useState(() => initialOperationQueue() ? 'operations' : 'overview'); const [days, setDays] = useState(30); const [organizationId, setOrganizationId] = useState(''); const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [workspaceResult, setWorkspaceResult] = useState(null); const [workspaceError, setWorkspaceError] = useState(null); const [workspaceLoading, setWorkspaceLoading] = useState(false); const requestSequence = useRef(0); const requestController = useRef(null); const [editing, setEditing] = useState(null); const [managementRecord, setManagementRecord] = useState(null); const [creatingUser, setCreatingUser] = useState(false); const [mobileNav, setMobileNav] = useState(false);
  const workspaceKey = `${days}:${organizationId}`;
  const data = workspaceResult?.key === workspaceKey ? workspaceResult.value : null;
  const error = workspaceError?.key === workspaceKey ? workspaceError.message : '';
  const [operationKind, setOperationKind] = useState(initialOperationQueue);
  function openAlert(id) {
    const kind = { 'failed-payments': 'failed_payments', guestlist: 'pending_guestlist', organizations: 'suspended_organizations' }[id];
    if (kind) { setOperationKind(kind); setSection('operations'); }
    else if (id === 'draft-events') { setStatusFilter('draft'); setSection('events'); }
  }
  async function load() {
    const key = workspaceKey;
    const sequence = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setWorkspaceResult(null); setWorkspaceError(null); setWorkspaceLoading(true);
    try {
      const value = await api(`/admin/workspace?days=${days}&limit=100${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''}`, { signal: controller.signal });
      if (sequence === requestSequence.current) setWorkspaceResult({ key, value });
    } catch (err) {
      if (sequence === requestSequence.current && err.name !== 'AbortError') setWorkspaceError({ key, message: err.message });
    } finally {
      if (sequence === requestSequence.current) setWorkspaceLoading(false);
    }
  }
  useEffect(() => { load(); return () => requestController.current?.abort(); }, [days, organizationId]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [section]);
  const rows = useMemo(() => data ? {
    users: filterRecords(data.users, search, ['displayName', 'email', 'phone']).filter((row) => !statusFilter || (row.isActive ? 'active' : 'disabled') === statusFilter), organizations: filterRecords(data.organizations, search, ['name', 'slug', 'status', 'planTier']).filter((row) => !statusFilter || row.status === statusFilter), events: filterRecords(data.events, search, ['title', 'category', 'status', (row) => row.organization?.name, (row) => row.location?.city]).filter((row) => !statusFilter || row.status === statusFilter), orders: filterRecords(data.orders, search, ['id', 'status', (row) => row.buyer?.email, (row) => row.event?.title]).filter((row) => !statusFilter || row.status === statusFilter), audit: filterRecords(data.audit, search, ['action', 'entityType', 'entityId', (row) => row.actor?.email]),
  } : {}, [data, search, statusFilter]);
  const title = NAV.find(([id]) => id === section)?.[1];
  const independentSection = ['operations', 'management', 'reports', 'organizations', 'events', 'orders', 'users', 'audit'].includes(section);
  function edit(kind, record) { setManagementRecord({ kind, id: record.id }); setSection('management'); }
  function manageOperation(kind, record) { const resource = { failed_payments: 'payments', pending_guestlist: 'guestlist', suspended_organizations: 'organizations' }[kind]; setManagementRecord({ kind: resource, id: record.id, edit: false }); setSection('management'); }
  function exportCurrent() { if (!data || workspaceLoading) return; const source = section === 'overview' ? data.sales.daily : rows[section] || []; exportCsv(`nitewide-${section}.csv`, source); }
  const cols = {
    organizations: [{ label: 'Organization', sortValue: (r) => r.name, render: (r) => <><b>{r.name}</b><small>{r.slug}</small></> }, { label: 'Plan', sortValue: (r) => r.planTier, render: (r) => <Badge value={r.planTier}/> }, { label: 'Status', sortValue: (r) => r.status, render: (r) => <Badge value={r.status}/> }, { label: 'Created', sortValue: (r) => r.createdAt, render: (r) => formatDate(r.createdAt) }],
    events: [{ label: 'Event', sortValue: (r) => r.title, render: (r) => <><b>{r.title}</b><small>{r.organization?.name || 'Independent'} · {r.location?.city || 'No location'}</small></> }, { label: 'Starts', sortValue: (r) => r.startsAt, render: (r) => formatDate(r.startsAt, true) }, { label: 'Category', key: 'category' }, { label: 'Status', sortValue: (r) => r.status, render: (r) => <Badge value={r.status}/> }, { label: 'Lifecycle', sortValue: eventLifecycle, render: (r) => <Badge value={eventLifecycle(r)}/> }, { label: 'Capacity', sortValue: (r) => r.capacity, numeric: true, render: (r) => `${r.capacity ?? '∞'} / ${r.guestlistCapacity} guestlist` }],
    orders: [{ label: 'Order', key: 'id', render: (r) => <><b>{r.id.slice(0, 8)}</b><small>{r.buyer?.email}</small></> }, { label: 'Event', sortValue: (r) => r.event?.title, render: (r) => r.event?.title }, { label: 'Total', key: 'totalCents', sales: true, render: (r) => formatMoney(r.totalCents) }, { label: 'Status', key: 'status', render: (r) => <Badge value={r.status}/> }, { label: 'Created', key: 'createdAt', render: (r) => formatDate(r.createdAt, true) }],
    users: [{ label: 'User', sortValue: (r) => r.displayName, render: (r) => <><b>{r.displayName}</b><small>{r.email}</small></> }, { label: 'Access', sortValue: (r) => r.isInternalAdmin ? 'administrator' : 'customer', render: (r) => r.isInternalAdmin ? <Badge value="administrator"/> : 'Customer / business' }, { label: 'Status', sortValue: (r) => r.isActive ? 'active' : 'disabled', render: (r) => <Badge value={r.isActive ? 'active' : 'disabled'}/> }, { label: 'Joined', key: 'createdAt', render: (r) => formatDate(r.createdAt) }],
    audit: [{ label: 'Action', key: 'action', render: (r) => <><b>{r.action}</b><small>{r.entityType} · {String(r.entityId).slice(0, 8)}</small></> }, { label: 'Actor', sortValue: (r) => r.actor?.displayName || r.actor?.email, render: (r) => r.actor?.displayName || r.actor?.email || 'System' }, { label: 'Reason / detail', sortValue: (r) => r.after?.adminReason, render: (r) => r.after?.adminReason || 'Recorded platform action' }, { label: 'Time', key: 'createdAt', render: (r) => formatDate(r.createdAt, true) }],
  };
  return <div className="app-shell">
    <header className="topbar"><Button variant="ghost" size="icon" className="menu" aria-label="Toggle navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>☰</Button><a className="brand" href="#"><span>N</span>NITEWIDE <em>ADMIN</em></a><div className="top-actions"><span className="health"><i/>Platform online</span><a href={import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173"}>Customer ↗</a><a href={import.meta.env.VITE_BUSINESS_URL || "http://localhost:5174"}>Business ↗</a><Button variant="outline" size="icon" className="avatar" title={session.user.email}>{initials(session.user.displayName)}</Button></div></header>
    <aside className={mobileNav ? 'open' : ''}><div className="nav-label">COMMAND CENTER</div>{NAV.map(([id,label]) => <Button variant="ghost" key={id} className={section === id ? 'active' : ''} onClick={() => { if (id === 'management') setManagementRecord(null); if (id === 'operations') setOperationKind(null); setSection(id); setMobileNav(false); }}>{label}</Button>)}<div className="side-foot"><b>{session.user.displayName}</b><small>{session.user.email}</small><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div></aside>
    <main className="workspace"><div className="page-head"><div><p className="eyebrow">NITEWIDE OPERATIONS</p><h1>{title}</h1><p>{section === 'overview' ? 'Marketplace health, sales, and action items in one accountable view.' : section === 'operations' ? 'Review payment attempts, guestlist requests, and account states across the platform.' : section === 'management' ? 'Create and manage platform records with audited suspend and archive controls.' : 'Search, inspect, export, and safely manage live platform records.'}</p></div>{!independentSection && <div className="head-actions"><select aria-label="Report period" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select><select aria-label="Sales organization" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}><option value="">All organizations</option>{(data?.organizations || workspaceResult?.value?.organizations || []).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select><Button variant="outline" disabled={!data || workspaceLoading} onClick={exportCurrent}>Export CSV</Button><Button className="demo-action" variant="outline" disabled={!data || workspaceLoading} onClick={() => setCreatingUser(true)}>Create demo user</Button><Button className="primary" disabled={workspaceLoading} onClick={load}>Refresh</Button></div>}</div>{error && !independentSection && <div className="error" role="alert">{error}</div>}{!data && !independentSection ? <div className="loading" role="status">{error ? 'Current results are unavailable.' : 'Loading platform operations…'}</div> : <>
    {section === 'overview' && <><section className="metrics"><Stat label="Gross sales" value={formatMoney(data.sales.summary.grossSalesCents)} note={`${data.sales.summary.orders} paid orders · ${days} days`}/><Stat label="Platform fees" value={formatMoney(data.sales.summary.platformFeesCents)} note="Customer service fees collected"/><Stat label="Organizations" value={data.stats.organizations} note={`${data.stats.premiumOrganizations} premium`}/><Stat label="Active events" value={data.stats.publishedEvents} note={`${data.stats.draftEvents} drafts`}/></section><div className="overview-grid"><section className="panel chart-panel"><div className="panel-head"><div><p className="eyebrow">SALES PULSE</p><h2>Paid volume</h2></div><strong>{formatMoney(data.sales.summary.grossSalesCents)}</strong></div><SalesChart rows={data.sales.daily}/></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">OPERATIONS QUEUE</p><h2>Needs attention</h2></div></div><div className="alerts">{data.alerts.map((alert) => <button key={alert.id} onClick={() => openAlert(alert.id)}><i className={alert.severity}/><span><b>{alert.label}</b><small>{alert.count ? 'Review matching records' : 'No action required'}</small></span><strong>{alert.count}</strong></button>)}</div></section></div><section className="panel"><div className="panel-head"><div><p className="eyebrow">TOP EVENTS</p><h2>Revenue leaders</h2></div><button onClick={() => setSection('reports')}>Full report →</button></div><Table rows={data.sales.events.slice(0, 5)} columns={[{ label: 'Event', key: 'label' }, { label: 'Paid orders', key: 'orders' }, { label: 'Gross sales', render: (r) => formatMoney(r.salesCents) }]}/></section></>}
    {section === 'reports' && <div className="analytics-page"><Analytics/></div>}
    {section === 'operations' && <Operations initialKind={operationKind} onManageRecord={manageOperation}/>}
    {section === 'management' && <Management initialRecord={managementRecord}/>}
    {['organizations','events','orders','users','audit'].includes(section) && <Management key={section} initialRecord={{ kind: section, id: null, edit: false }}/>}
  </>}</main>{editing && <EditDialog {...editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }}/>} {creatingUser && data && <DemoUserDialog data={data} onClose={() => setCreatingUser(false)} onCreated={load}/>}</div>;
}

function App() {
  const [session, setSession] = useState(readSession()); const [checking, setChecking] = useState(Boolean(session));
  useEffect(() => { if (!session) return; verifySession().then((next) => { if (!next.roles?.includes('internal_admin')) throw new Error(); setSession(next); }).catch(() => { clearSession(); setSession(null); }).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="boot">NITEWIDE <span>ADMIN</span></div>;
  if (!session) return <Login onAuthenticated={setSession}/>;
  return <Dashboard session={session} onSignOut={() => { clearSession(); setSession(null); }}/>;
}

createRoot(document.getElementById('root')).render(<App/>);
