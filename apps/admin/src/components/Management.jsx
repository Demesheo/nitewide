import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import '../management.css';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';

const names = { users: 'person', organizations: 'business', locations: 'venue', events: 'event', offerings: 'ticket or package', owners: 'owner assignment', employees: 'business employment', organization_affiliates: 'business promoter', event_affiliates: 'event promoter', boosts: 'boost', notifications: 'notification', guestlist: 'guestlist request', guestlist_invitations: 'guestlist invitation', team_invitations: 'team invitation' };
const localDate = (value) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const initial = (field, record) => record ? field.type === 'datetime-local' ? localDate(record[field.key]) : record[field.key] ?? (field.type === 'checkbox' ? false : field.type === 'references' ? [] : '') : field.type === 'checkbox' ? false : field.type === 'references' ? [] : field.type === 'select' ? field.key === 'internalAdminRole' ? 'support' : field.options[0] : ({ entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 10, guestlistCapacity: 0, priceCents: 0, partySize: 1, commissionBps: 0, defaultCommissionBps: 0, defaultGuestlistAllocation: 0, budgetCents: 0, countryCode: 'US', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, currency: 'USD', category: 'other' }[field.key] ?? '');

export function ReferenceInput({ field, value, onChange, resources }) {
  const fallbackId = useId();
  const fieldId = field.key ? 'record-' + field.key : 'reference-' + fallbackId;
  const [search, setSearch] = useState(''); const [options, setOptions] = useState([]); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const sequence = useRef(0);
  const config = resources.find((item) => item.key === field.resource);
  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(() => {
      setBusy(true);
      api('/admin/management/' + field.resource + '?page=' + page + '&pageSize=25&search=' + encodeURIComponent(search))
        .then((result) => { if (current === sequence.current) { setOptions(result.items); setTotal(result.total); setError(''); } })
        .catch((err) => { if (current === sequence.current) setError(err.message); })
        .finally(() => { if (current === sequence.current) setBusy(false); });
    }, search ? 200 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [field.resource, search, page]);
  const multi = field.type === 'references'; const selected = multi ? value || [] : value;
  return <div className="management-reference"><SubmittedSearch id={fieldId + '-search'} label={'Search ' + field.label + ' choices'} value={search} placeholder={'Search ' + field.label.toLowerCase()} onSearch={(value) => { setSearch(value); setPage(1); }}/><select id={fieldId} multiple={multi} aria-label={field.label} required={field.required} value={selected} onChange={(event) => onChange(multi ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value)}>{!multi && <option value="">{field.required ? 'Choose a record' : 'None'}</option>}{(multi ? selected : selected ? [selected] : []).filter((id) => !options.some((item) => item.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}{options.map((item) => <option key={item.id} value={item.id}>{item[config?.title] || item.name || item.title || item.email || item.id} · {item.id.slice(0, 8)}</option>)}</select>{error && <small className="error" role="alert">{error}</small>}<div className="venue-picker-pager"><Button type="button" variant="outline" disabled={busy || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous choices</Button><small>{total} matches · Page {page}</small><Button type="button" variant="outline" disabled={busy || page * 25 >= total} onClick={() => setPage((current) => current + 1)}>Next choices</Button></div>{multi && <small>Select the venues linked to this business. Leave the selection empty if it has none.</small>}</div>;
}

export function RecordForm({ resource, resources, record, initialValues = {}, lockedFields = [], onClose, onSaved }) {
  const fields = (record ? resource.editFields : resource.fields).filter((field) => field.key !== 'slug' && !(resource.key === 'organizations' && ['locationId', 'venueIds', 'businessType', 'independentCreator'].includes(field.key)));
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.key, initialValues[field.key] ?? initial(field, record)])));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [created, setCreated] = useState(null);
  const emailChanged = Boolean(record && values.email !== record.email);
  const phoneChanged = Boolean(record && (values.phone ?? '') !== (record.phone ?? ''));
  const clearingPhone = phoneChanged && values.phone === '';
  const visibleFields = fields.filter((field) => !lockedFields.includes(field.key)).filter((field) => field.key !== 'internalAdminRole' || values.isInternalAdmin).filter((field) => field.key !== 'confirmEmail' || emailChanged).filter((field) => field.key !== 'confirmPhone' || phoneChanged);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); const input = { reason, ...(record ? { version: record.version ?? 0 } : {}) };
    for (const descriptor of fields) {
      if (descriptor.key === 'internalAdminRole' && !values.isInternalAdmin) continue;
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
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="dialog management-dialog"><DialogHeader><DialogTitle>{record ? 'Edit ' : 'Create '}{names[resource.key] || resource.label.toLowerCase()}</DialogTitle><DialogDescription>{record ? 'Versioned changes preserve history. Choose valid scopes and provide an audit reason.' : 'Choose valid related records and explain this administrative change.'}</DialogDescription></DialogHeader>{created ? <div className="success"><b>Record saved.</b><p>{created.emailVerificationDelivery ? created.emailVerificationDelivery === 'queued' ? 'New-address verification email is queued, not confirmed delivered. Existing sessions were invalidated.' : 'The email changed and existing sessions were invalidated, but verification email was not sent. Configure email delivery and request verification again.' : created.delivery ? created.delivery === 'queued' ? 'Account setup email is queued, not yet confirmed delivered.' : 'Email was not sent. Use Onboarding invitations to resend after email is configured.' : created.handoff.message}</p>{created.handoff?.url && <label>One-time invitation link<Input readOnly value={created.handoff.url}/></label>}<Button onClick={() => onSaved(created)}>Done</Button></div> : <form onSubmit={submit}><div className="management-form">{visibleFields.map((field) => <label htmlFor={'record-' + field.key} key={field.key}>{field.key === 'confirmPhone' && clearingPhone ? 'Confirm remove phone number' : field.label}{field.required ? <span aria-hidden="true"> *</span> : ''}{['reference', 'references'].includes(field.type) ? <ReferenceInput field={field} value={values[field.key]} onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))} resources={resources}/> : field.key === 'confirmPhone' && clearingPhone ? <input id={'record-' + field.key} type="checkbox" required checked={Boolean(values.confirmPhone)} onChange={(event) => setValues({ ...values, confirmPhone: event.target.checked })}/> : field.type === 'checkbox' ? <input id={'record-' + field.key} type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.checked })}/> : field.type === 'select' ? <select id={'record-' + field.key} value={values[field.key]} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea id={'record-' + field.key} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/> : <Input id={'record-' + field.key} type={field.type} minLength={field.minLength} maxLength={field.maxLength} required={field.required || (field.key === 'confirmEmail' && emailChanged) || (field.key === 'confirmPhone' && phoneChanged)} min={field.type === 'number' ? 0 : undefined} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value, ...(['email', 'phone'].includes(field.key) ? { [field.key === 'email' ? 'confirmEmail' : 'confirmPhone']: '' } : {}) })}/>}</label>)}</div><label className="management-reason">Required audit reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required/></label>{resource.key === 'users' && !record && <p className="guardrail">The recipient confirms their email and chooses their own password. Administrators never set or see it.</p>}{error && <div className="error" role="alert">{error}</div>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : record ? 'Save audited changes' : 'Create record'}</Button></div></form>}</DialogContent></Dialog>;
}
