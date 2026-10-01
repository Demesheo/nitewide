const querySchemas = require('../http/domain-query-schemas');
const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/schemas');
const { z } = require('zod');

function registerAdmissionsRoutes({ router, commerceController, requireUser, admissions }) {
  router.use('/business/admissions', requireUser, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/business/admissions/events', asyncHandler(async (req, res) => res.json({ data: await admissions.events(req.userId, querySchemas.admissions.parse(req.query)) })));
  router.get('/business/admissions/events/:eventId', asyncHandler(async (req, res) => res.json({ data: await admissions.roster(req.userId, z.string().uuid().parse(req.params.eventId), querySchemas.admissionsRoster.parse(req.query)) })));
  router.post('/check-ins', requireUser, validate(schemas.checkIn), asyncHandler(commerceController.checkIn));
}
module.exports = { registerAdmissionsRoutes };
