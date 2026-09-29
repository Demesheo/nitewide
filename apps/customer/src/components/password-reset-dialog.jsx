import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
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
        <div className="auth-password-field"><label htmlFor={passwordId}>New password</label><div className="password-input-wrap"><Input id={passwordId} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
        <div className="auth-password-field"><label htmlFor={confirmationId}>Confirm new password</label><div className="password-input-wrap"><Input id={confirmationId} type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><button type="button" aria-label={showConfirmation ? 'Hide confirmed password' : 'Show confirmed password'} onClick={() => setShowConfirmation(!showConfirmation)}>{showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
        {error && <p role="alert" className="error-message">{error}</p>}
        <Button className="primary-action dark-glass-action" disabled={busy}>{busy ? 'Updating…' : 'Reset password'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
