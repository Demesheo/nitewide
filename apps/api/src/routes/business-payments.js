const { z } = require('zod');
const { asyncHandler, validate } = require('./contract-router');
const { selection, createProfile, paymentControl, disconnectPermission } = require('../http/payment-schemas');
function registerBusinessPaymentRoutes({ router,requireUser,paymentAccounts,models,stripe }) {
  const reports = require('../services/business-payment-overview-service').createBusinessPaymentOverviewService({ models });
  const disconnect = require('../services/business-payment-disconnect-service').createBusinessPaymentDisconnectService({models,stripe,paymentAccounts});
  const org = req => z.uuid().parse(req.params.organizationId), account = req => z.uuid().parse(req.params.accountId);
  router.get('/business/organizations/:organizationId/payment-overview',requireUser,asyncHandler(async (req,res)=>res.set('Cache-Control','no-store').json({data:await reports.overview(req.userId,org(req))})));
  router.get('/business/payments/earnings',requireUser,asyncHandler(async (req,res)=>res.set('Cache-Control','no-store').json({data:await reports.earnings(req.userId)})));
  router.get('/business/organizations/:organizationId/payment-accounts',requireUser,asyncHandler(async (req,res)=>res.json({data:await paymentAccounts.list(req.userId,org(req),req.query)})));
  router.post('/business/organizations/:organizationId/payment-accounts',requireUser,validate(createProfile),asyncHandler(async (req,res)=>res.status(201).json({data:await paymentAccounts.create(req.userId,org(req),req.body)})));
  router.get('/business/organizations/:organizationId/payment-accounts/:accountId/disconnect-impact',requireUser,asyncHandler(async(req,res)=>res.set('Cache-Control','no-store').json({data:await disconnect.impact(req.userId,org(req),account(req))})));
  for (const action of ['disable','resume','disconnect']) router.post(`/business/organizations/:organizationId/payment-accounts/:accountId/${action}`,requireUser,validate(paymentControl),asyncHandler(async(req,res)=>res.set('Cache-Control','no-store').json({data:await disconnect[action](req.userId,org(req),account(req),req.body)})));
  router.put('/business/organizations/:organizationId/members/:userId/payment-disconnect',requireUser,validate(disconnectPermission),asyncHandler(async(req,res)=>res.json({data:await disconnect.grant(req.userId,org(req),z.uuid().parse(req.params.userId),req.body)})));
  for (const action of ['onboarding','synchronize']) router.post(`/business/organizations/:organizationId/payment-accounts/:accountId/${action}`,requireUser,asyncHandler(async (req,res)=>{
    if (action === 'onboarding') res.set('Cache-Control','no-store');
    res.json({data:await paymentAccounts[action](req.userId,org(req),account(req))});
  }));
  router.put('/business/organizations/:organizationId/payment-accounts/default',requireUser,validate(selection),asyncHandler(async(req,res)=>res.json({data:await paymentAccounts.selectDefault(req.userId,org(req),req.body.paymentAccountId)})));
  router.put('/business/events/:eventId/payment-account',requireUser,validate(selection),asyncHandler(async(req,res)=>res.json({data:await paymentAccounts.selectEvent(req.userId,z.uuid().parse(req.params.eventId),req.body.paymentAccountId)})));
}
module.exports = { registerBusinessPaymentRoutes, selection, createProfile };
