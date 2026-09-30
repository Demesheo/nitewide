const { randomUUID } = require('node:crypto');
const { createEmailService } = require('../services/email-service');
const { createNotificationJobService } = require('../services/notification-job-service');
const { createPermissionService } = require('../services/permission-service');
const { createBusinessReadService } = require('../services/business-read-service');
const { createBusinessReportService } = require('../services/business-report-service');
const { createAdminReportService } = require('../services/admin-report-service');
const { createReportExportService } = require('../services/report-export-service');

function backgroundServices({ sequelize, models, config }) {
  const permissions = createPermissionService(models);
  const businessRead = createBusinessReadService({ models });
  const reports = createBusinessReportService({ models, businessRead });
  const historicalReports = createAdminReportService({ models, permissions, businessRead }).reports;
  return {
    email: createEmailService({ sequelize, models, apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL,
      encryptionKey: config.EMAIL_ENCRYPTION_KEY, testMode: config.resendTestMode,
      concurrency: config.EMAIL_WORKER_CONCURRENCY, batchSize: config.EMAIL_WORKER_BATCH_SIZE,
      requestIntervalMs: config.EMAIL_REQUEST_INTERVAL_MS }),
    notifications: createNotificationJobService({ sequelize, models, concurrency: config.NOTIFICATION_WORKER_CONCURRENCY }),
    exports: Array.from({ length: config.EXPORT_WORKER_CONCURRENCY }, () => createReportExportService({ models, businessRead, reports, historicalReports })),
  };
}

// Independent loops prevent a long export from delaying email, notifications
// or heartbeat. A lane never overlaps its own drain invocation.
function createWorkerRuntime({ sequelize, services, pollIntervalMs = 2000, log = console, id = randomUUID() }) {
  let stopping = false, started = false, active = [], stoppingPromise;
  const sleepers = new Set();
  async function pause() {
    if (stopping) return;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
      const timer = setTimeout(done, pollIntervalMs); sleepers.add(done);
    });
  }
  async function heartbeat(status = 'running') {
    await sequelize.query(`INSERT INTO background_workers(id,status,heartbeat_at,details) VALUES(:id,:status,NOW(),CAST(:details AS jsonb))
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,heartbeat_at=EXCLUDED.heartbeat_at,details=EXCLUDED.details`,
    { replacements: { id, status, details: JSON.stringify({ emailEnabled: services.email.enabled, exportConcurrency: services.exports.length }) } });
  }
  async function loop(name, fn) {
    while (!stopping) {
      try { await fn(); } catch (error) { log.error(`Background ${name} failed:`, error.code || error.name); }
      await pause();
    }
  }
  async function start() {
    if (started || stopping) return; started = true;
    await sequelize.authenticate(); await heartbeat();
    if (stopping) return;
    active = [loop('email', () => services.email.drain()), loop('notifications', () => services.notifications.drain()),
      ...services.exports.map(service => loop('exports', () => service.drain())), loop('heartbeat', () => heartbeat())];
  }
  function stop() {
    if (stoppingPromise) return stoppingPromise;
    stopping = true; for (const wake of sleepers) wake();
    stoppingPromise = (async () => {
      const results = await Promise.allSettled([services.email.stop(), services.notifications.stop(), ...services.exports.map(service => service.stop())]);
      await Promise.allSettled(active); await heartbeat('stopped');
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    })();
    return stoppingPromise;
  }
  return { start, stop, id };
}
module.exports = { backgroundServices, createWorkerRuntime };
