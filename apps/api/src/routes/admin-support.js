const { asyncHandler,validate } = require('./contract-router');
const schemas = require('../http/admin-support-schemas');
function registerAdminSupportRoutes({ router,requireUser,adminSupport }) {
  router.get('/admin/support/cases',requireUser,asyncHandler(async (req,res) => res.json({ data: await adminSupport.list(req.userId,schemas.caseQuery.parse(req.query)) })));
  router.post('/admin/support/cases',requireUser,validate(schemas.createCase),asyncHandler(async (req,res) => res.status(201).json({ data: await adminSupport.create(req.userId,req.body) })));
  router.get('/admin/support/cases/:id',requireUser,asyncHandler(async (req,res) => res.json({ data: await adminSupport.detail(req.userId,req.params.id) })));
  router.get('/admin/support/cases/:id/history',requireUser,asyncHandler(async (req,res) => res.json({ data: await adminSupport.history(req.userId,req.params.id,schemas.historyQuery.parse(req.query)) })));
  router.patch('/admin/support/cases/:id',requireUser,validate(schemas.updateCase),asyncHandler(async (req,res) => res.json({ data: await adminSupport.update(req.userId,req.params.id,req.body) })));
  router.get('/admin/overview/needs-attention',requireUser,asyncHandler(async (req,res) => res.json({ data: await adminSupport.needsAttention(req.userId,schemas.attentionQuery.parse(req.query)) })));
}
module.exports = { registerAdminSupportRoutes };
