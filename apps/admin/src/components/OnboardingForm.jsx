import React, { useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const blankVenue = () => ({ name: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: 'US', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, privacy: 'public' });

function ReviewRow({ title, children }) {
  return <div><dt>{title}</dt><dd>{children}</dd></div>;
}

export default function OnboardingForm({ onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState('organization');
  const [recipient, setRecipient] = useState({ displayName: '', email: '', phone: '' });
  const [organization, setOrganization] = useState({ name: '', slug: '', description: '', planTier: 'free' });
  const [venues, setVenues] = useState([blankVenue()]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const business = kind !== 'independent_creator';
  const steps = ['Recipient', business ? 'Business & venues' : 'Creator profile', 'Review & invite'];

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (step < 2) { setStep(step + 1); return; }
    setBusy(true);
    try {
      setResult(await api('/admin/onboarding', { method: 'POST', body: JSON.stringify({ kind, recipient, ...(business ? { organization, venues } : {}), reason }) }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function changeKind(value) {
    setKind(value);
    if (value === 'venue') setVenues((previous) => [previous[0] || blankVenue()]);
  }
  function updateVenue(index, key, value) {
    setVenues((previous) => previous.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }

  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
    <DialogContent className="dialog management-dialog">
      <DialogHeader>
        <DialogTitle>Onboard business or creator</DialogTitle>
        <DialogDescription>The recipient confirms their email and sets their own password; existing accounts sign in to accept access.</DialogDescription>
      </DialogHeader>
      {result ? <div className="success">
        <b>Onboarding prepared.</b>
        <p>{result.delivery === 'queued' ? 'Setup email is queued. Delivery is not yet confirmed.' : 'Email was not sent because delivery is unavailable. The pending profile is saved; configure delivery and resend from Account onboarding invitations.'}</p>
        <p>Invitation expires {new Date(result.expiresAt).toLocaleString()}. No password or setup link is exposed to administrators.</p>
        <Button onClick={() => onSaved(result)}>Done</Button>
      </div> : <>
        <ol className="management-stepper" aria-label="Onboarding progress">
          {steps.map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined}>{index + 1}. {title}</li>)}
        </ol>
        <form onSubmit={submit}>
          {step === 0 && <section aria-label="Recipient">
            <label>Business type
              <select value={kind} onChange={(event) => changeKind(event.target.value)}>
                <option value="organization">Organization · one or multiple venues</option>
                <option value="venue">Venue · one location</option>
                <option value="independent_creator">Independent event creator</option>
              </select>
            </label>
            <h3>Recipient</h3>
            <div className="management-form">
              {[['displayName', 'Full name', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone (optional)', 'tel']].map(([key, title, type]) => <label key={key}>{title}
                <Input type={type} value={recipient[key]} required={key !== 'phone'} maxLength={key === 'email' ? 320 : key === 'phone' ? 32 : 120} onChange={(event) => setRecipient({ ...recipient, [key]: event.target.value })}/>
              </label>)}
            </div>
          </section>}
          {step === 1 && (business ? <section aria-label="Business and venues">
            <h3>Business profile</h3>
            <div className="management-form">
              {[['name', 'Business name'], ['slug', 'Public slug'], ['description', 'Description']].map(([key, title]) => <label key={key}>{title}
                <Input value={organization[key]} required={key !== 'description'} onChange={(event) => setOrganization({ ...organization, [key]: event.target.value })}/>
              </label>)}
              <label>Plan
                <select value={organization.planTier} onChange={(event) => setOrganization({ ...organization, planTier: event.target.value })}>
                  <option>free</option><option>premium</option>
                </select>
              </label>
            </div>
            <h3>Venues</h3>
            {venues.map((venue, index) => <fieldset key={index}>
              <legend>Venue {index + 1}</legend>
              <div className="management-form">
                {[['name', 'Venue name'], ['addressLine1', 'Street address'], ['addressLine2', 'Address line 2'], ['city', 'City'], ['region', 'State / region'], ['postalCode', 'Postal code'], ['countryCode', 'Country code'], ['timezone', 'IANA timezone']].map(([key, title]) => <label key={key}>{title}
                  <Input value={venue[key]} required={['name', 'addressLine1', 'city', 'countryCode', 'timezone'].includes(key)} maxLength={key === 'postalCode' ? 24 : key === 'countryCode' ? 2 : key === 'timezone' ? 64 : 180} onChange={(event) => updateVenue(index, key, event.target.value)}/>
                </label>)}
                <label>Address privacy
                  <select value={venue.privacy} onChange={(event) => updateVenue(index, 'privacy', event.target.value)}>
                    {['public', 'attendees_only', 'private'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              {kind === 'organization' && venues.length > 1 && <Button type="button" variant="outline" onClick={() => setVenues(venues.filter((_, position) => position !== index))}>Remove venue from this draft</Button>}
            </fieldset>)}
            {kind === 'organization' && <Button type="button" variant="outline" disabled={venues.length >= 25} onClick={() => setVenues([...venues, blankVenue()])}>Add another venue</Button>}
          </section> : <section aria-label="Creator profile">
            <h3>Independent creator profile</h3>
            <p>{recipient.displayName} will receive an invitation at {recipient.email}. After accepting, they can create and manage independent events.</p>
            <p>No business or venue is required for this account type.</p>
          </section>)}
          {step === 2 && <section aria-label="Review and invite">
            <h3>Review invitation</h3>
            <dl className="management-review">
              <ReviewRow title="Account type">{kind === 'independent_creator' ? 'Independent event creator' : kind === 'venue' ? 'Venue' : 'Organization'}</ReviewRow>
              <ReviewRow title="Recipient">{recipient.displayName} · {recipient.email}{recipient.phone ? ` · ${recipient.phone}` : ''}</ReviewRow>
              {business && <>
                <ReviewRow title="Business">{organization.name} · {organization.slug} · {organization.planTier} plan{organization.description ? ` · ${organization.description}` : ''}</ReviewRow>
                <ReviewRow title="Venues">{venues.map((venue, index) => <span key={index} className="management-review-venue">{venue.name} · {venue.addressLine1}{venue.addressLine2 ? `, ${venue.addressLine2}` : ''}, {venue.city}{venue.region ? `, ${venue.region}` : ''} {venue.postalCode} · {venue.countryCode} · {venue.timezone} · {venue.privacy.replaceAll('_', ' ')}</span>)}</ReviewRow>
              </>}
            </dl>
            <label className="management-reason">Required audit reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required/>
            </label>
            <p className="guardrail">The recipient chooses their own password. The setup link is sent by email and is never shown here.</p>
          </section>}
          {error && <div className="error" role="alert">{error}</div>}
          <div className="management-dialog-actions">
            {step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { setStep(step - 1); setError(''); }}>Back</Button>}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Preparing…' : step === 2 ? 'Prepare and invite recipient' : 'Continue'}</Button>
          </div>
        </form>
      </>}
    </DialogContent>
  </Dialog>;
}
