const express = require('express');
const { asyncHandler, validate, requireUser } = require('../http/middleware');
const schemas = require('../http/schemas');

function createRouter({ publicController, managementController, commerceController }) {
  const router = express.Router();
  router.get('/events', asyncHandler(publicController.listEvents));
  router.get('/events/:eventId', asyncHandler(publicController.getEvent));
  router.post('/organizations', requireUser, validate(schemas.organization), asyncHandler(managementController.createOrganization));
  router.post('/organizations/:organizationId/affiliates', requireUser, validate(schemas.orgAffiliate), asyncHandler(managementController.addOrgAffiliate));
  router.post('/events', requireUser, validate(schemas.event), asyncHandler(managementController.createEvent));
  router.post('/events/:eventId/offerings', requireUser, validate(schemas.offering), asyncHandler(managementController.addOffering));
  router.post('/events/:eventId/affiliates', requireUser, validate(schemas.eventAffiliate), asyncHandler(managementController.addEventAffiliate));
  router.post('/events/:eventId/guestlist', requireUser, validate(schemas.guestlist), asyncHandler(commerceController.joinGuestlist));
  router.post('/orders', requireUser, validate(schemas.checkout), asyncHandler(commerceController.checkout));
  router.get('/orders/:orderId', requireUser, asyncHandler(commerceController.getOrder));
  router.post('/check-ins', requireUser, validate(schemas.checkIn), asyncHandler(commerceController.checkIn));
  router.get('/business/events/:eventId/analytics', requireUser, asyncHandler(managementController.eventAnalytics));
  router.get('/admin/overview', requireUser, asyncHandler(managementController.adminOverview));
  return router;
}
module.exports = { createRouter };

