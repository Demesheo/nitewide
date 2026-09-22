const { z } = require('zod');
const list = (item) => z.preprocess((value) => value === undefined || value === '' ? [] : Array.isArray(value) ? value : String(value).split(','), z.array(item).max(50));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date');
const analyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  startDate: date.optional(),
  endDate: date.optional(),
  regions: list(z.string().trim().min(1).max(160)),
  organizationIds: list(z.union([z.string().uuid(), z.literal('independent')])),
  venueIds: list(z.string().regex(/^[a-f0-9]{64}$/)),
  search: z.string().trim().max(120).default(''),
}).superRefine((value, context) => {
  if (Boolean(value.startDate) !== Boolean(value.endDate)) context.addIssue({ code: 'custom', message: 'Choose both start and end dates', path: ['startDate'] });
  if (value.startDate && value.endDate) {
    const span = (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) / 86400000;
    if (span < 0 || span > 365) context.addIssue({ code: 'custom', message: 'Date range must be 1–366 days', path: ['endDate'] });
  }
});
module.exports = { analyticsQuery };
