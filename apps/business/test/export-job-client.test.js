import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForExport } from '../src/lib/export-job-client.js';

test('export polling tracks progress and returns the prepared download without issuing another export', async () => {
  const states = [{ id: 'job', status: 'rendering', progress: 50 }, { id: 'job', status: 'ready', progress: 100 }];
  const progress = []; const requested = [];
  const ready = await waitForExport({ id: 'job', status: 'queued', progress: 0 }, {
    getStatus: async (id) => { requested.push(id); return states.shift(); },
    onProgress: (job) => progress.push(job.progress), wait: async () => {},
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(progress, [0, 50, 100]);
  assert.deepEqual(requested, ['job', 'job']);
});
test('export polling surfaces failure, network rejection, and a bounded wait', async () => {
  await assert.rejects(waitForExport({ status: 'failed', error: 'Access changed' }), /Access changed/);
  await assert.rejects(waitForExport({ id: 'job', status: 'queued' }, { getStatus: async () => { throw new Error('Expired session'); }, wait: async () => {} }), /Expired session/);
  await assert.rejects(waitForExport({ id: 'job', status: 'queued' }, { getStatus: async () => ({ id: 'job', status: 'queued' }), wait: async () => {}, maxPolls: 2 }), /download it later/);
  await assert.rejects(waitForExport({ status: 'unknown' }), /Unexpected export status/);
});
