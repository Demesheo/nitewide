import { useRef, useState } from 'react';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';

// Keeping provider state injectable makes the confirmation flow testable
// without loading Stripe.js or submitting card information.
export function PaymentCheckoutForm({ checkoutState, PaymentFields, ExpressFields, onVerify, onBusyChange }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (checkoutState.type === 'loading') return <LoadingIndicator>Loading secure payment form…</LoadingIndicator>;
  if (checkoutState.type === 'error') return <p role="alert">The payment form couldn’t load: {checkoutState.error.message}. You can check or cancel this booking below.</p>;
  async function confirm(expressCheckoutConfirmEvent) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); onBusyChange(true);
    try {
      const result = await checkoutState.checkout.confirm({ redirect: 'if_required', ...(expressCheckoutConfirmEvent ? { expressCheckoutConfirmEvent } : {}) });
      if (result.type === 'error') { setError(result.error.message || 'Payment could not be confirmed.'); return; }
      await onVerify();
    } catch (err) { setError(err.message || 'We couldn’t check your payment. Use Check booking below.'); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  return <form className="stripe-payment-form" onSubmit={event => { event.preventDefault(); confirm(); }}>
    {ExpressFields && <ExpressFields onConfirm={confirm} options={{ buttonTheme: { applePay: 'white', googlePay: 'white' }, layout: { maxColumns: 1 }, paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never', klarna: 'never' } }} />}
    <PaymentFields options={{ layout: 'tabs', wallets: { link: 'never' } }} />
    {error && <p role="alert" className="error-message">{error}</p>}
    <Button type="submit" className="primary-action dark-glass-action" disabled={busy}>{busy ? <LoadingIndicator>Checking your booking…</LoadingIndicator> : `Pay ${checkoutState.checkout.total.total.amount}`}</Button>
    <p className="fine-print">Sandbox payment · use test payment details only.</p>
  </form>;
}
