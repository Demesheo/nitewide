const { QueryTypes, Op, Transaction } = require('sequelize');
const { z } = require('zod');
const { DomainError, forbidden, notFound } = require('../domain/errors');
const { assertBusinessAccess } = require('./business-access-policy');
const { active, activeUser, assertActiveOrganization } = require('./lifecycle-service');
const { organizationMember, base } = require('./business-read-service');
const { personalRundownScope, publicRundownEventScope } = require('./rundown-policy');
const { mutationTransaction } = require('./mutation-transaction');
const { offeringSaleState } = require('../domain/event-policy');
const { effectiveFeeMode } = require('@nitewide/pricing');

const cursorSchema = z.object({ version: z.literal(1), rundownId: z.uuid(), startsAt: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
const previewCursorSchema = z.object({ version: z.literal(2), kind: z.enum(['personal', 'business']), ownerId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
function decodeRundownCursor(value, rundownId) {
  if (!value) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.rundownId !== rundownId) throw new Error('Wrong rundown');
    return cursor;
  } catch { throw new DomainError('Invalid rundown cursor', { code: 'INVALID_RUNDOWN_CURSOR', status: 422 }); }
}
function decodePreviewRundownCursor(value, kind, ownerId) {
  if (!value) return null;
  try {
    const cursor = previewCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.kind !== kind || cursor.ownerId !== ownerId) throw new Error('Wrong preview owner');
    return cursor;
  } catch { throw new DomainError('Invalid rundown cursor', { code: 'INVALID_RUNDOWN_CURSOR', status: 422 }); }
}
const project = (value, fields) => Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
function rundownEvent(event, currentTime = new Date()) {
  const json = event.toJSON ? event.toJSON() : event;
  const location = json.location ? project(json.location, ['id', 'name', 'city', 'region', 'countryCode', 'timezone', 'privacy',
    ...(json.location.privacy === 'public' ? ['addressLine1', 'addressLine2', 'postalCode', 'latitude', 'longitude'] : [])]) : null;
  const allOfferings = event.offerings || json.offerings || [];
  return { ...project(json, ['id', 'imageUrl', 'title', 'slug', 'summary', 'description', 'category', 'status', 'startsAt', 'endsAt', 'feeMode', 'guestlistCapacity']),
    isPremiumHost: json.organization?.planTier === 'premium',
    organization: json.organization ? project(json.organization, ['id', 'name', 'slug', 'planTier']) : null,
    location, offerings: allOfferings.filter((offer) => offer.isActive && offer.visibility === 'public').map((offer) => ({
      ...project(offer.toJSON ? offer.toJSON() : offer, ['id', 'eventId', 'name', 'description', 'kind', 'priceCents', 'currency', 'feeMode',
        'inventoryMode', 'quantityTotal', 'quantitySold', 'entriesPerUnit', 'minPerOrder', 'maxPerOrder', 'salesStartAt', 'salesEndAt', 'sortOrder']),
      effectiveFeeMode: effectiveFeeMode(json.feeMode || 'buyer', offer.feeMode || 'inherit'),
      saleState: offeringSaleState(offer, allOfferings, currentTime),
    })) };
}

function createRundownService({ models, customerAppUrl, now = () => new Date() }) {
  const select = (sql, replacements, transaction) => models.Event.sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const assertAccess = (userId, transaction) => assertBusinessAccess(models, userId, transaction, undefined, { allowSuspendedOrganizations: false });
  const url = (id) => { const result = new URL('/', customerAppUrl); result.searchParams.set('rundown', id); return result.toString(); };
  const item = (owner, profile, canPublish) => ({ kind: owner.kind, name: owner.name, organizationId: owner.organizationId || null,
    published: Boolean(profile?.published), canPublish, url: profile?.published ? url(profile.id) : null });
  async function organizations(userId, transaction) {
    return select(`SELECT org.id,org.name
      FROM organizations org WHERE org.lifecycle_state='active' AND org.status='active'
      AND (${organizationMember.replace(/\be\.organization_id\b/g, 'org.id')}
        OR EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov
          ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
          JOIN locations loc ON loc.id=va.location_id AND loc.lifecycle_state='active'
          WHERE va.organization_id=org.id AND va.user_id=:userId AND va.status='active')
        OR EXISTS (SELECT 1 FROM events e WHERE e.organization_id=org.id
          AND ${base.replace(/:isAdmin\b/g, 'false').replace(/:canManageEvents\b/g, 'false')} AND ${personalRundownScope}))
      ORDER BY org.name ASC,org.id ASC`, { userId, currentTime: now() }, transaction);
  }
  async function list(userId) {
    const user = await assertAccess(userId);
    const orgs = await organizations(userId);
    const profiles = await models.Rundown.findAll({ where: { [Op.or]: [{ userId }, ...(orgs.length ? [{ organizationId: { [Op.in]: orgs.map(org => org.id) } }] : [])] } });
    return { items: [item({ kind: 'personal', name: user.displayName }, profiles.find(row => row.userId === userId), true),
      ...orgs.map(org => item({ kind: 'business', name: org.name, organizationId: org.id }, profiles.find(row => row.organizationId === org.id), true))] };
  }
  async function publish(userId, input) {
    return mutationTransaction(models.Event.sequelize, async (transaction) => {
      const user = await assertAccess(userId, transaction);
      let owner = { kind: 'personal', name: user.displayName }, where = { userId };
      if (input.kind === 'business') {
        const org = (await organizations(userId, transaction)).find(row => row.id === input.organizationId);
        if (!org) throw forbidden('Current business team access required');
        await assertActiveOrganization(models, org.id, transaction);
        owner = { kind: 'business', name: org.name, organizationId: org.id }; where = { organizationId: org.id };
      }
      // One row per owner, with a random public ID. Concurrent and repeated
      // shares converge without creating event/referral assignments.
      const [profile] = await models.Rundown.findOrCreate({ where, defaults: { ...where, published: true }, transaction });
      if (!profile.published) await profile.update({ published: true }, { transaction });
      return item(owner, profile, true);
    });
  }
  async function page(rundownId, input) {
    // Keep the eligibility IDs and hydrated public fields in one read snapshot;
    // a concurrent visibility/name/lifecycle edit cannot mix old authority with
    // newly private event data. No profiles or referral rows are provisioned.
    return models.Event.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true },
      (transaction) => readPage(rundownId, input, transaction));
  }
  async function preview(userId, input) {
    return models.Event.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async (transaction) => {
      const user = await assertAccess(userId, transaction);
      let name = user.displayName, organizationId = null, referralCode = null;
      if (input.kind === 'business') {
        const organization = (await organizations(userId, transaction)).find(row => row.id === input.organizationId);
        if (!organization) throw forbidden('Current business team access required');
        name = organization.name; organizationId = organization.id;
      } else {
        const existing = await models.Rundown.findOne({ where: { userId }, transaction });
        if (existing?.published) referralCode = `RUN-${existing.id}`;
      }
      const ownerId = organizationId || userId;
      const cursor = decodePreviewRundownCursor(input.cursor, input.kind, ownerId);
      return eventPage({ kind: input.kind, name, userId: organizationId ? null : userId, organizationId, referralCode,
        cursorContext: { version: 2, kind: input.kind, ownerId } }, input, cursor, transaction);
    });
  }
  async function readPage(rundownId, input, transaction) {
    const cursor = decodeRundownCursor(input.cursor, rundownId);
    const profile = await models.Rundown.findByPk(rundownId, { transaction });
    if (!profile?.published) throw notFound('Rundown');
    let owner;
    if (profile.userId) {
      try { owner = await assertAccess(profile.userId, transaction); }
      catch (error) { if (error.code === 'BUSINESS_ACCESS_REQUIRED') throw notFound('Rundown'); throw error; }
      if (!activeUser(owner)) throw notFound('Rundown');
    } else {
      owner = await models.Organization.findByPk(profile.organizationId, { transaction });
      if (!active(owner) || owner.status !== 'active') throw notFound('Rundown');
    }
    return eventPage({ kind: profile.userId ? 'personal' : 'business', name: profile.userId ? owner.displayName : owner.name,
      userId: profile.userId, organizationId: profile.organizationId, referralCode: profile.userId ? `RUN-${profile.id}` : null,
      cursorContext: { version: 1, rundownId } }, input, cursor, transaction);
  }
  async function eventPage(scope, input, cursor, transaction) {
    const currentTime = now();
    const ids = await select(`SELECT e.id,e.starts_at AS "startsAt" FROM events e
      WHERE ${publicRundownEventScope} AND ${scope.kind === 'personal' ? personalRundownScope : 'e.organization_id=:organizationId'}
      ${cursor ? 'AND (e.starts_at,e.id)>(CAST(:startsAt AS timestamptz),CAST(:id AS uuid))' : ''}
      ORDER BY e.starts_at ASC,e.id ASC LIMIT :limit`, { userId: scope.userId, organizationId: scope.organizationId,
      currentTime, limit: input.pageSize + 1, ...(cursor ? { startsAt: cursor.startsAt, id: cursor.id } : {}) }, transaction);
    const visible = ids.slice(0, input.pageSize);
    const events = visible.length ? await models.Event.findAll({ where: { id: { [Op.in]: visible.map(row => row.id) } }, include: [
      { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
      { model: models.Offering, as: 'offerings', required: false },
    ], transaction }) : [];
    const byId = new Map(events.map(event => [event.id, event])), last = visible.at(-1), hasMore = ids.length > input.pageSize;
    return { profile: { kind: scope.kind, name: scope.name },
      items: visible.filter(row => byId.has(row.id)).map(row => ({ ...rundownEvent(byId.get(row.id), currentTime), referralCode: scope.referralCode })),
      hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ ...scope.cursorContext, startsAt: new Date(last.startsAt).toISOString(), id: last.id })).toString('base64url') : null };
  }
  return { list, publish, page, preview };
}
module.exports = { createRundownService, rundownEvent, decodeRundownCursor, decodePreviewRundownCursor };
