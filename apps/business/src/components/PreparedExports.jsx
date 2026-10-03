import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { downloadPreparedExport } from '../lib/report-client';
import { Button } from './ui/button';

export function PreparedExports({ session, request = api, className = 'panel', audience = 'business' }) {
  const prefix = audience === 'admin' ? 'admin' : 'business';
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const lifecycle = useRef(null);
  useEffect(() => {
    setJobs([]); setError(''); setBusy(null);
    if (!session?.accessToken) return;
    let active = true;
    let latestRequest = 0, revision = 0;
    const updates = new Map();
    const update = (job) => {
      if (!active) return;
      updates.set(job.id, ++revision);
      setJobs((current) => [job, ...current.filter((value) => value.id !== job.id)].slice(0, 20));
    };
    const refresh = async () => {
      const requestId = ++latestRequest, startedAtRevision = revision;
      const value = await request(`/${prefix}/reports/exports`, session);
      if (!active || requestId !== latestRequest) return;
      if (!Array.isArray(value)) throw new Error('Unable to load prepared exports. Please try again.');
      // A snapshot started before a progress event must not erase that event.
      // The next snapshot stays authoritative, so expired jobs can leave.
      const newer = new Set([...updates].filter(([, version]) => version > startedAtRevision).map(([id]) => id));
      for (const [id, version] of updates) if (version <= startedAtRevision) updates.delete(id);
      setJobs((current) => [...current.filter((job) => newer.has(job.id)), ...value.filter((job) => !newer.has(job.id))].slice(0, 20));
    };
    const scope = { isActive: () => active, refresh, update };
    lifecycle.current = scope;
    const progress = (event) => {
      if (event.detail?.id && (event.detail.audience || 'business') === prefix) update(event.detail);
    };
    const backgroundRefresh = () => refresh().catch(() => {});
    backgroundRefresh();
    const timer = setInterval(backgroundRefresh, 15000);
    window.addEventListener('nitewide:export-progress', progress);
    return () => {
      active = false;
      if (lifecycle.current === scope) lifecycle.current = null;
      clearInterval(timer); window.removeEventListener('nitewide:export-progress', progress);
    };
  }, [session?.accessToken, request, prefix]);

  async function actOnJob(job) {
    const scope = lifecycle.current;
    if (!scope) return;
    setBusy(job.id); setError('');
    try {
      if (job.status === 'ready') await downloadPreparedExport(session, job.id, job.filename, { audience: prefix });
      else {
        const retried = await request(`/${prefix}/reports/exports/${job.id}/retry`, session, { method: 'POST' });
        if (!scope.isActive()) return;
        scope.update(retried);
        await scope.refresh();
      }
    } catch (err) { if (scope.isActive()) setError(err.message); }
    finally { if (scope.isActive()) setBusy(null); }
  }

  if (!jobs.length) return null;
  return <details className={className} data-testid="prepared-exports"><summary>Prepared exports · {jobs.length}</summary>
    <p className="muted">Downloads stay available for 24 hours. Access is checked again before download.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {jobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0"><strong className="break-words">{job.filename || 'Business report'}</strong><p className="muted" role="status">
        {job.status === 'ready' ? `${job.totalRows.toLocaleString()} rows · Ready` : job.status === 'failed' ? job.error
          : job.status === 'rendering' ? `Preparing · ${job.progress}%` : job.status === 'snapshotting' ? 'Capturing report snapshot…' : 'Queued…'}
      </p></div>
      {['ready', 'failed'].includes(job.status) && <Button variant="outline" disabled={busy === job.id} onClick={() => actOnJob(job)}>
        {job.status === 'ready' ? <><ArrowDownToLine size={16}/>Download</> : <><RefreshCw size={16}/>Retry</>}
      </Button>}
    </div>)}
  </details>;
}
