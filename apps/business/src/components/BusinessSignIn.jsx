import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Command, LoaderCircle, ShieldCheck, Ticket } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '@/lib/api';
import { BusinessAccessRequestForm } from './BusinessAccessRequestForm';

export function BusinessSignIn({ onSession, notice = '', invitationOnly = false }) {
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetPassword'));
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).has('resetPassword') ? 'reset' : 'sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestTrigger = useRef(null);
  const returnFocus = useRef(false);
  const submitting = useRef(false);
  useEffect(() => { if (mode === 'sign-in' && returnFocus.current) { requestTrigger.current?.focus(); returnFocus.current = false; } }, [mode]);
  function backToSignIn() { returnFocus.current = true; setMode('sign-in'); setError(''); setMessage(''); }
  function leaveReset() {
    const url = new URL(window.location.href);
    url.searchParams.delete('resetPassword');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    setResetToken(null); setPassword(''); setConfirmation(''); setMode('sign-in'); setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'forgot') {
        const result = await api('/auth/password-reset/request', null, { method: 'POST', body: JSON.stringify({ email }) });
        setMessage(result.message);
      } else if (mode === 'reset') {
        if (password !== confirmation) { setError('The passwords do not match.'); return; }
        await api('/auth/password-reset/complete', null, { method: 'POST', body: JSON.stringify({ token: resetToken, password }) });
        leaveReset(); setMessage('Password updated. Sign in with your new password.');
      } else {
        onSession(await api(invitationOnly ? '/auth/sign-in' : '/auth/business/sign-in', null, { method: 'POST', body: JSON.stringify({ email, password }) }));
      }
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main className="signin"><section className="signin-story"><div className="brand"><span className="brand-icon"><Command size={21}/></span><span>nitewide<span className="brand-sub">BUSINESS</span></span></div>
    <div className="story-content"><span className="eyebrow">THE BUSINESS BEHIND THE NIGHT</span><h1>Great nights.<br/><em>Even better <br/>business.</em></h1><p>Your events, your people, your performance.<br/>One clear view of everything that matters.</p>
      <div className="story-pills"><span><BarChart3 size={16}/>Real-time insights</span><span><Ticket size={16}/>Built for experiences</span></div></div>
    <div className="story-footer">A new standard for going out.<span>Made for the people who make it happen.</span></div><div className="orb orb-one"/><div className="orb orb-two"/></section>
    <section className="signin-form"><div className="signin-box"><a className="signin-back" href={import.meta.env.VITE_BUSINESS_HOME || '/'}>← About Nitewide Business</a>
      <span className="login-mark"><ShieldCheck/></span>{mode === 'request' ? <BusinessAccessRequestForm initialEmail={email} onBack={backToSignIn} /> : <><span className="eyebrow">YOUR BUSINESS, CONNECTED</span>
      <h2>{mode === 'forgot' ? 'Reset your password.' : mode === 'reset' ? 'Choose a new password.' : 'Welcome back.'}</h2>
      <p>{mode === 'forgot' ? 'If an account exists, we’ll send a one-hour reset link.' : mode === 'reset' ? 'Use a strong password with uppercase, lowercase and a number.' : invitationOnly ? 'Sign in with your Nitewide account to accept your invitation.' : 'Sign in with your approved Nitewide Business account.'}</p>
      <form id="business-signin-form" aria-label="Business sign in" onSubmit={submit}>{mode !== 'reset' && <label className="field" htmlFor="business-signin-email"><span>Work email</span><Input id="business-signin-email" type="email" name="email" autoComplete="username" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourbusiness.com"/></label>}
        {mode !== 'forgot' && <><div className="field"><label htmlFor="business-signin-password"><span>{mode === 'reset' ? 'New password' : 'Password'}</span></label><Input id="business-signin-password" key={mode} type="password" name="password" autoComplete={mode === 'reset' ? 'new-password' : 'current-password'} required minLength={mode === 'reset' ? 8 : 1} maxLength={128} pattern={mode === 'reset' ? '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}' : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password"/></div>
          {mode === 'reset' && <label className="field"><span>Confirm new password</span><Input id="business-confirm-password" name="confirmPassword" type="password" visibilityLabel="confirmed password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>}</>}
        {(error || notice) && <p role="alert" className="error">{error || notice}</p>}{message && <p role="status" className="notice">{message}</p>}
        <Button disabled={busy} type="submit" size="lg">{busy && <LoaderCircle className="nw-loading-icon" aria-hidden="true"/>}{busy ? 'Working…' : mode === 'forgot' ? 'Request reset link' : mode === 'reset' ? 'Reset password' : 'Sign in to Nitewide'}{!busy && <ArrowRight/>}</Button></form>
      <div className="signin-help">{mode === 'sign-in' ? <Button variant="ghost" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</Button>
        : <Button variant="ghost" onClick={() => { if (mode === 'reset') leaveReset(); else { setMode('sign-in'); setError(''); } }}>Back to sign in</Button>}</div>
      <div className="signin-note"><ShieldCheck size={16}/><span>{invitationOnly ? 'Your invitation must be accepted before Business access is available.' : 'Business access requires approval and completed onboarding. A customer account alone does not grant access.'}</span></div>
      {mode === 'sign-in' && !invitationOnly && <div className="signin-access"><p>New to Nitewide Business?</p><Button ref={requestTrigger} type="button" variant="outline" size="lg" disabled={busy} onClick={() => { setMode('request'); setError(''); setMessage(''); }}>Request access <ArrowRight aria-hidden="true" /></Button></div>}
      </>}
    </div><small>© {new Date().getFullYear()} Nitewide · Business, after hours.</small></section></main>;
}
