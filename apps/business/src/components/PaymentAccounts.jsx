import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from '../lib/api';
import { writeWorkspaceLocation } from '../lib/workspace-navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { LoadingState } from './LoadingState';
import { PaymentConnectionDialog } from './PaymentConnectionDialog';
import './payment-accounts.css';

export function stripeOnboardingUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'connect.stripe.com' || url.username || url.password || url.port) throw new Error();
    return url.href;
  } catch { throw new Error('Stripe returned an invalid onboarding link. Try again.'); }
}
export function PaymentAccounts({ session, organization, request = api, navigate = url => window.location.assign(url) }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [openingAccount, setOpeningAccount] = useState('');
  const [setupLink, setSetupLink] = useState(null);
  const [connection,setConnection] = useState(null);
  const setupRequest = useRef(null);
  const creation = useRef(null);
  const base = `/business/organizations/${organization.id}/payment-accounts`;
  useEffect(() => {
    setSetupLink(null); setBusy(''); setOpeningAccount(''); setNotice(''); setConnection(null);
    return () => { setupRequest.current?.abort(); setupRequest.current = null; };
  }, [base, session.accessToken, organization.canManageFinance]);
  useEffect(() => {
    if (!setupLink) return;
    const timer = setTimeout(() => {
      setSetupLink(null); setNotice(''); setError('Your Stripe setup link expired. Please try again.');
    }, Math.max(0, setupLink.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [setupLink]);
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
    if (!organization.canManageFinance || !id || (params.get('paymentOrganization') || params.get('workspaceOrganization')) !== organization.id) return;
    let active = true;
    setBusy(id);
    request(`${base}/${encodeURIComponent(id)}/synchronize`, session, { method: 'POST' })
      .then(() => { if (active) { setNotice('Payment readiness checked with Stripe.'); setRevision(value => value + 1); } })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) { setBusy(''); writeWorkspaceLocation({ section: 'payments', paymentOrganization: organization.id }, { replace: true }); } });
    return () => { active = false; };
  }, [base, organization.canManageFinance, session.accessToken]);
  if (!organization.canManageFinance) return null;
  async function action(identity, path, options, after) {
    if (busy || setupRequest.current) return;
    setBusy(identity); setError(''); setNotice('');
    try { const result = await request(path, session, options); await after?.(result); setRevision(value => value + 1); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function openStripeSetup(account) {
    if (busy || setupRequest.current) return;
    const controller = new AbortController();
    setupRequest.current = controller;
    setBusy(account.id); setOpeningAccount(account.id); setError(''); setSetupLink(null);
    setNotice('Preparing your secure Stripe setup…');
    try {
      const result = await request(`${base}/${account.id}/onboarding`, session, {
        method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      if (controller.signal.aborted) return;
      const url = stripeOnboardingUrl(result?.url);
      const expiresAt = Date.parse(result?.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Your Stripe setup link expired. Please try again.');
      // Keep this single-use link in memory only. A regular link is available
      // if the browser blocks automatic navigation after the async request.
      setSetupLink({ accountId: account.id, url, expiresAt });
      setNotice('Stripe setup is ready. If it did not open automatically, select Continue to Stripe.');
      await navigate(url);
    } catch (err) {
      if (!controller.signal.aborted) {
        setNotice('');
        setError(err.name === 'TimeoutError' ? 'Stripe setup took too long to respond. Please try again.' : err.message || 'Stripe setup could not be opened. Please try again.');
      }
    } finally {
      if (setupRequest.current === controller) { setupRequest.current = null; setBusy(''); setOpeningAccount(''); }
    }
  }
  function create(event) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;
    if (creation.current?.name !== label) creation.current = { name: label, idempotencyKey: crypto.randomUUID() };
    action('new', base, { method: 'POST', body: JSON.stringify(creation.current) }, () => { creation.current = null; setName(''); setNotice('Payment account created. Complete Stripe setup to accept payments.'); });
  }
  return <section className="panel payment-accounts" aria-busy={Boolean(busy)}>
    <div className="section-heading"><div><span className="eyebrow">STRIPE CONNECTIONS</span><h2>Payment accounts</h2><p>Your business takes payment directly through Stripe. Connect a named merchant account for each business or venue.</p></div><a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer">Stripe dashboard ↗</a></div>
    <p className="hint">Sandbox setup · Stripe manages processing fees and payouts. Free events and guestlists remain available without a payment account.</p>
    {error && <><p className="error" role="alert">{error}</p><Button variant="outline" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}>Retry payment accounts</Button></>}{notice && <p className="notice" role="status">{notice}</p>}
    {!data ? <LoadingState>Loading payment accounts…</LoadingState> : <>
      {data.sharedSandboxAccount && <SharedSandboxNotice account={data.sharedSandboxAccount} busy={Boolean(busy)} onRefresh={() => setRevision(value => value + 1)} />}
      <label className="payment-account-default">Default account<select aria-label="Default payment account" value={data.defaultPaymentAccountId || ''} disabled={Boolean(busy) || Boolean(data.sharedSandboxAccount)} onChange={event => action('default', `${base}/default`, { method: 'PUT', body: JSON.stringify({ paymentAccountId: event.target.value || null }) }, () => setNotice('Default payment account updated.'))}><option value="">No default account</option>{data.defaultPaymentAccountId && !data.items.some(item => item.id === data.defaultPaymentAccountId) && <option value={data.defaultPaymentAccountId}>Current default · another page</option>}{data.items.map(account => <option key={account.id} value={account.id} disabled={account.lifecycleState === 'archived' || Boolean(account.paymentsDisabledAt)}>{account.name}{account.disconnectStatus === 'disconnected' ? ' · Disconnected' : account.paymentsDisabledAt ? ' · Payments disabled' : account.paymentsReady ? ' · Ready' : ' · Setup required'}</option>)}</select></label>
      <div className="payment-profile-list">{data.items.map(account => <article className="payment-profile" key={account.id}>
        <div><h3>{account.name}</h3><span className="status-pill">{account.disconnectStatus === 'disconnected' || account.lifecycleState === 'archived' ? 'Disconnected · history retained' : account.disconnectStatus === 'pending' ? 'Disconnection pending · payments disabled' : account.paymentsDisabledAt ? 'New payments disabled' : account.paymentsReady ? 'Ready for sandbox payments' : 'Setup required'}</span>{account.id === data.defaultPaymentAccountId && <small>Organization default</small>}<p className="hint">{account.detailsSubmitted ? 'Business details submitted' : 'Business details needed'} · {account.chargesEnabled ? 'Stripe charges enabled' : 'Charges not enabled'} · {account.payoutsEnabled ? 'Payouts enabled' : 'Payouts not enabled'}</p></div>
        <div className="payment-profile-controls">{account.lifecycleState !== 'archived' && <div className="payment-profile-actions"><Button variant="outline" disabled={Boolean(busy) || account.disconnectStatus === 'pending'} onClick={() => openStripeSetup(account)}>{openingAccount === account.id ? <><LoaderCircle className="payment-setup-spinner" size={16} aria-hidden="true" />Opening Stripe…</> : account.paymentsReady ? 'Update Stripe details' : 'Complete Stripe setup'}</Button><Button variant="ghost" disabled={Boolean(busy) || account.disconnectStatus === 'pending'} onClick={() => action(account.id, `${base}/${account.id}/synchronize`, { method: 'POST' }, () => setNotice('Payment readiness checked with Stripe.'))}>Check readiness</Button></div>}
        {data.canDisconnectPayments && account.lifecycleState !== 'archived' && account.stripeAccountId !== data.sharedSandboxAccount?.stripeAccountId && <div className="payment-profile-actions payment-connection-actions">
          {account.disconnectStatus !== 'pending' && <Button variant="outline" disabled={Boolean(busy)} onClick={() => setConnection({account,mode:account.paymentsDisabledAt ? 'resume' : 'disable'})}>{account.paymentsDisabledAt ? 'Resume payments' : 'Disable new payments'}</Button>}
          {account.stripeAccountId && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setConnection({account,mode:'disconnect'})}>{account.disconnectStatus === 'pending' ? 'Check disconnection' : 'Disconnect Stripe'}</Button>}
        </div>}
        {setupLink?.accountId === account.id && <a className="payment-setup-link" href={setupLink.url} rel="noreferrer" onClick={event => {
          if (setupLink.expiresAt <= Date.now()) { event.preventDefault(); setSetupLink(null); setError('Your Stripe setup link expired. Please try again.'); }
        }}>Continue to Stripe ↗</a>}</div>
      </article>)}</div>
      {!data.items.length && <p>{data.sharedSandboxAccount ? 'This business uses the shared sandbox merchant above. A separate Stripe account is not needed for these test purchases.' : 'No payment accounts yet. Add one below to start Stripe setup.'}</p>}
      {data.total > 10 && <div className="payment-profile-actions"><Button variant="outline" disabled={page === 1 || Boolean(busy)} onClick={() => setPage(value => value - 1)}>Previous accounts</Button><span>Page {page}</span><Button variant="outline" disabled={!data.hasMore || Boolean(busy)} onClick={() => setPage(value => value + 1)}>Next accounts</Button></div>}
    </>}
    {!data?.sharedSandboxAccount && <form className="payment-account-create" onSubmit={create}><label htmlFor={`payment-account-name-${organization.id}`}>New account name<Input id={`payment-account-name-${organization.id}`} value={name} maxLength={120} placeholder="e.g. Downtown venue" disabled={Boolean(busy)} onChange={event => setName(event.target.value)} /></label><Button type="submit" disabled={Boolean(busy) || !name.trim()}>Add payment account</Button></form>}
    {connection && <PaymentConnectionDialog key={`${base}-${connection.account.id}-${connection.mode}`} {...connection} base={base} session={session} request={request} onClose={() => {setConnection(null);setRevision(value=>value+1);}} onSaved={(saved,mode) => {
      setRevision(value=>value+1);setSetupLink(null);
      setNotice(saved.disconnectStatus === 'disconnected' ? 'Stripe disconnected. Booking history and passes are retained.' : saved.disconnectStatus === 'pending' ? 'New payments disabled. Stripe disconnection is still being checked.' : mode === 'resume' ? 'Stripe readiness verified. New payments resumed.' : 'New paid bookings disabled. Existing passes and history are retained.');
    }}/>}
  </section>;
}

function SharedSandboxNotice({ account, busy, onRefresh }) {
  return <div className="notice shared-sandbox-notice" role="status">
    <strong>Shared sandbox payments</strong>
    <p>All new test purchases use <code>{account.stripeAccountId}</code>. No real money is moved. Individual account choices are preserved and resume when shared testing is turned off.</p>
    <p>{account.paymentsReady ? 'Stripe readiness verified.' : 'Stripe readiness is not confirmed. Paid checkout remains unavailable.'}</p>
    <Button variant="outline" disabled={busy} onClick={onRefresh}>Refresh shared account</Button>
  </div>;
}

export function EventPaymentAccount({ event, session, request = api, onSaved }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(event.paymentAccountId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!event.organizationId || !event.canManageFinance) return;
    const controller = new AbortController();
    request(`/business/organizations/${event.organizationId}/payment-accounts?page=${page}&pageSize=50`, session, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(previous => page === 1 ? result : { ...result, items: [...new Map([...(previous?.items || []), ...result.items].map(item => [item.id, item])).values()] }); }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [event.id, event.organizationId, event.canManageFinance, session.accessToken, page, revision]);
  if (!event.organizationId || !event.canManageFinance) return null;
  const locked = event.canChangePaymentAccount === false;
  if (data?.sharedSandboxAccount) return <section className="panel payment-accounts"><h3>Event payments</h3><SharedSandboxNotice account={data.sharedSandboxAccount} busy={busy} onRefresh={() => setRevision(value => value + 1)} />{error && <p className="error" role="alert">{error}</p>}</section>;
  async function save() {
    setBusy(true); setError('');
    try { await request(`/business/events/${event.id}/payment-account`, session, { method: 'PUT', body: JSON.stringify({ paymentAccountId: selected || null }) }); onSaved?.('Event payment account updated.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel payment-accounts"><h3>Event payments</h3><p className="hint">Changes apply to future payments. Existing orders and refunds keep their original account.</p>{error && <p className="error" role="alert">{error}</p>}<label>Payment account<select aria-label="Event payment account" disabled={busy || locked || !data} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Organization default{data?.defaultPaymentAccountId ? ` · ${data.items.find(item => item.id === data.defaultPaymentAccountId)?.name || 'Selected account'}` : ' · Not set'}</option>{selected && !data?.items.some(item => item.id === selected) && <option value={selected}>Current payment account</option>}{data?.items.map(account => <option key={account.id} value={account.id}>{account.name}{account.paymentsReady ? ' · Ready' : ' · Setup required'}</option>)}</select></label>{data?.hasMore && <Button variant="ghost" disabled={busy} onClick={() => setPage(value => value + 1)}>Load more payment accounts</Button>}<Button variant="outline" disabled={busy || locked || !data || selected === (event.paymentAccountId || '')} onClick={save}>Save payment account</Button>{locked && <p className="hint" role="status">Resolve pending checkouts, payments needing review, and outstanding refunds to change this account.</p>}</section>;
}
