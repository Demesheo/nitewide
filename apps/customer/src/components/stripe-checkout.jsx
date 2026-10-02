import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import { CheckoutElementsProvider, PaymentElement, ExpressCheckoutElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { PaymentCheckoutForm } from './payment-checkout-form';

const clients = new Map();
function stripeClient(key, stripeAccount) {
  if (!key?.startsWith('pk_test_') || !stripeAccount?.startsWith('acct_')) return Promise.resolve(null);
  const identity = `${key}:${stripeAccount}`;
  if (!clients.has(identity)) clients.set(identity, loadStripe(key, { stripeAccount }).catch(() => null));
  return clients.get(identity);
}
function Form(props) {
  return <PaymentCheckoutForm {...props} checkoutState={useCheckoutElements()} PaymentFields={PaymentElement} ExpressFields={ExpressCheckoutElement} />;
}
export default function StripeCheckout({ config, checkout, ...props }) {
  const [unavailable, setUnavailable] = useState(false);
  const stripe = useMemo(() => config.mode === 'test' ? stripeClient(config.publishableKey, checkout.stripeAccountId) : Promise.resolve(null), [config.mode, config.publishableKey, checkout.stripeAccountId]);
  useEffect(() => { let active = true; stripe.then(client => { if (active) setUnavailable(!client); }); return () => { active = false; }; }, [stripe]);
  const options = useMemo(() => ({ clientSecret: checkout.clientSecret, elementsOptions: { appearance: { theme: 'night', variables: { colorPrimary: '#dfc28a', colorBackground: '#15151b', colorText: '#f5f4f0', colorDanger: '#ff9a9a', borderRadius: '12px', spacingUnit: '4px' } } } }), [checkout.clientSecret]);
  if (unavailable) return <PaymentCheckoutForm {...props} checkoutState={{type:'error'}} />;
  return <CheckoutElementsProvider stripe={stripe} options={options}><Form {...props} /></CheckoutElementsProvider>;
}
