const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');
const { reportDetailQuery } = require('../src/http/admin-report-schemas');
test('platform reporting and support preserve canonical scopes, snapshots, finances, and authorization', { timeout: 90000 },async t => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const { createPermissionService } = require('../src/services/permission-service');
  const { createBusinessReadService } = require('../src/services/business-read-service');
  const { createAdminReportService } = require('../src/services/admin-report-service');
  const { createBusinessReportService } = require('../src/services/business-report-service');
  const { createReportExportService } = require('../src/services/report-export-service');
  const config = getConfig(),db = createSequelize(config),m = initModels(db);
  try {
    const { ids } = await createFixture(m,config, { orderValues: { paidAt: '2026-03-08T06:00:00Z',subtotalCents: 4000,platformFeeCents: 400,totalCents: 4400,
      pricingPlanSnapshot: { demo: true,pricingDecision: { processingCents: 160,contributionCents: 240 } } }, itemValues: { lineTotalCents: 3000,unitPriceCents: 3000 } });
    const supportAdmin = await m.User.create({ email: `${randomUUID()}@support.nitewide.test`,displayName: 'Support staff',isInternalAdmin: true,internalAdminRole: 'support' });
    const reader = await m.User.create({ email: `${randomUUID()}@support.nitewide.test`,displayName: 'Read-only staff',isInternalAdmin: true,internalAdminRole: 'read_only' });
    const zero = await m.Organization.create({ name: 'Zero event workspace',slug: `zero-${randomUUID()}` });
    const firstOffering = await m.Offering.findOne({ where: { eventId: ids.event } });
    const secondOffering = await m.Offering.create({ eventId: ids.event,name: firstOffering.name,kind: 'ticket',priceCents: 1000,inventoryMode: 'unlimited' });
    const otherOffering = await m.Offering.create({ eventId: ids.otherEvent,name: firstOffering.name,kind: 'package',priceCents: 2000,inventoryMode: 'unlimited' });
    await m.OrderItem.create({ orderId: ids.order,offeringId: secondOffering.id,nameSnapshot: firstOffering.name,kindSnapshot: 'ticket',quantity: 1,
      entriesPerUnitSnapshot: 1,lineTotalCents: 1000,unitPriceCents: 1000 });
    const createOrder = async paidAt => {
      const order = await m.Order.create({ eventId: ids.otherEvent,buyerUserId: ids.guest,status: 'paid',paidAt,subtotalCents: 2000,
        platformFeeCents: 300,totalCents: 2300,idempotencyKey: randomUUID() });
      await m.OrderItem.create({ orderId: order.id,offeringId: otherOffering.id,nameSnapshot: firstOffering.name,kindSnapshot: 'package',quantity: 1,
        entriesPerUnitSnapshot: 1,lineTotalCents: 2000,unitPriceCents: 2000 }); return order;
    };
    const inRange = await createOrder('2026-03-09T03:59:59Z');
    await createOrder('2026-03-09T04:00:00Z');
    await createOrder('2026-03-08T04:59:59Z');
    const permissions = createPermissionService(m),read = createBusinessReadService({ models: m });
    const reports = createAdminReportService({ models: m,permissions,businessRead: read });
    const query = reportDetailQuery.parse({ startDate: '2026-03-08',endDate: '2026-03-08',timezone: 'America/New_York',pageSize: 1 });
    const app = createApp({ sequelize: db,models: m,config,services: { email: { enabled: false } } });
    const api = (method,path,userId = ids.admin) => request(app)[method](`/api${path}`).set('x-user-id',userId);
    await t.test('zero-event directory and canonical drilldowns count mixed orders and unique buyers once',async () => {
      const bootstrap = await reports.bootstrap(ids.admin);
      assert.ok(bootstrap.organizations.some(row => row.id === zero.id));
      const businesses = await reports.table(ids.admin,'businesses',{ ...query,pageSize: 100 });
      assert.equal(businesses.total,3, 'the two organizations and explicitly provisioned legacy creator appear in the directory');
      assert.equal(businesses.items.find(row => row.creatorUserId === ids.independentCreator).businessType,'legacy_creator');
      assert.equal(businesses.items.find(row => row.id === zero.id).events,0);
      const row = businesses.items.find(row => row.id === ids.org);
      assert.equal(row.salesCents,6000); assert.equal(row.addedBuyerFeesCents,700); assert.equal(row.orders,2); assert.equal(row.customers,1);
      const summary = await reports.summary(ids.admin,query);
      assert.equal(summary.summary.salesCents,6000); assert.equal(summary.summary.orders,2); assert.equal(summary.summary.customers,1);
      assert.equal(summary.financial.addedBuyerFeesCents,700); assert.equal(summary.financial.customerPaidCents,6700);
      assert.equal(summary.financial.modeledProcessingCents,null); assert.equal(summary.financial.modeledOrders,1);
      assert.equal(summary.financial.unknownModeledOrders,1); assert.equal(summary.financial.providerConfirmedApplicationFeesCents,null);
      assert.equal(Date.parse(summary.range.until)-Date.parse(summary.range.since),23*3600000);
      const offerings = await reports.table(ids.admin,'offerings',{ ...query,pageSize: 100 });
      assert.equal(offerings.total,3); assert.equal(new Set(offerings.items.map(row => row.id)).size,3);
      assert.ok(offerings.items.every(row => row.id === row.offeringId && row.eventId));
      const selected = { ...query,offeringId: firstOffering.id };
      const detail = await reports.summary(ids.admin,selected);
      assert.equal(detail.summary.salesCents,3000); assert.equal(detail.summary.commissionCents,null);
      assert.equal(detail.financial.addedBuyerFeesCents,400); assert.equal(detail.financial.modeledProcessingCents,160);
      assert.equal(detail.financial.feeBasis,'selected_orders_not_allocated_to_offering');
      const purchases = await reports.table(ids.admin,'purchases',selected);
      assert.equal(purchases.total,1); assert.equal(purchases.items[0].orderId,ids.order); assert.equal(purchases.items[0].items.length,1);
      const eventRows = await reports.table(ids.admin,'events',{ ...query,businessId: ids.org,pageSize: 100 });
      assert.ok(eventRows.items.every(row => row.eventId === row.id && row.businessId === ids.org));
      assert.equal((await reports.table(ids.admin,'purchases',{ ...query,businessId: zero.id })).total,0);
      assert.equal((await reports.summary(ids.admin,{ ...query,customerId: ids.outsider })).summary.salesCents,0);
      await api('get','/admin/reports/purchases',ids.owner).expect(403);
      await api('get','/admin/reports/purchases',supportAdmin.id).expect(403);
      await api('get','/admin/reports/purchases',reader.id).query({ startDate: '2026-03-08',endDate: '2026-03-08' }).expect(200);
    });
    await t.test('the export captures the whole filtered snapshot even when the report page has one row',async () => {
      const businessReports = createBusinessReportService({ models: m,businessRead: read });
      const exports = createReportExportService({ models: m,businessRead: read,reports: businessReports,historicalReports: reports.reports,smallLimit: 0 });
      let job;
      await exports.request(ids.admin,{ ...query,audience: 'admin',exportTable: 'purchases' },{ status(code) { assert.equal(code,202); return this; },json(body) { job = body.data; } });
      assert.equal(job.totalRows,2); assert.match(job.downloadUrl,/^\/admin\/reports\/exports\//);
      await exports.drain();
      const frozen = await exports.status(ids.admin,job.id);
      assert.equal(frozen.status,'ready'); assert.equal(frozen.totalRows,2);
      await m.Event.update({ lifecycleState: 'archived' },{ where: { id: ids.otherEvent } });
      assert.equal((await exports.status(ids.admin,job.id)).status,'ready','global admin authority is independent of later event archival');
      await assert.rejects(m.Order.update({ subtotalCents: 99999 },{ where: { id: inRange.id } }), /immutable/);
      await m.User.update({ displayName: 'Customer renamed after export snapshot' }, { where: { id: ids.guest } });
      let csv = '';
      await exports.download(ids.admin,job.id,{ destroyed: false,set() {},write(value) { csv += value; return true; },end() {} });
      assert.match(csv,new RegExp(ids.order)); assert.match(csv,new RegExp(inRange.id)); assert.doesNotMatch(csv,/999.99|Customer renamed after export snapshot/);
      assert.equal(csv.trim().split('\r\n').length,3);
      await m.User.update({ displayName: 'Admissions QA guest' }, { where: { id: ids.guest } });
      await m.Event.update({ lifecycleState: 'active' },{ where: { id: ids.otherEvent } });
      await m.User.update({ isInternalAdmin: false },{ where: { id: ids.admin } });
      await assert.rejects(exports.status(ids.admin,job.id),{ code: 'FORBIDDEN' });
      await m.User.update({ isInternalAdmin: true },{ where: { id: ids.admin } });
      await exports.stop();
    });
    await t.test('cases require scoped links, versioned reasons and resolutions while attention excludes guestlist work',async () => {
      const created = await api('post','/admin/support/cases',supportAdmin.id).send({ title: 'Paid booking admission problem',description: 'Customer cannot scan their valid booking',
        category: 'admission',orderId: ids.order,assignedAdminUserId: supportAdmin.id,reason: 'Customer at door requested help' }).expect(201);
      const caseId = created.body.data.id;
      assert.equal(created.body.data.customerUserId,ids.guest); assert.equal(created.body.data.organizationId,ids.org); assert.equal(created.body.data.priority,'high');
      await api('post','/admin/support/cases',reader.id).send({ title: 'Access failure',description: 'Unable to login',category: 'account_access',reason: 'Asked for help' }).expect(403);
      await api('post','/admin/support/cases').send({ title: 'Mismatched purchase',description: 'Wrong customer link',category: 'paid_booking',orderId: ids.order,customerUserId: ids.outsider,reason: 'Testing scope enforcement' }).expect(409);
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 0,status: 'closed',resolution: 'Fixed',reason: 'Attempt direct close' }).expect(409);
      const started = await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 0,status: 'in_progress',reason: 'Checking admission status' }).expect(200);
      assert.equal(started.body.data.version,1);
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 0,status: 'resolved',resolution: 'Validated ticket',reason: 'Stale update attempt' }).expect(409);
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 1,status: 'resolved',reason: 'Missing resolution' }).expect(409);
      const attention = (await api('get','/admin/overview/needs-attention',reader.id).expect(200)).body.data;
      assert.equal(attention.counts.support_case,1); assert.equal(attention.items[0].recordId,caseId);
      assert.ok(attention.items.every(row => row.kind !== 'pending_guestlist'));
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 1,status: 'resolved',resolution: 'Verified valid admission and admitted attendee',reason: 'Door staff confirmed entry' }).expect(200);
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 2,status: 'closed',reason: 'Customer confirmed completion' }).expect(200);
      await api('patch',`/admin/support/cases/${caseId}`,supportAdmin.id).send({ version: 3,status: 'open',reason: 'Attempt reopening historical case' }).expect(409);
      const detail = (await api('get',`/admin/support/cases/${caseId}`,reader.id).expect(200)).body.data;
      assert.equal(detail.history.length,4); assert.ok(detail.history.every(row => row.after.adminReason));
      const historyPage = (await api('get',`/admin/support/cases/${caseId}/history`,reader.id).query({ page: 2,pageSize: 2 }).expect(200)).body.data;
      assert.equal(historyPage.total,4); assert.equal(historyPage.items.length,2); assert.equal(historyPage.hasMore,false);
      assert.notEqual(historyPage.items[0].id,detail.history[0].id);
      assert.equal((await api('get','/admin/overview/needs-attention').expect(200)).body.data.total,0);
      const archived = await m.SupportCase.findByPk(caseId); assert.equal(archived.status,'closed');
      await api('get','/admin/support/cases',ids.owner).expect(403);
      await m.User.update({ isInternalAdmin: false },{ where: { id: supportAdmin.id } });
      await api('post','/admin/support/cases',supportAdmin.id).send({ title: 'Access issue',description: 'Help requested',category: 'account_access',reason: 'Revoked staff write' }).expect(403);
    });
    await t.test('attention joins actionable platform failures with pending invitations and orders',async () => {
      await m.OnboardingInvitation.create({ userId: ids.outsider,invitedByUserId: ids.admin,email: `${ids.outsider}@offline.nitewide.test`,accountMode: 'existing',
        grants: { kind: 'organization',organizationId: ids.org },tokenHash: randomUUID().replaceAll('-','').repeat(2),expiresAt: new Date(Date.now()-1000) });
      await m.EmailOutbox.create({ dedupeKey: `failed/${randomUUID()}`,recipientEmail: 'blocked@offline.nitewide.test',templateAlias: 'booking-confirmation',status: 'failed',lastError: 'ATTEMPTS_EXHAUSTED' });
      await m.MediaAsset.create({ uploadedByUserId: ids.admin,storageKey: `${randomUUID()}.webp`,mimeType: 'image/webp',sizeBytes: 100,width: 10,height: 10,
        cleanupAfter: new Date(Date.now()-1000),lastStorageError: 'STORAGE_UNAVAILABLE' });
      await m.NotificationJob.create({ orderId: ids.order,payload: {},status: 'failed',availableAt: new Date(),lastError: 'Fan-out failed' });
      await db.query(`INSERT INTO report_export_jobs(id,user_id,input,auth_stamp,status,created_at,updated_at,expires_at)
        VALUES (:id,:userId,'{}','fixture','failed',NOW(),NOW(),NOW()+INTERVAL '1 day')`,{ replacements: { id: randomUUID(),userId: ids.admin } });
      const attention = (await api('get','/admin/overview/needs-attention',reader.id).query({ pageSize: 100 }).expect(200)).body.data;
      assert.equal(attention.total,5);
      for (const kind of ['onboarding','email_failure','media_failure','notification_failure','export_failure']) assert.equal(attention.counts[kind],1);
      assert.equal(attention.items[0].kind,'notification_failure');
      assert.equal(attention.items[0].organizationId,ids.org); assert.equal(attention.items[0].customerUserId,ids.guest);
      assert.equal((await api('get','/admin/overview/needs-attention').query({ kind: 'export_failure' }).expect(200)).body.data.items.length,1);
    });
    await t.test('bootstrap options are bounded while the authoritative directory remains fully paginated',async () => {
      await m.Organization.bulkCreate(Array.from({ length: 105 },(_,index) => ({ name: `Directory workspace ${String(index).padStart(3,'0')}`,slug: `directory-${randomUUID()}` })));
      const bootstrap = await reports.bootstrap(ids.admin);
      assert.equal(bootstrap.organizations.length,100); assert.equal(bootstrap.businesses.length,100);
      assert.equal(bootstrap.optionsTruncated.businesses,true);
      const directory = await reports.table(ids.admin,'businesses',{ ...query,page: 2,pageSize: 100,sort: 'name_asc' });
      assert.equal(directory.total,108); assert.equal(directory.items.length,8);
      const selected = await reports.table(ids.admin,'businesses',{ ...query,businessId: zero.id });
      assert.equal(selected.total,1); assert.equal(selected.items[0].id,zero.id);
      const active = await reports.table(ids.admin,'businesses',{ ...query,activityOnly: 'true',pageSize: 100 });
      assert.equal(active.total,1);
    });
    await t.test('a support write rechecks revoked authority after waiting for the database fence',async () => {
      const { authorizationFence } = require('../src/services/mutation-transaction');
      const { createAdminSupportService } = require('../src/services/admin-support-service');
      const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise,resolve }; };
      const locked = gate(),release = gate(),initialCheck = gate();
      await m.User.update({ isInternalAdmin: true },{ where: { id: supportAdmin.id } });
      const guardedPermissions = { ...permissions,assertInternalPermission: async (actor,capability,transaction) => {
        const result = await permissions.assertInternalPermission(actor,capability,transaction);
        if (actor === supportAdmin.id && capability === 'support.manage' && !transaction) initialCheck.resolve();
        return result;
      } };
      const support = createAdminSupportService({ models: m,permissions: guardedPermissions });
      const before = await m.SupportCase.count();
      const revocation = db.transaction(async transaction => {
        await authorizationFence(db,transaction,true);
        await m.User.update({ isInternalAdmin: false },{ where: { id: supportAdmin.id },transaction });
        locked.resolve(); await release.promise;
      });
      await locked.promise;
      const pending = support.create(supportAdmin.id,{ title: 'Concurrent write',description: 'Queued after initial authority check',category: 'account_access',reason: 'Checking concurrent revocation' }).then(value => ({ value }),error => ({ error }));
      try { await initialCheck.promise; release.resolve(); await revocation; } finally { release.resolve(); }
      assert.equal((await pending).error?.code,'FORBIDDEN');
      assert.equal(await m.SupportCase.count(),before);
    });
    await t.test('editor and commission guards preserve mixed-mode checkout history and exact financial totals',async () => {
      const { quoteOrder } = require('@nitewide/pricing');
      const tier = extra => ({ name: 'Fee-mode admission',kind: 'ticket',priceCents: 1000,inventoryMode: 'unlimited',quantityTotal: null,
        entriesPerUnit: 1,minPerOrder: 1,maxPerOrder: 10,isActive: true,feeMode: 'inherit',...extra });
      const input = { organizationId: ids.org,title: 'Modeled fee test',summary: '',description: '',status: 'published',isDiscoverable: false,
        feeMode: 'absorbed',startsAt: new Date(Date.now()+3600000).toISOString(),endsAt: new Date(Date.now()+86400000).toISOString(),
        capacity: null,guestlistCapacity: 0,location: { name: 'Fee-mode venue',addressLine1: '',city: 'Test City',region: '',postalCode: '',countryCode: 'US',timezone: 'UTC',privacy: 'private' },
        offerings: [tier(),tier({ name: 'Buyer-paid override',priceCents: 2500,feeMode: 'buyer' }),tier({ name: 'Small attributed order',priceCents: 999,feeMode: 'buyer' })] };
      const eventCount = await m.Event.count();
      await api('post','/business/events',ids.owner).send({ ...input,status: 'draft',offerings: [tier({ priceCents: 999 })] }).expect(422);
      assert.equal(await m.Event.count(),eventCount,'invalid active draft pricing cannot create an event');
      const event = (await api('post','/business/events',ids.owner).send(input).expect(201)).body.data;
      const offerings = await m.Offering.findAll({ where: { eventId: event.id },order: [['sortOrder','ASC']] });
      assert.equal(event.feeMode,'absorbed'); assert.equal(offerings[0].feeMode,'inherit');
      const offeringCount = await m.Offering.count({ where: { eventId: event.id } });
      await api('post',`/events/${event.id}/offerings`,ids.owner).send({ name: 'Invalid legacy offering',priceCents: 999,inventoryMode: 'unlimited' }).expect(422);
      await api('post','/admin/management/offerings').send({ eventId: event.id,name: 'Invalid record offering',priceCents: 999,inventoryMode: 'unlimited',
        currency: 'USD',reason: 'Validate shared pricing protection' }).expect(422);
      assert.equal(await m.Offering.count({ where: { eventId: event.id } }),offeringCount,'legacy and admin record creates cannot bypass absorbed minimum pricing');
      const affiliate = await m.EventAffiliate.create({ eventId: event.id,userId: ids.promoter,code: `FEE-${randomUUID()}`,commissionBps: 1000,status: 'active',accessScope: 'event' });
      const carts = [[{ offeringId: offerings[0].id,quantity: 1 }],[{ offeringId: offerings[0].id,quantity: 1 },{ offeringId: offerings[1].id,quantity: 1 }],[{ offeringId: offerings[2].id,quantity: 1 }]];
      const saved = [];
      for (const items of carts) {
        const quote = quoteOrder({ items: items.map(item => ({ unitPriceCents: offerings.find(o => o.id === item.offeringId).priceCents,quantity: item.quantity,
          feeMode: item.offeringId === offerings[0].id ? 'absorbed' : 'buyer' })),commissionBps: 0 });
        const body = { eventId: event.id,idempotencyKey: randomUUID(),affiliateCode: affiliate.code,items,expectedTotalCents: quote.totalCents,
          payment: { provider: 'demo',reference: randomUUID(),status: 'succeeded' } };
        const customer = (await api('post','/orders',ids.guest).send(body).expect(201)).body.data.order;
        const order = await m.Order.findByPk(customer.id); saved.push(order);
        assert.equal(customer.totalCents,customer.subtotalCents+customer.platformFeeCents);
        assert.equal(customer.platformFeeCents,quote.buyerFeeCents);
        assert.equal(order.pricingPlanSnapshot.pricingDecision.businessFeeCents,quote.businessFeeCents);
        assert.equal(customer.pricingPlanSnapshot.pricingDecision,undefined);
        assert.equal(order.affiliateCommissionCents,quote.commissionCents);
        assert.equal(order.pricingPlanSnapshot.commissionBps,0);
        assert.equal(order.pricingPlanSnapshot.configuredCommissionBps,1000);
        assert.equal(order.pricingPlanSnapshot.commissionEligibility.eligible,false);
        assert.equal(order.eventAffiliateId,affiliate.id);
        await api('post','/orders',ids.guest).send(body).expect(200);
      }
      assert.equal(saved[2].affiliateCommissionCents,0,'sub-$10 orders keep attribution without commission');
      const scoped = reportDetailQuery.parse({ eventId: event.id,days: 30,pageSize: 100 });
      const summary = await reports.summary(ids.admin,scoped),purchases = await reports.table(ids.admin,'purchases',scoped);
      const sum = field => saved.reduce((total,order) => total+Number(order[field]),0);
      const absorbed = saved.reduce((total,order) => total+order.pricingPlanSnapshot.pricingDecision.businessFeeCents,0);
      assert.equal(summary.summary.orders,3); assert.equal(summary.summary.customers,1); assert.equal(purchases.total,3);
      assert.equal(summary.financial.addedBuyerFeesCents,sum('platformFeeCents'));
      assert.equal(summary.financial.businessAbsorbedFeesCents,absorbed);
      assert.equal(summary.financial.combinedFeesCents,sum('platformFeeCents')+absorbed);
      assert.equal(summary.financial.businessProceedsBeforeProviderCents,sum('subtotalCents')-absorbed-sum('affiliateCommissionCents'));
      const businessRow = (await reports.table(ids.admin,'businesses',{ ...scoped,businessId: ids.org })).items[0];
      const eventRow = (await reports.table(ids.admin,'events',scoped)).items[0];
      assert.equal(businessRow.businessAbsorbedFeesCents,absorbed); assert.equal(eventRow.combinedFeesCents,summary.financial.combinedFeesCents);
      assert.equal(purchases.items.reduce((total,row) => total+row.businessProceedsBeforeProviderCents,0),summary.financial.businessProceedsBeforeProviderCents);
      const businessReports = createBusinessReportService({ models: m,businessRead: read });
      const exports = createReportExportService({ models: m,businessRead: read,reports: businessReports,historicalReports: reports.reports });
      let csv = '';
      await exports.request(ids.admin,{ ...scoped,audience: 'admin',exportTable: 'purchases',pageSize: 1 },{ destroyed: false,set() {},write(value) { csv += value; return true; },end() {} });
      assert.match(csv,/Business-absorbed fees USD/); assert.match(csv,/Combined fees USD/);
      assert.equal(csv.trim().split('\r\n').length,4,'mixed-fee export includes every order, not only the visible page');
      for (const order of saved) assert.match(csv,new RegExp(order.id));
      await exports.stop();
      // Direct fixture changes emulate old/imported invalid pricing. Terms
      // writes must refuse it before persisting an invitation.
      await offerings[0].update({ priceCents: 999 });
      const invitations = await m.TeamInvitation.count({ where: { eventId: event.id } });
      const eventAffiliates = await m.EventAffiliate.count({ where: { eventId: event.id } });
      const organizationAffiliates = await m.OrgAffiliate.count({ where: { organizationId: ids.org } });
      const outbox = await m.EmailOutbox.count();
      await api('post',`/business/events/${event.id}/invitations`,ids.owner).send({ email: 'pricing-guard@offline.nitewide.test',commissionBps: 4000 }).expect(422);
      await api('post',`/events/${event.id}/affiliates`,ids.owner).send({ userId: ids.outsider,code: `GUARD-${randomUUID()}`,commissionBps: 1000 }).expect(422);
      await api('post',`/organizations/${ids.org}/affiliates`,ids.owner).send({ userId: ids.outsider,code: `GUARD-${randomUUID()}`,defaultCommissionBps: 1000 }).expect(422);
      await api('post','/admin/management/event_affiliates').send({ eventId: event.id,userId: ids.outsider,code: `GUARD-${randomUUID()}`,commissionBps: 1000,
        reason: 'Validate record-level commission protection' }).expect(422);
      await api('post','/admin/management/organization_affiliates').send({ organizationId: ids.org,userId: ids.outsider,code: `GUARD-${randomUUID()}`,defaultCommissionBps: 1000,
        reason: 'Validate organization commission protection' }).expect(422);
      await api('post','/admin/management/team_invitations').send({ eventId: event.id,email: 'pricing-admin-guard@offline.nitewide.test',role: 'affiliate',commissionBps: 1000,
        reason: 'Validate admin invitation protection' }).expect(422);
      assert.equal(await m.TeamInvitation.count({ where: { eventId: event.id } }),invitations);
      assert.equal(await m.EventAffiliate.count({ where: { eventId: event.id } }),eventAffiliates);
      assert.equal(await m.OrgAffiliate.count({ where: { organizationId: ids.org } }),organizationAffiliates);
      assert.equal(await m.EmailOutbox.count(),outbox,'rejected pricing writes do not enqueue email');
      await offerings[0].update({ priceCents: 1000 });
      await m.Event.update({ feeMode: 'buyer' },{ where: { id: event.id } });
      const historical = await reports.summary(ids.admin,scoped);
      assert.deepEqual(historical.financial,summary.financial,'later fee-mode edits do not rewrite purchase economics');
    });
    await t.test('admin event directory filters local start dates across a 23-hour DST day with stable counts and pages',async () => {
      const tag = `DST directory ${randomUUID()}`;
      const starts = ['2026-03-08T04:59:59.999Z','2026-03-08T05:00:00.000Z','2026-03-08T05:00:00.000Z','2026-03-09T03:59:59.999Z','2026-03-09T04:00:00.000Z'];
      const fixtures = await m.Event.bulkCreate(starts.map((startsAt,index) => ({ creatorUserId: ids.owner,organizationId: ids.org,
        title: `${tag} ${index}`,slug: `dst-directory-${randomUUID()}`,startsAt,endsAt: new Date(Date.parse(startsAt)+3600000),status: 'published' })));
      const filter = { search: tag,startDate: '2026-03-08',endDate: '2026-03-08',timezone: 'America/New_York',sort: 'startsAt',direction: 'asc',pageSize: 1 };
      const pages = [];
      for (const page of [1,2,3]) pages.push((await api('get','/admin/management/events').query({ ...filter,page }).expect(200)).body.data);
      assert.ok(pages.every(page => page.total===3 && page.items.length===1));
      assert.deepEqual(pages.map(page => page.hasMore),[true,true,false]);
      const expected = fixtures.slice(1,4).sort((left,right) => +new Date(left.startsAt)-+new Date(right.startsAt)||left.id.localeCompare(right.id)).map(row => row.id);
      assert.deepEqual(pages.flatMap(page => page.items.map(row => row.id)),expected);
      assert.equal(new Set(pages.flatMap(page => page.items.map(row => row.id))).size,3);
      const repeat = (await api('get','/admin/management/events').query({ ...filter,page: 1 }).expect(200)).body.data;
      assert.equal(repeat.items[0].id,pages[0].items[0].id);
      const utc = (await api('get','/admin/management/events').query({ ...filter,timezone: 'UTC',pageSize: 100 }).expect(200)).body.data;
      assert.equal(utc.total,3); assert.ok(utc.items.some(row => row.id===fixtures[0].id)); assert.ok(!utc.items.some(row => row.id===fixtures[3].id));
      await api('get','/admin/management/events').query({ ...filter,startDate: '2026-03-09',endDate: '2026-03-08' }).expect(422);
      await api('get','/admin/management/events').query({ ...filter,timezone: 'not/a-timezone' }).expect(422);
      await api('get','/admin/management/events').query({ ...filter,startDate: '2026-02-30' }).expect(422);
    });
    await t.test('People directory applies repeated OR statuses, case-insensitive contacts, normalized phone, exact IDs and stable pages in PostgreSQL',async () => {
      const tag = `people-${randomUUID()}`,outboxBefore = await m.EmailOutbox.count();
      const people = await m.User.bulkCreate([
        { displayName: `${tag} Mixed Name Active`,email: `Mixed.Case.${tag}@people.nitewide.test`,phone: '+1 (202) 555-0108',isActive: true,lifecycleState: 'active' },
        { displayName: `${tag} Mixed Name Disabled`,email: `disabled.${tag}@people.nitewide.test`,phone: '+12025550108',isActive: false,lifecycleState: 'active' },
        { displayName: `${tag} Mixed Name Suspended`,email: `suspended.${tag}@people.nitewide.test`,phone: '+12025550208',isActive: true,lifecycleState: 'suspended' },
        { displayName: `${tag} Mixed Name Archived`,email: `archived.${tag}@people.nitewide.test`,phone: '+12025550308',isActive: false,lifecycleState: 'archived' },
      ]);
      await m.User.create({ displayName: `UUID text decoy ${people[0].id}`,email: `decoy-${randomUUID()}@people.nitewide.test` });
      const directory = async query => (await api('get','/admin/management/users').query(query).expect(200)).body.data;
      const all = await directory({ search: tag,statuses: [],pageSize: 100 });
      assert.equal(all.total,4); assert.ok(all.items.every(row => Object.hasOwn(row,'phone')));
      const direct = require('../src/services/admin-management-service').createAdminManagementService({ models: m,permissions });
      assert.equal((await direct.list(ids.admin,'users',{ search: tag,statuses: [] })).total,4,'an explicitly cleared status array means all states');
      const repeated = await directory(`search=${encodeURIComponent(tag)}&statuses=active&statuses=disabled&sort=displayName&direction=asc`);
      assert.deepEqual(repeated.items.map(row => row.id).sort(),people.slice(0,2).map(row => row.id).sort());
      assert.deepEqual(repeated.statuses,['active','disabled']);
      const selected = await directory({ search: tag,statuses: ['active','disabled','suspended','archived'],pageSize: 100 });
      assert.equal(selected.total,4);
      const duplicate = await directory({ search: tag,statuses: ['active','active','disabled'] }); assert.equal(duplicate.total,2);
      for (const [index,status] of ['active','disabled','suspended','archived'].entries()) {
        const result = await directory({ search: tag,statuses: [status] }); assert.equal(result.total,1); assert.equal(result.items[0].id,people[index].id);
      }
      assert.equal((await directory({ search: people[1].email.toUpperCase(),statuses: ['active'] })).total,0,'applied search and status combine with AND');
      assert.equal((await directory({ search: people[1].email.toUpperCase(),statuses: ['disabled'] })).items[0].id,people[1].id);
      assert.equal((await directory({ search: people[0].displayName.toUpperCase() })).items[0].id,people[0].id);
      assert.equal((await directory({ search: people[0].email.toLowerCase() })).items[0].id,people[0].id);
      for (const search of ['2025550108','(202) 555-0108','+1 (202) 555-0108','+12025550108']) {
        const result = await directory({ search,pageSize: 100 }); assert.deepEqual(result.items.map(row => row.id).sort(),people.slice(0,2).map(row => row.id).sort());
      }
      assert.equal((await directory({ search: '(202) 555-0108',statuses: ['disabled'] })).items[0].id,people[1].id);
      const exact = await directory({ search: people[0].id }); assert.equal(exact.total,1); assert.equal(exact.items[0].id,people[0].id,'UUID searches exclude contact-text decoys');
      const pages = [];
      for (const page of [1,2,3,4]) pages.push(await directory({ search: tag,statuses: ['active','disabled','suspended','archived'],pageSize: 1,page,sort: 'displayName',direction: 'asc' }));
      assert.ok(pages.every(page => page.total===4 && page.items.length===1)); assert.deepEqual(pages.map(page => page.hasMore),[true,true,true,false]);
      assert.equal(new Set(pages.flatMap(page => page.items.map(row => row.id))).size,4);
      assert.equal((await directory({ search: tag,statuses: ['active','disabled','suspended','archived'],pageSize: 1,page: 1,sort: 'displayName',direction: 'asc' })).items[0].id,pages[0].items[0].id);
      await api('get','/admin/management/users').query({ search: tag,statuses: ['invalid-state'] }).expect(422);
      await api('get','/admin/management/users').query({ search: tag,status: 'invalid-state' }).expect(422);
      await api('get','/admin/management/users').query({ search: tag,status: 'active',statuses: ['disabled'] }).expect(422);
      assert.equal(await m.EmailOutbox.count(),outboxBefore);
    });
    await t.test('People relationship directories distinguish admission subjects, invitation senders and matched recipients; venue assignments remain read-only',async () => {
      const { createQrToken } = require('../src/domain/qr');
      const outboxBefore = await m.EmailOutbox.count();
      const person = await m.User.create({ displayName: 'Relationship subject',email: `relationship-${randomUUID()}@people.nitewide.test`,phone: '+1 (646) 555-0921' });
      const scanner = await m.User.create({ displayName: 'Relationship admission operator',email: `scanner-${randomUUID()}@people.nitewide.test` });
      const ticket = await m.Ticket.create({ eventId: ids.event,orderItemId: ids.item,holderUserId: person.id,status: 'checked_in',qrTokenHash: createQrToken().hash,checkedInAt: new Date() });
      const unrelatedTicket = await m.Ticket.create({ eventId: ids.event,orderItemId: ids.item,holderUserId: scanner.id,status: 'checked_in',qrTokenHash: createQrToken().hash,checkedInAt: new Date() });
      const guest = await m.GuestlistEntry.create({ eventId: ids.event,userId: person.id,source: 'event',partySize: 1,status: 'checked_in',checkedInAt: new Date() });
      const entries = await m.CheckIn.bulkCreate([
        { eventId: ids.event,ticketId: ticket.id,checkedInByUserId: scanner.id },
        { eventId: ids.event,guestlistEntryId: guest.id,checkedInByUserId: scanner.id },
        { eventId: ids.event,ticketId: unrelatedTicket.id,checkedInByUserId: person.id },
      ]);
      const related = async (resource,query) => (await api('get',`/admin/management/${resource}`).query(query).expect(200)).body.data;
      const tickets = await related('tickets',{ userId: person.id }); assert.equal(tickets.total,1); assert.equal(tickets.items[0].id,ticket.id);
      const checkins = await related('check_ins',{ userId: person.id }); assert.equal(checkins.total,2);
      assert.deepEqual(checkins.items.map(row => row.id).sort(),entries.slice(0,2).map(row => row.id).sort(),'the actor operating the scanner is not the admission subject');
      for (const [model,resource] of [[m.TeamInvitation,'team_invitations'],[m.GuestlistInvitation,'guestlist_invitations']]) {
        const scope = model===m.TeamInvitation ? { organizationId: ids.org,role: 'employee' } : { eventId: ids.event };
        const rows = await model.bulkCreate([
          { invitedByUserId: person.id,email: `sent-${randomUUID()}@people.nitewide.test` },
          { invitedByUserId: scanner.id,email: `old-recipient-${randomUUID()}@people.nitewide.test`,acceptedByUserId: person.id,acceptedAt: new Date(),...(model===m.GuestlistInvitation ? { status: 'accepted' } : {}) },
          { invitedByUserId: scanner.id,email: person.email.toUpperCase() },
          { invitedByUserId: scanner.id,email: `phone-recipient-${randomUUID()}@people.nitewide.test`,phone: '+16465550921' },
          { invitedByUserId: scanner.id,email: `unrelated-${randomUUID()}@people.nitewide.test`,phone: '+16465550999' },
        ].map(row => ({ ...scope,...row,tokenHash: randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),expiresAt: new Date(Date.now()+86400000) })));
        const sent = await related(resource,{ userId: person.id,relation: 'sent' }); assert.equal(sent.total,1); assert.equal(sent.items[0].id,rows[0].id);
        const received = await related(resource,{ userId: person.id,relation: 'received' });
        assert.equal(received.total,3); assert.deepEqual(received.items.map(row => row.id).sort(),rows.slice(1,4).map(row => row.id).sort());
        const defaultDirection = await related(resource,{ userId: person.id }); assert.deepEqual(defaultDirection.items.map(row => row.id).sort(),received.items.map(row => row.id).sort());
        assert.ok(received.items.every(row => !Object.hasOwn(row,'tokenHash')));
        await api('get',`/admin/management/${resource}`).query({ relation: 'received' }).expect(422);
      }
      await api('get','/admin/management/tickets').query({ userId: person.id,relation: 'sent' }).expect(422);
      await m.OrganizationVenue.findOrCreate({ where: { organizationId: ids.org,locationId: ids.location } });
      const assignment = await m.VenueAccess.create({ organizationId: ids.org,locationId: ids.location,userId: person.id,role: 'employee',status: 'active' });
      await m.VenueAccess.create({ organizationId: ids.org,locationId: ids.location,userId: scanner.id,role: 'promoter',status: 'active' });
      const venues = await related('venue_access',{ userId: person.id }); assert.equal(venues.total,1); assert.equal(venues.items[0].id,assignment.id);
      const resources = (await api('get','/admin/management/resources').expect(200)).body.data,metadata = resources.find(row => row.key==='venue_access');
      assert.ok(metadata); assert.equal(metadata.canCreate,false); assert.equal(metadata.canEdit,false); assert.equal(metadata.canDelete,false); assert.deepEqual(metadata.actions,[]);
      const organization = await m.Organization.findByPk(ids.org),owner = await m.User.findByPk(ids.owner);
      const owners = await related('owners',{ organizationId: ids.org,userId: ids.owner,search: organization.name.toUpperCase(),pageSize: 1 });
      assert.equal(owners.total,1); assert.equal(owners.items[0].userId,ids.owner);
      assert.deepEqual(owners.items[0].organization,{ id: ids.org,name: organization.name });
      assert.deepEqual(Object.keys(owners.items[0].user).sort(),['displayName','email','id']);
      assert.equal((await related('owners',{ organizationId: ids.org,userId: ids.owner,search: owner.email.toUpperCase() })).total,1);
      const outsideLocation = await m.Location.create({ name: 'Foreign related-search venue',city: 'Test City',timezone: 'UTC' });
      const outsideOrganization = await m.Organization.create({ name: 'Foreign related-search business',slug: `foreign-search-${randomUUID()}`,locationId: outsideLocation.id });
      const outside = await m.VenueAccess.create({ organizationId: outsideOrganization.id,locationId: outsideLocation.id,userId: person.id,role: 'promoter',status: 'active' });
      const scope = { organizationId: ids.org,userId: person.id,pageSize: 1 };
      for (const search of [organization.name.toUpperCase(),person.email.toUpperCase(),'(646) 555-0921']) {
        const result = await related('venue_access',{ ...scope,search }); assert.equal(result.total,1); assert.equal(result.items.length,1); assert.equal(result.items[0].id,assignment.id);
        assert.deepEqual(result.items[0].organization,{ id: ids.org,name: organization.name });
        assert.deepEqual(Object.keys(result.items[0].user).sort(),['displayName','email','id']);
        assert.deepEqual(Object.keys(result.items[0].location).sort(),['id','name']);
        assert.notEqual(result.items[0].id,outside.id);
      }
      await person.update({ displayName: "Literal O'Brien_50% Person" });
      assert.equal((await related('venue_access',{ ...scope,search: "O'Brien_50%" })).total,1,'apostrophes and percent/underscore characters remain literal search content');
      for (const search of ["x' OR 1=1 --",'%_','\\']) assert.equal((await related('venue_access',{ ...scope,search })).total,0,'unmatched injection-like and wildcard input does not broaden the selected relationship scope');
      const bounded = await related('venue_access',{ organizationId: ids.org,search: organization.name,pageSize: 1 });
      assert.equal(bounded.total,2); assert.equal(bounded.items.length,1); assert.equal(bounded.hasMore,true);
      assert.equal(await m.EmailOutbox.count(),outboxBefore,'relationship inspection and isolated fixtures do not queue emails');
    });
    await t.test('support case repeated statuses use scoped OR filtering with clear/single/duplicate selections and stable PostgreSQL pages',async () => {
      const tag = `support-status-${randomUUID()}`,outboxBefore = await m.EmailOutbox.count();
      const common = { title: tag,description: 'Scoped support status fixture',category: 'reporting',priority: 'normal',
        organizationId: ids.org,customerUserId: ids.guest,assignedAdminUserId: ids.admin,createdByAdminUserId: ids.admin,updatedByAdminUserId: ids.admin,
        createdAt: new Date('2026-10-01T12:00:00Z') };
      const states = ['open','open','in_progress','resolved','closed'];
      const cases = await m.SupportCase.bulkCreate([
        ...states.map((status,index) => ({ ...common,title: `${tag} ${index}`,status,resolution: ['resolved','closed'].includes(status) ? 'Fixture work completed' : null })),
        { ...common,title: `${tag} other business`,status: 'open',organizationId: zero.id },
        { ...common,title: `${tag} other customer`,status: 'open',customerUserId: ids.outsider },
        { ...common,title: `${tag} other assignee`,status: 'open',assignedAdminUserId: reader.id },
        { ...common,title: `${tag} other category`,status: 'open',category: 'admission' },
        { ...common,title: `Unmatched support title ${randomUUID()}`,status: 'open' },
      ]);
      const scope = { search: tag,category: 'reporting',organizationId: ids.org,customerUserId: ids.guest,assignedAdminUserId: ids.admin };
      const directory = async query => (await api('get','/admin/support/cases',reader.id).query(query).expect(200)).body.data;
      const all = await directory({ ...scope,statuses: [],pageSize: 100 });
      assert.equal(all.total,5); assert.deepEqual(all.items.map(row => row.id).sort(),cases.slice(0,5).map(row => row.id).sort());
      const { createAdminSupportService } = require('../src/services/admin-support-service');
      const support = createAdminSupportService({ models: m,permissions });
      assert.equal((await support.list(reader.id,{ ...scope,statuses: [] })).total,5,'explicitly cleared selections do not apply a status predicate');
      const encodedScope = new URLSearchParams(scope).toString();
      const repeated = await directory(`${encodedScope}&statuses=open&statuses=in_progress&pageSize=100`);
      assert.equal(repeated.total,3); assert.deepEqual(repeated.items.map(row => row.id).sort(),cases.slice(0,3).map(row => row.id).sort());
      const duplicate = await directory({ ...scope,statuses: ['open','open','in_progress'],pageSize: 100 });
      assert.equal(duplicate.total,3); assert.deepEqual(duplicate.items.map(row => row.id).sort(),repeated.items.map(row => row.id).sort());
      const single = await directory(`${encodedScope}&statuses=open`); assert.equal(single.total,2);
      assert.equal((await directory({ ...scope,statuses: ['closed'] })).items[0].id,cases[4].id);
      assert.equal((await directory({ ...scope,statuses: ['open','in_progress','resolved','closed'] })).total,5);
      assert.equal((await directory({ ...scope,status: 'open' })).total,2,'legacy single-status queries remain compatible');
      assert.equal((await directory({ ...scope,status: 'all',statuses: ['open','in_progress'] })).total,3);
      assert.equal((await support.list(reader.id,{ ...scope,status: 'open',statuses: [] })).total,2);
      assert.equal((await directory({ ...scope,search: cases[3].title,statuses: ['open','in_progress'] })).total,0,'search AND the selected states cannot leak resolved cases');
      assert.equal((await directory({ ...scope,organizationId: zero.id,statuses: ['open','in_progress'] })).items[0].id,cases[5].id);
      assert.equal((await directory({ search: tag,statuses: ['open','in_progress'],pageSize: 100 })).total,7,'combined category and relationship scopes are independently applied');
      const selected = { ...scope,statuses: ['open','in_progress','open'],pageSize: 1 },pages = [];
      for (const page of [1,2,3]) pages.push(await directory({ ...selected,page }));
      assert.ok(pages.every(page => page.total===3 && page.items.length===1)); assert.deepEqual(pages.map(page => page.hasMore),[true,true,false]);
      const expected = cases.slice(0,3).map(row => row.id).sort();
      assert.deepEqual(pages.flatMap(page => page.items.map(row => row.id)),expected,'equal timestamps retain the canonical ID tie-breaker');
      assert.equal(new Set(pages.flatMap(page => page.items.map(row => row.id))).size,3);
      assert.equal((await directory({ ...selected,page: 1 })).items[0].id,pages[0].items[0].id);
      const afterLast = await directory({ ...selected,page: 4 }); assert.equal(afterLast.total,3); assert.deepEqual(afterLast.items,[]); assert.equal(afterLast.hasMore,false);
      for (const invalid of [{ statuses: 'invalid' },{ statuses: ['open','invalid'] },{ statuses: ['all'] },{ statuses: Array(9).fill('open') },
        { status: 'open',statuses: ['open'] },{ status: 'resolved',statuses: ['closed'] }]) {
        await api('get','/admin/support/cases',reader.id).query({ ...scope,...invalid }).expect(422);
      }
      await api('get','/admin/support/cases',ids.owner).query({ ...scope,statuses: ['open','in_progress'] }).expect(403);
      await api('get','/admin/support/cases',supportAdmin.id).query({ ...scope,statuses: ['open','in_progress'] }).expect(403);
      assert.equal(await m.EmailOutbox.count(),outboxBefore,'support filtering never sends or enqueues email');
    });
  } finally { await db.close(); }
});
