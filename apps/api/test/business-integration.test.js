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
      org: randomUUID(),
      affiliate: randomUUID(),
    };
    const users = [ids.owner, ids.manager, ids.promoter, ids.employee, ids.outsider];
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
      assert.equal(promoterReport.body.data.report.people.length, 1);
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
      assert.equal(cancelledDirect.body.data.entry.status, "cancelled");
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
      // Event detail uses full paid history, authorizes each role, and snapshots commissions.
      assert.equal((await req(`/business/events/${event.id}/detail`, ids.outsider)).status, 403);
      const detail = await req(`/business/events/${event.id}/detail`, ids.owner);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal(detail.body.data.summary.salesCents, 2000);
      assert.equal(detail.body.data.summary.admissions, 2);
      assert.equal(detail.body.data.customers.find((c) => c.id === ids.outsider).paidCents, 2229);
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
          where: { organizationId: ids.org },
          transaction,
        });
        await m.OrganizationEmployee.destroy({ where: { organizationId: ids.org }, transaction });
        await m.Organization.destroy({ where: { id: ids.org }, transaction });
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
        await m.User.destroy({ where: { id: users }, transaction });
      });
      await sequelize.close();
      for (const name of await fs.readdir(mediaDir))
        await fs.unlink(path.join(mediaDir, name));
      await fs.rmdir(mediaDir);
    }
  },
);
