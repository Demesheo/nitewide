const { z } = require('zod');
const { paymentCheckoutSchema, refundSchema } = require('../http/payment-schemas');
function createPaymentController({ paymentCheckouts, refunds }) {
  return {
    prepare: async (req, res) => res.json({ data: await paymentCheckouts.prepare({ ...req.body, buyerUserId: req.userId }) }),
    verify: async (req, res) => res.json({ data: await paymentCheckouts.verify(req.userId, z.uuid().parse(req.params.orderId)) }),
    cancel: async (req, res) => res.json({ data: await paymentCheckouts.cancel(req.userId, z.uuid().parse(req.params.orderId)) }),
    lookup: async (req, res) => res.json({ data: await paymentCheckouts.lookup(req.userId, z.string().min(8).max(100).parse(req.params.idempotencyKey)) }),
    refund: async (req, res) => res.json({ data: await refunds.requestRefund(req.userId, z.uuid().parse(req.params.orderId), req.body) }),
    adminRefund: async (req, res) => res.json({ data: await refunds.requestRefund(req.userId, z.uuid().parse(req.params.orderId), req.body, { internalOverride: true }) }),
  };
}
module.exports = { createPaymentController, paymentCheckoutSchema, refundSchema };
