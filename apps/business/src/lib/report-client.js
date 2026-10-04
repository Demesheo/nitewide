import { waitForExport } from './export-job-client.js';
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

async function exportRequest(session, path) {
  const response = await fetch(`${import.meta.env?.VITE_API_URL || '/api'}${path}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const failure = new Error(error?.error?.message || 'Unable to export the report. Please try again.');
    failure.status = response.status;
    throw failure;
  }
  return response;
}
export async function downloadPreparedExport(session, id, filename = 'nitewide-business-report.csv', { audience = 'business' } = {}) {
  const prefix = audience === 'admin' ? 'admin' : 'business';
  const response = await exportRequest(session, `/${prefix}/reports/exports/${encodeURIComponent(id)}/download`);
  return saveCsv(response, filename);
}
export async function downloadBusinessReport(session, query, { audience = 'business' } = {}) {
  const prefix = audience === 'admin' ? 'admin' : 'business';
  const response = await exportRequest(session, `/${prefix}/reports/export.csv?${query}`);
  if (response.status === 202) {
    const { data: job } = await response.json();
    const ready = await waitForExport(job, {
      getStatus: async (id) => (await (await exportRequest(session, `/${prefix}/reports/exports/${encodeURIComponent(id)}`)).json()).data,
      onProgress: (value) => window.dispatchEvent(new CustomEvent('nitewide:export-progress', { detail: { ...value, audience: prefix } })),
    });
    return downloadPreparedExport(session, ready.id, ready.filename, { audience: prefix });
  }
  const table = new URLSearchParams(query).get('exportTable');
  const filename = `nitewide-${prefix}-${table ? `${table}-` : ''}${new Date().toISOString().slice(0, 10)}.csv`;
  return saveCsv(response, filename);
}
export async function saveCsv(response, filename) {
  if (window.showSaveFilePicker && response.body) {
    let file;
    try { file = await window.showSaveFilePicker({ suggestedName: filename,
      types: [{ description: 'CSV report', accept: { 'text/csv': ['.csv'] } }] }); }
    catch (error) {
      if (error.name === 'AbortError') return;
      // Background preparation can outlive browser user activation. The
      // authenticated download still works with the standard link fallback.
      if (!['SecurityError', 'NotAllowedError'].includes(error.name)) throw error;
    }
    if (file) { await response.body.pipeTo(await file.createWritable()); return; }
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
