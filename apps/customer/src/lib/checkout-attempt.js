const storageKey = (buyerId) => `nitewide.checkout.${buyerId}`;
const resolveStorage = (storage) => storage === undefined ? globalThis.localStorage : storage;
const snapshotEvent = event => event ? {
  id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt,
  location: Object.fromEntries(Object.entries(event.location || {}).filter(([key, value]) => ['name', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode', 'timezone'].includes(key) && typeof value === 'string')),
  offerings: (event.offerings || []).filter(offering => offering && typeof offering === 'object').map(offering => Object.fromEntries(Object.entries(offering).filter(([key, value]) => ['id', 'name', 'kind', 'priceCents', 'currency', 'quantityTotal', 'quantitySold', 'quantityReserved', 'inventoryMode', 'entriesPerUnit', 'minPerOrder', 'maxPerOrder', 'isActive', 'effectiveFeeMode'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)))),
} : null;
export function restoredCheckoutEvent(attempt) {
  const context = attempt?.eventContext;
  if (context?.id !== attempt?.body.eventId || typeof context?.title !== 'string' || !Number.isFinite(Date.parse(context.startsAt)) || !Array.isArray(context.offerings) || !context.offerings.some(item => item?.id === attempt.body.items[0].offeringId && typeof item.name === 'string' && Number.isSafeInteger(item.priceCents))) return null;
  return snapshotEvent(context);
}

export function readCheckoutAttempt(buyerId, storage) {
  try {
    storage = resolveStorage(storage);
    const attempt = JSON.parse(storage.getItem(storageKey(buyerId)) || 'null');
    return attempt?.buyerId === buyerId && typeof attempt?.body?.idempotencyKey === 'string' && typeof attempt.body.eventId === 'string' && Array.isArray(attempt.body.items) && attempt.body.items.length === 1 && typeof attempt.body.items[0]?.offeringId === 'string' && Number.isInteger(attempt.body.items[0]?.quantity) && attempt.body.items[0].quantity > 0 ? attempt : null;
  } catch { return null; }
}

export function checkoutScope(buyerId, body) {
  return JSON.stringify([buyerId, body.eventId, body.items, body.affiliateCode || null, body.expectedTotalCents]);
}

export function prepareCheckoutAttempt(buyerId, body, storage, uuid = () => crypto.randomUUID(), mode = 'demo', referrerName = null, event = null) {
  try {
    storage = resolveStorage(storage);
    storage.getItem(storageKey(buyerId));
  } catch {
    throw new Error('Your browser cannot save this booking attempt. Enable browser storage before confirming your booking.');
  }
  const existing = readCheckoutAttempt(buyerId, storage);
  const scope = checkoutScope(buyerId, body);
  if (existing) {
    if (existing.scope !== scope) throw new Error('Check your previous booking before starting another.');
    return existing;
  }
  const attempt = { buyerId, scope, mode, referrerName: typeof referrerName === 'string' ? referrerName : null, eventContext: snapshotEvent(event), body: { ...body, idempotencyKey: uuid() } };
  // Persist before submitting. If storage is unavailable, do not risk a purchase
  // whose retry key would disappear on refresh.
  storage.setItem(storageKey(buyerId), JSON.stringify(attempt));
  return attempt;
}

function resumablePaymentCheckout(result) {
  // Every recovery path must retire a server-confirmed ended checkout, not
  // mount a dead form or keep offering Resume with the same cancelled order.
  if (['cancelled', 'refunded'].includes(result?.status)) throw Object.assign(new Error('This checkout has ended. Review your selection to start a new booking.'), { terminalOrderId: result.orderId });
  return result?.verificationStatus === 'review' ? { ...result, status: 'pending', clientSecret: null } : result;
}

export async function resumePaymentCheckout(attempt, request, token) {
  if (attempt.orderId) return resumablePaymentCheckout(await request(`/customer/payment-checkouts/${encodeURIComponent(attempt.orderId)}/resume`, { token, method: 'POST' }));
  let status;
  try { status = await request(`/customer/checkout-attempts/${encodeURIComponent(attempt.body.idempotencyKey)}`, { token }); }
  catch (error) { if (error.status !== 404) throw error; }
  if (status) status = resumablePaymentCheckout(status);
  if (status?.verificationStatus === 'review') return status;
  if (status?.status === 'paid') return status;
  // The server replays the original provider session for this key. Secrets
  // stay in memory, and a pending status never creates a different attempt.
  const { payment, ...body } = attempt.body;
  try {
    const result = await request('/customer/payment-checkouts', { token, body });
    return resumablePaymentCheckout(result);
  }
  catch (error) { error.checkoutRejected = ['PRICE_CHANGED', 'INSUFFICIENT_INVENTORY', 'EVENT_NOT_ON_SALE', 'OFFERING_NOT_ON_SALE', 'INVALID_AFFILIATE', 'SELF_REFERRAL', 'INVALID_QUANTITY', 'PAYMENTS_NOT_ENABLED', 'PAYMENTS_NOT_READY', 'PAYMENT_ACCOUNT_NOT_READY'].includes(error.code); throw error; }
}

export function rememberCheckoutOrder(attempt, orderId, storage) {
  const updated = { ...attempt, orderId };
  try {
    storage = resolveStorage(storage);
    if (readCheckoutAttempt(attempt.buyerId, storage)?.body.idempotencyKey === attempt.body.idempotencyKey) storage.setItem(storageKey(attempt.buyerId), JSON.stringify(updated));
  } catch { /* The server order is still recoverable through Notifications. */ }
  return updated;
}

// Server-owned order snapshots restore the cart even on a different device.
// Provider secrets stay only in React memory; another saved attempt is not lost.
export function restorePaymentAttempt(buyerId, checkout, storage) {
  const booking = checkout.booking;
  if (!booking?.event?.id || !booking.items?.length || !booking.idempotencyKey || !checkout.orderId) throw new Error('This checkout could not be restored. Refresh Notifications and try again.');
  const body = { eventId: booking.event.id, idempotencyKey: booking.idempotencyKey,
    items: booking.items.map(item => ({ offeringId: item.offeringId, quantity: item.quantity })), expectedTotalCents: booking.totalCents };
  const event = { ...booking.event, offerings: booking.items.map(item => ({ id: item.offeringId, name: item.name, kind: item.kind,
    priceCents: item.unitPriceCents, currency: booking.currency, minPerOrder: item.quantity, maxPerOrder: item.quantity })) };
  const attempt = { buyerId, body, scope: checkoutScope(buyerId, body), mode: 'stripe', orderId: checkout.orderId,
    eventContext: snapshotEvent(event), bookingTotals: { subtotal: booking.subtotalCents, total: booking.totalCents, fee: booking.totalCents - booking.subtotalCents } };
  try {
    storage = resolveStorage(storage);
    const existing = readCheckoutAttempt(buyerId, storage);
    if (!existing || existing.body.idempotencyKey === body.idempotencyKey) storage.setItem(storageKey(buyerId), JSON.stringify(attempt));
  } catch { /* Already-created orders do not need browser storage to resume. */ }
  return attempt;
}

export async function checkPaymentCheckout(orderId, request, token) {
  const result = await request(`/customer/payment-checkouts/${encodeURIComponent(orderId)}/verify`, { token, method: 'POST' });
  if (!result || result.orderId !== orderId) throw new Error('We couldn’t check this booking. Your original booking is saved; try Pay again shortly.');
  if (result.verificationStatus === 'review') throw Object.assign(new Error('Your payment needs review. Contact the event host before making another payment. Your booking reference is saved.'), { paymentReview: true, orderId });
  if (['cancelled', 'refunded'].includes(result.status)) throw Object.assign(new Error('This booking is no longer payable.'), { terminalOrderId: orderId });
  if (!['paid', 'pending'].includes(result.status)) throw new Error('We couldn’t check this booking. Your original booking is saved; try Pay again shortly.');
  return result;
}

export async function verifyPaymentCheckout(orderId, request, token, { tries = 4, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let index = 0; index < tries; index += 1) {
    const result = await checkPaymentCheckout(orderId, request, token);
    if (result.status === 'paid') return result;
    if (index < tries - 1) await delay(1000);
  }
  throw new Error('Payment is still being checked. Try Pay again shortly to check your original booking.');
}

export function clearCheckoutAttempt(buyerId, key, storage) {
  try {
    storage = resolveStorage(storage);
    if (readCheckoutAttempt(buyerId, storage)?.body.idempotencyKey === key) storage.removeItem(storageKey(buyerId));
  } catch { /* Storage denial must not prevent opening an already-paid pass. */ }
}

export async function checkCheckoutAttempt(attempt, request, token) {
  try {
    const result = await request(`/customer/checkout-attempts/${encodeURIComponent(attempt.body.idempotencyKey)}`, { token });
    if (!result.orderId) throw new Error('Your booking is still being checked. Try checking again shortly.');
    if (['refunded', 'cancelled'].includes(result.status)) throw Object.assign(new Error('This booking is no longer paid. Open Booked to check its current status.'), { terminalOrderId: result.orderId });
    if (result.status !== 'paid') throw new Error('Your booking is still being checked. Try checking again shortly.');
    return result.orderId;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function submitCheckoutAttempt(attempt, request, token) {
  const existingOrderId = await checkCheckoutAttempt(attempt, request, token);
  if (existingOrderId) return existingOrderId;
  let result;
  try { result = await request('/orders', { token, body: attempt.body }); }
  catch (error) {
    error.checkoutRejected = ['PRICE_CHANGED', 'INSUFFICIENT_INVENTORY', 'EVENT_NOT_ON_SALE', 'OFFERING_NOT_ON_SALE', 'INVALID_QUANTITY', 'INVALID_AFFILIATE', 'INVALID_REFERRAL', 'SELF_REFERRAL', 'PAYMENTS_NOT_ENABLED', 'DEMO_DISABLED', 'DEMO_ONLY'].includes(error.code);
    throw error;
  }
  return result.order.id;
}
