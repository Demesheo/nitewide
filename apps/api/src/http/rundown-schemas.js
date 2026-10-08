const { z } = require('zod');
const uuid = z.uuid(), count = z.number().int().nonnegative(), date = z.iso.datetime({ offset: true });
const publish = z.discriminatedUnion('kind', [z.object({ kind: z.literal('personal') }).strict(),
  z.object({ kind: z.literal('business'), organizationId: uuid }).strict()]);
const pageQuery = z.object({ pageSize: z.coerce.number().int().min(1).max(6).default(6), cursor: z.string().min(1).max(512).optional() }).strict();
const previewQuery = z.discriminatedUnion('kind', [
  pageQuery.extend({ kind: z.literal('personal') }).strict(),
  pageQuery.extend({ kind: z.literal('business'), organizationId: uuid }).strict(),
]);
const item = z.object({ kind: z.enum(['personal', 'business']), name: z.string(), organizationId: uuid.nullable(),
  published: z.boolean(), canPublish: z.boolean(), url: z.url().nullable() }).strict();
const location = z.object({ id: uuid, name: z.string().nullable(), city: z.string(), region: z.string().nullable(), countryCode: z.string(),
  timezone: z.string(), privacy: z.enum(['public','attendees_only','private']), addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(), postalCode: z.string().nullable().optional(),
  latitude: z.union([z.string(), z.number()]).nullable().optional(), longitude: z.union([z.string(), z.number()]).nullable().optional() }).strict();
const offering = z.object({ id: uuid, eventId: uuid, name: z.string(), description: z.string().nullable(), kind: z.enum(['ticket','package','reservation']),
  priceCents: count, currency: z.string(), feeMode: z.enum(['inherit','buyer','absorbed']), effectiveFeeMode: z.enum(['buyer','absorbed']),
  inventoryMode: z.enum(['finite','unlimited']), quantityTotal: count.nullable(), quantitySold: count, entriesPerUnit: count,
  minPerOrder: count, maxPerOrder: count, salesStartAt: date.nullable(), salesEndAt: date.nullable(), sortOrder: z.number().int(),
  saleState: z.enum(['inactive','sold_out','closed','scheduled','waiting_for_tier','on_sale']) }).strict();
const event = z.object({ id: uuid, imageUrl: z.string().nullable(), title: z.string(), slug: z.string(), summary: z.string().nullable(),
  description: z.string().nullable(), category: z.string(), status: z.literal('published'), startsAt: date, endsAt: date,
  feeMode: z.enum(['buyer','absorbed']), guestlistCapacity: count, isPremiumHost: z.boolean(),
  organization: z.object({ id: uuid, name: z.string(), slug: z.string(), planTier: z.string() }).strict().nullable(),
  location: location.nullable(), offerings: z.array(offering), referralCode: z.string().nullable() }).strict();
const page = z.object({ profile: z.object({ kind: z.enum(['personal','business']), name: z.string() }).strict(),
  items: z.array(event).max(6), hasMore: z.boolean(), nextCursor: z.string().nullable() }).strict();
module.exports = { publish, pageQuery, previewQuery, item, event, page };
