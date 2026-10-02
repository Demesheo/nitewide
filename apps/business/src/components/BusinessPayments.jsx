import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { writeWorkspaceLocation } from '../lib/workspace-navigation';
import { PaymentAccounts } from './PaymentAccounts';
import { Button } from './ui/button';
import { LoadingState } from './LoadingState';
import './payment-accounts.css';

const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const readLocation = () => {
  const params = new URLSearchParams(window.location.search);
  return { organizationId: params.get('paymentOrganization') || '', view: params.get('paymentView') === 'commissions' ? 'commissions' : 'business' };
};

function PaymentStats({ currencies, personal = false }) {
  return <div className="payment-currency-groups">{(currencies.length ? currencies : [personal
    ? { currency: 'USD', verifiedEarnedCents: 0, verifiedRefundedCents: 0, demoEarnedCents: 0 }
    : { currency: 'USD', collectedCents: 0, refundedCents: 0, netCollectedCents: 0 }]).map(row => <section key={row.currency} aria-label={`${row.currency} ${personal ? 'commissions' : 'payments'}`}>
    <div className="payment-stat-grid">{(personal ? [
      ['Verified commissions', row.verifiedEarnedCents, 'Recorded on verified Stripe sandbox bookings.'],
      ['Refunded commissions', row.verifiedRefundedCents, 'Not payable after a full booking refund.'],
      ['Demo commissions', row.demoEarnedCents, 'Mock bookings only. No money was received.'],
    ] : [
      ['Customer payments', row.collectedCents, 'Verified bookings, including those later refunded.'],
      ['Refunded payments', row.refundedCents, 'Full customer refunds verified by Stripe.'],
      ['Remaining payments', row.netCollectedCents, 'Customer payments less refunds—not your Stripe balance.'],
    ]).map(([label, amount, detail]) => <div className="payment-stat" key={label}><span>{label}</span><strong>{money(amount, row.currency)}</strong><small>{detail}</small></div>)}</div>
  </section>)}</div>;
}

function PaymentOverview({ session, organization, personal, request }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const path = personal ? '/business/payments/earnings' : `/business/organizations/${organization.id}/payment-overview`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request(path, session, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(err => { if (!controller.signal.aborted) { setResult(null); setError(err.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, session.accessToken, revision, request]);
  return <section className="panel payment-overview" aria-busy={loading}>
    <div className="section-heading"><div><span className="eyebrow">{personal ? 'YOUR EARNINGS' : 'PAYMENT ACTIVITY'}</span><h2>{personal ? 'My commissions' : 'Business payments'}</h2><p>{personal ? 'Only commissions attributed to your referrals. Businesses fund these separately from Nitewide’s fee.' : `${organization.name} · All-time verified Stripe sandbox bookings.`}</p></div><Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />Refresh {personal ? 'commissions' : 'payments'}</Button></div>
    {error ? <p className="error" role="alert">{error}</p> : !result ? <LoadingState>Loading {personal ? 'commissions' : 'payments'}…</LoadingState> : <>
      <PaymentStats currencies={result.currencies} personal={personal} />
      {personal ? <div className="payment-payout-note"><div><h3>Commission rate locked at 0%</h3><p>Your individual Stripe onboarding must be completed and payout eligibility verified before you can earn new commissions or receive payouts. A business’s Stripe setup does not unlock your personal commission rate. Historical earnings remain recorded.</p></div><div><h3>Payouts received</h3><p>Not available yet. Personal Stripe payout accounts and business-funded commission transfers have not been connected. Earned commissions are not proof of payment.</p></div><a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer">Open your Stripe dashboard <ExternalLink size={16} aria-hidden="true" /></a><small>Sign in to your own Stripe account. This does not connect it to Nitewide or grant access to a business account.</small></div>
        : <div className="payment-payout-note"><p>{result.pendingOrders} pending bookings · {result.reviewOrders} payments needing review</p><p>Stripe manages balances, processing fees and bank payouts. View those in your Stripe dashboard; the booking totals above are not available funds. Legacy mock purchases are excluded.</p></div>}
    </>}
  </section>;
}

export function BusinessPayments({ session, organizations = [], canViewEarnings = false, request = api }) {
  const [location, setLocation] = useState(readLocation);
  const financeOrganizations = organizations.filter(org => org.canManageFinance);
  const personal = canViewEarnings && (location.view === 'commissions' || !financeOrganizations.length);
  const organization = financeOrganizations.find(org => org.id === location.organizationId) || financeOrganizations[0];
  useEffect(() => {
    const restore = () => setLocation(readLocation());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function choose(view, organizationId = organization?.id || '') {
    const next = { view, organizationId: view === 'commissions' ? '' : organizationId };
    writeWorkspaceLocation({ paymentView: view === 'commissions' ? 'commissions' : null, paymentOrganization: next.organizationId || null, paymentAccountReturn: null });
    setLocation(next);
  }
  if (!organization && !canViewEarnings) return <section className="panel"><h2>Payments access required</h2><p>Business owners, finance-authorized managers and commission earners can view their relevant payment information.</p></section>;
  return <div className="business-payments">
    {financeOrganizations.length > 0 && canViewEarnings && <div className="payment-view-selector" aria-label="Payment views"><Button variant={!personal ? 'default' : 'outline'} aria-pressed={!personal} onClick={() => choose('business')}>Business payments</Button><Button variant={personal ? 'default' : 'outline'} aria-pressed={personal} onClick={() => choose('commissions')}>My commissions</Button></div>}
    {!personal && financeOrganizations.length > 1 && <label className="payment-organization-select" htmlFor="payments-organization">Business<select id="payments-organization" value={organization.id} onChange={event => choose('business', event.target.value)}>{financeOrganizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    <PaymentOverview key={`overview:${session.user.id}:${personal ? 'own' : organization.id}`} session={session} organization={organization} personal={personal} request={request} />
    {!personal && <PaymentAccounts key={`accounts:${session.user.id}:${organization.id}`} session={session} organization={organization} request={request} />}
  </div>;
}
