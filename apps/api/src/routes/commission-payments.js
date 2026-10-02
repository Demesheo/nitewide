const { z } = require('zod');
const { asyncHandler, validate } = require('./contract-router');
const { commissionProfileInput, statementSelection, commissionApproval, commissionControl, commissionOnboardingInput, commissionFeeReviewInput } = require('../http/commission-payment-schemas');
function registerCommissionPaymentRoutes({ router, requireUser, commissionPayments, individualCommissionProfiles }) {
  const org = req => z.uuid().parse(req.params.organizationId), payment = req => z.uuid().parse(req.params.paymentId);
  const response = (res, data) => res.set('Cache-Control', 'no-store').json({ data });
  router.get('/account/commission-payment-profile', requireUser, asyncHandler(async (req, res) => response(res, await individualCommissionProfiles.get(req.userId))));
  router.post('/account/commission-payment-profile', requireUser, validate(commissionProfileInput), asyncHandler(async (req, res) => response(res.status(201), await individualCommissionProfiles.create(req.userId, req.body))));
  router.post('/account/commission-payment-profile/onboarding', requireUser, validate(commissionOnboardingInput), asyncHandler(async (req, res) => response(res, await individualCommissionProfiles.onboarding(req.userId, req.body))));
  for (const action of ['synchronize', 'disable', 'resume', 'disconnect']) router.post(`/account/commission-payment-profile/${action}`, requireUser, validate(commissionControl), asyncHandler(async (req, res) => response(res, await individualCommissionProfiles[action](req.userId))));
  router.get('/account/commission-payment-profile/dashboard', requireUser, asyncHandler(async (req, res) => response(res, await individualCommissionProfiles.dashboard(req.userId))));
  router.get('/account/commissions', requireUser, asyncHandler(async (req, res) => response(res, await commissionPayments.ownStatements(req.userId, req.query))));
  router.get('/business/organizations/:organizationId/commission-statements', requireUser, asyncHandler(async (req, res) => response(res, await commissionPayments.list(req.userId, org(req), req.query))));
  router.post('/business/organizations/:organizationId/commission-statements/:statementId/approve', requireUser, validate(commissionControl), asyncHandler(async (req, res) => response(res, await commissionPayments.approveStatement(req.userId, org(req), z.uuid().parse(req.params.statementId)))));
  router.post('/business/organizations/:organizationId/commission-payments/quote', requireUser, validate(statementSelection), asyncHandler(async (req, res) => response(res, await commissionPayments.quote(req.userId, org(req), req.body))));
  router.post('/business/organizations/:organizationId/commission-payments', requireUser, validate(commissionApproval), asyncHandler(async (req, res) => response(res.status(201), await commissionPayments.approve(req.userId, org(req), req.body))));
  router.get('/business/organizations/:organizationId/commission-payments/:paymentId', requireUser, asyncHandler(async (req, res) => response(res, await commissionPayments.get(req.userId, org(req), payment(req)))));
  router.post('/business/organizations/:organizationId/commission-payments/:paymentId/reconcile', requireUser, validate(commissionControl), asyncHandler(async (req, res) => response(res, await commissionPayments.get(req.userId, org(req), payment(req), { synchronize: true }))));
  router.post('/business/organizations/:organizationId/commission-payments/:paymentId/invoicing-fee-review', requireUser, validate(commissionFeeReviewInput), asyncHandler(async (req, res) => response(res, await commissionPayments.reviewInvoicingFee(req.userId, org(req), payment(req), req.body))));
}
module.exports = { registerCommissionPaymentRoutes };
