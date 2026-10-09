const { QueryTypes, Op, Transaction } = require('sequelize');
const { notFound, DomainError } = require('../domain/errors');
const { publicRundownEventScope } = require('./rundown-policy');
const { businessAccessSql } = require('./business-access-policy');
const { rundownEvent, createRundownService } = require('./rundown-service');
const { publicId, publicPath } = require('../../../shared/public-links.mjs');

const SITEMAP_PAGE_SIZE = 1000;
// The owner entry gate is shared with the rundown service, not an approximation
// based on the existence of an old membership. Revoked pages leave the sitemap.
const rundownScope = `r.published=true AND (
  r.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM organizations org WHERE org.id=r.organization_id AND org.lifecycle_state='active' AND org.status='active')
  OR r.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id=r.user_id AND u.lifecycle_state='active' AND u.is_active=true AND u.onboarding_pending=false
    AND (u.is_internal_admin=true OR u.independent_creator=true OR ${businessAccessSql({ allowSuspendedOrganizations: false }).replaceAll(':userId', 'u.id')})))`;

function createPublicSeoService({ models, customerAppUrl, rundowns = createRundownService({ models, customerAppUrl }), now = () => new Date() }) {
  const database = models.Event?.sequelize;
  const select = (sql, replacements, transaction) => database.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const snapshot = work => {
    if (!database) throw new DomainError('Public pages are temporarily unavailable', { status: 503, code: 'PUBLIC_PAGE_UNAVAILABLE' });
    return database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
      // These public reads must not monopolize a small production instance.
      // Correlated access rules otherwise trigger expensive PostgreSQL JIT
      // compilation even for a tiny sitemap. Settings are transaction-local.
      await select("SELECT set_config('jit','off',true),set_config('statement_timeout','5000',true)", {}, transaction);
      return work(transaction);
    });
  };
  const hydrate = async (ids, transaction, currentTime) => {
    if (!ids.length) return [];
    const events = await models.Event.findAll({ where: { id: { [Op.in]: ids.map(row => row.id) } }, transaction, include: [
      { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
      { model: models.Offering, as: 'offerings', required: false },
    ] });
    const byId = new Map(events.map(event => [event.id, event]));
    return ids.filter(row => byId.has(row.id)).map(row => rundownEvent(byId.get(row.id), currentTime));
  };
  async function home() {
    return snapshot(async transaction => {
      const currentTime = now();
      const ids = await select(`SELECT e.id FROM events e WHERE ${publicRundownEventScope} ORDER BY e.starts_at,e.id LIMIT 12`, { currentTime }, transaction);
      return { items: await hydrate(ids, transaction, currentTime) };
    });
  }
  async function event(id) {
    if (!publicId(id)) throw notFound('Event');
    return snapshot(async transaction => {
      const currentTime = now();
      // Known unlisted/past public share links remain usable, but are never
      // indexed or listed. Drafts and disabled organizations/venues stay closed.
      const ids = await select(`SELECT e.id,(${publicRundownEventScope}) AS indexable FROM events e
        WHERE e.id=:id AND e.status='published' AND e.lifecycle_state='active'
        AND (e.organization_id IS NULL OR EXISTS (SELECT 1 FROM organizations org WHERE org.id=e.organization_id AND org.lifecycle_state='active' AND org.status='active'))
        AND (e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations loc WHERE loc.id=e.location_id AND loc.lifecycle_state='active'))
        AND (e.organization_id IS NOT NULL OR EXISTS (SELECT 1 FROM users creator WHERE creator.id=e.creator_user_id AND creator.lifecycle_state='active' AND creator.is_active=true AND creator.onboarding_pending=false))`, { id, currentTime }, transaction);
      const [item] = await hydrate(ids, transaction, currentTime);
      if (!item) throw notFound('Event');
      return { event: item, indexable: ids[0].indexable };
    });
  }
  async function rundown(id) {
    if (!publicId(id)) throw notFound('Rundown');
    return rundowns.page(id, { pageSize: 6 });
  }
  async function sitemap(kind, page = 1) {
    if (!['events', 'rundowns'].includes(kind) || !Number.isSafeInteger(page) || page < 1 || page > 49999) throw notFound('Sitemap');
    return snapshot(async transaction => {
      const currentTime = now(), from = kind === 'events' ? `events e WHERE ${publicRundownEventScope}` : `rundowns r WHERE ${rundownScope}`,
        alias = kind === 'events' ? 'e' : 'r';
      const ids = await select(`SELECT ${alias}.id FROM ${from} ORDER BY ${alias}.id LIMIT :limit OFFSET :offset`,
        { currentTime, limit: SITEMAP_PAGE_SIZE, offset: (page - 1) * SITEMAP_PAGE_SIZE }, transaction);
      if (page > 1 && !ids.length) throw notFound('Sitemap');
      return ids.map(row => new URL(publicPath(kind, row.id), customerAppUrl).toString());
    });
  }
  async function sitemapIndex() {
    return snapshot(async transaction => {
      const currentTime = now();
      const [counts] = await select(`SELECT (SELECT COUNT(*) FROM events e WHERE ${publicRundownEventScope}) AS events,
        (SELECT COUNT(*) FROM rundowns r WHERE ${rundownScope}) AS rundowns`, { currentTime }, transaction);
      // Sitemap indexes also have a 50,000-entry protocol limit. Fail closed
      // rather than silently omit pages if this deployment ever exceeds it.
      const entries = [{ kind: 'static', page: 1 }];
      for (const kind of ['events', 'rundowns']) {
        const pages = Math.ceil(Number(counts[kind]) / SITEMAP_PAGE_SIZE);
        if (pages + entries.length > 50000) throw new DomainError('Sitemap capacity exceeded', { status: 503, code: 'SITEMAP_CAPACITY' });
        for (let page = 1; page <= pages; page++) entries.push({ kind, page });
      }
      return entries;
    });
  }
  return { home, event, rundown, sitemap, sitemapIndex };
}
module.exports = { createPublicSeoService, SITEMAP_PAGE_SIZE };
