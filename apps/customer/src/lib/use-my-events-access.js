import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// Capability snapshots live only in memory and are always scoped to the token.
export function useMyEventsAccess(session, active) {
  const token = session?.accessToken;
  const [snapshot, setSnapshot] = useState(null);
  const [revision, setRevision] = useState(0);
  const previous = useRef({ token: null, active: false });
  const recheck = useCallback(() => setRevision(value => value + 1), []);
  const invalidate = useCallback(() => { setSnapshot(null); recheck(); }, [recheck]);

  useEffect(() => {
    if (previous.current.token === token && active && !previous.current.active) recheck();
    previous.current = { token, active };
  }, [token, active, recheck]);

  useEffect(() => {
    if (!token) { setSnapshot(null); return; }
    const controller = new AbortController();
    setSnapshot(current => current?.token === token ? { ...current, checking: true, error: '' } : null);
    api('/customer/my-events/access', { token, signal: controller.signal })
      .then(data => {
        if (typeof data?.eligible !== 'boolean') throw new Error('We couldn’t check your event access. Please try again.');
        if (!controller.signal.aborted) setSnapshot(current => ({ token, eligible: data.eligible, checking: false, error: '', successRevision: current?.token === token ? (current.successRevision || 0) + 1 : 1 }));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        const denied = error.status === 401 || error.status === 403;
        const transient = error.status === undefined || error.status >= 500;
        setSnapshot(current => ({ token, eligible: Boolean(transient && current?.token === token && current.eligible), checking: false,
          error: denied ? '' : 'We couldn’t check your event access. Please try again.',
          successRevision: current?.token === token ? current.successRevision || 0 : 0 }));
      });
    return () => controller.abort();
  }, [token, revision]);

  useEffect(() => {
    if (!active || !token) return;
    const onFocus = () => { if (!document.hidden) recheck(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, token, recheck]);

  const current = token && snapshot?.token === token ? snapshot : null;
  return { eligible: current?.eligible === true, loading: Boolean(token && (!current || current.checking)), error: current?.error || '', successRevision: current?.successRevision || 0, recheck, invalidate };
}
