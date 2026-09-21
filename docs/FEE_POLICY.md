# Current fee policy — September 21, 2026

This decision supersedes previous 8% + $0.89 / customer-paid-processing and processing-inclusive drafts.

| Item | Payer | Policy |
| --- | --- | --- |
| Nitewide service fee | Customer | 7.5% of order face-value subtotal + $0.79 **once per paid order**, cent-rounded |
| Stripe payment processing | Business, organization, or independent creator | Actual provider fees; never a second customer surcharge |
| Free core platform | Organizer | $0 subscription, listing or platform transaction fee |
| Premium | Organizer choosing Premium | $249/month, no checkout fee reduction; billing/upgraded entitlements planned |
| Taxes, rewards, refunds, disputes and exceptional provider charges | As applicable under the relevant agreements | Separate from routine service-fee pricing; not waived by Free |

Free orders: no service fee. Payments remain mocked in Customer, and real Stripe Connect processing/settlement is not live. The API records the intended processing payer/version in `pricingPlanSnapshot`; it does **not** invent processor costs, execute bank debits, or make payouts. Actual provider balance transactions must supply processing expenses when Connect is implemented. No migration or reseed is needed; existing paid orders and saved receipts are historical and remain unchanged.

## Checkout and organizer examples

| Order | Customer service fee | Customer total | Estimated organizer Stripe cost | Face value minus Stripe |
| --- | ---: | ---: | ---: | ---: |
| One $20 ticket | $2.29 | $22.29 | $0.95 | $19.05 |
| Four $20 tickets | $6.79 | $86.79 | $2.82 | $77.18 |
| One $300 package | $23.29 | $323.29 | $9.68 | $290.32 |

Estimates use [Stripe’s published US domestic-card rate](https://stripe.com/pricing), 2.9% + $0.30 of the **entire customer charge**. These are not settlement quotes. Provider/Connect configuration, payment method, tax, geography and contracted rates can change costs. Organizer net shown excludes affiliate commissions, taxes, refunds, disputes, subscriptions and other expenses. Nitewide revenue is the service fee, not customer total or GMV. Do not label the fee pure profit.

## Competitor benchmark

[Posh publishes](https://university.posh.vip/university/post/event-marketplaces-where-posh-fits-and-where-it-does-not) 10% + $0.99 per paid ticket, including processing. With identical USD face values, Nitewide’s **customer fees** are at least 10% below that standard benchmark. The percentage comparison is of fees, not ticket totals. The per-order fixed fee further benefits multi-ticket baskets. Examples: customer savings are $0.70 for one $20 ticket, $5.17 for four $20 tickets, and $7.70 for one $300 unit.

This does not promise cheaper organizer economics: the Nitewide organizer now bears Stripe while buyer-paid Posh includes processing in the buyer fee. Special discounts, private contracts, taxes, optional extras and future competitor rate changes are outside this dated comparison. Revalidate before launch. A package is compared as one equivalently priced paid unit, not a claim of identical products.

## Implementation and financial model

- API: `apps/api/src/domain/pricing.js`; both plans use 750 basis points + 79 cents and `processingPaidBy: organizer`.
- Customer: `apps/customer/src/lib/checkout-fees.js`, used by checkout previews and the Business comparison calculator. Rounding and zero-value behavior are parity-tested across 100,001 cent amounts.
- Business: `lib/comparison.js` keeps organizer Stripe estimates separate from buyer totals; no gross-up. Matrix rows are platforms, columns are features; checkmarks, Demo, Planned, Partial, Not verified and Not offered retain evidence distinctions.
- Financial model: `scripts/florida-valuation-model.js` uses 7.5% + $0.79 and assigns payment processing to organizers. It no longer subtracts organizer Stripe costs from platform contribution. Other Connect, subscription-billing, refund/dispute and operating costs still need separate modeling; the current reserve is not a quote.
- Tests cover the fixed fee once per order, free orders, Free/Premium parity, signed/invalid input, same policy in previews/API, benchmark savings including cent rounding, and the processing payer snapshot.

```bash
npm test
npm run build
npm run model:florida
```

Older dated valuation notes are historical scenarios, not the current pricing specification. Re-run the model before relying on projections; revenue figures are not after-tax income or promised valuations.
