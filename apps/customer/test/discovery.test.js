import test from "node:test";
import assert from "node:assert/strict";
import {
  filterEvents,
  eventDateKey,
  availableQuantity,
  checkoutTotal,
  filterUpcomingWeek,
  upcomingWeekRange,
} from "../src/lib/discovery.js";
import pricing from "../../api/src/domain/pricing.js";

const now = new Date("2026-09-21T12:00:00Z");
const event = {
  id: "celine",
  title: "Celine Friday Nights",
  description: "Live music and DJ sets",
  startsAt: "2026-09-26T02:00:00Z",
  endsAt: "2026-09-26T06:00:00Z",
  location: { city: "Orlando", timezone: "America/New_York" },
  guestlistCapacity: 50,
  offerings: [{ kind: "package", priceCents: 40000 }],
};
test("empty-date alternatives include only the next seven venue-local dates", () => {
  const sample = (id, startsAt) => ({
    ...event,
    id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 3600000).toISOString(),
  });
  const samples = [
    sample("selected-day", "2026-09-22T02:00:00Z"),
    sample("first-day", "2026-09-23T02:00:00Z"),
    sample("last-day", "2026-09-29T03:59:59Z"),
    sample("too-late", "2026-09-29T04:00:00Z"),
  ];
  assert.deepEqual(upcomingWeekRange("2026-09-21"), {
    start: "2026-09-22",
    end: "2026-09-28",
  });
  assert.deepEqual(
    filterUpcomingWeek(samples, { date: "2026-09-21" }, now).map(
      (item) => item.id,
    ),
    ["first-day", "last-day"],
  );
  assert.deepEqual(filterUpcomingWeek(samples, { date: "" }, now), []);
});
test("weekly alternatives retain city, query, category, price and saved filters", () => {
  const filters = {
    date: "2026-09-21",
    city: "Orlando",
    query: "celine",
    category: "vip",
    priceCap: "40000",
    savedIds: ["celine"],
  };
  assert.deepEqual(filterUpcomingWeek([event], filters, now), [event]);
  for (const change of [
    { city: "Miami" },
    { query: "unmatched" },
    { priceCap: "2500" },
    { savedIds: [] },
  ]) {
    assert.deepEqual(
      filterUpcomingWeek([event], { ...filters, ...change }, now),
      [],
    );
  }
});
test("week ranges cross months, years, leap days and DST as calendar dates", () => {
  assert.deepEqual(upcomingWeekRange("2026-12-28"), {
    start: "2026-12-29",
    end: "2027-01-04",
  });
  assert.deepEqual(upcomingWeekRange("2028-02-27"), {
    start: "2028-02-28",
    end: "2028-03-05",
  });
  assert.deepEqual(upcomingWeekRange("2026-10-30"), {
    start: "2026-10-31",
    end: "2026-11-06",
  });
});
test("blanket search covers summaries, locations and offering details", () => {
  const searchable = {
    ...event,
    summary: "A rooftop celebration",
    offerings: [
      { name: "Premium table", description: "Two bottles for the crew" },
    ],
  };
  for (const query of ["rooftop", "Orlando", "premium", "bottles"])
    assert.equal(filterEvents([searchable], { query }, now).length, 1);
});
test("search combines city, keywords, venue-local date, and experience type", () => {
  assert.equal(eventDateKey(event), "2026-09-25");
  assert.deepEqual(
    filterEvents(
      [event],
      {
        city: "Orlando, FL",
        query: "CELINE friday",
        date: "2026-09-25",
        category: "vip",
      },
      now,
    ),
    [event],
  );
  for (const filters of [
    { city: "Miami" },
    { query: "unmatched" },
    { date: "2026-09-26" },
    { savedIds: [] },
  ])
    assert.equal(filterEvents([event], filters, now).length, 0);
  assert.equal(
    filterEvents([event], { savedIds: ["celine"], category: "guestlist" }, now)
      .length,
    1,
  );
});
test("past events stay out of search", () => {
  assert.equal(filterEvents([event], {}, new Date("2026-10-01")).length, 0);
});
test("availability respects stock, sale windows, and minimum/maximum order quantities", () => {
  const offering = {
    inventoryMode: "finite",
    quantityTotal: 5,
    quantitySold: 3,
    maxPerOrder: 8,
    minPerOrder: 1,
  };
  assert.equal(availableQuantity(offering, now), 2);
  assert.equal(availableQuantity({ ...offering, minPerOrder: 3 }, now), 0);
  assert.equal(availableQuantity({ ...offering, quantitySold: 5 }, now), 0);
  assert.equal(
    availableQuantity({ ...offering, salesStartAt: "2026-10-01" }, now),
    0,
  );
  assert.equal(
    availableQuantity({ ...offering, salesEndAt: "2026-09-01" }, now),
    0,
  );
  assert.equal(
    availableQuantity(
      { ...offering, inventoryMode: "unlimited", maxPerOrder: 4 },
      now,
    ),
    4,
  );
});
test("demo checkout matches server pricing and charges the fixed fee once per order", () => {
  for (const [price, quantity] of [
    [0, 1],
    [1000, 2],
    [30000, 1],
    [40000, 1],
    [100000, 2],
  ]) {
    const demo = checkoutTotal(price, quantity);
    const actual = pricing.calculatePricing({
      subtotalCents: price * quantity,
    });
    assert.equal(demo.total, actual.totalCents);
    assert.equal(demo.fee, actual.platformFeeCents);
  }
  assert.deepEqual(checkoutTotal(40000, 1), {
    subtotal: 40000,
    fee: 3289,
    total: 43289,
  });
});
