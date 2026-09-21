# Florida operating model and $50M value gate

Last updated: September 20, 2026

This model turns the Florida rollout into a measurable operating target. It is a planning scenario, not a valuation, forecast, appraisal, financing promise, or representation that adoption will occur. The reproducible calculation lives in [`scripts/florida-valuation-model.js`](../scripts/florida-valuation-model.js).

## Correct economic structure

- The buyer pays a 7.5% + $0.85 Nitewide service fee per paid order.
- The venue funds the promoter's gross kickback. Nitewide charges an additional 10% service fee on that gross kickback, and the promoter receives the remaining 90% before disclosed payout fees, withholding, refunds, disputes, or adjustments.
- Promoter attribution and the reward split are independent. If 25% of transactions are promoter-attributed, the model uses 25%—not `25% × 90%`. The 90% already describes how the kickback is divided.
- Example: a venue funds a $50 VIP kickback. Nitewide earns $5 and the promoter earns $45. A $5 GA kickback produces $0.50 for Nitewide and $4.50 for the promoter.
- Stripe's percentage is modeled on the full customer charge—face value plus the buyer service fee—not face-value GMV alone. Taxes, international cards, currency conversion, refunds, disputes, Connect fees, Instant Payouts, and negotiated pricing can change actual cost.

## Conservative Florida adoption case

| Assumption | Value |
|---|---:|
| Active venues | 80 |
| Selling nights per venue per week | 4 |
| VIP volume | $5,000 per venue-night on one-third of nights |
| Average VIP checkout | $150 |
| GA volume | $300 per venue-night |
| Average GA checkout | $20 |
| Promoter-attributed transactions | 25% |
| Venue-funded VIP / GA kickback | $50 / $5 |
| Nitewide fee on gross promoter kickback | 10% |
| Premium adoption | 50% of venues at $249/month |
| Buyer fee | 7.5% + $0.85 per paid order |
| Illustrative domestic-card processing | 2.9% of the full customer charge + $0.30 |
| Other direct-cost planning reserve | 0.5% of face-value GMV |
| Annual solo-founder/vendor operating budget | $300,000 |

## Modeled annual result

| Output | Amount |
|---|---:|
| Face-value GMV | $32.73M |
| Transactions | 434,489 |
| Buyer service-fee revenue | $2.82M |
| Gross venue-funded promoter kickbacks | $2.62M |
| Nitewide 10% promoter service fees | $262K |
| Promoter net rewards before adjustments | $2.36M |
| Premium subscription revenue | $120K |
| Gross platform revenue | $3.21M |
| Estimated Stripe processing | $1.16M |
| Processor-adjusted platform contribution | $2.04M |
| Other direct-cost reserve | $164K |
| Illustrative operating contribution after $300K budget | $1.58M |

“Gross platform revenue,” “processor-adjusted contribution,” and “operating contribution” are deliberately separate. Final recognized revenue and expense presentation depends on the approved principal-versus-agent accounting policy and actual Stripe balance transactions.

## $50M evidence gate

The 80-venue Florida case would require approximately a 15.6x multiple of $3.21M gross platform revenue to imply $50M. That is a premium strategic outcome, not a conservative valuation assumption. Applying a 25.3x multiple derived by dividing a reported POSH valuation by an earlier revenue estimate mixes measurement dates and financing context, so it remains an upside sensitivity rather than the operating plan.

| Revenue multiple | Implied value at 80 venues | Equivalent venues at unchanged unit economics for $50M |
|---:|---:|---:|
| 4x | $12.8M | 312 |
| 6x | $19.2M | 208 |
| 8x | $25.6M | 156 |
| 10x | $32.1M | 125 |
| 15.6x | ~$50.0M | ~80 |

Nitewide should treat $50M as achieved only when an independent financing or acquisition establishes it. Internally, the goal is to build the evidence that can support that discussion:

1. Reach or exceed the 80-venue Florida operating case with processor-reconciled economics—not projections alone.
2. Demonstrate durable 30/90/180-day venue retention, event recurrence, buyer repeat behavior, promoter activation, and low revenue concentration.
3. Sustain positive contribution margin after processing, communications, fraud/disputes, support, analytics infrastructure, and attributable operating costs.
4. Show Premium attach, activation, retention, expansion, and gross margin based on genuine analytics and promoter-ROI usage.
5. Prove the Florida playbook transfers nationally without equivalent growth in founder workload, support contacts, fraud loss, or acquisition cost.
6. Maintain clean payment reconciliation, contracts, privacy/security controls, IP ownership, financial statements, and diligence evidence.

## Sensitivity rules

- Reforecast monthly using actual active venues, venue-nights, GMV, checkout size, promoter attribution, kickback schedules, Premium attach/churn, processor costs, refunds, disputes, support, and infrastructure costs.
- Report base, downside, and upside cases. Never present one multiple as an entitlement or combine a current valuation with stale revenue to imply a comparable multiple.
- Separate enterprise value from equity value and account for cash, debt, liabilities, dilution, transaction structure, taxes, and deal terms.
- Treat Florida as the validation market. National expansion is upside only after the Florida cohort and operational gates pass.

Reference context: [Fortune reported](https://fortune.com/2026/03/19/exclusive-posh-lands-37m-series-b-what-are-we-doing-tonight-problem/) that POSH generated roughly $10M of 2024 revenue on more than $83M of ticket sales and later raised a $37M Series B; [Software Equity Group reported](https://softwareequity.com/research/quarterly-saas-report) a 4.0x median EV/TTM revenue multiple for SaaS M&A in 2Q26, with scarce strategic assets receiving higher outlier outcomes. These are context, not direct comparables or valuation guarantees.
