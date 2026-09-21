import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
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

export function AuthDialog({ open, onOpenChange, onSuccess }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRegister(false);
      setError("");
    }
  }, [open]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = { email: form.get("email"), password: form.get("password") };
    if (register)
      Object.assign(body, {
        displayName: form.get("name"),
        marketingConsent: form.get("marketing") === "on",
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
      <DialogContent className="auth-modal">
        <DialogHeader>
          <div className="mini-mark">n.</div>
          <p className="eyebrow">GOOD NIGHTS START HERE</p>
          <DialogTitle>
            {register ? "Make yourself a regular." : "Welcome back."}
          </DialogTitle>
          <DialogDescription>
            {register
              ? "One account. Every kind of night."
              : "Your next great night is waiting for you."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="auth-form">
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
          <label>
            Password
            <Input
              name="password"
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
            />
          </label>
          {register && (
            <>
              <p className="fine-print">
                Use 8+ characters, including uppercase, lowercase, and a number.
              </p>
              <label className="checkbox-label">
                <input type="checkbox" name="marketing" />
                Email me event recommendations and updates.
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button disabled={busy} className="primary-action">
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <>
                {register ? "Create account" : "Sign in"}
                <ArrowRight />
              </>
            )}
          </Button>
        </form>
        <p className="auth-switch">
          {register ? "Already part of the night?" : "New around here?"}{" "}
          <button
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "Sign in" : "Create an account"}
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
