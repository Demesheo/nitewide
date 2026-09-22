import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { money } from '@/lib/business';

const roleLabel = (role) => role === 'affiliate' ? 'promoter' : role;

export function Team({ session, organizations, onUnauthorized }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '');
  const [roster, setRoster] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const memberTriggerRef = useRef(null);
  const [sortKey, setSortKey] = useState('name');
  const [descending, setDescending] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('employee');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canInviteManager = organizations.find((org) => org.id === organizationId)?.canInviteManager;
  useEffect(() => {
    if (!organizations.some((org) => org.id === organizationId)) setOrganizationId(organizations[0]?.id || '');
  }, [organizations, organizationId]);
  useEffect(() => { if (!canInviteManager && role === 'manager') setRole('employee'); }, [canInviteManager, role]);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    Promise.all([
      api(`/business/organizations/${organizationId}/team`, session, { signal: controller.signal }),
      api(`/business/analytics?days=30&organizationIds=${organizationId}`, session, { signal: controller.signal }),
    ]).then(([team, report]) => { setRoster(team); setAnalytics(report); setSelectedMember(null); })
      .catch((err) => { if (err.status === 401) onUnauthorized(); else if (err.name !== 'AbortError') setError(err.message); });
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
      setRoster(await api(`/business/organizations/${organizationId}/team`, session));
      window.location.href = `mailto:${encodeURIComponent(renewed.email)}?subject=${encodeURIComponent(`Invitation to ${renewed.organizationName} on Nitewide`)}&body=${encodeURIComponent(`Join ${renewed.organizationName} as ${roleLabel(renewed.role)} using this private link:\n\n${url}\n\nThis link expires in seven days.`)}`;
    } catch (err) { setError(err.message); }
  }
  const figures = new Map((analytics?.referrals?.people || []).map((person) => [person.id, person]));
  const members = (roster?.people || []).map((member) => ({ ...member, salesCents: figures.get(member.id)?.salesCents || 0, orders: figures.get(member.id)?.orders || 0, customers: figures.get(member.id)?.customers || 0, commissionCents: figures.get(member.id)?.commissionCents || 0 }));
  const sortedMembers = sortTableRows(members, sortKey, descending);
  const pager = useTablePagination(sortedMembers, roster?.people, `${organizationId}:${sortKey}:${descending}`);
  const selected = members.find((member) => member.id === selectedMember);
  function sort(key) { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(['salesCents', 'orders', 'customers'].includes(key)); } }
  if (!organizations.length) return <div className="surface-card p-6">Team invitations are available to organization owners and managers.</div>;
  return <div className="team-page">
    {organizations.length > 1 && <label>Organization<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setLink(''); }}>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    <div className="surface-card team-invite"><div><span className="eyebrow">TEAM ACCESS</span><h2>Invite {canInviteManager ? 'a manager, employee, or promoter' : 'an employee or promoter'}</h2><p>Send a seven-day invitation link. New people create a customer account first; existing Nitewide users sign in. Their new role is added to the same account after they accept.</p></div>
      <form onSubmit={submit}><label>Email address<Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><label>Phone (optional)<Input type="tel" inputMode="tel" autoComplete="off" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 407 555 0123" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{canInviteManager && <option value="manager">Manager</option>}<option value="employee">Employee</option><option value="affiliate">Promoter</option></select></label><Button disabled={busy || !organizationId}>{busy ? 'Creating…' : 'Create invitation'}</Button></form>
      <small>Phone is saved with the invitation for a future optional text invite. Share the link manually for now.</small>
      {error && <p role="alert" className="error">{error}</p>}
      {link && <div className="team-link"><p>Share this private link with the {roleLabel(role)}:</p><Input readOnly value={link} aria-label="Invitation link" onFocus={(event) => event.target.select()} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(link)}>Copy link</Button><small>Only the invited email address can accept it. No email is sent automatically yet.</small></div>}
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedMember(null); }}>
      <div className="surface-card team-roster"><h2>Current team</h2><p className="team-caption">Showing referred paid sales from the last 30 days. Click a member for details.</p><div className="table-wrap"><Table><TableHeader><TableRow>{[['name', 'Name'], ['role', 'Role'], ['email', 'Email'], ['status', 'Status'], ['salesCents', 'Referred sales'], ['orders', 'Orders'], ['customers', 'Customers']].map(([key, label]) => <TableHead key={key}><button className="table-sort" onClick={() => sort(key)}>{label} {sortKey === key ? (descending ? '↓' : '↑') : '↕'}</button></TableHead>)}</TableRow></TableHeader><TableBody>{pager.rows.map((member) => <TableRow key={member.id}><TableCell><button className="team-member-link" onClick={(event) => { memberTriggerRef.current = event.currentTarget; setSelectedMember(member.id); }}>{member.name}</button></TableCell><TableCell>{member.role}</TableCell><TableCell>{member.email}</TableCell><TableCell>{member.status}</TableCell><TableCell>{money(member.salesCents)}</TableCell><TableCell>{member.orders}</TableCell><TableCell>{member.customers}</TableCell></TableRow>)}</TableBody></Table></div>{!members.length && <p>No team members yet.</p>}<TablePagination pager={pager}/></div>
      {selected && <DialogContent className="team-member-dialog sm:max-w-xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); memberTriggerRef.current?.focus(); }}>
        <DialogHeader>
          <span className="eyebrow">TEAM MEMBER</span>
          <DialogTitle>{selected.name}</DialogTitle>
          <DialogDescription>{selected.email} · {selected.role}</DialogDescription>
        </DialogHeader>
        <div className="team-detail-metrics"><span><small>Status</small><strong>{selected.status}</strong></span><span><small>Joined</small><strong>{selected.joined ? new Date(selected.joined).toLocaleDateString() : '—'}</strong></span><span><small>Referred sales</small><strong>{money(selected.salesCents)}</strong></span><span><small>Paid orders</small><strong>{selected.orders}</strong></span><span><small>Customers</small><strong>{selected.customers}</strong></span><span><small>Commission</small><strong>{money(selected.commissionCents)}</strong></span></div>
        <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
      </DialogContent>}
    </Dialog>
    <div className="surface-card team-pending"><h2>Pending invitations</h2>{roster?.invitations.length ? <ul>{roster.invitations.map((invitation) => <li key={invitation.id}><span><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)}{invitation.phone ? ` · ${invitation.phone}` : ''} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></span><div><Button variant="outline" size="sm" onClick={() => resend(invitation)}>Resend</Button><Button variant="ghost" size="sm" onClick={() => revoke(invitation)}>Delete</Button></div></li>)}</ul> : <p>No pending invitations.</p>}<small>Resend creates a new private link and opens your email app. Nitewide does not send email automatically yet.</small></div>
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
