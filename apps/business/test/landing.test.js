import test from "node:test";
import assert from "node:assert/strict";
import {
  businessPage,
  competitors,
  features,
  pricing,
  questions,
  roadmap,
} from "../src/lib/landing-content.js";
import { customerLink } from "../src/lib/customer-link.js";

test("public landing and workspace routes are distinct, including trailing slashes", () => {
  assert.equal(businessPage("/"), "landing");
  for (const path of ["/sign-in", "/sign-in/", "/app", "/app/"])
    assert.equal(businessPage(path), "workspace");
  assert.equal(businessPage("/unknown"), "not-found");
  assert.equal(businessPage("/sign-in-elsewhere"), "not-found");
});
test("public copy distinguishes working features and planned capabilities", () => {
  assert.equal(features.length, 4);
  assert.equal(roadmap.length, 3);
  assert.ok(
    roadmap.some((item) => item.description.includes("Stripe Connect")),
  );
  assert.ok(roadmap.some((item) => item.description.includes("Email and SMS")));
  assert.ok(
    questions.some(([, answer]) =>
      answer.includes("does not collect real payments"),
    ),
  );
  assert.ok(
    questions.some(([, answer]) =>
      answer.includes("no guaranteed 24-hour payout"),
    ),
  );
});
test("planned pricing uses the latest policy with no Premium fee discount", () => {
  assert.deepEqual(pricing, {
    freeMonthly: 0,
    premiumMonthly: 249,
    feePercent: 7.5,
    feeFixed: 0.79,
    status: "planned",
  });
});
test("every comparison includes an HTTPS official source and qualified fit", () => {
  assert.deepEqual(
    competitors.map((item) => item.name),
    ["Posh", "Discotech", "Tabler", "Sections"],
  );
  for (const item of competitors) {
    assert.equal(new URL(item.url).protocol, "https:");
    assert.ok(item.source && item.focus && item.fit);
    assert.match(item.fit, /^Choose Nitewide/);
  }
});
test("customer link preserves local hostname and allows deployment override", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(
      customerLink("", { hostname, protocol: "http:" }),
      `http://${hostname}:5173/`,
    );
  assert.equal(
    customerLink("https://events.example.org/", {}),
    "https://events.example.org/",
  );
  assert.equal(
    customerLink("", { hostname: "example.org", protocol: "https:" }),
    "/",
  );
});
