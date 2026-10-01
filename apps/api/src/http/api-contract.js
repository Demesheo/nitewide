const { z } = require('zod');
const business = require('./business-schemas');
const admin = require('./admin-schemas');
const { analyticsQuery } = require('./analytics-schemas');
const { routeInventory } = require('./route-inventory');
const domainQuery = require('./domain-query-schemas');
const publicQuery = require('./public-schemas');
const managed = require('../services/admin-management-service');
const editSchemas = require('../services/admin-edit-service').schemas;
const { scopedRoleSchema } = require('../services/admin-role-service');
const adminReports = require('./admin-report-schemas');
const adminSupport = require('./admin-support-schemas');
const { venuePageSchema } = require('../services/business-venue-service');

const uuid = z.uuid();
const count = z.number().int().nonnegative();
const dateTime = z.iso.datetime({ offset: true });
const record = z.record(z.string(), z.json());
const entity = z.object({ id: uuid }).catchall(z.json());
const named = z.object({ id: z.string(), name: z.string() }).catchall(z.json());
const event = z.object({ id: uuid, title: z.string(), startsAt: dateTime, endsAt: dateTime,
  status: z.enum(['draft', 'published', 'cancelled', 'completed']) }).catchall(z.json());
const admissionEvent = event.omit({ status: true });
const offering = z.object({ id: uuid, eventId: uuid, name: z.string(), priceCents: count,
  currency: z.string().length(3), kind: z.enum(['ticket', 'package', 'reservation']),
  entriesPerUnit: count, quantitySold: count }).catchall(z.json());
const user = z.object({ id: uuid, email: z.email(), displayName: z.string() }).catchall(z.json());
const roles = z.array(z.enum(['customer', 'internal_admin', 'organization_owner', 'venue_manager', 'employee', 'promoter', 'event_creator']));
const session = z.object({ accessToken: z.string().min(1), expiresAt: dateTime, user, roles }).catchall(z.json());
const guest = z.object({ id: uuid, partySize: count, status: z.enum(['pending', 'confirmed', 'rejected', 'checked_in', 'no_show']) }).catchall(z.json());
const sales = z.object({ salesCents: count, orders: count, units: count, admissions: count,
  checkedIn: count, guestlistPlaces: count, commissionCents: count.nullable() }).catchall(z.json());
const reportRow = z.object({ id: z.string(), label: z.string(), salesCents: count, orders: count }).catchall(z.json());
const page = (item) => z.object({ items: z.array(item), page: count, pageSize: count,
  total: count, hasMore: z.boolean() }).catchall(z.json());
const exportJob = z.object({ id: uuid, status: z.enum(['queued', 'snapshotting', 'rendering', 'ready', 'failed', 'expired', 'streaming']),
  totalRows: count, processedRows: count, progress: count, snapshotAt: dateTime.nullable(),
  createdAt: dateTime, expiresAt: dateTime, filename: z.string().nullable(), error: z.string().nullable(),
  statusUrl: z.string(), downloadUrl: z.string() });
const envelope = (data) => z.object({ data });
const error = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional(), details: z.json().optional() }) });

// Concrete shared wire models are executable with safeParse at HTTP boundaries.
// Dynamic management resources retain JSON extension fields by design.
const responses = { entity, event, offering, user, session, guest, sales, reportRow, exportJob, error, page, envelope };
const queries = {
  '/events': z.union([publicQuery.discoveryQuery, publicQuery.legacyDiscoveryQuery]), '/events/batch': publicQuery.batchQuery,
  '/customer/bookings': domainQuery.bookings, '/customer/saved': domainQuery.saved, '/customer/saved/ids': domainQuery.savedIds,
  '/customer/connections': domainQuery.connections, '/customer/connections/summary': domainQuery.connectionPeople, '/customer/connections/people': domainQuery.connectionPeople,
  '/customer/events/:eventId/guestlist': domainQuery.guestlistStatus, '/notifications': domainQuery.notifications,
  '/business/admissions/events': domainQuery.admissions, '/business/admissions/events/:eventId': domainQuery.admissionsRoster,
  '/business/organizations/:organizationId/team-page': domainQuery.organizationTeam,
  '/business/organizations/:organizationId/invitations-page': domainQuery.businessPage,
  '/business/events/:eventId/instructions/history': domainQuery.businessPage, '/auth/onboarding/preview': domainQuery.onboardingPreview,
  '/business/events': business.eventListQuery,
  '/business/overview': business.reportQuery,
  '/business/overview/needs-attention': business.reportQuery,
  '/business/reports/summary': business.reportDetailQuery,
  '/business/reports/:table': business.reportDetailQuery,
  '/business/reports/export.csv': business.reportDetailQuery,
  '/admin/reports/summary': adminReports.reportDetailQuery,
  '/admin/reports/:table': adminReports.reportDetailQuery,
  '/admin/reports/export.csv': adminReports.reportDetailQuery,
  '/admin/support/cases': adminSupport.caseQuery,
  '/admin/support/cases/:id/history': adminSupport.historyQuery,
  '/admin/overview/needs-attention': adminSupport.attentionQuery,
  '/business/analytics': analyticsQuery, '/admin/analytics': analyticsQuery,
  '/admin/workspace': admin.reportQuery, '/admin/operations': admin.operationsQuery,
  '/admin/management/:resource': managed.querySchema,
};
for (const suffix of ['purchases', 'attendees', 'attendees/:attendeeId', 'people-page', 'guestlist-page', 'guestlist-settings-page']) queries[`/business/events/:eventId/${suffix}`] = business.eventPageQuery;
for (const prefix of ['/admin/businesses/:id/venues', '/business/organizations/:id/venues']) {
  for (const path of [prefix, `${prefix}/:locationId/team`, `${prefix}/:locationId/candidates`]) queries[path] = venuePageSchema;
}

function paramsFor(path) {
  const shape = {};
  for (const match of path.matchAll(/:([A-Za-z]+)/g)) {
    const name = match[1];
    shape[name] = name === 'token' ? z.string().min(20).max(200)
      : name === 'table' ? (path.startsWith('/admin/') ? adminReports.reportTables : z.enum(['regions', 'venues', 'events', 'offerings', 'team', 'customers']))
        : name === 'resource' ? z.enum(Object.keys(require('../services/admin-management-service').registry))
          : name === 'action' ? z.string().min(1).max(80) : uuid;
  }
  return Object.keys(shape).length ? z.object(shape) : null;
}

function responseFor(method, path) {
  if (/^\/(admin\/businesses|business\/organizations)\/:id\/venues/.test(path)) {
    if (method === 'get' && (path.endsWith('/venues') || path.endsWith('/team') || path.endsWith('/candidates'))) return page(entity);
    return entity;
  }
  if (path === '/openapi.json') return record;
  if (['/auth/register', '/auth/sign-in'].includes(path)) return session;
  if (path === '/auth/me') return z.object({ user, roles });
  if (path === '/auth/sessions') return z.array(z.object({ id: uuid, current: z.boolean(), createdAt: dateTime, expiresAt: dateTime }));
  if (path === '/auth/logout' || path.includes('/auth/sessions/')) return z.object({ revoked: z.literal(true) });
  if (path === '/auth/password-reset/request') return z.object({ message: z.string() });
  if (path === '/auth/password-reset/complete') return z.object({ reset: z.literal(true) });
  if (path === '/auth/email/verify') return z.object({ verified: z.literal(true) });
  if (path === '/auth/email/resend') return z.object({ verificationEmailQueued: z.boolean(), message: z.string() }).catchall(z.json());
  if (path === '/auth/notification-preferences') return z.object({ reviewRequests: z.boolean(), salesActivity: z.boolean(), inventoryAlerts: z.boolean() });
  if (path === '/auth/profile' || path === '/customer/profile') return user;
  if (path === '/events' && method === 'get') return z.union([z.array(event), z.object({ items: z.array(event), hasMore: z.boolean(), nextCursor: z.string().nullable() })]);
  if (path === '/events/batch') return z.object({ items: z.array(event) });
  if (path === '/events/:eventId' || path === '/events' || path === '/business/events/:eventId' && method === 'put' || path === '/business/events' && method === 'post') return event;
  if (path === '/business/events' && method === 'get') return page(event);
  if (path === '/events/:eventId/offerings') return offering;
  if (path.endsWith('/guestlist-capacity')) return event;
  if (path === '/organizations') return z.object({ id: uuid, name: z.string(), slug: z.string(), planTier: z.enum(['free', 'premium']) }).catchall(z.json());
  if (path.endsWith('/guestlist-settings')) return z.object({ eventId: uuid, title: z.string(), direct: z.object({ capacity: count, used: count }), promoters: z.array(entity) });
  if (path.endsWith('/guestlist-invite-pools')) return record;
  if (path === '/customer/saved/ids') return z.object({ savedIds: z.array(uuid) });
  if (path === '/customer/saved/merge') return z.object({ added: count, skipped: count });
  if (path === '/customer/saved') return page(event);
  if (path === '/customer/saved/:eventId') return z.object({ saved: z.boolean() });
  if (path === '/customer/guestlists/:entryId' && method === 'delete') return z.object({ withdrawn: z.literal(true) });
  if (path === '/customer/guestlists/:entryId') return z.object({ entry: guest });
  if (path === '/customer/events/:eventId/guestlist') return z.object({ entry: guest.nullable(), maxPartySize: count, requestsOpen: z.boolean() });
  if (path === '/business/admissions/events') return page(admissionEvent).extend({ serverTime: dateTime, nextEvent: admissionEvent.nullable() });
  if (path === '/business/admissions/events/:eventId') return z.object({ total: count, expected: count, admitted: count,
    entries: z.array(z.object({ id: uuid, kind: z.enum(['ticket', 'guestlist']), name: z.string(), email: z.email(), spots: count, status: z.string() }).catchall(z.json())), page: count, pageSize: count, serverTime: dateTime });
  if (path === '/check-ins') return z.object({ kind: z.enum(['ticket', 'guestlist']), credential: entity,
    checkIn: z.object({ id: uuid, method: z.string(), checkedInAt: dateTime }) });
  if (path.endsWith('/reports/exports')) return z.array(exportJob);
  if (path.includes('/reports/exports/:id')) return exportJob;
  if (path.endsWith('/reports/:table')) return page(reportRow);
  if (path.endsWith('/reports/summary')) return z.object({ range: record, event: record.nullable(), person: record.nullable(), summary: sales,
    daily: z.array(z.object({ date: z.iso.date(), orders: count, salesCents: count })), regionalMix: z.array(record), channels: z.array(record), category: z.array(record), offerings: z.array(record), eventMix: z.array(record) });
  if (path === '/business/overview') return z.object({ summary: sales, daily: z.array(z.object({ date: z.iso.date(), salesCents: count })), range: record, scope: z.enum(['mixed', 'own']) });
  if (path === '/admin/overview') return z.object({ users: count, organizations: count, events: count, paidOrders: count });
  if (path.endsWith('/referral-link')) return z.object({ eventId: uuid, code: z.string(), referrerName: z.string() });
  if (path.endsWith('/guestlist') && method === 'get') return z.array(guest);
  if (path.endsWith('/guestlist')) return z.object({ entry: guest, requiresApproval: z.boolean() }).catchall(z.json());
  if (path.includes('/guestlist/:entryId/decision')) return z.object({ entry: guest }).catchall(z.json());
  if (path === '/orders' && method === 'post') return z.object({ replayed: z.boolean(), order: entity, tickets: z.array(entity).optional() }).catchall(z.json());
  if (path === '/orders/:orderId') return entity;
  if (path.endsWith('/affiliates') || path.endsWith('/guestlist-allocation') || path.endsWith('/people') && method === 'put') return entity;
  // Heterogeneous workflow responses (onboarding, dynamic admin editors,
  // bootstrap, legacy analytics) expose extensible JSON object/array contracts.
  // This is explicitly partial field coverage, not an undocumented {} schema.
  return z.union([record, z.array(record)]);
}

function contractFor({ method, path, authenticated, requestSchema }) {
  if (!routeInventory.some((route) => route.method === method && route.path === path)) throw new Error(`API contract missing for ${method.toUpperCase()} ${path}`);
  const querySchema = method === 'get' ? queries[path] : undefined;
  const paramsSchema = paramsFor(path);
  let resourceSchemas;
  if (path === '/admin/management/users/:id/scoped-role') requestSchema = scopedRoleSchema;
  if (path === '/admin/management/:resource' && method === 'post') {
    resourceSchemas = Object.fromEntries(Object.entries(managed.registry).filter(([, value]) => value.schema).map(([key, value]) => [key, value.schema]));
    requestSchema = z.object({ reason: managed.reasonSchema }).passthrough();
  }
  if (path === '/admin/management/:resource/:id' && method === 'patch') resourceSchemas = editSchemas;
  if (path === '/admin/management/:resource/:id/actions/:action') resourceSchemas = { suspend: managed.lifecycleActionSchema, archive: managed.lifecycleActionSchema, restore: managed.lifecycleActionSchema, cancel_event: managed.lifecycleActionSchema, other: managed.actionReasonSchema };
  const data = responseFor(method, path);
  const statuses = routeInventory.find((route) => route.method === method && route.path === path).successStatuses;
  const responseSchemas = Object.fromEntries(statuses.map((status) => [status,
    path.endsWith('/export.csv') && status === 202 ? envelope(exportJob) : path === '/openapi.json' ? data : envelope(data)]));
  return { method, path, authenticated, requestSchema, resourceSchemas, querySchema, paramsSchema, responseSchemas,
    csv: path.endsWith('/export.csv') || path.endsWith('/exports/:id/download'),
    deprecated: path === '/business/workspace' || path === '/business/analytics' || path === '/admin/analytics' || method === 'patch' && /^\/admin\/(users|organizations|events)\/:id$/.test(path),
    tag: path.startsWith('/admin') ? 'admin' : path.includes('/reports') || path.includes('/analytics') ? 'reporting'
      : path.startsWith('/auth') ? 'account' : path.includes('/admissions') || path === '/check-ins' ? 'admissions'
        : path.startsWith('/business') || path.startsWith('/organizations') || path.startsWith('/team') ? 'business'
          : path.startsWith('/customer') || path.startsWith('/orders') || path.startsWith('/notifications') ? 'customer' : 'public' };
}

function jsonSchema(schema, io = 'output') {
  const result = z.toJSONSchema(schema, { io, unrepresentable: ({ zodSchema }) => {
    if (zodSchema._zod.def.type === 'date') return { type: 'string', format: 'date-time' };
    if (zodSchema._zod.def.type === 'transform') return { type: ['string', 'null'], description: 'Normalized by the shared runtime validator.' };
    return 'throw';
  }, override: ({ zodSchema, jsonSchema }) => {
    const type = zodSchema._zod.def.type;
    if (zodSchema._zod.def.coerce && type === 'number') Object.assign(jsonSchema, { type: 'number' });
    if (type === 'date') Object.assign(jsonSchema, { type: 'string', format: 'date-time' });
  } });
  delete result.$schema;
  // Zod's recursive JsonValue uses document-root $defs references. OpenAPI
  // embeds schemas under operations, so point those to one shared component.
  const normalize = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref?.startsWith('#/$defs/')) value.$ref = '#/components/schemas/JsonValue';
    delete value.$defs;
    for (const child of Object.values(value)) normalize(child);
  };
  normalize(result);
  return result;
}

function generateOpenApi(contracts) {
  const paths = {};
  for (const contract of contracts) {
    const path = contract.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const operation = { operationId: `${contract.method}_${contract.path.replace(/[^A-Za-z0-9]+/g, '_')}`, tags: [contract.tag],
      security: contract.authenticated ? [{ bearerSession: [] }] : [], deprecated: contract.deprecated, parameters: [], responses: {} };
    if (contract.paramsSchema) for (const [name, schema] of Object.entries(contract.paramsSchema.shape)) operation.parameters.push({ name, in: 'path', required: true, schema: jsonSchema(schema) });
    if (contract.querySchema) {
      const schema = jsonSchema(contract.querySchema, 'input');
      const properties = schema.properties || Object.assign({}, ...(schema.anyOf || []).map((branch) => branch.properties || {}));
      for (const [name, value] of Object.entries(properties)) operation.parameters.push({ name, in: 'query', required: schema.required?.includes(name) || false,
        style: 'form', explode: true, schema: value });
    }
    if (contract.requestSchema) operation.requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(contract.requestSchema, 'input') } } };
    if (contract.resourceSchemas) {
      const schemas = Object.fromEntries(Object.entries(contract.resourceSchemas).map(([key, schema]) => {
        const value = jsonSchema(schema, 'input');
        if (contract.method === 'post' && contract.path === '/admin/management/:resource') {
          value.properties.reason = jsonSchema(managed.reasonSchema, 'input');
          value.required = [...new Set([...(value.required || []), 'reason'])];
        }
        return [key, value];
      }));
      operation.requestBody = { required: true, content: { 'application/json': { schema: { anyOf: Object.values(schemas) } } } };
      operation['x-request-schema-by-resource-or-action'] = schemas;
    }
    for (const [status, schema] of Object.entries(contract.responseSchemas)) operation.responses[status] = { description: status === '202' ? 'Accepted asynchronous work' : 'Successful response', content: contract.csv && status === '200' ? { 'text/csv': { schema: { type: 'string' } } } : { 'application/json': { schema: jsonSchema(schema) } } };
    for (const status of [400, 401, 402, 403, 404, 405, 409, 410, 413, 415, 422, 429, 500, 503]) operation.responses[status] = { description: 'Structured error; code identifies the domain failure', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    if (contract.path === '/openapi.json') operation.responses['200'] = { description: 'OpenAPI3.1 contract', content: { 'application/json': { schema: {
      type: 'object', required: ['openapi', 'info', 'paths', 'components'], properties: {
        openapi: { const: '3.1.0' }, info: { type: 'object' }, paths: { type: 'object' }, components: { type: 'object' },
      },
    } } } };
    (paths[path] ||= {})[contract.method] = operation;
  }
  Object.assign(paths, require('./app-contract').supplementalPaths({ jsonSchema, errorSchema: error }));
  return { openapi: '3.1.0', info: { title: 'NiteWide API', version: '1.0.0', description: 'Generated from domain route registrations and shared runtime validators. Cross-field refinements and authorization are enforced by domain services.' },
    servers: [{ url: '/api' }], tags: ['public', 'account', 'customer', 'business', 'admissions', 'reporting', 'admin'].map((name) => ({ name })), paths,
    components: { securitySchemes: { bearerSession: { type: 'http', scheme: 'bearer', bearerFormat: 'Signed server-revocable session' } }, schemas: {
      JsonValue: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' },
        { type: 'array', items: { $ref: '#/components/schemas/JsonValue' } }, { type: 'object', additionalProperties: { $ref: '#/components/schemas/JsonValue' } }] },
      Error: jsonSchema(error), Event: jsonSchema(event), Offering: jsonSchema(offering), ReportPage: jsonSchema(page(reportRow)), ExportJob: jsonSchema(exportJob), Session: jsonSchema(session),
    } } };
}

module.exports = { contractFor, generateOpenApi, jsonSchema, responses, queries, paramsFor };
