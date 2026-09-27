const { TEMPLATES } = require('./email-templates');

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const firstName = (user) => user?.displayName?.trim() || 'there';
async function timezoneForEvent(models, event, transaction) {
  if (!event.locationId || !models.Location?.findByPk) return 'America/New_York';
  const location = await models.Location.findByPk(event.locationId, { attributes: ['timezone'], transaction });
  return location?.timezone || 'America/New_York';
}
function formatTime(value, timezone = 'America/New_York') {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full', timeStyle: 'short', timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}
function bookingUrl(base, kind, id) {
  const url = new URL(base);
  url.searchParams.set('booking', `${kind}:${id}`);
  return url.toString();
}
function eventUrl(base, id) {
  const url = new URL(base);
  url.searchParams.set('event', id);
  return url.toString();
}
const venueName = (location) => [location?.name, location?.addressLine1, location?.city, location?.region].filter(Boolean).join(', ') || 'See event details';

async function queuePurchaseEmail({ email, models, order, event, lines, demo, buyerUserId, customerAppUrl, transaction }) {
  if (!email?.enabled) return;
  const buyer = await models.User.findByPk(buyerUserId, { transaction });
  if (!buyer?.email) return;
  const timezone = await timezoneForEvent(models, event, transaction);
  await email.queue({
    key: `purchase/${order.id}`, to: buyer.email, template: TEMPLATES.purchaseReceipt,
    variables: {
      NAME: firstName(buyer), EVENT_TITLE: event.title,
      EVENT_DATE: formatTime(event.startsAt, timezone), ORDER_NUMBER: order.id,
      ITEMS: lines.map(({ offering, quantity }) => `${quantity} × ${offering.name}`).join('; '),
      TOTAL: demo ? '$0.00' : money(order.totalCents),
      BOOKING_URL: bookingUrl(customerAppUrl, 'purchase', order.id),
      DEMO_NOTE: demo ? 'Demo booking — no payment was collected.' : '',
    },
  }, transaction);
}

async function queueGuestlistEmail({ email, models, entry, event, kind, customerAppUrl, transaction }) {
  if (!email?.enabled) return;
  const user = await models.User.findByPk(entry.userId, { transaction });
  if (!user?.email) return;
  const timezone = await timezoneForEvent(models, event, transaction);
  const templates = {
    received: TEMPLATES.guestlistReceived,
    approved: TEMPLATES.guestlistApproved,
    declined: TEMPLATES.guestlistDeclined,
    waitlisted: TEMPLATES.guestlistWaitlisted,
  };
  const template = templates[kind];
  if (!template) throw new Error('Unknown guestlist email kind');
  await email.queue({
    key: `guestlist/${entry.id}/${kind}/${entry.reviewedAt ? new Date(entry.reviewedAt).getTime() : 'request'}`,
    to: user.email, template,
    variables: {
      NAME: firstName(user), EVENT_TITLE: event.title,
      EVENT_DATE: formatTime(event.startsAt, timezone), SPOTS: String(entry.partySize),
      BOOKING_URL: bookingUrl(customerAppUrl, 'guestlist', entry.id),
    },
  }, transaction);
}

async function audienceForEvent(models, eventId, transaction) {
  const [orders, entries] = await Promise.all([
    models.Order.findAll({ where: { eventId, status: 'paid' }, attributes: ['id', 'buyerUserId'], transaction }),
    models.GuestlistEntry.findAll({ where: { eventId, status: ['pending', 'confirmed', 'checked_in'] }, attributes: ['id', 'userId'], transaction }),
  ]);
  const userIds = [...new Set([...orders.map((row) => row.buyerUserId), ...entries.map((row) => row.userId)])];
  if (!userIds.length) return [];
  const users = await models.User.findAll({ where: { id: userIds, isActive: true }, attributes: ['id', 'email', 'displayName'], transaction });
  return users.map((user) => {
    const order = orders.find((row) => row.buyerUserId === user.id);
    const entry = entries.find((row) => row.userId === user.id);
    return { user, booking: order ? { kind: 'purchase', id: order.id } : { kind: 'guestlist', id: entry.id } };
  });
}

async function queueEventEmail({ email, models, event, kind, variables, customerAppUrl, transaction, key }) {
  if (!email?.enabled) return 0;
  const users = await audienceForEvent(models, event.id, transaction);
  const timezone = await timezoneForEvent(models, event, transaction);
  const template = {
    cancelled: TEMPLATES.eventCancelled,
    timeChange: TEMPLATES.eventTimeChange,
    venueChange: TEMPLATES.eventVenueChange,
    instructions: TEMPLATES.eventInstructions,
  }[kind];
  if (!template) throw new Error('Unknown event email kind');
  for (const { user, booking } of users) {
    if (!user.email) continue;
    await email.queue({
      key: `event/${event.id}/${key}/${user.id}`, to: user.email, template,
      variables: {
        NAME: firstName(user), EVENT_TITLE: event.title,
        EVENT_DATE: formatTime(event.startsAt, timezone), EVENT_URL: eventUrl(customerAppUrl, event.id),
        BOOKING_URL: bookingUrl(customerAppUrl, booking.kind, booking.id), ...variables,
      },
    }, transaction);
  }
  return users.length;
}

module.exports = { queuePurchaseEmail, queueGuestlistEmail, queueEventEmail, formatTime, venueName, bookingUrl };
