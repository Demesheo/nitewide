// Reminders use the original order UUID. No payment secrets or cart contents
// belong in notifications. Eligibility is checked by the database before
// pagination/counting so completed or cancelled attempts cannot leak through.
function checkoutReminderVisibleSql(alias) {
  return `EXISTS (SELECT 1 FROM orders reminder_order
    WHERE reminder_order.id = ${alias}.id
      AND reminder_order.buyer_user_id = ${alias}.user_id
      AND reminder_order.status = 'pending' AND reminder_order.provider_mode = 'test')`;
}

async function ensureCheckoutReminder(models, order, event, transaction) {
  return models.Notification.findOrCreate({ where: { id: order.id }, defaults: {
    userId: order.buyerUserId, eventId: event.id, kind: 'checkout_pending',
    title: 'Purchase incomplete', message: `Continue your purchase for ${event.title}?`.slice(0, 500),
    metadata: { orderId: order.id },
  }, transaction });
}
module.exports = { checkoutReminderVisibleSql, ensureCheckoutReminder };
