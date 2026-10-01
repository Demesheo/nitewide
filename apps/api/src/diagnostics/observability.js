const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const requestContext = new AsyncLocalStorage();
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const QUERY_TYPES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'RAW', 'SHOWTABLES', 'SHOWINDEXES', 'DESCRIBE', 'VERSION', 'BULKUPDATE', 'BULKDELETE', 'FOREIGNKEYS']);
const BUCKETS = [5, 25, 100, 500, 1000, 5000, 30000, 120000];
const LEVELS = { silent: 99, error: 40, warn: 30, info: 20 };
function aggregate() { return { count: 0, totalMs: 0, maxMs: 0, buckets: [...BUCKETS.map(() => 0), 0] }; }
function observe(value, ms) {
  value.count++; value.totalMs += ms; value.maxMs = Math.max(value.maxMs, ms);
  const index = BUCKETS.findIndex(limit => ms <= limit); value.buckets[index < 0 ? BUCKETS.length : index]++;
}
function queryOutcome(error) {
  if (!error) return 'ok';
  return ['57014', '55P03'].includes(error.original?.code || error.parent?.code || error.code)
    || ['SequelizeConnectionAcquireTimeoutError', 'SequelizeConnectionTimedOutError'].includes(error.name) ? 'timeout' : 'error';
}

function createDiagnostics({ level = 'info', write = line => process.stdout.write(`${line}\n`), maxRoutes = 256 } = {}) {
  const requests = new Map(), queries = new Map();
  // Only fixed fields are accepted. Raw errors, headers, URLs, SQL, bindings,
  // user IDs and arbitrary objects can never reach this logger.
  function log(event, fields = {}, severity = 'info') {
    if (!Object.hasOwn(LEVELS, severity) || LEVELS[severity] < (LEVELS[level] ?? LEVELS.info)) return;
    const record = { timestamp: new Date().toISOString(), level: severity, event: ['http_request', 'api_started', 'api_startup_failed', 'api_shutdown', 'database_unavailable', 'worker_started', 'worker_shutdown', 'worker_startup_failed', 'worker_job_failed', 'account_verification_queue_failed'].includes(event) ? event : 'diagnostic' };
    if (REQUEST_ID.test(fields.requestId || '')) record.requestId = fields.requestId;
    if (METHODS.has(fields.method)) record.method = fields.method;
    if (typeof fields.route === 'string' && /^[A-Za-z0-9_/:.*{}-]{1,180}$/.test(fields.route)) record.route = fields.route;
    if (Number.isInteger(fields.status) && fields.status >= 100 && fields.status <= 599) record.status = fields.status;
    for (const field of ['durationMs', 'queryCount', 'queryDurationMs', 'port']) if (Number.isFinite(fields[field]) && fields[field] >= 0) record[field] = Math.round(fields[field] * 100) / 100;
    if (['ok', 'error', 'timeout', 'draining', 'forced', 'aborted'].includes(fields.outcome)) record.outcome = fields.outcome;
    if (['json', 'size', 'database_timeout', 'validation', 'authorization', 'database_constraint', 'conflict', 'rate_limit', 'unsupported', 'internal', 'request'].includes(fields.failureCategory)) record.failureCategory = fields.failureCategory;
    if (['email', 'notifications', 'exports', 'heartbeat', 'media cleanup'].includes(fields.lane)) record.lane = fields.lane;
    // Logging must never make an otherwise successful API response fail.
    try { write(JSON.stringify(record)); } catch { /* Collector unavailable. */ }
  }
  function middleware(req, res, next) {
    const supplied = req.get?.('x-request-id');
    req.requestId = typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied.toLowerCase() : randomUUID();
    res.set('X-Request-Id', req.requestId);
    const context = { requestId: req.requestId, queryCount: 0, queryDurationMs: 0 };
    const start = performance.now(); let recorded = false;
    function record(aborted) {
      if (recorded) return; recorded = true;
      const method = METHODS.has(req.method) ? req.method : 'OTHER';
      const template = req.diagnosticRoute || req.route?.path;
      // Domain modules may register a full fixed template. Never concatenate
      // req.baseUrl: nested routers can interpolate IDs into that value.
      const matched = typeof template === 'string' && /^[A-Za-z0-9_/:.*{}-]{1,180}$/.test(template) ? template : '__unmatched__';
      const key = `${method} ${matched} ${aborted ? 'aborted' : Math.floor(res.statusCode / 100) + 'xx'}`;
      const boundedKey = requests.has(key) || requests.size < maxRoutes ? key : 'OTHER __overflow__';
      if (!requests.has(boundedKey)) requests.set(boundedKey, aggregate());
      const durationMs = performance.now() - start; observe(requests.get(boundedKey), durationMs);
      log('http_request', { ...context, method, route: matched, status: res.statusCode, durationMs,
        failureCategory: req.diagnosticError,
        outcome: aborted ? 'aborted' : res.statusCode >= 500 ? 'error' : 'ok' }, res.statusCode >= 500 ? 'error' : 'info');
    }
    res.once('finish', () => record(false)); res.once('close', () => record(!res.writableFinished));
    requestContext.run(context, next);
  }
  function query(type, durationMs, error) {
    const operation = QUERY_TYPES.has(type) ? type : 'OTHER';
    const key = `${operation} ${queryOutcome(error)}`;
    if (!queries.has(key)) queries.set(key, aggregate());
    observe(queries.get(key), durationMs);
    const context = requestContext.getStore();
    if (context) { context.queryCount++; context.queryDurationMs += durationMs; }
  }
  function snapshot() {
    const serialize = values => Array.from(values, ([key, stats]) => ({ key, ...stats, totalMs: Math.round(stats.totalMs * 100) / 100, maxMs: Math.round(stats.maxMs * 100) / 100, buckets: [...stats.buckets] }));
    return { scope: 'process', uptimeSeconds: Math.floor(process.uptime()), latencyBucketUpperBoundsMs: [...BUCKETS, null], requests: serialize(requests), queries: serialize(queries) };
  }
  return { log, middleware, query, snapshot };
}

function instrumentDatabase(sequelize, diagnostics) {
  const original = sequelize.query;
  sequelize.query = async function measuredQuery(sql, options = {}) {
    const started = performance.now(); let failure;
    try { return await original.call(this, sql, options); }
    catch (error) { failure = error; throw error; }
    finally { diagnostics.query(options.type, performance.now() - started, failure); }
  };
  sequelize.diagnostics = diagnostics;
  return sequelize;
}
module.exports = { createDiagnostics, instrumentDatabase, queryOutcome, REQUEST_ID };
