import test from "node:test";
import assert from "node:assert/strict";
import { businessLink } from "../src/lib/business-link.js";

test("business navigation preserves the development hostname", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(
      businessLink("", { hostname, protocol: "http:" }),
      `http://${hostname}:5174/`,
    );
});
test("deployment URL overrides local defaults; same-origin fallback is explicit", () => {
  assert.equal(
    businessLink("https://partners.example.org/", {}),
    "https://partners.example.org/",
  );
  assert.equal(
    businessLink("", { hostname: "example.org", protocol: "https:" }),
    "/business",
  );
});
