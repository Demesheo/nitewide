import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

const emptyPasswords = () => ({ currentPassword: '', password: '', confirmPassword: '' });

export function ProfilePassword({ session, onSessionChanged, disabled = false, onBusyChange, onCancel }) {
  const [fields, setFields] = useState(emptyPasswords);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const mismatch = fields.confirmPassword.length > 0 && fields.password !== fields.confirmPassword;

  async function submit(event) {
    event.preventDefault();
    if (busy || disabled) return;
    setSaved(false); setError('');
    if (fields.password !== fields.confirmPassword) { setError('Passwords do not match.'); return; }
    if (fields.password.length < 8 || fields.password.length > 128 || !/[a-z]/.test(fields.password) || !/[A-Z]/.test(fields.password) || !/[0-9]/.test(fields.password)) {
      setError('Use 8–128 characters, including uppercase, lowercase and a number.'); return;
    }
    if (fields.currentPassword === fields.password) { setError('Choose a different new password.'); return; }
    setBusy(true); onBusyChange?.(true);
    try {
      const updated = await api('/auth/password/change', session, { method: 'POST', body: JSON.stringify(fields) });
      // Replace the complete session, not only the identity: the old token is revoked.
      onSessionChanged(updated);
      setFields(emptyPasswords()); setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  return <form className="business-profile-form business-profile-password" aria-labelledby="profile-password-title" onSubmit={submit}>
    <div><h3 className="sr-only" id="profile-password-title">Change password</h3><p className="business-profile-password-help" id="profile-password-help">Use 8–128 characters with uppercase, lowercase and a number. Other sessions will be signed out.</p></div>
    {[
      ['currentPassword', 'Current password', 'current-password', 'current password'],
      ['password', 'New password', 'new-password', 'new password'],
      ['confirmPassword', 'Confirm new password', 'new-password', 'confirmed new password'],
    ].map(([name, label, autoComplete, visibilityLabel]) => <div className="field" key={name}><label htmlFor={`profile-${name}`}>{label}</label><Input id={`profile-${name}`} name={name} type="password" autoComplete={autoComplete} visibilityLabel={visibilityLabel} required maxLength={128} disabled={busy || disabled} value={fields[name]} onChange={(event) => { setError(''); setSaved(false); setFields((current) => ({ ...current, [name]: event.target.value })); }} aria-describedby={name === 'password' ? 'profile-password-help' : name === 'confirmPassword' && mismatch ? 'profile-password-mismatch' : undefined} aria-invalid={name === 'confirmPassword' && mismatch} />{name === 'confirmPassword' && mismatch && <small id="profile-password-mismatch" className="business-profile-field-error">Passwords do not match.</small>}</div>)}
    {error && <p className="error" role="alert">{error}</p>}
    {saved && <p className="business-profile-success" role="status"><Check size={16} aria-hidden="true" /> Password changed. Other sessions have been signed out.</p>}
    <div className="business-profile-actions"><Button type="button" variant="outline" disabled={busy || disabled} onClick={onCancel}>Cancel password change</Button><Button type="submit" disabled={busy || disabled || !fields.currentPassword || !fields.password || !fields.confirmPassword || mismatch}>{busy && <LoaderCircle className="nw-loading-icon" aria-hidden="true" />}{busy ? 'Changing…' : 'Change password'}</Button></div>
  </form>;
}
