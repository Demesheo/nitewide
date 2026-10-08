const { randomUUID } = require('node:crypto');
const { createEmailService } = require('../services/email-service');
const { emailDeliveryPolicy } = require('../services/email-delivery-policy');
const { createNotificationJobService } = require('../services/notification-job-service');
const { createPermissionService } = require('../services/permission-service');
const { createBusinessReadService } = require('../services/business-read-service');
const { createBusinessReportService } = require('../services/business-report-service');
const { createAdminReportService } = require('../services/admin-report-service');
const { createReportExportService } = require('../services/report-export-service');
const { createMediaStorage } = require('../storage/media-storage');
const { createMediaCleanupService } = require('../services/media-cleanup-service');
const { createPaymentServices } = require('../payments/services');
const { createPaymentReconciliationLane } = require('./payment-reconciliation');
const { paymentRuntimeEvidence } = require('../diagnostics/payment-runtime');
const { createLocationGeocodingService } = require('../services/location-geocoding-service');

function backgroundServices({ sequelize, models, config }) {
  const permissions = createPermissionService(models);
  const businessRead = createBusinessReadService({ models });
  const reports = createBusinessReportService({ models, businessRead });
  const historicalReports = createAdminReportService({ models, permissions, businessRead }).reports;
  const notifications = createNotificationJobService({ sequelize, models, concurrency: config.NOTIFICATION_WORKER_CONCURRENCY });
  const payments = createPaymentServices({ sequelize, models, config, permissions, notificationJobs: notifications });
  return {
    paymentRuntime: paymentRuntimeEvidence(config),
    email: createEmailService({ sequelize, models, apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL,
      encryptionKey: config.EMAIL_ENCRYPTION_KEY, testMode: config.resendTestMode,
      deliveryPolicy: emailDeliveryPolicy(config),
      concurrency: config.EMAIL_WORKER_CONCURRENCY, batchSize: config.EMAIL_WORKER_BATCH_SIZE,
      requestIntervalMs: config.EMAIL_REQUEST_INTERVAL_MS }),
    notifications,
    geocoding: createLocationGeocodingService({ sequelize, config }),
    payments: createPaymentReconciliationLane({ ...payments, enabled: payments.stripe?.enabled === true }),
    exports: Array.from({ length: config.EXPORT_WORKER_CONCURRENCY }, () => createReportExportService({ models, businessRead, reports, historicalReports })),
    media: createMediaCleanupService({ models, storage: createMediaStorage({ config }), enabled: config.MEDIA_CLEANUP_ENABLED === 'true', intervalMs: config.MEDIA_CLEANUP_INTERVAL_MS }),
  };
}

// Independent loops prevent a long export from delaying email, notifications
// or heartbeat. A lane never overlaps its own drain invocation.
function createWorkerRuntime({ sequelize, services, pollIntervalMs = 2000, log = console, diagnostics = sequelize.diagnostics, id = randomUUID() }) {
  let stopping = false, started = false, active = [], stoppingPromise;
  const sleepers = new Set();
  async function pause(intervalMs = pollIntervalMs) {
    if (stopping) return;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
      const timer = setTimeout(done, intervalMs); sleepers.add(done);
    });
  }
  async function heartbeat(status = 'running') {
    await sequelize.query(`INSERT INTO background_workers(id,status,heartbeat_at,details) VALUES(:id,:status,NOW(),CAST(:details AS jsonb))
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,heartbeat_at=EXCLUDED.heartbeat_at,details=EXCLUDED.details`,
    { replacements: { id, status, details: JSON.stringify({ emailEnabled: services.email.enabled, emailDeliveryPolicy: services.email.deliveryPolicy, exportConcurrency: services.exports.length, mediaCleanupEnabled: Boolean(services.media?.enabled), paymentReconciliationEnabled: Boolean(services.payments?.enabled), paymentRuntime: services.paymentRuntime || null }) } });
  }
  async function loop(name, fn, intervalMs) {
    while (!stopping) {
      try { await fn(); } catch (error) {
        if (diagnostics) diagnostics.log('worker_job_failed', { lane: name, outcome: 'error' }, 'error');
        else log.error(`Background ${name} failed:`, error.code || error.name);
      }
      await pause(intervalMs);
    }
  }
  async function start() {
    if (started || stopping) return; started = true;
    await sequelize.authenticate(); await heartbeat();
    if (stopping) return;
    active = [loop('email', () => services.email.drain()), loop('notifications', () => services.notifications.drain()),
      ...services.exports.map(service => loop('exports', () => service.drain())), loop('heartbeat', () => heartbeat())];
    if (services.media) active.push(loop('media cleanup', () => services.media.drain()));
    if (services.payments?.enabled) active.push(loop('payments', () => services.payments.drain(), services.payments.intervalMs || 30000));
    if (services.geocoding) active.push(loop('public location geocoding', () => services.geocoding.drain(), 10000));
  }
  function stop() {
    if (stoppingPromise) return stoppingPromise;
    stopping = true; for (const wake of sleepers) wake();
    stoppingPromise = (async () => {
      const results = await Promise.allSettled([services.email.stop(), services.notifications.stop(), ...services.exports.map(service => service.stop()), services.media?.stop(), services.payments?.stop(), services.geocoding?.stop()]);
      await Promise.allSettled(active); await heartbeat('stopped');
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    })();
    return stoppingPromise;
  }
  return { start, stop, id };
}
module.exports = { backgroundServices, createWorkerRuntime };
