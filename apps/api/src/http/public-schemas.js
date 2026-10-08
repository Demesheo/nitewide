const { z } = require('zod');
const allCities = z.enum(['true', 'false']).transform((value) => value === 'true').default(false);
const discoveryQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(100),
  cursor: z.string().max(1000).optional(),
  city: z.string().trim().max(120).default(''),
  allCities,
  mode: z.enum(['range', 'upcoming']).default('range'),
  scope: z.enum(['nearby', 'city']).default('nearby'),
  sort: z.enum(['recommended', 'distance', 'date']).default('recommended'),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  query: z.string().trim().max(120).default(''),
  category: z.string().trim().max(80).default('all'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
}).refine((value) => !value.allCities || !value.city, { path: ['city'], message: 'Choose a city or all cities, not both' })
  .refine((value) => !value.allCities || value.scope === 'nearby', { path: ['scope'], message: 'City-only discovery requires a selected city' })
  .refine((value) => value.mode === 'range' ? Boolean(value.endDate) : value.endDate === undefined,
    { path: ['endDate'], message: 'Range discovery requires an end date; upcoming discovery omits it' })
  .refine((value) => !value.endDate || value.startDate <= value.endDate, { path: ['endDate'], message: 'End date must be on or after start date' })
  .refine((value) => !value.endDate || (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 <= 31,
    { path: ['endDate'], message: 'Discovery range must be 31 days or less' });
const legacyDiscoveryQuery = z.object({ limit: z.coerce.number().int().positive().optional(), category: z.string().max(80).optional(), city: z.string().trim().max(120).optional(), allCities })
  .refine((value) => !value.allCities || !value.city, { path: ['city'], message: 'Choose a city or all cities, not both' });
const batchQuery = z.object({ ids: z.string().min(1).max(1200).transform((value) => value.split(',')).pipe(z.array(z.uuid()).min(1).max(30)) });
const discoveryAreaQuery = z.object({ q: z.string().trim().max(120).default('') }).strict();
module.exports = { discoveryQuery, legacyDiscoveryQuery, batchQuery, discoveryAreaQuery };
