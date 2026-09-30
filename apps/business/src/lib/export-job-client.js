export async function waitForExport(job, { getStatus, onProgress = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = 240 } = {}) {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    onProgress(job);
    if (job.status === 'ready') return job;
    if (job.status === 'failed') throw new Error(job.error || 'Export failed. Retry it from Prepared exports.');
    if (!['queued', 'snapshotting', 'rendering'].includes(job.status)) throw new Error('Unexpected export status.');
    await wait(2500);
    job = await getStatus(job.id);
  }
  throw new Error('Your export is still preparing. You can download it later from Prepared exports.');
}
