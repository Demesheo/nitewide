const { z } = require("zod");
const uuid = z.string().uuid();
const text = (max) => z.string().trim().max(max);
const location = z.object({
  name: text(180),
  addressLine1: text(180),
  city: text(100).min(1),
  region: text(100),
  postalCode: text(24),
  countryCode: z.string().length(2).default("US"),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA time zone"),
  privacy: z.enum(["public", "attendees_only", "private"]),
});
const tier = z
  .object({
    id: uuid.optional(),
    name: text(160).min(1),
    description: text(5000).default(""),
    kind: z.enum(["ticket", "package", "reservation"]),
    priceCents: z.number().int().min(0).max(100000000),
    inventoryMode: z.enum(["finite", "unlimited"]),
    quantityTotal: z.number().int().min(0).max(1000000).nullable(),
    entriesPerUnit: z.number().int().min(1).max(100),
    minPerOrder: z.number().int().min(1).max(100),
    maxPerOrder: z.number().int().min(1).max(100),
    isActive: z.boolean(),
    visibility: z.enum(["public", "hidden", "password"]).default("public"),
    salesStartAt: z.coerce.date().nullish(),
    salesEndAt: z.coerce.date().nullish(),
    releaseAfterIndex: z.number().int().min(0).max(49).nullish(),
  })
  .refine(
    (t) => t.inventoryMode === "unlimited" || t.quantityTotal !== null,
    "Finite tiers need an inventory limit",
  )
  .refine(
    (t) => !t.salesStartAt || !t.salesEndAt || t.salesEndAt > t.salesStartAt,
    "Sales end must be after sales start",
  )
  .refine(
    (t) => t.maxPerOrder >= t.minPerOrder,
    "Maximum quantity must be at least the minimum",
  );
const eventEditor = z
  .object({
    version: z.number().int().nonnegative().optional(),
    organizationId: uuid.nullable(),
    imageAssetId: uuid.nullish(),
    title: text(180).min(2),
    slug: text(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    summary: text(500),
    description: text(20000),
    category: text(80).min(1).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    guestlistCapacity: z.number().int().min(0).max(1000000),
    capacity: z.number().int().min(0).max(1000000).nullable(),
    status: z.enum(["draft", "published", "cancelled", "completed"]),
    isDiscoverable: z.boolean(),
    location: location.optional(),
    offerings: z.array(tier).min(1).max(50),
  })
  .refine((e) => e.endsAt > e.startsAt, {
    path: ["endsAt"],
    message: "End must be after start",
  })
  .refine(
    (e) =>
      new Set(e.offerings.filter((t) => t.id).map((t) => t.id)).size ===
      e.offerings.filter((t) => t.id).length,
    "Duplicate tier IDs",
  )
  .refine((e) => e.organizationId || e.location, 'Independent events require a location')
  .superRefine((e, ctx) => {
    e.offerings.forEach((t, i) => {
      if (t.releaseAfterIndex == null) return;
      const previous = e.offerings[t.releaseAfterIndex];
      if (t.kind !== 'ticket' || !previous || t.releaseAfterIndex >= i || previous.kind !== 'ticket' || previous.inventoryMode !== 'finite' || !previous.isActive || previous.quantityTotal < 1 || previous.priceCents >= t.priceCents) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['offerings', i, 'releaseAfterIndex'], message: 'Choose an earlier, active, limited admission tier with a lower price.' });
      }
    });
  });
const reportQuery = z.object({
  organizationId: z.union([uuid, z.literal("independent")]).optional(),
  organizationIds: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.union([uuid, z.literal('independent')])).max(50).default([])),
  days: z.coerce.number().int().min(1).max(366).default(30),
}).refine((value) => !value.organizationId || !value.organizationIds.length, 'Choose either organizationId or organizationIds');
module.exports = { eventEditor, reportQuery };
