const { Op, QueryTypes } = require('sequelize');
const { notFound } = require('../domain/errors');
const { assertActiveEvent } = require('./lifecycle-service');
const { publicEvent } = require('../controllers/public-controller');

function createCustomerSavedService({ models, now = () => new Date() }) {
  async function list(userId, { page = 1, pageSize = 9 } = {}) {
    const scope = `FROM saved_events saved JOIN events event ON event.id=saved.event_id
      LEFT JOIN organizations org ON org.id=event.organization_id
      LEFT JOIN locations venue ON venue.id=event.location_id
      LEFT JOIN users creator ON creator.id=event.creator_user_id
      WHERE saved.user_id=:userId AND event.status='published' AND event.lifecycle_state='active'
        AND event.ends_at >= :now
        AND (event.organization_id IS NULL OR (org.lifecycle_state='active' AND org.status='active'))
        AND (event.location_id IS NULL OR venue.lifecycle_state='active')
        AND (event.organization_id IS NOT NULL OR (creator.lifecycle_state='active' AND creator.is_active=true AND creator.onboarding_pending=false))`;
    const replacements = { userId, now: now(), pageSize, offset: (page - 1) * pageSize };
    const [totalRow] = await models.SavedEvent.sequelize.query(`SELECT COUNT(*)::int AS total ${scope}`, { replacements, type: QueryTypes.SELECT });
    const pageRows = await models.SavedEvent.sequelize.query(`SELECT event.id ${scope}
      ORDER BY event.starts_at ASC, event.id ASC LIMIT :pageSize OFFSET :offset`, { replacements, type: QueryTypes.SELECT });
    const events = pageRows.length ? await models.Event.findAll({ where: { id: { [Op.in]: pageRows.map((row) => row.id) } },
      include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
        { model: models.Offering, as: 'offerings', required: false }] }) : [];
    const byId = new Map(events.map((event) => [event.id, event]));
    return { items: pageRows.map((row) => byId.get(row.id)).filter(Boolean).map(publicEvent), page, pageSize, total: totalRow.total, hasMore: page * pageSize < totalRow.total };
  }

  async function ids(userId, eventIds) {
    const rows = await models.SavedEvent.findAll({ where: { userId, eventId: { [Op.in]: eventIds } }, attributes: ['eventId'] });
    return { savedIds: rows.map((row) => row.eventId) };
  }

  async function save(userId, eventId) {
    const event = await models.Event.findByPk(eventId);
    if (!event || event.status !== 'published' || +new Date(event.endsAt) < +now()) throw notFound('Event');
    await assertActiveEvent(models, event);
    await models.SavedEvent.bulkCreate([{ userId, eventId }], { ignoreDuplicates: true });
    return { saved: true };
  }

  async function remove(userId, eventId) {
    await models.SavedEvent.destroy({ where: { userId, eventId } });
    return { saved: false };
  }

  async function merge(userId, eventIds) {
    const unique = [...new Set(eventIds)];
    if (!unique.length) return { added: 0, skipped: 0 };
    return models.SavedEvent.sequelize.transaction(async (transaction) => {
      const events = await models.Event.findAll({ where: { id: { [Op.in]: unique }, status: 'published', lifecycleState: 'active', endsAt: { [Op.gte]: now() } }, transaction });
      const valid = [];
      for (const event of events) {
        try { await assertActiveEvent(models, event, transaction); valid.push(event.id); }
        catch (error) { if (![403, 404].includes(error.status)) throw error; }
      }
      const replacements = { userId };
      const values = valid.map((eventId, index) => {
        replacements[`eventId${index}`] = eventId;
        return `(gen_random_uuid(), CAST(:userId AS uuid), CAST(:eventId${index} AS uuid), NOW(), NOW())`;
      });
      const inserted = values.length ? await models.SavedEvent.sequelize.query(
        `INSERT INTO saved_events (id, user_id, event_id, created_at, updated_at) VALUES ${values.join(', ')}
          ON CONFLICT (user_id, event_id) DO NOTHING RETURNING id`,
        { replacements, transaction, type: QueryTypes.SELECT }) : [];
      return { added: inserted.length, skipped: unique.length - inserted.length };
    });
  }

  return { list, ids, save, remove, merge };
}

module.exports = { createCustomerSavedService };
