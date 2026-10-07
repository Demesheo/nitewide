const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('exclusive managed venues preserve scoped staff, reporting, referrals, admission, and paged directories', { timeout: 120000 },async t => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const config = getConfig(),db = createSequelize(config),m = initModels(db);
  const ids = Object.fromEntries(['admin','owner','manager','employee','promoter','other','customer','org','otherOrg','zero'].map(key => [key,randomUUID()]));
  let venueA,venueB,otherVenue,eventA,eventB,futureA,futureB,grantManager,grantEmployee,grantPromoter,link,order;
  try {
    await m.User.bulkCreate(['admin','owner','manager','employee','promoter','other','customer'].map(key => ({ id: ids[key],email: `${key}-${ids.org}@venue.nitewide.test`,
      displayName: `Venue ${key}`,isInternalAdmin: key === 'admin',isActive: true })));
    await m.Organization.bulkCreate([{ id: ids.org,name: 'Multi-venue organization',slug: `venues-${ids.org}`,businessType: 'organization' },
      { id: ids.otherOrg,name: 'Other organization',slug: `venues-${ids.otherOrg}`,businessType: 'organization' },
      { id: ids.zero,name: 'No venues organization',slug: `venues-${ids.zero}`,businessType: 'organization' }]);
    await m.OrganizationOwner.bulkCreate([ids.org,ids.otherOrg,ids.zero].map(organizationId => ({ organizationId,userId: ids.owner,role: 'owner' })));
    const app = createApp({ sequelize: db,models: m,config,services: { email: { enabled: false } } });
    const api = (method,path,userId = ids.admin) => request(app)[method](`/api${path}`).set('x-user-id',userId);
    // These regressions intentionally exercise outstanding legacy invitations,
    // not new invitations (which are capacity-checked and approved at issuance).
    const legacyInvite = async (eventId, invitedByUserId, email, eventAffiliateId = null) => {
      const token = randomBytes(32).toString('base64url');
      const invitation = await m.GuestlistInvitation.create({ eventId, invitedByUserId, email, eventAffiliateId, partySize: 1,
        status: 'pending', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now()+86400000) });
      return { invitation, token };
    };
    const venuePath = (org = ids.org,internal = true) => `${internal ? '/admin/businesses' : '/business/organizations'}/${org}/venues`;
    const createVenue = async (name,organizationId = ids.org) => {
      const org = await m.Organization.findByPk(organizationId);
      return (await api('post',venuePath(organizationId)).send({ version: org.version,reason: 'Create isolated managed venue fixture',
        venue: { name,addressLine1: '1 Isolated Way',city: 'Test City',region: 'NY',postalCode: '10001',countryCode: 'US',timezone: 'UTC',privacy: 'private' } }).expect(201)).body.data;
    };
    const grant = async (locationId,userId,role,existing = null,status = 'active',actor = ids.owner) => (await api('put',`${venuePath(ids.org,false)}/${locationId}/team/${userId}`,actor)
      .send({ version: existing?.version ?? null,role,status,reason: 'Assign exact venue access in isolated test' }).expect(200)).body.data;
    const eventInput = (locationId,title = 'Venue scope event') => ({ organizationId: ids.org,locationId,title,summary: '',description: '',status: 'published',isDiscoverable: false,feeMode: 'buyer',
      startsAt: new Date(Date.now()+3600000).toISOString(),endsAt: new Date(Date.now()+14400000).toISOString(),capacity: null,guestlistCapacity: 20,
      offerings: [{ name: 'Venue admission',kind: 'ticket',feeMode: 'inherit',priceCents: 2000,inventoryMode: 'unlimited',quantityTotal: null,entriesPerUnit: 1,minPerOrder: 1,maxPerOrder: 10,isActive: true }] });
    await t.test('zero, one, and many venues use exclusive canonical ownership without a global attach shortcut',async () => {
      const venues = require('../src/services/business-venue-service').createBusinessVenueService({ models: m,permissions: require('../src/services/permission-service').createPermissionService(m) });
      assert.equal((await venues.list(ids.admin,ids.zero,{})).total,0);
      assert.equal((await api('get',venuePath(ids.zero)).expect(200)).body.data.total,0);
      venueA = await createVenue('Alpha room');
      assert.equal((await api('get',venuePath()).expect(200)).body.data.total,1);
      venueB = await createVenue('Beta room'); otherVenue = await createVenue('Other room',ids.otherOrg);
      assert.equal((await api('get',venuePath()).expect(200)).body.data.total,2);
      assert.equal((await m.Organization.findByPk(ids.org)).locationId,venueA.id);
      await assert.rejects(m.OrganizationVenue.create({ organizationId: ids.otherOrg,locationId: venueA.id }),{ name: 'SequelizeUniqueConstraintError' });
      await assert.rejects(m.VenueAccess.create({ organizationId: ids.otherOrg,locationId: venueA.id,userId: ids.other,role: 'manager' }),{ name: 'SequelizeForeignKeyConstraintError' });
      const otherOrg = await m.Organization.findByPk(ids.otherOrg);
      await api('patch',`/admin/management/organizations/${ids.otherOrg}`).send({ version: otherOrg.version,locationId: venueA.id,reason: 'Try cross-business shortcut' }).expect(409);
      assert.equal((await m.OrganizationVenue.findOne({ where: { locationId: venueA.id } })).organizationId,ids.org);
    });
    await t.test('venue roles expose only assigned choices and managers cannot acquire organization-wide authority',async () => {
      grantManager = await grant(venueB.id,ids.manager,'manager');
      grantEmployee = await grant(venueB.id,ids.employee,'employee'); grantPromoter = await grant(venueB.id,ids.promoter,'promoter');
      const bootstrap = (await api('get','/business/bootstrap',ids.manager).expect(200)).body.data;
      assert.equal(bootstrap.organizations.length,1); assert.equal(bootstrap.organizations[0].canManage,false);
      assert.equal(bootstrap.organizations[0].canCreateEvents,true); assert.equal(bootstrap.organizations[0].locationId,null);
      assert.deepEqual(bootstrap.venues.flatMap(row => row.locationIds),[venueB.id]);
      assert.deepEqual(bootstrap.venues.flatMap(row => row.managedLocationIds),[venueB.id]);
      assert.equal(bootstrap.venues[0].managedLocation.id,venueB.id);
      assert.equal(bootstrap.venues[0].managedLocation.timezone,'UTC');
      const limited = (await api('get',venuePath(ids.org,false),ids.manager).expect(200)).body.data;
      assert.equal(limited.total,1); assert.equal(limited.items[0].id,venueB.id); assert.equal(limited.canCreate,false);
      await api('get',`${venuePath(ids.org,false)}/${venueA.id}`,ids.manager).expect(403);
      await api('put',`${venuePath(ids.org,false)}/${venueB.id}/team/${ids.other}`,ids.manager).send({ version: null,role: 'manager',status: 'active',reason: 'Unauthorized manager escalation' }).expect(403);
      await api('get',`/business/organizations/${ids.org}/team-page`,ids.manager).expect(403);
      await api('post','/business/events',ids.manager).send(eventInput(venueA.id)).expect(403);
      eventA = (await api('post','/business/events',ids.owner).send(eventInput(venueA.id,'Alpha scoped event')).expect(201)).body.data;
      eventB = (await api('post','/business/events',ids.manager).send(eventInput(venueB.id,'Beta scoped event')).expect(201)).body.data;
      await api('post','/business/events',ids.employee).send(eventInput(venueB.id)).expect(403);
      const beta = await m.Event.findByPk(eventB.id),betaOffering = await m.Offering.findOne({ where: { eventId: beta.id } });
      await api('put',`/business/events/${beta.id}`,ids.manager).send({ ...eventInput(venueA.id),version: beta.version,offerings: [{ ...eventInput(venueA.id).offerings[0],id: betaOffering.id }] }).expect(403);
      const listed = (await api('get','/business/events',ids.manager).query({ status: 'all' }).expect(200)).body.data;
      assert.equal(listed.total,1); assert.equal(listed.items[0].id,eventB.id); assert.equal(listed.items[0].canManage,true); assert.equal(listed.items[0].isManagedVenue,true);
      const summary = (await api('get',`/business/events/${eventB.id}/summary`,ids.manager).expect(200)).body.data.event;
      assert.equal(summary.isManagedVenue,true); assert.equal(summary.organization.locationId,null,'another venue default is not exposed to venue-only managers');
      await api('get',`/business/events/${eventA.id}/summary`,ids.manager).expect(404);
      await api('get',`${venuePath(ids.org,false)}/${venueB.id}/team`,ids.employee).expect(403);
      assert.equal(await m.EventAffiliate.count({ where: { eventId: eventB.id,userId: ids.employee } }),0);
      const deniedTerms = await api('put',`/business/events/${eventB.id}/people`,ids.manager).send({ userId: ids.employee,commissionBps: 500,status: 'active' }).expect(422);
      assert.equal(deniedTerms.body.error.code,'COMMISSION_ONBOARDING_REQUIRED');
      const firstTerms = (await api('put',`/business/events/${eventB.id}/people`,ids.manager).send({ userId: ids.employee,commissionBps: 0,status: 'active' }).expect(200)).body.data;
      assert.equal(firstTerms.accessScope,'venue'); assert.equal(firstTerms.venueAccessId,grantEmployee.id); assert.equal(firstTerms.commissionBps,0);
      const ownLink = (await api('get',`/business/events/${eventB.id}/referral-link`,ids.employee).expect(200)).body.data;
      assert.equal(ownLink.code,firstTerms.code,'first terms precede and preserve the employee’s own referral link');
    });
    await t.test('custom-address drafts and publication retain address identity without becoming linked venues',async () => {
      const input = { ...eventInput(null,'Custom address fixture'),organizationId: ids.zero,status: 'draft',offerings: [],
        location: { name: 'Custom fixture room',addressLine1: '100 QA Way',city: 'Denver',region: 'CO',postalCode: '',countryCode: 'US',timezone: 'America/Denver',privacy: 'public' } };
      const created = (await api('post','/business/events',ids.owner).send(input).expect(201)).body.data;
      await m.Organization.update({ locationId: created.locationId },{ where: { id: ids.zero } });
      const reopened = (await api('get',`/business/events/${created.id}/summary`,ids.owner).expect(200)).body.data.event;
      assert.equal(reopened.isManagedVenue,false);
      assert.equal(reopened.location.addressLine1,'100 QA Way');
      const bootstrap = (await api('get','/business/bootstrap',ids.owner).expect(200)).body.data;
      const customOption = bootstrap.venues.find(row => row.locationIds.includes(reopened.locationId));
      assert.ok(customOption,'custom addresses remain available as analytics filters');
      assert.deepEqual(customOption.managedLocationIds,[]);
      assert.equal(customOption.managedLocation,null);
      assert.equal(bootstrap.organizations.find(row => row.id===ids.zero).locationId,reopened.locationId,'legacy organization defaults do not prove a business venue link');
      await api('post','/business/events',ids.manager).send({ ...input,organizationId: ids.org }).expect(403);
      const published = (await api('put',`/business/events/${created.id}`,ids.owner).send({ ...input,status: 'published',version: reopened.version }).expect(200)).body.data;
      const latest = (await api('get',`/business/events/${published.id}/summary`,ids.owner).expect(200)).body.data.event;
      assert.equal(latest.status,'published');
      assert.equal(latest.isManagedVenue,false);
      assert.equal(latest.location.timezone,'America/Denver');
      assert.equal(await m.OrganizationVenue.count({ where: { organizationId: ids.zero } }),0,'address publication does not create a business venue link');
    });
    await t.test('venue reporting, referral checkout, and customer future connections never cross venue boundaries',async () => {
      link = (await api('get',`/business/events/${eventB.id}/referral-link`,ids.promoter).expect(200)).body.data;
      const assignment = await m.EventAffiliate.findOne({ where: { eventId: eventB.id,userId: ids.promoter } });
      assert.equal(assignment.accessScope,'venue'); assert.equal(assignment.venueAccessId,grantPromoter.id);
      await api('get',`/business/events/${eventA.id}/referral-link`,ids.promoter).expect(403);
      const offering = await m.Offering.findOne({ where: { eventId: eventB.id } });
      const checkout = (await api('post','/orders',ids.customer).send({ eventId: eventB.id,affiliateCode: link.code,idempotencyKey: randomUUID(),items: [{ offeringId: offering.id,quantity: 1 }],
        payment: { provider: 'demo',reference: randomUUID(),status: 'succeeded' } }).expect(201)).body.data.order;
      order = await m.Order.findByPk(checkout.id);
      const makeHistoricalOrder = async (eventId,price) => {
        const offering = await m.Offering.findOne({ where: { eventId } });
        const order = await m.Order.create({ eventId,buyerUserId: ids.other,status: 'paid',currency: 'USD',subtotalCents: price,totalCents: price,idempotencyKey: randomUUID(),paidAt: new Date() });
        await m.OrderItem.create({ orderId: order.id,offeringId: offering.id,nameSnapshot: offering.name,kindSnapshot: 'ticket',quantity: 1,entriesPerUnitSnapshot: 1,unitPriceCents: price,lineTotalCents: price });
      };
      await makeHistoricalOrder(eventA.id,9000); await makeHistoricalOrder(eventB.id,3000);
      const manager = (await api('get','/business/reports/summary',ids.manager).expect(200)).body.data;
      const promoter = (await api('get','/business/reports/summary',ids.promoter).expect(200)).body.data;
      const employee = (await api('get','/business/reports/summary',ids.employee).expect(200)).body.data;
      assert.equal(manager.summary.salesCents,5000); assert.equal(manager.summary.orders,2);
      assert.equal(promoter.summary.salesCents,2000); assert.equal(promoter.summary.orders,1); assert.equal(employee.summary.salesCents,0);
      assert.equal((await api('get','/business/reports/events',ids.manager).expect(200)).body.data.total,1);
      assert.equal((await api('get',`/business/events/${eventB.id}/purchases`,ids.manager).expect(200)).body.data.total,2);
      assert.equal((await api('get',`/business/events/${eventB.id}/purchases`,ids.promoter).expect(200)).body.data.total,1);
      const bootstrap = (await api('get','/business/bootstrap',ids.owner).expect(200)).body.data;
      const selectedVenue = (locationId) => bootstrap.venues.find(row => row.locationIds.includes(locationId)).id;
      assert.equal((await api('get','/business/reports/summary',ids.manager).query({ venueIds: [selectedVenue(venueB.id)] }).expect(200)).body.data.summary.salesCents,5000);
      assert.equal((await api('get','/business/reports/summary',ids.manager).query({ venueIds: [selectedVenue(venueA.id)] }).expect(200)).body.data.summary.salesCents,0);
      await m.GuestlistEntry.bulkCreate([
        { eventId: eventA.id,userId: ids.customer,status: 'pending',source: 'event',partySize: 1 },
        { eventId: eventB.id,userId: ids.other,status: 'pending',source: 'event',partySize: 1 },
        { eventId: eventB.id,userId: ids.customer,eventAffiliateId: assignment.id,status: 'pending',source: 'affiliate',partySize: 1 },
      ]);
      assert.equal((await api('get',`/business/events/${eventB.id}/guestlist-page`,ids.manager).expect(200)).body.data.total,2);
      assert.equal((await api('get',`/business/events/${eventB.id}/guestlist-page`,ids.promoter).expect(200)).body.data.total,1);
      assert.equal((await api('get',`/business/events/${eventB.id}/guestlist-page`,ids.employee).expect(200)).body.data.total,0);
      await api('get',`/business/events/${eventA.id}/guestlist-page`,ids.manager).expect(404);
      const events = await m.Event.bulkCreate([venueA,venueB].map((venue,index) => ({ organizationId: ids.org,locationId: venue.id,creatorUserId: ids.owner,title: `Future venue ${index}`,slug: `future-${randomUUID()}`,
        status: 'published',isDiscoverable: true,startsAt: new Date(Date.now()+86400000),endsAt: new Date(Date.now()+100000000),guestlistCapacity: 20 })));
      [futureA,futureB] = events;
      const connected = (await api('get','/customer/connections',ids.customer).query({ page: 1,pageSize: 30 }).expect(200)).body.data;
      assert.ok(connected.items.some(row => row.event.id === futureB.id));
      assert.ok(!connected.items.some(row => row.event.id === futureA.id));
      await api('get',`/business/events/${futureA.id}/referral-link`,ids.promoter).expect(403);
      const futureLink = (await api('get',`/business/events/${futureB.id}/referral-link`,ids.promoter).expect(200)).body.data;
      assert.ok(futureLink.code);
    });
    await t.test('revocation invalidates export access, future referral choices and unused private invitations without deleting history',async () => {
      const { createBusinessReadService } = require('../src/services/business-read-service');
      const { createBusinessReportService } = require('../src/services/business-report-service');
      const { createReportExportService } = require('../src/services/report-export-service');
      const { reportDetailQuery } = require('../src/http/business-schemas');
      const read = createBusinessReadService({ models: m }),reports = createBusinessReportService({ models: m,businessRead: read });
      const exports = createReportExportService({ models: m,businessRead: read,reports,smallLimit: 0 });
      let job;
      await exports.request(ids.manager,reportDetailQuery.parse({ exportTable: 'customers',pageSize: 1 }),{ status(code) { assert.equal(code,202); return this; },json(body) { job = body.data; } });
      await exports.drain(); assert.equal((await exports.status(ids.manager,job.id)).totalRows,2);
      const directEmail = `direct-claim-${randomUUID()}@venue.nitewide.test`;
      const direct = await legacyInvite(eventB.id,ids.manager,directEmail);
      grantManager = await grant(venueB.id,ids.manager,'manager',grantManager,'inactive');
      await assert.rejects(exports.status(ids.manager,job.id),{ code: 'FORBIDDEN' }); await exports.stop();
      assert.equal((await m.GuestlistInvitation.findByPk(direct.invitation.id)).status,'revoked');
      grantManager = await grant(venueB.id,ids.manager,'manager',grantManager,'active');
      const directRecipient = await m.User.create({ email: directEmail,displayName: 'Revoked direct invitation recipient' });
      await api('post',`/guestlist-invitations/${direct.token}/claim`,directRecipient.id).expect(404);
      const assignment = await m.EventAffiliate.findOne({ where: { eventId: futureB.id,userId: ids.promoter } });
      await assignment.update({ guestlistAllocation: 5 });
      const email = `claim-${randomUUID()}@venue.nitewide.test`;
      const invite = await legacyInvite(futureB.id,ids.promoter,email,assignment.id);
      assert.ok(invite.token); assert.equal(invite.invitation.status,'pending');
      grantPromoter = await grant(venueB.id,ids.promoter,'promoter',grantPromoter,'inactive');
      await api('get',`/business/events/${eventB.id}/referral-link`,ids.promoter).expect(403);
      const denied = await api('post',`/events/${eventB.id}/referral-visits`,ids.customer).send({ code: link.code }); assert.equal(denied.status,400);
      const connected = (await api('get','/customer/connections',ids.customer).query({ page: 1,pageSize: 30 }).expect(200)).body.data;
      assert.equal(connected.items.length,0);
      assert.equal((await m.GuestlistInvitation.findByPk(invite.invitation.id)).status,'revoked');
      grantPromoter = await grant(venueB.id,ids.promoter,'promoter',grantPromoter,'active');
      const recipient = await m.User.create({ email,displayName: 'Private claim recipient' });
      const claim = await api('post',`/guestlist-invitations/${invite.token}/claim`,recipient.id).expect(404);
      assert.equal(claim.body.error.code,'INVITE_INVALID');
      assert.equal((await m.Order.findByPk(order.id)).eventAffiliateId,order.eventAffiliateId); assert.equal(await m.Ticket.count({ include: [{ model: m.OrderItem,as: 'orderItem',where: { orderId: order.id } }] }),1);
      assert.equal((await m.GuestlistInvitation.findByPk(invite.invitation.id)).status,'revoked');
    });
    await t.test('venue rename preserves canonical history; directory search and event pages remain bounded and stable beyond one thousand records',async () => {
      const current = await m.Location.findByPk(venueB.id);
      const renamed = (await api('patch',`${venuePath(ids.org,false)}/${venueB.id}`,ids.manager).send({ version: current.version,name: 'Renamed Beta room',reason: 'Update canonical venue display name' }).expect(200)).body.data;
      assert.equal(renamed.id,venueB.id); assert.equal((await m.Event.findByPk(eventB.id)).locationId,venueB.id);
      await api('patch',`${venuePath()}/${venueB.id}`).send({ version: renamed.version,addressLine1: 'New historical address',reason: 'Attempt destructive historical address edit' }).expect(409);
      const locations = await m.Location.bulkCreate(Array.from({ length: 1005 },(_,index) => ({ name: `Paged room ${String(index).padStart(4,'0')}`,city: 'Test City',timezone: 'UTC' })));
      await m.OrganizationVenue.bulkCreate(locations.map(location => ({ organizationId: ids.org,locationId: location.id })));
      const first = (await api('get',venuePath()).query({ page: 1,pageSize: 100 }).expect(200)).body.data;
      const last = (await api('get',venuePath()).query({ page: 11,pageSize: 100 }).expect(200)).body.data;
      assert.equal(first.total,1007); assert.equal(first.items.length,100); assert.equal(last.items.length,7);
      assert.equal((await api('get',venuePath()).query({ search: 'Paged room 0999' }).expect(200)).body.data.total,1);
      assert.equal((await api('get',venuePath(ids.org,false),ids.manager).expect(200)).body.data.total,1);
      const bootstrap = (await api('get','/business/bootstrap',ids.owner).expect(200)).body.data;
      assert.ok(bootstrap.venues.length<=100); assert.equal(bootstrap.optionsTruncated.venues,true);
      const pagedEvents = await m.Event.bulkCreate(Array.from({ length: 105 },(_,index) => ({ organizationId: ids.org,locationId: venueB.id,creatorUserId: ids.owner,title: 'Paged venue event',slug: `paged-event-${randomUUID()}`,
        status: 'published',startsAt: new Date(Date.now()+172800000),endsAt: new Date(Date.now()+180000000),guestlistCapacity: 0,isDiscoverable: false })));
      const pages = await Promise.all([1,2].map(page => api('get','/business/events',ids.manager).query({ status: 'all',page,pageSize: 100,sort: 'starts_asc' }).expect(200)));
      const all = pages.flatMap(response => response.body.data.items);
      assert.equal(pages[0].body.data.total,107); assert.equal(all.length,107); assert.equal(new Set(all.map(row => row.id)).size,107);
      assert.ok(pagedEvents.every(event => all.some(row => row.id === event.id)));
    });
    await t.test('admissions remain exact-venue scoped while a suspended organization preserves door continuity',async () => {
      const allowed = (await api('get','/business/admissions/events',ids.employee).expect(200)).body.data;
      assert.ok(allowed.items.some(row => row.id === eventB.id)); assert.ok(!allowed.items.some(row => row.id === eventA.id));
      await api('get',`/business/admissions/events/${eventA.id}`,ids.employee).expect(403);
      const org = await m.Organization.findByPk(ids.org); await org.update({ lifecycleState: 'suspended',status: 'suspended' });
      await api('get',`/business/admissions/events/${eventB.id}`,ids.employee).expect(200);
      assert.equal((await api('get','/business/events',ids.manager).expect(200)).body.data.total,0);
      await org.update({ lifecycleState: 'active',status: 'active' });
      assert.equal(await m.EmailOutbox.count(),0,'venue and demo commerce tests never send or enqueue email');
    });
    await t.test('manager demotion and same-business owner removal revoke only scoped access and unused invitations',async () => {
      const makeInvite = async actor => {
        const email = `scope-revoke-${randomUUID()}@venue.nitewide.test`;
        const invitation = await legacyInvite(eventB.id,actor,email);
        return { ...invitation,email };
      };
      const demotion = await makeInvite(ids.manager);
      grantManager = await grant(venueB.id,ids.manager,'employee',grantManager,'active');
      assert.equal((await m.GuestlistInvitation.findByPk(demotion.invitation.id)).status,'revoked');
      assert.equal((await api('get','/business/events',ids.manager).expect(200)).body.data.items.every(row => !row.canManage),true);
      grantManager = await grant(venueB.id,ids.manager,'manager',grantManager,'active');
      const recipient = await m.User.create({ email: demotion.email,displayName: 'Revoked demotion recipient' });
      await api('post',`/guestlist-invitations/${demotion.token}/claim`,recipient.id).expect(404);
      await m.OrganizationOwner.create({ organizationId: ids.org,userId: ids.other,role: 'owner' });
      const sameBusiness = await grant(venueB.id,ids.other,'manager');
      const otherBusiness = (await api('put',`${venuePath(ids.otherOrg)}/${otherVenue.id}/team/${ids.other}`).send({ role: 'manager',status: 'active',version: null,reason: 'Independent second business access' }).expect(200)).body.data;
      const removed = await makeInvite(ids.other),currentOrg = await m.Organization.findByPk(ids.org);
      await api('post',`/admin/businesses/${ids.org}/ownership/${ids.other}/remove`).send({ version: currentOrg.version,outgoingRole: 'remove',reason: 'Remove all same-business access, preserve other businesses' }).expect(200);
      assert.equal((await m.VenueAccess.findByPk(sameBusiness.id)).status,'inactive');
      assert.equal((await m.VenueAccess.findByPk(otherBusiness.id)).status,'active');
      assert.equal((await m.GuestlistInvitation.findByPk(removed.invitation.id)).status,'revoked');
      await api('get',`${venuePath(ids.org,false)}/${venueB.id}`,ids.other).expect(403);
      await api('get',`${venuePath(ids.otherOrg,false)}/${otherVenue.id}`,ids.other).expect(200);
      assert.equal(await m.Order.count({ where: { buyerUserId: ids.other } }),2,'historical purchase attribution remains intact');
      assert.equal(await m.EmailOutbox.count(),0);
    });
    await t.test('expired or future standalone grants never authorize current reports while historical attribution remains intact',async () => {
      const standalone = await m.User.create({ email: `standalone-${randomUUID()}@venue.nitewide.test`,displayName: 'Standalone event promoter' });
      const assignment = await m.EventAffiliate.create({ eventId: eventA.id,userId: standalone.id,accessScope: 'event',status: 'active',code: `WINDOW-${randomUUID()}`,endsAt: new Date(Date.now()+3600000) });
      const offering = await m.Offering.findOne({ where: { eventId: eventA.id } });
      const history = await m.Order.create({ eventId: eventA.id,buyerUserId: standalone.id,eventAffiliateId: assignment.id,status: 'paid',currency: 'USD',subtotalCents: 777,totalCents: 777,idempotencyKey: randomUUID(),paidAt: new Date() });
      await m.OrderItem.create({ orderId: history.id,offeringId: offering.id,nameSnapshot: offering.name,kindSnapshot: 'ticket',quantity: 1,entriesPerUnitSnapshot: 1,unitPriceCents: 777,lineTotalCents: 777 });
      assert.equal((await api('get','/business/reports/summary',standalone.id).expect(200)).body.data.summary.salesCents,777);
      await api('get',`/business/events/${eventA.id}/detail`,standalone.id).expect(200);
      assert.ok((await api('get','/business/admissions/events',standalone.id).expect(200)).body.data.items.some(row => row.id === eventA.id));
      await assignment.update({ endsAt: new Date(Date.now()-1000) });
      await api('get','/business/bootstrap',standalone.id).expect(403);
      await api('get','/business/events',standalone.id).expect(403);
      await api('get','/business/reports/summary',standalone.id).expect(403);
      await api('get',`/business/events/${eventA.id}/summary`,standalone.id).expect(403);
      await api('get',`/business/events/${eventA.id}/detail`,standalone.id).expect(403);
      await api('get',`/business/events/${eventA.id}/guestlist`,standalone.id).expect(403);
      await api('get',`/business/admissions/events/${eventA.id}`,standalone.id).expect(403);
      await api('get','/business/admissions/events',standalone.id).expect(403);
      await api('post',`/events/${eventA.id}/referral-visits`,ids.customer).send({ code: assignment.code }).expect(400);
      await assignment.update({ endsAt: null,startsAt: new Date(Date.now()+86400000) });
      await api('get','/business/events',standalone.id).expect(403);
      await api('get',`/business/events/${eventA.id}/detail`,standalone.id).expect(403);
      await api('get',`/business/events/${eventA.id}/guestlist`,standalone.id).expect(403);
      await api('get',`/business/admissions/events/${eventA.id}`,standalone.id).expect(403);
      await api('get','/business/admissions/events',standalone.id).expect(403);
      assert.equal((await m.Order.findByPk(history.id)).eventAffiliateId,assignment.id);
      assert.equal(await m.OrderItem.count({ where: { orderId: history.id } }),1);
      assert.equal(await m.EmailOutbox.count(),0);
    });
    await t.test('first venue terms remain bound, revoked setters are denied, and copying never promotes venue access to a standalone grant',async () => {
      const employeeAssignment = await m.EventAffiliate.findOne({ where: { eventId: eventB.id,userId: ids.employee } });
      grantEmployee = await grant(venueB.id,ids.employee,'employee',grantEmployee,'inactive');
      await api('put',`/business/events/${eventB.id}/people`,ids.manager).send({ userId: ids.employee,commissionBps: 700,status: 'active' }).expect(403);
      assert.equal((await m.EventAffiliate.findByPk(employeeAssignment.id)).commissionBps,0);
      grantEmployee = await grant(venueB.id,ids.employee,'employee',grantEmployee,'active');
      await api('put',`/business/events/${eventA.id}/people`,ids.owner).send({ userId: ids.employee,commissionBps: 500,status: 'active' }).expect(403);
      await employeeAssignment.update({ guestlistAllocation: 3 });
      const invalid = await m.User.bulkCreate(['expired-copy','future-copy','revoked-copy'].map(name => ({ email: `${name}-${randomUUID()}@venue.nitewide.test`,displayName: name })));
      let revokedGrant = await grant(venueB.id,invalid[2].id,'promoter');
      await m.EventAffiliate.bulkCreate([
        { eventId: eventB.id,userId: invalid[0].id,accessScope: 'event',code: `COPY-${randomUUID()}`,status: 'active',endsAt: new Date(Date.now()-1000) },
        { eventId: eventB.id,userId: invalid[1].id,accessScope: 'event',code: `COPY-${randomUUID()}`,status: 'active',startsAt: new Date(Date.now()+86400000) },
        { eventId: eventB.id,userId: invalid[2].id,accessScope: 'venue',venueAccessId: revokedGrant.id,code: `COPY-${randomUUID()}`,status: 'active' },
      ]);
      revokedGrant = await grant(venueB.id,invalid[2].id,'promoter',revokedGrant,'inactive');
      const target = async locationId => (await api('post','/business/events',ids.owner).send({ ...eventInput(locationId,'Scoped copy target'),status: 'draft' }).expect(201)).body.data;
      const same = await target(venueB.id),other = await target(venueA.id),afterRevocation = await target(venueB.id),invalidPricing = await target(venueB.id);
      const copy = async eventId => (await api('post',`/business/events/${eventId}/copy-access`,ids.owner).send({ sourceEventId: eventB.id,copyTeam: true,copyAllocations: true }).expect(200)).body.data;
      assert.equal((await copy(same.id)).copied,2); assert.equal((await copy(same.id)).copied,0);
      const copied = await m.EventAffiliate.findAll({ where: { eventId: same.id } });
      assert.equal(copied.length,2); assert.ok(copied.every(row => row.accessScope==='venue'));
      const employeeCopy = copied.find(row => row.userId===ids.employee),promoterCopy = copied.find(row => row.userId===ids.promoter);
      assert.equal(employeeCopy.venueAccessId,grantEmployee.id); assert.equal(employeeCopy.commissionBps,0); assert.equal(employeeCopy.guestlistAllocation,3);
      assert.notEqual(employeeCopy.code,employeeAssignment.code); assert.equal(promoterCopy.venueAccessId,grantPromoter.id);
      assert.ok(!copied.some(row => invalid.some(person => person.id===row.userId)));
      assert.equal((await copy(other.id)).copied,0); assert.equal(await m.EventAffiliate.count({ where: { eventId: other.id } }),0);
      grantEmployee = await grant(venueB.id,ids.employee,'employee',grantEmployee,'inactive');
      assert.equal((await copy(afterRevocation.id)).copied,1);
      assert.equal(await m.EventAffiliate.count({ where: { eventId: afterRevocation.id,userId: ids.employee } }),0);
      const invalidOffering = await m.Offering.findOne({ where: { eventId: invalidPricing.id } });
      await invalidOffering.update({ priceCents: 999 }); await m.Event.update({ feeMode: 'absorbed' },{ where: { id: invalidPricing.id } });
      const rejected = await api('post',`/business/events/${invalidPricing.id}/copy-access`,ids.owner).send({ sourceEventId: eventB.id,copyTeam: true,copyAllocations: false }).expect(422);
      assert.equal(rejected.body.error.code,'PRICING_EDITOR_INVALID'); assert.equal(await m.EventAffiliate.count({ where: { eventId: invalidPricing.id } }),0);
      assert.equal((await m.Order.findByPk(order.id)).eventAffiliateId,order.eventAffiliateId);
      assert.equal(await m.EmailOutbox.count(),0);
    });
  } finally { await db.close(); }
});
