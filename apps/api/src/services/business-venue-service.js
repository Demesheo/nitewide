const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { venueSchema } = require('./admin-onboarding-service');
const { active, activeUser } = require('./lifecycle-service');
const { hasInternalPermission } = require('./internal-admin-permissions');
const { mutationTransaction } = require('./mutation-transaction');
const { lockBusiness, bumpBusiness, bumpAccount } = require('./business-membership-policy');
const { pageResult } = require('./business-read-service');
const { venueMemberSql } = require('./venue-access-policy');
const { revokeVenueInvitationLinks } = require('./venue-access-transition');

const reason = z.string().trim().min(3).max(500);
const version = z.number().int().min(0);
const venuePageSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().max(120).default('') }).strict();
const venueCreateSchema = z.object({ venue: venueSchema, reason, version }).strict();
const venueUpdateSchema = venueSchema.omit({ privacy: true }).partial().extend({ privacy: z.enum(['public', 'attendees_only', 'private']).optional(), reason, version }).strict().refine((input) => Object.keys(input).some((key) => !['reason', 'version'].includes(key)), 'Choose a venue field to change');
const venueLifecycleSchema = z.object({ reason, version }).strict();
const venueTeamSchema = z.object({ role: z.enum(['manager', 'employee', 'promoter']), status: z.enum(['active', 'inactive']).default('active'), reason, version: version.nullable() }).strict();
const venueFields = ['name', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode', 'timezone', 'privacy', 'lifecycleState', 'version'];
const plain = (row) => row?.toJSON ? row.toJSON() : row;
const locationSelect = `loc.id, loc.name, loc.address_line1 AS "addressLine1",loc.address_line2 AS "addressLine2",loc.city,loc.region,
  loc.postal_code AS "postalCode",loc.country_code AS "countryCode",loc.timezone,loc.privacy,loc.lifecycle_state AS "lifecycleState",loc.version,
  EXISTS (SELECT 1 FROM events history WHERE history.location_id=loc.id) AS "addressLocked"`;
const accessSelect = `va.id,va.organization_id AS "organizationId",va.location_id AS "locationId",va.user_id AS "userId",va.role,va.status,va.version,u.display_name AS "displayName",u.email`;

function createBusinessVenueService({ models, permissions }) {
  const select = (sql, replacements, transaction) => models.Organization.sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const write = async (work) => {
    try { return await mutationTransaction(models.Organization.sequelize, work, { accessChange: true }); }
    catch (error) {
      if (['40001', '40P01'].includes(error.original?.code || error.parent?.code) || error.name === 'SequelizeOptimisticLockError') throw conflict('This venue changed. Refresh and try again.', 'STALE_VERSION');
      if (error.name === 'SequelizeUniqueConstraintError') throw conflict('This venue or access was saved concurrently. Refresh and try again.', 'VENUE_CONCURRENT_CHANGE');
      throw error;
    }
  };
  async function context(actor, organizationId, internal, transaction, writing = false) {
    z.uuid().parse(organizationId);
    const options = { transaction };
    if (internal) await permissions.assertInternalPermission(actor, writing ? 'access.manage' : 'directory.view', transaction);
    const user = await models.User.findByPk(actor, options);
    if (!activeUser(user)) throw forbidden('An active account is required');
    const organization = await models.Organization.findByPk(organizationId, options);
    if (!organization) throw notFound('Business');
    if (!internal && (!active(organization) || organization.status !== 'active')) throw forbidden('This business is unavailable');
    const leader = await models.OrganizationOwner.findOne({ where: { organizationId, userId: actor, lifecycleState: 'active' }, ...options });
    const anyGrant = await models.VenueAccess.findOne({ where: { organizationId, userId: actor, status: 'active' }, ...options });
    const orgManage = Boolean(leader || hasInternalPermission(user, 'access.manage'));
    const canGrantManager = Boolean(leader?.role === 'owner' || hasInternalPermission(user, 'access.manage'));
    let orgView = internal || orgManage;
    if (!orgView) {
      const employee = await models.OrganizationEmployee.findOne({ where: { organizationId, userId: actor, status: 'active' }, ...options });
      const affiliate = await models.OrgAffiliate.findOne({ where: { organizationId, userId: actor, status: 'active' }, ...options });
      orgView = Boolean(employee || (affiliate && (!affiliate.startsAt || affiliate.startsAt <= new Date()) && (!affiliate.endsAt || affiliate.endsAt >= new Date())));
    }
    if (!orgView && !anyGrant) throw forbidden('Business or venue access required');
    return { organization, orgManage, orgView, canGrantManager, actor, internal, venueGrant: null };
  }
  function venueSafe(row, ctx) {
    const data = plain(row);
    const canManage = ctx.orgManage || Boolean(data.venueManager) || (ctx.venueGrant?.locationId === data.id && ctx.venueGrant.role === 'manager');
    return { id: data.id, organizationId: ctx.organization.id, ...Object.fromEntries(venueFields.map((key) => [key, data[key] ?? null])),
      canManage, canManageTeam: canManage, canLifecycle: ctx.orgManage, canGrantManager: ctx.canGrantManager, addressLocked: Boolean(data.addressLocked) };
  }
  async function linkedVenue(ctx, locationId, transaction, lock = false) {
    z.uuid().parse(locationId);
    const options = { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) };
    if (!await models.OrganizationVenue.findOne({ where: { organizationId: ctx.organization.id, locationId }, ...options })) throw notFound('Business venue');
    const location = await models.Location.findByPk(locationId, options);
    if (!location) throw notFound('Venue');
    ctx.venueGrant = await models.VenueAccess.findOne({ where: { organizationId: ctx.organization.id, locationId, userId: ctx.actor, status: 'active' }, transaction });
    if (!ctx.orgView && !ctx.venueGrant) throw forbidden('Access to this venue is required');
    return location;
  }
  function assertManageVenue(ctx, location, { lifecycle = false } = {}) {
    if (!ctx.orgManage && !(ctx.venueGrant?.locationId === location.id && ctx.venueGrant.role === 'manager')) throw forbidden('Venue manager access required');
    if (!lifecycle && !active(location)) throw conflict('Restore this venue before making changes', 'VENUE_UNAVAILABLE');
    if (lifecycle && !ctx.orgManage) throw forbidden('Organization leader access required for venue lifecycle changes');
  }
  async function audit(actor, ctx, record, action, before, explanation, transaction) {
    await models.AuditLog.create({ actorUserId: actor, organizationId: ctx.organization.id, entityType: record.locationId ? 'VenueAccess' : 'Location', entityId: record.id,
      action, before, after: { ...plain(record), adminReason: explanation } }, { transaction });
  }
  async function list(actor, organizationId, query, internal = true) {
    const input = venuePageSchema.parse(query); const ctx = await context(actor, organizationId, internal);
    const values = { userId: actor, organizationId, search: input.search, term: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize };
    const where = `ov.organization_id=:organizationId ${ctx.orgView ? '' : `AND ${venueMemberSql('ov')}`} AND (:search = '' OR loc.name ILIKE :term ESCAPE '\\' OR loc.city ILIKE :term ESCAPE '\\' OR loc.address_line1 ILIKE :term ESCAPE '\\')`;
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM organization_venues ov JOIN locations loc ON loc.id=ov.location_id WHERE ${where}`, values);
    const rows = await select(`SELECT ${locationSelect},${venueMemberSql('ov', ['manager'])} AS "venueManager" FROM organization_venues ov JOIN locations loc ON loc.id=ov.location_id WHERE ${where} ORDER BY lower(loc.name),loc.city,loc.id LIMIT :pageSize OFFSET :offset`, values);
    return { ...pageResult(rows.map((row) => venueSafe(row, ctx)), count.total, input.page, input.pageSize), organizationVersion: ctx.organization.version, canCreate: ctx.orgManage, canGrantManager: ctx.canGrantManager };
  }
  async function detail(actor, organizationId, locationId, internal = true) {
    const ctx = await context(actor, organizationId, internal);
    const location = await linkedVenue(ctx, locationId);
    return { ...venueSafe(location, ctx), organizationVersion: ctx.organization.version, addressLocked: Boolean(await models.Event.count({ where: { locationId } })) };
  }
  async function create(actor, organizationId, body, internal = true) {
    const input = venueCreateSchema.parse(body);
    return write(async (transaction) => {
      const ctx = await context(actor, organizationId, internal, transaction, true);
      if (!ctx.orgManage) throw forbidden('Organization leader access required to create a venue');
      ctx.organization = await lockBusiness(models, organizationId, transaction, input.version);
      const location = await models.Location.create(input.venue, { transaction });
      await models.OrganizationVenue.create({ organizationId, locationId: location.id }, { transaction });
      const organizationVersion = await bumpBusiness(models, ctx.organization, transaction, !ctx.organization.locationId ? { locationId: location.id } : {});
      await audit(actor, ctx, location, 'venue.created', null, input.reason, transaction);
      return { ...venueSafe(location, ctx), organizationVersion, addressLocked: false };
    });
  }
  async function update(actor, organizationId, locationId, body, internal = true) {
    const { reason: explanation, version: expected, ...changes } = venueUpdateSchema.parse(body);
    return write(async (transaction) => {
      const ctx = await context(actor, organizationId, internal, transaction, true);
      ctx.organization = await lockBusiness(models, organizationId, transaction);
      const location = await linkedVenue(ctx, locationId, transaction, true); assertManageVenue(ctx, location);
      if (location.version !== expected) throw conflict('This venue changed. Refresh and try again.', 'STALE_VERSION');
      const before = plain(location);
      const addressChanged = Object.keys(changes).some((key) => key !== 'name' && (changes[key] || null) !== (location[key] || null));
      if (addressChanged && await models.Event.count({ where: { locationId }, transaction })) throw conflict('This venue has event history. Create a new venue and move upcoming events through the event editor so attendee notices and history are preserved.', 'VENUE_ADDRESS_HISTORY_LOCKED');
      await location.update(changes, { transaction });
      const organizationVersion = await bumpBusiness(models, ctx.organization, transaction);
      await audit(actor, ctx, location, 'venue.updated', before, explanation, transaction);
      return { ...venueSafe(location, ctx), organizationVersion, addressLocked: Boolean(await models.Event.count({ where: { locationId }, transaction })) };
    });
  }
  async function lifecycle(actor, organizationId, locationId, action, body, internal = true) {
    const input = venueLifecycleSchema.parse(body); const next = { archive: 'archived', suspend: 'suspended', restore: 'active' }[action];
    if (!next) throw notFound('Venue action');
    return write(async (transaction) => {
      const ctx = await context(actor, organizationId, internal, transaction, true);
      ctx.organization = await lockBusiness(models, organizationId, transaction);
      const location = await linkedVenue(ctx, locationId, transaction, true); assertManageVenue(ctx, location, { lifecycle: true });
      if (location.version !== input.version) throw conflict('This venue changed. Refresh and try again.', 'STALE_VERSION');
      const before = plain(location); await location.update({ lifecycleState: next }, { transaction });
      const organizationVersion = await bumpBusiness(models, ctx.organization, transaction);
      await audit(actor, ctx, location, `venue.${action}`, before, input.reason, transaction);
      return { ...venueSafe(location, ctx), organizationVersion, addressLocked: Boolean(await models.Event.count({ where: { locationId }, transaction })) };
    });
  }
  async function team(actor, organizationId, locationId, query, internal = true) {
    const input = venuePageSchema.parse(query); const ctx = await context(actor, organizationId, internal);
    const location = await linkedVenue(ctx, locationId);
    const canManage = venueSafe(location, ctx).canManage;
    if (!internal && !canManage) throw forbidden('Venue manager access required to view this team');
    const values = { organizationId, locationId, search: input.search, term: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize };
    const where = `va.organization_id=:organizationId AND va.location_id=:locationId AND (:search = '' OR u.display_name ILIKE :term ESCAPE '\\' OR u.email ILIKE :term ESCAPE '\\')`;
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM venue_access va JOIN users u ON u.id=va.user_id WHERE ${where}`, values);
    const rows = await select(`SELECT ${accessSelect} FROM venue_access va JOIN users u ON u.id=va.user_id WHERE ${where} ORDER BY lower(u.display_name),va.id LIMIT :pageSize OFFSET :offset`, values);
    return { ...pageResult(rows, count.total, input.page, input.pageSize), canManage: canManage && active(location) && active(ctx.organization), canGrantManager: ctx.canGrantManager, venueVersion: location.version };
  }
  async function candidates(actor, organizationId, locationId, query, internal = true) {
    const input = venuePageSchema.parse(query); const ctx = await context(actor, organizationId, internal);
    const location = await linkedVenue(ctx, locationId); assertManageVenue(ctx, location);
    const values = { organizationId, locationId, search: input.search, term: `%${input.search.replace(/[\\%_]/g, '\\$&')}%`, pageSize: input.pageSize, offset: (input.page - 1) * input.pageSize };
    const scoped = internal ? '' : !ctx.orgManage ? `AND (lower(u.email)=lower(:search) OR EXISTS (SELECT 1 FROM venue_access va WHERE va.organization_id=:organizationId AND va.location_id=:locationId AND va.user_id=u.id))` : `AND (lower(u.email)=lower(:search) OR EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id=:organizationId AND oo.user_id=u.id AND oo.lifecycle_state='active')
      OR EXISTS (SELECT 1 FROM organization_employees oe WHERE oe.organization_id=:organizationId AND oe.user_id=u.id AND oe.status='active')
      OR EXISTS (SELECT 1 FROM org_affiliates oa WHERE oa.organization_id=:organizationId AND oa.user_id=u.id AND oa.status='active')
      OR EXISTS (SELECT 1 FROM venue_access va WHERE va.organization_id=:organizationId AND va.user_id=u.id))`;
    const where = `u.lifecycle_state='active' AND u.is_active=true AND u.onboarding_pending=false ${scoped} AND (:search = '' OR u.display_name ILIKE :term ESCAPE '\\' OR u.email ILIKE :term ESCAPE '\\')`;
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM users u WHERE ${where}`, values);
    const rows = await select(`SELECT u.id,u.display_name AS "displayName",u.email FROM users u WHERE ${where} ORDER BY lower(u.display_name),u.id LIMIT :pageSize OFFSET :offset`, values);
    return pageResult(rows, count.total, input.page, input.pageSize);
  }
  async function saveMember(actor, organizationId, locationId, userId, body, internal = true) {
    z.uuid().parse(userId); const input = venueTeamSchema.parse(body);
    return write(async (transaction) => {
      const ctx = await context(actor, organizationId, internal, transaction, true);
      ctx.organization = await lockBusiness(models, organizationId, transaction);
      const location = await linkedVenue(ctx, locationId, transaction, true); assertManageVenue(ctx, location);
      const user = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || (input.status === 'active' && !activeUser(user))) throw conflict('Select an active, fully registered account', 'VENUE_ACCOUNT_UNAVAILABLE');
      let row = await models.VenueAccess.findOne({ where: { organizationId, locationId, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if ((row?.version ?? null) !== input.version) throw conflict('This venue access changed. Refresh and try again.', 'STALE_VERSION');
      if ((input.role === 'manager' || row?.role === 'manager') && !ctx.canGrantManager) throw forbidden('Only a business owner or platform administrator may change venue manager access');
      const before = plain(row) || null;
      row = row ? await row.update({ role: input.role, status: input.status }, { transaction }) : await models.VenueAccess.create({ organizationId, locationId, userId, role: input.role, status: input.status }, { transaction });
      // Revocation is dynamic, and unused private guestlist links are explicitly invalidated.
      if (input.status === 'inactive' || (before?.role === 'manager' && input.role !== 'manager')) await revokeVenueInvitationLinks({ models, grant: row, actorUserId: actor, transaction, allPools: input.status === 'inactive' });
      await bumpAccount(models, user, transaction); await bumpBusiness(models, ctx.organization, transaction);
      await audit(actor, ctx, row, 'venue.access.changed', before, input.reason, transaction);
      return { ...plain(row), displayName: user.displayName, email: user.email };
    });
  }
  return { list, detail, create, update, lifecycle, team, candidates, saveMember };
}
module.exports = { createBusinessVenueService, venuePageSchema, venueCreateSchema, venueUpdateSchema, venueLifecycleSchema, venueTeamSchema };
