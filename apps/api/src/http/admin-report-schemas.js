const { z } = require('zod');
const business = require('./business-schemas');
const reportTables = z.enum(['businesses', 'regions', 'venues', 'events', 'offerings', 'purchases', 'team', 'customers']);
const businessId = z.union([z.uuid(), z.string().regex(/^creator:[a-f0-9-]{36}$/).refine(value => z.uuid().safeParse(value.slice(8)).success)]);
const reportDetailQuery = business.reportDetailQuery.safeExtend({
  businessId: businessId.optional(),
  offeringId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  exportTable: reportTables.optional(),
  sort: z.enum([...business.reportDetailQuery.shape.sort.unwrap().options, 'paid_asc', 'paid_desc', 'fees_asc', 'fees_desc']).default('sales_desc'),
}).refine(value => !value.offeringId || !value.offeringKind, 'Choose an offering ID or historical offering name')
  .refine(value => !value.businessId || (!value.organizationId && !value.organizationIds.length), 'Choose businessId or organization filters')
  .refine(value => [value.startDate,value.endDate].every(date => { if (!date) return true; const parsed = new Date(`${date}T00:00:00Z`); return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date; }),'Use valid calendar dates');
module.exports = { reportDetailQuery, reportTables, businessId };
