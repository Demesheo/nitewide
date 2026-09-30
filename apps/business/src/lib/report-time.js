import { browserReportTimezone } from './report-client.js';

function validTimezone(value) {
  if (!value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

export function eventReportTime(row, selectedVenueTimezone, browserTimezone = browserReportTimezone()) {
  if (!row?.startsAt) return '—';
  const zone = [row.venueTimezone, selectedVenueTimezone, browserTimezone, 'UTC'].find(validTimezone);
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit' }).format(new Date(row.startsAt));
}
