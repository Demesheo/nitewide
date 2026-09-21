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
      outsider: randomUUID(),
      org: randomUUID(),
      affiliate: randomUUID(),
    };
    const users = [ids.owner, ids.manager, ids.promoter, ids.outsider];
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
      await m.Organization.create({
        id: ids.org,
        name: "Integration fixture",
        slug: `qa-${ids.org}`,
      });
      await m.OrganizationOwner.bulkCreate([
        { organizationId: ids.org, userId: ids.owner, role: "owner" },
        { organizationId: ids.org, userId: ids.manager, role: "admin" },
      ]);
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
      const approval = await req(
        `/business/events/${event.id}/guestlist/${request.body.data.entry.id}/decision`,
        ids.promoter,
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
      assert.equal(
        settings.body.data.promoters[0].effectiveGuestlistAllocation,
        20,
      );
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
