const { asyncHandler } = require('./contract-router');
const businessSchemas = require('../http/business-schemas');
const adminSchemas = require('../http/admin-report-schemas');
const { z } = require('zod');

function registerReportingRoutes({ router, managementController, requireUser, permissions, businessRead, businessReports, adminReports, reportExports }) {
  router.get('/admin/reports/bootstrap', requireUser, asyncHandler(async (req, res) => res.json({ data: await adminReports.bootstrap(req.userId) })));
  router.get('/admin/reports/summary', requireUser, asyncHandler(async (req, res) => res.json({ data: await adminReports.summary(req.userId, adminSchemas.reportDetailQuery.parse(req.query)) })));
  router.get('/admin/reports/export.csv', requireUser, asyncHandler(async (req, res) => {
    await permissions.assertInternalPermission(req.userId, 'reports.view');
    return reportExports.request(req.userId, { ...adminSchemas.reportDetailQuery.parse(req.query), audience: 'admin' }, res);
  }));
  router.get('/admin/reports/exports', requireUser, asyncHandler(async (req, res) => { await permissions.assertInternalPermission(req.userId,'reports.view'); res.json({ data: await reportExports.list(req.userId, 'admin') }); }));
  router.get('/admin/reports/exports/:id', requireUser, asyncHandler(async (req, res) => { await permissions.assertInternalPermission(req.userId,'reports.view'); res.json({ data: await reportExports.status(req.userId,z.uuid().parse(req.params.id)) }); }));
  router.get('/admin/reports/exports/:id/download', requireUser, asyncHandler(async (req, res) => { await permissions.assertInternalPermission(req.userId,'reports.view'); return reportExports.download(req.userId,z.uuid().parse(req.params.id),res); }));
  router.post('/admin/reports/exports/:id/retry', requireUser, asyncHandler(async (req, res) => { await permissions.assertInternalPermission(req.userId,'reports.view'); res.json({ data: await reportExports.retry(req.userId,z.uuid().parse(req.params.id)) }); }));
  router.get('/admin/reports/:table', requireUser, asyncHandler(async (req, res) => res.json({ data: await adminReports.table(req.userId,
    adminSchemas.reportTables.parse(req.params.table), adminSchemas.reportDetailQuery.parse(req.query)) })));
  router.get('/business/overview', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.overview(req.userId, businessSchemas.reportQuery.parse(req.query)) })));
  router.get('/business/overview/needs-attention', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.needsAttention(req.userId, businessSchemas.reportQuery.parse(req.query)) })));
  router.get('/business/reports/summary', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessReports.summary(req.userId, businessSchemas.reportDetailQuery.parse(req.query)) })));
  router.get('/business/reports/export.csv', requireUser, asyncHandler(async (req, res) => reportExports.request(req.userId, businessSchemas.reportDetailQuery.parse(req.query), res)));
  router.get('/business/reports/exports', requireUser, asyncHandler(async (req, res) => res.json({ data: await reportExports.list(req.userId) })));
  router.get('/business/reports/exports/:id', requireUser, asyncHandler(async (req, res) => res.json({ data: await reportExports.status(req.userId, z.uuid().parse(req.params.id)) })));
  router.get('/business/reports/exports/:id/download', requireUser, asyncHandler(async (req, res) => reportExports.download(req.userId, z.uuid().parse(req.params.id), res)));
  router.post('/business/reports/exports/:id/retry', requireUser, asyncHandler(async (req, res) => res.json({ data: await reportExports.retry(req.userId, z.uuid().parse(req.params.id)) })));
  router.get('/business/reports/:table', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessReports.table(req.userId,
    z.enum(['regions', 'venues', 'events', 'offerings', 'team', 'customers']).parse(req.params.table), businessSchemas.reportDetailQuery.parse(req.query)) })));
  router.get('/business/events/:eventId/analytics', requireUser, asyncHandler(managementController.eventAnalytics));
}
module.exports = { registerReportingRoutes };
