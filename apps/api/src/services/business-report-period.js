function calendarPeriod(input, now) {
  const timezone = input.timezone || 'UTC';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(({ type, value }) => [type, value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const endDate = input.endDate || today;
  const startDate = input.startDate || new Date(Date.parse(`${endDate}T00:00:00.000Z`) - (input.days - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate, timezone, currency: 'USD', basis: 'paidAt' };
}

async function resolvePaidRange(select, input, now) {
  const range = calendarPeriod(input, now);
  // PostgreSQL's IANA rules resolve each local midnight independently. This
  // yields a 23- or 25-hour UTC interval on DST transitions without offsets.
  const [bounds] = await select(`SELECT (CAST(:startDate AS date)::timestamp AT TIME ZONE :timezone) AS since,
    ((CAST(:endDate AS date) + 1)::timestamp AT TIME ZONE :timezone) AS until`, range);
  return { ...range, since: bounds.since, until: bounds.until };
}

module.exports = { calendarPeriod, resolvePaidRange };
