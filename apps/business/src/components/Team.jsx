import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, ShieldCheck, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { teamInvitationUrl } from '@/lib/team-invitation-link';
import { copyText } from '../../../shared/copy-text.js';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { money } from '@/lib/business';
import { MobileTableSort } from './MobileTableSort';
import { MultiSelect } from './MultiSelect';
import { searchRows } from '@/lib/table-search';
import { Choice } from './controls';
import { LoadingState } from './LoadingState';
import { ManagerFinancePermission } from './ManagerFinancePermission';
import { BrandMark, BusinessBrand } from './BusinessBrand';
import { PendingTeamInvitation } from './PendingTeamInvitation';
import { PasswordRequirements, passwordRequirementError } from '../../../shared/password-requirements.jsx';
import { TermsAcceptance, TermsLink, termsAcceptance } from '../../../shared/terms-and-conditions.jsx';
import { publicAppLink } from '../../../shared/app-links.mjs';

const teamColumns = [['name', 'Name'], ['role', 'Role'], ['email', 'Email'], ['status', 'Status'], ['salesCents', 'Referred sales'], ['orders', 'Orders'], ['customers', 'Customers']].map(([key, label]) => ({ key, label }));

const roleLabel = (role) => role === 'affiliate' ? 'promoter' : role;

export function Team({ session, organizations, onUnauthorized }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '');
  const [roster, setRoster] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef(null);
  const rosterRef = useRef(null);
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
  const [inviteeName, setInviteeName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('employee');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
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
      const result = await api(`/business/organizations/${organizationId}/invitations`, session, { method: 'POST', body: JSON.stringify({ email, ...(inviteeName.trim() ? { name: inviteeName.trim() } : {}), phone, role }) });
      setLink(teamInvitationUrl(result.token));
      setEmail('');
      setInviteeName('');
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
      const url = teamInvitationUrl(renewed.token);
      setLink(url);
      setInviteOpen(true);
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
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
  const scrollToRoster = () => requestAnimationFrame(() => rosterRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
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
          <label className="team-invite-identity">Name (optional)<Input name="inviteeName" autoComplete="off" maxLength={120} value={inviteeName} onChange={(event) => setInviteeName(event.target.value)} placeholder="e.g. Alex Rivera" /></label>
          <label className="team-invite-identity">Email address<Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label>Phone (optional)<Input type="tel" inputMode="tel" autoComplete="off" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 407 555 0123" /></label>
          <div className="team-role-field"><span>Role</span><Choice label="Role" value={role} onChange={setRole} options={[...(canInviteManager ? [['manager', 'Manager']] : []), ['employee', 'Employee'], ['affiliate', 'Promoter']]} /></div>
          <Button disabled={busy || !organizationId}>{busy ? 'Creating…' : 'Create invitation'}</Button>
        </form>
        <small>The invitation email is queued when email delivery is configured. The private link remains available to copy as a backup.</small>
        {error && <p role="alert" className="error">{error}</p>}
        {link && <div className="team-link"><p>Private invitation link for the {roleLabel(role)}:</p><Input readOnly value={link} aria-label="Invitation link" onFocus={(event) => event.target.select()} /><CopyLinkButton component={Button} copied={copied} onClick={async () => { try { await copyText(link); setCopied(true); setError(''); } catch { setCopied(false); setError('Select and copy the invitation link above.'); } }}/><small>Only the invited email address can accept it.</small></div>}
        <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedMember(null); }}>
      <section ref={rosterRef} className="panel team-roster"><h2>Current team</h2><p className="team-caption">Showing referred paid sales from the last 30 days. Click a member for details.</p>
        {roleOptions.length > 0 && <div className="team-roster-filters"><MultiSelect label="Roles" options={roleOptions} selected={activeRoles} onChange={setSelectedRoles}/></div>}
        <MobileTableSort columns={teamColumns} value={sortKey} descending={descending} onChange={sort} onToggle={() => setDescending(!descending)}/>
        <div className="table-search"><div className="search-field"><Search size={16} aria-hidden="true"/><Input aria-label="Search team" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/></div></div>
        <div className="table-wrap responsive-event-table"><Table><TableHeader><TableRow>{teamColumns.map(({ key, label }) => <TableHead key={key} scope="col" aria-sort={sortKey === key ? descending ? 'descending' : 'ascending' : 'none'}><button className="table-sort" onClick={() => sort(key)}>{label} {sortKey === key ? (descending ? '↓' : '↑') : '↕'}</button></TableHead>)}</TableRow></TableHeader><TableBody>{pager.rows.map((member) => <TableRow key={member.id}>
          <TableCell data-label="Name"><button className="team-member-link" onClick={(event) => { memberTriggerRef.current = event.currentTarget; setRoleError(''); setEditingMember(false); setConfirmRemove(false); setEditRole(member.role === 'Manager' ? 'manager' : member.role === 'Promoter' ? 'affiliate' : 'employee'); setSelectedMember(member.id); }}>{member.name}</button></TableCell>
          <TableCell data-label="Role">{member.role}</TableCell><TableCell data-label="Email">{member.email}</TableCell><TableCell data-label="Status">{member.status}</TableCell><TableCell data-label="Referred sales">{money(member.salesCents)}</TableCell><TableCell data-label="Orders">{member.orders}</TableCell><TableCell data-label="Customers">{member.customers}</TableCell>
        </TableRow>)}</TableBody></Table></div>{!members.length ? <p>No team members yet.</p> : !visibleMembers.length && <p role="status">No team members match those filters.</p>}<TablePagination pager={pager} onPageChange={scrollToRoster}/></section>
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
        <ManagerFinancePermission organizationId={organizationId} member={selected} canGrantFinance={roster?.canGrantFinance}
          organizationVersion={roster?.organizationVersion} session={session} disabled={roleSaving || memberRemoving} onUnauthorized={onUnauthorized}
          onRefresh={() => api(`/business/organizations/${organizationId}/team`, session).then(setRoster).catch((err) => { if (err.status === 401) onUnauthorized(); else setRoleError(err.message); })}
          onSaved={(result) => setRoster((current) => ({ ...current, organizationVersion: result.version,
            people: current.people.map((member) => member.id === result.userId ? { ...member, financeAuthorized: result.financeAuthorized } : member) }))}/>
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
    <section className="panel team-pending"><h2>Pending invitations</h2>{roster?.invitations.length ? <ul>{roster.invitations.map((invitation) => <PendingTeamInvitation key={invitation.id} invitation={invitation} busy={busy} onResend={() => resend(invitation)} onDelete={() => revoke(invitation)}/>)}</ul> : <p>No pending invitations.</p>}<small>Resend renews the private link and queues a new email when delivery is configured. You can also copy the link.</small></section>
  </div>;
}

export function TeamInviteLanding({ token, session, onAccepted }) {
  const [invite, setInvite] = useState(null);
  const [register, setRegister] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signupPhone, setSignupPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmationError, setConfirmationError] = useState('');
  const [authenticatedSession, setAuthenticatedSession] = useState(null);
  const currentIdentity = session || authenticatedSession;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const accepting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setInvite(null); setError(''); setRegister(false); setTermsAccepted(false);
    setPassword(''); setConfirmation(''); setPasswordError(''); setConfirmationError('');
    setAuthenticatedSession(null);
    api(`/team/invitations/${encodeURIComponent(token)}`, null, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setInvite(value); setRegister(value.accountMode === 'new'); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, retry]);
  useEffect(() => { setSignupPhone(invite?.phone || ''); }, [invite?.phone]);
  async function accept(currentSession) {
    const accepted = await api(`/team/invitations/${encodeURIComponent(token)}/accept`, currentSession, { method: 'POST' });
    const updated = await api('/auth/me', currentSession);
    onAccepted({ ...currentSession, ...updated }, accepted);
  }
  async function submit(event) {
    event.preventDefault();
    if (accepting.current || !invite) return;
    if (register) {
      if (!termsAccepted) { setError('Please agree to the Nitewide terms and conditions to create an account.'); return; }
      const invalidPassword = passwordRequirementError(password);
      const invalidConfirmation = !confirmation ? 'Please confirm your password.' : password !== confirmation ? 'Passwords do not match.' : '';
      setPasswordError(invalidPassword); setConfirmationError(invalidConfirmation);
      if (invalidPassword || invalidConfirmation) {
        event.currentTarget.elements.namedItem(invalidPassword ? 'password' : 'confirmPassword')?.focus();
        return;
      }
    }
    accepting.current = true; setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    let authenticated = false;
    try {
      const currentSession = await api(register ? '/auth/register' : '/auth/sign-in', null, { method: 'POST', body: JSON.stringify(register ? { displayName: form.get('name'), email: form.get('email'), password: form.get('password'), phone: form.get('phone'), marketingConsent: false, ...termsAcceptance } : { email: form.get('email'), password: form.get('password') }) });
      authenticated = true;
      // Keep a newly created account recoverable if accepting the invitation fails.
      setAuthenticatedSession(currentSession);
      setPassword(''); setConfirmation('');
      await accept(currentSession);
    } catch (err) {
      if (register && !authenticated && err.code === 'DUPLICATE') {
        setRegister(false); setPassword(''); setConfirmation('');
        setError('This email now has an account. Sign in to accept your invitation.');
      } else setError(err.message);
    } finally { accepting.current = false; setBusy(false); }
  }
  return <main className="signin team-invite-page">
    <section className="signin-story"><BusinessBrand href={publicAppLink('businessHome', import.meta.env.VITE_BUSINESS_HOME || '/')} />
      <div className="story-content"><span className="eyebrow">YOUR NEXT CHAPTER</span><h1>{invite?.eventId ? 'Make this event yours.' : 'Join the team.'}</h1><p>Your people. Your opportunities.<br/>One Nitewide account.</p>
        <div className="story-pills"><span><Users size={16} aria-hidden="true"/>Work together</span><span><Ticket size={16} aria-hidden="true"/>Make great nights</span></div></div>
      <div className="story-footer">Built for the people behind the night.</div>
    </section>
    <section className="signin-form"><div className="signin-box team-invite-box">
      <span className="login-mark"><BrandMark /></span>
      <span className="eyebrow">{invite?.eventId ? 'EVENT PROMOTER INVITATION' : 'TEAM INVITATION'}</span>
      <h2>{invite ? invite.eventId ? `Promote ${invite.eventTitle}` : `${invite.organizationName} invited you to join as ${roleLabel(invite.role)}` : loading ? 'Checking invitation…' : 'Invitation unavailable'}</h2>
      {loading && <LoadingState>Checking your private invitation…</LoadingState>}
      {invite && <><p className="team-invite-intro">{currentIdentity ? <>Accept with <strong>{invite.email}</strong></> : register ? 'Create your Nitewide account to accept this invitation.' : 'Sign in with your invited email to accept this invitation.'}</p>
        {invite.eventId && <div className="team-invite-scope"><p>View your own sales, performance and referred guestlists for this event only. This does not add you to the venue team.</p><p><strong>{(invite.commissionBps ?? 0)/100}% event commission</strong> on future eligible referred sales. Existing sales stay unchanged.</p></div>}
        {currentIdentity ? <div className="team-invite-session"><p>Signed in as <strong>{currentIdentity.user?.email}</strong></p><Button disabled={busy} onClick={async () => { if (accepting.current) return; accepting.current = true; setBusy(true); setError(''); try { await accept(currentIdentity); } catch (err) { setError(err.message); } finally { accepting.current = false; setBusy(false); } }}>{busy ? 'Accepting…' : 'Accept invitation'}{!busy && <ArrowRight aria-hidden="true"/>}</Button></div> : <>
          <form key={invite.email} id="team-invite-accept-form" aria-label={register ? 'Create account and accept invitation' : 'Sign in and accept invitation'} onSubmit={submit} aria-busy={busy}>
            <fieldset disabled={busy}>
              <label className="field" htmlFor="team-invite-email"><span>Email</span><Input id="team-invite-email" name="email" type="email" autoComplete="username" required readOnly value={invite.email}/></label>
              {register && <label className="field" htmlFor="team-invite-name"><span>Name</span><Input id="team-invite-name" name="name" autoComplete="name" defaultValue={invite.name || ''} maxLength={120} required /></label>}
              <div className="field"><label htmlFor="team-invite-password">Password</label><Input id="team-invite-password" key={register ? 'new' : 'current'} name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required maxLength={128} value={password} onChange={event => { setPassword(event.target.value); setPasswordError(''); setConfirmationError(''); setError(''); }} aria-invalid={Boolean(passwordError)} aria-describedby={register ? `team-invite-password-help${passwordError ? ' team-invite-password-error' : ''}` : undefined} placeholder={register ? 'Create a strong password' : 'Enter your password'}/>{register && <PasswordRequirements id="team-invite-password-help" password={password}/>} {passwordError && <small id="team-invite-password-error" role="alert" className="team-invite-field-error">{passwordError}</small>}</div>
              {register && <div className="field"><label htmlFor="team-invite-confirm-password">Confirm password</label><Input id="team-invite-confirm-password" name="confirmPassword" type="password" visibilityLabel="confirmed password" autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => { setConfirmation(event.target.value); setConfirmationError(''); setError(''); }} aria-invalid={Boolean(confirmationError)} aria-describedby={confirmationError ? 'team-invite-confirm-password-error' : undefined} placeholder="Re-enter your password"/>{confirmationError && <small id="team-invite-confirm-password-error" role="alert" className="team-invite-field-error">{confirmationError}</small>}</div>}
              {register && <label className="field" htmlFor="team-invite-phone"><span>Phone (optional)</span><Input id="team-invite-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} value={signupPhone} onChange={event => setSignupPhone(event.target.value)} placeholder="+1 407 555 0123" /></label>}
              {register && <TermsAcceptance accepted={termsAccepted} onChange={setTermsAccepted} disabled={busy}/>}
            </fieldset>
            <Button type="submit" disabled={busy || (register && !termsAccepted)}>{busy ? 'Accepting…' : register ? 'Create account and accept' : 'Sign in and accept'}{!busy && <ArrowRight aria-hidden="true"/>}</Button>
          </form>
          <div className="signin-help"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setRegister(!register); setTermsAccepted(false); setError(''); setPassword(''); setConfirmation(''); setPasswordError(''); setConfirmationError(''); }}>{register ? 'Already have an account? Sign in' : 'New to Nitewide? Create an account'}</Button></div>
        </>}
        <div className="signin-note"><ShieldCheck size={16} aria-hidden="true"/><span>Your existing roles stay intact. This invitation adds access to the same Nitewide account.</span></div>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !invite && <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>Retry invitation</Button>}
    </div><footer><TermsLink/><small>© {new Date().getFullYear()} Nitewide · Business, after hours.</small></footer></section>
  </main>;
}
