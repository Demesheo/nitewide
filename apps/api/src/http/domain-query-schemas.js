const { z } = require('zod');
const business = require('./business-schemas');
const page = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) };
const bookings = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), period: z.enum(['upcoming', 'past']).default('upcoming') });
const saved = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(30).default(9) });
const savedIds = z.object({ eventIds: z.string().min(1).max(2000).transform((value) => value.split(',')).pipe(z.array(z.uuid()).min(1).max(50)) });
const connections = z.object({ eventId: z.uuid().optional(), page: page.page, pageSize: z.coerce.number().int().min(1).max(30).default(9),
  city: z.string().trim().max(120).default(''), query: z.string().trim().max(120).default(''),
  personIds: z.string().max(2000).default('').transform((value) => value ? value.split(',') : []).pipe(z.array(z.uuid()).max(50)) });
const connectionPeople = z.object({ ...page, search: z.string().trim().max(120).default('') });
const notifications = z.object(page);
const admissions = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: page.pageSize, search: z.string().trim().max(120).default(''), organizationId: z.union([z.uuid(), z.literal('independent')]).optional() });
const admissionsRoster = z.object({ search: z.string().trim().max(120).default(''), page: z.coerce.number().int().min(1).max(10000).default(1), status: z.enum(['all', 'ready', 'admitted']).default('all') });
const organizationTeam = z.object({ ...business.page, timezone: business.reportTimezone, search: z.string().trim().max(120).default(''),
  role: z.enum(['all', 'Owner', 'Manager', 'Employee', 'Promoter']).default('all'), roles: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.enum(['Owner', 'Manager', 'Employee', 'Promoter'])).max(4).default([])),
  sort: z.enum(['name_asc', 'name_desc', 'role_asc', 'role_desc', 'email_asc', 'email_desc', 'status_asc', 'status_desc', 'sales_desc', 'sales_asc', 'orders_desc', 'orders_asc', 'customers_desc', 'customers_asc']).default('name_asc') });
const businessPage = z.object(business.page);
const guestlistStatus = z.object({ affiliateCode: z.string().max(48).optional() });
const onboardingPreview = z.object({ token: z.string().min(20).max(200) });
module.exports = { bookings, saved, savedIds, connections, connectionPeople, notifications, admissions, admissionsRoster, organizationTeam, businessPage, guestlistStatus, onboardingPreview };
