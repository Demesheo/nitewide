const { z } = require("zod");
const { MAX_REPORT_RANGE_DAYS, reportDate, refineReportDates } = require('./report-date-schemas');
const uuid = z.string().uuid();
const text = (max) => z.string().trim().max(max);
const reportTimezone = z.string().max(64).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use a valid IANA timezone').default('UTC');
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
    feeMode: z.enum(['inherit', 'buyer', 'absorbed']).default('inherit'),
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
    locationId: uuid.nullish(),
    imageAssetId: uuid.nullish(),
    reusedImageFromEventId: uuid.optional(),
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
    feeMode: z.enum(['buyer', 'absorbed']).default('buyer'),
    location: location.optional(),
    offerings: z.array(tier).max(50),
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
  .refine((e) => e.locationId || e.location || (e.organizationId && e.locationId === undefined), 'Select a saved venue or enter the event location')
  .superRefine((e, ctx) => {
    const { editorPricingIssues } = require('../domain/editor-pricing-policy');
    for (const issue of editorPricingIssues({ eventFeeMode: e.feeMode, offerings: e.offerings })) {
      ctx.addIssue({ code: 'custom', path: ['offerings', issue.index, issue.field], message: issue.message });
    }
    e.offerings.forEach((t, i) => {
      if (t.releaseAfterIndex == null) return;
      const previous = e.offerings[t.releaseAfterIndex];
      if (!['ticket', 'package'].includes(t.kind) || !previous || t.releaseAfterIndex >= i || previous.kind !== t.kind || previous.inventoryMode !== 'finite' || previous.quantityTotal < 1 || previous.priceCents >= t.priceCents) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['offerings', i, 'releaseAfterIndex'], message: 'Choose an earlier, limited tier of the same type with a lower price.' });
      }
    });
  });
const reportFilters = z.object({
  ownedOnly: z.enum(['true', 'false']).default('false'),
  timezone: reportTimezone,
  venueIds: z.preprocess(value => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100).default([])),
  organizationId: z.union([uuid, z.literal("independent")]).optional(),
  organizationIds: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.union([uuid, z.literal('independent')])).max(50).default([])),
  days: z.coerce.number().int().min(1).max(MAX_REPORT_RANGE_DAYS).default(30),
});
const reportQuery = reportFilters.refine((value) => !value.organizationId || !value.organizationIds.length, 'Choose either organizationId or organizationIds');
const page = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const eventListQuery = reportFilters.pick({ organizationId: true, organizationIds: true, venueIds: true }).extend({
  ...page,
  search: z.string().trim().max(120).default(''),
  status: z.enum(['all', 'upcoming', 'past', 'draft', 'published', 'cancelled', 'completed']).default('all'),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  sort: z.enum(['starts_desc', 'starts_asc', 'title_asc', 'title_desc', 'phase_asc', 'phase_desc', 'sales_asc', 'sales_desc', 'orders_asc', 'orders_desc', 'access_asc', 'access_desc']).default('starts_desc'),
}).refine((value) => !value.organizationId || !value.organizationIds.length, 'Choose either organizationId or organizationIds')
  .refine((value) => !value.from || !value.to || value.to > value.from, 'End must be after start');
const eventPageQuery = z.object({ ...page, search: z.string().trim().max(120).default(''),
  sortKey: z.enum(['name', 'quantity', 'referredBy', 'orders', 'salesCents', 'admissions', 'guestlistPlaces', 'checkedIn', 'role', 'commissionBps', 'customers', 'approvedGuestlistPlaces', 'commissionCents', 'guestName', 'partyValue', 'sourceValue', 'requestedValue', 'status']).optional(),
  descending: z.enum(['true', 'false']).default('true'),
  roles: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.enum(['Owner', 'Manager', 'Employee', 'Promoter', 'Creator'])).max(5).default([])),
  statuses: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.enum(['pending', 'confirmed', 'rejected', 'checked_in', 'no_show'])).max(5).default([])),
  status: z.enum(['all', 'pending', 'confirmed', 'rejected', 'checked_in', 'no_show']).default('all') });
const reportDetailQuery = reportFilters.extend({
  eventId: uuid.optional(),
  personId: uuid.optional(),
  offeringKind: z.enum(['ticket', 'package', 'reservation']).optional(),
  offeringName: text(160).optional(),
  exportTable: z.enum(['regions', 'venues', 'events', 'offerings', 'team', 'customers']).optional(),
  startDate: reportDate.optional(), endDate: reportDate.optional(),
  regions: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(text(160)).max(50).default([])),
  search: z.string().trim().max(120).default(''),
  personSearch: z.string().trim().max(120).default(''),
  activityOnly: z.enum(['true', 'false']).default('false'),
  roles: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value],
    z.array(z.enum(['Owner', 'Manager', 'Employee', 'Promoter', 'Creator'])).max(5).default([])),
  ...page,
  sort: z.enum(['sales_desc', 'sales_asc', 'name_asc', 'name_desc', 'role_asc', 'role_desc', 'orders_desc', 'orders_asc', 'starts_asc', 'starts_desc', 'customers_asc', 'customers_desc', 'units_asc', 'units_desc', 'admissions_asc', 'admissions_desc', 'checkins_asc', 'checkins_desc', 'average_asc', 'average_desc', 'events_asc', 'events_desc', 'guestlist_asc', 'guestlist_desc', 'commission_asc', 'commission_desc', 'contribution_asc', 'contribution_desc']).default('sales_desc'),
}).refine((value) => !value.organizationId || !value.organizationIds.length, 'Choose either organizationId or organizationIds')
  .superRefine(refineReportDates)
  .refine((value) => Boolean(value.offeringKind) === Boolean(value.offeringName), 'Use both offering kind and name');
module.exports = { eventEditor, reportQuery, eventListQuery, eventPageQuery, reportDetailQuery, reportTimezone, page };
