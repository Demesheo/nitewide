const { z } = require('zod');

const text = (max) => z.string().trim().max(max);
const reason = text(500).min(3, 'Explain why this admin change is needed');

const reportQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  search: text(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  organizationId: z.string().uuid().optional(),
});

const userUpdate = z.object({
  displayName: text(120).min(1).optional(),
  phone: text(32).nullable().optional(),
  isActive: z.boolean().optional(),
  isInternalAdmin: z.boolean().optional(),
  reason,
}).refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'Choose at least one field to update');

const organizationUpdate = z.object({
  name: text(160).min(1).optional(),
  description: text(10000).nullable().optional(),
  planTier: z.enum(['free', 'premium']).optional(),
  status: z.enum(['active', 'suspended', 'closed']).optional(),
  reason,
}).refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'Choose at least one field to update');

const eventUpdate = z.object({
  title: text(180).min(2).optional(),
  summary: text(500).nullable().optional(),
  description: text(20000).nullable().optional(),
  category: text(80).min(1).optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  capacity: z.number().int().min(0).max(1000000).nullable().optional(),
  guestlistCapacity: z.number().int().min(0).max(1000000).optional(),
  isDiscoverable: z.boolean().optional(),
  reason,
}).refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'Choose at least one field to update');


const demoUser = z.object({
  displayName: text(120).min(1),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
  role: z.enum(['customer', 'internal_admin', 'organization_owner', 'venue_manager', 'employee', 'organization_promoter', 'event_promoter', 'event_creator']),
  organizationId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
}).superRefine((value, context) => {
  if (['organization_owner', 'venue_manager', 'employee', 'organization_promoter'].includes(value.role) && !value.organizationId) context.addIssue({ code: 'custom', path: ['organizationId'], message: 'Choose an organization for this role' });
  if (value.role === 'event_promoter' && !value.eventId) context.addIssue({ code: 'custom', path: ['eventId'], message: 'Choose an event for this role' });
});

module.exports = { reportQuery, userUpdate, organizationUpdate, eventUpdate, demoUser };
