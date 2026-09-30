import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { downloadPreparedExport } from '../lib/report-client';
import { Button } from './ui/button';

export function PreparedExports({ session, request = api, className = 'panel' }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!session?.accessToken) return;
    let active = true;
    const refresh = () => request('/business/reports/exports', session).then((value) => { if (active) setJobs(value); }).catch(() => {});
    const progress = (event) => { if (active && event.detail?.id) setJobs((current) => [event.detail, ...current.filter((job) => job.id !== event.detail.id)].slice(0,20)); };
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('nitewide:export-progress', progress);
    return () => { active = false; clearInterval(timer); window.removeEventListener('nitewide:export-progress', progress); };
  }, [session?.accessToken, request]);
  if (!jobs.length) return null;
  return <details className={className} data-testid="prepared-exports"><summary>Prepared exports · {jobs.length}</summary>
    <p className="muted">Downloads stay available for 24 hours. Access is checked again before download.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {jobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0"><strong className="break-words">{job.filename || 'Business report'}</strong><p className="muted" role="status">
        {job.status === 'ready' ? `${job.totalRows.toLocaleString()} rows · Ready` : job.status === 'failed' ? job.error
          : job.status === 'rendering' ? `Preparing · ${job.progress}%` : job.status === 'snapshotting' ? 'Capturing report snapshot…' : 'Queued…'}
      </p></div>
      {['ready', 'failed'].includes(job.status) && <Button variant="outline" disabled={busy === job.id} onClick={async () => {
        setBusy(job.id); setError('');
        try {
          if (job.status === 'ready') await downloadPreparedExport(session, job.id, job.filename);
          else { await request(`/business/reports/exports/${job.id}/retry`, session, { method: 'POST' }); setJobs(await request('/business/reports/exports', session)); }
        } catch (err) { setError(err.message); }
        finally { setBusy(null); }
      }}>{job.status === 'ready' ? <><ArrowDownToLine size={16}/>Download</> : <><RefreshCw size={16}/>Retry</>}</Button>}
    </div>)}
  </details>;
}
