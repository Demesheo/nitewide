# Florida operating model and $50M value gate

Last updated: September 21, 2026 — [current fee policy](FEE_POLICY.md)

This model turns the Florida rollout into a measurable operating target. It is a planning scenario, not a valuation, forecast, appraisal, financing promise, or representation that adoption will occur. The reproducible calculation lives in [`scripts/florida-valuation-model.js`](../scripts/florida-valuation-model.js).

## Correct economic structure

- The buyer pays a 7.5% + $0.79 Nitewide service fee per paid order. The organization/business/creator pays Stripe processing separately; no buyer processing surcharge or gross-up is applied.
- Every sale is paid in full at checkout. The model does not assume deposits, installments, or split payments. The $400 average VIP checkout is a blended basket assumption weighted toward the default $300 and $400 packages, with fewer $1,000 package purchases.
- The venue funds the promoter's gross kickback. Nitewide charges an additional 10% service fee on that gross kickback, and the promoter receives the remaining 90% before disclosed payout fees, withholding, refunds, disputes, or adjustments.
- Promoter attribution and the reward split are independent. If 50% of transactions are promoter-attributed, the model uses 50%—not `50% × 90%`. The 90% already describes how the kickback is divided.
- The second vertical adds one ticket-only non-nightclub event for every ten nightclub event-nights. Each produces $5,000 of face-value ticket GMV at an assumed $40 average checkout. The conservative base assigns these events no promoter-kickback or Premium-subscription revenue.
- Example: a venue funds a $50 VIP kickback. Nitewide earns $5 and the promoter earns $45. A $5 GA kickback produces $0.50 for Nitewide and $4.50 for the promoter.
- Stripe's percentage is modeled on the full customer charge—face value plus the buyer service fee—not face-value GMV alone. This payment-processing expense belongs to organizers, not Nitewide contribution. Taxes, international cards, currency conversion, refunds, disputes, Connect fees, Instant Payouts, and negotiated pricing can change actual cost. Subscription billing and other platform-provider costs still need separate budgeting; the zero platform ticket-processing line does not mean zero total platform expenses.

## Conservative Florida adoption case

| Assumption | Value |
|---|---:|
| Active venues | 80 |
| Selling nights per venue per week | 4 |
| VIP volume | $5,000 per venue-night on one-third of nights |
| Average VIP checkout | $400 paid in full |
| GA volume | $500 per venue event-night |
| Average GA checkout | $20 |
| Non-nightclub event frequency | 1 per 10 nightclub event-nights |
| Non-nightclub ticket GMV / average checkout | $5,000 / $40 |
| Promoter-attributed transactions | 50% |
| Venue-funded VIP / GA kickback | $50 / $5 |
| Nitewide fee on gross promoter kickback | 10% |
| Premium adoption | 50% of venues at $249/month |
| Buyer fee | 7.5% + $0.79 per paid order |
| Organizer-paid illustrative domestic-card processing | 2.9% of the full customer charge + $0.30 |
| Other direct-cost planning reserve | 0.5% of face-value GMV |
| Annual solo-founder/vendor operating budget | $300,000 |
| Purchase conversion / organic cards per discovery page | 10% / 10 |
| Customer AdSense-slot rule | 12% of organic cards, with a two-slot target below 12 cards when policy-safe |
| Ad fill / viewability | 75% / 70% |
| Customer / business contextual ad eCPM | $2.50 / $4.00 |
| Free-business eligible pageviews | 300 per organization/month, two eligible slots/page |
| Aggregated-insights customers | 4 at $1,000/month |

## Modeled annual result

| Output | Amount |
|---|---:|
| Nightclub face-value GMV | $36.05M |
| Non-nightclub events / GMV | 1,664 / $8.32M |
| Total face-value GMV | $44.37M |
| Transactions | 693,333 |
| Buyer service-fee revenue | $3.88M |
| Gross venue-funded promoter kickbacks | $2.77M |
| Nitewide 10% promoter service fees | $277K |
| Promoter net rewards before adjustments | $2.50M |
| Premium subscription revenue | $120K |
| Contextual AdSense revenue | $19K |
| Aggregated, minimum-cohort insights revenue | $48K |
| Personal-data/raw-cookie sale revenue | $0 |
| Gross platform revenue | $4.34M |
| Estimated Stripe processing paid by organizers | $1.61M |
| Modeled ticket-processing cost paid by platform | $0 |
| Processor-adjusted platform contribution | $4.34M |
| Other direct-cost reserve | $222K |
| Ads/insights direct-cost reserve | $13K |
| Illustrative operating contribution after $300K budget | $3.80M |

“Gross platform revenue,” “processor-adjusted contribution,” and “operating contribution” are deliberately separate. Final recognized revenue and expense presentation depends on the approved principal-versus-agent accounting policy and actual Stripe balance transactions.

## $50M evidence gate

The expanded Florida case would require approximately an 11.5x multiple of $4.34M gross platform revenue to imply $50M. That is still a premium strategic outcome, not a conservative valuation assumption. Applying a 25.3x multiple derived by dividing a reported POSH valuation by an earlier revenue estimate mixes measurement dates and financing context, so it remains an upside sensitivity rather than the operating plan.

| Revenue multiple | Implied value for the expanded Florida case | Equivalent nightclub venue base at unchanged event ratio/economics for $50M |
|---:|---:|---:|
| 4x | $17.4M | 233 |
| 6x | $26.0M | 155 |
| 8x | $34.7M | 116 |
| 10x | $43.4M | 93 |
| 11.6x | $50.3M | 80 |

Nitewide should treat $50M as achieved only when an independent financing or acquisition establishes it. Internally, the goal is to build the evidence that can support that discussion:

1. Reach or exceed the 80-venue plus 1,664 annual non-nightclub-event Florida operating case with processor-reconciled economics—not projections alone.
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

## Advertising and data-monetization guardrails

- All modeled placements are Google AdSense only. The model excludes direct sponsorships, house ads, affiliate ads, Google Ad Manager, and other ad networks.
- Customer placements are responsive Google-rendered AdSense units occupying card-shaped layout slots—not custom event-card advertisements or modified AdSense creative. Every slot must be clearly identifiable as advertising and visually distinguishable from organic event cards. The 12%/two-slot rule defines requested inventory, not guaranteed impressions or revenue; consent, AdSense approval and crawlability, policy eligibility, fill, viewability, invalid-traffic controls, accessibility, performance, and user experience determine whether a slot is served.
- Google prohibits pages with more ads or paid promotions than publisher content. Suppress or reduce ads on sparse/empty states, authentication, checkout, QR wallet, guestlist decisions, private communications, approval queues, check-in, dispute, support, and other sensitive or task-critical surfaces.
- Default AdSense to contextual or restricted-data-processing modes. Load non-essential advertising storage only after the applicable consent signal; honor withdrawal, opt-outs, Global Privacy Control and Global Privacy Platform signals, deletion, and regional restrictions.
- Nitewide will not sell identifiable customer records, email/phone lists, precise location trails, payment/admission histories, raw cookies, device identifiers, or promoter/customer relationship graphs. The base model assigns these activities $0 revenue.
- The modeled insights product contains aggregated, deidentified, minimum-cohort market trends only. Enforce minimum cohort sizes, suppression, query controls, contractual no-reidentification terms, access logs, export review, retention, and periodic reidentification testing. Counsel must approve the methodology and claims before sale.
- Personalized advertising, cross-context behavioral advertising, data clean rooms, audience activation, or any activity legally treated as a sale/share remains off until counsel-approved applicability analysis, privacy notice, data-protection assessment, processor/controller contracts, consent and opt-out UX, GPC/GPP handling, sensitive/minor protections, deletion/export workflows, and vendor audits are production-ready.

Decision sources: [Google publisher inventory policy](https://support.google.com/publisherpolicies/answer/11169917), [Google AdSense program policies](https://support.google.com/adsense/answer/48182), [Google U.S. state privacy controls](https://support.google.com/adsense/answer/9560818), [California Attorney General CCPA guidance](https://www.oag.ca.gov/privacy/ccpa), [Florida consumer privacy rights](https://www.flsenate.gov/Laws/Statutes/2025/501.705), [Florida privacy notices](https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599%2F0501%2FSections%2F0501.711.html), and [Florida deidentified-data requirements](https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599%2F0501%2FSections%2F0501.714.html).

Reference context: [Fortune reported](https://fortune.com/2026/03/19/exclusive-posh-lands-37m-series-b-what-are-we-doing-tonight-problem/) that POSH generated roughly $10M of 2024 revenue on more than $83M of ticket sales and later raised a $37M Series B; [Software Equity Group reported](https://softwareequity.com/research/quarterly-saas-report) a 4.0x median EV/TTM revenue multiple for SaaS M&A in 2Q26, with scarce strategic assets receiving higher outlier outcomes. These are context, not direct comparables or valuation guarantees.
