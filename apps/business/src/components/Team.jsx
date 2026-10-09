import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ShieldCheck, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { LoadingState } from './LoadingState';
import { BrandMark, BusinessBrand } from './BusinessBrand';
import { PasswordRequirements, passwordRequirementError } from '../../../shared/password-requirements.jsx';
import { TermsAcceptance, TermsLink, termsAcceptance } from '../../../shared/terms-and-conditions.jsx';
import { publicAppLink } from '../../../shared/app-links.mjs';

const roleLabel = (role) => role === 'affiliate' ? 'promoter' : role;

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
      if (!termsAccepted) { setError('Please agree to the Nitewide terms and acknowledge the Privacy Policy to create an account.'); return; }
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
