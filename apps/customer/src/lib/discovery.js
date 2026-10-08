import { localDateInputValue } from "../discovery-defaults.js";
import { checkoutQuote } from './checkout-fees.js';
import { isPremiumHost } from './premium-host.js';
export const money = (cents, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export const priceLabel = (cents, currency = 'USD') =>
  cents === 0 ? 'Free' : money(cents, currency);
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
// An undated discovery window is all upcoming events; a chosen date is exact.
export function discoveryDateRange(date = '', now = new Date()) {
  const start = date || localDateInputValue(now);
  return { start, end: date ? start : null };
}
// Saved and Booked retain their own date policies. This helper preserves legacy
// fallback ordering; the paged API is authoritative for the selected sort.
export function filterDiscoveryEvents(events, filters = {}, now = new Date()) {
  const { start, end } = discoveryDateRange(filters.date, now);
  return filterEvents(events, filters, now).filter(event => {
    const day = eventDateKey(event);
    return day >= start && (!end || day <= end);
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
export function offeringAvailabilityLabel(offering, offerings = [], quantity = offering.minPerOrder || 1) {
  if (availableQuantity(offering)) {
    if (offering.priceCents === 0) return '';
    const quote = offeringPrice(offering, quantity);
    return quote.eligible ? feeLabel(quote, offering.currency) : 'Pricing unavailable';
  }
  if (offering.saleState === 'waiting_for_tier') {
    const previous = offerings.find((item) => item.id === offering.releaseAfterOfferingId);
    return previous ? `Opens when ${previous.name} sells out or closes` : 'Opens when the earlier tier sells out or closes';
  }
  if (offering.saleState === 'scheduled') return 'Opens later';
  if (offering.saleState === 'sold_out') return 'Sold out';
  if (offering.saleState === 'closed') return 'Sales closed';
  return 'Unavailable';
}
export function checkoutTotal(priceCents, quantity, currency = 'USD', feeMode = 'buyer') {
  const quote = checkoutQuote(priceCents, quantity, currency, feeMode);
  return { subtotal: quote.subtotalCents, fee: quote.feeCents, total: quote.totalCents,
    includedFee: quote.includedFeeCents,
    eligible: quote.eligible, discount: quote.discountCents || 0, floorAdjusted: Boolean(quote.floorAdjusted),
    standardCeilingExceeded: Boolean(quote.standardCeilingExceeded) };
}
export function feeLabel(quote, currency = 'USD') {
  if (!quote.eligible || !quote.total) return '';
  if (quote.fee > 0) return `+${money(quote.fee, currency)} fee`;
  return quote.includedFee > 0 ? `includes ${money(quote.includedFee, currency)} fee` : '';
}
export function offeringPrice(offering, quantity = offering.minPerOrder || 1) {
  return { ...checkoutTotal(offering.priceCents, quantity, offering.currency || 'USD', offering.effectiveFeeMode || 'buyer'), quantity, currency: offering.currency || 'USD' };
}
export function eventStartingPrice(event) {
  // Advertise an obtainable order total, not a sold-out tier, face value, or
  // single unit that cannot be bought because the offering requires a minimum.
  return (event.offerings || []).filter(offering => availableQuantity(offering) > 0)
    .map(offering => offeringPrice(offering)).filter(quote => quote.eligible)
    .sort((a, b) => a.total - b.total)[0] || null;
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
