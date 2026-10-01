import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '@/lib/api';

export function BusinessAccessRequestForm({ initialEmail = '', onBack }) {
  const [draft, setDraft] = useState({ displayName: '', email: initialEmail, phone: '', businessName: '', role: '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [sent]);
  const update = (key) => (event) => setDraft((value) => ({ ...value, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (draft.details.trim().length < 10) { setError('Tell us a little more about your business (at least 10 characters).'); return; }
    const compactPhone = draft.phone.trim().replace(/[\s().-]/g, '');
    const phone = /^\d{10}$/.test(compactPhone) ? `+1${compactPhone}` : /^1\d{10}$/.test(compactPhone) ? `+${compactPhone}` : compactPhone;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { setError('Enter a valid phone number, including your country code if outside the US.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      await api('/business/access-requests', null, { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]))) });
      setSent(true);
    } catch (failure) { setError(failure.message); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (sent) return <div className="business-access-request business-access-sent">
    <span className="business-access-check"><Check size={24} aria-hidden="true" /></span>
    <h2 ref={heading} tabIndex={-1}>Request received.</h2>
    <p role="status">Nitewide will review your business access request. Access is not granted until onboarding is completed.</p>
    <p>Once approved, you’ll receive an invitation to confirm your email and set up your Business access.</p>
    <Button type="button" size="lg" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to sign in</Button>
  </div>;
  return <div className="business-access-request">
    <span className="eyebrow">BUILD YOUR BUSINESS WITH NITEWIDE</span>
    <h2 ref={heading} tabIndex={-1}>Request access.</h2>
    <p>One Business workspace for your organization, venues and events. Apply as an owner / creator or manager.</p>
    <p id="business-access-review-note">Nitewide reviews each request before inviting you to complete onboarding. Submitting this form does not grant access.</p>
    <form id="business-access-request-form" aria-label="Request Business access" aria-describedby="business-access-review-note" aria-busy={busy} onSubmit={submit}>
      <label className="field" htmlFor="business-access-name"><span>Full name</span><Input id="business-access-name" name="displayName" autoComplete="name" required minLength={2} maxLength={120} value={draft.displayName} onChange={update('displayName')} placeholder="Your full name" disabled={busy} /></label>
      <label className="field" htmlFor="business-access-email"><span>Email address</span><Input id="business-access-email" name="email" type="email" autoComplete="email" required maxLength={320} value={draft.email} onChange={update('email')} placeholder="you@yourbusiness.com" disabled={busy} /></label>
      <label className="field" htmlFor="business-access-phone"><span>Phone number</span><Input id="business-access-phone" name="phone" type="tel" autoComplete="tel" required minLength={9} maxLength={40} value={draft.phone} onChange={update('phone')} placeholder="(407) 555-0123" disabled={busy} /></label>
      <label className="field" htmlFor="business-access-business"><span>Business name</span><Input id="business-access-business" name="businessName" autoComplete="organization" required minLength={2} maxLength={160} value={draft.businessName} onChange={update('businessName')} placeholder="Your organization or event brand" disabled={busy} /></label>
      <div className="field"><label htmlFor="business-access-role"><span>Your role</span></label><select id="business-access-role" name="role" required value={draft.role} onChange={update('role')} disabled={busy}><option value="" disabled>Select your role</option><option value="owner">Owner / creator</option><option value="manager">Manager</option></select></div>
      <div className="field"><label htmlFor="business-access-details"><span>Tell us about your business</span></label><textarea id="business-access-details" name="details" aria-describedby="business-access-details-hint" required minLength={10} maxLength={2000} rows={4} value={draft.details} onChange={update('details')} placeholder="Your venues, events and how you’d like to use Nitewide." disabled={busy} /><small id="business-access-details-hint">10–2,000 characters</small></div>
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? <><LoaderCircle className="nw-loading-icon" aria-hidden="true" /> Sending request…</> : <>Send request <ArrowRight aria-hidden="true" /></>}</Button>
    </form>
    <Button type="button" variant="ghost" className="business-access-back" onClick={onBack} disabled={busy}><ArrowLeft aria-hidden="true" /> Back to sign in</Button>
  </div>;
}
