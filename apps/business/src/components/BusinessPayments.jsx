import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { writeWorkspaceLocation } from '../lib/workspace-navigation';
import { PaymentAccounts } from './PaymentAccounts';
import { MyCommissions } from './MyCommissions';
import { CommissionStatements } from './CommissionStatements';
import { CommissionSettings } from './CommissionSettings';
import { Button } from './ui/button';
import { LoadingState } from './LoadingState';
import './payment-accounts.css';

const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const readLocation = () => {
  const params = new URLSearchParams(window.location.search);
  return { organizationId: params.get('paymentOrganization') || '', view: params.get('paymentView') === 'commissions' ? 'commissions' : 'business' };
};

function PaymentStats({ currencies }) {
  return <div className="payment-currency-groups">{(currencies.length ? currencies : [{ currency: 'USD', collectedCents: 0, refundedCents: 0, netCollectedCents: 0 }]).map(row => <section key={row.currency} aria-label={`${row.currency} payments`}>
    <div className="payment-stat-grid">{[
      ['Customer payments', row.collectedCents, 'Verified bookings, including those later refunded.'],
      ['Refunded payments', row.refundedCents, 'Full customer refunds verified by Stripe.'],
      ['Remaining payments', row.netCollectedCents, 'Customer payments less refunds—not your Stripe balance.'],
    ].map(([label, amount, detail]) => <div className="payment-stat" key={label}><span>{label}</span><strong>{money(amount, row.currency)}</strong><small>{detail}</small></div>)}</div>
  </section>)}</div>;
}

function PaymentOverview({ session, organization, request }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const path = `/business/organizations/${organization.id}/payment-overview`;
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
    <div className="section-heading"><div><span className="eyebrow">PAYMENT ACTIVITY</span><h2>Business payments</h2><p>{organization.name} · All-time verified Stripe{result?.mode === 'test' ? ' sandbox' : ''} bookings.</p></div><Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />Refresh payments</Button></div>
    {error ? <p className="error" role="alert">{error}</p> : !result ? <LoadingState>Loading payments…</LoadingState> : <>
      <PaymentStats currencies={result.currencies} />
      <div className="payment-payout-note"><p>{result.pendingOrders} pending bookings · {result.reviewOrders} payments needing review</p><p>Stripe manages balances, processing fees and bank payouts. View those in your Stripe dashboard; the booking totals above are not available funds. Legacy mock purchases are excluded.</p></div>
    </>}
  </section>;
}

export function BusinessPayments({ session, organizations = [], organizationId, canViewEarnings = false, request = api }) {
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
    {personal ? <MyCommissions key={`commissions:${session.user.id}:${organizationId}`} organizationId={organizationId} session={session} request={request} /> : <PaymentOverview key={`overview:${session.user.id}:${organization.id}`} session={session} organization={organization} request={request} />}
    {!personal && <PaymentAccounts key={`accounts:${session.user.id}:${organization.id}`} session={session} organization={organization} request={request} />}
    {!personal && <CommissionStatements key={`statements:${session.user.id}:${organization.id}`} session={session} organization={organization} request={request} />}
    {!personal && <CommissionSettings key={`commission-settings:${session.user.id}:${organization.id}`} session={session} organizationId={organization.id} request={request} />}
  </div>;
}
