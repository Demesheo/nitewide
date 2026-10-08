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
    // StrictMode replays mount effects in development. Start only the surviving
    // read, while still aborting real navigation/account changes immediately.
    Promise.resolve().then(() => controller.signal.aborted ? undefined : api('/customer/my-events/access', { token, signal: controller.signal }))
      .then(data => {
        if (controller.signal.aborted) return;
        if (typeof data?.eligible !== 'boolean') throw new Error('We couldn’t check your event access. Please try again.');
        setSnapshot(current => ({ token, eligible: data.eligible, checking: false, error: '', requestRevision: revision, successRevision: current?.token === token ? (current.successRevision || 0) + 1 : 1 }));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        const denied = error.status === 401 || error.status === 403;
        const transient = error.status === undefined || error.status >= 500;
        setSnapshot(current => ({ token, eligible: Boolean(transient && current?.token === token && current.eligible), checking: false, requestRevision: revision,
          error: denied ? '' : 'We couldn’t check your event access. Please try again.',
          successRevision: current?.token === token ? current.successRevision || 0 : 0 }));
      });
    return () => controller.abort();
  }, [token, revision]);

  const current = token && snapshot?.token === token ? snapshot : null;
  const entering = previous.current.token === token && active && !previous.current.active;
  return { eligible: current?.eligible === true, loading: Boolean(token && (entering || !current || current.checking || current.requestRevision !== revision)), error: current?.error || '', successRevision: current?.successRevision || 0, recheck, invalidate };
}
