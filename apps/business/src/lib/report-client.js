export const browserReportTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function reportQuery({ days = '30', startDate = '', endDate = '', organizationIds = [], venueIds = [], regions = [], search = '', sort = 'sales_desc',
  timezone = browserReportTimezone(), eventId = '', personId = '', offeringKind = '', offeringName = '' }) {
  const params = new URLSearchParams();
  if (startDate && endDate) { params.set('startDate', startDate); params.set('endDate', endDate); }
  else params.set('days', String(days));
  organizationIds.forEach((value) => params.append('organizationIds', value));
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

export async function downloadBusinessReport(session, query) {
  const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/business/reports/export.csv?${query}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const failure = new Error(error?.error?.message || 'Unable to export the report. Please try again.');
    failure.status = response.status;
    throw failure;
  }
  const table = new URLSearchParams(query).get('exportTable');
  const filename = `nitewide-business-${table ? `${table}-` : ''}${new Date().toISOString().slice(0, 10)}.csv`;
  if (window.showSaveFilePicker && response.body) {
    const file = await window.showSaveFilePicker({ suggestedName: filename,
      types: [{ description: 'CSV report', accept: { 'text/csv': ['.csv'] } }] });
    await response.body.pipeTo(await file.createWritable());
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
