import { useId, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../lib/api';
import { passwordConfirmationError } from '../lib/password-confirmation';

export function PasswordResetDialog({ token, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordId = useId(), confirmationId = useId();
  async function submit(event) {
    event.preventDefault();
    const mismatch = passwordConfirmationError(password, confirmation);
    if (mismatch) { setError(mismatch); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/password-reset/complete', { body: { token, password } });
      onSuccess();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return <Dialog open={Boolean(token)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="auth-modal max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <div className="mini-mark">n.</div>
        <DialogTitle>Reset your password</DialogTitle>
        <DialogDescription>Choose a new password. This link can be used once and expires in one hour.</DialogDescription>
      </DialogHeader>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-password-field"><label htmlFor={passwordId}>New password</label><Input id={passwordId} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        <div className="auth-password-field"><label htmlFor={confirmationId}>Confirm new password</label><Input id={confirmationId} name="confirmPassword" type="password" visibilityLabel="confirmed password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
        {error && <p role="alert" className="error-message">{error}</p>}
        <Button className="primary-action dark-glass-action" disabled={busy}>{busy ? 'Updating…' : 'Reset password'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
