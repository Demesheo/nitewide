import { useEffect, useState } from 'react';
import { api } from './api';

// Never show a previous account's eligibility or people while switching sessions.
export function useConnections(session, revision) {
  const token = session?.accessToken;
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!token) { setSnapshot(null); return; }
    const controller = new AbortController(); let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await api('/customer/connections/summary', { token, signal: controller.signal });
        if (!controller.signal.aborted) setSnapshot({ token, data });
      } catch { /* Leave navigation stable on a transient failure; retry on focus. */ }
      finally { inFlight = false; }
    }
    refresh();
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, [token, revision]);
  return token && snapshot?.token === token ? snapshot.data : null;
}
