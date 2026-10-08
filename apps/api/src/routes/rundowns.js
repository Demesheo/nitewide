const { z } = require('zod');
const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/rundown-schemas');
function registerRundownRoutes({ router, requireUser, rundowns }) {
  router.get('/customer/rundowns', requireUser, asyncHandler(async (req, res) => res.json({ data: await rundowns.list(req.userId) })));
  router.get('/customer/rundowns/preview', requireUser, asyncHandler(async (req, res) => res.json({ data: await rundowns.preview(req.userId, schemas.previewQuery.parse(req.query)) })));
  router.post('/customer/rundowns', requireUser, validate(schemas.publish),
    asyncHandler(async (req, res) => res.json({ data: await rundowns.publish(req.userId, req.body) })));
  router.get('/rundowns/:id', asyncHandler(async (req, res) => res.json({ data: await rundowns.page(z.uuid().parse(req.params.id), schemas.pageQuery.parse(req.query)) })));
}
module.exports = { registerRundownRoutes };
