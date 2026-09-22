// DEMO FIXTURE policy only. Checkout intentionally permits legitimate purchases
// for overlapping events. Guestlist requests are never considered here.
function overlaps(a, b) {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
}
function canBook(events, candidate) {
  return !events.some(event => event.id !== candidate.id && overlaps(event, candidate));
}
function planPurchaseCleanup(orders) {
  const kept = [], removed = [];
  // Never delete a non-seed purchase; seed orders yield to them regardless of date.
  const sorted = [...orders].sort((a, b) => Number(a.seed) - Number(b.seed)
    || new Date(a.paidAt || a.createdAt) - new Date(b.paidAt || b.createdAt) || a.id.localeCompare(b.id));
  for (const order of sorted) {
    const conflict = kept.find(other => other.buyerUserId === order.buyerUserId && other.event.id !== order.event.id && overlaps(other.event, order.event));
    if (order.seed && conflict) removed.push({ order, keptOrderId: conflict.id });
    else kept.push(order);
  }
  return { kept, removed };
}
module.exports = { overlaps, canBook, planPurchaseCleanup };
