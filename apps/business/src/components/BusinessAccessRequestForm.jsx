import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '@/lib/api';

export function BusinessAccessRequestForm({ initialEmail = '', session = null, onBack, onBusyChange, onUnauthorized }) {
  const [draft, setDraft] = useState({ displayName: session?.user?.displayName || '', email: session?.user?.email || initialEmail,
    phone: session?.user?.phone || '', businessName: '', role: '', details: '' });
  const [authority, setAuthority] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const submitting = useRef(false);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [sent]);
  const update = (key) => (event) => setDraft((value) => ({ ...value, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!authority) { setError('Confirm your authority to represent this separate organization.'); return; }
    if (draft.details.trim().length < 10) { setError('Tell us a little more about your business (at least 10 characters).'); return; }
    const compactPhone = draft.phone.trim().replace(/[\s().-]/g, '');
    const phone = /^\d{10}$/.test(compactPhone) ? `+1${compactPhone}` : /^1\d{10}$/.test(compactPhone) ? `+${compactPhone}` : compactPhone;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { setError('Enter a valid phone number, including your country code if outside the US.'); return; }
    submitting.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const payload = { ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])), confirmedAuthority: true };
      if (session) delete payload.email;
      setReceipt(await api(session ? '/account/organization-requests' : '/business/access-requests', session,
        { method: 'POST', body: JSON.stringify(payload) }));
      setSent(true);
    } catch (failure) { if (failure.status === 401) onUnauthorized?.(); else setError(failure.message); }
    finally { submitting.current = false; setBusy(false); onBusyChange?.(false); }
  }
  if (sent) return <div className="business-access-request business-access-sent">
    <span className="business-access-check"><Check size={24} aria-hidden="true" /></span>
    <h2 ref={heading} tabIndex={-1}>{receipt?.duplicate ? 'Request already pending.' : 'Request received.'}</h2>
    <p role="status">{session ? receipt.message : 'Nitewide will review your business access request. Access is not granted until onboarding is completed.'}</p>
    {receipt?.request && <p><strong>{receipt.request.businessName}</strong> · Awaiting manual review</p>}
    <p>Once approved, you’ll receive an invitation to confirm your email and set up your Business access.</p>
    {session && <p>Accept with your existing Nitewide account. Your other organizations, roles and permissions stay unchanged.</p>}
    <Button type="button" size="lg" onClick={onBack}>{session ? 'Done' : <><ArrowLeft aria-hidden="true" /> Back to sign in</>}</Button>
  </div>;
  return <div className="business-access-request">
    <span className="eyebrow">{session ? 'YOUR NEXT ORGANIZATION' : 'BUILD YOUR BUSINESS WITH NITEWIDE'}</span>
    <h2 ref={heading} tabIndex={-1}>{session ? 'Start an organization.' : 'Request access.'}</h2>
    <p>{session ? 'Launch your own event brand with the account you already have.' : 'One workspace for your organization, venues and events. Apply as an owner / creator or authorized manager.'}</p>
    <p id="business-access-review-note">Admin review is required. Access starts only after approval and invitation acceptance.</p>
    <div className="organization-request-note" id="business-access-separation-note">
      <strong>Separate organization. Same Nitewide account.</strong>
      <p>Your existing roles, events and permissions stay unchanged. New access applies only to this organization.</p>
      <p>No venue required. Stripe is needed for paid offerings, not free events or guestlists.</p>
    </div>
    {session && <div className="organization-request-account"><span>Using your Nitewide account</span><strong>{session.user.email}</strong></div>}
    <form id="business-access-request-form" aria-label="Request Business access" aria-describedby="business-access-review-note" aria-busy={busy} onSubmit={submit}>
      <label className="field" htmlFor="business-access-name"><span>Full name</span><Input id="business-access-name" name="displayName" autoComplete="name" required minLength={2} maxLength={120} value={draft.displayName} onChange={update('displayName')} placeholder="Your full name" disabled={busy} /></label>
      {!session && <label className="field" htmlFor="business-access-email"><span>Email address</span><Input id="business-access-email" name="email" type="email" autoComplete="email" required maxLength={320} value={draft.email} onChange={update('email')} placeholder="you@yourbusiness.com" disabled={busy} /></label>}
      <label className="field" htmlFor="business-access-phone"><span>Phone number</span><Input id="business-access-phone" name="phone" type="tel" autoComplete="tel" required minLength={9} maxLength={40} value={draft.phone} onChange={update('phone')} placeholder="(407) 555-0123" disabled={busy} /></label>
      <label className="field" htmlFor="business-access-business"><span>Business name</span><Input id="business-access-business" name="businessName" autoComplete="organization" required minLength={2} maxLength={160} value={draft.businessName} onChange={update('businessName')} placeholder="Your organization or event brand" disabled={busy} /></label>
      <div className="field"><label htmlFor="business-access-role"><span>Your role</span></label><select id="business-access-role" name="role" required value={draft.role} onChange={update('role')} disabled={busy}><option value="" disabled>Select your role</option><option value="owner">Owner / creator</option><option value="manager">Manager</option></select></div>
      <div className="field"><label htmlFor="business-access-details"><span>Tell us about your business</span></label><textarea id="business-access-details" name="details" aria-describedby="business-access-details-hint" required minLength={10} maxLength={2000} rows={session ? 3 : 4} value={draft.details} onChange={update('details')} placeholder="Your venues, events and how you’d like to use Nitewide." disabled={busy} /><small id="business-access-details-hint">10–2,000 characters</small></div>
      <label className="organization-request-authority"><input type="checkbox" name="confirmedAuthority" required checked={authority} disabled={busy}
        aria-describedby="business-access-separation-note" onChange={event => setAuthority(event.target.checked)}/><span>I am the owner or an authorized manager, and I understand this request is for a separate organization.</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? <><LoaderCircle className="nw-loading-icon" aria-hidden="true" /> Sending request…</> : <>Send request <ArrowRight aria-hidden="true" /></>}</Button>
    </form>
    <Button type="button" variant="ghost" className="business-access-back" onClick={onBack} disabled={busy}>{session ? 'Cancel' : <><ArrowLeft aria-hidden="true" /> Back to sign in</>}</Button>
  </div>;
}
