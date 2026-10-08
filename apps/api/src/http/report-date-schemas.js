const { z } = require('zod');
const { MAX_REPORT_RANGE_DAYS, isCalendarDate, reportRangeIssue } = require('../../../shared/report-dates.mjs');

const reportDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use dates in YYYY-MM-DD format')
  .refine(isCalendarDate, 'Use valid calendar dates')
  .describe(`Calendar date in YYYY-MM-DD format, years 0001–9999. Custom dates must be paired and ordered, with at most ${MAX_REPORT_RANGE_DAYS} calendar days inclusive in the selected timezone.`);

function refineReportDates(value, ctx) {
  if (value.startDate === undefined && value.endDate === undefined) return;
  const issue = reportRangeIssue(value.startDate, value.endDate);
  // Invalid date fields already have a precise issue from the date schema.
  if (issue && issue.kind !== 'date') {
    ctx.addIssue({ code: 'custom', path: [issue.field], message: issue.message });
  }
}

module.exports = { MAX_REPORT_RANGE_DAYS, reportDate, refineReportDates };
