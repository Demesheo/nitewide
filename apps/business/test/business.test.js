import test from "node:test";
test('editing an independent event never adopts the default organization', () => {
  const event = { organizationId: null, startsAt: '2026-09-25T22:00:00Z', endsAt: '2026-09-26T02:00:00Z' };
  assert.equal(editorDraft(event, 'some-organization').organizationId, null);
});
import assert from "node:assert/strict";
import {
  csv,
  dateInput,
  eventDateLabel,
  zonedISO,
  defaultTiers,
  editorDraft,
  eventPayload,
  filterEvents,
  slugify,
} from "../src/lib/business.js";
test("default offering prices follow the product policy", () =>
  assert.deepEqual(
    defaultTiers().map((t) => t.price),
    [10, 300, 400, 1000],
  ));
test("venue-local time is converted independently of browser timezone", () => {
  assert.equal(
    zonedISO("2026-09-25T22:00", "America/New_York"),
    "2026-09-26T02:00:00.000Z",
  );
  assert.equal(
    dateInput("2026-09-26T02:00:00Z", "America/New_York"),
    "2026-09-25T22:00",
  );
});
test("guestlist event dates display as MM/DD/YYYY in the event's timezone", () => {
  assert.equal(eventDateLabel({
    startsAt: "2026-09-26T02:00:00Z",
    location: { timezone: "America/New_York" },
  }), "09/25/2026");
  assert.equal(eventDateLabel({ startsAt: "2026-09-26T02:00:00Z" }), "09/26/2026");
});
test("winter time has the correct standard-time offset", () =>
  assert.equal(
    zonedISO("2026-12-25T22:00", "America/New_York"),
    "2026-12-26T03:00:00.000Z",
  ));
test("nonexistent daylight saving times are rejected", () =>
  assert.throws(
    () => zonedISO("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  ));
test("edit payload preserves IDs, converts dollars to cents, and includes version", () => {
  const draft = editorDraft(null);
  draft.offerings[0].id = "tier1";
  draft.offerings[0].price = "12.35";
  const p = eventPayload(draft, 4);
  assert.equal(p.offerings[0].priceCents, 1235);
  assert.equal(p.offerings[0].id, "tier1");
  assert.equal(p.version, 4);
  assert.equal(p.capacity, null);
});
test("unlimited inventory explicitly sends null", () => {
  const d = editorDraft(null);
  d.offerings[0].inventoryMode = "unlimited";
  assert.equal(eventPayload(d).offerings[0].quantityTotal, null);
});
test("search and status filters combine without changing original events", () => {
  const events = [
    {
      title: "Celine Friday",
      status: "published",
      location: { city: "Orlando" },
    },
    { title: "Celine Draft", status: "draft" },
  ];
  assert.equal(filterEvents(events, " ORLANDO ", "published").length, 1);
  assert.equal(filterEvents(events, "celine", "draft").length, 1);
  assert.equal(events.length, 2);
});
test("CSV escapes quotes and neutralizes spreadsheet formula injection", () =>
  assert.equal(
    csv([["=CMD()", 'A "B"', "line\nbreak"]]),
    '"\'=CMD()","A ""B""","line\nbreak"',
  ));
test("slug generation produces URL-safe event names", () =>
  assert.equal(slugify("  Friday / After Dark! "), "friday-after-dark"));
