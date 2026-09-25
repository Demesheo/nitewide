const { assertLocalDemoDatabase, prepareImage, DEMO_NOTICE } = require('./posh-importer');
const { defaultUploadDir } = require('../services/media-service');
const snapshot = require('./fixtures/posh-orlando-2026-09-21');

// These verified listings take the place of same-night generic demo events.
// Keep the existing event IDs so seeded orders, tickets, referrals and guests survive.
const replacements = [
  { organizationSlug: 'euphoria-downtown', genericTitle: 'Euphoria Downtown Saturday Sessions', sourceUrl: 'https://posh.vip/e/rew1nd-saturdays-2026-9-27-6-0' },
  { organizationSlug: 'tier', genericTitle: 'OHM Friday Nights', sourceUrl: 'https://posh.vip/e/first-class-fridays-2026-9-26-6-0' },
  { organizationSlug: 'tier', genericTitle: 'OHM Sunday Social', sourceUrl: 'https://posh.vip/e/hottie-hot-line-jayy-laurent-live' },
];

function fieldsFor(source, imageAssetId) {
  return {
    title: source.title,
    summary: `${source.description.slice(0, 420)} [Demo listing]`,
    description: `${source.description}\n\n${DEMO_NOTICE}\nSource: ${source.sourceUrl}\nVerified: ${snapshot.verifiedOn} (America/New_York).`,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    imageAssetId,
  };
}

async function replaceVerifiedSeedEvents({ sequelize, models, config, fetchImpl = fetch }) {
  assertLocalDemoDatabase(config);
  const results = [];
  for (const replacement of replacements) {
    const source = snapshot.events.find(event => event.sourceUrl === replacement.sourceUrl);
    if (!source) throw new Error(`Missing reviewed source ${replacement.sourceUrl}`);
    const organization = await models.Organization.findOne({ where: { slug: replacement.organizationSlug } });
    if (!organization) throw new Error(`Missing seeded organization ${replacement.organizationSlug}`);
    const candidates = await models.Event.findAll({ where: {
      organizationId: organization.id,
      title: [replacement.genericTitle, source.title],
      startsAt: new Date(source.startsAt),
    } });
    if (candidates.length !== 1) throw new Error(`Expected one seeded event for ${source.title}; found ${candidates.length}`);
    const event = candidates[0];
    if (event.title === source.title && event.description?.includes(`Source: ${source.sourceUrl}`)) {
      results.push({ title: source.title, eventId: event.id, alreadyReplaced: true });
      continue;
    }
    const image = await prepareImage(source.imageUrl, config.MEDIA_UPLOAD_DIR || defaultUploadDir, fetchImpl);
    await sequelize.transaction(async transaction => {
      await sequelize.query('SELECT pg_advisory_xact_lock(7210921)', { transaction });
      await event.reload({ transaction, lock: transaction.LOCK.UPDATE });
      if (event.title !== replacement.genericTitle) throw new Error(`Seed event changed while replacing ${source.title}`);
      await models.MediaAsset.findOrCreate({ where: { id: image.id }, defaults: { ...image, uploadedByUserId: event.creatorUserId }, transaction });
      const before = event.toJSON();
      await event.update(fieldsFor(source, image.id), { transaction });
      await models.AuditLog.create({ organizationId: organization.id, entityType: 'Event', entityId: event.id,
        action: 'event.demo_source_replaced', before, after: { ...fieldsFor(source, image.id), preservedId: event.id } }, { transaction });
    });
    results.push({ title: source.title, eventId: event.id, replaced: true });
  }
  return results;
}

module.exports = { replacements, fieldsFor, replaceVerifiedSeedEvents };
