const express = require('express');
const { QueryTypes } = require('sequelize');
const { asyncHandler, validate } = require('../http/middleware');
const { mutationTransaction } = require('../services/mutation-transaction');
const { emailJobQuery, notificationJobQuery, replayBody, jobParams, externalRouteTemplate } = require('../http/app-contract');

function createBackgroundJobRouter({ sequelize, models, permissions, email, notificationJobs }) {
  const router = express.Router();
  router.use((req, _res, next) => {
    // Fixed templates only: never include actual identifiers in logs or labels.
    req.diagnosticRoute = externalRouteTemplate(`/api/admin/background${req.path}`, req.method) || '/api/admin/background/__unmatched__';
    next();
  });
  router.use(asyncHandler(async (req, res, next) => { await permissions.assertInternal(req.userId); res.set('Cache-Control','no-store'); next(); }));
  router.get('/workers', asyncHandler(async (_req, res) => {
    const workers = await sequelize.query(`SELECT id,status,started_at,heartbeat_at,details,
      (status='running' AND heartbeat_at>NOW()-INTERVAL '2 minutes') AS healthy FROM background_workers ORDER BY heartbeat_at DESC LIMIT 100`, { type: QueryTypes.SELECT });
    res.json({ data: workers });
  }));
  router.get('/email', asyncHandler(async (req, res) => {
    const input = emailJobQuery.parse(req.query);
    const result = await email.list(input);
    res.json({ data: { items: result.rows, total: result.count, ...input } });
  }));
  router.get('/notifications', asyncHandler(async (req, res) => res.json({ data: await notificationJobs.list(req.userId,
    notificationJobQuery.parse(req.query)) })));
  router.post('/email/:id/replay', validate(replayBody), asyncHandler(async (req, res) => {
    const { id } = jobParams.parse(req.params);
    const data = await mutationTransaction(sequelize, async transaction => {
      await permissions.assertInternal(req.userId, transaction);
      const result = await email.replay(id, transaction);
      await models.AuditLog.create({ actorUserId: req.userId, entityType: 'EmailOutbox', entityId: id,
        action: 'background.email.replay', after: { reason: req.body.reason, ...result } }, { transaction });
      return result;
    });
    res.status(202).json({ data });
  }));
  router.post('/notifications/:id/replay', validate(replayBody), asyncHandler(async (req, res) => {
    const job = await notificationJobs.replay(req.userId, jobParams.parse(req.params).id, req.body);
    res.status(202).json({ data: { id: job.id, status: job.status } });
  }));
  return router;
}
module.exports = { createBackgroundJobRouter };
