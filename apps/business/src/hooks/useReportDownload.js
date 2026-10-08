import { useLayoutEffect, useRef, useState } from 'react';
import { downloadBusinessReport } from '../lib/report-client.js';
import { reportSessionKey } from '../lib/report-export-session.js';

export function useReportDownload(session, { audience = 'business', onError } = {}) {
  const identity = reportSessionKey(session);
  const current = useRef({ identity }), mounted = useRef(false), pending = useRef(null);
  if (current.current.identity !== identity) current.current = { identity };
  const lifetime = current.current;
  const [state, setState] = useState({});
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => mounted.current && current.current === lifetime;
  const download = async (query) => {
    if (!identity || pending.current?.lifetime === lifetime) return;
    const operation = { lifetime };
    pending.current = operation;
    setState({ lifetime, busy: true, error: '' });
    try { await downloadBusinessReport(session, query, { audience }); }
    catch (error) {
      if (active() && error.name !== 'AbortError') {
        setState({ lifetime, busy: true, error: error.message });
        onError?.(error);
      }
    } finally {
      if (pending.current === operation) pending.current = null;
      if (active()) setState((value) => ({ ...value, busy: false }));
    }
  };
  return { download, exporting: state.lifetime === lifetime && Boolean(state.busy),
    error: state.lifetime === lifetime ? state.error || '' : '' };
}
