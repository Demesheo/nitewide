import { waitForExport } from './export-job-client.js';
import { awaitExport, beginReportExport, checkExportSignal, reportAudience } from './report-export-session.js';
export const browserReportTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function reportQuery({ days = '30', startDate = '', endDate = '', organizationIds = [], ownedOnly = false, venueIds = [], regions = [], search = '', sort = 'sales_desc',
  timezone = browserReportTimezone(), eventId = '', personId = '', offeringKind = '', offeringName = '' }) {
  const params = new URLSearchParams();
  if (startDate && endDate) { params.set('startDate', startDate); params.set('endDate', endDate); }
  else params.set('days', String(days));
  organizationIds.forEach((value) => params.append('organizationIds', value));
  if (ownedOnly) params.set('ownedOnly', 'true');
  venueIds.forEach((value) => params.append('venueIds', value));
  regions.forEach((value) => params.append('regions', value));
  if (eventId) params.set('eventId', eventId);
  if (personId) params.set('personId', personId);
  if (offeringKind) params.set('offeringKind', offeringKind);
  if (offeringName) params.set('offeringName', offeringName);
  if (search.trim()) params.set('search', search.trim());
  params.set('sort', sort);
  params.set('timezone', timezone);
  return params.toString();
}

async function exportRequest(session, path, signal) {
  checkExportSignal(signal);
  const response = await awaitExport(fetch(`${import.meta.env?.VITE_API_URL || '/api'}${path}`, {
    signal,
    headers: { Authorization: `Bearer ${session.accessToken}` },
  }), signal);
  if (!response.ok) {
    const error = await awaitExport(response.json().catch(() => null), signal);
    const failure = new Error(error?.error?.message || 'Unable to export the report. Please try again.');
    failure.status = response.status;
    throw failure;
  }
  return response;
}
async function preparedDownload(session, id, filename, prefix, signal) {
  const response = await exportRequest(session, `/${prefix}/reports/exports/${encodeURIComponent(id)}/download`, signal);
  return saveCsv(response, filename, { signal });
}
export async function downloadPreparedExport(session, id, filename = 'nitewide-business-report.csv', options = {}) {
  const operation = beginReportExport(session, options);
  try { return await preparedDownload(session, id, filename, reportAudience(options.audience), operation.signal); }
  finally { operation.finish(); }
}
export async function downloadBusinessReport(session, query, options = {}) {
  const prefix = reportAudience(options.audience), operation = beginReportExport(session, options);
  const { signal, identity } = operation;
  try {
    const response = await exportRequest(session, `/${prefix}/reports/export.csv?${query}`, signal);
    if (response.status === 202) {
      const { data: job } = await awaitExport(response.json(), signal);
      const ready = await waitForExport(job, {
        signal,
        getStatus: async (id) => {
          const status = await exportRequest(session, `/${prefix}/reports/exports/${encodeURIComponent(id)}`, signal);
          return (await awaitExport(status.json(), signal)).data;
        },
        onProgress: (value) => window.dispatchEvent(new CustomEvent('nitewide:export-progress', { detail: { ...value, audience: prefix, identity } })),
      });
      return await preparedDownload(session, ready.id, ready.filename, prefix, signal);
    }
    const table = new URLSearchParams(query).get('exportTable');
    const filename = `nitewide-${prefix}-${table ? `${table}-` : ''}${new Date().toISOString().slice(0, 10)}.csv`;
    return await saveCsv(response, filename, { signal });
  } finally { operation.finish(); }
}
export async function saveCsv(response, filename, { signal } = {}) {
  checkExportSignal(signal);
  if (window.showSaveFilePicker && response.body) {
    let file;
    try { file = await awaitExport(window.showSaveFilePicker({ suggestedName: filename,
      types: [{ description: 'CSV report', accept: { 'text/csv': ['.csv'] } }] }), signal); }
    catch (error) {
      checkExportSignal(signal);
      if (error.name === 'AbortError') return;
      // Background preparation can outlive browser user activation. The
      // authenticated download still works with the standard link fallback.
      if (!['SecurityError', 'NotAllowedError'].includes(error.name)) throw error;
    }
    if (file) {
      checkExportSignal(signal);
      let abortWritable;
      const opening = Promise.resolve(file.createWritable()).then((writable) => {
        abortWritable = () => { try { Promise.resolve(writable.abort()).catch(() => {}); } catch { /* pipeTo owns a locked stream's abort. */ } };
        if (signal?.aborted) { abortWritable(); checkExportSignal(signal); }
        signal?.addEventListener('abort', abortWritable, { once: true });
        return writable;
      });
      try {
        const writable = await awaitExport(opening, signal);
        await awaitExport(response.body.pipeTo(writable, { signal }), signal);
      } finally { if (abortWritable) signal?.removeEventListener('abort', abortWritable); }
      return;
    }
  }
  checkExportSignal(signal);
  const blob = await awaitExport(response.blob(), signal);
  const url = URL.createObjectURL(blob);
  let downloaded = false;
  try {
    checkExportSignal(signal);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    checkExportSignal(signal);
    link.click(); downloaded = true;
  } finally {
    if (downloaded) setTimeout(() => URL.revokeObjectURL(url), 1000);
    else URL.revokeObjectURL(url);
  }
}
