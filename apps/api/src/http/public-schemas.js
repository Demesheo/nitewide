const { z } = require('zod');
const discoveryQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(100),
  cursor: z.string().max(1000).optional(),
  city: z.string().trim().max(120).default(''),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  query: z.string().trim().max(120).default(''),
  category: z.string().trim().max(80).default('all'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
}).refine((value) => value.startDate <= value.endDate, { path: ['endDate'], message: 'End date must be on or after start date' })
  .refine((value) => (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 <= 31,
    { path: ['endDate'], message: 'Discovery range must be 31 days or less' });
const legacyDiscoveryQuery = z.object({ limit: z.coerce.number().int().positive().optional(), category: z.string().max(80).optional() });
const batchQuery = z.object({ ids: z.string().min(1).max(1200).transform((value) => value.split(',')).pipe(z.array(z.uuid()).min(1).max(30)) });
module.exports = { discoveryQuery, legacyDiscoveryQuery, batchQuery };
