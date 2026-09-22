const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateSales,
  createBusinessService,
} = require("../src/services/business-service");
const { eventEditor, reportQuery } = require("../src/http/business-schemas");
const { forbidden } = require("../src/domain/errors");
const org = "20000000-0000-4000-8000-000000000001";
const tierId = "50000000-0000-4000-8000-000000000001";
function input() {
  return {
    version: 2,
    organizationId: org,
    title: "Friday",
    slug: "friday",
    summary: "",
    description: "",
    category: "nightlife",
    startsAt: "2026-10-01T22:00:00Z",
    endsAt: "2026-10-02T02:00:00Z",
    status: "draft",
    isDiscoverable: true,
    guestlistCapacity: 50,
    capacity: null,
    location: {
      name: "Venue",
      addressLine1: "Street",
      city: "Orlando",
      region: "FL",
      postalCode: "32801",
      timezone: "America/New_York",
      privacy: "public",
    },
    offerings: [
      {
        id: tierId,
        name: "GA",
        kind: "ticket",
        priceCents: 1000,
        inventoryMode: "finite",
        quantityTotal: 100,
        entriesPerUnit: 1,
        minPerOrder: 1,
        maxPerOrder: 10,
        isActive: true,
      },
    ],
  };
}
test("editor validates dates, timezone, duplicate IDs, and min/max constraints", () => {
  assert.equal(eventEditor.safeParse(input()).success, true);
  const d = input();
  d.endsAt = d.startsAt;
  assert.equal(eventEditor.safeParse(d).success, false);
  d.endsAt = "2026-10-02T02:00:00Z";
  d.location.timezone = "Not/AZone";
  assert.equal(eventEditor.safeParse(d).success, false);
  const duplicate = input();
  duplicate.offerings.push(duplicate.offerings[0]);
  assert.equal(eventEditor.safeParse(duplicate).success, false);
  const q = input();
  q.offerings[0].minPerOrder = 11;
  assert.equal(eventEditor.safeParse(q).success, false);
});
test("report limits are validated, not trusted from query strings", () => {
  assert.equal(reportQuery.parse({ days: "7" }).days, 7);
  assert.equal(reportQuery.parse({ organizationIds: ['independent', '00000000-0000-4000-8000-000000000001'] }).organizationIds.length, 2);
  assert.equal(reportQuery.safeParse({ days: 999 }).success, false);
  assert.equal(
    reportQuery.safeParse({ organizationId: "bad-id" }).success,
    false,
  );
});
test("report uses historical order lines, avoids double-counted referrals, and distinguishes managers", () => {
  const events = [{ id: "e", title: "Friday" }];
  const affiliates = [
    {
      id: "oa",
      userId: "staff",
      organizationId: "org",
      user: { displayName: "Sam" },
    },
    {
      id: "ea",
      userId: "promoter",
      organizationId: "org",
      user: { displayName: "Leo" },
    },
  ];
  const orders = [
    {
      eventId: "e",
      subtotalCents: 2000,
      affiliateCommissionCents: 200,
      orgAffiliateId: "oa",
      eventAffiliateId: "ea",
      paidAt: "2026-09-21",
      items: [
        {
          nameSnapshot: "GA",
          kindSnapshot: "ticket",
          lineTotalCents: 2000,
          quantity: 2,
          entriesPerUnitSnapshot: 1,
        },
      ],
    },
    {
      eventId: "e",
      subtotalCents: 30000,
      affiliateCommissionCents: 0,
      orgAffiliateId: "oa",
      paidAt: "2026-09-21",
      items: [
        {
          nameSnapshot: "Package",
          kindSnapshot: "package",
          lineTotalCents: 30000,
          quantity: 1,
          entriesPerUnitSnapshot: 4,
        },
      ],
    },
  ];
  const r = aggregateSales(orders, events, affiliates, [
    { userId: "staff", organizationId: "org" },
  ]);
  assert.equal(r.summary.salesCents, 32000);
  assert.equal(r.summary.admissions, 6);
  assert.equal(r.events[0].orders, 2);
  assert.equal(r.packages[0].salesCents, 30000);
  assert.equal(r.people.find((p) => p.id === "staff").salesCents, 30000);
  assert.equal(r.people.find((p) => p.id === "staff").role, "Manager");
  assert.equal(r.people.find((p) => p.id === "promoter").salesCents, 2000);
  assert.equal(r.daily[0].salesCents, 32000);
});
test('owner, manager, and employee rows remain visible without inventing attributed sales', () => {
  const report = aggregateSales([], [], [], [
    { userId: 'owner', role: 'owner', organizationId: 'org', user: { displayName: 'Maya' } },
    { userId: 'manager', role: 'admin', organizationId: 'org', user: { displayName: 'Sam' } },
  ], [{ userId: 'employee', organizationId: 'org', user: { displayName: 'Tessa' } }]);
  assert.deepEqual(report.people.map(({ name, role, salesCents }) => ({ name, role, salesCents })), [
    { name: 'Maya', role: 'Owner', salesCents: 0 },
    { name: 'Sam', role: 'Manager', salesCents: 0 },
    { name: 'Tessa', role: 'Employee', salesCents: 0 },
  ]);
});
test("empty report and unattributed sales are represented honestly", () => {
  assert.equal(aggregateSales([], [], [], []).summary.orders, 0);
  assert.equal(
    aggregateSales(
      [
        {
          subtotalCents: 1000,
          affiliateCommissionCents: 0,
          paidAt: "2026-09-21",
        },
      ],
      [],
      [],
      [],
    ).summary.directSalesCents,
    1000,
  );
});
function harness({ denied = false, sold = 4 } = {}) {
  const calls = [];
  const event = {
    id: "e",
    organizationId: org,
    version: 2,
    toJSON() {
      return { id: this.id, version: this.version };
    },
    async update(values) {
      Object.assign(this, values);
      calls.push("update");
      return this;
    },
  };
  const offering = {
    id: tierId,
    quantitySold: sold,
    kind: "ticket",
    entriesPerUnit: 1,
    currency: "USD",
    toJSON() {
      return { id: this.id, priceCents: this.priceCents };
    },
    async update(values) {
      Object.assign(this, values);
      calls.push("tier");
    },
  };
  const models = {
    Organization: { findByPk: async () => ({ locationId: 'venue-location' }) },
    Event: {
      sequelize: {
        transaction: async (_opts, fn) => fn({ LOCK: { UPDATE: "UPDATE" } }),
      },
      findByPk: async () => event,
    },
    Offering: { findAll: async () => [offering] },
    Location: {
      findByPk: async () => ({ id: 'venue-location', city: 'Orlando' }),
      create: async () => {
        calls.push("location");
        return { id: "location" };
      },
    },
    GuestlistEntry: { sum: async () => 5 },
    AuditLog: { create: async () => calls.push("audit") },
  };
  const permissions = {
    assertManageEvent: async () => {
      if (denied) throw forbidden();
      return event;
    },
  };
  return { service: createBusinessService({ models, permissions }), calls };
}
test("unauthorized users cannot edit events even with a valid payload", async () => {
  const h = harness({ denied: true });
  await assert.rejects(() => h.service.saveEvent("outsider", "e", input()), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(h.calls, []);
});
test("stale event version fails before writing any data", async () => {
  const h = harness();
  await assert.rejects(
    () => h.service.saveEvent("owner", "e", { ...input(), version: 1 }),
    { code: "CONFLICT" },
  );
  assert.deepEqual(h.calls, []);
});
test("organization reassignment is forbidden", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.service.saveEvent("owner", "e", { ...input(), organizationId: null }),
    { code: "FORBIDDEN" },
  );
});
test("inventory cannot be reduced below sold quantity", async () => {
  const h = harness();
  const d = input();
  d.offerings[0].quantityTotal = 3;
  await assert.rejects(
    () => h.service.saveEvent("owner", "e", d),
    /already sold/,
  );
  assert.deepEqual(h.calls, []);
});
test("sold admissions cannot be changed retroactively", async () => {
  const h = harness();
  const d = input();
  d.offerings[0].entriesPerUnit = 2;
  await assert.rejects(
    () => h.service.saveEvent("owner", "e", d),
    /admission count/,
  );
});
test("tiers belonging to another event are rejected", async () => {
  const h = harness();
  const d = input();
  d.offerings[0].id = "other";
  await assert.rejects(() => h.service.saveEvent("owner", "e", d), {
    code: "FORBIDDEN",
  });
});
test("existing tiers cannot be silently deleted", async () => {
  const h = harness();
  const d = input();
  delete d.offerings[0].id;
  await assert.rejects(
    () => h.service.saveEvent("owner", "e", d),
    /deactivate/,
  );
});
test("direct guestlist cannot shrink below approved guests", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.service.saveEvent("owner", "e", { ...input(), guestlistCapacity: 4 }),
    /approved guests/,
  );
});
test("valid venue save reuses the organization location and updates event, tier and audit atomically", async () => {
  const h = harness();
  await h.service.saveEvent("owner", "e", input());
  assert.deepEqual(h.calls, ["update", "tier", "audit"]);
});
