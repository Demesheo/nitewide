const { asyncHandler, validate } = require('./contract-router');
const { paymentCheckoutSchema, refundSchema } = require('../controllers/payment-controller');
function registerPaymentRoutes({ router, requireUser, paymentController }) {
  router.post('/customer/payment-checkouts', requireUser, validate(paymentCheckoutSchema), asyncHandler(paymentController.prepare));
  router.post('/customer/payment-checkouts/:orderId/verify', requireUser, asyncHandler(paymentController.verify));
  router.post('/customer/payment-checkouts/:orderId/cancel', requireUser, asyncHandler(paymentController.cancel));
  router.post('/business/orders/:orderId/refunds', requireUser, validate(refundSchema), asyncHandler(paymentController.refund));
  router.post('/admin/orders/:orderId/refunds', requireUser, validate(refundSchema), asyncHandler(paymentController.adminRefund));
}
module.exports = { registerPaymentRoutes };
