const { z } = require('zod');
const { MAX_IMAGE_BYTES } = require('../services/media-service');

const count = z.number().int().nonnegative();
const duration = z.number().nonnegative();
const time = z.iso.datetime({ offset: true });
const jsonRecord = z.record(z.string(), z.json());
const envelope = data => z.object({ data });
const pageFields = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
// These objects are also the background router's runtime validators.
const emailJobQuery = z.object({ ...pageFields, status: z.enum(['all', 'pending', 'processing', 'sent', 'failed', 'expired']).default('failed') });
const notificationJobQuery = z.object({ ...pageFields, status: z.enum(['pending', 'running', 'retry', 'completed', 'failed']).optional() });
const replayBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const jobParams = z.object({ id: z.uuid() });

const latencyAggregate = z.object({ key: z.string(), count, totalMs: duration, maxMs: duration, buckets: z.array(count) });
const metrics = z.object({ scope: z.literal('process'), uptimeSeconds: count,
  latencyBucketUpperBoundsMs: z.array(duration.nullable()), requests: z.array(latencyAggregate), queries: z.array(latencyAggregate) });
const health = z.object({ status: z.enum(['ok', 'degraded', 'draining']), service: z.literal('nitewide-api') });
const image = z.object({ id: z.uuid(), url: z.string(), width: count, height: count });
const worker = z.object({ id: z.uuid(), status: z.enum(['running', 'stopped']),
  started_at: time, heartbeat_at: time, healthy: z.boolean(), details: jsonRecord });
const emailJob = z.object({ id: z.uuid(), templateAlias: z.string(), status: z.enum(['pending', 'processing', 'sent', 'failed', 'expired']),
  attemptCount: count, cycleAttemptCount: count, replayCount: count,
  nextAttemptAt: time, firstAttemptAt: time.nullable(), leaseUntil: time.nullable(),
  providerMessageId: z.string().nullable(), lastError: z.string().nullable(), attemptHistory: z.array(jsonRecord), createdAt: time, updatedAt: time });
const notificationJob = z.object({ id: z.uuid(), order_id: z.uuid(), status: z.enum(['pending', 'running', 'retry', 'completed', 'failed']),
  attempts: count, total_deliveries: count, processed_deliveries: count, planned_at: time.nullable(), completed_at: time.nullable(),
  available_at: time, lease_until: time.nullable(), last_error: z.string().nullable(), created_at: time, updated_at: time });

const operations = [
  { method: 'get', path: '/health/live', authenticated: false, responses: { 200: health } },
  { method: 'get', path: '/health/ready', authenticated: false, responses: { 200: health, 503: health } },
  { method: 'get', path: '/health', authenticated: false, responses: { 200: health, 503: health } },
  { method: 'get', path: '/api/admin/diagnostics/metrics', authenticated: true, responses: { 200: envelope(metrics) } },
  { method: 'post', path: '/api/business/uploads/image', authenticated: true, multipart: true, responses: { 201: envelope(image) } },
  { method: 'get', path: '/api/media/images/:assetId', authenticated: false, image: true, params: z.object({ assetId: z.uuid() }) },
  { method: 'post', path: '/api/webhooks/resend', authenticated: false, signedWebhook: true, responses: { 204: null } },
  { method: 'get', path: '/api/admin/background/workers', authenticated: true, responses: { 200: envelope(z.array(worker)) } },
  { method: 'get', path: '/api/admin/background/email', authenticated: true, query: emailJobQuery,
    responses: { 200: envelope(z.object({ items: z.array(emailJob), total: count, page: count, pageSize: count, status: z.string() })) } },
  { method: 'get', path: '/api/admin/background/notifications', authenticated: true, query: notificationJobQuery,
    responses: { 200: envelope(z.object({ items: z.array(notificationJob), page: count, pageSize: count, hasMore: z.boolean() })) } },
  { method: 'post', path: '/api/admin/background/email/:id/replay', authenticated: true, params: jobParams, body: replayBody,
    responses: { 202: envelope(z.object({ id: z.uuid(), status: z.literal('pending'), replayCount: count })) } },
  { method: 'post', path: '/api/admin/background/notifications/:id/replay', authenticated: true, params: jobParams, body: replayBody,
    responses: { 202: envelope(z.object({ id: z.uuid(), status: z.literal('pending') })) } },
];

function supplementalPaths({ jsonSchema }) {
  const paths = {};
  for (const metadata of operations) {
    const api = metadata.path.startsWith('/api/');
    const path = (api ? metadata.path.slice(4) : metadata.path).replace(/:([A-Za-z]+)/g, '{$1}');
    const operation = { operationId: `app_${metadata.method}_${metadata.path.replace(/[^A-Za-z0-9]+/g, '_')}`,
      tags: [api ? metadata.path.includes('/admin/') ? 'admin' : metadata.signedWebhook ? 'account' : 'business' : 'public'],
      security: metadata.authenticated ? [{ bearerSession: [] }] : [], parameters: [], responses: {} };
    if (!api) operation.servers = [{ url: '/' }];
    if (metadata.params) for (const [name, schema] of Object.entries(metadata.params.shape)) {
      operation.parameters.push({ name, in: 'path', required: true, schema: jsonSchema(schema) });
    }
    if (metadata.query) {
      const schema = jsonSchema(metadata.query);
      for (const [name, field] of Object.entries(schema.properties)) operation.parameters.push({ name, in: 'query',
        required: schema.required?.includes(name) || false, schema: field, style: 'form', explode: true });
    }
    if (metadata.body) operation.requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(metadata.body, 'input') } } };
    if (metadata.multipart) {
      operation.description = 'Authenticated server-normalized artwork upload. One static JPG, PNG or WebP; at least 128×128 pixels, at most 20 megapixels. Finalized asset ID is stable; storage access URLs are generated when read.';
      operation.requestBody = { required: true, content: { 'multipart/form-data': { schema: {
        type: 'object', required: ['image'], additionalProperties: false,
        properties: { image: { type: 'string', format: 'binary', 'x-maxBytes': MAX_IMAGE_BYTES } },
      } } } };
    }
    if (metadata.signedWebhook) {
      operation.description = 'Svix verifies the raw JSON bytes before parsing. Unknown event types are acknowledged without processing. No session bearer token is required.';
      for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) operation.parameters.push({ name, in: 'header', required: true, schema: { type: 'string', minLength: 1 } });
      operation.requestBody = { required: true, content: { 'application/json': { schema: {
        type: 'object', description: 'Signed Resend event. Supported delivery events require type, created_at, and data.email_id.',
        properties: { type: { type: 'string' }, created_at: { type: 'string', format: 'date-time' }, data: { type: 'object', properties: { email_id: { type: 'string' } }, additionalProperties: true } }, additionalProperties: true,
      } } } };
    }
    for (const [status, schema] of Object.entries(metadata.responses || {})) operation.responses[status] = {
      description: status === '204' ? 'Signed event acknowledged; no response body' : 'Successful response',
      ...(schema ? { content: { 'application/json': { schema: jsonSchema(schema) } } } : {}),
    };
    if (metadata.image) {
      operation.responses[200] = { description: 'Normalized image bytes from local storage', content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } };
      operation.responses[302] = { description: 'Temporary private-storage access URL; do not persist or cache it', headers: {
        Location: { schema: { type: 'string', format: 'uri' } }, 'Cache-Control': { schema: { const: 'no-store' } },
      } };
    }
    for (const status of [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 503]) {
      if (!operation.responses[status]) operation.responses[status] = { description: 'Structured API error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    }
    (paths[path] ||= {})[metadata.method] = operation;
  }
  return paths;
}

function matches(operation, path) {
  const pattern = operation.path.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
  return new RegExp(`^${pattern}/?$`).test(path);
}
function externalRouteTemplate(path, method) {
  return operations.find(operation => (operation.method.toUpperCase() === method || method === 'HEAD' && operation.method === 'get') && matches(operation, path))?.path;
}
function externalAllowedMethods(path) {
  const methods = operations.filter(operation => matches(operation, path)).map(operation => operation.method.toUpperCase());
  if (methods.includes('GET')) methods.push('HEAD');
  if (methods.length) methods.push('OPTIONS');
  return [...new Set(methods)].sort();
}

module.exports = { supplementalPaths, externalAllowedMethods, externalRouteTemplate, operations, emailJobQuery, notificationJobQuery, replayBody, jobParams, metrics, health, image, worker, emailJob, notificationJob };
