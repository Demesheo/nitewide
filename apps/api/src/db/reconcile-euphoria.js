const { Op } = require('sequelize');
const { assertLocalDemoDatabase, stableId } = require('./posh-importer');
const SOURCE_ID = stableId('https://posh.vip/e/rew1nd-saturdays-2026-9-27-6-0');
const norm = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const plain = row => row.toJSON ? row.toJSON() : row;

// Explicitly scoped demo repair, not a heuristic for merging arbitrary venues.
function sameEuphoriaLocation(location, canonical) {
  return ['name', 'city', 'region', 'countryCode', 'timezone', 'privacy'].every(key => norm(location[key]) === norm(canonical[key]))
    && !location.addressLine2 && (!location.addressLine1 || norm(location.addressLine1) === norm(canonical.addressLine1));
}
function assertRedundantGuests(guests, retained, sourceRefs, retainedRefs) {
  const refUser = (id, refs) => id ? refs.find(ref => ref.id === id)?.userId : null;
  for (const guest of guests) {
    const existing = retained.find(row => row.userId === guest.userId);
    if (!existing || existing.status !== guest.status || existing.partySize !== guest.partySize || existing.source !== guest.source
      || refUser(guest.eventAffiliateId, sourceRefs) !== refUser(existing.eventAffiliateId, retainedRefs)
      || (guest.eventAffiliateId && !refUser(guest.eventAffiliateId, sourceRefs))) {
      throw new Error('Guestlists differ; manual reconciliation required, nothing changed');
    }
  }
  for (const ref of sourceRefs.filter(row => row.status === 'active')) {
    if (!retainedRefs.some(row => row.userId === ref.userId && row.status === 'active')) throw new Error('Unique promoter access would be lost; nothing changed');
  }
}

async function reconcileEuphoria({ sequelize, models: m, config, apply = false }) {
  assertLocalDemoDatabase(config);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(7210921)', { transaction });
    const org = await m.Organization.findOne({ where: { slug: 'euphoria-downtown' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!org) return { skipped: 'Euphoria seed is absent' };
    const canonical = await m.Location.findByPk(org.locationId, { transaction });
    if (!canonical || canonical.name !== 'Euphoria Downtown' || canonical.addressLine1 !== '110 S Orange Ave' || canonical.city !== 'Orlando') throw new Error('Unexpected canonical Euphoria location');
    const events = await m.Event.findAll({ where: { organizationId: org.id }, transaction, lock: transaction.LOCK.UPDATE });
    const locations = await m.Location.findAll({ where: { id: events.map(e => e.locationId).filter(Boolean) }, transaction });
    const matching = locations.filter(l => sameEuphoriaLocation(l, canonical)).map(l => l.id);
    const relink = events.filter(e => e.locationId !== canonical.id && matching.includes(e.locationId) && e.id !== SOURCE_ID);
    const source = events.find(e => e.id === SOURCE_ID);
    let target, archive;
    if (source) {
      const targets = events.filter(e => e.id !== source.id && matching.includes(e.locationId) && e.title === 'Euphoria Downtown Saturday Sessions' && +e.startsAt === +source.startsAt && +e.endsAt >= +source.endsAt);
      if (targets.length !== 1) throw new Error('Expected one booked Saturday demo event; no records changed');
      target = targets[0];
      // Refuse to discard any purchase, attendance, invite, notification or paid promotion.
      for (const name of ['Order', 'Ticket', 'CheckIn', 'GuestlistInvitation', 'TeamInvitation', 'Notification', 'Boost']) {
        if (await m[name].count({ where: { eventId: source.id }, transaction })) throw new Error(`Duplicate has ${name} records; manual reconciliation required`);
      }
      archive = { event: plain(source) };
      for (const name of ['GuestlistEntry', 'EventAffiliate', 'Offering', 'AffiliateAttribution']) {
        archive[name] = (await m[name].findAll({ where: { eventId: source.id }, transaction })).map(plain);
      }
      if (archive.Offering.some(o => o.quantitySold !== 0)) throw new Error('Duplicate has sold inventory');
      if (archive.AffiliateAttribution.some(a => a.orderId || a.action !== 'guestlist')) throw new Error('Duplicate has non-guestlist attribution');
      const retainedGuests = await m.GuestlistEntry.findAll({ where: { eventId: target.id }, transaction });
      const retainedRefs = await m.EventAffiliate.findAll({ where: { eventId: target.id }, transaction });
      assertRedundantGuests(archive.GuestlistEntry, retainedGuests, archive.EventAffiliate, retainedRefs);
    }
    const report = { mode: apply ? 'apply' : 'dry-run', canonicalLocationId: canonical.id, relinkEventIds: relink.map(e => e.id), retainedEventId: target?.id || null, removeDuplicateEventId: source?.id || null, redundantGuestlists: archive?.GuestlistEntry.length || 0 };
    if (!apply) return report;
    if (source) {
      await m.AuditLog.create({ organizationId: org.id, entityType: 'Event', entityId: source.id, action: 'event.demo_duplicate_consolidated', before: { ...archive, retainedEvent: plain(target) }, after: { retainedEventId: target.id, canonicalLocationId: canonical.id, reason: 'Same physical venue/time; all duplicate guests and active referrers already exist on booked event' } }, { transaction });
      // Keep the purchased event identity, sale snapshots, inventory, guest QR credentials,
      // commissions and permissions; only adopt the verified source's presentation/schedule.
      await target.update({ title: source.title, summary: source.summary, description: source.description, imageAssetId: source.imageAssetId, endsAt: source.endsAt, version: target.version + 1 }, { transaction });
      for (const name of ['AffiliateAttribution', 'GuestlistEntry', 'Offering', 'EventAffiliate']) await m[name].destroy({ where: { eventId: source.id }, transaction });
      await source.destroy({ transaction });
    }
    for (const event of relink) {
      await m.AuditLog.create({ organizationId: org.id, entityType: 'Event', entityId: event.id, action: 'event.demo_location_reconciled', before: { locationId: event.locationId, version: event.version }, after: { locationId: canonical.id, reason: 'Euphoria location aliases consolidated; obsolete location rows retained for audit recovery' } }, { transaction });
      await event.update({ locationId: canonical.id, version: event.version + 1 }, { transaction });
    }
    return report;
  });
}
async function main() {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--apply', '--dry-run'].includes(flag))) throw new Error('Use --dry-run or --apply');
  const config = require('../config').getConfig();
  const sequelize = require('./sequelize').createSequelize(config);
  try { console.log(JSON.stringify(await reconcileEuphoria({ sequelize, models: require('./models').initModels(sequelize), config, apply: flags.includes('--apply') }), null, 2)); }
  finally { await sequelize.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { reconcileEuphoria, sameEuphoriaLocation, assertRedundantGuests, SOURCE_ID };
