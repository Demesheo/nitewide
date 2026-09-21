import { localDateInputValue } from "../discovery-defaults.js";
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
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}
export function availableQuantity(offering, now = new Date()) {
  if (
    offering.isActive === false ||
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
export function checkoutTotal(priceCents, quantity) {
  const subtotal = priceCents * quantity;
  const fee = subtotal > 0 ? Math.round(subtotal * 0.08) + 89 : 0;
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
