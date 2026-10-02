import { useCallback, useEffect, useRef, useState } from 'react';
import { lazy, Suspense } from 'react';
const MyCommissions = lazy(() => import('../../../business/src/components/MyCommissions').then(module => ({ default: module.MyCommissions })));
import { api } from '../lib/api';
import { Button } from './ui/button';

export function ReferralEarnings({ session }) {
  const token = session?.accessToken, currentToken = useRef(token); currentToken.current = token;
  const [available, setAvailable] = useState(false), [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has('commissionProfileReturn'));
  const [availableFor, setAvailableFor] = useState(null);
  const request = useCallback((path, identity, { body, ...options } = {}) => identity?.accessToken && identity.accessToken === currentToken.current ? api(path, { token: identity.accessToken, ...options, ...(body ? { body: JSON.parse(body) } : {}) }) : Promise.reject(new Error('Sign in to view referral earnings.')), []);
  useEffect(() => {
    setAvailable(false); setAvailableFor(null);
    if (!token) return;
    const controller = new AbortController();
    Promise.allSettled([api('/account/commission-payment-profile', { token, signal: controller.signal }), api('/account/commission-earnings', { token, signal: controller.signal })]).then(([profileResult, earningsResult]) => {
      const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
      const earnings = earningsResult.status === 'fulfilled' ? earningsResult.value : null;
      if (!controller.signal.aborted && currentToken.current === token) { setAvailable(Boolean(profile?.canAccessCommissions || profile?.id || earnings?.currencies?.some(row => row.verifiedEarnedCents > 0 || row.demoEarnedCents > 0 || row.unpaidCommissionCents > 0 || row.paidCommissionCents > 0))); setAvailableFor(token); }
    });
    return () => controller.abort();
  }, [token]);
  if (!token || !available || availableFor !== token) return null;
  return <section className="customer-referral-earnings"><Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close referral earnings' : 'Referral earnings'}</Button>{open && <Suspense fallback={<p role="status">Opening referral earnings…</p>}><MyCommissions session={session} request={request} returnTo="customer" /></Suspense>}</section>;
}
