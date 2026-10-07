import { useEffect, useId, useState } from "react";
import { LoadingIndicator } from './loading-indicator';
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { api } from "../lib/api";
import { passwordConfirmationError } from "../lib/password-confirmation";
import { TermsAcceptance, termsAcceptance } from '../../../shared/terms-and-conditions.jsx';

export function AuthDialog({ open, onOpenChange, onSuccess, guestlistInviteToken }) {
  const [register, setRegister] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const passwordInputId = useId(), confirmInputId = useId();
  const confirmationErrorId = useId();
  const confirmationError = register ? passwordConfirmationError(password, confirmPassword) : "";
  const showMismatch = register && Boolean(confirmPassword) && Boolean(confirmationError);
  useEffect(() => {
    if (open) {
      setRegister(Boolean(guestlistInviteToken));
      setForgot(false);
      setMessage('');
      setError("");
      setPhone("");
      setPassword("");
      setConfirmPassword("");
      setTermsAccepted(false);
    }
  }, [open]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    if (forgot) {
      setBusy(true); setMessage('');
      try {
        await api('/auth/password-reset/request', { body: { email: form.get('email') } });
        setMessage('If this email has an account, a reset link will arrive shortly.');
      } catch (failure) {
        setError(failure.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const body = { email: form.get("email"), password: form.get("password") };
    if (register) {
      if (!termsAccepted) {
        setError('Please agree to the Nitewide terms and conditions to create an account.');
        event.currentTarget.elements.namedItem('termsAccepted')?.focus();
        return;
      }
      const message = passwordConfirmationError(body.password, form.get("confirmPassword"));
      if (message) {
        setError(message);
        event.currentTarget.elements.namedItem("confirmPassword")?.focus();
        return;
      }
    }
    setBusy(true);
    if (register)
      Object.assign(body, {
        displayName: form.get("name"),
        phone: form.get("phone"),
        marketingConsent: form.get("marketing") === "on",
        ...termsAcceptance,
        ...(guestlistInviteToken ? { guestlistInviteToken } : {}),
      });
    try {
      onSuccess(
        await api(`/auth/${register ? "register" : "sign-in"}`, { body }),
      );
      onOpenChange(false);
    } catch (error) {
      setError(
        error.status === 409
          ? "An account with this email already exists. Try signing in."
          : error.message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setError("");
          onOpenChange(value);
        }
      }}
    >
      <DialogContent className="auth-modal max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="mini-mark">n.</div>
          <p className="eyebrow">GOOD NIGHTS START HERE</p>
          <DialogTitle>
            {forgot ? 'Reset your password.' : register ? "Make yourself a regular." : "Welcome back."}
          </DialogTitle>
          <DialogDescription>
            {forgot ? 'Enter your account email to receive a one-time reset link.' : register
              ? guestlistInviteToken ? "Create an account with the invited email or phone to claim your guestlist place, if space remains." : "One account. Every kind of night."
              : "Your next great night is waiting for you."}
          </DialogDescription>
        </DialogHeader>
        <form id="customer-auth-form" aria-label="Customer authentication" onSubmit={submit} className="auth-form">
          {register && (
            <label>
              Your name
              <Input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
                placeholder="Jordan Smith"
              />
            </label>
          )}
          <label>
            Email address
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          {!forgot && <div className="auth-password-field"><label htmlFor={passwordInputId}>Password</label>
            <Input
              id={passwordInputId}
              name="password"
              key={register ? "register" : "sign-in"}
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength={register ? 8 : 1}
              maxLength={128}
              required
              pattern={
                register ? "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" : undefined
              }
              title="At least 8 characters with an uppercase letter, a lowercase letter and a number"
              placeholder="Your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>}
          {register && !forgot && (
            <>
              <div className="auth-password-field"><label htmlFor={confirmInputId}>Confirm password</label>
                <Input
                  id={confirmInputId}
                  name="confirmPassword"
                  type="password"
                  visibilityLabel="confirmed password"
                  autoComplete="new-password"
                  maxLength={128}
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={showMismatch || undefined}
                  aria-describedby={showMismatch ? confirmationErrorId : undefined}
                />
              </div>
              {showMismatch && <p id={confirmationErrorId} role="status" className="error-message">{confirmationError}</p>}
              <label>
                Phone number <span className="optional-label">Optional</span>
                <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 407 555 0123" />
              </label>
              <p className="fine-print">
                Use 8+ characters, including uppercase, lowercase, and a number.
              </p>
              <label className="checkbox-label">
                <input type="checkbox" name="marketing" />
                Email me event recommendations and updates.
              </label>
              <TermsAcceptance accepted={termsAccepted} onChange={setTermsAccepted} disabled={busy}/>
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {message && <p role="status" className="fine-print">{message}</p>}
          <Button disabled={busy || (register && !forgot && (!termsAccepted || Boolean(confirmationError)))} className={register ? "primary-action" : "primary-action dark-glass-action"}>
            {busy ? (
              <LoadingIndicator>{forgot ? 'Sending…' : register ? 'Creating account…' : 'Signing in…'}</LoadingIndicator>
            ) : (
              <>
                {forgot ? 'Send reset link' : register ? "Create account" : "Sign in"}
                <ArrowRight />
              </>
            )}
          </Button>
        </form>
        {!forgot && !register && <p className="auth-switch"><button disabled={busy} onClick={() => { setForgot(true); setError(''); setMessage(''); }}>Forgot password?</button></p>}
        <p className="auth-switch">
          {forgot ? <button disabled={busy} onClick={() => { setForgot(false); setError(''); setMessage(''); }}>Back to sign in</button> : <>
          {register ? "Already part of the night?" : "New around here?"}{" "}
          <button
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setTermsAccepted(false);
              setError("");
              setPassword("");
              setConfirmPassword("");
            }}
          >
            {register ? "Sign in" : "Create an account"}
          </button>
          </>}
        </p>
      </DialogContent>
    </Dialog>
  );
}
