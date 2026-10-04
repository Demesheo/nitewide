import { useEffect, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { PasswordRequirements, passwordRequirementError } from '../../../shared/password-requirements.jsx';
import './onboarding-setup.css';

const kinds = {
  user: 'Nitewide account',
  organization: 'Multi-venue business',
  venue: 'Venue',
  independent_creator: 'Independent event creator',
};

function invitationError(error) {
  if (error.status === 404 || error.status === 410 || error.status === 409) {
    return 'This invitation has expired, was revoked, or has already been used. Ask your Nitewide contact for a new invitation.';
  }
  return error.message || 'We could not check this invitation. Please try again.';
}

export function OnboardingSetup({ token, session, onSignIn, onSwitchAccount, onContinue }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setPreview(null);
    api(`/auth/onboarding/preview?token=${encodeURIComponent(token)}`)
      .then((data) => { if (active) setPreview(data); })
      .catch((failure) => { if (active) setError(invitationError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, retry]);
  const invitedEmail = preview?.email?.trim().toLowerCase();
  const signedInEmail = session?.user?.email?.trim().toLowerCase();
  const mismatch = Boolean(session && invitedEmail && signedInEmail !== invitedEmail);
  const existing = preview?.accountMode === 'existing';
  const validation = !existing && confirmPassword && password !== confirmPassword ? 'Passwords do not match.' : '';
  async function accept(event) {
    event.preventDefault();
    if (!preview || mismatch || (existing && !session) || busy) return;
    const invalidPassword = !existing ? passwordRequirementError(password) : '';
    if (!existing && (invalidPassword || password !== confirmPassword)) {
      setError(invalidPassword || 'Passwords do not match.');
      return;
    }
    setBusy(true); setError('');
    try {
      await api('/auth/onboarding/accept', {
        ...(existing ? { token: session.accessToken } : {}),
        body: existing ? { token } : { token, password, confirmPassword },
      });
      const url = new URL(window.location.href);
      url.searchParams.delete('onboarding');
      window.history.replaceState({}, '', url);
      setPassword(''); setConfirmPassword(''); setDone(true);
    } catch (failure) {
      setError(invitationError(failure));
    } finally { setBusy(false); }
  }
  return <main className="onboarding-screen">
    <section className="onboarding-card" aria-busy={loading || busy}>
      <div className="onboarding-mark">n.</div>
      <span className="onboarding-eyebrow"><ShieldCheck size={16} aria-hidden="true" /> NITEWIDE INVITATION</span>
      {loading ? <div className="onboarding-state" role="status"><LoaderCircle className="onboarding-spin" aria-hidden="true" /> Checking your invitation…</div>
        : done ? <div className="onboarding-state" role="status"><Check size={28} aria-hidden="true" /><h1>You're all set.</h1><p>Your email is confirmed and your access is ready.</p><button className="onboarding-primary" onClick={onContinue}>{existing && session ? 'Continue to Nitewide' : 'Sign in to continue'} <ArrowRight size={18} /></button></div>
          : !preview ? <div className="onboarding-state"><h1>Invitation unavailable</h1><p role="alert">{error}</p><button className="onboarding-secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
            : <>
              <h1>Make it official.</h1>
              <p className="onboarding-intro">{existing ? 'Accept your new access with your Nitewide account.' : 'Confirm your email and set a password to activate your account.'}</p>
              <dl className="onboarding-details">
                <div><dt>Invited name</dt><dd>{preview.displayName}</dd></div>
                <div><dt>Invited email</dt><dd>{preview.email}</dd></div>
                <div><dt>Access</dt><dd>{kinds[preview.kind] || 'Nitewide access'}</dd></div>
                <div><dt>Link expires</dt><dd>{new Date(preview.expiresAt).toLocaleString()}</dd></div>
              </dl>
              {mismatch ? <div className="onboarding-state"><p role="alert">You're signed in as {session.user.email}. This invitation is for {preview.email}.</p><button className="onboarding-primary" onClick={() => onSwitchAccount(existing)}>Switch account <ArrowRight size={18} /></button></div>
                : existing && !session ? <div className="onboarding-state"><p>Sign in with <strong>{preview.email}</strong>, then return here to accept.</p><button className="onboarding-primary" onClick={onSignIn}>Sign in to continue <ArrowRight size={18} /></button></div>
                  : <form onSubmit={accept} className="onboarding-form">
                    {!existing && <>
                      <label>New password<div className="onboarding-password"><input name="password" autoComplete="new-password" type={showPassword ? 'text' : 'password'} maxLength={128} required aria-describedby="onboarding-password-help" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
                      <PasswordRequirements id="onboarding-password-help" password={password}/>
                      <label>Confirm password<div className="onboarding-password"><input name="confirmPassword" autoComplete="new-password" type={showConfirmation ? 'text' : 'password'} maxLength={128} required value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }} /><button type="button" aria-label={showConfirmation ? 'Hide confirmed password' : 'Show confirmed password'} aria-pressed={showConfirmation} onClick={() => setShowConfirmation(!showConfirmation)}>{showConfirmation ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></label>
                    </>}
                    {validation && <p role="status" className="onboarding-error">{validation}</p>}
                    {error && <p role="alert" className="onboarding-error">{error}</p>}
                    <button className="onboarding-primary" disabled={busy || Boolean(validation)} type="submit">{busy ? <><LoaderCircle className="onboarding-spin" size={18} /> Activating…</> : <>{existing ? 'Accept access' : 'Confirm email and activate'} <ArrowRight size={18} /></>}</button>
                  </form>}
            </>}
      <p className="onboarding-footer">Need help? Contact the Nitewide team that invited you.</p>
    </section>
  </main>;
}
