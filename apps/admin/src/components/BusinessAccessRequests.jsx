import { useState } from 'react';
import { api, readSession } from '../lib/api';
import { hasAdminPermission } from '../lib/permissions';
import { accessRequestStatuses, requestFilters, requestListQuery, requestStatusCopy } from '../lib/business-access-requests';
import { useAdminResource } from '../hooks/useAdminResource';
import { formatDate } from '../lib/admin';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ResourceState, Pager } from './ResourceState';
import PageHeader from './PageHeader';
import OnboardingForm from './OnboardingForm';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';
import { MultiSelect } from '../../../business/src/components/MultiSelect';

const label = (value) => value ? value[0].toUpperCase() + value.slice(1) : 'Unavailable';

export function DeclineAccessRequest({ request, onClose, onSaved }) {
  const [reason, setReason] = useState(''); const [version, setVersion] = useState(request.version);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [stale, setStale] = useState(false); const [reviewed, setReviewed] = useState(false); const [note, setNote] = useState('');
  async function submit(event) {
    event.preventDefault(); if (busy || stale || reviewed || reason.trim().length < 3) return;
    setBusy(true); setError('');
    try { const result = await api(`/admin/business-access/requests/${encodeURIComponent(request.id)}/decline`, { method: 'POST', body: JSON.stringify({ version, reason: reason.trim() }) }); onSaved(result.request); }
    catch (err) { setError(err.message); if (err.status === 409) setStale(true); } finally { setBusy(false); }
  }
  async function refreshVersion() {
    setBusy(true); setError('');
    try {
      const latest = await api(`/admin/business-access/requests/${encodeURIComponent(request.id)}`);
      if (latest.status !== 'pending') { setReviewed(true); setNote('This request has already been reviewed. Your reason is retained; close this form to view the current request.'); }
      else { setVersion(latest.version); setStale(false); setNote('Request version refreshed. Your reason is retained. Review the current request before choosing to decline.'); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="dialog management-dialog business-access-decline"><DialogHeader><DialogTitle>Decline access request</DialogTitle><DialogDescription>This closes {request.businessName}’s request without granting access or queuing a setup email.</DialogDescription></DialogHeader><form onSubmit={submit}><p>{request.displayName} · {request.email}</p><label htmlFor="access-decline-reason">Required audit reason<textarea id="access-decline-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>{error && <p className="error" role="alert">{error}</p>}{note && <p className="notice" role="status">{note}</p>}{stale && !reviewed && <div className="notice"><p>Your reason is retained. Refresh before continuing; no decline is retried automatically.</p><Button type="button" variant="outline" disabled={busy} onClick={refreshVersion}>Refresh request version</Button></div>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || stale || reviewed || reason.trim().length < 3}>{busy ? 'Declining…' : 'Decline request'}</Button></div></form></DialogContent></Dialog>;
}

function RequestDetail({ request, canReview, onApprove, onDecline, onOpenRecord }) {
  const separate = request.purpose === 'new_organization';
  return <section className="panel management-panel access-request-detail" aria-label="Access request details">
    <div className="record-heading"><div><p className="eyebrow">{separate ? 'NEW ORGANIZATION REQUEST' : 'BUSINESS ACCESS REQUEST'}</p><h2>{request.businessName}</h2><p className="management-record-state">{label(request.status)} · Submitted {formatDate(request.createdAt, true)}</p></div>
      {request.status === 'pending' && canReview && <div className="record-actions"><Button onClick={onApprove}>Review for approval</Button><Button variant="outline" onClick={onDecline}>Decline request</Button></div>}
    </div>
    <p className="notice">{requestStatusCopy(request.status)}</p>
    {separate && <p className="notice">An existing Nitewide account is requesting a separate organization. Approval and acceptance add access only to the new organization; all other memberships and permissions stay unchanged.</p>}
    {request.status === 'pending' && !canReview && <p className="record-muted">Your staff role can read requests. Only authorized platform administrators can approve or decline them.</p>}
    <dl className="record-basics"><div><dt>Contact name</dt><dd>{request.displayName}</dd></div><div><dt>Submitted email</dt><dd>{request.email}</dd></div><div><dt>Contact phone</dt><dd>{request.phone}</dd></div><div><dt>Requested initial role</dt><dd>{label(request.role)}</dd></div>
      <div><dt>Applicant authority confirmation</dt><dd>{request.confirmedAuthorityAt ? `Confirmed ${formatDate(request.confirmedAuthorityAt, true)}` : 'Not recorded on this historical request'}</dd></div>
    </dl>
    <section className="access-request-submitted"><h3>Submitted business details</h3><p>{request.details}</p></section>
    {request.reviewedAt && <section className="access-request-review"><h3>Review history</h3><p>{label(request.status)} {formatDate(request.reviewedAt, true)}</p><p className="record-muted">Audit reason</p><p>{request.reviewReason}</p>{request.organizationId && <Button variant="outline" onClick={() => onOpenRecord('organizations', request.organizationId)}>View business workspace</Button>}{request.onboardingInvitationId && <Button variant="outline" onClick={() => onOpenRecord('onboarding_invitations', request.onboardingInvitationId)}>View setup invitation</Button>}</section>}
    <details className="management-record-meta"><summary>Identifiers & history</summary><div><span>Request ID <code>{request.id}</code></span><span>Version {request.version}</span>{request.requesterUserId && <span>Applicant account <code>{request.requesterUserId}</code></span>}{request.reviewedByUserId && <span>Reviewed by <code>{request.reviewedByUserId}</code></span>}<small>Updated {formatDate(request.updatedAt, true)}</small></div></details>
  </section>;
}

export default function BusinessAccessRequests({ params, onUpdate, onOpenRecord, businessTabs, session }) {
  const [refresh, setRefresh] = useState(0); const [approval, setApproval] = useState(null); const [decline, setDecline] = useState(null); const [notice, setNotice] = useState('');
  const user = (session || readSession())?.user;
  const canRead = hasAdminPermission(user, 'directory.view'); const canReview = hasAdminPermission(user, 'access.manage');
  const id = params.get('request'); const filters = requestFilters(params);
  const result = useAdminResource(canRead ? id ? `/admin/business-access/requests/${encodeURIComponent(id)}` : `/admin/business-access/requests?${requestListQuery(params)}` : null, refresh);
  const reload = () => setRefresh((value) => value + 1);
  const change = (values) => { setNotice(''); onUpdate({ ...values, requestPage: 1, request: null }); };
  const closeApproval = () => { setApproval(null); reload(); };
  const closeDecline = () => { setDecline(null); reload(); };
  return <section className="management business-access-requests"><PageHeader title="Businesses" description="Review access requests, then prepare secure onboarding for approved businesses."><Button variant="outline" onClick={reload}>Refresh</Button></PageHeader>{businessTabs}{!canRead ? <p className="error" role="alert">Your staff role cannot read business access requests.</p> : <>{id ? <Button variant="ghost" className="record-back" onClick={() => { setNotice(''); onUpdate({ request: null }, false); }}>Back to access requests</Button> : <><div className="management-toolbar access-request-toolbar"><MultiSelect label="Request status" options={accessRequestStatuses.map((value) => ({ id: value, label: label(value) }))} selected={filters.statuses} onChange={(next) => change({ requestStatuses: next.length ? next : ['all'] })}/><SubmittedSearch id="admin-access-request-search" label="Search access requests" value={filters.search} onSearch={(search) => change({ requestSearch: search })} placeholder="Search" icon hideLabel description="Search by contact name, email, phone or business name."/></div><p className="record-muted">Oldest submissions first. Pending requests are shown by default. Approval queues setup; it does not grant active access.</p></>}{notice && <p className="notice" role="status">{notice}</p>}<ResourceState loading={result.loading} error={result.error} onRetry={reload}>{result.data && (id ? <RequestDetail request={result.data} canReview={canReview} onApprove={() => setApproval(result.data)} onDecline={() => setDecline(result.data)} onOpenRecord={onOpenRecord}/> : <section className="panel management-panel"><p role="status">{result.data.total} {result.data.total === 1 ? 'access request' : 'access requests'}</p>{result.data.items.length ? <div className="management-records">{result.data.items.map((request) => <article className="management-record" key={request.id} data-testid="access-request" data-request-id={request.id}><div className="management-record-summary"><h2>{request.businessName}</h2><p className="management-record-state">{label(request.status)} · {label(request.role)} requested</p><p className="management-record-context">{request.displayName} · {request.email}</p><small>Submitted {formatDate(request.createdAt, true)}</small><details className="management-record-meta"><summary>Request identifier</summary><code>{request.id}</code></details></div><Button variant="outline" onClick={() => { setNotice(''); onUpdate({ request: request.id }, false); }}>Review request</Button></article>)}</div> : <div className="empty">No matching access requests.</div>}<Pager result={result.data} onPage={(page) => onUpdate({ requestPage: page }, false)}/></section>)}</ResourceState></>}{approval && canReview && <OnboardingForm key={approval.id} accessRequest={approval} onClose={closeApproval} onSaved={() => { setApproval(null); setNotice('Request approved for onboarding. Setup email is queued, not confirmed delivered. Active access requires secure recipient acceptance.'); reload(); }}/>} {decline && canReview && <DeclineAccessRequest key={decline.id} request={decline} onClose={closeDecline} onSaved={() => { setDecline(null); setNotice('Request declined. No access was granted and no setup email was queued.'); reload(); }}/>}</section>;
}
