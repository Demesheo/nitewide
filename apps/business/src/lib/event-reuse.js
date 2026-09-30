import { dateInput, editorDraft } from './business';

const storageKey = (userId) => `nitewide:business:templates:${userId}`;

function laterWallClock(start, end, timezone) {
  const currentLocal = dateInput(new Date(), timezone);
  const sourceStart = dateInput(start, timezone);
  const sourceEnd = dateInput(end, timezone);
  const localDay = new Date(`${currentLocal.slice(0, 10)}T00:00:00.000Z`);
  localDay.setUTCDate(localDay.getUTCDate() + 7);
  const nextStart = `${localDay.toISOString().slice(0, 10)}T${sourceStart.slice(11)}`;
  const duration = Math.max(60, Math.round((Date.parse(`${sourceEnd}:00.000Z`) - Date.parse(`${sourceStart}:00.000Z`)) / 60000));
  const nextEnd = new Date(Date.parse(`${nextStart}:00.000Z`) + duration * 60000).toISOString().slice(0, 16);
  return { startsAt: nextStart, endsAt: nextEnd };
}

function cleanOffering(offering, keyBySourceId) {
  const sourceKey = offering.id || offering.clientKey;
  return { clientKey: keyBySourceId.get(sourceKey), name: offering.name || '',
    description: offering.description || '', kind: offering.kind || 'ticket',
    inventoryMode: offering.inventoryMode || 'finite', quantityTotal: offering.quantityTotal ?? 0,
    entriesPerUnit: offering.entriesPerUnit ?? 1, minPerOrder: offering.minPerOrder ?? 1,
    maxPerOrder: offering.maxPerOrder ?? 10,
    releaseAfterKey: keyBySourceId.get(offering.releaseAfterOfferingId || offering.releaseAfterKey) || '',
    salesStartAt: '', salesEndAt: '',
    visibility: offering.visibility === 'password' ? 'hidden' : offering.visibility,
    isActive: offering.visibility === 'password' ? false : offering.isActive,
    price: offering.priceCents != null ? offering.priceCents / 100 : offering.price };
}

function cleanTemplateSource(source) {
  if (!source || typeof source !== 'object' || typeof source.title !== 'string' || !Array.isArray(source.offerings)) return null;
  const location = source.location && typeof source.location === 'object' ? {
    name: source.location.name || '', addressLine1: source.location.addressLine1 || '',
    city: source.location.city || '', region: source.location.region || '',
    postalCode: source.location.postalCode || '', countryCode: source.location.countryCode || 'US',
    timezone: source.location.timezone || 'America/New_York', privacy: source.location.privacy || 'public',
  } : null;
  return { title: source.title.slice(0, 180), summary: String(source.summary || '').slice(0, 500),
    description: String(source.description || '').slice(0, 20000), organizationId: source.organizationId || null,
    locationId: source.locationId || null, location,
    startsAt: source.startsAt, endsAt: source.endsAt,
    guestlistCapacity: source.guestlistCapacity ?? 50, capacity: source.capacity ?? null,
    offerings: source.offerings.slice(0, 50).filter((tier) => tier && typeof tier === 'object').map((tier) => ({
      id: tier.id, clientKey: tier.clientKey, name: tier.name, description: tier.description,
      kind: tier.kind, priceCents: tier.priceCents, price: tier.price,
      quantityTotal: tier.quantityTotal, inventoryMode: tier.inventoryMode,
      entriesPerUnit: tier.entriesPerUnit, minPerOrder: tier.minPerOrder, maxPerOrder: tier.maxPerOrder,
      isActive: tier.isActive, visibility: tier.visibility,
      releaseAfterOfferingId: tier.releaseAfterOfferingId, releaseAfterKey: tier.releaseAfterKey,
    })) };
}

export function reusableDraft(source, { copyOfferings = true, copyImage = false } = {}, organizations = [], venues = []) {
  const base = editorDraft(source, null, organizations, venues);
  const keys = new Map((source.offerings || []).map((offering) => [offering.id || offering.clientKey, crypto.randomUUID()]));
  const times = laterWallClock(source.startsAt, source.endsAt, source.location?.timezone || 'America/New_York');
  return { ...base, ...times, title: `${source.title} (copy)`, status: 'draft', isDiscoverable: false,
    imageAssetId: copyImage ? source.imageAssetId : null, imageUrl: copyImage ? source.imageUrl : null,
    offerings: copyOfferings ? source.offerings.map((offering) => cleanOffering(offering, keys)) : [] };
}

export function readEventTemplates(userId) {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]');
    return Array.isArray(rows) ? rows.slice(0, 20).flatMap((row) => {
      if (row?.schema !== 1 || typeof row.id !== 'string' || typeof row.name !== 'string') return [];
      const source = cleanTemplateSource(row.source);
      return source ? [{ schema: 1, id: row.id, name: row.name.slice(0, 180), createdAt: row.createdAt, source }] : [];
    }) : [];
  } catch { return []; }
}

export function saveEventTemplate(userId, event) {
  const source = { title: event.title, summary: event.summary, description: event.description,
    organizationId: event.organizationId, locationId: event.locationId,
    location: event.location ? { name: event.location.name || '', addressLine1: event.location.addressLine1 || '',
      city: event.location.city || '', region: event.location.region || '', postalCode: event.location.postalCode || '',
      countryCode: event.location.countryCode || 'US', timezone: event.location.timezone || 'America/New_York',
      privacy: event.location.privacy || 'public' } : null,
    startsAt: event.startsAt, endsAt: event.endsAt,
    guestlistCapacity: event.guestlistCapacity, capacity: event.capacity,
    offerings: (event.offerings || []).map((tier) => ({ id: tier.id, name: tier.name, description: tier.description,
      kind: tier.kind, priceCents: tier.priceCents, quantityTotal: tier.quantityTotal, inventoryMode: tier.inventoryMode,
      entriesPerUnit: tier.entriesPerUnit, minPerOrder: tier.minPerOrder, maxPerOrder: tier.maxPerOrder,
      isActive: tier.isActive, visibility: tier.visibility, releaseAfterOfferingId: tier.releaseAfterOfferingId })) };
  const item = { schema: 1, id: crypto.randomUUID(), name: event.title, createdAt: new Date().toISOString(), source };
  const rows = readEventTemplates(userId);
  localStorage.setItem(storageKey(userId), JSON.stringify([item, ...rows].slice(0, 20)));
  return item;
}

export function removeEventTemplate(userId, templateId) {
  localStorage.setItem(storageKey(userId), JSON.stringify(readEventTemplates(userId).filter((row) => row.id !== templateId)));
}
