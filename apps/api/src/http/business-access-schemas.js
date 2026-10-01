const { z } = require('zod');
const { optionalPhone } = require('../domain/phone');
const { onboardingSchema } = require('../services/admin-onboarding-service');
const requestAccess = z.object({
  displayName: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(320),
  phone: optionalPhone.refine(Boolean, 'Add a valid contact phone number'),
  businessName: z.string().trim().min(2).max(160), role: z.enum(['owner', 'manager']),
  details: z.string().trim().min(10).max(2000),
}).strict();
const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).default(''), statuses: z.union([z.enum(['pending','approved','declined']), z.array(z.enum(['pending','approved','declined'])).max(3)]).default([]).transform(value => Array.isArray(value) ? value : [value]) }).strict();
const decline = z.object({ version: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500) }).strict();
const approve = onboardingSchema.safeExtend({ version: z.number().int().nonnegative() }).refine(input => input.kind === 'organization', 'Onboard one business workspace');
module.exports = { requestAccess, query, decline, approve };
