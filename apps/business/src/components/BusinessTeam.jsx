import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/business';
import { browserReportTimezone } from '@/lib/report-client';
import { usePagedResource } from '@/hooks/usePagedResource';
import { ServerPager } from './ServerPager';
import { LoadingState } from './LoadingState';
import { ManagerFinancePermission } from './ManagerFinancePermission';
import { CommissionDefaultRate } from './CommissionDefaultRate';
import BusinessVenueWorkspace from './BusinessVenueWorkspace';
import { Choice } from './controls';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { MultiSelect } from './MultiSelect';
import { MobileTableSort } from './MobileTableSort';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const roles = ['Owner', 'Manager', 'Employee', 'Promoter'].map((role) => ({ id: role, label: `${role}s` }));
const sortColumns = [['name', 'Name', 'name_asc', 'name_desc'], ['role', 'Role', 'role_asc', 'role_desc'],
  ['email', 'Email', 'email_asc', 'email_desc'], ['status', 'Status', 'status_asc', 'status_desc'], ['salesCents', 'Referred sales', 'sales_asc', 'sales_desc'],
  ['orders', 'Orders', 'orders_asc', 'orders_desc'], ['customers', 'Customers', 'customers_asc', 'customers_desc']];
const roleValue = (label) => label === 'Manager' ? 'manager' : label === 'Promoter' ? 'affiliate' : 'employee';
const keyFromSort = (sort) => sort.startsWith('sales_') ? 'salesCents' : sort.split('_')[0];

export function BusinessTeam({ session, organizations, onUnauthorized }) {
  const [initial] = useState(readWorkspaceLocation);
  const [organizationId, setOrganizationId] = useState(organizations.some((row) => row.id === initial.teamOrganizationId) ? initial.teamOrganizationId : organizations[0]?.id || '');
  const [search, setSearch] = useState(initial.teamSearch);
  const [selectedRoles, setSelectedRoles] = useState(initial.teamRoles.filter((role) => roles.some((option) => option.id === role)));
  const [sortKey, setSortKey] = useState(keyFromSort(initial.teamSort));
  const [descending, setDescending] = useState(initial.teamSort.endsWith('_desc'));
  const [urlPage, setUrlPage] = useState(initial.teamPage);
  const [pageSize, setPageSize] = useState(initial.teamPageSize);
  const [invitationPage, setInvitationPage] = useState(initial.teamInvitationPage);
  const [invitationPageSize, setInvitationPageSize] = useState(initial.teamInvitationPageSize);
  const [refresh, setRefresh] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteLink, setInviteLink] = useState('');
  const [selected, setSelected] = useState(null);
  const [editRole, setEditRole] = useState('employee');
  const [editingMember, setEditingMember] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rosterRef = useRef(null);
  const invitationRef = useRef(null);
  const organization = organizations.find((item) => item.id === organizationId);
  useEffect(() => { const restore = () => { const state = readWorkspaceLocation();
    setOrganizationId(organizations.some((row) => row.id === state.teamOrganizationId) ? state.teamOrganizationId : organizations[0]?.id || '');
    setSearch(state.teamSearch); setSelectedRoles(state.teamRoles.filter((role) => roles.some((option) => option.id === role)));
    setSortKey(keyFromSort(state.teamSort)); setDescending(state.teamSort.endsWith('_desc')); setUrlPage(state.teamPage);
    setPageSize(state.teamPageSize); setInvitationPage(state.teamInvitationPage); setInvitationPageSize(state.teamInvitationPageSize);
  }; window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, [organizations]);
  const canManage = Boolean(session.user.isInternalAdmin || organization?.canManage);
  const sortColumn = sortColumns.find(([key]) => key === sortKey);
  const sort = sortColumn[descending ? 3 : 2];
  const query = useMemo(() => { const params = new URLSearchParams({ search, sort, timezone: browserReportTimezone() });
    selectedRoles.forEach((role) => params.append('roles', role)); return params.toString(); }, [search, selectedRoles, sort]);
  const chooseSort = (key, down) => { setSortKey(key); setDescending(down); setUrlPage(1);
    const column = sortColumns.find(([value]) => value === key);
    writeWorkspaceLocation({ teamSort: column[down ? 3 : 2], teamPage: 1 }); };
  const changeSort = (key) => chooseSort(key, sortKey === key ? !descending : ['salesCents', 'orders', 'customers'].includes(key));
  const chooseRoles = (next) => { setSelectedRoles(next); setUrlPage(1); writeWorkspaceLocation({ teamRoles: next, teamPage: 1 }); };
  const chooseSearch = (next) => { setSearch(next); setUrlPage(1);
    writeWorkspaceLocation({ teamSearch: next, teamPage: 1 }, { replace: true }); };
  const roster = usePagedResource(canManage && organizationId ? `/business/organizations/${organizationId}/team-page?${query}` : null, session,
    { pageSize, initialPage: urlPage, onPageChange: (value) => { setUrlPage(value); writeWorkspaceLocation({ teamPage: value }); },
      refreshToken: refresh, onUnauthorized });
  const invites = usePagedResource(canManage && organizationId ? `/business/organizations/${organizationId}/invitations-page` : null, session,
    { pageSize: invitationPageSize, initialPage: invitationPage, onPageChange: (value) => { setInvitationPage(value); writeWorkspaceLocation({ teamInvitationPage: value }); },
      refreshToken: refresh, onUnauthorized });
  const refreshAll = () => setRefresh((value) => value + 1);
  useEffect(() => { if (roster.loading) return; setSelected((member) => member ? roster.result?.items.find((row) => row.id === member.id) || member : null); }, [roster.result, roster.loading]);
  async function mutate(path, options, after) {
    setBusy(true); setError('');
    try { const result = await api(path, session, options); await after?.(result); refreshAll(); return result; }
    catch (err) { if (err.status === 401) onUnauthorized(); else setError(err.message); return null; }
    finally { setBusy(false); }
  }
  async function invite(event) {
    event.preventDefault(); setInviteLink('');
    await mutate(`/business/organizations/${organizationId}/invitations`, { method: 'POST', body: JSON.stringify({ email: inviteEmail, phone: invitePhone, role: inviteRole }) },
      (result) => { setInviteLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}`); setInviteEmail(''); setInvitePhone(''); });
  }
  async function saveRole() {
    if (!selected || selected.role === 'Owner' || selected.id === session.user.id) return;
    await mutate(`/business/organizations/${organizationId}/team/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ role: editRole }) }, () => setSelected(null));
  }
  async function removeMember() {
    if (!selected || selected.role === 'Owner' || selected.id === session.user.id) return;
    await mutate(`/business/organizations/${organizationId}/team/${selected.id}`, { method: 'DELETE' }, () => { setSelected(null); setConfirmRemove(false); });
  }
  if (!organizations.length) return <div className="panel">Team invitations are available to organization owners and managers.</div>;
  return <div className="team-page">
    {organizations.length > 1 && <label>Organization<select value={organizationId} onChange={(event) => { const id = event.target.value;
      setOrganizationId(id); setSelected(null); setInviteLink(''); setUrlPage(1); setInvitationPage(1);
      writeWorkspaceLocation({ teamOrganizationId: id, teamPage: 1, teamInvitationPage: 1 }); }}>{organizations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    {canManage && <><section className="panel team-invite-summary"><div><span className="eyebrow">TEAM ACCESS</span><h2>Build your team</h2><p>Invite managers, employees and promoters into this organization.</p></div><Button onClick={() => { setError(''); setInviteOpen(true); }}>Invite team member</Button></section>
    <section ref={rosterRef} className="panel team-roster" aria-busy={roster.loading}><h2>Current team</h2><p className="team-caption">Showing referred paid sales from the last 30 days. Click a member for details.</p>
        <div className="team-roster-filters"><MultiSelect label="Roles" options={roles} selected={selectedRoles} onChange={chooseRoles}/></div>
      <MobileTableSort columns={sortColumns.map(([key, label]) => ({ key, label }))} value={sortKey} descending={descending}
        onChange={(key) => chooseSort(key, ['salesCents', 'orders', 'customers'].includes(key))}
        onToggle={() => chooseSort(sortKey, !descending)}/>
      <div className="table-search"><div className="search-field"><Search size={16}/><Input aria-label="Search team" placeholder="Search" value={search} onChange={(event) => chooseSearch(event.target.value)}/></div></div>
      {roster.loading && <LoadingState>{roster.result ? 'Updating team…' : 'Loading team…'}</LoadingState>}
      {roster.error && <div className="error" role="alert">{roster.error}<Button variant="outline" onClick={roster.retry}>Try again</Button></div>}
      {roster.result && <><div className="table-wrap responsive-event-table"><table><thead><tr>{sortColumns.map(([key, label]) => <th scope="col" key={key}><button type="button" className="table-sort" onClick={() => changeSort(key)}>{label}{sortKey === key ? descending ? ' ↓' : ' ↑' : ' ↕'}</button></th>)}</tr></thead>
        <tbody>{roster.result.items.map((member) => <tr key={member.id}><td data-label="Name"><button type="button" className="team-member-link" aria-label={`View ${member.name} details`} onClick={() => { setSelected(member); setEditingMember(false); setEditRole(roleValue(member.role)); setError(''); }}>{member.name}</button></td><td data-label="Role">{member.role}</td><td data-label="Email">{member.email}</td><td data-label="Status">{member.status}</td><td data-label="Referred sales">{money(member.salesCents)}</td><td data-label="Orders">{member.orders}</td><td data-label="Customers">{member.customers}</td></tr>)}</tbody></table></div>
        {!roster.result.items.length && <p className="empty-inline">No team members match this view.</p>}
        <ServerPager result={roster.result} page={roster.page} onPageChange={roster.setPage} disabled={roster.loading} label="team members" targetRef={rosterRef}
          alwaysVisible onPageSizeChange={(size) => { setPageSize(size); setUrlPage(1); writeWorkspaceLocation({ teamPageSize: size, teamPage: 1 }); }}/></>}
    </section>
    <section ref={invitationRef} className="panel team-pending"><h2>Pending invitations</h2>
      {invites.loading && <LoadingState>Loading invitations…</LoadingState>}
      {invites.error && <div className="error" role="alert">{invites.error}<Button variant="outline" onClick={invites.retry}>Try again</Button></div>}
      {invites.result && <>{invites.result.items.length ? <ul>{invites.result.items.map((invitation) => <li key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></span><div><Button size="sm" variant="outline" disabled={busy} onClick={() => mutate(`/business/organizations/${organizationId}/invitations/${invitation.id}/resend`, { method: 'POST' }, (result) => { setInviteLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}`); setInviteOpen(true); })}>Resend</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Delete the invitation for ${invitation.email}? Its private link will stop working.`)) mutate(`/business/organizations/${organizationId}/invitations/${invitation.id}`, { method: 'DELETE' }); }}>Delete</Button></div></li>)}</ul> : <p>No pending invitations.</p>}
        <ServerPager result={invites.result} page={invites.page} onPageChange={invites.setPage} disabled={invites.loading} label="invitations" targetRef={invitationRef}
          alwaysVisible onPageSizeChange={(size) => { setInvitationPageSize(size); setInvitationPage(1); writeWorkspaceLocation({ teamInvitationPageSize: size, teamInvitationPage: 1 }); }}/></>}
      <small>Resend renews the private link and queues email only when delivery is configured. A copyable link remains available.</small></section>
    {error && <p role="alert" className="error">{error}</p>}
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent className="team-invite-dialog"><DialogHeader><DialogTitle>Invite a team member</DialogTitle><DialogDescription>Send a seven-day private invitation. Existing users sign in; new users create an account.</DialogDescription></DialogHeader>
      <form className="team-invite-form" onSubmit={invite}><label>Email<Input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)}/></label><label>Phone (optional)<Input type="tel" maxLength={32} value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)}/></label>
        <Choice label="Role" value={inviteRole} onChange={setInviteRole} options={[...(canManage ? [['manager', 'Manager']] : []), ['employee', 'Employee'], ['affiliate', 'Promoter']]}/><Button disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</Button></form>
      {inviteLink && <div className="team-link"><Input readOnly value={inviteLink} aria-label="Invitation link" onFocus={(event) => event.target.select()}/><Button variant="outline" onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy link</Button></div>}
      {error && <p role="alert" className="error">{error}</p>}<DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) { setSelected(null); setConfirmRemove(false); } }}>
      {selected && <DialogContent className="team-member-dialog sm:max-w-xl"><DialogHeader><span className="eyebrow">TEAM MEMBER</span><DialogTitle>{selected.name}</DialogTitle><DialogDescription>{selected.email} · {selected.role}</DialogDescription></DialogHeader>
        <div className="team-detail-metrics"><span><small>Status</small><strong>{selected.status}</strong></span><span><small>Joined</small><strong>{selected.joined ? new Date(selected.joined).toLocaleDateString() : '—'}</strong></span><span><small>Referred sales</small><strong>{money(selected.salesCents)}</strong></span><span><small>Orders</small><strong>{selected.orders}</strong></span><span><small>Customers</small><strong>{selected.customers}</strong></span><span><small>Commission</small><strong>{money(selected.commissionCents)}</strong></span></div>
        {canManage && selected.role !== 'Owner' && selected.id !== session.user.id && !editingMember && <div className="team-role-editor"><Button variant="outline" onClick={() => setEditingMember(true)}>Edit member</Button></div>}
        {canManage && selected.role !== 'Owner' && selected.id !== session.user.id && editingMember && <div className="team-role-editor team-role-editor-open"><div className="team-role-field"><span>Role</span><Choice label="Team member role" value={editRole} onChange={setEditRole} options={[["manager", "Manager"], ["employee", "Employee"], ["affiliate", "Promoter"]]}/></div>
          <div className="team-role-edit-actions"><div className="team-role-edit-primary"><Button disabled={busy || editRole === roleValue(selected.role)} onClick={saveRole}>{busy ? 'Saving…' : 'Save role'}</Button><Button variant="outline" disabled={busy} onClick={() => { setEditRole(roleValue(selected.role)); setEditingMember(false); setError(''); }}>Cancel</Button></div><div className="team-role-edit-danger"><Button variant="destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove member</Button></div></div></div>}
        {selected.role === 'Owner' && <p className="hint">Ownership cannot be changed here.</p>}
        <ManagerFinancePermission organizationId={organizationId} member={selected} canGrantFinance={roster.result?.canGrantFinance}
          organizationVersion={roster.result?.organizationVersion} session={session} disabled={busy || roster.loading} onUnauthorized={onUnauthorized}
          onRefresh={refreshAll} onSaved={refreshAll}/>
        <CommissionDefaultRate key={selected.id} organizationId={organizationId} member={selected} session={session} canEdit={Boolean(roster.result?.canManageCommissionDefaults)} onSaved={refreshAll} />
        {error && <p role="alert" className="error">{error}</p>}<DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter></DialogContent>}
    </Dialog>
    <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}><DialogContent><DialogHeader><DialogTitle>Remove this member?</DialogTitle><DialogDescription>{selected?.name} will lose organization access. Event-only promoter assignments remain separate.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="destructive" disabled={busy} onClick={removeMember}>Confirm removal</Button><Button variant="outline" onClick={() => setConfirmRemove(false)}>Keep member</Button></DialogFooter></DialogContent></Dialog>
    </>}
    {organization && <BusinessVenueWorkspace key={organization.id} session={session} business={organization} onUnauthorized={onUnauthorized}/>}
  </div>;
}
