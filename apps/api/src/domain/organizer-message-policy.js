const { conflict } = require('./errors');
const { isStripeMode } = require('../payments/stripe-mode');
function paidBooking(order) {
  return Boolean(order && (['paid', 'refunded'].includes(order.status) || order.status === 'cancelled' && order.paidAt));
}
function canRequestRefund(order, event, now = new Date()) {
  return Boolean(order?.status === 'paid' && order.totalCents > 0 && isStripeMode(order.providerMode)
    && order.providerVerificationStatus === 'verified' && event && +new Date(event.startsAt) > +now);
}
function assertRefundRequestOpen(order, event, now) {
  if (!canRequestRefund(order, event, now)) throw conflict('Refund or cancellation requests must be sent to the organizer before the event starts, for a verified paid booking.', 'REFUND_REQUEST_CLOSED');
}
module.exports = { paidBooking, canRequestRefund, assertRefundRequestOpen };
