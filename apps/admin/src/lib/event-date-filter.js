export function eventDateFilter(startDate = '', endDate = '', timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (startDate && endDate && endDate < startDate) throw new Error('End date must be on or after Start date.');
  return { startDate: startDate || null, endDate: endDate || null, timezone: startDate || endDate ? timezone : null, page: 1 };
}
