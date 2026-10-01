import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../lib/api';
import { passwordConfirmationError } from '../lib/password-confirmation';

const emptyPasswords = () => ({ currentPassword: '', password: '', confirmPassword: '' });

export function ProfilePasswordForm({ session, open, disabled = false, onBusyChange, onSessionChanged, onCancel }) {
  const [fields, setFields] = useState(emptyPasswords);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => { if (!open) { setFields(emptyPasswords()); setError(''); setSaved(false); } }, [open]);
  const mismatch = fields.confirmPassword.length > 0 && fields.password !== fields.confirmPassword;
  async function submit(event) {
    event.preventDefault();
    if (busy || disabled) return;
    setError(''); setSaved(false);
    const confirmationError = passwordConfirmationError(fields.password, fields.confirmPassword);
    if (confirmationError) { setError(confirmationError); return; }
    if (fields.password.length < 8 || fields.password.length > 128 || !/[a-z]/.test(fields.password) || !/[A-Z]/.test(fields.password) || !/[0-9]/.test(fields.password)) { setError('Use 8–128 characters, including uppercase, lowercase and a number.'); return; }
    if (fields.currentPassword === fields.password) { setError('Choose a different new password.'); return; }
    setBusy(true); onBusyChange?.(true);
    try {
      const updated = await api('/auth/password/change', { token: session.accessToken, body: fields });
      onSessionChanged(updated);
      setFields(emptyPasswords()); setSaved(true);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <form className="profile-form profile-password-form" aria-labelledby="customer-password-title" onSubmit={submit}>
    <h3 className="sr-only" id="customer-password-title">Change password</h3>
    <p id="customer-password-help">Use 8–128 characters with uppercase, lowercase and a number. Other sessions will be signed out.</p>
    {[
      ['currentPassword', 'Current password', 'current-password', 'current password'],
      ['password', 'New password', 'new-password', 'new password'],
      ['confirmPassword', 'Confirm new password', 'new-password', 'confirmed new password'],
    ].map(([name, label, autoComplete, visibilityLabel]) => <div className="profile-password-field" key={name}><label htmlFor={`customer-profile-${name}`}>{label}</label><Input id={`customer-profile-${name}`} name={name} type="password" autoComplete={autoComplete} visibilityLabel={visibilityLabel} required maxLength={128} value={fields[name]} disabled={disabled || busy} onChange={(event) => { setError(''); setSaved(false); setFields((current) => ({ ...current, [name]: event.target.value })); }} aria-describedby={name === 'password' ? 'customer-password-help' : name === 'confirmPassword' && mismatch ? 'customer-password-mismatch' : undefined} aria-invalid={name === 'confirmPassword' && mismatch} />{name === 'confirmPassword' && mismatch && <small id="customer-password-mismatch" className="profile-password-error">Passwords do not match.</small>}</div>)}
    {error && <p className="profile-password-error" role="alert">{error}</p>}
    {saved && <p className="profile-message" role="status"><Check size={16} aria-hidden="true" /> Password changed. Other sessions have been signed out.</p>}
    <div className="profile-form-actions"><Button type="button" variant="outline" disabled={disabled || busy} onClick={onCancel}>Cancel password change</Button><Button type="submit" aria-busy={busy} disabled={disabled || busy || !fields.currentPassword || !fields.password || !fields.confirmPassword || mismatch}>{busy ? 'Changing…' : 'Change password'}</Button></div>
  </form>;
}
