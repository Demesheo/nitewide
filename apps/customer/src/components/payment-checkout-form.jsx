import { useRef, useState } from 'react';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';

const EXPRESS_OPTIONS = {
  buttonTheme: { applePay: 'white', googlePay: 'white' },
  buttonHeight: 48,
  layout: { maxColumns: 2, maxRows: 0, overflow: 'never' },
  paymentMethodOrder: ['apple_pay', 'google_pay', 'link'],
  // `always` broadens supported browsers; Stripe still checks device, domain
  // and currency eligibility. Link's funding choices stay inside its wallet.
  paymentMethods: { applePay: 'always', googlePay: 'always', link: 'auto', paypal: 'never', amazonPay: 'never', klarna: 'never' },
};
const PAYMENT_OPTIONS = { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } };

// Keeping provider state injectable makes the confirmation flow testable
// without loading Stripe.js or submitting card information.
export function PaymentCheckoutForm({ checkoutState, PaymentFields, ExpressFields, onCheck, onVerify, onBusyChange, amount }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [walletsAvailable, setWalletsAvailable] = useState(null);
  const lock = useRef(false);
  const ready = checkoutState.type === 'success';
  async function confirm(expressCheckoutConfirmEvent) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); onBusyChange(true);
    try {
      // Check before every card/wallet confirmation. A successful payment with
      // a lost response opens passes instead of submitting payment again.
      if (!await onCheck()) return;
      if (!ready) throw new Error('Your booking is still unpaid. Refresh the page to reload the secure payment form; your original booking is saved.');
      const result = await checkoutState.checkout.confirm({ redirect: 'if_required', ...(expressCheckoutConfirmEvent ? { expressCheckoutConfirmEvent } : {}) });
      if (result.type === 'error') { setError(result.error.message || 'Payment could not be confirmed.'); return; }
      await onVerify();
    } catch (err) { setError(err.message || 'We couldn’t check your payment. Try Pay again to check your original booking.'); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  return <form className="stripe-payment-form" onSubmit={event => { event.preventDefault(); confirm(); }}>
    {checkoutState.type === 'loading' && <LoadingIndicator>Loading secure payment form…</LoadingIndicator>}
    {checkoutState.type === 'error' && <p role="alert">The payment form couldn’t load. Pay will check for a completed booking; otherwise refresh the page to reload the secure form.</p>}
    {ready && ExpressFields && <div className="stripe-express-checkout" hidden={walletsAvailable === false}>
      {walletsAvailable === null && <LoadingIndicator>Checking express payment options…</LoadingIndicator>}
      <ExpressFields onConfirm={confirm} options={EXPRESS_OPTIONS}
        onAvailablePaymentMethodsChange={({ paymentMethods }) => setWalletsAvailable(Boolean(paymentMethods?.applePay?.available || paymentMethods?.googlePay?.available || paymentMethods?.link?.available))}
        onLoadError={() => setWalletsAvailable(false)} />
      {walletsAvailable && <p className="stripe-payment-divider">Or pay with card</p>}
    </div>}
    {ready && <PaymentFields options={PAYMENT_OPTIONS} />}
    {error && <p role="alert" className="error-message">{error}</p>}
    <Button type="submit" className="primary-action dark-glass-action" disabled={busy}>{busy ? <LoadingIndicator>Checking your booking…</LoadingIndicator> : `Pay ${ready ? checkoutState.checkout.total.total.amount : amount || ''}`.trim()}</Button>
    <p className="fine-print">Sandbox payment · use test payment details only.</p>
  </form>;
}
