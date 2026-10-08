export const MAX_REPORT_RANGE_DAYS = 366;
const DAY_MS = 86400000;

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

// Browser-safe date labels; timezone midnight conversion stays in PostgreSQL.
export function reportRangeIssue(startDate, endDate) {
  for (const [field, value] of [['startDate', startDate], ['endDate', endDate]]) {
    if (value && !isCalendarDate(value)) {
      return { field, kind: 'date', message: `Use a valid ${field === 'startDate' ? 'start' : 'end'} date in YYYY-MM-DD format.` };
    }
  }
  if (!startDate || !endDate) {
    return { field: !startDate ? 'startDate' : 'endDate', kind: 'incomplete', message: 'Choose a start and end date to load a custom report.' };
  }
  if (startDate > endDate) {
    return { field: 'endDate', kind: 'order', message: 'End date must be on or after start date.' };
  }
  // Count date labels in UTC, independently of 23/25-hour timezone days.
  const inclusiveDays = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
  if (inclusiveDays > MAX_REPORT_RANGE_DAYS) {
    return { field: 'endDate', kind: 'span', message: `Custom reports must span at most ${MAX_REPORT_RANGE_DAYS} calendar days, including the start and end dates.` };
  }
  return null;
}
