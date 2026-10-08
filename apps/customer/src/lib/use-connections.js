import { useEffect, useState } from 'react';
import { api } from './api';

// Never show a previous account's eligibility or people while switching sessions.
export function useConnections(session, revision) {
  const token = session?.accessToken;
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!token) { setSnapshot(null); return; }
    const controller = new AbortController();
    async function load() {
      if (controller.signal.aborted) return;
      try {
        const data = await api('/customer/connections/summary', { token, signal: controller.signal });
        if (!controller.signal.aborted) setSnapshot({ token, data });
      } catch { /* Leave navigation stable until the next navigation or refresh. */ }
    }
    Promise.resolve().then(load);
    return () => controller.abort();
  }, [token, revision]);
  return token && snapshot?.token === token ? snapshot.data : null;
}
