const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const { asyncHandler, validate } = require('../http/middleware');
const { mutationTransaction } = require('../services/mutation-transaction');

function createBackgroundJobRouter({ sequelize, models, permissions, email, notificationJobs }) {
  const router = express.Router();
  router.use(asyncHandler(async (req, res, next) => { await permissions.assertInternal(req.userId); res.set('Cache-Control','no-store'); next(); }));
  const page = { page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
  router.get('/workers', asyncHandler(async (_req, res) => {
    const workers = await sequelize.query(`SELECT id,status,started_at,heartbeat_at,details,
      (status='running' AND heartbeat_at>NOW()-INTERVAL '2 minutes') AS healthy FROM background_workers ORDER BY heartbeat_at DESC LIMIT 100`, { type: QueryTypes.SELECT });
    res.json({ data: workers });
  }));
  router.get('/email', asyncHandler(async (req, res) => {
    const input = z.object({ ...page, status: z.enum(['all','pending','processing','sent','failed','expired']).default('failed') }).parse(req.query);
    const result = await email.list(input);
    res.json({ data: { items: result.rows, total: result.count, ...input } });
  }));
  router.get('/notifications', asyncHandler(async (req, res) => res.json({ data: await notificationJobs.list(req.userId,
    z.object({ ...page, status: z.enum(['pending','running','retry','completed','failed']).optional() }).parse(req.query)) })));
  const reason = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
  router.post('/email/:id/replay', validate(reason), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = await mutationTransaction(sequelize, async transaction => {
      await permissions.assertInternal(req.userId, transaction);
      const result = await email.replay(id, transaction);
      await models.AuditLog.create({ actorUserId: req.userId, entityType: 'EmailOutbox', entityId: id,
        action: 'background.email.replay', after: { reason: req.body.reason, ...result } }, { transaction });
      return result;
    });
    res.status(202).json({ data });
  }));
  router.post('/notifications/:id/replay', validate(reason), asyncHandler(async (req, res) => {
    const job = await notificationJobs.replay(req.userId, z.uuid().parse(req.params.id), req.body);
    res.status(202).json({ data: { id: job.id, status: job.status } });
  }));
  return router;
}
module.exports = { createBackgroundJobRouter };
