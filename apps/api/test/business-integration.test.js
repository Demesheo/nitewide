// Opt in against the LOCAL development database. Only this test's UUID-scoped
// fixtures are removed; no seed, truncate, or existing-record updates occur.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
test(
  "business HTTP workflow: real PostgreSQL, authentication, isolation, sales, create/edit and approvals",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    require("dotenv").config({
      path: require("node:path").resolve(__dirname, "../../../.env"),
    });
    const { getConfig } = require("../src/config");
    const { createSequelize } = require("../src/db/sequelize");
    const { initModels } = require("../src/db/models");
    const { createApp } = require("../src/app");
    const { signToken } = require("../src/services/auth-service");
    const { Op } = require("sequelize");
    const config = getConfig();
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const mediaDir = await fs.mkdtemp(
      path.join(require("node:os").tmpdir(), "nitewide-media-test-"),
    );
    assert.notEqual(
      config.NODE_ENV,
      "production",
      "Never run fixture tests against production",
    );
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(config.DATABASE_URL).hostname,
      ),
      "Integration fixtures require a local database",
    );
    const sequelize = createSequelize(config);
    const m = initModels(sequelize);
    const ids = {
      owner: randomUUID(),
      manager: randomUUID(),
      promoter: randomUUID(),
      employee: randomUUID(),
      outsider: randomUUID(),
      invitedDirect: randomUUID(),
      invitedReferral: randomUUID(),
      invitedEmployee: randomUUID(),
      eventPromoter: randomUUID(),
      matrixCustomer: randomUUID(),
      org: randomUUID(),
      secondOrg: randomUUID(),
      affiliate: randomUUID(),
    };
    const users = [ids.owner, ids.manager, ids.promoter, ids.employee, ids.outsider, ids.invitedDirect, ids.invitedReferral, ids.invitedEmployee, ids.eventPromoter, ids.matrixCustomer];
    const events = [];
    const locations = new Set();
    let server;
    const input = {
      organizationId: ids.org,
      title: "Integration fixture",
      slug: `qa-${randomUUID()}`,
      summary: "Automated test only",
      description: "",
      category: "private",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      status: "published",
      isDiscoverable: false,
      capacity: 100,
      guestlistCapacity: 5,
      location: {
        name: "QA venue",
        addressLine1: "",
        city: "Orlando",
        region: "FL",
        postalCode: "",
        countryCode: "US",
        timezone: "America/New_York",
        privacy: "private",
      },
      offerings: [
        {
          name: "QA ticket",
          kind: "ticket",
          priceCents: 1000,
          inventoryMode: "finite",
          quantityTotal: 20,
          entriesPerUnit: 1,
          minPerOrder: 1,
          maxPerOrder: 10,
          isActive: true,
        },
      ],
    };
    try {
      await m.User.bulkCreate(
        users.map((id) => ({
          id,
          displayName: `QA ${Object.keys(ids).find((k) => ids[k] === id)}`,
          email: `${id}@integration.nitewide.test`,
          isActive: true,
        })),
      );
      const venueLocation = await m.Location.create(input.location);
      locations.add(venueLocation.id);
      await m.Organization.create({
        id: ids.org,
        name: "Integration fixture",
        slug: `qa-${ids.org}`,
        locationId: venueLocation.id,
      });
      await m.OrganizationOwner.bulkCreate([
        { organizationId: ids.org, userId: ids.owner, role: "owner" },
        { organizationId: ids.org, userId: ids.manager, role: "admin" },
      ]);
      await m.OrganizationEmployee.create({ organizationId: ids.org, userId: ids.employee, status: 'active' });
      await m.OrgAffiliate.create({
        id: ids.affiliate,
        organizationId: ids.org,
        userId: ids.promoter,
        code: `QA-${ids.org.slice(0, 8)}`,
        defaultCommissionBps: 1000,
        defaultGuestlistAllocation: 20,
      });
      const app = createApp({
        sequelize,
        models: m,
        config: {
          ...config,
          NODE_ENV: "production",
          MEDIA_UPLOAD_DIR: mediaDir,
        },
      }); // Disables the development identity header.
      server = app.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      async function req(path, user, method = "GET", body) {
        const token = user
          ? signToken(
              { sub: user, exp: Math.floor(Date.now() / 1000) + 300 },
              config.AUTH_TOKEN_SECRET,
            )
          : null;
        const res = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
      }
      assert.equal((await req("/business/workspace", null)).status, 401);
      async function upload(user, bytes, name = "flyer.png") {
        const body = new FormData();
        body.append("image", new Blob([bytes], { type: "image/png" }), name);
        const token = user
          ? signToken(
              { sub: user, exp: Math.floor(Date.now() / 1000) + 300 },
              config.AUTH_TOKEN_SECRET,
            )
          : null;
        const res = await fetch(base + "/business/uploads/image", {
          method: "POST",
          body,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        return { status: res.status, body: await res.json() };
      }
      const png = await require("sharp")({
        create: { width: 200, height: 300, channels: 3, background: "#F10393" },
      })
        .png()
        .toBuffer();
      assert.equal((await upload(null, png)).status, 401);
      assert.equal(
        (await upload(ids.manager, Buffer.from("fake image"))).status,
        422,
      );
      assert.equal(
        (await upload(ids.manager, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
        422,
      );
      const artwork = await upload(ids.manager, png);
      assert.equal(artwork.status, 201, JSON.stringify(artwork.body));
      input.imageAssetId = artwork.body.data.id;
      const imageResponse = await fetch(
        base.replace(/\/api$/, "") + artwork.body.data.url,
      );
      assert.equal(imageResponse.status, 200);
      assert.equal(imageResponse.headers.get("content-type"), "image/webp");
      assert.equal(
        (
          await req("/business/events", ids.owner, "POST", {
            ...input,
            slug: `shared-artwork-${randomUUID()}`,
          })
        ).status,
        201,
      );
      assert.equal((await req('/business/events', ids.owner, 'POST', { ...input, imageAssetId: randomUUID(), slug: `missing-artwork-${randomUUID()}` })).status, 404);
      assert.equal(
        (await req("/business/events", ids.promoter, "POST", input)).status,
        403,
      );
      assert.equal(
        (await req("/business/events", ids.outsider, "POST", input)).status,
        403,
      );
      const created = await req("/business/events", ids.manager, "POST", input);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const event = created.body.data;
      events.push(event.id);
      locations.add(event.locationId);
      assert.equal(
        (await req(`/events/${event.id}`, null)).body.data.imageUrl,
        artwork.body.data.url,
      );
      const tiers = await m.Offering.findAll({ where: { eventId: event.id } });
      assert.equal(tiers.length, 1);
      const eventAffiliate = await m.EventAffiliate.create({
        eventId: event.id,
        userId: ids.promoter,
        orgAffiliateId: ids.affiliate,
        code: `QAE-${event.id.slice(0, 8)}`,
        guestlistAllocation: 20,
      });
      const linkCodes = new Set();
      for (const person of [ids.owner, ids.manager, ids.employee, ids.promoter]) {
        const link = await req(`/business/events/${event.id}/referral-link`, person);
        assert.equal(link.status, 200, JSON.stringify(link.body));
        assert.equal(link.body.data.eventId, event.id);
        assert.ok(link.body.data.code);
        linkCodes.add(link.body.data.code);
      }
      assert.equal(linkCodes.size, 4, 'each authorized person gets a unique event code');
      assert.equal((await req(`/business/events/${event.id}/referral-link`, ids.outsider)).status, 403);
      const visitKey = randomUUID();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const visit = await req(`/events/${event.id}/referral-visits`, null, 'POST', { code: eventAffiliate.code, sessionKey: visitKey });
        assert.equal(visit.status, 200, JSON.stringify(visit.body));
        assert.equal(visit.body.data.referrerName, 'QA promoter');
      }
      assert.equal(await m.AffiliateAttribution.count({ where: { eventId: event.id, action: 'visit', sessionKey: visitKey } }), 1);
      assert.equal((await req(`/events/${event.id}/referral-visits`, null, 'POST', { code: 'INVALID', sessionKey: randomUUID() })).status, 400);
      const inviteEvent = await req('/business/events', ids.owner, 'POST', { ...input, guestlistCapacity: 3, slug: `invite-${randomUUID()}` });
      assert.equal(inviteEvent.status, 201, JSON.stringify(inviteEvent.body));
      const guestInviteEventId = inviteEvent.body.data.id;
      events.push(guestInviteEventId);
      locations.add(inviteEvent.body.data.locationId);
      const inviteAffiliate = await m.EventAffiliate.create({ eventId: guestInviteEventId, userId: ids.promoter, orgAffiliateId: ids.affiliate, code: `QAI-${guestInviteEventId.slice(0,8)}`, guestlistAllocation: 2 });
      const employeeInviteAffiliate = await m.EventAffiliate.create({ eventId: guestInviteEventId, userId: ids.employee, code: `QASTAFF-${guestInviteEventId.slice(0,8)}`, guestlistAllocation: 1 });
      const guestInvitePath = `/business/events/${guestInviteEventId}/guestlist-invitations`;
      const draftInviteEvent = await req('/business/events', ids.owner, 'POST', { ...input, status: 'draft', slug: `draft-invite-${randomUUID()}` });
      assert.equal(draftInviteEvent.status, 201, JSON.stringify(draftInviteEvent.body));
      const draftInviteEventId = draftInviteEvent.body.data.id;
      events.push(draftInviteEventId);
      locations.add(draftInviteEvent.body.data.locationId);
      const closedPools = await req(`/business/events/${draftInviteEventId}/guestlist-invite-pools`, ids.owner);
      assert.equal(closedPools.status, 200);
      assert.deepEqual(closedPools.body.data, { direct: false, own: [], open: false });
      const draftInvite = await req(`/business/events/${draftInviteEventId}/guestlist-invitations`, ids.owner, 'POST', { pool: 'direct', email: `draft-${randomUUID()}@integration.nitewide.test`, partySize: 1 });
      assert.equal(draftInvite.status, 409);
      assert.equal(draftInvite.body.error.code, 'GUESTLIST_CLOSED');
      assert.equal((await req(`/business/events/${draftInviteEventId}/guestlist-invitations`, ids.outsider, 'POST', { pool: 'direct', email: `draft-${randomUUID()}@integration.nitewide.test`, partySize: 1 })).status, 403);
      const pools = await req(`/business/events/${guestInviteEventId}/guestlist-invite-pools`, ids.promoter);
      assert.equal(pools.body.data.direct, false);
      assert.ok(pools.body.data.own.some((pool) => pool.id === inviteAffiliate.id));
      const employeePools = await req(`/business/events/${guestInviteEventId}/guestlist-invite-pools`, ids.employee);
      assert.equal(employeePools.body.data.direct, false);
      assert.deepEqual(employeePools.body.data.own.map((pool) => pool.id), [employeeInviteAffiliate.id]);
      assert.equal((await req(guestInvitePath, ids.promoter, 'POST', { pool: 'direct', email: `${ids.invitedDirect}@integration.nitewide.test`, partySize: 1 })).status, 403);
      assert.equal((await req(guestInvitePath, ids.outsider, 'POST', { pool: 'direct', email: `${ids.invitedDirect}@integration.nitewide.test`, partySize: 1 })).status, 403);
      const existingDirect = await req(guestInvitePath, ids.owner, 'POST', { pool: 'direct', email: `${ids.invitedDirect}@integration.nitewide.test`, partySize: 1 });
      assert.equal(existingDirect.status, 201, JSON.stringify(existingDirect.body));
      assert.equal(existingDirect.body.data.invitation.status, 'accepted');
      const existingReferral = await req(guestInvitePath, ids.promoter, 'POST', { pool: 'own', eventAffiliateId: inviteAffiliate.id, email: `${ids.invitedReferral}@integration.nitewide.test`, partySize: 1 });
      assert.equal(existingReferral.status, 201, JSON.stringify(existingReferral.body));
      assert.equal((await m.GuestlistEntry.findByPk(existingReferral.body.data.entryId)).eventAffiliateId, inviteAffiliate.id);
      const employeeReferral = await req(guestInvitePath, ids.employee, 'POST', { pool: 'own', eventAffiliateId: employeeInviteAffiliate.id, email: `${ids.invitedEmployee}@integration.nitewide.test`, partySize: 1 });
      assert.equal(employeeReferral.status, 201, JSON.stringify(employeeReferral.body));
      assert.equal((await m.GuestlistEntry.findByPk(employeeReferral.body.data.entryId)).eventAffiliateId, employeeInviteAffiliate.id);
      const inviteNotification = await req('/notifications', ids.invitedDirect);
      assert.equal(inviteNotification.body.data.unreadCount, 1);
      assert.equal(inviteNotification.body.data.items[0].kind, 'guestlist_invited');
      assert.equal(inviteNotification.body.data.items[0].metadata.entryId, existingDirect.body.data.entryId);
      assert.equal((await req(`/customer/guestlists/${existingDirect.body.data.entryId}/pass`, ids.invitedDirect)).body.data.id, existingDirect.body.data.entryId);
      assert.equal((await req(`/customer/guestlists/${existingDirect.body.data.entryId}/pass`, ids.outsider)).status, 404);
      assert.equal((await req(`/notifications/${inviteNotification.body.data.items[0].id}/read`, ids.outsider, 'POST')).status, 404);
      assert.equal((await req(`/notifications/${inviteNotification.body.data.items[0].id}/read`, ids.invitedDirect, 'POST')).status, 200);
      const notificationId = inviteNotification.body.data.items[0].id;
      assert.equal((await req(`/notifications/${notificationId}`, null, 'DELETE')).status, 401);
      assert.equal((await req(`/notifications/${notificationId}`, ids.outsider, 'DELETE')).status, 404);
      assert.equal((await req(`/notifications/${notificationId}`, ids.invitedDirect, 'DELETE')).status, 200);
      assert.equal((await req(`/notifications/${notificationId}`, ids.invitedDirect, 'DELETE')).status, 200);
      assert.equal((await req('/notifications', ids.invitedDirect)).body.data.items.length, 0);
      assert.ok((await m.Notification.findByPk(notificationId)).dismissedAt);
      await m.Notification.bulkCreate(Array.from({ length: 55 }, (_, index) => ({ userId: ids.invitedDirect, kind: 'test', title: `Clear fixture ${index}`, message: 'Integration fixture' })));
      assert.equal((await req('/notifications', null, 'DELETE')).status, 401);
      assert.equal((await req('/notifications', ids.invitedDirect, 'DELETE')).body.data.dismissed, 55);
      assert.equal((await req('/notifications', ids.invitedDirect)).body.data.unreadCount, 0);
      assert.ok((await req('/notifications', ids.invitedReferral)).body.data.items.length > 0);
      const pending = await req(guestInvitePath, ids.owner, 'POST', { pool: 'direct', email: `new-${randomUUID()}@integration.nitewide.test`, partySize: 1 });
      assert.equal(pending.body.data.invitation.status, 'pending');
      assert.ok(pending.body.data.token);
      assert.equal((await req(guestInvitePath, ids.owner, 'POST', { pool: 'direct', email: pending.body.data.invitation.email, partySize: 1 })).status, 409);
      const registered = await req('/auth/register', null, 'POST', { displayName: 'New guest', email: pending.body.data.invitation.email, password: 'NitewideDemo!2026', guestlistInviteToken: pending.body.data.token });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      assert.equal(registered.body.data.guestlistInvite.status, 'confirmed');
      users.push(registered.body.data.user.id);
      const repeatedClaim = await req(`/guestlist-invitations/${pending.body.data.token}/claim`, registered.body.data.user.id, 'POST');
      assert.equal(repeatedClaim.status, 200);
      assert.equal(repeatedClaim.body.data.status, 'confirmed');
      const phonePending = await req(guestInvitePath, ids.owner, 'POST', { pool: 'direct', phone: '+14075550199', partySize: 1 });
      assert.equal(phonePending.status, 201, JSON.stringify(phonePending.body));
      const phoneRegistered = await req('/auth/register', null, 'POST', { displayName: 'Phone guest', email: `phone-${randomUUID()}@integration.nitewide.test`, phone: '+14075550199', password: 'NitewideDemo!2026', guestlistInviteToken: phonePending.body.data.token });
      assert.equal(phoneRegistered.status, 201, JSON.stringify(phoneRegistered.body));
      assert.equal(phoneRegistered.body.data.guestlistInvite.status, 'confirmed');
      users.push(phoneRegistered.body.data.user.id);
      const fullPending = await req(guestInvitePath, ids.owner, 'POST', { pool: 'direct', email: `full-${randomUUID()}@integration.nitewide.test`, partySize: 1 });
      const fullRegistered = await req('/auth/register', null, 'POST', { displayName: 'Waitlisted guest', email: fullPending.body.data.invitation.email, password: 'NitewideDemo!2026', guestlistInviteToken: fullPending.body.data.token });
      assert.equal(fullRegistered.status, 201, JSON.stringify(fullRegistered.body));
      assert.equal(fullRegistered.body.data.guestlistInvite.status, 'full');
      users.push(fullRegistered.body.data.user.id);
      assert.equal(await m.GuestlistEntry.count({ where: { eventId: guestInviteEventId, eventAffiliateId: null, status: 'confirmed' } }), 3);
      const checkout = await req("/orders", ids.outsider, "POST", {
        eventId: event.id,
        idempotencyKey: randomUUID(),
        affiliateCode: eventAffiliate.code,
        items: [{ offeringId: tiers[0].id, quantity: 2 }],
        payment: {
          provider: "test",
          reference: randomUUID(),
          status: "succeeded",
        },
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
      assert.equal(checkout.body.data.order.subtotalCents, 2000);
      assert.equal(checkout.body.data.order.platformFeeCents, 320);
      assert.equal(checkout.body.data.order.totalCents, 2320);
      assert.equal(checkout.body.data.order.pricingPlanSnapshot.processingPaidBy, 'platform');
      const buyerNotifications = (await req('/notifications', ids.outsider)).body.data.items;
      assert.ok(buyerNotifications.some((item) => item.kind === 'purchase_confirmed' && item.eventId === event.id));
      const referrerNotifications = (await req('/notifications', ids.promoter)).body.data.items;
      assert.ok(referrerNotifications.some((item) => item.kind === 'referral_purchase' && item.metadata.orderId === checkout.body.data.order.id));
      const ownerNotifications = (await req('/notifications', ids.owner)).body.data.items;
      assert.ok(ownerNotifications.some((item) => item.kind === 'event_purchase' && item.metadata.referrerUserId === ids.promoter));
      const purchaseDetail = await req(`/business/events/${event.id}/detail`, ids.owner);
      assert.equal(purchaseDetail.status, 200);
      assert.ok(purchaseDetail.body.data.purchases.some((purchase) => purchase.id === checkout.body.data.order.id && purchase.customer === 'QA outsider' && purchase.referredBy === 'QA promoter'));
      const report = await req(
        `/business/workspace?organizationId=${ids.org}&days=7`,
        ids.owner,
      );
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.data.report.summary.salesCents, 2000);
      assert.equal(
        report.body.data.report.people.find((p) => p.id === ids.promoter)
          .salesCents,
        2000,
      );
      assert.equal(report.body.data.events[0].canManage, true);
      const promoterReport = await req(
        `/business/workspace?organizationId=${ids.org}`,
        ids.promoter,
      );
      assert.equal(promoterReport.body.data.events[0].canManage, false);
      assert.equal(promoterReport.body.data.scope, 'own');
      assert.equal(promoterReport.body.data.report.people.length, 1);
      const employeeWorkspace = (await req(`/business/workspace?organizationId=${ids.org}`,ids.employee)).body.data;
      assert.equal(employeeWorkspace.scope,'own');
      assert.equal(employeeWorkspace.report.summary.salesCents,0,'another promoter’s sale is invisible to staff');
      assert.deepEqual(employeeWorkspace.report.people.map((person)=>person.id),[ids.employee]);
      const employeeAnalytics = (await req(`/business/analytics?days=30&organizationIds=${ids.org}`,ids.employee)).body.data;
      assert.equal(employeeAnalytics.scope,'own');
      assert.equal(employeeAnalytics.summary.salesCents,0);
      assert.deepEqual(employeeAnalytics.referrals.people.map((person)=>person.id),[ids.employee]);
      assert.equal(employeeAnalytics.referrals.customers.length,1);
      assert.equal(employeeAnalytics.referrals.customers[0].guestlistPlaces,1);
      assert.equal(employeeAnalytics.referrals.customers[0].salesCents,0,'guestlist-only customers do not invent sales');
      const promoterAnalytics = (await req(`/business/analytics?days=30&organizationIds=${ids.org}`,ids.promoter)).body.data;
      assert.equal(promoterAnalytics.scope,'own');
      assert.equal(promoterAnalytics.summary.salesCents,2000);
      assert.deepEqual(promoterAnalytics.referrals.people.map((person)=>person.id),[ids.promoter]);
      const outsider = await req(
        `/business/workspace?organizationId=${ids.org}`,
        ids.outsider,
      );
      assert.equal(outsider.body.data.events.length, 0);
      assert.equal(outsider.body.data.report.summary.salesCents, 0);
      const edit = {
        ...input,
        version: event.version,
        title: "Updated fixture",
        offerings: [{ ...input.offerings[0], id: tiers[0].id }],
      };
      assert.equal(
        (await req(`/business/events/${event.id}`, ids.promoter, "PUT", edit))
          .status,
        403,
      );
      assert.equal(
        (await req(`/business/events/${event.id}`, ids.outsider, "PUT", edit))
          .status,
        403,
      );
      assert.equal(
        (
          await req(`/business/events/${event.id}`, ids.manager, "PUT", {
            ...edit,
            offerings: [{ ...edit.offerings[0], quantityTotal: 1 }],
          })
        ).status,
        409,
      );
      const updated = await req(
        `/business/events/${event.id}`,
        ids.manager,
        "PUT",
        edit,
      );
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      locations.add(updated.body.data.locationId);
      assert.equal(updated.body.data.title, "Updated fixture");
      assert.equal((await tiers[0].reload()).quantitySold, 2);
      assert.equal(
        (await req(`/business/events/${event.id}`, ids.owner, "PUT", edit))
          .status,
        409,
      );
      const request = await req(
        `/events/${event.id}/guestlist`,
        ids.outsider,
        "POST",
        { partySize: 2 },
      );
      assert.equal(request.status, 202);
      assert.ok((await req('/notifications', ids.owner)).body.data.items.some((item) => item.kind === 'guestlist_request' && item.eventId === event.id));
      assert.equal(
        (await req(`/business/events/${event.id}/guestlist`, ids.outsider))
          .status,
        403,
      );
      assert.equal((await req(`/business/events/${event.id}/guestlist/${request.body.data.entry.id}/decision`, ids.promoter, "POST", { decision: "approve" })).status, 403);
      const approval = await req(
        `/business/events/${event.id}/guestlist/${request.body.data.entry.id}/decision`,
        ids.manager,
        "POST",
        { decision: "approve" },
      );
      assert.equal(approval.status, 200);
      assert.ok((await req('/notifications', ids.outsider)).body.data.items.some((item) => item.kind === 'guestlist_approved' && item.eventId === event.id));
      assert.equal(
        (
          await req(
            `/business/events/${event.id}/guestlist-capacity`,
            ids.manager,
            "PATCH",
            { guestlistCapacity: 1 },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            `/business/events/${event.id}/guestlist-capacity`,
            ids.manager,
            "PATCH",
            { guestlistCapacity: 50 },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req(
            `/business/events/${event.id}/affiliates/${eventAffiliate.id}/guestlist-allocation`,
            ids.manager,
            "PATCH",
            { guestlistAllocation: 20 },
          )
        ).status,
        200,
      );
      const settings = await req(
        `/business/events/${event.id}/guestlist-settings`,
        ids.manager,
      );
      assert.equal(settings.body.data.direct.capacity, 50);
      assert.equal(settings.body.data.direct.used, 2);
      assert.equal(
        settings.body.data.promoters[0].effectiveGuestlistAllocation,
        20,
      );
      const cancelledDirect = await req(
        `/business/events/${event.id}/guestlist/${request.body.data.entry.id}/decision`,
        ids.manager,
        "POST",
        { decision: "cancel" },
      );
      assert.equal(cancelledDirect.status, 200, JSON.stringify(cancelledDirect.body));
      assert.equal(cancelledDirect.body.data.entry.status, "rejected");
      assert.equal(cancelledDirect.body.data.entry.qrTokenHash, null);
      assert.equal((await req(`/business/events/${event.id}/guestlist-settings`, ids.manager)).body.data.direct.used, 0);
      const referredRequest = await req(`/events/${event.id}/guestlist`, ids.manager, "POST", { partySize: 2, affiliateCode: eventAffiliate.code });
      assert.equal(referredRequest.status, 202);
      assert.equal((await req(`/business/events/${event.id}/guestlist/${referredRequest.body.data.entry.id}/decision`, ids.promoter, "POST", { decision: "approve" })).status, 200);
      const referredSettings = await req(`/business/events/${event.id}/guestlist-settings`, ids.manager);
      assert.equal(referredSettings.body.data.promoters.find((person) => person.id === eventAffiliate.id).used, 2);
      assert.equal((await req(`/business/events/${event.id}/guestlist/${referredRequest.body.data.entry.id}/decision`, ids.owner, "POST", { decision: "cancel" })).status, 200);
      const releasedSettings = await req(`/business/events/${event.id}/guestlist-settings`, ids.manager);
      assert.equal(releasedSettings.body.data.promoters.find((person) => person.id === eventAffiliate.id).used, 0);
      const declinedReferral = await req(`/events/${event.id}/guestlist`, ids.owner, "POST", { partySize: 1, affiliateCode: eventAffiliate.code });
      assert.equal(declinedReferral.status, 202);
      const deniedByReferrer = await req(`/business/events/${event.id}/guestlist/${declinedReferral.body.data.entry.id}/decision`, ids.promoter, "POST", { decision: "reject" });
      assert.equal(deniedByReferrer.status, 200);
      assert.equal(deniedByReferrer.body.data.entry.status, 'rejected');
      assert.equal(deniedByReferrer.body.data.entry.reviewedByUserId, ids.promoter);
      const laterApproval = await req(`/business/events/${event.id}/guestlist/${declinedReferral.body.data.entry.id}/decision`, ids.promoter, "POST", { decision: "approve" });
      assert.equal(laterApproval.status, 200);
      assert.equal(laterApproval.body.data.entry.status, 'confirmed');
      // Event detail uses full paid history, authorizes each role, and snapshots commissions.
      assert.equal((await req(`/business/events/${event.id}/detail`, ids.outsider)).status, 403);
      const detail = await req(`/business/events/${event.id}/detail`, ids.owner);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal(detail.body.data.summary.salesCents, 2000);
      assert.equal(detail.body.data.summary.admissions, 2);
      assert.equal(detail.body.data.customers.find((c) => c.id === ids.outsider).salesCents, 2000);
      assert.equal('paidCents' in detail.body.data.customers.find((c) => c.id === ids.outsider), false);
      assert.equal('customerPaidCents' in detail.body.data.summary, false);
      assert.equal('platformFeeCents' in detail.body.data.summary, false);
      assert.equal(detail.body.data.candidates.find((p) => p.userId === ids.employee).role, 'Employee');
      assert.equal((await req(`/business/events/${event.id}/detail`, ids.employee)).body.data.summary.salesCents, 0);
      for (const actor of [ids.employee, ids.promoter, ids.outsider]) {
        assert.equal((await req(`/business/events/${event.id}/people`, actor, 'PUT', {userId:ids.promoter,commissionBps:2500,status:'active'})).status,403);
      }
      assert.equal((await req(`/business/events/${event.id}/people`, ids.manager, 'PUT', {userId:ids.outsider,commissionBps:1000,status:'active'})).status,403);
      assert.equal((await req(`/business/events/${event.id}/people`, ids.manager, 'PUT', {userId:ids.promoter,commissionBps:4001,status:'active'})).status,422);
      assert.equal((await req(`/business/events/${event.id}/people`, ids.manager, 'PUT', {userId:ids.promoter,commissionBps:2500,status:'active'})).status,200);
      assert.equal((await req(`/business/events/${event.id}/people`, ids.owner, 'PUT', {userId:ids.employee,commissionBps:1500,status:'active'})).status,200);
      assert.equal((await req(`/business/events/${event.id}/people`, ids.owner, 'PUT', {userId:ids.manager,commissionBps:0,status:'active'})).status,200);
      const beforeOrder = await m.Order.findByPk(checkout.body.data.order.id);
      assert.equal(beforeOrder.affiliateCommissionCents,200);
      assert.equal(beforeOrder.pricingPlanSnapshot.commissionBps,1000);
      // Organization editor ignores forged location, generates URL, and releases tiers transactionally.
      const otherVenue = await m.Location.create({ ...input.location, name:'Another venue', addressLine1:'22 Other Street' });
      locations.add(otherVenue.id);
      await m.Organization.update({locationId:otherVenue.id},{where:{id:ids.org}});
      const tierEdit = {
        ...input, slug:undefined, category:undefined, version:detail.body.data.event.version,
        location:{...input.location,city:'Forged city',addressLine1:'999 Wrong Address'},
        offerings:[{...input.offerings[0],id:tiers[0].id,quantityTotal:3},
          {...input.offerings[0],name:'Second release',priceCents:2000,releaseAfterIndex:0},
          {...input.offerings[0],name:'Scheduled release',priceCents:3000,salesStartAt:new Date(Date.now()+3600000).toISOString()},
          {...input.offerings[0],name:'Third release',priceCents:4000,releaseAfterIndex:1}],
      };
      const tierUpdate = await req(`/business/events/${event.id}`,ids.manager,'PUT',tierEdit);
      assert.equal(tierUpdate.status,200,JSON.stringify(tierUpdate.body));
      assert.equal(tierUpdate.body.data.locationId,venueLocation.id,'editing preserves this event’s venue even when the organization default differs');
      assert.equal((await m.Location.findByPk(venueLocation.id)).city,'Orlando');
      const updatedTiers = await m.Offering.findAll({where:{eventId:event.id},order:[['sortOrder','ASC']]});
      assert.equal(updatedTiers[1].releaseAfterOfferingId,tiers[0].id);
      assert.equal(updatedTiers[3].releaseAfterOfferingId,updatedTiers[1].id);
      const buy = (offeringId, code = eventAffiliate.code) => req('/orders',ids.outsider,'POST',{eventId:event.id,idempotencyKey:randomUUID(),affiliateCode:code,items:[{offeringId,quantity:1}],payment:{provider:'test',reference:randomUUID(),status:'succeeded'}});
      assert.equal((await buy(updatedTiers[1].id)).body.error.code,'OFFERING_NOT_ON_SALE');
      assert.equal((await buy(updatedTiers[2].id)).body.error.code,'OFFERING_NOT_ON_SALE');
      assert.equal((await buy(updatedTiers[3].id)).body.error.code,'OFFERING_NOT_ON_SALE');
      const lastEarly = await buy(tiers[0].id);
      assert.equal(lastEarly.status,201);
      assert.equal(lastEarly.body.data.order.affiliateCommissionCents,250);
      const publicTiers = (await req(`/events/${event.id}`,null)).body.data.offerings;
      assert.equal(publicTiers.find((t) => t.id === updatedTiers[1].id).saleState,'on_sale');
      assert.equal(publicTiers.find((t) => t.id === updatedTiers[2].id).saleState,'scheduled');
      assert.equal((await req(`/business/events/${event.id}/people`,ids.manager,'PUT',{userId:ids.promoter,commissionBps:4000,status:'active'})).status,200);
      const lateOrder = await buy(updatedTiers[1].id);
      assert.equal(lateOrder.status,201);
      assert.equal(lateOrder.body.data.order.affiliateCommissionCents,800);
      assert.equal((await beforeOrder.reload()).affiliateCommissionCents,200);
      assert.equal((await req(`/business/events/${event.id}/people`,ids.manager,'PUT',{userId:ids.promoter,commissionBps:4000,status:'inactive'})).status,200);
      assert.equal((await buy(updatedTiers[1].id)).body.error.code,'INVALID_AFFILIATE');
      const orgCode = (await m.OrgAffiliate.findByPk(ids.affiliate)).code;
      assert.equal((await buy(updatedTiers[1].id,orgCode)).body.error.code,'INVALID_AFFILIATE','removal also blocks the organization referral code');
      const afterDetail = (await req(`/business/events/${event.id}/detail`,ids.owner)).body.data;
      assert.equal(afterDetail.summary.salesCents,5000);
      assert.equal(afterDetail.summary.commissionCents,1250);
      assert.equal(afterDetail.people.find((p) => p.userId === ids.promoter).commissionCents,1250);
      assert.equal(afterDetail.people.find((p) => p.userId === ids.employee).role,'Employee');
      assert.equal(afterDetail.people.find((p) => p.userId === ids.manager).commissionBps,0);
      assert.equal(afterDetail.customers.find((c) => c.id === ids.outsider).salesCents,5000);
      const tierSettings = () => updatedTiers.map((tier,index) => ({...tier.toJSON(),releaseAfterIndex:index === 1 ? 0 : index === 3 ? 1 : null}));
      const saveTierSettings = async (changes) => req(`/business/events/${event.id}`,ids.manager,'PUT',{
        ...tierEdit,version:(await m.Event.findByPk(event.id)).version,
        offerings:tierSettings().map((tier,index) => index === 1 ? {...tier,...changes} : tier),
      });
      assert.equal((await saveTierSettings({salesEndAt:new Date(Date.now()-1000).toISOString()})).status,200);
      assert.equal((await req(`/events/${event.id}`,null)).body.data.offerings.find((tier) => tier.id === updatedTiers[3].id).saleState,'on_sale','the prior window closing releases the next tier');
      assert.equal((await saveTierSettings({salesEndAt:new Date(Date.now()+3600000).toISOString(),isActive:false})).status,200);
      assert.equal((await req(`/events/${event.id}`,null)).body.data.offerings.find((tier) => tier.id === updatedTiers[3].id).saleState,'on_sale','manual close releases the next tier');
      assert.equal((await buy(updatedTiers[1].id,'')).body.error.code,'OFFERING_NOT_ON_SALE','manually closed tiers reject checkout');
      assert.equal((await buy(updatedTiers[3].id,'')).status,201,'the released tier is purchasable');
      // Unsold offerings can be removed on Save; sales and history remain protected.
      const removalInput = async (offerings) => ({
        ...tierEdit, version:(await m.Event.findByPk(event.id)).version, offerings,
      });
      const currentSettings = async () => {
        const rows = await m.Offering.findAll({where:{eventId:event.id},order:[['sortOrder','ASC']]});
        return rows.map((row) => ({...row.toJSON(), releaseAfterIndex:row.releaseAfterOfferingId ? rows.findIndex((prior)=>prior.id===row.releaseAfterOfferingId) : null}));
      };
      const retainedSettings = await currentSettings();
      const extras = [
        {...input.offerings[0],name:'Removable ticket'},
        {...input.offerings[0],kind:'package',name:'Removable package'},
        {...input.offerings[0],name:'Dependent ticket',priceCents:3000,releaseAfterIndex:retainedSettings.length},
      ];
      assert.equal((await req(`/business/events/${event.id}`,ids.manager,'PUT',await removalInput([...retainedSettings,...extras]))).status,200);
      const withExtras = await currentSettings();
      const ticketToRemove = withExtras.find((tier)=>tier.name==='Removable ticket');
      const packageToRemove = withExtras.find((tier)=>tier.name==='Removable package');
      const dependent = withExtras.find((tier)=>tier.name==='Dependent ticket');
      const withoutUnsold = withExtras.filter((tier)=>![ticketToRemove.id,packageToRemove.id].includes(tier.id)).map((tier)=>tier.id===dependent.id ? {...tier,releaseAfterIndex:null} : tier);
      assert.equal((await req(`/business/events/${event.id}`,ids.promoter,'PUT',await removalInput(withoutUnsold))).status,403);
      assert.equal((await req(`/business/events/${event.id}`,ids.manager,'PUT',await removalInput(withoutUnsold))).status,200);
      assert.equal(await m.Offering.findByPk(ticketToRemove.id),null);
      assert.equal(await m.Offering.findByPk(packageToRemove.id),null);
      assert.equal((await m.Offering.findByPk(dependent.id)).releaseAfterOfferingId,null);
      const remainingSettings = await currentSettings();
      const withoutSold = remainingSettings.filter((tier)=>tier.id!==tiers[0].id).map((tier)=>({...tier,releaseAfterIndex:null}));
      const protectedSale = await req(`/business/events/${event.id}`,ids.owner,'PUT',await removalInput(withoutSold));
      assert.equal(protectedSale.body.error.code,'TIER_HAS_SALES');
      assert.ok(await m.Offering.findByPk(tiers[0].id));
      // A zero counter must never allow deletion of existing order history.
      const soldCount = (await m.Offering.findByPk(tiers[0].id)).quantitySold;
      await m.Offering.update({quantitySold:0},{where:{id:tiers[0].id}});
      assert.equal((await req(`/business/events/${event.id}`,ids.owner,'PUT',await removalInput(withoutSold))).body.error.code,'TIER_HAS_SALES');
      await m.Offering.update({quantitySold:soldCount},{where:{id:tiers[0].id}});
      assert.equal((await req(`/business/events/${event.id}`,ids.owner,'PUT',await removalInput(remainingSettings.filter((tier)=>tier.id!==dependent.id)))).status,200);
      const lastOfferingEvent = await req('/business/events',ids.manager,'POST',{...input,title:'QA guestlist-only removal'});
      assert.equal(lastOfferingEvent.status,201);
      events.push(lastOfferingEvent.body.data.id);
      locations.add(lastOfferingEvent.body.data.locationId);
      assert.equal((await req(`/business/events/${lastOfferingEvent.body.data.id}`,ids.manager,'PUT',{
        ...input,title:'QA guestlist-only removal',version:lastOfferingEvent.body.data.version,offerings:[],
      })).status,200);
      assert.equal(await m.Offering.count({where:{eventId:lastOfferingEvent.body.data.id}}),0);
      // The stored end time, not the client, decides whether an event can be changed.
      const fixtureEvent = await m.Event.findByPk(event.id);
      await fixtureEvent.update({startsAt:new Date(Date.now()-7200000),endsAt:new Date(Date.now()-3600000)});
      assert.equal((await req(`/business/events/${event.id}/detail`,ids.owner)).body.data.event.canEdit,false);
      assert.equal((await req(`/business/events/${event.id}`,ids.owner,'PUT',{...tierEdit,version:fixtureEvent.version})).body.error.code,'EVENT_FINISHED');
      assert.equal((await req(`/business/events/${event.id}/people`,ids.owner,'PUT',{userId:ids.employee,commissionBps:1000,status:'inactive'})).body.error.code,'EVENT_FINISHED');
      assert.equal((await buy(updatedTiers[1].id)).body.error.code,'EVENT_NOT_ON_SALE');
      const audits = await m.AuditLog.findAll({
        where: { entityType: "Event", entityId: event.id },
      });
      assert.equal(audits.length >= 3, true);
      const independent = await req("/business/events", ids.outsider, "POST", {
        ...input,
        imageAssetId: null,
        organizationId: null,
        slug: `independent-${randomUUID()}`,
      });
      assert.equal(independent.status, 201);
      assert.equal((await req(`/business/events/${independent.body.data.id}/people`,ids.outsider,'PUT',{email:`${ids.employee}@integration.nitewide.test`,commissionBps:0,status:'active'})).status,200);
      events.push(independent.body.data.id);
      locations.add(independent.body.data.locationId);
      const independentScope = await req(
        "/business/workspace?organizationId=independent",
        ids.outsider,
      );
      assert.equal(
        independentScope.body.data.events.some(
          (e) => e.id === independent.body.data.id && e.canManage,
        ),
        true,
      );
      // A manager can replace/remove artwork while retaining edit/version protection.
      const replacement = await upload(ids.outsider, png);
      assert.equal(replacement.status, 201);
      const independentTiers = await m.Offering.findAll({
        where: { eventId: independent.body.data.id },
      });
      const independentBody = {
        ...input,
        organizationId: null,
        slug: independent.body.data.slug,
        version: independent.body.data.version,
        imageAssetId: replacement.body.data.id,
        offerings: [{ ...input.offerings[0], id: independentTiers[0].id }],
      };
      const attached = await req(
        `/business/events/${independent.body.data.id}`,
        ids.outsider,
        "PUT",
        independentBody,
      );
      assert.equal(attached.status, 200);
      locations.add(attached.body.data.locationId);
      assert.equal(
        (await req(`/events/${independent.body.data.id}`, null)).body.data
          .imageUrl,
        replacement.body.data.url,
      );
      const removed = await req(
        `/business/events/${independent.body.data.id}`,
        ids.outsider,
        "PUT",
        {
          ...independentBody,
          version: attached.body.data.version,
          imageAssetId: null,
        },
      );
      assert.equal(removed.status, 200);
      locations.add(removed.body.data.locationId);
      assert.equal(removed.body.data.imageUrl, null);
      // Employee referrals work immediately on a brand-new venue event, without selection.
      const employeeEvent = await req('/business/events',ids.owner,'POST',{...input,slug:`staff-default-${randomUUID()}`});
      assert.equal(employeeEvent.status,201,JSON.stringify(employeeEvent.body));
      const employeeEventId = employeeEvent.body.data.id;
      events.push(employeeEventId);
      const employeeTier = await m.Offering.findOne({where:{eventId:employeeEventId}});
      const employeeDetail = (await req(`/business/events/${employeeEventId}/detail`,ids.employee)).body.data;
      const employeeCode = employeeDetail.people[0].code;
      assert.match(employeeCode,/^STAFF-/);
      assert.equal(await m.EventAffiliate.count({where:{eventId:employeeEventId}}),0,'reading does not generate assignments');
      const employeeBuy = () => req('/orders',ids.outsider,'POST',{eventId:employeeEventId,idempotencyKey:randomUUID(),affiliateCode:employeeCode,items:[{offeringId:employeeTier.id,quantity:1}],payment:{provider:'test',reference:randomUUID(),status:'succeeded'}});
      const firstStaffSale = await employeeBuy();
      assert.equal(firstStaffSale.status,201,JSON.stringify(firstStaffSale.body));
      assert.equal(firstStaffSale.body.data.order.affiliateCommissionCents,0);
      assert.ok(firstStaffSale.body.data.order.eventAffiliateId);
      const staffRequest = await req(`/events/${employeeEventId}/guestlist`,ids.outsider,'POST',{partySize:1,affiliateCode:employeeCode});
      assert.equal(staffRequest.status,202,JSON.stringify(staffRequest.body));
      assert.equal(staffRequest.body.data.entry.eventAffiliateId,firstStaffSale.body.data.order.eventAffiliateId);
      assert.equal((await req(`/business/events/${employeeEventId}/guestlist/${staffRequest.body.data.entry.id}/decision`,ids.employee,'POST',{decision:'approve'})).body.error.code,'AFFILIATE_GUESTLIST_FULL');
      assert.equal((await req(`/business/events/${employeeEventId}/affiliates/${firstStaffSale.body.data.order.eventAffiliateId}/guestlist-allocation`,ids.manager,'PATCH',{guestlistAllocation:3})).status,200);
      assert.equal((await req(`/business/events/${employeeEventId}/guestlist/${staffRequest.body.data.entry.id}/decision`,ids.employee,'POST',{decision:'approve'})).status,200);
      const directStaffEvent = await req(`/events/${employeeEventId}/guestlist`,ids.owner,'POST',{partySize:1});
      assert.equal((await req(`/business/events/${employeeEventId}/guestlist/${directStaffEvent.body.data.entry.id}/decision`,ids.employee,'POST',{decision:'approve'})).status,403);
      assert.equal((await req(`/business/events/${employeeEventId}/people`,ids.manager,'PUT',{userId:ids.employee,commissionBps:2000,status:'active'})).status,200);
      assert.equal((await employeeBuy()).body.data.order.affiliateCommissionCents,200);
      assert.equal((await m.Order.findByPk(firstStaffSale.body.data.order.id)).affiliateCommissionCents,0,'new rate does not rewrite the first sale');
      assert.equal(await m.EventAffiliate.count({where:{eventId:employeeEventId,userId:ids.employee}}),1);
      assert.equal((await req(`/business/events/${employeeEventId}/people`,ids.manager,'PUT',{userId:ids.employee,commissionBps:2000,status:'inactive'})).status,200);
      assert.equal((await employeeBuy()).body.error.code,'INVALID_AFFILIATE');
      const historicalStaffWorkspace = (await req(`/business/workspace?organizationId=${ids.org}`,ids.employee)).body.data;
      assert.equal(historicalStaffWorkspace.report.events.find((row)=>row.id===employeeEventId).salesCents,2000,'staff retain their own historical sales after an event override is removed');
      const historicalStaffAnalytics = (await req(`/business/analytics?days=30&organizationIds=${ids.org}`,ids.employee)).body.data;
      assert.equal(historicalStaffAnalytics.referrals.people.find((row)=>row.id===ids.employee).salesCents,2000);
      // A default employee can also be explicitly removed before their first referral.
      const unusedEvent = await req('/business/events',ids.owner,'POST',{...input,slug:`staff-unused-${randomUUID()}`});
      assert.equal(unusedEvent.status,201);
      events.push(unusedEvent.body.data.id);
      assert.equal((await req(`/business/events/${unusedEvent.body.data.id}/people`,ids.manager,'PUT',{userId:ids.employee,commissionBps:0,status:'inactive'})).status,200);
      assert.equal((await req(`/events/${unusedEvent.body.data.id}/guestlist`,ids.outsider,'POST',{partySize:1,affiliateCode:employeeCode})).body.error.code,'INVALID_AFFILIATE');
      // Invited promoters belong to one event, not to its venue; every report stays scoped.
      const isolatedEvent = await req('/business/events',ids.owner,'POST',{...input,slug:`event-promoter-${randomUUID()}`});
      assert.equal(isolatedEvent.status,201);
      const inviteEventId = isolatedEvent.body.data.id;
      events.push(inviteEventId);
      const invitePath = `/business/events/${inviteEventId}/invitations`;
      const inviteEmail = `${ids.outsider}@integration.nitewide.test`;
      assert.equal((await req(invitePath,ids.employee,'POST',{email:inviteEmail})).status,403);
      const firstInvite = await req(invitePath,ids.manager,'POST',{email:inviteEmail});
      assert.equal(firstInvite.status,201,JSON.stringify(firstInvite.body));
      assert.equal((await req(invitePath,ids.manager,'POST',{email:inviteEmail,commissionBps:4001})).status,422);
      assert.equal((await req(invitePath,ids.manager,'POST',{email:inviteEmail,commissionBps:-1})).status,422);
      const renewedInvite = await req(invitePath,ids.manager,'POST',{email:inviteEmail,commissionBps:1250});
      assert.equal((await req(`/team/invitations/${firstInvite.body.data.token}`,null)).status,404,'renewal invalidates old link');
      assert.equal((await req(invitePath,ids.owner)).body.data.length,1);
      const inviteToken = renewedInvite.body.data.token;
      const preview = await req(`/team/invitations/${inviteToken}`,null);
      assert.equal(preview.body.data.eventId,inviteEventId);
      assert.equal(preview.body.data.organizationName,undefined);
      assert.equal(preview.body.data.commissionBps,1250);
      assert.equal((await req(`/team/invitations/${inviteToken}/accept`,ids.employee,'POST')).status,403);
      assert.equal((await req(`/team/invitations/${inviteToken}/accept`,ids.outsider,'POST')).status,200);
      assert.equal((await req(`/team/invitations/${inviteToken}/accept`,ids.outsider,'POST')).status,404);
      assert.equal(await m.OrgAffiliate.count({where:{organizationId:ids.org,userId:ids.outsider}}),0);
      assert.equal(await m.OrganizationEmployee.count({where:{organizationId:ids.org,userId:ids.outsider}}),0);
      const eventOnlyRef = await m.EventAffiliate.findOne({where:{eventId:inviteEventId,userId:ids.outsider}});
      assert.equal(eventOnlyRef.commissionBps,1250,'accepted commission is the offered rate');
      assert.equal(eventOnlyRef.orgAffiliateId,null);
      assert.equal((await req(`/business/events/${inviteEventId}/people`,ids.manager,'PUT',{userId:ids.outsider,commissionBps:1500,status:'active'})).status,200,'event-only promoters can have their rates edited');
      const inviteTier = await m.Offering.findOne({where:{eventId:inviteEventId}});
      for (const affiliateCode of [eventOnlyRef.code,undefined]) {
        const sale = await req('/orders',ids.manager,'POST',{eventId:inviteEventId,idempotencyKey:randomUUID(),affiliateCode,items:[{offeringId:inviteTier.id,quantity:1}],payment:{provider:'test',reference:randomUUID(),status:'succeeded'}});
        assert.equal(sale.status,201);
      }
      const ownDetail = (await req(`/business/events/${inviteEventId}/detail`,ids.outsider)).body.data;
      assert.equal(ownDetail.scope,'own');
      assert.equal(ownDetail.summary.salesCents,1000,'direct sales are excluded');
      assert.equal(ownDetail.summary.commissionCents,150);
      assert.deepEqual(ownDetail.people.map((p)=>p.userId),[ids.outsider]);
      const ownReport = (await req(`/business/analytics?days=30&organizationIds=${ids.org}`,ids.outsider)).body.data;
      assert.equal(ownReport.summary.salesCents,1000);
      const ownWorkspace = (await req(`/business/workspace?organizationId=${ids.org}`,ids.outsider)).body.data;
      assert.deepEqual(ownWorkspace.events.map((e)=>e.id),[inviteEventId]);
      assert.equal((await req(`/business/events/${employeeEventId}/detail`,ids.outsider)).status,403);
      assert.equal((await req(`/business/organizations/${ids.org}/team`,ids.outsider)).status,403);
      assert.equal((await req(invitePath,ids.outsider)).status,403);
      const ownGuest = await req(`/events/${inviteEventId}/guestlist`,ids.manager,'POST',{partySize:1,affiliateCode:eventOnlyRef.code});
      const directGuest = await req(`/events/${inviteEventId}/guestlist`,ids.owner,'POST',{partySize:1});
      assert.equal(ownGuest.status,202);
      assert.equal(directGuest.status,202);
      const ownGuestlist = await req(`/business/events/${inviteEventId}/guestlist`,ids.outsider);
      assert.equal(ownGuestlist.status,200);
      assert.deepEqual(ownGuestlist.body.data.map((entry)=>entry.id),[ownGuest.body.data.entry.id]);
      assert.equal((await req(`/business/events/${inviteEventId}/guestlist/${directGuest.body.data.entry.id}/decision`,ids.outsider,'POST',{decision:'reject'})).status,403);
      assert.equal((await req(`/business/events/${inviteEventId}/guestlist/${ownGuest.body.data.entry.id}/decision`,ids.outsider,'POST',{decision:'reject'})).status,200);
      const revocable = await req(invitePath,ids.owner,'POST',{email:inviteEmail});
      assert.equal((await req(`${invitePath}/${revocable.body.data.id}`,ids.manager,'DELETE')).status,200);
      assert.equal((await req(`/team/invitations/${revocable.body.data.token}/accept`,ids.outsider,'POST')).status,404);
      const expired = await req(invitePath,ids.owner,'POST',{email:inviteEmail});
      await m.Event.update({startsAt:new Date(Date.now()-3600000),endsAt:new Date(Date.now()-1000)},{where:{id:inviteEventId}});
      assert.equal((await req(`/team/invitations/${expired.body.data.token}/accept`,ids.outsider,'POST')).status,409);
      assert.equal((await req(invitePath,ids.owner,'POST',{email:inviteEmail})).status,409);
      // Owners and managers have usable referral codes before saving any rate.
      const leadershipEvent = await req('/business/events',ids.owner,'POST',{...input,slug:`leader-referrals-${randomUUID()}`});
      assert.equal(leadershipEvent.status,201);
      const leadershipEventId = leadershipEvent.body.data.id;
      events.push(leadershipEventId);
      const leadershipTier = await m.Offering.findOne({where:{eventId:leadershipEventId}});
      const leaders = (await req(`/business/events/${leadershipEventId}/detail`,ids.owner)).body.data.people;
      for (const leaderId of [ids.owner,ids.manager]) {
        const person = leaders.find((p)=>p.userId===leaderId);
        assert.equal(person.commissionBps,0);
        assert.match(person.code,/^LEAD-/);
        const buyLeader = () => req('/orders',ids.outsider,'POST',{eventId:leadershipEventId,idempotencyKey:randomUUID(),affiliateCode:person.code,items:[{offeringId:leadershipTier.id,quantity:1}],payment:{provider:'test',reference:randomUUID(),status:'succeeded'}});
        const first = await buyLeader();
        assert.equal(first.status,201,JSON.stringify(first.body));
        assert.equal(first.body.data.order.affiliateCommissionCents,0);
        assert.equal((await m.EventAffiliate.findByPk(first.body.data.order.eventAffiliateId)).userId,leaderId);
        assert.equal((await req(`/business/events/${leadershipEventId}/people`,leaderId,'PUT',{userId:leaderId,commissionBps:1000,status:'active'})).status,200);
        assert.equal((await buyLeader()).body.data.order.affiliateCommissionCents,100);
        assert.equal((await m.Order.findByPk(first.body.data.order.id)).affiliateCommissionCents,0);
        const credited = (await req(`/business/events/${leadershipEventId}/detail`,leaderId)).body.data.people.find((p)=>p.userId===leaderId);
        assert.equal(credited.salesCents,2000);
        assert.equal(credited.orders,2);
        assert.equal(credited.commissionCents,100);
      }
      const matrixEventResponse = await req('/business/events', ids.owner, 'POST', { ...input, title: 'Referral matrix event', slug: `matrix-${randomUUID()}`, guestlistCapacity: 20, offerings: [{ ...input.offerings[0], quantityTotal: 50 }] });
      assert.equal(matrixEventResponse.status, 201, JSON.stringify(matrixEventResponse.body));
      const matrixEvent = matrixEventResponse.body.data;
      events.push(matrixEvent.id); locations.add(matrixEvent.locationId);
      const matrixTier = await m.Offering.findOne({ where: { eventId: matrixEvent.id } });
      await m.EventAffiliate.create({ eventId: matrixEvent.id, userId: ids.eventPromoter, code: `MATRIX-${randomUUID()}`, commissionBps: 4000, guestlistAllocation: 10, status: 'active' });
      const matrixActors = [
        { userId: ids.owner, buyerId: ids.outsider, rate: 0, role: 'Owner' },
        { userId: ids.manager, buyerId: ids.invitedDirect, rate: 500, role: 'Manager' },
        { userId: ids.employee, buyerId: ids.invitedReferral, rate: 1250, role: 'Employee' },
        { userId: ids.promoter, buyerId: ids.invitedEmployee, rate: 2000, role: 'Promoter' },
        { userId: ids.eventPromoter, buyerId: ids.matrixCustomer, rate: 4000, role: 'Promoter' },
      ];
      for (const actor of matrixActors) {
        const link = await req(`/business/events/${matrixEvent.id}/referral-link`, actor.userId);
        assert.equal(link.status, 200, `${actor.role} link: ${JSON.stringify(link.body)}`);
        const assignment = await m.EventAffiliate.findOne({ where: { eventId: matrixEvent.id, userId: actor.userId } });
        await assignment.update({ commissionBps: actor.rate, guestlistAllocation: 10 });
        const purchase = await req('/orders', actor.buyerId, 'POST', { eventId: matrixEvent.id, idempotencyKey: randomUUID(), affiliateCode: link.body.data.code, items: [{ offeringId: matrixTier.id, quantity: 1 }], payment: { provider: 'test', reference: randomUUID(), status: 'succeeded' } });
        assert.equal(purchase.status, 201, `${actor.role} purchase: ${JSON.stringify(purchase.body)}`);
        assert.equal(purchase.body.data.order.affiliateCommissionCents, actor.rate / 10);
        const guestlist = await req(`/events/${matrixEvent.id}/guestlist`, actor.buyerId, 'POST', { partySize: 1, affiliateCode: link.body.data.code });
        assert.equal(guestlist.status, 202, `${actor.role} guestlist: ${JSON.stringify(guestlist.body)}`);
      }
      const matrixDetail = await req(`/business/events/${matrixEvent.id}/detail`, ids.owner);
      assert.equal(matrixDetail.status, 200, JSON.stringify(matrixDetail.body));
      for (const actor of matrixActors) {
        const person = matrixDetail.body.data.people.find((row) => row.userId === actor.userId);
        assert.equal(person.role, actor.role);
        assert.equal(person.salesCents, 1000);
        assert.equal(person.commissionCents, actor.rate / 10);
        assert.equal(person.guestlistRequests, 1);
        assert.equal(person.guestlistPlaces, 1);
      }
      assert.equal(matrixDetail.body.data.summary.salesCents, 5000);
      assert.equal(matrixDetail.body.data.summary.commissionCents, 775);
      const matrixWorkspace = await req('/business/workspace?days=30', ids.owner);
      const matrixOverviewRows = matrixWorkspace.body.data.report.people;
      for (const actor of matrixActors) {
        const row = matrixOverviewRows.find((person) => person.id === actor.userId);
        assert.ok(row.salesCents >= 1000, `${actor.role} overview sale`);
        assert.ok(row.commissionCents >= actor.rate / 10, `${actor.role} overview commission`);
        assert.ok(row.guestlistPlaces >= 1, `${actor.role} overview guestlist`);
      }
      const matrixAnalytics = await req(`/business/analytics?days=30&search=${encodeURIComponent(matrixEvent.title)}`, ids.owner);
      assert.equal(matrixAnalytics.status, 200, JSON.stringify(matrixAnalytics.body));
      for (const actor of matrixActors) {
        const row = matrixAnalytics.body.data.referrals.people.find((person) => person.id === actor.userId);
        assert.equal(row.salesCents, 1000, `${actor.role} analytics sale`);
        assert.equal(row.commissionCents, actor.rate / 10, `${actor.role} analytics commission`);
        assert.equal(row.guestlistPlaces, 1, `${actor.role} analytics guestlist`);
      }

      // Server wallet includes existing orders; access is always holder scoped.
      assert.equal((await req('/customer/bookings', null)).status, 401);
      const wallet = await req('/customer/bookings', ids.matrixCustomer);
      assert.equal(wallet.status, 200, JSON.stringify(wallet.body));
      const booked = wallet.body.data.orders.find((row) => row.event.id === matrixEvent.id);
      assert.ok(booked); assert.equal(booked.subtotalCents, 1000);
      const ticketId = booked.items[0].tickets[0].id;
      const walletQr = await req(`/customer/tickets/${ticketId}`, ids.matrixCustomer);
      assert.equal(walletQr.status, 200, JSON.stringify(walletQr.body));
      assert.match(walletQr.body.data.qrImage, /^data:image\/png;base64,/);
      assert.equal((await req(`/customer/tickets/${ticketId}`, ids.owner)).status, 404);
      const ticketList = await req(`/customer/purchases/${booked.id}/tickets`, ids.matrixCustomer);
      assert.equal(ticketList.status, 200, JSON.stringify(ticketList.body));
      assert.equal(ticketList.body.data.tickets[0].status, 'valid');
      assert.equal((await req(`/customer/purchases/${booked.id}/tickets`, ids.owner)).status, 404);
      assert.ok(!JSON.stringify(wallet.body).includes('qrTokenHash'));
      const savedProfile = await req('/customer/profile', ids.matrixCustomer, 'PATCH', { displayName: 'Updated customer', phone: '(407) 555-0199', marketingConsent: false, transactionalSmsConsent: true, marketingSmsConsent: false });
      assert.equal(savedProfile.status, 200, JSON.stringify(savedProfile.body));
      assert.equal(savedProfile.body.data.phone, '+14075550199');
      assert.equal(savedProfile.body.data.phoneVerifiedAt, null);
      assert.equal((await req('/customer/profile', ids.matrixCustomer, 'PATCH', { displayName: 'Escalate', isInternalAdmin: true })).status, 422);
      // A previous promoter's new event feeds into normal checkout and business attribution.
      await m.Organization.create({ id: ids.secondOrg, name: 'Another venue across town', slug: `cross-venue-${ids.secondOrg}`, locationId: venueLocation.id });
      await m.OrganizationOwner.bulkCreate([{ organizationId: ids.secondOrg, userId: ids.owner, role: 'owner' }, { organizationId: ids.secondOrg, userId: ids.manager, role: 'admin' }]);
      const nextNight = await req('/business/events', ids.owner, 'POST', { ...input, organizationId: ids.secondOrg, title: 'Connected next night', slug: `circle-${randomUUID()}`, isDiscoverable: true });
      assert.equal(nextNight.status, 201, JSON.stringify(nextNight.body));
      events.push(nextNight.body.data.id); locations.add(nextNight.body.data.locationId);
      await m.EventAffiliate.create({ eventId: nextNight.body.data.id, userId: ids.eventPromoter, code: `CIRCLE-${randomUUID()}`, commissionBps: 2500, guestlistAllocation: 5, status: 'active' });
      const connected = await req('/customer/connections', ids.matrixCustomer);
      assert.equal(connected.status, 200, JSON.stringify(connected.body));
      const connectionsSummary = await req('/customer/connections/summary', ids.matrixCustomer);
      assert.equal(connectionsSummary.status, 200, JSON.stringify(connectionsSummary.body));
      assert.equal(connectionsSummary.body.data.eligible, true);
      const promoterHistory = connectionsSummary.body.data.people.find((person) => person.id === ids.eventPromoter);
      assert.ok(promoterHistory.bookings > 0);
      assert.ok(!JSON.stringify(connectionsSummary.body.data).includes('@integration.nitewide.test'));
      const scopedConnectionsPath = `/customer/connections?eventId=${nextNight.body.data.id}`;
      assert.equal((await req(scopedConnectionsPath, null)).status, 401);
      assert.equal((await req('/customer/connections?eventId=not-a-uuid', ids.matrixCustomer)).status, 422);
      const scopedConnections = await req(scopedConnectionsPath, ids.matrixCustomer);
      assert.equal(scopedConnections.status, 200, JSON.stringify(scopedConnections.body));
      assert.ok(scopedConnections.body.data.every((row) => row.event.id === nextNight.body.data.id));
      const nextLink = scopedConnections.body.data.find((row) => row.referrer.id === ids.eventPromoter);
      assert.ok(nextLink);
      assert.equal(nextLink.event.organization.name, 'Another venue across town', 'Connections follow promoters across organizations, not just the original venue');
      const connectionVisit = await req(`/events/${nextLink.event.id}/referral-visits`, null, 'POST', { code: nextLink.code, sessionKey: randomUUID() });
      assert.equal(connectionVisit.status, 200, JSON.stringify(connectionVisit.body));
      assert.equal(connectionVisit.body.data.code, nextLink.code);
      assert.equal(connectionVisit.body.data.referrerName, nextLink.referrer.name);
      const connectionGuest = await req(`/events/${nextLink.event.id}/guestlist`, ids.matrixCustomer, 'POST', { partySize: 2, affiliateCode: connectionVisit.body.data.code });
      assert.equal(connectionGuest.status, 202, JSON.stringify(connectionGuest.body));
      const connectionGuestId = connectionGuest.body.data.entry.id;
      const promoterGuests = await req(`/business/events/${nextLink.event.id}/guestlist`, ids.eventPromoter);
      assert.ok(promoterGuests.body.data.some((row) => row.id === connectionGuestId));
      assert.equal((await req(`/business/events/${nextLink.event.id}/guestlist/${connectionGuestId}/decision`, ids.eventPromoter, 'POST', { decision: 'approve' })).status, 200);
      assert.ok((await req('/notifications', ids.matrixCustomer)).body.data.items.some((item) => item.kind === 'guestlist_approved' && item.eventId === nextLink.event.id));
      const nextTier = await m.Offering.findOne({ where: { eventId: nextNight.body.data.id } });
      const repeatSale = await req('/orders', ids.matrixCustomer, 'POST', { eventId: nextNight.body.data.id, idempotencyKey: randomUUID(), affiliateCode: nextLink.code, items: [{ offeringId: nextTier.id, quantity: 1 }], payment: { provider: 'test', reference: randomUUID(), status: 'succeeded' } });
      assert.equal(repeatSale.status, 201, JSON.stringify(repeatSale.body));
      assert.equal(repeatSale.body.data.order.affiliateCommissionCents, 250);
      const nextDetail = await req(`/business/events/${nextNight.body.data.id}/detail`, ids.manager);
      assert.equal(nextDetail.body.data.people.find((row) => row.userId === ids.eventPromoter).commissionCents, 250);
      assert.equal(nextDetail.body.data.people.find((row) => row.userId === ids.eventPromoter).guestlistPlaces, 2);
      assert.ok((await req('/notifications', ids.eventPromoter)).body.data.items.some((item) => item.kind === 'referral_purchase' && item.metadata.orderId === repeatSale.body.data.order.id));
      assert.equal((await req('/customer/connections/summary', ids.matrixCustomer)).body.data.people.find((person) => person.id === ids.eventPromoter).bookings, promoterHistory.bookings + 1);
      await m.EventAffiliate.update({ status: 'inactive' }, { where: { eventId: nextNight.body.data.id, userId: ids.eventPromoter } });
      assert.ok(!(await req(scopedConnectionsPath, ids.matrixCustomer)).body.data.some((row) => row.referrer.id === ids.eventPromoter));
      assert.ok(!(await req('/customer/connections', ids.matrixCustomer)).body.data.some((row) => row.event.id === nextNight.body.data.id));
      assert.equal((await req(`/events/${nextLink.event.id}/referral-visits`, null, 'POST', { code: nextLink.code, sessionKey: randomUUID() })).body.error.code, 'INVALID_AFFILIATE', 'A removed connection cannot be reapplied from a stale picker');
      await m.Ticket.update({ status: 'void' }, { where: { id: ticketId } });
      assert.equal((await req(`/customer/tickets/${ticketId}`, ids.matrixCustomer)).status, 409);
      assert.equal((await req(`/customer/purchases/${booked.id}/tickets`, ids.matrixCustomer)).body.data.tickets[0].qrImage, null);
      await m.Ticket.update({ status: 'valid' }, { where: { id: ticketId } });
      await m.Event.update({ startsAt: new Date(Date.now() - 60000) }, { where: { id: matrixEvent.id } });
      const scannedTicket = await m.Ticket.findByPk(ticketId);
      const tokenForScan = require('../src/domain/wallet-qr').walletToken(scannedTicket, config.AUTH_TOKEN_SECRET);
      const scanResult = await req('/check-ins', ids.manager, 'POST', { eventId: matrixEvent.id, qrToken: tokenForScan });
      assert.equal(scanResult.status, 201, JSON.stringify(scanResult.body));
      const updatedTickets = (await req(`/customer/purchases/${booked.id}/tickets`, ids.matrixCustomer)).body.data.tickets;
      assert.equal(updatedTickets[0].status, 'checked_in'); assert.ok(updatedTickets[0].checkedInAt);
      assert.equal((await req('/check-ins', ids.manager, 'POST', { eventId: matrixEvent.id, qrToken: tokenForScan })).status, 409);
      // Time boundaries move purchases between lists without changing the order.
      await m.Event.update({ startsAt: new Date(Date.now() - 172800000), endsAt: new Date(Date.now() - 86400000) }, { where: { id: nextNight.body.data.id } });
      assert.ok((await req('/customer/bookings?period=past', ids.matrixCustomer)).body.data.orders.some((row) => row.event.id === nextNight.body.data.id));
      assert.ok(!(await req('/customer/bookings', ids.matrixCustomer)).body.data.orders.some((row) => row.event.id === nextNight.body.data.id));

      const selloutEvent = await req('/business/events', ids.owner, 'POST', { ...input, slug: `sellout-${randomUUID()}`, offerings: [{ ...input.offerings[0], quantityTotal: 1 }] });
      assert.equal(selloutEvent.status, 201, JSON.stringify(selloutEvent.body));
      events.push(selloutEvent.body.data.id);
      locations.add(selloutEvent.body.data.locationId);
      const selloutTier = await m.Offering.findOne({ where: { eventId: selloutEvent.body.data.id } });
      const sold = await req('/orders', ids.outsider, 'POST', { eventId: selloutEvent.body.data.id, idempotencyKey: randomUUID(), items: [{ offeringId: selloutTier.id, quantity: 1 }], payment: { provider: 'test', reference: randomUUID(), status: 'succeeded' } });
      assert.equal(sold.status, 201, JSON.stringify(sold.body));
      assert.ok((await req('/notifications', ids.owner)).body.data.items.some((item) => item.kind === 'offering_sold_out' && item.eventId === selloutEvent.body.data.id));
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      // Resolve all fixture locations, including any created just before a failed assertion.
      const fixtureEvents = await m.Event.findAll({
        where: { creatorUserId: users },
      });
      for (const e of fixtureEvents) {
        if (!events.includes(e.id)) events.push(e.id);
        locations.add(e.locationId);
      }
      const fixtureAudits = await m.AuditLog.findAll({
        where: { actorUserId: users },
      });
      for (const a of fixtureAudits) {
        if (a.entityType === "Event") {
          if (a.before?.locationId) locations.add(a.before.locationId);
          if (a.after?.locationId) locations.add(a.after.locationId);
        }
      }
      await sequelize.transaction(async (transaction) => {
        const orders = await m.Order.findAll({
          where: { eventId: events },
          transaction,
        });
        const orderIds = orders.map((o) => o.id);
        await m.CheckIn.destroy({ where: { eventId: events }, transaction });
        await m.Ticket.destroy({ where: { eventId: events }, transaction });
        await m.Payment.destroy({ where: { orderId: orderIds }, transaction });
        await m.AffiliateAttribution.destroy({
          where: { eventId: events },
          transaction,
        });
        await m.OrderItem.destroy({
          where: { orderId: orderIds },
          transaction,
        });
        await m.Order.destroy({ where: { id: orderIds }, transaction });
        await m.GuestlistEntry.destroy({
          where: { eventId: events },
          transaction,
        });
        await m.Notification.destroy({ where: { userId: users }, transaction });
        await m.GuestlistInvitation.destroy({ where: { eventId: events }, transaction });
        await m.EventAffiliate.destroy({
          where: { eventId: events },
          transaction,
        });
        await m.Offering.destroy({ where: { eventId: events }, transaction });
        await m.Event.destroy({ where: { id: events }, transaction });
        await m.OrgAffiliate.destroy({
          where: { organizationId: ids.org },
          transaction,
        });
        await m.OrganizationOwner.destroy({
          where: { organizationId: [ids.org, ids.secondOrg] },
          transaction,
        });
        await m.OrganizationEmployee.destroy({ where: { organizationId: ids.org }, transaction });
        await m.Organization.destroy({ where: { id: [ids.org, ids.secondOrg] }, transaction });
        await m.Location.destroy({
          where: { id: [...locations].filter(Boolean) },
          transaction,
        });
        await m.AuditLog.destroy({
          where: {
            [Op.or]: [{ actorUserId: users }, { organizationId: ids.org }],
          },
          transaction,
        });
        await m.MediaAsset.destroy({
          where: { uploadedByUserId: users },
          transaction,
        });
        await m.UserCredential.destroy({ where: { userId: users }, transaction });
        await m.User.destroy({ where: { id: users }, transaction });
      });
      await sequelize.close();
      for (const name of await fs.readdir(mediaDir))
        await fs.unlink(path.join(mediaDir, name));
      await fs.rmdir(mediaDir);
    }
  },
);
