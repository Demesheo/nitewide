import { useEffect, useRef, useState } from 'react';
import { detectCurrentCity } from '../discovery-defaults';
import { qualifiedDiscoveryCity } from './discovery-selection';

export function useCurrentCity({ onStart, onDetected, detectCity = detectCurrentCity }) {
  const [status, setStatus] = useState('idle');
  const request = useRef(null);
  const revision = useRef(0);
  const callbacks = useRef({ onStart, onDetected });
  callbacks.current = { onStart, onDetected };
  function cancel() {
    revision.current += 1;
    request.current?.abort();
    request.current = null;
    setStatus('idle');
  }
  async function locate() {
    request.current?.abort();
    const controller = new AbortController();
    const requestRevision = ++revision.current;
    request.current = controller;
    callbacks.current.onStart?.();
    setStatus('finding');
    const active = () => !controller.signal.aborted && revision.current === requestRevision;
    try {
      // Device coordinates are used only by this explicitly activated lookup;
      // discovery receives and remembers the resulting qualified city only.
      const city = qualifiedDiscoveryCity(await detectCity({ requestPrecise: true, signal: controller.signal }));
      if (!active()) return;
      if (city) { callbacks.current.onDetected(city); setStatus('idle'); }
      else setStatus('error');
    } catch {
      if (active()) setStatus('error');
    } finally { if (request.current === controller) request.current = null; }
  }
  useEffect(() => () => { revision.current += 1; request.current?.abort(); }, []);
  return { locating: status === 'finding', error: status === 'error', locate, cancel };
}
