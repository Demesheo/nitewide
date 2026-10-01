const { z } = require('zod');
const { asyncHandler, validate } = require('./contract-router');
const { selection, createProfile } = require('../http/payment-schemas');
function registerBusinessPaymentRoutes({ router,requireUser,paymentAccounts }) {
  const org = req => z.uuid().parse(req.params.organizationId), account = req => z.uuid().parse(req.params.accountId);
  router.get('/business/organizations/:organizationId/payment-accounts',requireUser,asyncHandler(async (req,res)=>res.json({data:await paymentAccounts.list(req.userId,org(req),req.query)})));
  router.post('/business/organizations/:organizationId/payment-accounts',requireUser,validate(createProfile),asyncHandler(async (req,res)=>res.status(201).json({data:await paymentAccounts.create(req.userId,org(req),req.body)})));
  for (const action of ['onboarding','synchronize']) router.post(`/business/organizations/:organizationId/payment-accounts/:accountId/${action}`,requireUser,asyncHandler(async (req,res)=>{
    if (action === 'onboarding') res.set('Cache-Control','no-store');
    res.json({data:await paymentAccounts[action](req.userId,org(req),account(req))});
  }));
  router.put('/business/organizations/:organizationId/payment-accounts/default',requireUser,validate(selection),asyncHandler(async(req,res)=>res.json({data:await paymentAccounts.selectDefault(req.userId,org(req),req.body.paymentAccountId)})));
  router.put('/business/events/:eventId/payment-account',requireUser,validate(selection),asyncHandler(async(req,res)=>res.json({data:await paymentAccounts.selectEvent(req.userId,z.uuid().parse(req.params.eventId),req.body.paymentAccountId)})));
}
module.exports = { registerBusinessPaymentRoutes, selection, createProfile };
