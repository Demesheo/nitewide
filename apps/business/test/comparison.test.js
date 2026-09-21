import test from "node:test";
import assert from "node:assert/strict";
import { featureHeaders, featurePlatforms } from "../src/lib/feature-matrix.js";
import {
  comparePosh,
  comparisonColumns,
  comparisonRows,
  comparisonSources,
} from "../src/lib/comparison.js";

test("comparison includes Nitewide and all four named competitors on every row", () => {
  assert.deepEqual(comparisonColumns, [
    "Nitewide",
    "Posh",
    "Discotech",
    "Tabler",
    "Sections",
  ]);
  for (const row of comparisonRows)
    assert.equal(row.cells.length, comparisonColumns.length);
  for (const source of comparisonSources)
    assert.equal(new URL(source.url).protocol, "https:");
});
test("future capabilities are explicitly upcoming, not represented as currently available", () => {
  const future = comparisonRows.filter((row) => row.planned);
  assert.equal(future.length, 7);
  for (const row of future) assert.match(row.cells[0], /^Upcoming/);
  assert.ok(future.some((row) => row.label.includes("SMS")));
  assert.ok(future.some((row) => row.label.includes("CRM")));
  assert.ok(future.some((row) => row.label.includes("QR")));
});
test("one $20 ticket charges only the customer service fee and assigns Stripe to the organizer", () => {
  const result = comparePosh({ ticketPrice: 20, quantity: 1, orders: 1000 });
  assert.equal(result.nitewideTotalCents, 2229);
  assert.equal(result.poshTotalCents, 2299);
  assert.equal(result.savingsCents, 70);
  assert.equal(result.aggregateSavingsCents, 70000);
  assert.equal(result.organizerProcessingCents, 95);
  assert.equal(result.organizerNetCents, 1905);
});
test("four tickets share Nitewide fixed fee but Posh fee applies to each ticket", () => {
  const result = comparePosh({ ticketPrice: 20, quantity: 4, orders: 1000 });
  assert.equal(result.platformCents, 679);
  assert.equal(result.processingCents, 0);
  assert.equal(result.nitewideTotalCents, 8679);
  assert.equal(result.poshTotalCents, 9196);
  assert.equal(result.aggregateSavingsCents, 517000);
});
test("large package customer saving uses the latest policy", () => {
  assert.equal(
    comparePosh({ ticketPrice: 300, quantity: 1, orders: 1 }).savingsCents,
    770,
  );
});
test("invalid, zero, fractional quantities and out-of-range values are rejected", () => {
  const base = { ticketPrice: 20, quantity: 1, orders: 1 };
  for (const ticketPrice of [NaN, Infinity, 0, 0.009, -1, 10001])
    assert.equal(comparePosh({ ...base, ticketPrice }), null);
  for (const quantity of [0, -1, 1.5, 101])
    assert.equal(comparePosh({ ...base, quantity }), null);
  for (const orders of [0, -1, 1.5, 100001])
    assert.equal(comparePosh({ ...base, orders }), null);
});
test("Stripe is calculated on the whole payment but never added to the buyer total", () => {
  for (const ticketPrice of [0.01, 10, 19.99, 20, 99.95, 300, 1000, 10000]) {
    const r = comparePosh({ ticketPrice, quantity: 1, orders: 1 });
    assert.equal(
      r.organizerProcessingCents,
      Math.round(r.nitewideTotalCents * 0.029) + 30,
    );
    assert.equal(
      r.nitewideTotalCents,
      r.subtotalCents + r.platformCents + r.processingCents,
    );
  }
});
test("compact matrix has platforms as rows, aligned feature columns and distinct planned states", () => {
  assert.deepEqual(
    featurePlatforms.map((p) => p.name),
    comparisonColumns,
  );
  for (const platform of featurePlatforms) {
    assert.equal(platform.cells.length, featureHeaders.length);
    for (const item of platform.cells)
      assert.ok(
        ["yes", "demo", "planned", "partial", "unknown", "no"].includes(
          item.status,
        ),
      );
  }
  featureHeaders.forEach((feature, index) =>
    assert.equal(
      featurePlatforms[0].cells[index].status,
      feature.group === "planned" ? "planned" : "demo",
    ),
  );
});
test("published buyer fees remain at least 10% below Posh for single and multi-ticket orders", () => {
  for (const quantity of [1, 2, 4, 10, 100])
    for (const ticketPrice of [0.01, 0.19, 0.99, 10, 20, 300, 1000, 10000]) {
      const r = comparePosh({ ticketPrice, quantity, orders: 1 });
      assert.ok(r.platformCents * 10 <= r.poshFeeCents * 9);
    }
});
