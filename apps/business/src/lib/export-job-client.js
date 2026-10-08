import { awaitExport, checkExportSignal, exportDelay } from './report-export-session.js';

export async function waitForExport(job, { getStatus, onProgress = () => {},
  wait = exportDelay, maxPolls = 240, signal } = {}) {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    checkExportSignal(signal);
    onProgress(job);
    checkExportSignal(signal);
    if (job.status === 'ready') return job;
    if (job.status === 'failed') throw new Error(job.error || 'Export failed. Retry it from Prepared exports.');
    if (!['queued', 'snapshotting', 'rendering'].includes(job.status)) throw new Error('Unexpected export status.');
    await awaitExport(wait(2500, signal), signal);
    job = await awaitExport(getStatus(job.id, { signal }), signal);
  }
  throw new Error('Your export is still preparing. You can download it later from Prepared exports.');
}
