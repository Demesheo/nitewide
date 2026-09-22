const { Op } = require('sequelize');
const { assertLocalDemoDatabase, prepareImage, DEMO_NOTICE } = require('./posh-importer');
const { defaultUploadDir } = require('../services/media-service');
const snapshot = require('./fixtures/posh-orlando-2026-09-22');
const source = snapshot.events.find(event => event.sourceUrl === 'https://posh.vip/e/culture-code-friday-2026-9-26-6-0');

function replacementFields(imageAssetId) {
  return { title: source.title, summary: `${source.description} [Demo listing]`,
    description: `${source.description}\n\n${DEMO_NOTICE}\nSource: ${source.sourceUrl}\nVerified: ${snapshot.verifiedOn} (America/New_York).`,
    startsAt: source.startsAt, endsAt: source.endsAt, imageAssetId };
}

// One explicitly requested source replacement, never a general overwrite policy.
async function replaceRoom22Friday({ sequelize, models: m, config, apply = false, fetchImpl = fetch }) {
  assertLocalDemoDatabase(config);
  const org = await m.Organization.findOne({ where: { slug: 'proper' } });
  if (!org) return { replaced: false, reason: 'Proper demo organization not present' };
  const locations = await m.Location.findAll({ where: { name: 'Room 22', city: 'Orlando', addressLine1: '114 S Orange Ave' } });
  const candidates = await m.Event.findAll({ where: { organizationId: org.id, locationId: locations.map(l => l.id),
    title: ['Room 22 Friday Nights', source.title], startsAt: { [Op.gte]: '2026-09-25T04:00:00Z', [Op.lt]: '2026-09-26T04:00:00Z' } } });
  if (!candidates.length) return { replaced: false, reason: 'No matching September 25 seed event; normal source import can proceed' };
  if (candidates.length !== 1) throw new Error('Ambiguous Room 22 replacement; no records changed');
  const target = candidates[0];
  const patch = replacementFields(target.imageAssetId);
  if (target.imageAssetId && target.title === patch.title && target.description === patch.description && +target.startsAt === Date.parse(patch.startsAt) && +target.endsAt === Date.parse(patch.endsAt)) return { replaced: false, alreadyReplaced: true, eventId: target.id };
  if (!apply) return { wouldReplace: target.id, title: source.title, startsAt: source.startsAt, endsAt: source.endsAt };
  const image = await prepareImage(source.imageUrl, config.MEDIA_UPLOAD_DIR || defaultUploadDir, fetchImpl);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(7210921)', { transaction });
    await target.reload({ transaction, lock: transaction.LOCK.UPDATE });
    const conflicts = await m.Event.count({ where: { id: { [Op.ne]: target.id }, locationId: locations.map(l => l.id), status: { [Op.ne]: 'cancelled' }, startsAt: { [Op.lt]: source.endsAt }, endsAt: { [Op.gt]: source.startsAt } }, transaction });
    if (conflicts) throw new Error('Replacement would overlap another Room 22 event');
    const buyers = await m.Order.findAll({ where: { eventId: target.id, status: 'paid' }, attributes: ['buyerUserId'], transaction });
    const purchaseConflicts = await m.Order.count({ where: { buyerUserId: buyers.map(o => o.buyerUserId), eventId: { [Op.ne]: target.id }, status: 'paid' }, include: [{ model: m.Event, as: 'event', required: true, where: { startsAt: { [Op.lt]: source.endsAt }, endsAt: { [Op.gt]: source.startsAt } } }], transaction });
    if (purchaseConflicts) throw new Error('New schedule conflicts with an existing buyer purchase; no event changes applied');
    const before = target.toJSON();
    await m.MediaAsset.findOrCreate({ where: { id: image.id }, defaults: { ...image, uploadedByUserId: target.creatorUserId }, transaction });
    await target.update(replacementFields(image.id), { transaction });
    await m.AuditLog.create({ organizationId: org.id, entityType: 'Event', entityId: target.id, action: 'event.demo_source_replaced', before,
      after: { ...replacementFields(image.id), sourceUrl: source.sourceUrl, preservedId: target.id, preservedSlug: target.slug } }, { transaction });
    return { replaced: true, eventId: target.id, title: target.title, sourceUrl: source.sourceUrl };
  });
}
module.exports = { replaceRoom22Friday, replacementFields };
