# Competitive pricing and margin protection

September 23, 2026. Implemented for the local demo; live settlement and contracted cost verification remain planned. The source of commercial terms and worked examples is [FEE_POLICY.md](FEE_POLICY.md).

## Latest approved priority

**Complete valid purchases, preserve at least $1 after modeled costs, then compete on buyer fees.** The 5% contribution is preferred, not mandatory. The 8% + $0.80 rate is a standard ceiling with a minimum-cost exception, not an absolute maximum. The owner explicitly rejected rejecting purchases to enforce pricing targets.

## Cent-based algorithm

```
standard = sum(quantity * (round(unitPrice * 8%) + 80 cents)) for paid units
competitorFees = min(Posh total buyer fees, Eventbrite service + processing)
discountTarget = floor(competitorFees * 98%)
initialFee = min(standard, discountTarget) when benchmarks are current
initialFee = standard otherwise

net(fee) = fee - processing(subtotal + fee)
               - otherVariableCosts(subtotal + fee)
               - configuredReserve(subtotal)

finalFee = initialFee when net(initialFee) >= 100 cents
otherwise finalFee = smallest fee >= initialFee for which net(fee) >= 100 cents
preferredContribution = max(100 cents, ceil(subtotal * 5%))
```

Processor costs include processing on the service fee itself. The solver starts near the analytic root and checks integer cents, including independently rounded cost components. Never round the target discount up. Split equivalent lines must produce the same totals. Free orders are outside the paid-order floor.

## Inputs and boundary conditions

- Current modeled comparators: standard US/USD Posh and Eventbrite rates, not all competitors or live event quotes. Compare equal face value, quantity and fee pass-through.
- Shared benchmark metadata has verification date, version, sources and expiry. When expired/missing, standard rate plus floor still works and no competitive claim applies.
- Cost profiles must specify processing, other variable costs and reserves explicitly. Missing/invalid cost data must not become zero. Demo defaults of zero additional charges are labeled assumptions, not approved production terms.
- Unsupported currency, invalid inventory, authorization failures and malformed requests still fail normally. “Do not reject purchases” removes margin-based rejection, not safety or integrity checks.
- The server controls offering prices, commission percentages and cost rules. Customer input cannot override these. An expected-total mismatch requires the customer to review the new price. Completed orders are never repriced.

## Visibility and commercial claims

The public business calculator shares the same engine but projects only customer and venue amounts. It excludes internal contribution, costs and reserve data. Exact payment totals and required buyer fees remain visible to that customer. Minimum-service-fee exceptions appear before confirmation and in public pricing qualifications. Do not publish an absolute fee cap, universal competitor savings or guaranteed profit.

The investor deck can show contribution after explicitly modeled card costs and distinguish it from net profit. At $300 face value, contribution is $11.90 in the domestic-card demo versus a preferred $15.00 target. At $1 face value, a $1.37 service fee overrides the standard and competitor targets to retain $1.00.

## Future implementation

Before live payment launch, verify real payment intent amounts/status server-side, persist expiring accepted quotes for asynchronous payment workflows, validate method-specific cost bounds, approve Connect configuration and risk reserves, and reconcile actual provider balance transactions. Demo quote calculations do not provide these operational protections. Do not use subscription or promoter-reward income to disguise negative individual-order contribution.

Merchant-of-record, fee payer and dispute liability are separate decisions. Keep the intended host seller identity and confirm the exact supported Connect settings with Stripe and counsel. Refunds, fraud and chargebacks can still cause realized losses even with an initially positive contribution.

## Tests

Exercise cent boundaries, very small purchases, multiple package units, mixed/free lines, expired benchmarks, higher-cost profiles and reserve charges. Every valid supported paid basket must stay purchasable with at least $1 modeled contribution. Fee-ceiling and competitor exceptions must be disclosed instead of displayed as savings. Verify customer/API parity, historical replay and internal margin redaction.
