import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import OnboardingForm from './OnboardingForm';
import '../management.css';

const display = (value) => value == null ? 'Unavailable' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const names = { users: 'user', organizations: 'organization', locations: 'venue', events: 'event', offerings: 'offering', owners: 'owner assignment', employees: 'employee', organization_affiliates: 'organization affiliate', event_affiliates: 'event affiliate', boosts: 'boost', notifications: 'notification', guestlist: 'guestlist entry', guestlist_invitations: 'guestlist invitation', team_invitations: 'team invitation' };
const resourceGroups = [
  ['People & access', ['users', 'owners', 'employees', 'organization_affiliates', 'event_affiliates', 'team_invitations', 'onboarding_invitations']],
  ['Venues & events', ['organizations', 'locations', 'events', 'offerings', 'boosts', 'media']],
  ['Sales & admissions', ['orders', 'order_items', 'payments', 'tickets', 'guestlist', 'guestlist_invitations', 'check_ins', 'attributions']],
  ['Communications & history', ['notifications', 'email_outbox', 'credentials', 'account_tokens', 'audit']],
];
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
const shortId = (value) => String(value || '').slice(0, 8);
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
function recordHeading(record, resource) {
  const title = record[resource.title] || record.name || record.title || record.email || record.id;
  return uuid.test(String(title)) ? `${names[resource.key] || resource.label} ${shortId(title)}` : title;
}
function recordContext(record) {
  if (record.email && record.displayName) return record.email;
  if (record.city) return [record.city, record.region].filter(Boolean).join(', ');
  if (record.category) return record.category;
  if (record.role) return label(record.role);
  if (record.eventId) return `Event ${shortId(record.eventId)}`;
  if (record.organizationId) return `Organization ${shortId(record.organizationId)}`;
  if (record.userId) return `User ${shortId(record.userId)}`;
  if (record.totalCents != null) return `${record.currency || 'USD'} ${(Number(record.totalCents) / 100).toFixed(2)}`;
  return record.slug || record.kind || record.action || '';
}
function recordState(record) {
  const state = record.status || (typeof record.isActive === 'boolean' ? record.isActive ? 'Active' : 'Disabled' : null);
  const lifecycle = record.lifecycleState && record.lifecycleState !== 'active' && record.lifecycleState !== state ? record.lifecycleState : null;
  return [state || lifecycle, state ? lifecycle : null, record.onboardingPending ? 'Setup pending' : null].filter(Boolean).join(' · ');
}
const localDate = (value) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const initial = (field, record) => record ? field.type === 'datetime-local' ? localDate(record[field.key]) : record[field.key] ?? (field.type === 'checkbox' ? false : field.type === 'references' ? [] : '') : field.type === 'checkbox' ? false : field.type === 'references' ? [] : field.type === 'select' ? field.options[0] : ({ entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 10, guestlistCapacity: 0, priceCents: 0, partySize: 1, commissionBps: 0, defaultCommissionBps: 0, defaultGuestlistAllocation: 0, budgetCents: 0, countryCode: 'US', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, currency: 'USD', category: 'other' }[field.key] ?? '');

function ReferenceInput({ field, value, onChange, resources }) {
  const [search, setSearch] = useState(''); const [options, setOptions] = useState([]); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const sequence = useRef(0);
  const config = resources.find((item) => item.key === field.resource);
  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(() => {
      setBusy(true);
      api('/admin/management/' + field.resource + '?page=' + page + '&pageSize=100&search=' + encodeURIComponent(search))
        .then((result) => { if (current === sequence.current) { setOptions((prior) => page === 1 ? result.items : [...new Map([...prior, ...result.items].map((item) => [item.id, item])).values()]); setTotal(result.total); setError(''); } })
        .catch((err) => { if (current === sequence.current) setError(err.message); })
        .finally(() => { if (current === sequence.current) setBusy(false); });
    }, search ? 200 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [field.resource, search, page]);
  const multi = field.type === 'references'; const selected = multi ? value || [] : value;
  return <div className="management-reference"><Input aria-label={'Search ' + field.label + ' choices'} placeholder={'Search ' + field.label.toLowerCase()} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setOptions([]); }} maxLength={120}/><select multiple={multi} aria-label={field.label} required={field.required} value={selected} onChange={(event) => onChange(multi ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value)}>{!multi && <option value="">{field.required ? 'Choose a record' : 'None'}</option>}{(multi ? selected : selected ? [selected] : []).filter((id) => !options.some((item) => item.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}{options.map((item) => <option key={item.id} value={item.id}>{item[config?.title] || item.name || item.title || item.email || item.id} · {item.id.slice(0, 8)}</option>)}</select>{error && <small className="error" role="alert">{error}</small>}<small>{options.length} of {total} matching choices loaded.</small>{options.length < total && <Button type="button" variant="outline" disabled={busy} onClick={() => setPage((current) => current + 1)}>{busy ? 'Loading…' : 'Load more choices'}</Button>}{multi && <small>Select all associated venues.</small>}</div>;
}

function RecordForm({ resource, resources, record, onClose, onSaved }) {
  const fields = record ? resource.editFields : resource.fields;
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.key, initial(field, record)])));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [created, setCreated] = useState(null);
  const emailChanged = Boolean(record && values.email !== record.email);
  const phoneChanged = Boolean(record && (values.phone ?? '') !== (record.phone ?? ''));
  const clearingPhone = phoneChanged && values.phone === '';
  const visibleFields = fields.filter((field) => field.key !== 'confirmEmail' || emailChanged).filter((field) => field.key !== 'confirmPhone' || phoneChanged);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); const input = { reason, ...(record ? { version: record.version ?? 0 } : {}) };
    for (const descriptor of fields) {
      const value = values[descriptor.key];
      if (record && descriptor.key === 'confirmPhone' && clearingPhone) { input.confirmPhone = null; continue; }
      if (record && JSON.stringify(value) === JSON.stringify(initial(descriptor, record))) continue;
      if (value === '' && !descriptor.required) { if (record && (descriptor.key === 'phone' || ['reference', 'datetime-local', 'number', 'textarea'].includes(descriptor.type))) input[descriptor.key] = null; continue; }
      input[descriptor.key] = descriptor.type === 'number' ? Number(value) : descriptor.type === 'datetime-local' ? new Date(value).toISOString() : value;
    }
    try {
      const result = await api('/admin/management/' + resource.key + (record ? '/' + record.id : ''), { method: record ? 'PATCH' : 'POST', body: JSON.stringify(input) });
      if (result.handoff || result.delivery || result.emailVerificationDelivery) setCreated(result); else await onSaved(result);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="dialog management-dialog"><DialogHeader><DialogTitle>{record ? 'Edit ' : 'Create '}{names[resource.key] || resource.label.toLowerCase()}</DialogTitle><DialogDescription>{record ? 'Versioned changes preserve history. Choose valid scopes and provide an audit reason.' : 'Choose valid related records and explain this administrative change.'}</DialogDescription></DialogHeader>{created ? <div className="success"><b>Record saved.</b><p>{created.emailVerificationDelivery ? created.emailVerificationDelivery === 'queued' ? 'New-address verification email is queued, not confirmed delivered. Existing sessions were invalidated.' : 'The email changed and existing sessions were invalidated, but verification email was not sent. Configure email delivery and request verification again.' : created.delivery ? created.delivery === 'queued' ? 'Account setup email is queued, not yet confirmed delivered.' : 'Email was not sent. Use Onboarding invitations to resend after email is configured.' : created.handoff.message}</p>{created.handoff?.url && <label>One-time invitation link<Input readOnly value={created.handoff.url}/></label>}<Button onClick={() => onSaved(created)}>Done</Button></div> : <form onSubmit={submit}><div className="management-form">{visibleFields.map((field) => <label key={field.key}>{field.key === 'confirmPhone' && clearingPhone ? 'Confirm remove phone number' : field.label}{field.required ? ' *' : ''}{['reference', 'references'].includes(field.type) ? <ReferenceInput field={field} value={values[field.key]} onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))} resources={resources}/> : field.key === 'confirmPhone' && clearingPhone ? <input type="checkbox" required checked={Boolean(values.confirmPhone)} onChange={(event) => setValues({ ...values, confirmPhone: event.target.checked })}/> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.checked })}/> : field.type === 'select' ? <select value={values[field.key]} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/> : <Input type={field.type} required={field.required || (field.key === 'confirmEmail' && emailChanged) || (field.key === 'confirmPhone' && phoneChanged)} min={field.type === 'number' ? 0 : undefined} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value, ...(['email', 'phone'].includes(field.key) ? { [field.key === 'email' ? 'confirmEmail' : 'confirmPhone']: '' } : {}) })}/>}</label>)}</div><label className="management-reason">Required audit reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required/></label>{resource.key === 'users' && !record && <p className="guardrail">The recipient confirms their email and chooses their own password. Administrators never set or see it.</p>}{error && <div className="error" role="alert">{error}</div>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : record ? 'Save audited changes' : 'Create record'}</Button></div></form>}</DialogContent></Dialog>;
}

function RecordDialog({ resource, resources, record, onClose, onChanged, startEditing = false }) {
  const [intent, setIntent] = useState(null); const [editing, setEditing] = useState(startEditing); const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [organizationId, setOrganizationId] = useState(''); const [role, setRole] = useState('employee');
  if (editing) return <RecordForm resource={resource} resources={resources} record={record} onClose={() => setEditing(false)} onSaved={onChanged}/>;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const base = '/admin/management/' + resource.key + '/' + record.id;
      const onboarding = resource.key === 'onboarding_invitations';
      const path = onboarding ? '/admin/onboarding/' + record.id + '/' + intent.id : intent.id === 'scoped-role' ? base + '/scoped-role' : base + '/actions/' + intent.id;
      const versioned = onboarding || intent.lifecycle || intent.id === 'scoped-role';
      await api(path, { method: 'POST', body: JSON.stringify({ reason, ...(versioned ? { version: record.version ?? 0 } : {}), ...(intent.id === 'scoped-role' ? { organizationId, role } : {}) }) }); await onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const lifecycleState = record.lifecycleState || 'active';
  const actions = [
    ...resource.actions
      .filter((action) => !action.lifecycle || (
        lifecycleState === 'active' ? ['suspend', 'archive'].includes(action.id)
          : lifecycleState === 'suspended' ? ['restore', 'archive'].includes(action.id)
            : action.id === 'restore'
      ))
      .map((action) => action.lifecycle ? { ...action, label: `${action.id[0].toUpperCase()}${action.id.slice(1)} ${names[resource.key] || resource.label.toLowerCase()}` } : action),
    ...(resource.key === 'users' ? [{ id: 'scoped-role', label: 'Change organization access' }] : []),
    ...(resource.key === 'onboarding_invitations' && !record.acceptedAt && !record.revokedAt ? [{ id: 'resend', label: 'Resend setup email' }, { id: 'revoke', label: 'Revoke setup invitation' }] : []),
  ];
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="dialog management-dialog"><DialogHeader><DialogTitle>{intent ? intent.label : record[resource.title] || resource.label}</DialogTitle><DialogDescription>{record.id}</DialogDescription></DialogHeader>{!intent ? <><h3>Basics and access</h3><dl className="management-details">{Object.entries(record).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{display(value)}</dd></div>)}</dl><p className="guardrail">Records and purchase/admission history are retained. Archive removes active access; restore does not republish cancelled events or issue refunds.</p>{resource.unavailable && <p className="guardrail">{resource.unavailable}</p>}<div className="management-dialog-actions management-main-actions">{resource.canEdit && <Button onClick={() => setEditing(true)}>Edit details</Button>}{actions.filter((action) => !action.lifecycle).map((action) => <Button variant="outline" key={action.id} onClick={() => { setIntent(action); setConfirm(false); }}>{action.label}</Button>)}<Button variant="outline" onClick={onClose}>Close</Button></div>{actions.some((action) => action.lifecycle) && <div className="management-lifecycle-actions"><h4>Lifecycle controls</h4><div>{actions.filter((action) => action.lifecycle).map((action) => <Button variant="outline" key={action.id} onClick={() => { setIntent(action); setConfirm(false); }}>{action.label}</Button>)}</div></div>}</> : <form onSubmit={submit}><p>{intent.id === 'scoped-role' ? 'Choose an organization and role. Changes are audited; prior membership history is retained.' : intent.id === 'cancel' && resource.key === 'events' ? 'Cancel stops sales and retains all history. Refunds are not automatic. Published-event notifications follow the existing outbox workflow.' : 'Confirm this change for the exact record. Suspension and archive block active access; historical records are retained.'}</p>{intent.id === 'scoped-role' && <div className="management-form"><label>Organization<ReferenceInput field={{ resource: 'organizations', label: 'Organization', required: true }} resources={resources} value={organizationId} onChange={setOrganizationId}/></label><label>Scoped role<select value={role} onChange={(event) => setRole(event.target.value)}>{['owner', 'manager', 'employee', 'promoter', 'customer'].map((item) => <option key={item}>{item}</option>)}</select><small>Customer removes this organization's active business grants without deleting membership history or suspending the account.</small></label></div>}<label className="management-reason">Required audit reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required/></label><label className="management-confirm"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} required/>I confirm this action for the record shown above.</label>{error && <div className="error" role="alert">{error}</div>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => { setIntent(null); setError(''); }}>Back</Button><Button disabled={busy || !confirm}>{busy ? 'Applying…' : intent.label}</Button></div></form>}</DialogContent></Dialog>;
}

const listFilterOptions = {
  users: { statuses: ['active', 'disabled', 'suspended', 'archived'], sorts: [['createdAt', 'Joined'], ['displayName', 'Name'], ['email', 'Email']] },
  organizations: { statuses: ['active', 'suspended', 'closed', 'archived'], sorts: [['createdAt', 'Created'], ['name', 'Name'], ['status', 'Status']] },
  events: { statuses: ['draft', 'published', 'cancelled', 'completed', 'suspended', 'archived'], sorts: [['createdAt', 'Created'], ['startsAt', 'Starts'], ['title', 'Title'], ['status', 'Status']] },
  orders: { statuses: ['pending', 'paid', 'cancelled', 'refunded'], sorts: [['createdAt', 'Created'], ['totalCents', 'Total'], ['status', 'Status']] },
  audit: { statuses: [], sorts: [['createdAt', 'Created'], ['action', 'Action']] },
};
function ManagementFilters({ resource, status, onStatus, sort, onSort, direction, onDirection }) {
  const options = listFilterOptions[resource];
  if (!options) return null;
  return <div className="management-list-filters">
    {options.statuses.length > 0 && <label>Status<select aria-label="Filter by status" value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All statuses</option>{options.statuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>}
    <label>Sort by<select aria-label="Sort records by" value={sort} onChange={(event) => onSort(event.target.value)}>{options.sorts.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label>Direction<select aria-label="Sort direction" value={direction} onChange={(event) => onDirection(event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
  </div>;
}

export default function Management({ initialRecord = null }) {
  const [resources, setResources] = useState([]); const [key, setKey] = useState(initialRecord?.kind || 'users'); const [search, setSearch] = useState(initialRecord?.id || ''); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0); const [result, setResult] = useState(null); const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [creating, setCreating] = useState(false); const [onboarding, setOnboarding] = useState(false); const [selected, setSelected] = useState(null); const [initialEdit, setInitialEdit] = useState(Boolean(initialRecord && initialRecord.edit !== false)); const [loadingDetail, setLoadingDetail] = useState(false); const [copiedId, setCopiedId] = useState(null); const sequence = useRef(0); const trigger = useRef(null);
  const [status, setStatus] = useState(''); const [sort, setSort] = useState('createdAt'); const [direction, setDirection] = useState('desc');
  const listRef = useRef(null);
  const movePage = (next) => { setPage(next); requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); };
  useEffect(() => { setStatus(''); setSort('createdAt'); setDirection('desc'); setPage(1); }, [key]);
  const currentResource = useRef(key); currentResource.current = key;
  useEffect(() => {
    if (!initialRecord?.id) return;
    let active = true;
    setLoadingDetail(true);
    api('/admin/management/' + initialRecord.kind + '/' + initialRecord.id)
      .then((detail) => { if (active && currentResource.current === initialRecord.kind) setSelected(detail); })
      .catch((err) => { if (active && currentResource.current === initialRecord.kind) setError(err.message); })
      .finally(() => { if (active) setLoadingDetail(false); });
    return () => { active = false; };
  }, [initialRecord?.kind, initialRecord?.id]);
  useEffect(() => { let active = true; api('/admin/management/resources').then((items) => { if (active) setResources(items); }).catch((err) => { if (active) setError(err.message); }); return () => { active = false; }; }, [refresh]);
  useEffect(() => {
    const current = ++sequence.current; setBusy(true); setError('');
    const timer = setTimeout(() => api('/admin/management/' + key + '?page=' + page + '&pageSize=25&search=' + encodeURIComponent(search) + '&status=' + encodeURIComponent(status) + '&sort=' + encodeURIComponent(sort) + '&direction=' + direction).then((data) => { if (current === sequence.current) setResult({ ...data, resource: key }); }).catch((err) => { if (current === sequence.current) setError(err.message); }).finally(() => { if (current === sequence.current) setBusy(false); }), search ? 250 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [key, search, status, sort, direction, page, refresh]);
  const resource = result && result.resource !== key ? null : resources.find((item) => item.key === key);
  const groupedResources = resourceGroups.map(([title, keys]) => [title, keys.map((id) => resources.find((item) => item.key === id)).filter(Boolean)]).filter(([, items]) => items.length);
  const groupedKeys = new Set(resourceGroups.flatMap(([, keys]) => keys));
  const otherResources = resources.filter((item) => !groupedKeys.has(item.key));
  function close() { setCreating(false); setOnboarding(false); setSelected(null); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus(); }); }
  function changed() { close(); setRefresh((value) => value + 1); }
  async function copyId(id) { try { await navigator.clipboard.writeText(id); setCopiedId(id); } catch { setError('Clipboard access is unavailable. Select the record ID to copy it.'); } }
  async function open(record, element) { trigger.current = element; setInitialEdit(false); setLoadingDetail(true); setError(''); const requested = key; try { const detail = await api('/admin/management/' + requested + '/' + record.id); if (currentResource.current === requested) setSelected(detail); } catch (err) { if (currentResource.current === requested) setError(err.message); } finally { setLoadingDetail(false); } }
  return <section className="management"><div className="management-toolbar"><label>Manage resource<select id="admin-resource" name="resource" value={key} onChange={(event) => { setKey(event.target.value); setPage(1); setSearch(''); setSelected(null); setInitialEdit(false); }}>{groupedResources.map(([title, items]) => <optgroup key={title} label={title}>{items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}{otherResources.length > 0 && <optgroup label="Other records">{otherResources.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>}</select></label><label>Search records<Input id="admin-record-search" name="search" value={search} maxLength={120} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or full record ID"/></label><Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh</Button><div className="management-actions"><Button onClick={(event) => { trigger.current = event.currentTarget; setOnboarding(true); }}>Onboard business or creator</Button>{resource?.canCreate && <Button variant="outline" onClick={(event) => { trigger.current = event.currentTarget; setCreating(true); }}>Create {names[key] || resource.label.toLowerCase()}</Button>}</div></div><ManagementFilters resource={key} status={status} onStatus={(value) => { setStatus(value); setPage(1); }} sort={sort} onSort={(value) => { setSort(value); setPage(1); }} direction={direction} onDirection={(value) => { setDirection(value); setPage(1); }}/>{resource?.unavailable && <p className="guardrail">{resource.unavailable}</p>}{error && <div className="error" role="alert">{error}<Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Retry</Button></div>}{busy ? <div className="empty" role="status">Loading records…</div> : result && resource && <section ref={listRef} className="panel management-panel"><p role="status">{result.total} {search ? 'matching ' : ''}records</p>{result.items.length === 0 ? <div className="empty">{search ? 'No matching records.' : 'No records yet.'}</div> : <div className="management-records">{result.items.map((record) => <article className="management-record" data-testid="admin-record" data-record-id={record.id} key={record.id}><div className="management-record-summary"><h3>{recordHeading(record, resource)}</h3>{recordState(record) && <p className="management-record-state">{recordState(record)}</p>}{recordContext(record) && <p className="management-record-context">{recordContext(record)}</p>}<details className="management-record-meta"><summary>Record details</summary><div><code>{record.id}</code>{record.createdAt && <small>Created {new Date(record.createdAt).toLocaleString()}</small>}<Button type="button" variant="outline" size="sm" onClick={() => copyId(record.id)}>{copiedId === record.id ? 'Copied' : 'Copy ID'}</Button></div></details></div><Button variant="outline" disabled={loadingDetail} onClick={(event) => open(record, event.currentTarget)}>Manage record</Button></article>)}</div>}<div className="management-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => movePage(page - 1)}>Previous</Button><span>Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span><Button variant="outline" disabled={page * result.pageSize >= result.total} onClick={() => movePage(page + 1)}>Next</Button></div></section>}{creating && resource && <RecordForm resource={resource} resources={resources} onClose={close} onSaved={changed}/>} {selected && resource && <RecordDialog resource={resource} resources={resources} record={selected} onClose={close} onChanged={changed} startEditing={initialEdit}/>} {onboarding && <OnboardingForm onClose={close} onSaved={changed}/>}</section>;
}
