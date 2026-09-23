import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { money } from '@/lib/business';
import { MobileTableSort } from './MobileTableSort';
import { MultiSelect } from './MultiSelect';
import { searchRows } from '@/lib/table-search';
import { Choice } from './controls';
import { LoadingState } from './LoadingState';

const teamColumns = [['name', 'Name'], ['role', 'Role'], ['email', 'Email'], ['status', 'Status'], ['salesCents', 'Referred sales'], ['orders', 'Orders'], ['customers', 'Customers']].map(([key, label]) => ({ key, label }));

const roleLabel = (role) => role === 'affiliate' ? 'promoter' : role;

export function Team({ session, organizations, onUnauthorized }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '');
  const [roster, setRoster] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef(null);
  const [editRole, setEditRole] = useState('employee');
  const [editingMember, setEditingMember] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [memberRemoving, setMemberRemoving] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState('');
  const memberTriggerRef = useRef(null);
  const [sortKey, setSortKey] = useState('name');
  const [descending, setDescending] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('employee');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const currentOrganization = organizations.find((org) => org.id === organizationId);
  const canInviteManager = Boolean(session.user.isInternalAdmin || currentOrganization?.canInviteManager || currentOrganization?.canManage);
  const canManageTeam = Boolean(session.user.isInternalAdmin || currentOrganization?.canManage);
  useEffect(() => {
    if (!organizations.some((org) => org.id === organizationId)) setOrganizationId(organizations[0]?.id || '');
  }, [organizations, organizationId]);
  useEffect(() => { if (!canInviteManager && role === 'manager') setRole('employee'); }, [canInviteManager, role]);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    setLoading(true);
    setRoster(null);
    Promise.all([
      api(`/business/organizations/${organizationId}/team`, session, { signal: controller.signal }),
      api(`/business/analytics?days=30&organizationIds=${organizationId}`, session, { signal: controller.signal }),
    ]).then(([team, report]) => { setRoster(team); setAnalytics(report); setSelectedMember(null); })
      .catch((err) => { if (err.status === 401) onUnauthorized(); else if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, session, onUnauthorized]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setLink('');
    try {
      const result = await api(`/business/organizations/${organizationId}/invitations`, session, { method: 'POST', body: JSON.stringify({ email, phone, role }) });
      setLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}`);
      setEmail('');
      setPhone('');
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function revoke(invitation) {
    if (!window.confirm(`Delete the invitation for ${invitation.email}? The current link will stop working.`)) return;
    setError('');
    try {
      await api(`/business/organizations/${organizationId}/invitations/${invitation.id}`, session, { method: 'DELETE' });
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
    } catch (err) { setError(err.message); }
  }
  async function resend(invitation) {
    setError('');
    try {
      const renewed = await api(`/business/organizations/${organizationId}/invitations/${invitation.id}/resend`, session, { method: 'POST' });
      const url = `${window.location.origin}/?invite=${encodeURIComponent(renewed.token)}`;
      setLink(url);
      setInviteOpen(true);
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
      window.location.href = `mailto:${encodeURIComponent(renewed.email)}?subject=${encodeURIComponent(`Invitation to ${renewed.organizationName} on Nitewide`)}&body=${encodeURIComponent(`Join ${renewed.organizationName} as ${roleLabel(renewed.role)} using this private link:\n\n${url}\n\nThis link expires in seven days.`)}`;
    } catch (err) { setError(err.message); }
  }
  async function saveRole() {
    if (!selected || !canManageTeam || selected.role === 'Owner') return;
    setRoleSaving(true); setRoleError('');
    try {
      await api(`/business/organizations/${organizationId}/team/${selected.id}`, session, { method: 'PATCH', body: JSON.stringify({ role: editRole }) });
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
      setEditingMember(false);
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setRoleError(err.message);
    } finally { setRoleSaving(false); }
  }
  async function removeMember() {
    if (!selected || !canManageTeam || selected.role === 'Owner' || selected.id === session.user.id) return;
    setMemberRemoving(true); setRoleError('');
    try {
      await api(`/business/organizations/${organizationId}/team/${selected.id}`, session, { method: 'DELETE' });
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
      setSelectedMember(null);
      setConfirmRemove(false);
      setEditingMember(false);
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setRoleError(err.message);
    } finally { setMemberRemoving(false); }
  }
  const figures = new Map((analytics?.referrals?.people || []).map((person) => [person.id, person]));
  const members = (roster?.people || []).map((member) => ({ ...member, salesCents: figures.get(member.id)?.salesCents || 0, orders: figures.get(member.id)?.orders || 0, customers: figures.get(member.id)?.customers || 0, commissionCents: figures.get(member.id)?.commissionCents || 0 }));
  const roleOptions = [...new Set(members.map((member) => member.role))].sort((a, b) => a.localeCompare(b)).map((value) => ({ id: value, label: value }));
  const activeRoles = selectedRoles.filter((value) => roleOptions.some((option) => option.id === value));
  const visibleMembers = searchRows(members.filter((member) => !activeRoles.length || activeRoles.includes(member.role)), search, ['name', 'role', 'email', 'status']);
  const sortedMembers = sortTableRows(visibleMembers, sortKey, descending);
  const pager = useTablePagination(sortedMembers, roster?.people, `${organizationId}:${sortKey}:${descending}:${search}:${activeRoles.join(',')}`);
  const selected = members.find((member) => member.id === selectedMember);
  function sort(key) { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(['salesCents', 'orders', 'customers'].includes(key)); } }
  if (!organizations.length) return <div className="surface-card p-6">Team invitations are available to organization owners and managers.</div>;
  if (loading && !roster) return <LoadingState className="panel">Loading team…</LoadingState>;
  return <div className="team-page">
    {organizations.length > 1 && <label>Organization<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setSelectedRoles([]); setLink(''); }}>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    <section className="panel team-invite-summary"><div><span className="eyebrow">TEAM ACCESS</span><h2>Build your team</h2><p>Invite managers, employees, or promoters and manage their access in one place.</p></div>
      <Button ref={inviteTriggerRef} onClick={() => { setError(''); setInviteOpen(true); }}>Invite team member</Button>
    </section>
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      <DialogContent className="team-invite-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); inviteTriggerRef.current?.focus(); }}>
        <DialogHeader>
          <span className="eyebrow">TEAM ACCESS</span>
          <DialogTitle>Invite {canInviteManager ? 'a manager, employee, or promoter' : 'an employee or promoter'}</DialogTitle>
          <DialogDescription>Send a seven-day invitation link. New people create a customer account first; existing Nitewide users sign in. Their new role is added to the same account after they accept.</DialogDescription>
        </DialogHeader>
        <form className="team-invite-form" onSubmit={submit}>
          <label>Email address<Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label>Phone (optional)<Input type="tel" inputMode="tel" autoComplete="off" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 407 555 0123" /></label>
          <div className="team-role-field"><span>Role</span><Choice label="Role" value={role} onChange={setRole} options={[...(canInviteManager ? [['manager', 'Manager']] : []), ['employee', 'Employee'], ['affiliate', 'Promoter']]} /></div>
          <Button disabled={busy || !organizationId}>{busy ? 'Creating…' : 'Create invitation'}</Button>
        </form>
        <small>Phone is saved with the invitation for a future optional text invite. Share the link manually for now.</small>
        {error && <p role="alert" className="error">{error}</p>}
        {link && <div className="team-link"><p>Share this private link with the {roleLabel(role)}:</p><Input readOnly value={link} aria-label="Invitation link" onFocus={(event) => event.target.select()} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(link)}>Copy link</Button><small>Only the invited email address can accept it. No email is sent automatically yet.</small></div>}
        <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedMember(null); }}>
      <section className="panel team-roster"><h2>Current team</h2><p className="team-caption">Showing referred paid sales from the last 30 days. Click a member for details.</p>
        {roleOptions.length > 0 && <div className="team-roster-filters"><MultiSelect label="Roles" options={roleOptions} selected={activeRoles} onChange={setSelectedRoles}/></div>}
        <MobileTableSort columns={teamColumns} value={sortKey} descending={descending} onChange={sort} onToggle={() => setDescending(!descending)}/>
        <div className="table-search"><div className="search-field"><Search size={16} aria-hidden="true"/><Input aria-label="Search team" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/></div></div>
        <div className="table-wrap responsive-event-table"><Table><TableHeader><TableRow>{teamColumns.map(({ key, label }) => <TableHead key={key} scope="col" aria-sort={sortKey === key ? descending ? 'descending' : 'ascending' : 'none'}><button className="table-sort" onClick={() => sort(key)}>{label} {sortKey === key ? (descending ? '↓' : '↑') : '↕'}</button></TableHead>)}</TableRow></TableHeader><TableBody>{pager.rows.map((member) => <TableRow key={member.id}>
          <TableCell data-label="Name"><button className="team-member-link" onClick={(event) => { memberTriggerRef.current = event.currentTarget; setRoleError(''); setEditingMember(false); setConfirmRemove(false); setEditRole(member.role === 'Manager' ? 'manager' : member.role === 'Promoter' ? 'affiliate' : 'employee'); setSelectedMember(member.id); }}>{member.name}</button></TableCell>
          <TableCell data-label="Role">{member.role}</TableCell><TableCell data-label="Email">{member.email}</TableCell><TableCell data-label="Status">{member.status}</TableCell><TableCell data-label="Referred sales">{money(member.salesCents)}</TableCell><TableCell data-label="Orders">{member.orders}</TableCell><TableCell data-label="Customers">{member.customers}</TableCell>
        </TableRow>)}</TableBody></Table></div>{!members.length ? <p>No team members yet.</p> : !visibleMembers.length && <p role="status">No team members match those filters.</p>}<TablePagination pager={pager}/></section>
      {selected && <DialogContent className="team-member-dialog sm:max-w-xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); (memberTriggerRef.current?.isConnected ? memberTriggerRef.current : inviteTriggerRef.current)?.focus(); }}>
        <DialogHeader>
          <span className="eyebrow">TEAM MEMBER</span>
          <DialogTitle>{selected.name}</DialogTitle>
          <DialogDescription>{selected.email} · {selected.role}</DialogDescription>
        </DialogHeader>
        <div className="team-detail-metrics"><span><small>Status</small><strong>{selected.status}</strong></span><span><small>Joined</small><strong>{selected.joined ? new Date(selected.joined).toLocaleDateString() : '—'}</strong></span><span><small>Referred sales</small><strong>{money(selected.salesCents)}</strong></span><span><small>Paid orders</small><strong>{selected.orders}</strong></span><span><small>Customers</small><strong>{selected.customers}</strong></span><span><small>Commission</small><strong>{money(selected.commissionCents)}</strong></span></div>
        {canManageTeam && selected.role !== 'Owner' && selected.id !== session.user.id && !editingMember && <div className="team-role-editor"><Button variant="outline" onClick={() => { setEditingMember(true); setRoleError(''); }}>Edit member</Button></div>}
        {canManageTeam && selected.role !== 'Owner' && selected.id !== session.user.id && editingMember && <div className="team-role-editor team-role-editor-open"><div className="team-role-field"><span>Role</span><Choice label="Team member role" value={editRole} onChange={setEditRole} options={[["manager", "Manager"], ["employee", "Employee"], ["affiliate", "Promoter"]]} /></div><div className="team-role-edit-actions"><div className="team-role-edit-primary"><Button disabled={roleSaving || (selected.role === 'Manager' ? editRole === 'manager' : selected.role === 'Employee' ? editRole === 'employee' : editRole === 'affiliate')} onClick={saveRole}>{roleSaving ? 'Saving…' : 'Save role'}</Button><Button variant="outline" disabled={roleSaving || memberRemoving} onClick={() => { setEditingMember(false); setConfirmRemove(false); setRoleError(''); }}>Cancel</Button></div><div className="team-role-edit-danger"><Button variant="destructive" disabled={memberRemoving} onClick={() => { setRoleError(''); setConfirmRemove(true); }}>Remove member</Button></div></div></div>}
        {selected.role === 'Owner' && <p className="team-role-note">Ownership is managed separately and can’t be changed here.</p>}
        {roleError && <p role="alert" className="error">{roleError}</p>}
        <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
      </DialogContent>}
    </Dialog>
    <Dialog open={Boolean(confirmRemove && selected)} onOpenChange={(open) => { if (!open && !memberRemoving) setConfirmRemove(false); }}>
      {confirmRemove && selected && <DialogContent className="team-remove-dialog" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>Remove this member?</DialogTitle><DialogDescription>{selected.name} will lose access to this organization. Event-only promoter assignments remain separate.</DialogDescription></DialogHeader>
        {roleError && <p role="alert" className="error">{roleError}</p>}
        <DialogFooter className="team-remove-dialog-actions"><Button variant="destructive" disabled={memberRemoving} onClick={removeMember}>{memberRemoving ? 'Removing…' : 'Confirm removal'}</Button><Button variant="outline" disabled={memberRemoving} onClick={() => setConfirmRemove(false)}>Keep member</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
    <section className="panel team-pending"><h2>Pending invitations</h2>{roster?.invitations.length ? <ul>{roster.invitations.map((invitation) => <li key={invitation.id}><span><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)}{invitation.phone ? ` · ${invitation.phone}` : ''} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></span><div><Button variant="outline" size="sm" onClick={() => resend(invitation)}>Resend</Button><Button variant="ghost" size="sm" onClick={() => revoke(invitation)}>Delete</Button></div></li>)}</ul> : <p>No pending invitations.</p>}<small>Resend creates a new private link and opens your email app. Nitewide does not send email automatically yet.</small></section>
  </div>;
}

export function TeamInviteLanding({ token, session, onSession, onAccepted }) {
  const [invite, setInvite] = useState(null);
  const [register, setRegister] = useState(false);
  const [signupPhone, setSignupPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/team/invitations/${encodeURIComponent(token)}`, null).then(setInvite).catch((err) => setError(err.message)); }, [token]);
  useEffect(() => { setSignupPhone(invite?.phone || ''); }, [invite?.phone]);
  async function accept(currentSession) {
    const accepted = await api(`/team/invitations/${encodeURIComponent(token)}/accept`, currentSession, { method: 'POST' });
    const updated = await api('/auth/me', currentSession);
    onAccepted({ ...currentSession, ...updated }, accepted);
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const currentSession = await api(register ? '/auth/register' : '/auth/sign-in', null, { method: 'POST', body: JSON.stringify(register ? { displayName: form.get('name'), email: form.get('email'), password: form.get('password'), phone: form.get('phone'), marketingConsent: false, transactionalSmsConsent: form.get('transactionalSms') === 'on', marketingSmsConsent: form.get('marketingSms') === 'on' } : { email: form.get('email'), password: form.get('password') }) });
      await accept(currentSession);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="signin">
    <section className="signin-story"><h1>{invite?.eventId ? 'Make this event yours.' : 'Join the team.'}</h1><p>One Nitewide account, more ways to work together.</p></section>
    <section className="signin-form-wrap"><div className="signin-form">
      <span className="eyebrow">{invite?.eventId ? 'EVENT PROMOTER INVITATION' : 'TEAM INVITATION'}</span>
      <h2>{invite ? invite.eventId ? `Promote ${invite.eventTitle}` : `${invite.organizationName} invited you to join as ${roleLabel(invite.role)}` : 'Checking invitation…'}</h2>
      <p>Accept with {invite?.email || 'the invited email address'}. Your existing roles stay intact.</p>
      {invite?.eventId && <><p><strong>{(invite.commissionBps ?? 0)/100}% event commission</strong> on future referred ticket/package sales before fees. Previously completed sales stay unchanged.</p><p>Access your own sales, performance and referred guestlists for this event only. You are not joining the venue team.</p></>}
      {session ? <Button disabled={busy || !invite} onClick={async () => { setBusy(true); setError(''); try { await accept(session); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>Accept invitation</Button> : <form key={invite?.email || 'pending'} onSubmit={submit}><label>Email<Input name="email" type="email" required defaultValue={invite?.email || ''} /></label>{register && <label>Name<Input name="name" required /></label>}<label>Password<Input name="password" type="password" required minLength={register ? 8 : 1} /></label>{register && <><label>Phone (optional)<Input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} value={signupPhone} onChange={(event) => setSignupPhone(event.target.value)} placeholder="+1 407 555 0123" /></label><label className="sms-choice"><input type="checkbox" name="transactionalSms" disabled={!signupPhone.trim()} /> Text me booking, guestlist and event updates when available.</label><label className="sms-choice"><input type="checkbox" name="marketingSms" disabled={!signupPhone.trim()} /> Text me event recommendations and offers when available.</label><small>Texts are not active yet. These choices are optional and require a phone number.</small></>}<Button disabled={!invite || busy}>{register ? 'Create account and accept' : 'Sign in and accept'}</Button></form>}
      <Button variant="ghost" onClick={() => setRegister(!register)}>{register ? 'Already have an account? Sign in' : 'New to Nitewide? Create an account'}</Button>{error && <p role="alert" className="error">{error}</p>}
    </div></section>
  </main>;
}
