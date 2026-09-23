# Current fee policy — September 23, 2026

This replaces the earlier fixed-rate and reject-infeasible-purchase drafts. The owner's latest instruction prioritizes completing paid purchases with a **hard $1 contribution after modeled transaction costs**, with **5% of face value as a preferred target**, not a rejection threshold.

## Rule order

1. Standard rate: **8% + $0.80 per paid ticket/package unit**, rounded per unit. A package is one unit regardless of admissions.
2. Target a service fee at most **98% of the lower modeled total buyer fee** from Posh or Eventbrite. This is 2% off fees, not 2% off the whole checkout. Include Eventbrite processing in its comparator.
3. Start with the lower of the standard fee and the competitive target.
4. If that fee leaves less than **$1 after processor, other variable costs and configured reserve**, increase it to the smallest cent amount that meets $1. This overrides the standard rate and competitive target. **Never reject a valid purchase merely for missing the margin/discount target.**
5. Track preferred contribution of max($1, 5% of face value) privately. Competitive discounts may reduce contribution below 5%, but never below $1 under the configured cost model.
6. If competitor benchmarks expire or are unavailable, use standard pricing plus the floor, without a savings guarantee. Invalid inputs, unknown costs and unsupported currencies still require correction, not invented prices.

Free orders and free guestlists stay free and do not incur a $1 fee. Nitewide covers routine processing without a second customer surcharge or venue processing deduction. Free core use is $0. Premium remains optional at $249/month without a transaction-fee discount. The planned 10% promoter reward service fee is separate and is not used to subsidize checkout margin.

## Examples (USD, pre-tax, demo domestic-card costs)

| Basket | Buyer fee | Customer checkout | Venue proceeds¹ | Modeled card processing | Nitewide contribution² |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 × $1 ticket | $1.37 | $2.37 | $1.00 | $0.37 | $1.00 |
| 1 × $10 ticket | $1.64 | $11.64 | $10.00 | $0.64 | $1.00 |
| 3 × $25 tickets | $8.40 | $83.40 | $75.00 | $2.72 | $5.68 |
| 1 × $300 VIP | $21.52 | $321.52 | $300.00 | $9.62 | $11.90 |
| 1 × $1,000 VIP | $67.53 | $1,067.53 | $1,000.00 | $31.26 | $36.27 |

¹Before commissions, taxes, refunds, subscriptions and other venue obligations. ²Not accounting net profit. Demo assumptions exclude uncontracted Connect/payout charges, reserves and operating costs. Real provider costs and fraud/refunds can reduce realized contribution.

The $300 example discounts our $24.80 standard fee by $3.28. Its $21.52 fee is more than 2% below Eventbrite's $21.96 total fee because we round down. The $1 example exceeds the standard $0.88 fee and Posh's $1.09 fee to preserve the floor. Do not claim universal lowest pricing or an absolute 8% + $0.80 cap.

## Competitor calculations and sources

Reviewed September 23, 2026. Modeled standard US/USD baskets, not real-time quotes or identical-event evidence.

- [Posh](https://posh.vip/university/post/ticketing-platform-fashion-shows-nightclub-events-faq): 10% + $0.99 per paid ticket, including processing.
- [Eventbrite](https://www.eventbrite.com/organizer/pricing/): 3.7% + $1.79 service per paid ticket, plus 2.9% per order on face value including service fees. Service rounds per unit. Three $25 tickets: $8.16 service + $2.41 processing = $10.57 fees, $85.57 checkout. One $300 VIP: $12.89 + $9.07 = $21.96 fees, $321.96 checkout.
- [Stripe](https://stripe.com/pricing): demo US domestic-card estimate 2.9% + $0.30 on the full customer charge. Actual settlement costs must use provider records.
- Competitor private contracts, discounts, taxes and rounding may differ. The benchmark has a version and expiry. Expiry removes competitive pricing claims; it does not stop valid purchases.

## Implementation and privacy

The shared `@nitewide/pricing` workspace supplies the API, customer previews, public calculator, deck examples and financial scenario model. Version: `2026-09-23-competitive-v2`.

The API recomputes from locked server-priced offerings before creating orders, inventory movements or credentials. Customers submit an expected total; a changed price requires another review. Historical paid orders and idempotent replays retain their amounts. New orders store the internal decision in their pricing snapshot for audit. Customer order responses strip internal contribution, reserve and cost details. Business reporting continues to show face value and authorized commissions.

Public checkout shows the exact fee and full total, including a minimum service fee notice where relevant. Public marketing/calculators qualify the standard rate, show discounts only when achieved, and honestly display higher comparative cost. **Do not display the $1 margin floor, 5% target or Nitewide net in customer/business UI.** Internal documentation, admin financial reporting and the investor deck may include those economics.

## Production boundary

Pricing logic and floor adjustments are implemented in the local demo. This does not implement live Stripe charges, ledger reconciliation, refunds or payouts. Payment routing is unchanged. Demo costs explicitly assume zero additional Connect costs and reserves; that is not verified production cost coverage.

Before enabling live payments, approve complete method-specific processor/Connect/payout cost bounds and reserves, configure host merchant identity and liability with Stripe, enforce server-verified payments, and test reconciliation. No formula guarantees profit after fraud, refunds or disputes. Host proceeds match competitors that pass fees to buyers; better business profit remains a conversion/retention hypothesis.

## Validation

Tests cover mixed and free baskets, rounding, floor overrides, competitive discounts, private response serialization, stale benchmarks, preview/API/calculator parity, commission basis, changed totals and historical replay. Run `npm test`, `npm run build`, the local opt-in database workflow suite and `npm run model:florida`.
