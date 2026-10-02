import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { api } from '../lib/api';
import { stripeOnboardingUrl } from './PaymentAccounts';
import { Button } from './ui/button';
import { actionIdentity, forgetAction } from '../../../shared/action-identity';
import './commissions.css';

const base = '/account/commission-payment-profile';
export function PersonalCommissionConnection({ session, request = api, navigate = url => window.location.assign(url), onChanged, returnTo = 'business' }) {
  const [profile, setProfile] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [setup, setSetup] = useState(null);
  const lock = useRef(false), pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    request(base, session, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setProfile(result); onChanged?.(result); } }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [session.accessToken, revision]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const returnId = url.searchParams.get('commissionProfileReturn');
    if (!returnId || returnId !== profile?.id) return;
    url.searchParams.delete('commissionProfileReturn');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    act('synchronize');
  }, [profile?.id]);
  useEffect(() => {
    if (!setup) return;
    const timer = setTimeout(() => { setSetup(null); setNotice(''); setError('Your Stripe setup link expired. Please try again.'); }, Math.max(0, setup.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [setup]);
  async function act(mode) {
    if (lock.current) return;
    const controller = new AbortController(); pending.current = controller;
    lock.current = true; setBusy(mode); setError(''); setNotice('');
    try {
      let account = profile;
      if (mode === 'onboarding' && !account?.stripeAccountId) {
        const payload = { displayName: account?.displayName || session.user.displayName || 'Personal commissions' };
        const scope = `commission-profile.${session.user.id}`;
        account = await request(base, session, { method: 'POST', signal: controller.signal, body: JSON.stringify({ ...payload, idempotencyKey: account?.creationRequestId || actionIdentity(scope, payload) }) });
        if (controller.signal.aborted) return;
        forgetAction(scope); setProfile(account);
      }
      if (mode === 'onboarding') {
        setNotice('Preparing your secure Stripe setup…');
        const result = await request(`${base}/onboarding`, session, { method: 'POST', signal: controller.signal, body: JSON.stringify({ returnTo }) });
        if (controller.signal.aborted) return;
        const url = stripeOnboardingUrl(result.url), expiresAt = Date.parse(result.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Your Stripe setup link expired. Please try again.');
        setSetup({ url, expiresAt }); setNotice('Stripe setup is ready. Select Continue to Stripe if it did not open.'); await navigate(url);
      } else if (mode === 'dashboard') {
        const { url: value } = await request(`${base}/dashboard`, session, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'dashboard.stripe.com' || url.username || url.password || url.port) throw new Error('Stripe returned an invalid dashboard link. Please try again.');
        await navigate(url.href);
      } else {
        const result = await request(`${base}/${mode}`, session, { method: 'POST', signal: controller.signal });
        if (controller.signal.aborted) return;
        setProfile(result); onChanged?.(result); setNotice(mode === 'synchronize' ? 'Your individual Stripe eligibility was checked.' : 'Your personal Stripe connection was updated.');
      }
    } catch (err) { if (!controller.signal.aborted) { setNotice(''); setError(err.message); } } finally { if (pending.current === controller) { pending.current = null; lock.current = false; if (!controller.signal.aborted) setBusy(''); } }
  }
  const eligible = profile?.eligibility?.eligible === true;
  return <section className="panel commission-connection" aria-busy={Boolean(busy)}><div className="section-heading"><div><span className="eyebrow">YOUR STRIPE ACCOUNT</span><h3>{eligible ? 'Individual Stripe account verified' : 'Commission rate locked at 0%'}</h3><p>{eligible ? 'Your verified personal account can receive eligible business-funded commission payments.' : 'Complete your individual Stripe setup and verify readiness before earning new commissions. A business’s Stripe account does not unlock your personal rate.'}</p></div></div><p className="hint">Standard Stripe account · Full Stripe Dashboard · Historical earnings remain recorded. Commissions are paid separately by the business using its own bank account or card.</p>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!profile && !error ? <p role="status">Loading your Stripe connection…</p> : <><div className="commission-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={() => act('onboarding')}>{busy === 'onboarding' ? <><LoaderCircle size={16} className="payment-setup-spinner" aria-hidden="true" />Opening Stripe…</> : eligible ? 'Update personal Stripe details' : 'Connect personal Stripe account'}</Button><Button variant="ghost" disabled={Boolean(busy) || !profile?.id} onClick={() => act('synchronize')}>{busy === 'synchronize' ? 'Checking readiness…' : 'Check personal readiness'}</Button>{profile?.stripeAccountId && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => act('dashboard')}>Open full Stripe Dashboard <ExternalLink size={16} aria-hidden="true" /></Button>}</div>{setup && <a href={setup.url} className="payment-setup-link" onClick={event => { if (setup.expiresAt <= Date.now()) { event.preventDefault(); setSetup(null); setError('Your Stripe setup link expired. Please try again.'); } }}>Continue to Stripe ↗</a>}{profile && <p className="hint">{profile.eligibility?.reason?.replaceAll('_', ' ') || profile.eligibility?.status?.replaceAll('_', ' ') || 'Setup required'} · {profile.cardReady ? 'Card payments ready' : 'Card payments not ready'} · {profile.bankReady ? 'Bank payments ready' : 'Bank payments not ready'}</p>}</>}</section>;
}
