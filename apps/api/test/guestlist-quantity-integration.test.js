const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Op } = require('sequelize');
const { createFixture, cleanupFixture } = require('./admissions-fixture.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createEmailService, decryptVariables } = require('../src/services/email-service');
const { createGuestlistService } = require('../src/services/guestlist-service');
const { guestlistPassToken, guestlistWalletToken } = require('../src/domain/wallet-qr');
const { conflict } = require('../src/domain/errors');
const { contractFor } = require('../src/http/api-contract');

test('customer requests, adjusted approvals in both apps, passes, outbox, capacity, and rollback share one quantity', { timeout: 60000 }, async (t) => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const db = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(db);
  const encryptionKey = 'mock-only-guestlist-quantity-outbox';
  let providerCalls = 0, fixture;
  try {
    fixture = await createFixture(m, config);
    const { ids } = fixture;
    for (const actor of ['guest', 'pendingGuest', 'outsider']) await m.User.update({ email: `delivered+${ids[actor]}@resend.dev` }, { where: { id: ids[actor] } });
    const email = createEmailService({ sequelize: db, models: m, apiKey: 'mock-only', from: 'onboarding@resend.dev', encryptionKey, testMode: true,
      fetchImpl: async () => { providerCalls += 1; throw new Error('This suite must only queue mail'); } });
    const app = require('../src/app').createApp({ sequelize: db, models: m, config, services: { email } });
    const api = (method, path, actor = 'manager') => request(app)[method](`/api${path}`).set('x-user-id', ids[actor]);
    const decisionPath = (app, eventId, entryId) => `${app === 'customer' ? '/customer/my-events' : '/business/events'}/${eventId}/guestlist/${entryId}/decision`;
    const decide = (app, eventId, entryId, body, actor = 'manager') => api('post', decisionPath(app, eventId, entryId), actor).send(body);
    const snapshot = async (entryId) => {
      const [entry, passes, audits, notifications, mail] = await Promise.all([
        m.GuestlistEntry.findByPk(entryId, { raw: true }),
        m.GuestlistPass.count({ where: { guestlistEntryId: entryId } }),
        m.AuditLog.count({ where: { entityType: 'GuestlistEntry', entityId: entryId } }),
        m.Notification.count({ where: { metadata: { entryId } } }),
        m.EmailOutbox.count({ where: { dedupeKey: { [Op.like]: `guestlist/${entryId}/%` } } }),
      ]);
      return { entry, passes, audits, notifications, mail };
    };
    const assertApprovedQuantity = async (entryId, eventId, actor, partySize, requestedPartySize) => {
      const entry = await m.GuestlistEntry.findByPk(entryId);
      assert.equal(entry.partySize, partySize); assert.equal(entry.status, 'confirmed');
      const passes = await m.GuestlistPass.findAll({ where: { guestlistEntryId: entryId }, order: [['position', 'ASC']] });
      assert.deepEqual(passes.map((pass) => pass.position), Array.from({ length: partySize }, (_, index) => index + 1));
      assert.equal(new Set(passes.map((pass) => pass.qrTokenHash)).size, partySize);
      const wallet = (await api('get', `/customer/guestlists/${entryId}/pass`, actor).expect(200)).body.data;
      assert.equal(wallet.partySize, partySize); assert.equal(wallet.tickets.length, partySize);
      assert.equal(new Set(wallet.tickets.map((ticket) => ticket.qrImage)).size, partySize);
      assert.ok(wallet.tickets.every((ticket) => ticket.spots === 1 && ticket.qrImage?.startsWith('data:image/png')));
      const audit = await m.AuditLog.findOne({ where: { entityType: 'GuestlistEntry', entityId: entryId, action: 'guestlist.approved' }, order: [['createdAt', 'DESC']] });
      assert.deepEqual(audit.before, { status: 'pending', partySize: requestedPartySize });
      assert.deepEqual(audit.after, { status: 'confirmed', partySize });
      const notification = await m.Notification.findOne({ where: { userId: ids[actor], eventId, kind: 'guestlist_approved' }, order: [['createdAt', 'DESC']] });
      const event = await m.Event.findByPk(eventId);
      assert.equal(notification.message, `You were approved for ${partySize} ${partySize === 1 ? 'spot' : 'spots'} on the guestlist for ${event.title}.`);
      assert.equal(notification.metadata.partySize, partySize);
      const key = `guestlist/${entryId}/approved/${new Date(entry.reviewedAt).getTime()}`;
      const outbox = await m.EmailOutbox.findOne({ where: { dedupeKey: key } });
      assert.equal(outbox.status, 'pending'); assert.equal(outbox.templateAlias, 'nitewide-guestlist-approved');
      assert.equal(decryptVariables(outbox.encryptedVariables, encryptionKey).SPOTS, String(partySize));
      assert.equal(await m.EmailOutbox.count({ where: { dedupeKey: key } }), 1);
      return { entry, passes, wallet };
    };
    let businessEntry, customerEntry, pendingEntry;

    await t.test('public submissions and customer pending edits accept one through five and persist validation failures unchanged', async () => {
      for (const partySize of [0, -1, 1.5, 6, 20, 21, '4', null]) await api('post', `/events/${ids.event}/guestlist`, 'outsider').send({ partySize }).expect(422);
      assert.equal(await m.GuestlistEntry.count({ where: { eventId: ids.event, userId: ids.outsider } }), 0);
      businessEntry = (await api('post', `/events/${ids.event}/guestlist`, 'outsider').send({ partySize: 5 }).expect(202)).body.data.entry.id;
      pendingEntry = (await m.GuestlistEntry.findOne({ where: { eventId: ids.event, userId: ids.pendingGuest } })).id;
      for (const partySize of [1, 5]) {
        const edited = await api('patch', `/customer/guestlists/${pendingEntry}`, 'pendingGuest').send({ partySize }).expect(200);
        assert.equal(edited.body.data.entry.partySize, partySize);
      }
      const before = await snapshot(pendingEntry);
      for (const partySize of [0, 1.5, 6, 20, 21, '4', null]) await api('patch', `/customer/guestlists/${pendingEntry}`, 'pendingGuest').send({ partySize }).expect(422);
      assert.deepEqual(await snapshot(pendingEntry), before);
      await api('patch', `/customer/guestlists/${pendingEntry}`, 'outsider').send({ partySize: 4 }).expect(404);
      const status = (await api('get', `/customer/events/${ids.event}/guestlist`, 'pendingGuest').expect(200)).body.data;
      assert.equal(status.maxPartySize, 5); assert.equal(status.entry.partySize, 5);
    });

    await t.test('invalid adjustments and unauthorized reviewers fail before quantity or side effects change', async () => {
      const before = await snapshot(businessEntry);
      for (const app of ['business', 'customer']) {
        for (const partySize of [0, -1, 1.5, 21, '4', null]) await decide(app, ids.event, businessEntry, { decision: 'approve', partySize }).expect(422);
        for (const decision of ['reject', 'cancel']) await decide(app, ids.event, businessEntry, { decision, partySize: 4 }).expect(422);
        await decide(app, ids.event, businessEntry, { decision: 'approve', partySize: 4 }, 'promoter').expect(403);
        await decide(app, ids.event, businessEntry, { decision: 'approve', partySize: 4 }, 'outsider').expect(403);
      }
      assert.deepEqual(await snapshot(businessEntry), before);
    });

    await t.test('Business approval changes five requested spots to four separate single-use passes and approved-count messaging', async () => {
      const response = await decide('business', ids.event, businessEntry, { decision: 'approve', partySize: 4, note: 'Approved four spots' }).expect(200);
      assert.equal(response.body.data.entry.partySize, 4);
      const approved = await assertApprovedQuantity(businessEntry, ids.event, 'outsider', 4, 5);
      const before = await snapshot(businessEntry);
      await decide('business', ids.event, businessEntry, { decision: 'approve', partySize: 1 }).expect(409);
      await api('patch', `/customer/guestlists/${businessEntry}`, 'outsider').send({ partySize: 1 }).expect(409);
      assert.deepEqual(await snapshot(businessEntry), before);
      await api('post', '/check-ins').send({ eventId: ids.event, qrToken: guestlistWalletToken(approved.entry, config.QR_TOKEN_SECRET) }).expect(422);
      const token = guestlistPassToken(approved.passes[0], approved.entry, config.QR_TOKEN_SECRET);
      const scanned = await api('post', '/check-ins').send({ eventId: ids.event, qrToken: token }).expect(201);
      assert.equal(scanned.body.data.credential.spots, 1);
      await api('post', '/check-ins').send({ eventId: ids.event, qrToken: token }).expect(409);
      assert.equal((await approved.entry.reload()).checkedInSpots, 1);
      await decide('business', ids.event, businessEntry, { decision: 'cancel' }).expect(409);
    });

    await t.test('My events forwards the same adjustment and returns four customer wallet passes', async () => {
      customerEntry = (await api('post', `/events/${ids.otherEvent}/guestlist`, 'guest').send({ partySize: 5 }).expect(202)).body.data.entry.id;
      const response = await decide('customer', ids.otherEvent, customerEntry, { decision: 'approve', partySize: 4 }).expect(200);
      assert.equal(response.body.data.entry.partySize, 4); assert.equal('qrTokenHash' in response.body.data.entry, false);
      const wire = contractFor({ method: 'post', path: '/customer/my-events/:eventId/guestlist/:entryId/decision', authenticated: true });
      assert.equal(wire.responseSchemas[200].safeParse(response.body).success, true);
      await assertApprovedQuantity(customerEntry, ids.otherEvent, 'guest', 4, 5);
    });

    await t.test('capacity uses the approved count and failed direct or affiliate approvals leave all state unchanged', async () => {
      const before = await snapshot(pendingEntry);
      await decide('business', ids.event, pendingEntry, { decision: 'approve', partySize: 4 }).expect(409);
      assert.deepEqual(await snapshot(pendingEntry), before);
      await decide('customer', ids.event, pendingEntry, { decision: 'approve', partySize: 3 }).expect(200);
      await assertApprovedQuantity(pendingEntry, ids.event, 'pendingGuest', 3, 5);
      const affiliate = await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } });
      const referred = await m.GuestlistEntry.create({ eventId: ids.event, userId: ids.owner, source: 'affiliate', eventAffiliateId: affiliate.id, status: 'pending', partySize: 5 });
      const referredBefore = await snapshot(referred.id);
      const full = await decide('customer', ids.event, referred.id, { decision: 'approve', partySize: 6 }, 'promoter').expect(409);
      assert.equal(full.body.error.code, 'AFFILIATE_GUESTLIST_FULL');
      assert.deepEqual(await snapshot(referred.id), referredBefore);
      await decide('business', ids.event, referred.id, { decision: 'approve', partySize: 4 }, 'promoter').expect(200);
      assert.equal((await referred.reload()).partySize, 4);
      assert.equal(await m.GuestlistPass.count({ where: { guestlistEntryId: referred.id } }), 4);
    });

    await t.test('legacy pending requests keep twenty spots and staff invitations still allow twenty', async () => {
      await m.Event.update({ guestlistCapacity: 100 }, { where: { id: ids.future } });
      const legacy = await m.GuestlistEntry.create({ eventId: ids.future, userId: ids.owner, source: 'event', status: 'pending', partySize: 20 });
      const status = (await api('get', `/customer/events/${ids.future}/guestlist`, 'owner').expect(200)).body.data;
      assert.equal(status.entry.partySize, 20); assert.equal(status.maxPartySize, 5);
      await decide('customer', ids.future, legacy.id, { decision: 'approve' }).expect(200);
      assert.equal((await legacy.reload()).partySize, 20);
      assert.equal(await m.GuestlistPass.count({ where: { guestlistEntryId: legacy.id } }), 20);
      const legacyAudit = await m.AuditLog.findOne({ where: { entityId: legacy.id, action: 'guestlist.approved' } });
      assert.equal(legacyAudit.before.partySize, 20); assert.equal(legacyAudit.after.partySize, 20);
      for (const prefix of ['/business/events', '/customer/my-events']) {
        const invitation = (await api('post', `${prefix}/${ids.future}/guestlist-invitations`).send({ pool: 'direct', inviteBy: 'personal', name: `Twenty invited spots ${prefix}`, partySize: 20 }).expect(201)).body.data;
        assert.equal(invitation.invitation.partySize, 20);
        assert.equal(await m.GuestlistPass.count({ where: { guestlistEntryId: invitation.entryId } }), 20);
      }
    });

    await t.test('revocation preserves quantities and reapproval reconciles the exact pass count while invalidating old codes', async () => {
      const original = await m.GuestlistEntry.findByPk(customerEntry);
      const firstPass = await m.GuestlistPass.findOne({ where: { guestlistEntryId: customerEntry, position: 1 } });
      const oldCode = guestlistPassToken(firstPass, original, config.QR_TOKEN_SECRET);
      await decide('customer', ids.otherEvent, customerEntry, { decision: 'cancel' }).expect(200);
      assert.equal((await original.reload()).partySize, 4);
      const unavailable = (await api('get', `/customer/guestlists/${customerEntry}/pass`, 'guest').expect(200)).body.data;
      assert.ok(unavailable.tickets.every((ticket) => !ticket.qrImage));
      await decide('business', ids.otherEvent, customerEntry, { decision: 'approve', partySize: 1 }).expect(200);
      assert.equal(await m.GuestlistPass.count({ where: { guestlistEntryId: customerEntry } }), 1);
      assert.equal((await m.GuestlistPass.findOne({ where: { guestlistEntryId: customerEntry } })).id, firstPass.id);
      await decide('business', ids.otherEvent, customerEntry, { decision: 'cancel' }).expect(200);
      await decide('customer', ids.otherEvent, customerEntry, { decision: 'approve', partySize: 6 }).expect(200);
      const wallet = (await api('get', `/customer/guestlists/${customerEntry}/pass`, 'guest').expect(200)).body.data;
      assert.equal(wallet.partySize, 6); assert.equal(wallet.tickets.length, 6);
      await api('post', '/check-ins').send({ eventId: ids.otherEvent, qrToken: oldCode }).expect(422);
    });

    await t.test('competing adjusted approvals cannot consume the same remaining direct spots', async () => {
      const entries = [];
      for (const actor of ['pendingGuest', 'outsider']) entries.push((await api('post', `/events/${ids.otherEvent}/guestlist`, actor).send({ partySize: 1 }).expect(202)).body.data.entry.id);
      const responses = await Promise.all(entries.map((entryId, index) => decide(index ? 'customer' : 'business', ids.otherEvent, entryId, { decision: 'approve', partySize: 4 })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      for (let index = 0; index < entries.length; index += 1) {
        const state = await snapshot(entries[index]), won = responses[index].status === 200;
        assert.equal(state.entry.partySize, won ? 4 : 1); assert.equal(state.entry.status, won ? 'confirmed' : 'pending');
        assert.equal(state.passes, won ? 4 : 0);
        assert.equal(state.audits, won ? 2 : 1); assert.equal(state.mail, won ? 2 : 1);
      }
      assert.equal(await m.GuestlistEntry.sum('partySize', { where: { eventId: ids.otherEvent, status: 'confirmed', eventAffiliateId: null } }), 10);
    });

    await t.test('a failure after notification and outbox creation rolls back the quantity, credentials, audit, and messages', async () => {
      const entryId = (await api('post', `/events/${ids.future}/guestlist`, 'pendingGuest').send({ partySize: 2 }).expect(202)).body.data.entry.id;
      const before = await snapshot(entryId);
      const service = createGuestlistService({ sequelize: db, models: m, email });
      await assert.rejects(service.review({ eventId: ids.future, entryId, reviewedByUserId: ids.manager, decision: 'approve', partySize: 4 }, {
        onReviewed: async () => { throw conflict('Rollback after all approval writes', 'TEST_ROLLBACK'); },
      }), { code: 'TEST_ROLLBACK' });
      assert.deepEqual(await snapshot(entryId), before);
    });
    assert.equal(providerCalls, 0, 'no provider delivery is attempted');
  } finally {
    if (fixture) await cleanupFixture(m, fixture);
    await db.close();
  }
});
