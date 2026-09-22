import { localDateInputValue } from "../discovery-defaults.js";
import { checkoutFeeCents } from './checkout-fees.js';
import { isPremiumHost } from './premium-host.js';
export const money = (cents, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export const cityName = (event) => event.location?.city || "Private location";
export function eventDateKey(event) {
  if (!event.location?.timezone)
    return localDateInputValue(new Date(event.startsAt));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: event.location.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(event.startsAt));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
// Keep calendar days chronological in each venue's timezone. Within a day,
// promote Premium hosts, then use name/ID rather than start time for stable order.
export function compareEventListings(a, b) {
  return eventDateKey(a).localeCompare(eventDateKey(b))
    || Number(isPremiumHost(b)) - Number(isPremiumHost(a))
    || (a.title || '').localeCompare(b.title || '', 'en', { sensitivity: 'base', numeric: true })
    || String(a.id).localeCompare(String(b.id));
}
export function filterEvents(
  events,
  {
    city = "",
    date = "",
    query = "",
    category = "all",
    savedIds = null,
    priceCap = "any",
  },
  now = new Date(),
) {
  const place = city.split(",")[0].trim().toLowerCase();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((event) => {
    const text = [
      event.title,
      event.description,
      event.summary,
      event.organization?.name,
      event.location?.name,
      event.location?.city,
      event.location?.region,
      event.category,
      ...(event.offerings || []).flatMap((offering) => [
        offering.name,
        offering.description,
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return (
      new Date(event.endsAt || event.startsAt) >= now &&
      (!place || cityName(event).toLowerCase().includes(place)) &&
      (!date || eventDateKey(event) === date) &&
      words.every((word) => text.includes(word)) &&
      (!savedIds || savedIds.includes(event.id)) &&
      (priceCap === "any" ||
        event.offerings?.some(
          (offering) =>
            availableQuantity(offering, now) > 0 &&
            offering.priceCents <= Number(priceCap),
        )) &&
      (category === "all" ||
        (category === "vip" &&
          event.offerings?.some((o) =>
            ["package", "reservation"].includes(o.kind),
          )) ||
        (category === "guestlist" && event.guestlistCapacity > 0) ||
        (category === "music" && /music|concert|dj|live/i.test(text)))
    );
  });
}
// Calendar arithmetic avoids shifting the seven-day window at DST boundaries.
export function discoveryDateRange(date = '', now = new Date()) {
  const start = date || localDateInputValue(now);
  const lastDay = new Date(`${start}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + (date ? 0 : 6));
  return { start, end: lastDay.toISOString().slice(0, 10) };
}
// Discover alone defaults to a week. Saved, Booked, and fallback searches retain
// their own date policies rather than inheriting this listing-page default.
export function filterDiscoveryEvents(events, filters = {}, now = new Date()) {
  const { start, end } = discoveryDateRange(filters.date, now);
  return filterEvents(events, filters, now).filter(event => {
    const day = eventDateKey(event);
    return day >= start && day <= end;
  }).sort(compareEventListings);
}
export function upcomingWeekRange(date) {
  const base = new Date(`${date}T12:00:00Z`);
  const day = (offset) => {
    const value = new Date(base);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  return { start: day(1), end: day(7) };
}
export function filterUpcomingWeek(events, filters, now = new Date()) {
  if (!filters.date) return [];
  const { start, end } = upcomingWeekRange(filters.date);
  return filterEvents(events, { ...filters, date: "" }, now)
    .filter((event) => {
      const day = eventDateKey(event);
      return day >= start && day <= end;
    })
    .sort(compareEventListings);
}
export function availableQuantity(offering, now = new Date()) {
  if (
    offering.isActive === false ||
    (offering.saleState && offering.saleState !== 'on_sale') ||
    (offering.salesStartAt && new Date(offering.salesStartAt) > now) ||
    (offering.salesEndAt && new Date(offering.salesEndAt) < now)
  )
    return 0;
  const remaining =
    offering.inventoryMode === "finite"
      ? Math.max(0, offering.quantityTotal - offering.quantitySold)
      : Infinity;
  const maximum = Math.min(offering.maxPerOrder || 10, remaining);
  return maximum < (offering.minPerOrder || 1) ? 0 : maximum;
}
export function offeringAvailabilityLabel(offering, offerings = []) {
  if (availableQuantity(offering)) return '+ fees';
  if (offering.saleState === 'waiting_for_tier') {
    const previous = offerings.find((item) => item.id === offering.releaseAfterOfferingId);
    return previous ? `Opens when ${previous.name} sells out or closes` : 'Opens when the earlier tier sells out or closes';
  }
  if (offering.saleState === 'scheduled') return 'Opens later';
  if (offering.saleState === 'sold_out') return 'Sold out';
  if (offering.saleState === 'closed') return 'Sales closed';
  return 'Unavailable';
}
export function checkoutTotal(priceCents, quantity) {
  const subtotal = priceCents * quantity;
  const fee = checkoutFeeCents(subtotal);
  return { subtotal, fee, total: subtotal + fee };
}
export function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
