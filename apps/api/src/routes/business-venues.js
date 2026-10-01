const { validate } = require('./contract-router');
const { createBusinessVenueService, venuePageSchema, venueCreateSchema, venueUpdateSchema, venueLifecycleSchema, venueTeamSchema } = require('../services/business-venue-service');

function registerVenueRoutes({ router, models, permissions, requireUser, asyncHandler }) {
  const service = createBusinessVenueService({ models, permissions });
  for (const [prefix, internal] of [['/admin/businesses/:id/venues', true], ['/business/organizations/:id/venues', false]]) {
    const query = (req) => venuePageSchema.parse(req.query);
    router.get(prefix, requireUser, asyncHandler(async (req, res) => res.json({ data: await service.list(req.userId, req.params.id, query(req), internal) })));
    router.post(prefix, requireUser, validate(venueCreateSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.userId, req.params.id, req.body, internal) })));
    router.get(`${prefix}/:locationId`, requireUser, asyncHandler(async (req, res) => res.json({ data: await service.detail(req.userId, req.params.id, req.params.locationId, internal) })));
    router.patch(`${prefix}/:locationId`, requireUser, validate(venueUpdateSchema), asyncHandler(async (req, res) => res.json({ data: await service.update(req.userId, req.params.id, req.params.locationId, req.body, internal) })));
    router.get(`${prefix}/:locationId/team`, requireUser, asyncHandler(async (req, res) => res.json({ data: await service.team(req.userId, req.params.id, req.params.locationId, query(req), internal) })));
    router.get(`${prefix}/:locationId/candidates`, requireUser, asyncHandler(async (req, res) => res.json({ data: await service.candidates(req.userId, req.params.id, req.params.locationId, query(req), internal) })));
    router.put(`${prefix}/:locationId/team/:userId`, requireUser, validate(venueTeamSchema), asyncHandler(async (req, res) => res.json({ data: await service.saveMember(req.userId, req.params.id, req.params.locationId, req.params.userId, req.body, internal) })));
    for (const action of ['archive', 'suspend', 'restore']) router.post(`${prefix}/:locationId/${action}`, requireUser, validate(venueLifecycleSchema), asyncHandler(async (req, res) => res.json({ data: await service.lifecycle(req.userId, req.params.id, req.params.locationId, action, req.body, internal) })));
  }
  return service;
}
module.exports = { registerVenueRoutes };
