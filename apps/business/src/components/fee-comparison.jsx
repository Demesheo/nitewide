import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Check, Clock3, CircleHelp, Minus, X } from "lucide-react";
import { featureHeaders, featurePlatforms } from "../lib/feature-matrix";
import {
  comparePosh,
  comparisonRows,
  comparisonSources,
} from "../lib/comparison";

const dollars = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export default function FeeComparison() {
  const [price, setPrice] = useState("20");
  const [quantity, setQuantity] = useState("1");
  const [orders, setOrders] = useState("1000");
  const selectedFeatures = featureHeaders.map((feature, index) => ({
    ...feature,
    index,
  }));
  const result = comparePosh({
    ticketPrice: Number(price),
    quantity: Number(quantity),
    orders: Number(orders),
  });
  return (
    <>
      <p className="lp-grid-hint" id="comparison-help">
        Current capabilities and future plans in one view. Scroll across on
        smaller screens.
      </p>
      <div className="lp-matrix-legend">
        <span>✓ Available (Nitewide: demo)</span>
        <span>◷ Planned: not live</span>
        <span>− Partial / provider-dependent</span>
        <span>? Not verified</span>
        <span>× Not offered in this scope</span>
      </div>
      <div
        className="lp-matrix-scroll"
        role="region"
        aria-label="Nitewide and competitor comparison"
        aria-describedby="comparison-help"
        tabIndex={0}
      >
        <table className="lp-matrix lp-simple-matrix lp-combined-matrix">
          <caption>Features at a glance · reviewed September 21, 2026</caption>
          <thead>
            <tr>
              <th scope="col">Platform</th>
              {selectedFeatures.map((feature) => (
                <th scope="col" key={feature.label}>
                  {feature.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {featurePlatforms.map((platform) => (
              <tr
                key={platform.name}
                className={
                  platform.name === "Nitewide" ? "lp-our-platform" : ""
                }
              >
                <th scope="row">
                  {platform.name}
                  {platform.name === "Nitewide" && (
                    <small className="lp-platform-pick">
                      BUILT FOR YOUR BUSINESS
                    </small>
                  )}
                </th>
                {selectedFeatures.map((feature) => {
                  const item = platform.cells[feature.index];
                  const Icon = {
                    yes: Check,
                    demo: Check,
                    planned: Clock3,
                    partial: Minus,
                    unknown: CircleHelp,
                    no: X,
                  }[item.status];
                  const label = {
                    yes: "Available",
                    demo: "Demo",
                    planned: "Planned",
                    partial: "Partial",
                    unknown: "Not verified",
                    no: "Not offered",
                  }[item.status];
                  return (
                    <td key={feature.label}>
                      <span
                        className={`lp-feature-mark lp-mark-${item.status}`}
                        title={item.note}
                        aria-label={`${label}: ${item.note}`}
                      >
                        <Icon size={19} aria-hidden="true" />
                        {item.status === "planned" && <small>Planned</small>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-fine-print">
        Hover for scope and sources. ✓ does not imply feature parity. Nitewide
        checks are working demo features; clocks are planned, not live. ? means
        unverified, not absent.
      </p>
      <div
        className="lp-matrix-scroll lp-rate-scroll"
        role="region"
        aria-label="Platform fee rates"
        tabIndex={0}
      >
        <table className="lp-matrix lp-rate-matrix">
          <caption>Who pays what?</caption>
          <thead>
            <tr>
              <th scope="col">Platform</th>
              <th scope="col">Published / planned pricing</th>
              <th scope="col">Who pays?</th>
            </tr>
          </thead>
          <tbody>
            {featurePlatforms.map((platform, index) => (
              <tr
                key={platform.name}
                className={index === 0 ? "lp-our-platform" : ""}
              >
                <th scope="row">{platform.name}</th>
                <td>{comparisonRows[0].cells[index]}</td>
                <td>{comparisonRows[1].cells[index]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lp-comparison-note">
        <strong>Lower checkout fees. More room to enjoy the night.</strong>
        <p>
          Choose Nitewide for lower customer fees, flexible guestlist control,
          and one connected business workspace. With at least 10% lower customer
          fees than Posh’s published standard rate, guests keep more budget for
          drinks, food, and upgrades at your venue. That creates an opportunity
          for in-venue sales—not a guaranteed increase. Organizers pay Stripe
          separately; customer savings are not organizer cost savings.
        </p>
      </div>
      <details className="lp-sources">
        <summary>Sources & comparison limits</summary>
        <ol>
          {comparisonSources.map((source) => (
            <li key={source.name}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name} ↗
              </a>
            </li>
          ))}
        </ol>
        <p>
          US/USD comparison, excluding taxes, optional extras, special contracts
          and discounts. Tabler’s published terms describe private cost-sharing,
          not a like-for-like commercial ticketing service. Unpublished rates
          cannot support a numeric savings claim. Confirm current commercial
          terms with each provider.
        </p>
      </details>

      <div className="lp-fee-calculator">
        <div>
          <span className="lp-kicker">SEE THE WHOLE CHECKOUT</span>
          <h3>What could your customers save?</h3>
          <p>
            Compare our planned buyer-paid checkout with Posh’s published all-in
            ticket rate. This is an estimate, not a live quote.
          </p>
        </div>
        <div className="lp-calculator-presets">
          <span>Try an example</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPrice("20");
              setQuantity("1");
            }}
          >
            One $20 ticket
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPrice("20");
              setQuantity("4");
            }}
          >
            Four $20 tickets
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPrice("300");
              setQuantity("1");
            }}
          >
            One $300 package
          </Button>
        </div>
        <div className="lp-calculator-inputs">
          <label htmlFor="compare-price">
            Face value per ticket / package ($)
            <Input
              id="compare-price"
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label htmlFor="compare-quantity">
            Tickets / packages per order
            <Input
              id="compare-quantity"
              type="number"
              min="1"
              max="100"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label htmlFor="compare-orders">
            Orders to compare
            <Input
              id="compare-orders"
              type="number"
              min="1"
              max="100000"
              step="1"
              value={orders}
              onChange={(e) => setOrders(e.target.value)}
            />
          </label>
        </div>
        {!result ? (
          <p role="alert">
            Enter a price from $0.01–$10,000, 1–100 whole items, and 1–100,000
            whole orders.
          </p>
        ) : (
          <div aria-live="polite" aria-atomic="true">
            <div className="lp-calculator-results">
              <div>
                <span>Nitewide · estimated customer total</span>
                <strong>{dollars(result.nitewideTotalCents)}</strong>
                <small>
                  {dollars(result.subtotalCents)} face value +{" "}
                  {dollars(result.platformCents)} customer service fee. No extra
                  customer processing charge.
                </small>
              </div>
              <div>
                <span>Posh · published-rate customer total</span>
                <strong>{dollars(result.poshTotalCents)}</strong>
                <small>
                  {dollars(result.subtotalCents)} face value +{" "}
                  {dollars(result.poshFeeCents)} fees, including processing
                </small>
              </div>
            </div>
            <p className="lp-savings-result">
              {result.savingsCents > 0
                ? `Customers save ${dollars(result.savingsCents)} per order with Nitewide`
                : result.savingsCents < 0
                  ? `Nitewide costs customers ${dollars(-result.savingsCents)} more per order in this example`
                  : "Customer totals are equal in this example"}
              .
            </p>
            <p>
              {Number(orders).toLocaleString("en-US")} identical orders:{" "}
              {dollars(Math.abs(result.aggregateSavingsCents))}{" "}
              {result.aggregateSavingsCents >= 0
                ? "in total customer savings"
                : "in additional customer cost"}
              . This is customer savings, not organizer savings. Optional
              Premium costs $249/month separately.
            </p>
            <p>
              Estimated organizer Stripe cost per order:{" "}
              <strong>{dollars(result.organizerProcessingCents)}</strong>;
              face-value proceeds after Stripe:{" "}
              <strong>{dollars(result.organizerNetCents)}</strong>, before
              taxes, commissions, refunds and other obligations. Buyer-paid
              Posh’s published rate includes processing; this cost shift matters
              when comparing organizer proceeds.
            </p>
          </div>
        )}
        <p className="lp-fine-print">
          Assumptions: Nitewide 7.5% + $0.79 per paid order charged to the
          customer. The organizer pays illustrative Stripe US domestic-card
          processing at 2.9% + $0.30 on the full customer charge. No buyer
          gross-up or processing surcharge. Posh 10% + $0.99 per paid ticket
          includes processing. Taxes, refunds, disputes, Connect/payout charges,
          international cards, discounts, and other payment methods are not
          modeled. Actual provider configuration and compliant fee presentation
          must be confirmed before launch. Free guestlists do not incur
          paid-order fees.{" "}
          <a href={comparisonSources[0].url} target="_blank" rel="noreferrer">
            Posh rate ↗
          </a>{" "}
          ·{" "}
          <a href={comparisonSources[8].url} target="_blank" rel="noreferrer">
            Stripe rate ↗
          </a>
        </p>
      </div>
    </>
  );
}
