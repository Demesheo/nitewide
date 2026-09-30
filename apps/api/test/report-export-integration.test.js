const test = require('node:test');
const assert = require('node:assert/strict');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');
const { request: httpRequest } = require('./support/http-client.cjs');
const { reportDetailQuery } = require('../src/http/business-schemas');

test('scaled SQL reports and durable snapshot exports', { timeout: 180000 }, async (t) => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const { createBusinessReadService } = require('../src/services/business-read-service');
  const { createBusinessReportService } = require('../src/services/business-report-service');
  const { createReportExportService } = require('../src/services/report-export-service');
  const config = getConfig(); const db = createSequelize(config); const m = initModels(db);
  let server;
  try {
    const { ids } = await createFixture(m, config);
    const q = (sql, replacements = {}) => db.query(sql, { replacements, type: QueryTypes.SELECT });
    const read = createBusinessReadService({ models: m });
    const reports = createBusinessReportService({ models: m, businessRead: read });
    const exports = createReportExportService({ models: m, businessRead: read, reports });
    const app = createApp({ sequelize: db, models: m, config, services: { email: { enabled: false } } });
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
    const request = (url, actor = ids.owner) => httpRequest(server, url, { headers: { 'x-user-id': actor } });
    const baseInput = reportDetailQuery.parse({ organizationIds: [ids.org], days: 30, timezone: 'America/New_York', sort: 'sales_desc' });

    await t.test('small exports remain immediate and legacy business report routes are retired', async () => {
      await request('/api/business/workspace').expect(410);
      await request('/api/business/analytics').expect(410);
      const csv = await request(`/api/business/reports/export.csv?exportTable=events&organizationIds=${ids.org}`).expect(200).expect('Content-Type', /csv/);
      assert.match(csv.text, /Admissions QA Night/);
      assert.equal((await q('SELECT COUNT(*)::integer AS count FROM report_export_jobs'))[0].count, 0, 'immediate snapshot artifacts are cleaned up');
      const combined = await request(`/api/business/reports/export.csv?organizationIds=${ids.org}`).expect(200);
      assert.match(combined.text, /Daily/);
      await request('/api/admin/reports/export.csv').expect(403);
      await m.Event.update({ lifecycleState: 'archived' }, { where: { id: ids.event } });
      try {
        const csv = await request('/api/admin/reports/export.csv?exportTable=events', ids.admin).expect(200);
        assert.match(csv.text, /Admissions QA Night/);
        const options = (await request('/api/admin/reports/bootstrap', ids.admin).expect(200)).body.data;
        const missing = options.venues.find((venue) => venue.label === 'No event location');
        assert.ok(missing, 'historical events without locations remain reachable');
        const events = (await request(`/api/admin/reports/events?venueIds=${missing.id}`, ids.admin).expect(200)).body.data;
        assert.equal(events.total, 4);
      } finally { await m.Event.unscoped().update({ lifecycleState: 'active' }, { where: { id: ids.event } }); }
    });
    await t.test('concurrent submissions cannot exceed three preparing exports per account', async () => {
      const queuedService = createReportExportService({ models: m, businessRead: read, reports, smallLimit: 0 });
      const input = { ...baseInput, exportTable: 'events' };
      const response = () => ({ status() { return this; }, json() {} });
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => queuedService.request(ids.owner, input, response())));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
      assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'EXPORT_LIMIT').length, 1);
      assert.equal((await q("SELECT COUNT(*)::integer AS count FROM report_export_jobs WHERE user_id=:id AND status='queued'", { id: ids.owner }))[0].count, 3);
      const [{ id: failedId }] = await q(`INSERT INTO report_export_jobs(id,user_id,input,auth_stamp,status,created_at,updated_at,expires_at)
        SELECT gen_random_uuid(),user_id,input,auth_stamp,'failed',NOW(),NOW(),expires_at
        FROM report_export_jobs WHERE user_id=:id LIMIT 1 RETURNING id`, { id: ids.owner });
      await assert.rejects(queuedService.retry(ids.owner, failedId), { code: 'EXPORT_LIMIT' });
      await q('DELETE FROM report_export_jobs WHERE user_id=:id', { id: ids.owner });
    });
    // Representative reporting dataset exceeds every former business cap:
    // 1,200 additional events, 24,000 orders/items, 12,000 distinct buyers.
    await q(`INSERT INTO users(id,email,display_name)
      SELECT md5(:ns || ':buyer:' || n)::uuid, :ns || '.' || n || '@report.nitewide.test','Buyer ' || LPAD(n::text,5,'0')
      FROM generate_series(1,12000) n`, { ns: ids.org });
    await q(`INSERT INTO events(id,organization_id,creator_user_id,location_id,title,slug,status,starts_at,ends_at)
      SELECT md5(:ns || ':event:' || n)::uuid,:org,:owner,:loc,'Report event ' || n,:ns || '-report-' || n,
      'published',NOW()+INTERVAL '1 day',NOW()+INTERVAL '2 days' FROM generate_series(1,1200) n`, { ns: ids.org, org: ids.org, owner: ids.owner, loc: ids.location });
    const [offering] = await q('SELECT id FROM offerings WHERE event_id=:id LIMIT 1', { id: ids.event });
    await q(`INSERT INTO orders(id,event_id,buyer_user_id,status,currency,subtotal_cents,platform_fee_cents,total_cents,idempotency_key,paid_at)
      SELECT md5(:ns || ':order:' || n)::uuid,md5(:ns || ':event:' || ((n-1)%1200+1))::uuid,
      md5(:ns || ':buyer:' || ((n-1)%12000+1))::uuid,'paid','USD',100,10,110,:ns || '-' || n,NOW()
      FROM generate_series(1,24000) n`, { ns: ids.org });
    await q(`INSERT INTO order_items(order_id,offering_id,name_snapshot,kind_snapshot,quantity,entries_per_unit_snapshot,unit_price_cents,line_total_cents)
      SELECT md5(:ns || ':order:' || n)::uuid,:offering,'General admission','ticket',1,1,100,100
      FROM generate_series(1,24000) n`, { ns: ids.org, offering: offering.id });
    await db.query('ANALYZE events; ANALYZE orders; ANALYZE order_items; ANALYZE users; ANALYZE organization_owners;');

    await t.test('representative scale reconciles totals and PostgreSQL plans without raw record loading', async () => {
      const summary = await reports.summary(ids.owner, baseInput);
      assert.equal(summary.summary.orders, 24001);
      assert.equal(summary.summary.customers, 12001);
      assert.equal(summary.summary.salesCents, 2430000);
      assert.equal(summary.summary.units, 24001);
      assert.equal(summary.summary.events, 1205);
      const page = await reports.table(ids.owner, 'events', { ...baseInput, page: 49, pageSize: 25 });
      assert.equal(page.total, 1205); assert.equal(page.items.length, 5);
      for (const [label, prepare] of [['summary', () => reports.summaryQuery(ids.owner, baseInput)],
        ['customers', () => reports.prepareTable(ids.owner, 'customers', baseInput)],
        ['events', () => reports.prepareTable(ids.owner, 'events', baseInput)]]) {
        const plan = await prepare();
        const [result] = await q(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.sql}`, plan.values);
        const measured = result['QUERY PLAN'][0];
        const nodes = [];
        const visit = (node) => { nodes.push({ type: node['Node Type'], relation: node['Relation Name'],
          alias: node.Alias, rows: node['Actual Rows'], loops: node['Actual Loops'], estimatedRows: node['Plan Rows'],
          timeMs: node['Actual Total Time'] * node['Actual Loops'], removed: node['Rows Removed by Join Filter'] });
          (node.Plans || []).forEach(visit); };
        visit(measured.Plan);
        assert.ok(measured['Execution Time'] >= 0);
        t.diagnostic(`REPORT_PLAN ${JSON.stringify({ label, events: 1205, orders: 24001, buyers: 12001,
          executionMs: measured['Execution Time'], planningMs: measured['Planning Time'],
          actualRows: measured.Plan['Actual Rows'], sharedHitBlocks: measured.Plan['Shared Hit Blocks'],
          tempReadBlocks: measured.Plan['Temp Read Blocks'], tempWrittenBlocks: measured.Plan['Temp Written Blocks'],
          jitMs: measured.JIT?.Timing?.Total || 0, hotNodes: nodes.sort((a,b) => b.timeMs-a.timeMs).slice(0,12) })}`);
        if (label === 'summary') {
          await db.transaction(async (transaction) => {
            await db.query('SET LOCAL jit=off', { transaction });
            const [result] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.sql}`, { transaction, replacements: plan.values, type: QueryTypes.SELECT });
            const measured = result['QUERY PLAN'][0];
            t.diagnostic(`REPORT_PLAN ${JSON.stringify({ label: 'summary-jit-off', executionMs: measured['Execution Time'], tempReadBlocks: measured.Plan['Temp Read Blocks'], tempWrittenBlocks: measured.Plan['Temp Written Blocks'] })}`);
          });
        }
      }
    });
    let id;
    await t.test('large export queues, freezes rows once, and ignores purchases between batches', async () => {
      const queued = await request(`/api/business/reports/export.csv?exportTable=customers&organizationIds=${ids.org}`).expect(202);
      id = queued.body.data.id;
      assert.equal(queued.body.data.status, 'queued');
      await request(`/api/business/reports/exports/${id}/download`).expect(409);
      await request(`/api/business/reports/exports/${id}`, ids.outsider).expect(404);
      // Inject a real purchase after the first durable render checkpoint.
      const original = db.query.bind(db); let inserted = false;
      db.query = async (sql, options) => {
        const result = await original(sql, options);
        if (!inserted && typeof sql === 'string' && sql.startsWith('SELECT sequence,section,payload')) {
          inserted = true;
          await m.Order.create({ eventId: ids.event, buyerUserId: ids.pendingGuest, status: 'paid',
            paidAt: new Date(), subtotalCents: 999999, totalCents: 999999, idempotencyKey: 'snapshot-concurrent-purchase' });
          await m.Order.update({ subtotalCents: 888888 }, { where: { id: ids.order } });
        }
        return result;
      };
      try { assert.equal(await exports.drain(), true); }
      finally { db.query = original; }
      assert.equal(inserted, true);
      const ready = await request(`/api/business/reports/exports/${id}`).expect(200);
      assert.equal(ready.body.data.status, 'ready'); assert.equal(ready.body.data.progress, 100);
      assert.equal(ready.body.data.totalRows, 12001);
      const csv = await request(`/api/business/reports/exports/${id}/download`).expect(200);
      const rows = csv.text.trim().split(/\r?\n/);
      assert.equal(rows.length, 12002);
      assert.equal(new Set(rows.slice(1).map((row) => row.split(',')[0])).size, 12001);
      assert.match(csv.text, /"300\.00"/);
      assert.doesNotMatch(csv.text, /9999\.99|8888\.88/);
      assert.equal((await q('SELECT COUNT(*)::integer AS count FROM report_export_rows WHERE job_id=:id', { id }))[0].count, 0, 'completed jobs retain only downloadable CSV chunks');
    });
    await t.test('revoked access cannot read a previously prepared download, and expiry cleans durable data', async () => {
      await m.OrganizationOwner.update({ lifecycleState: 'suspended' }, { where: { userId: ids.owner, organizationId: ids.org } });
      await request(`/api/business/reports/exports/${id}/download`).expect(403);
      await m.OrganizationOwner.unscoped().update({ lifecycleState: 'active' }, { where: { userId: ids.owner, organizationId: ids.org } });
      await request(`/api/business/reports/exports/${id}/download`).expect(200);
      await q("UPDATE report_export_jobs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id", { id });
      await request(`/api/business/reports/exports/${id}`).expect(404);
      await q("UPDATE report_export_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=:id", { id });
      await exports.drain();
      assert.equal((await q('SELECT COUNT(*)::integer AS count FROM report_export_chunks WHERE job_id=:id', { id }))[0].count, 0);
    });
    await t.test('failed jobs retry from a durable checkpoint without duplicating chunks or rows', async () => {
      const job = (await request(`/api/business/reports/export.csv?exportTable=customers&organizationIds=${ids.org}`).expect(202)).body.data;
      const original = db.query.bind(db); let batches = 0;
      db.query = async (sql, options) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT sequence,section,payload') && ++batches === 2) throw new Error('Simulated interrupted rendering');
        return original(sql, options);
      };
      try { await assert.rejects(exports.drain(), /Simulated interrupted/); }
      finally { db.query = original; }
      const failed = (await request(`/api/business/reports/exports/${job.id}`).expect(200)).body.data;
      assert.equal(failed.status, 'failed'); assert.equal(failed.processedRows, 250);
      await httpRequest(server, `/api/business/reports/exports/${job.id}/retry`, { method: 'POST', headers: { 'x-user-id': ids.owner } }).expect(200);
      const competitor = createReportExportService({ models: m, businessRead: read, reports });
      const results = await Promise.all([exports.drain(), competitor.drain()]);
      assert.equal(results.filter(Boolean).length, 1, 'only one worker owns the durable job');
      const csv = (await request(`/api/business/reports/exports/${job.id}/download`).expect(200)).text.trim().split(/\r?\n/);
      assert.equal(csv.length, 12003);
      assert.equal(new Set(csv.slice(1).map((row) => row.split(',')[0])).size, 12002);
      assert.equal(csv.filter((row) => row.startsWith('"Customer","Email"')).length, 1);
      // A download begun before expiry must retain all chunks if cleanup runs
      // between batches. New requests after expiry still receive 404.
      const downloadQuery = db.query.bind(db); let expired = false;
      db.query = async (sql, options) => {
        const value = await downloadQuery(sql, options);
        if (!expired && typeof sql === 'string' && sql.startsWith('SELECT sequence,content')) {
          expired = true;
          await downloadQuery("UPDATE report_export_jobs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id", { replacements: { id: job.id } });
          await exports.drain();
        }
        return value;
      };
      try {
        const pinned = await request(`/api/business/reports/exports/${job.id}/download`).expect(200);
        assert.equal(pinned.text.trim().split(/\r?\n/).length, 12003);
      } finally { db.query = downloadQuery; }
      assert.equal(expired, true);
      await request(`/api/business/reports/exports/${job.id}/download`).expect(404);
      await q("UPDATE report_export_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=:id", { id: job.id });
      await exports.drain();
      assert.equal((await q('SELECT COUNT(*)::integer AS count FROM report_export_chunks WHERE job_id=:id', { id: job.id }))[0].count, 0);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
