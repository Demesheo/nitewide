import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { LoadingState } from './LoadingState';
import './payment-accounts.css';

export function stripeOnboardingUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.stripe.com')) throw new Error('Stripe returned an invalid onboarding link. Try again.');
  return url.href;
}
export function PaymentAccounts({ session, organization, request = api, navigate = url => window.location.assign(url) }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const creation = useRef(null);
  const base = `/business/organizations/${organization.id}/payment-accounts`;
  useEffect(() => {
    if (!organization.canManageFinance) return;
    const controller = new AbortController();
    setError('');
    request(`${base}?page=${page}&pageSize=10`, session, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, session.accessToken, revision, page, organization.canManageFinance]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('paymentAccountReturn');
    if (!organization.canManageFinance || !id || params.get('paymentOrganization') !== organization.id) return;
    let active = true;
    setBusy(id);
    request(`${base}/${encodeURIComponent(id)}/synchronize`, session, { method: 'POST' })
      .then(() => { if (active) { setNotice('Payment readiness checked with Stripe.'); setRevision(value => value + 1); } })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) { setBusy(''); const url = new URL(window.location.href); url.searchParams.delete('paymentAccountReturn'); url.searchParams.delete('paymentOrganization'); window.history.replaceState({}, '', url); } });
    return () => { active = false; };
  }, [base, organization.canManageFinance, session.accessToken]);
  if (!organization.canManageFinance) return null;
  async function action(identity, path, options, after) {
    if (busy) return;
    setBusy(identity); setError(''); setNotice('');
    try { const result = await request(path, session, options); await after?.(result); setRevision(value => value + 1); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  function create(event) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;
    if (creation.current?.name !== label) creation.current = { name: label, idempotencyKey: crypto.randomUUID() };
    action('new', base, { method: 'POST', body: JSON.stringify(creation.current) }, () => { creation.current = null; setName(''); setNotice('Payment account created. Complete Stripe setup to accept payments.'); });
  }
  return <section className="panel payment-accounts" aria-busy={Boolean(busy)}>
    <div className="section-heading"><div><span className="eyebrow">PAYMENTS</span><h2>Payment accounts</h2><p>Your business takes payment directly through Stripe. Connect a named account for each business or payout destination.</p></div><a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer">Stripe dashboard ↗</a></div>
    <p className="hint">Sandbox setup · Stripe manages processing fees and payouts. Free events and guestlists remain available without a payment account.</p>
    {error && <><p className="error" role="alert">{error}</p><Button variant="outline" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}>Retry payment accounts</Button></>}{notice && <p className="notice" role="status">{notice}</p>}
    {!data ? <LoadingState>Loading payment accounts…</LoadingState> : <>
      <label className="payment-account-default">Default account<select aria-label="Default payment account" value={data.defaultPaymentAccountId || ''} disabled={Boolean(busy)} onChange={event => action('default', `${base}/default`, { method: 'PUT', body: JSON.stringify({ paymentAccountId: event.target.value || null }) }, () => setNotice('Default payment account updated.'))}><option value="">No default account</option>{data.defaultPaymentAccountId && !data.items.some(item => item.id === data.defaultPaymentAccountId) && <option value={data.defaultPaymentAccountId}>Current default · another page</option>}{data.items.map(account => <option key={account.id} value={account.id}>{account.name}{account.paymentsReady ? ' · Ready' : ' · Setup required'}</option>)}</select></label>
      <div className="payment-profile-list">{data.items.map(account => <article className="payment-profile" key={account.id}>
        <div><h3>{account.name}</h3><span className="status-pill">{account.paymentsReady ? 'Ready for sandbox payments' : 'Setup required'}</span>{account.id === data.defaultPaymentAccountId && <small>Organization default</small>}<p className="hint">{account.detailsSubmitted ? 'Business details submitted' : 'Business details needed'} · {account.chargesEnabled ? 'Charges enabled' : 'Charges not enabled'} · {account.payoutsEnabled ? 'Payouts enabled' : 'Payouts not enabled'}</p></div>
        <div className="payment-profile-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={() => action(account.id, `${base}/${account.id}/onboarding`, { method: 'POST' }, result => navigate(stripeOnboardingUrl(result.url)))}>{account.paymentsReady ? 'Update Stripe details' : 'Complete Stripe setup'}</Button><Button variant="ghost" disabled={Boolean(busy)} onClick={() => action(account.id, `${base}/${account.id}/synchronize`, { method: 'POST' }, () => setNotice('Payment readiness checked with Stripe.'))}>Check readiness</Button></div>
      </article>)}</div>
      {!data.items.length && <p>No payment accounts yet. Add one below to start Stripe setup.</p>}
      {data.total > 10 && <div className="payment-profile-actions"><Button variant="outline" disabled={page === 1 || Boolean(busy)} onClick={() => setPage(value => value - 1)}>Previous accounts</Button><span>Page {page}</span><Button variant="outline" disabled={!data.hasMore || Boolean(busy)} onClick={() => setPage(value => value + 1)}>Next accounts</Button></div>}
    </>}
    <form className="payment-account-create" onSubmit={create}><label htmlFor={`payment-account-name-${organization.id}`}>New account name<Input id={`payment-account-name-${organization.id}`} value={name} maxLength={120} placeholder="e.g. Downtown venue" disabled={Boolean(busy)} onChange={event => setName(event.target.value)} /></label><Button type="submit" disabled={Boolean(busy) || !name.trim()}>Add payment account</Button></form>
  </section>;
}

export function EventPaymentAccount({ event, session, request = api, onSaved }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(event.paymentAccountId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!event.organizationId || !event.canManageFinance) return;
    const controller = new AbortController();
    request(`/business/organizations/${event.organizationId}/payment-accounts?page=${page}&pageSize=50`, session, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(previous => page === 1 ? result : { ...result, items: [...new Map([...(previous?.items || []), ...result.items].map(item => [item.id, item])).values()] }); }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [event.id, event.organizationId, event.canManageFinance, session.accessToken, page]);
  if (!event.organizationId || !event.canManageFinance) return null;
  const locked = event.canChangePaymentAccount === false;
  async function save() {
    setBusy(true); setError('');
    try { await request(`/business/events/${event.id}/payment-account`, session, { method: 'PUT', body: JSON.stringify({ paymentAccountId: selected || null }) }); onSaved?.('Event payment account updated.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel payment-accounts"><h3>Event payments</h3><p className="hint">Choose which account receives payments for this event. This choice locks once a payment is pending or paid.</p>{error && <p className="error" role="alert">{error}</p>}<label>Payment account<select aria-label="Event payment account" disabled={busy || locked || !data} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Organization default{data?.defaultPaymentAccountId ? ` · ${data.items.find(item => item.id === data.defaultPaymentAccountId)?.name || 'Selected account'}` : ' · Not set'}</option>{selected && !data?.items.some(item => item.id === selected) && <option value={selected}>Current payment account</option>}{data?.items.map(account => <option key={account.id} value={account.id}>{account.name}{account.paymentsReady ? ' · Ready' : ' · Setup required'}</option>)}</select></label>{data?.hasMore && <Button variant="ghost" disabled={busy} onClick={() => setPage(value => value + 1)}>Load more payment accounts</Button>}<Button variant="outline" disabled={busy || locked || !data || selected === (event.paymentAccountId || '')} onClick={save}>Save payment account</Button>{locked && <p className="hint" role="status">The payment account is locked because this event has pending or paid bookings.</p>}</section>;
}
