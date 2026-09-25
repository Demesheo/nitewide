const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, cleanupFixture } = require('./admissions-fixture.cjs');
const { walletToken, guestlistWalletToken } = require('../src/domain/wallet-qr');

test('admissions HTTP: permissions, QR integrity, concurrent scans, manual entry, reports and customer passes', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const { signToken } = require('../src/services/auth-service');
  const config = getConfig(), sequelize = createSequelize(config), m = initModels(sequelize);
  let fixture, server;
  try {
    fixture = await createFixture(m, config);
    const { ids } = fixture;
    server = createApp({ sequelize, models: m, config }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, role = 'manager', body) {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${signToken({ sub: ids[role], exp: Math.floor(Date.now() / 1000) + 300 }, config.AUTH_TOKEN_SECRET)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, ...await response.json() };
    }
    const listPath = '/business/admissions/events';
    assert.equal((await request(listPath, null)).status, 401);
    for (const role of ['owner', 'manager', 'employee', 'promoter']) {
      const list = await request(listPath, role);
      assert.equal(list.status, 200, JSON.stringify(list));
      assert.ok(list.data.events.some((e) => e.id === ids.event));
      for (const excluded of ['future', 'expired', 'draft']) assert.ok(!list.data.events.some((e) => e.id === ids[excluded]));
      assert.equal((await request(`${listPath}/${ids.event}`, role)).data.expected, 5);
    }
    assert.equal((await request(listPath, 'outsider')).data.events.length, 0);
    assert.equal((await request(`${listPath}/${ids.event}`, 'outsider')).status, 403);
    assert.equal((await request(`${listPath}/${ids.otherEvent}`, 'promoter')).status, 403);
    const qrToken = walletToken(await m.Ticket.findByPk(ids.ticket), config.AUTH_TOKEN_SECRET);
    const scan = (token = qrToken, eventId = ids.event, role = 'manager') => request('/check-ins', role, { eventId, qrToken: token });
    assert.equal((await scan(qrToken, ids.event, 'guest')).status, 403);
    for (const token of ['not-a-pass', 'nw1.' + '-'.repeat(36) + '.' + 'a'.repeat(43), qrToken.slice(0, -3) + 'xxx']) assert.equal((await scan(token)).error.code, 'INVALID_CREDENTIAL');
    assert.equal((await scan(qrToken, ids.otherEvent)).error.code, 'INVALID_CREDENTIAL');
    assert.equal(await m.CheckIn.count({ where: { eventId: ids.event } }), 0);
    const simultaneous = await Promise.all([scan(qrToken, ids.event, 'promoter'), scan(qrToken, ids.event, 'employee')]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [201, 409]);
    assert.equal(simultaneous.find((r) => r.status === 409).error.code, 'CREDENTIAL_ALREADY_USED');
    assert.equal(await m.CheckIn.count({ where: { ticketId: ids.ticket } }), 1);
    assert.ok(!JSON.stringify(simultaneous).includes('qrTokenHash'));
    assert.equal((await scan(qrToken.slice(0, -3) + 'xxx')).error.code, 'INVALID_CREDENTIAL', 'forgeries do not reveal already-admitted state');
    const manual = await request('/check-ins', 'employee', { eventId: ids.event, credentialId: ids.manualTicket, kind: 'ticket' });
    assert.equal(manual.status, 201, JSON.stringify(manual));
    assert.equal(manual.data.checkIn.method, 'manual');
    assert.equal((await request('/check-ins', 'owner', { eventId: ids.event, credentialId: ids.manualTicket, kind: 'ticket' })).error.code, 'CREDENTIAL_ALREADY_USED');
    assert.equal((await request('/check-ins', 'owner', { eventId: ids.event, credentialId: ids.voidTicket, kind: 'ticket' })).error.code, 'INVALID_CREDENTIAL');
    const guestToken = guestlistWalletToken(await m.GuestlistEntry.findByPk(ids.entry), config.AUTH_TOKEN_SECRET);
    const guestResult = await scan(guestToken, ids.event, 'promoter');
    assert.equal(guestResult.status, 201, JSON.stringify(guestResult));
    assert.equal(guestResult.data.credential.spots, 3);
    assert.equal((await scan(guestToken)).error.code, 'CREDENTIAL_ALREADY_USED');
    const roster = await request(`${listPath}/${ids.event}`);
    assert.equal(roster.data.admitted, 5); assert.equal(roster.data.expected, 5);
    assert.equal(roster.data.entries.length, 3);
    for (const secret of ['qrToken', 'subtotalCents', 'totalCents', 'platformFeeCents', 'pricingPlanSnapshot']) assert.ok(!JSON.stringify(roster).includes(secret));
    assert.equal((await request(`${listPath}/${ids.event}?search=${ids.entry}`)).data.total, 1);
    assert.equal((await request(`${listPath}/${ids.event}?status=ready`)).data.total, 0);
    assert.equal((await request(`${listPath}/${ids.event}?search=%25`)).data.total, 0);
    const detail = await request(`/business/events/${ids.event}/detail`);
    assert.equal(detail.data.summary.checkedIn, 5);
    assert.equal(detail.data.summary.salesCents, 30000);
    const workspace = await request(`/business/workspace?organizationId=${ids.org}&days=7`);
    assert.equal(workspace.data.report.summary.checkedIn, 5);
    const analytics = await request(`/business/analytics?organizationIds=${ids.org}&days=7`);
    assert.equal(analytics.data.summary.checkedIn, 5);
    const customerRow = analytics.data.hierarchy.find((row) => row.level === 'customer' && row.buyerUserId === ids.guest);
    assert.equal(customerRow.checkedIn, 5);
    assert.equal(customerRow.admissions + customerRow.guestlistPlaces, 5);
    const guestlist = await request(`/business/events/${ids.event}/guestlist?status=checked_in`);
    assert.equal(guestlist.data.find((g) => g.id === ids.entry).status, 'checked_in');
    const passes = await request(`/customer/purchases/${ids.order}/tickets`, 'guest');
    assert.equal(passes.data.tickets.filter((t) => t.status === 'checked_in').length, 2);
    assert.equal((await request(`/customer/guestlists/${ids.entry}/pass`, 'guest')).data.tickets[0].status, 'checked_in');
    // Access is checked again for every action, including after removal.
    await m.EventAffiliate.update({ status: 'inactive' }, { where: { eventId: ids.event, userId: ids.promoter } });
    assert.equal((await scan(qrToken, ids.event, 'promoter')).status, 403);
    assert.equal((await request(listPath, 'promoter')).data.events.length, 0);
    // Database and time-window enforcement, independent of the event picker.
    await m.Event.update({ status: 'draft' }, { where: { id: ids.event } });
    assert.equal((await request(`${listPath}/${ids.event}`)).error.code, 'EVENT_NOT_OPEN');
    await m.Ticket.update({ status: 'valid' }, { where: { id: ids.voidTicket } });
    assert.equal((await request('/check-ins', 'manager', { eventId: ids.event, credentialId: ids.voidTicket, kind: 'ticket' })).error.code, 'EVENT_NOT_OPEN');
    await m.Event.update({ status: 'published', startsAt: new Date(Date.now() + 48 * 3600000), endsAt: new Date(Date.now() + 52 * 3600000) }, { where: { id: ids.event } });
    assert.equal((await request('/check-ins', 'manager', { eventId: ids.event, credentialId: ids.voidTicket, kind: 'ticket' })).error.code, 'EVENT_NOT_OPEN');
    assert.equal(await m.CheckIn.count({ where: { ticketId: ids.voidTicket } }), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (fixture) await cleanupFixture(m, fixture);
    await sequelize.close();
  }
});
