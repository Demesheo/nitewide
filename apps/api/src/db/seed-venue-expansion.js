const { stableId, assertLocalDemoDatabase } = require('./posh-importer');
const { createPasswordRecord } = require('../services/auth-service');

async function mergeRoom22({ sequelize, models: m, config, apply = false }) {
  assertLocalDemoDatabase(config);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(7210923)', { transaction });
    const room = await m.Organization.findOne({ where: { slug: 'room-22' }, transaction });
    const proper = await m.Organization.findOne({ where: { slug: 'proper' }, transaction });
    if (!room || !proper) throw new Error('Expected existing Room 22 and Proper demo organizations');
    if (room.status === 'closed') return { merged: false, alreadyMerged: true };
    const owner = await m.User.findOne({ where: { email: 'maya.owner@nitewide.test' }, transaction });
    for (const org of [room, proper]) {
      if (!owner || !await m.OrganizationOwner.count({ where: { organizationId: org.id, userId: owner.id, role: 'owner' }, transaction })) throw new Error('Refusing to merge non-demo organizations');
    }
    const events = await m.Event.findAll({ where: { organizationId: room.id }, transaction });
    const report = { merged: apply, wouldMoveEvents: events.length, from: room.name, to: proper.name, locationsPreserved: true };
    if (!apply) return report;
    const before = { organization: room.toJSON(), events: events.map(e => ({ id: e.id, organizationId: e.organizationId, locationId: e.locationId })), memberships: {} };
    for (const modelName of ['OrganizationOwner', 'OrganizationEmployee', 'OrgAffiliate']) {
      const rows = await m[modelName].findAll({ where: { organizationId: room.id }, transaction });
      before.memberships[modelName] = rows.map(r => r.toJSON());
      for (const row of rows) {
        const existing = await m[modelName].findOne({ where: { organizationId: proper.id, userId: row.userId }, transaction });
        if (!existing) await row.update({ organizationId: proper.id }, { transaction });
        else {
          if (modelName === 'OrgAffiliate') {
            // Preserve event links and financial snapshots when consolidating a duplicate membership.
            for (const dependent of ['EventAffiliate', 'Order', 'AffiliateAttribution']) {
              await m[dependent].update({ orgAffiliateId: existing.id }, { where: { orgAffiliateId: row.id }, transaction });
            }
          }
          if (modelName === 'OrganizationOwner' && row.role === 'owner') await existing.update({ role: 'owner' }, { transaction });
          await row.destroy({ transaction });
        }
      }
    }
    for (const modelName of ['Event', 'TeamInvitation', 'Boost']) {
      await m[modelName].update({ organizationId: proper.id }, { where: { organizationId: room.id }, transaction });
    }
    await room.update({ status: 'closed' }, { transaction });
    await m.AuditLog.create({ actorUserId: owner.id, organizationId: proper.id, entityType: 'Organization', entityId: room.id,
      action: 'organization.demo_consolidated', before, after: { organizationId: proper.id, reason: 'User confirmed Room 22 belongs to Proper; physical event locations retained' } }, { transaction });
    return report;
  });
}

async function provisionDemoVenues({ sequelize, models: m, config, snapshot, apply = false }) {
  assertLocalDemoDatabase(config);
  const { demoPassword, teamCountsForVenue } = require('./seed');
  const report = [];
  const first = ['Cameron', 'Adrian', 'Bianca', 'Diana', 'Felix', 'Gabriela', 'Hugo', 'Imani', 'Javier', 'Keira', 'Luca', 'Nadia'];
  const last = ['Alvarez', 'Brooks', 'Cruz', 'Diaz', 'Evans'];
  let index = 0;
  for (const [slug, venue] of Object.entries(snapshot.venues).filter(([, venue]) => venue.provision)) {
    const counts = teamCountsForVenue(index++);
    const exists = await m.Organization.findOne({ where: { slug } });
    report.push({ venue: venue.name, create: !exists, ...counts });
    if (!apply) continue;
    await sequelize.transaction(async transaction => {
      await sequelize.query('SELECT pg_advisory_xact_lock(7210923)', { transaction });
      const [location] = await m.Location.findOrCreate({ where: { id: stableId(`location:${slug}:${venue.addressLine1}`) }, defaults: {
        name: venue.name, addressLine1: venue.addressLine1, city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US', timezone: 'America/New_York',
        latitude: venue.latitude, longitude: venue.longitude, geo: { type: 'Point', coordinates: [venue.longitude, venue.latitude] }, privacy: 'public' }, transaction });
      const [org, created] = await m.Organization.findOrCreate({ where: { slug }, defaults: { id: stableId(`organization:${slug}`), name: venue.name, locationId: location.id, planTier: index % 2 ? 'free' : 'premium', description: `${venue.name} — Orlando demonstration organization.` }, transaction });
      if (!created) return; // Never rewrite existing staff or credentials on rerun.
      for (const role of ['owner', 'manager', 'employee']) {
        const count = role === 'owner' ? 1 : role === 'manager' ? counts.managers : counts.employees;
        for (let n = 1; n <= count; n++) {
          const email = `${slug}.${role}${n}@nitewide.test`;
          const [user, newUser] = await m.User.findOrCreate({ where: { email }, defaults: { id: stableId(`user:${email}`), displayName: `${first[(n + index * 2 + (role === 'employee' ? 3 : 0)) % first.length]} ${last[(index - 1) % last.length]}` }, transaction });
          if (newUser) await m.UserCredential.create({ userId: user.id, ...(await createPasswordRecord(demoPassword)) }, { transaction });
          if (role === 'employee') await m.OrganizationEmployee.create({ organizationId: org.id, userId: user.id }, { transaction });
          else await m.OrganizationOwner.create({ organizationId: org.id, userId: user.id, role: role === 'owner' ? 'owner' : 'admin' }, { transaction });
        }
      }
      await m.AuditLog.create({ organizationId: org.id, entityType: 'Organization', entityId: org.id, action: 'organization.demo_provisioned', after: { snapshotId: snapshot.snapshotId, ...counts } }, { transaction });
    });
  }
  return report;
}
module.exports = { mergeRoom22, provisionDemoVenues };
