import { useState } from 'react';
import { Check, LoaderCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { profileConfirmation } from '@/lib/profile-confirmation';

const emptyConfirmation = () => ({ email: '', phone: '', phoneTouched: false });

export function BusinessProfile({ session, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState(() => ({ displayName: session.user.displayName, email: session.user.email, phone: session.user.phone || '' }));
  const [confirmation, setConfirmation] = useState(emptyConfirmation);
  const checks = profileConfirmation(session.user, fields, confirmation);

  function cancel() {
    setFields({ displayName: session.user.displayName, email: session.user.email, phone: session.user.phone || '' });
    setError('');
    setConfirmation(emptyConfirmation());
    setEditing(false);
  }
  async function submit(event) {
    event.preventDefault();
    if (!checks.canSave) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const user = await api('/auth/profile', session, { method: 'PATCH', body: JSON.stringify({
        ...fields,
        ...(checks.emailChanged ? { confirmEmail: confirmation.email } : {}),
        ...(checks.phoneChanged ? { confirmPhone: confirmation.phone } : {}),
      }) });
      onUpdated(user);
      setFields({ displayName: user.displayName, email: user.email, phone: user.phone || '' });
      setConfirmation(emptyConfirmation());
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="business-profile-panel" aria-label="Your profile">
    <div className="business-profile-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Profile details</h2><p>Keep the contact information on your Nitewide account current.</p></div></div>
    {saved && <p className="business-profile-success" role="status"><Check size={16} /> Profile updated.</p>}
    <form onSubmit={submit} className="business-profile-form">
      <label className="field"><span>Name</span><Input autoComplete="name" required maxLength={120} disabled={!editing || busy} value={fields.displayName} onChange={(event) => setFields((current) => ({ ...current, displayName: event.target.value }))} /></label>
      <label className="field"><span>Email</span><Input type="email" autoComplete="email" required maxLength={320} disabled={!editing || busy} value={fields.email} onChange={(event) => setFields((current) => ({ ...current, email: event.target.value }))} /></label>
      {editing && checks.emailChanged && <label className="field"><span>Confirm email</span><Input type="email" autoComplete="off" required maxLength={320} disabled={busy} value={confirmation.email} onChange={(event) => setConfirmation((current) => ({ ...current, email: event.target.value }))} aria-invalid={confirmation.email.length > 0 && !checks.emailMatches} />{confirmation.email.length > 0 && !checks.emailMatches && <small className="business-profile-field-error">Email addresses do not match.</small>}</label>}
      <label className="field"><span>Phone</span><Input type="tel" autoComplete="tel" placeholder="Optional" disabled={!editing || busy} value={fields.phone} onChange={(event) => setFields((current) => ({ ...current, phone: event.target.value }))} /></label>
      {editing && checks.phoneChanged && <label className="field"><span>Confirm phone</span><Input type="tel" autoComplete="off" placeholder={fields.phone.trim() ? 'Re-enter phone number' : 'Leave blank to confirm removal'} disabled={busy} value={confirmation.phone} onChange={(event) => setConfirmation((current) => ({ ...current, phone: event.target.value, phoneTouched: true }))} onBlur={() => setConfirmation((current) => ({ ...current, phoneTouched: true }))} aria-invalid={confirmation.phoneTouched && !checks.phoneMatches} />{confirmation.phoneTouched && !checks.phoneMatches && <small className="business-profile-field-error">Phone numbers do not match.</small>}</label>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="business-profile-actions">{editing ? <><Button type="button" variant="outline" onClick={cancel} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !checks.canSave}>{busy && <LoaderCircle className="nw-loading-icon" aria-hidden="true" />}{busy ? 'Saving…' : 'Save changes'}</Button></> : <Button type="button" variant="outline" onClick={() => { setSaved(false); setEditing(true); }}><Pencil size={16} /> Edit</Button>}</div>
    </form>
  </section>;
}
