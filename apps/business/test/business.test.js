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
  editorDraft,
  eventPayload,
  filterEvents,
  slugify,
} from "../src/lib/business.js";
const savedOffering = { id: 'tier1', name: 'Custom admission', kind: 'ticket', priceCents: 1000,
  quantityTotal: 200, entriesPerUnit: 1, inventoryMode: 'finite', minPerOrder: 1, maxPerOrder: 10 };
test("new events start without offerings while saved event inventory is preserved", () => {
  const draft = editorDraft(null);
  assert.deepEqual(draft.offerings, []);
  assert.deepEqual(eventPayload(draft).offerings, []);
  draft.offerings.push({ ...savedOffering });
  assert.deepEqual(editorDraft(null).offerings, [], 'new drafts do not share inventory');
  for (const priceCents of [0, 1235]) {
    const event = { offerings: [{ ...savedOffering, priceCents }] };
    const edited = editorDraft(event);
    assert.equal(edited.offerings.length, 1);
    assert.equal(edited.offerings[0].name, savedOffering.name);
    assert.equal(edited.offerings[0].price, priceCents / 100);
    assert.equal(eventPayload(edited).offerings[0].priceCents, priceCents);
    assert.equal(event.offerings[0].price, undefined, 'editing does not mutate stored offerings');
  }
  assert.deepEqual(editorDraft({ offerings: [] }).offerings, []);
  assert.deepEqual(editorDraft({}).offerings, []);
});
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
  const draft = editorDraft({ offerings: [{ ...savedOffering }] });
  draft.offerings[0].price = "12.35";
  const p = eventPayload(draft, 4);
  assert.equal(p.offerings[0].priceCents, 1235);
  assert.equal(p.offerings[0].id, "tier1");
  assert.equal(p.version, 4);
  assert.equal(p.capacity, null);
});
test("unlimited inventory explicitly sends null", () => {
  const d = editorDraft({ offerings: [{ ...savedOffering }] });
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
