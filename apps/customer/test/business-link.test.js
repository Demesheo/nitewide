import test from "node:test";
import assert from "node:assert/strict";
import { businessLink } from "../src/lib/business-link.js";
import { publicAppLink } from '../../shared/app-links.mjs';

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
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { __NITEWIDE_PUBLIC_CONFIG__: { businessHome: 'https://business-staging.nitewide.test/' } };
    assert.equal(businessLink('/business', {}), 'https://business-staging.nitewide.test/');
    assert.equal(publicAppLink('adminUrl', '/admin'), '/admin');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
