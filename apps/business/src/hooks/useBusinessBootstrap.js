import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Keep a successful authorized snapshot during same-user refresh failures, but
// never expose it to a different session while that user's fetch is pending.
export function useBusinessBootstrap(session, onboardingToken, onUnauthorized) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const token = session?.accessToken;
  const data = token && snapshot?.token === token ? snapshot.data : null;
  useEffect(() => {
    if (!session) { setSnapshot(null); setLoading(false); setError(''); return; }
    if (onboardingToken) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/business/bootstrap', session, { signal: controller.signal })
      .then((result) => setSnapshot({ token, data: result }))
      .catch((failure) => { if (failure.name === 'AbortError') return;
        if (failure.status === 401) onUnauthorized();
        else setError(failure.status === 404
          ? 'The business app and API are on different versions. Refresh after the API is updated.' : failure.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, token, onboardingToken, revision, onUnauthorized]);
  return { data, loading, error, revision, setRevision };
}
