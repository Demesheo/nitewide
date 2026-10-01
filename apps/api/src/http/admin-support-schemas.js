const { z } = require('zod');
const { page } = require('./business-schemas');
const uuid = z.uuid();
const text = max => z.string().trim().max(max);
const reason = text(500).min(3,'Explain why this admin change is needed');
const categories = ['admission','paid_booking','account_access','guestlist','referral','reporting','security','other'];
const priorities = ['urgent','high','normal','low'];
const statuses = ['open','in_progress','resolved','closed'];
const selectedStatuses = z.union([z.array(z.enum(statuses)).max(8),z.enum(statuses)])
  .transform(value => Array.isArray(value) ? value : [value]).default([]);
const links = { organizationId: uuid.nullable().optional(),customerUserId: uuid.nullable().optional(),eventId: uuid.nullable().optional(),
  orderId: uuid.nullable().optional(),assignedAdminUserId: uuid.nullable().optional() };
const caseQuery = z.object({ ...page,search: text(120).default(''),status: z.enum(['all',...statuses]).default('all'),statuses: selectedStatuses,
  category: z.enum(['all',...categories]).default('all'),organizationId: uuid.optional(),customerUserId: uuid.optional(),assignedAdminUserId: uuid.optional() })
  .refine(value => value.status === 'all' || !value.statuses.length,{ path: ['statuses'],message: 'Choose status or statuses, not both' });
const createCase = z.object({ title: text(180).min(3),description: text(10000).min(3),category: z.enum(categories),priority: z.enum(priorities).optional(),...links,reason }).strict();
const updateCase = z.object({ version: z.number().int().nonnegative(),reason,title: text(180).min(3).optional(),description: text(10000).min(3).optional(),
  category: z.enum(categories).optional(),priority: z.enum(priorities).optional(),status: z.enum(statuses).optional(),resolution: text(10000).nullable().optional(),...links }).strict()
  .refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)),'Choose a field to update');
const attentionQuery = z.object({ ...page,kind: z.enum(['all','support_case','business_access_request','onboarding','email_failure','export_failure','media_failure','notification_failure']).default('all') });
const historyQuery = z.object(page);
module.exports = { caseQuery,createCase,updateCase,attentionQuery,historyQuery,categories,priorities,statuses };
