import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// A stored token is not proof of current Business access. Only a successful
// bootstrap may open the workspace; any refresh failure clears that snapshot.
export function useBusinessBootstrap(session, onboardingToken, onUnauthorized, onAccessRequired) {
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [pending, setPending] = useState(null);
  const [revision, setRevision] = useState(0);
  const token = session?.accessToken;
  const error = token && failure?.token === token && failure.revision === revision ? failure.message : '';
  const data = token && !error && snapshot?.token === token ? snapshot.data : null;
  const loading = Boolean(token && !onboardingToken && ((!data && !error) || (pending?.token === token && pending.revision === revision)));
  useEffect(() => {
    if (!session) { setSnapshot(null); setFailure(null); setPending(null); return; }
    if (onboardingToken) return;
    const controller = new AbortController();
    setPending({ token, revision }); setFailure(null);
    api('/business/bootstrap', session, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setSnapshot({ token, revision, data: result }); })
      .catch((failure) => { if (failure.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setSnapshot(null);
        if (failure.status === 401) onUnauthorized();
        else if (failure.status === 403 && failure.code === 'BUSINESS_ACCESS_REQUIRED' && onAccessRequired) onAccessRequired();
        else setFailure({ token, revision, message: failure.status === 404
          ? 'The business app and API are on different versions. Refresh after the API is updated.' : failure.message });
      })
      .finally(() => { if (!controller.signal.aborted) setPending(null); });
    return () => controller.abort();
  }, [session, token, onboardingToken, revision, onUnauthorized, onAccessRequired]);
  return { data, loading, error, revision, setRevision };
}
