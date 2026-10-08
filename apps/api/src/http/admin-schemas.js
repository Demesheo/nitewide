const { z } = require('zod');

const text = (max) => z.string().trim().max(max);

const reportQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  search: text(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  organizationId: z.string().uuid().optional(),
});

const operationsQuery = z.object({
  kind: z.enum(['failed_payments', 'pending_guestlist', 'suspended_organizations']).default('failed_payments'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: text(120).default(''),
});

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

module.exports = { reportQuery, operationsQuery, demoUser };
