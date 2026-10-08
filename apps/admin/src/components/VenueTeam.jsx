import { useState } from 'react';
import { api } from '../lib/api';
import { hasAdminPermission } from '../lib/permissions';
import { useAdminResource } from '../hooks/useAdminResource';
import PersonPicker from '../../../business/src/components/venue-workspace/PersonPicker';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';
import { ResourceState, Pager } from './ResourceState';
import { Button } from '../../../business/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../business/src/components/ui/dialog';

function AssignmentForm({ venue, record, onClose, onSaved, request, basePath, audience, canGrantManager }) {
  const [userId, setUserId] = useState(record?.userId || ''); const [role, setRole] = useState(record?.role || 'employee'); const [status, setStatus] = useState(record?.status || 'active');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request(`${basePath}/${venue.organizationId}/venues/${venue.id}/team/${userId}`, { method: 'PUT', body: JSON.stringify({ role, status, reason, version: record?.version ?? null }) }); onSaved(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="venue-dialog management-dialog"><DialogHeader><DialogTitle>{record ? 'Update venue access' : 'Add venue team member'}</DialogTitle><DialogDescription>Access applies only to {venue.name}. It does not grant organization-wide access, ownership or finance permission.</DialogDescription></DialogHeader>
    <form onSubmit={submit}><div className="management-form">{record ? <p className="notice">{record.displayName} · {record.email}</p> : <div><span className="field-label">Person</span><PersonPicker request={request} path={`${basePath}/${venue.organizationId}/venues/${venue.id}/candidates`} value={userId} onChange={setUserId} audience={audience}/></div>}<label htmlFor="venue-team-role">Venue role<select id="venue-team-role" value={role} onChange={(event) => setRole(event.target.value)}>{canGrantManager && <option value="manager">Manager</option>}<option value="employee">Employee</option><option value="promoter">Promoter</option></select></label>{record && <label htmlFor="venue-team-status">Venue access<select id="venue-team-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="inactive">Inactive — remove access, retain history</option></select></label>}</div>
      <label className="management-reason" htmlFor="venue-team-reason">Required audit reason<textarea id="venue-team-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label><p className="notice">Historical admissions, referrals and purchases are retained when access changes.</p>{error && <p className="error" role="alert">{error}</p>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !userId}>{busy ? 'Saving…' : record ? 'Save venue access' : 'Add team member'}</Button></div>
    </form></DialogContent></Dialog>;
}

export default function VenueTeam({ venue, params, onUpdate, onOpenRecord, session, request = api, basePath = '/admin/businesses', audience = 'admin' }) {
  const [refresh, setRefresh] = useState(0); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState(null);
  const query = new URLSearchParams({ page: params.get('venueTeamPage') || '1', pageSize: '25', search: params.get('venueTeamSearch') || '' });
  const state = useAdminResource(`${basePath}/${venue.organizationId}/venues/${venue.id}/team?${query}`, refresh, request);
  const canWrite = audience === 'admin' ? hasAdminPermission(session.user, 'access.manage') && state.data?.canManage !== false : Boolean(state.data?.canManage);
  const canGrantManager = audience === 'admin' ? canWrite : Boolean(state.data?.canGrantManager);
  const changed = () => { setCreating(false); setEditing(null); setRefresh((value) => value + 1); };
  return <section className="venue-workspace" aria-label="Venue team"><div className="record-heading"><div><h3>Venue team</h3><p className="notice">Venue-scoped managers, employees and promoters. Business owners and organization-wide roles remain separate.</p></div>{canWrite && <Button onClick={() => setCreating(true)}>Add venue team member</Button>}</div>
    <div className="management-toolbar"><SubmittedSearch id="venue-team-search" label="Search venue team" value={params.get('venueTeamSearch') || ''} resetToken={venue.id} onSearch={(venueTeamSearch) => onUpdate({ venueTeamSearch, venueTeamPage: 1 })}/><Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Refresh team</Button></div>
    <ResourceState {...state} onRetry={() => setRefresh((value) => value + 1)}>{state.data && <><p role="status">{state.data.total} team assignments match these filters.</p>{state.data.items.length ? state.data.items.map((member) => <article className="management-record" key={member.id} data-testid="venue-team-member"><div><h4>{member.displayName}</h4><p className="notice">{member.email}</p><small>{member.role} · {member.status}</small></div><div className="record-actions">{onOpenRecord && <Button variant="outline" onClick={() => onOpenRecord('users', member.userId, { preserveParent: true })}>View person</Button>}{canWrite && (member.role !== 'manager' || canGrantManager) && <Button variant="outline" onClick={() => setEditing(member)}>Update venue access</Button>}</div></article>) : <p className="empty">No venue team assignments match these filters.</p>}<Pager result={state.data} onPage={(page) => onUpdate({ venueTeamPage: page }, false)}/></>}</ResourceState>
    {(creating || editing) && <AssignmentForm venue={venue} record={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={changed} request={request} basePath={basePath} audience={audience} canGrantManager={canGrantManager}/>}
  </section>;
}
