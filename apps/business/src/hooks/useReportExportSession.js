import { useLayoutEffect } from 'react';
import { releaseReportExportSession, reportSessionKey, setReportExportSession } from '../lib/report-export-session.js';

// The shell owns this lifetime so changing report tabs does not cancel exports.
export function useReportExportSession(session, audience = 'business') {
  const identity = reportSessionKey(session);
  useLayoutEffect(() => {
    const scope = setReportExportSession(session, audience);
    return () => releaseReportExportSession(scope, audience);
  }, [identity, audience]);
}
