export const money = (cents = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export function dateInput(value, timezone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function zonedISO(value, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid event date and time.");
  const target = Date.parse(`${value}:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const represented = Date.parse(`${dateInput(guess, timezone)}:00Z`);
    guess += target - represented;
  }
  if (dateInput(guess, timezone) !== value)
    throw new Error(
      "This time does not exist in the selected time zone (daylight saving time).",
    );
  return new Date(guess).toISOString();
}
export const defaultTiers = () =>
  [
    ["General Admission", "ticket", 10, 200, 1],
    ["2 regular bottles", "package", 300, 20, 4],
    ["2 premium bottles", "package", 400, 20, 4],
    ["2 clase/1942", "package", 1000, 10, 4],
  ].map(([name, kind, price, quantityTotal, entriesPerUnit]) => ({
    name,
    kind,
    price,
    quantityTotal,
    entriesPerUnit,
    inventoryMode: "finite",
    minPerOrder: 1,
    maxPerOrder: 10,
    isActive: true,
    visibility: "public",
    description: "",
  }));
export function editorDraft(event, organizationId = null) {
  const timezone = event?.location?.timezone || "America/New_York";
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(22, 0, 0, 0);
  return {
    organizationId: event ? event.organizationId : organizationId,
    imageAssetId: event?.imageAssetId || null,
    imageUrl: event?.imageUrl || null,
    title: event?.title || "",
    slug: event?.slug || "",
    summary: event?.summary || "",
    description: event?.description || "",
    category: event?.category || "nightlife",
    status: event?.status || "draft",
    isDiscoverable: event?.isDiscoverable ?? true,
    capacity: event?.capacity ?? "",
    guestlistCapacity: event?.guestlistCapacity ?? 50,
    startsAt: dateInput(event?.startsAt || start, timezone),
    endsAt: dateInput(
      event?.endsAt || new Date(+start + 4 * 3600000),
      timezone,
    ),
    location: {
      name: "",
      addressLine1: "",
      city: "",
      region: "FL",
      postalCode: "",
      countryCode: "US",
      privacy: "public",
      ...event?.location,
      timezone,
    },
    offerings:
      event?.offerings?.map((t) => ({
        ...t,
        price: t.priceCents / 100,
        salesStartAt: t.salesStartAt ? dateInput(t.salesStartAt, timezone) : "",
        salesEndAt: t.salesEndAt ? dateInput(t.salesEndAt, timezone) : "",
      })) || defaultTiers(),
  };
}
export function eventPayload(draft, version) {
  return {
    ...draft,
    version,
    startsAt: zonedISO(draft.startsAt, draft.location.timezone),
    endsAt: zonedISO(draft.endsAt, draft.location.timezone),
    capacity: draft.capacity === "" ? null : Number(draft.capacity),
    guestlistCapacity: Number(draft.guestlistCapacity),
    offerings: draft.offerings.map((t) => ({
      ...t,
      priceCents: Math.round(Number(t.price) * 100),
      quantityTotal:
        t.inventoryMode === "unlimited" ? null : Number(t.quantityTotal),
      entriesPerUnit: Number(t.entriesPerUnit),
      minPerOrder: Number(t.minPerOrder),
      maxPerOrder: Number(t.maxPerOrder),
      salesStartAt: t.salesStartAt
        ? zonedISO(t.salesStartAt, draft.location.timezone)
        : null,
      salesEndAt: t.salesEndAt
        ? zonedISO(t.salesEndAt, draft.location.timezone)
        : null,
    })),
  };
}
export function filterEvents(events, search, status) {
  const query = search.trim().toLowerCase();
  return events.filter(
    (e) =>
      (status === "all" || e.status === status) &&
      [e.title, e.location?.city, e.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
}
export function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
