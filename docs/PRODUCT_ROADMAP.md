# Nitewide product roadmap

Last updated: September 20, 2026

## Product direction

Nitewide is a web-first nightlife discovery, commerce, promotion, and operations platform. The brand stays focused on nightlife at launch, while the platform continues to use generic concepts—users, organizations, events, locations, offerings, orders, credentials, affiliates, and audit records—so concerts, festivals, private events, hospitality, and other verticals can be added without a rewrite.

The product is organized into six connected systems:

1. **Discover** — location-aware event search and conversion.
2. **Sell** — tickets, packages, guestlists, reservations, checkout, credentials, and admission.
3. **Promote** — affiliate links, allocations, attribution, commissions, campaigns, and boosts.
4. **Manage** — organization, event, staff, inventory, door, customer, and support operations.
5. **Analyze** — trusted sales, attendance, customer, affiliate, and marketplace reporting.
6. **Communicate** — transactional email/SMS, attendee reminders, actionable staff alerts, inventory notifications, consent preferences, and attributable marketing.

## Non-negotiable product rules

- One user can simultaneously be a customer, independent event creator, organization owner/employee, organization affiliate, and selected event affiliate.
- An event always has a creator and may belong to an organization.
- `OrgAffiliate` defaults flow to `EventAffiliate`; non-null event settings override rather than stack.
- Direct event guestlist capacity and each promoter's event allocation are independent pools.
- An offering is reusable inventory, an order item is an immutable purchase snapshot, and a ticket is an admission credential.
- Inventory, guestlist approval, payment reconciliation, and credential consumption must be idempotent, transactional, and auditable.
- Advanced ticket/package configuration remains available on Free.
- Free pricing is 7% + $0.65 per paid order. Gold is $199/month + 5% + $0.50 per paid order. Boosts are available to both tiers; configurable Gold discounts are deferred.

## Current baseline

The repository already contains the generic data model and migrations, realistic Orlando seed data, public discovery APIs, local authentication, commerce and guestlist services, QR admission/check-in, basic analytics, audit records, automated API/domain tests, and runnable customer, business, and admin app shells. These are foundation capabilities, not a claim of production readiness.

Production gaps include managed authentication, payment capture and reconciliation, payouts/refunds/chargebacks, subscription and boost billing, transactional communications, complete app workflows, CRM/marketing, production observability, security hardening, deployment, support operations, and launch validation.

## Solo-founder operating model

Nitewide is planned for one dedicated software engineer working with AI assistance. The roadmap optimizes for fast vertical slices, managed infrastructure, automated verification, and explicit outsourcing—not a future engineering headcount plan.

- Keep the modular monolith until measured scaling pressure justifies extraction.
- Prefer managed identity, payments, communications, hosting, monitoring, and tax/reporting services over bespoke infrastructure.
- Use AI for implementation, tests, documentation, code review preparation, support content, and operational automation; keep security, financial, and production decisions human-reviewed.
- Automate CI, deployments, migrations, backups, reconciliation, alerts, and repetitive support before accepting recurring manual work.
- Outsource licensed or specialist work: entity/tax advice, S-corporation election analysis, contract and marketplace-regulatory review, bookkeeping/tax filing, insurance, penetration testing, and accessibility/legal review.
- Preserve a narrow launch scope. A faster date means deferring non-blocking depth, not weakening payment correctness, security, privacy, accessibility, or admission reliability.

## Accelerated execution timeline

All dates are planning targets. A milestone ships only when its exit criteria pass.

| Milestone | Dates | Outcome and exit criteria |
|---|---|---|
| M0 — Foundation, entity, and architecture | Sep 20–27, 2026 | Backlog and solo-founder workflow are operational; CI is green; identity, payments, legal, analytics, hosting, and SLO decisions have owners; entity and banking work is initiated. |
| M1 — Transaction-ready alpha | Sep 28–Oct 18, 2026 | A customer can discover, register, purchase in Stripe test mode, receive an opaque signed QR credential, request guestlist access, and be checked in through an auditable payment-to-admission chain; business/admin users operate and reconcile the complete flow. |
| M2 — Florida design-partner beta | Oct 19–Nov 15, 2026 | Design partners in Orlando, Miami, Fort Lauderdale, and Tampa can onboard, publish, sell, configure promoters/guestlists, scan entry, view balances, read trusted reports, and generate complete dispute-evidence packets. |
| M3 — Florida public launch | Nov 16–Dec 15, 2026 | Real payments, refunds, risk controls, daily payout scheduling, legal policies, support runbooks, and production reliability gates pass for all four Florida launch markets. |
| M4 — National launch readiness | Dec 16, 2026–Feb 28, 2027 | The Florida playbook is automated; national city scoring, timezone/tax configuration, privacy operations, partner onboarding, fraud controls, and support capacity are ready. |
| M5 — National expansion | Mar 1–May 31, 2027 | Evidence-selected U.S. markets launch in waves using standardized acquisition, city operations, payments, reporting, and reliability controls rather than a fixed Southeast/Texas sequence. |
| M6 — National scale and strategic readiness | Jun 1–Sep 20, 2027 | National cohort quality, unit economics, revenue durability, operational resilience, diligence readiness, and the next financing, acquisition, or category-leadership plan are reviewed. |

## Initial sprint plan

The accelerated launch uses one-week alpha sprints, two-week beta sprints, and larger outcome windows after launch. Scope can move, but launch gates cannot be waived.

| Sprint | Dates | Primary deliverable |
|---|---|---|
| Sprint 0 | Sep 20–27 | Linear/GitHub planning, CI, architecture decisions, metrics, SLOs, and production risk register. |
| Sprint 1 | Sep 28–Oct 4 | Managed identity, event detail/offer selection, organization/event CRUD, Stripe Connect charge/liability decision, staging deployment. |
| Sprint 2 | Oct 5–11 | Test checkout/webhooks, order/QR wallet, guestlist request/approval, signed QR/manual check-in evidence chain, operational search. |
| Sprint 3 | Oct 12–18 | Refund/balance ledger, dispute-evidence automation, affiliate links, live operations, alpha observability, security and end-to-end acceptance. |
| Sprint 4 | Oct 19–Nov 1 | Florida market configuration, partner onboarding, staff roles, communications, reporting, and payout onboarding. |
| Sprint 5 | Nov 2–15 | Four-market beta rehearsal, accessibility/performance/load work, support workflows, subscriptions and boosts. |
| Sprint 6 | Nov 16–29 | Live-payment pilot, daily cleared-fund payout scheduling, legal policies/contracts, bookkeeping, reserves, and incident drills. |
| Sprint 7 | Nov 30–Dec 15 | Florida public launch, partner/customer support, launch analytics, reliability freeze, and measured issue burn-down. |
| Sprint 8 | Dec 16–Jan 15 | Florida retention and conversion improvements; automate founder-heavy support and city operations. |
| Sprint 9 | Jan 16–Feb 28 | National readiness, market scoring, privacy/tax/payment coverage, fraud controls, and wave-one launch decision. |

## Payments and organizer payouts

The MVP default is Stripe Connect with Stripe-hosted or embedded onboarding and connected-account payout components. A short architecture/legal review remains a launch dependency because charge type determines fee collection, refund/dispute handling, negative-balance liability, tax reporting, and whether funds can be split among organizers and affiliates.

- For venue/organizer sales, the launch target is a direct charge on the actual seller’s connected account with Stripe responsible for connected-account payment losses where that configuration is available. Enable automatic external-account recovery of negative balances for supported connected accounts so Stripe attempts to debit the venue/organizer bank account—not Nitewide’s operating account—after a dispute or refund creates a deficit.
- Do not enable a production account configuration in which Nitewide owns connected-account negative-balance liability without a separately approved risk, legal, reserve, pricing, and capital plan. Record the Stripe account controller/loss-liability configuration at onboarding and continuously verify it has not changed.
- Automatic external-account debit is a recovery mechanism, not guaranteed collection: it can fail, be disabled, or be unavailable by account/country/configuration. Monitor recovery status, freeze payouts and new sales when appropriate, retain contractual recovery rights, and escalate unresolved deficits without silently funding them from Nitewide’s operating bank account.
- Track `pending`, `available`, `scheduled`, `in_transit`, `paid`, `failed`, `reversed`, and `held` balances in an immutable internal ledger reconciled to provider objects.
- Schedule eligible standard payouts no later than 24 hours after funds become available, subject to account verification, risk holds, reserves, refunds, disputes, weekends/holidays, and provider/bank processing.
- Do not market “money in the bank within 24 hours.” POSH documents that card proceeds generally take 24–48 business hours to become available, while standard ACH arrival takes additional time.
- Offer provider-supported Instant Payouts only to eligible connected accounts, with transparent provider/platform fees and explicit risk limits. Never advance unsettled funds by default.
- Use provider-hosted KYC/KYB, bank/debit-card collection, tax information, and 1099 delivery wherever possible to minimize solo-founder compliance operations.
- Delay organizer/affiliate transfers until source funds and attribution are final enough for the configured risk tier; maintain reserves and reversible adjustments for refunds and disputes.
- Reconcile payments, transfers, payouts, refunds, disputes, fees, commissions, and net organizer balances daily, with idempotent webhooks and alerts for unmatched money movement.

Decision sources: [POSH balance and payout documentation](https://support.posh.vip/en/articles/15090213-managing-your-balance-payouts-bank-accounts), [POSH tax reporting](https://support.posh.vip/en/articles/15090259-tax-reporting-understanding-your-1099-k), [Stripe Connect payouts](https://docs.stripe.com/connect/supported-embedded-components/payouts), [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), and [Stripe tax-form settings](https://docs.stripe.com/connect/tax-form-settings).

## Admission evidence and dispute controls

Mandatory QR check-in is a strong fulfillment control, not a guarantee against chargebacks or proof that the cardholder authorized the purchase. The issuer/card network decides disputes, and Connect liability depends on the connected-account configuration and whether Nitewide uses direct charges, destination charges, or separate charges and transfers. Nitewide must never market the system as “zero liability,” “unassailable,” or entirely autonomous.

- Preserve the traceable chain `PaymentIntent/Charge → Order → OrderItem → Ticket → signed QR credential → CheckIn`; use immutable internal identifiers and provider references at each boundary.
- Put only an opaque, revocable, cryptographically signed credential in the QR. Never expose a Stripe transaction ID, customer data, or reusable secret in the QR payload; store only the token hash where possible and retain signing-key version metadata.
- Record the event, entrance, timestamp, scanner/device, authorized operator, credential state, signature/key version, online/offline mode, and reasoned manual override for every admission attempt. Duplicate, transferred, refunded, canceled, invalid, expired, and already-used states remain explicit.
- Assemble a reason-specific evidence packet containing Stripe PaymentIntent/Charge and authentication results, order/receipt, accepted policy version, credential lifecycle, check-in record, purchase/login/device activity where lawful, customer communications, transfer/refund history, and a concise investigation summary.
- Submit evidence through Stripe’s dispute APIs where supported, track deadlines and outcomes, and retain a human review/escalation path. Automation prepares and validates evidence; it does not blindly submit weak or irrelevant data.
- Use Radar, risk scoring, recognizable statement descriptors, receipts, AVS/CVC signals, and 3D Secure when appropriate. 3D Secure can shift liability for qualifying fraudulent disputes, but exemptions and unsupported/failed authentication do not provide the same protection.
- Choose and document the Connect charge model and negative-balance owner before production onboarding. Apply organizer limits, payout holds, reserves, transfer reversals, and recovery terms according to measured risk and written agreements.
- Where a venue or organizer is the actual seller, use direct charges on its connected account when the approved Stripe/legal design permits it so the connected merchant can view and manage the payment and dispute. Require Stripe-owned connected-account loss liability and automatic negative-balance debit where available; confirm merchant-of-record, refund, tax, support, and customer-experience consequences before adoption.
- Do not treat `on_behalf_of` on a destination charge as a complete liability transfer. Stripe documents that destination-charge dispute amounts and fees are debited from the platform account, even when a connected merchant can participate in dispute management; recovery may require transfer reversal and can fail or be restricted.
- A promoter receives merchant/dispute responsibility only when it is genuinely the contracting seller, has an eligible connected account, and passes onboarding and legal review. Nitewide cannot assign card-network or statutory responsibility to an unrelated promoter merely by naming it in the Terms.
- Give responsible connected merchants a scoped Stripe-hosted or embedded dispute inbox with deadlines, notifications, evidence requirements, acceptance/submission controls, and escalation. Nitewide retains monitoring, audit, and emergency intervention even when the merchant performs the response.
- Use organizer agreements to allocate permitted responsibilities for refunds, disputes, evidence cooperation, negative balances, reserves, transfer recovery, response deadlines, and indemnification. Contract terms reduce and recover exposure but cannot override Stripe rules, card-network decisions, non-waivable consumer law, privacy duties, or Nitewide’s own negligence.
- Do not collect or retain full customer identity-document images by default. A door ID check or minimal attestation can supplement evidence, but an ID scan does not prove that the cardholder authorized the purchase. Any identity-document collection requires counsel-approved necessity, notice/consent, restricted access, encryption, short retention, deletion, incident handling, and jurisdiction-specific review.
- Florida Statute §562.11 prohibits serving alcohol to people under 21 and describes defenses based on carefully checking approved identification and acting in good faith. The statute reviewed does not establish a universal statewide requirement that every nightclub electronically scan and retain every patron’s ID. Treat scanning and retention as venue/local policy until Florida counsel confirms applicable state law, local ordinances, licensing conditions, and privacy requirements.
- Minimize and time-limit evidence data, restrict access, log every export/submission, and obtain counsel review for identity, device, location, and retention practices.

Decision sources: [Stripe dispute categories and evidence](https://docs.stripe.com/disputes/categories), [Stripe dispute evidence examples](https://docs.stripe.com/disputes/visual-evidence), [Stripe Connect disputes](https://docs.stripe.com/connect/disputes), [Stripe Connect payment details and dispute management](https://docs.stripe.com/connect/supported-embedded-components/payment-details), [Stripe 3D Secure](https://docs.stripe.com/payments/3d-secure), and [Florida Statute §562.11](https://www.flsenate.gov/Laws/Statutes/2026/562.11).

### Automated dispute-defense workflow

1. Verify and idempotently persist each Stripe `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, and `charge.dispute.closed` webhook before acknowledging it; enqueue processing so Stripe delivery is never blocked by evidence compilation or notifications.
2. Resolve the connected account, payment, order, purchaser, event, venue/organizer, credentials, transfers, and existing case. Duplicate or out-of-order events update the same append-only dispute case rather than creating conflicting work.
3. Place the customer in a reversible, reason-coded `restricted_pending_review` risk state. Block high-risk purchases, transfers, or new reservations according to policy, but do not label the customer fraudulent or permanently suspend them merely because a dispute exists. Notify the customer, provide a support/appeal path, and review linked-account or multi-city signals under access-controlled rules.
4. Compile a reason-specific draft evidence packet from lawful, relevant records: customer and payment authentication data, receipt/order, accepted policy version, service date, credential lifecycle, QR check-in, customer communications, refund/transfer history, and investigation summary. Validate provenance, consistency, privacy/redaction, file limits, and gaps; never fabricate missing evidence.
5. Create a scoped venue task and notify authorized operators through in-app and email/SMS channels. The message states the dispute amount/reason, whether Stripe debited the connected account, the exact deadline from `evidence_details.due_by`, and a secure deep link. Do not attach identity documents, raw registration data, QR secrets, or the complete evidence packet to email.
6. Require the responsible merchant or authorized Nitewide reviewer to inspect, amend, approve, accept, or submit the response through the secured dispute workspace or Stripe embedded component. A fixed “seven days” promise is prohibited because deadlines vary and some disputes do not permit a response.
7. Track staged/submitted evidence, submission count/method, reminders, webhook updates, won/lost/withdrawn outcomes, fund reinstatement, connected-bank recovery, restrictions, appeals, and all operator actions. Automatically release appropriate restrictions after a favorable resolution or verified error; retain proportionate controls for repeated or confirmed abuse.

Decision sources: [Stripe event types](https://docs.stripe.com/api/events/types) and [Stripe Dispute `evidence_details`](https://docs.stripe.com/api/disputes/object).

## Diligence-quality finance and transition controls

The acquisition objective is minimal unresolved merchant-loss exposure, predictable reconciled net revenue, and a rehearsed operator transition—not “zero A/R,” uncontaminated revenue, or an instantaneous founder replacement.

- Keep customer charge principal, connected-merchant balances, Nitewide application fees, Stripe processing costs, affiliate commissions, taxes, refunds, application-fee refunds, disputes, reserves, subscriptions, boosts, and payouts separately identifiable in the immutable ledger and general ledger mapping.
- Maintain the approved pricing source of truth: Free is 7% + $0.65 per paid order; Gold is $199/month + 5% + $0.50 per paid order. Report gross platform fees, refunded/credited fees, processor costs, dispute losses, reserves, and net revenue separately rather than presenting gross fees as clean earnings.
- External-account recovery reduces collection work but does not eliminate receivables or contingent exposure. A failed venue-bank debit, contractual indemnity claim, unsupported connected account, timing difference, or unrecovered deficit becomes a tracked recovery item with owner, aging, status, expected-loss treatment, escalation, and write-off approval.
- Define with a CPA whether Nitewide is principal or agent for each revenue stream, when application fees and subscriptions are earned, how failed renewals/deferred revenue are treated, and when refunds, credits, chargebacks, taxes, reserves, and bad debt become contra-revenue, expense, liability, or receivable.
- Reconcile daily from Stripe objects and balance transactions through the internal subledger to bank deposits; perform a documented monthly close with exception aging, connected-account deficit rollforward, application-fee refund rollforward, dispute/reserve rollforward, and reviewer evidence.
- Produce diligence schedules for GMV, gross and net take rate, subscription MRR, refunds, disputes, fraud losses, application-fee reversals, merchant receivables/aging, bad debt, reserves, processor fees, affiliate liabilities, cash restrictions, concentration, and reconciled cash.
- Make transition readiness testable: role-based access instead of founder identity, credential and signing-key escrow, documented architecture/ADRs/runbooks, automated deploy/rollback/restore, vendor and processor contacts, contract/IP register, incident authority, and a supervised operator-transition drill with measured gaps.
- Buyers still evaluate key-person, regulatory, security, merchant concentration, platform reliability, and customer-support risk. Automation lowers those risks; it does not make the company self-regulating or remove the need for controlled human judgment.

Decision sources: [Stripe application-fee refunds](https://docs.stripe.com/api/fee_refunds/create) and [Stripe Connect revenue recognition](https://docs.stripe.com/revenue-recognition/connect).

## Application outcomes

### Nitewide Customer

- Discover nearby events by current city and day, then search/filter by location, date, category, price, venue, and organizer.
- Read fast, indexable event and organization pages; select tickets, packages, guestlist, or reservations without an app download.
- Register/sign in, pay with supported payment methods, receive durable QR credentials, view orders, transfer eligible tickets, and track guestlist approval.
- Follow organizers/events, receive reminders, share attributable links, and get consent-respecting recommendations in later phases.
- Receive configurable email/SMS confirmations and reminders for purchased, transferred, reserved, RSVP, or approved-guestlist events, plus immediate guestlist decision and material event-change notices.

### Nitewide Business

- Onboard organizations or work as an independent creator; invite owners, managers, employees, hosts, and promoters with scoped permissions.
- Create, publish, and manage events, locations, sale windows, quantities, purchase limits, hidden/password offers, approval-required offers, packages, reservations, and at-door sales.
- Configure direct venue guestlists and independent per-promoter allocations; approve requests and operate fast QR/manual check-in with audit history.
- Monitor gross/net sales, fees, inventory, average order value, attendance, guestlist use, promoter conversion/commission, refunds, and customer cohorts.
- Add consent-aware CRM, segmentation, campaigns, automation, advanced reports, and business operations as Gold value—not as restrictions on basic selling configuration.
- Route actionable email/SMS/in-app alerts to only the roles allowed to respond when guestlist, reservation, refund, transfer, or other approval work is waiting; notify operators about sold-out/low-inventory states and customers about relevant availability changes.

### Communications rules

- Transactional messages and marketing consent are separate. A user cannot accidentally unsubscribe from required purchase, security, admission, refund, or material event-change notices.
- Every message is generated from an auditable event/outbox record with idempotency, retries, delivery state, provider identifiers, template version, locale/timezone, and suppression reason.
- Attendee reminders use the event timezone and cover ticket holders, approved guestlist attendees, reservation holders, and accepted transfers without sending duplicates.
- Approval notifications are capability-scoped, deduplicated, summarized when appropriate, and deep-link to the exact authorized queue; resolved requests stop reminders.
- Low inventory and sold-out transitions are emitted once per relevant state change and can trigger operator alerts, customer waitlists, or marketing automation without overselling.
- Marketing requires channel-specific consent, preference controls, suppression/unsubscribe handling, frequency caps, audience provenance, and attribution.

### Nitewide Admin

- Apply least-privilege staff roles; find and safely support users, organizations, events, orders, payments, tickets, guestlists, and check-ins.
- Moderate marketplace content, investigate fraud/abuse, resolve payment/refund/payout cases, and inspect immutable audit trails.
- Configure pricing, subscriptions, boosts, feature flags, cities/regions, and launch controls without deploying code.
- Monitor platform health, marketplace liquidity, revenue, risk, support demand, and data quality.

## Cross-platform quality targets

Targets apply to the Florida public launch unless a later scale gate supersedes them.

- Public web: Core Web Vitals at p75 of LCP ≤ 2.5 seconds, INP ≤ 200 ms, and CLS ≤ 0.1 on representative mobile traffic.
- API: p95 cached/read requests ≤ 300 ms and ordinary writes ≤ 500 ms, excluding third-party payment latency.
- Door operations: online QR validation p95 ≤ 500 ms; duplicate, invalid, refunded, transferred, and already-used states are explicit.
- Admission evidence: 100% of successful production admissions create an append-only credential/check-in record linked to the applicable order and payment; manual/offline exceptions are reconciled and reviewed.
- Disputes: evidence completeness, submission timeliness, win rate by reason, dispute/fraud rate, losses, reserve coverage, and manual-review volume are measured without treating check-in as conclusive authorization proof.
- Reliability: 99.9% monthly API availability target for the pilot, tested backups, documented recovery objectives, and alerts on checkout/check-in failures.
- Correctness: zero accepted oversells in concurrency tests; webhooks and client retries cannot double-charge, double-issue, or double-check-in.
- Accessibility: customer and operational critical paths meet WCAG 2.2 AA.
- Privacy/security: least privilege, consent provenance, data minimization/retention, secret rotation, dependency scanning, rate limiting, and incident response are launch gates.

## Geographic rollout

Cities are go-to-market configuration, not database special cases. Every new market must pass partner density, event supply, demand, support coverage, payments/legal readiness, and unit-economics gates.

| Wave | Regions and candidate metros |
|---|---|
| Florida beta and public launch | Orlando, Miami, Fort Lauderdale, Tampa |
| National wave 1 candidates | New York, Los Angeles, Chicago, Atlanta, Dallas, Houston, Las Vegas, Washington DC |
| National wave 2 candidates | Philadelphia, Boston, San Francisco, Seattle, Minneapolis, Phoenix, Detroit, Denver, San Diego, St. Louis, Charlotte, Indianapolis, Baltimore, Portland, Nashville |

No regional phase sits between Florida and national expansion. National markets are scored and launched in evidence-based waves using organizer pipeline, nightlife density, demand signals, acquisition cost, competition, payments/legal readiness, support load, and unit economics.

## Scale and strategic value gates

Valuation is determined by investors or buyers, market conditions, growth quality, risk, and negotiated terms. These stages are decision gates—not promises or formulas tying a metric to a valuation.

| Strategic stage | Evidence required before advancing |
|---|---|
| ~$1M foundation narrative | Working end-to-end product, coherent model, reliable test environment, design partners, measurable funnel, and clear security/payment plan. |
| ~$5M–$10M seed case | One-city product-market-fit evidence, repeat organizers, growing paid GMV/net revenue, healthy activation and event retention, controlled support burden, and reliable checkout/admission. |
| ~$25M–$50M growth case | Repeatable 3–5 city playbook, strong cohort retention, improving contribution margin, multi-million-dollar annual GMV, meaningful transaction plus subscription revenue, and mature controls. |
| $100M exit-ready case | Defensible multi-city supply/demand network, differentiated customer/affiliate data graph, durable organizer retention, high-quality recurring net revenue, clean IP/contracts/financials, and credible strategic synergies. |
| $250M–$500M platform case | National multi-vertical reach, mature payments/CRM/marketing products, enterprise controls, high marketplace liquidity, efficient acquisition, and scalable operations. |
| $1B category-leader case | Category leadership with exceptional sustained growth, very large GMV/net revenue, international or major enterprise expansion, strong margins, and a defensible payments/data/distribution moat. |

At each quarterly review, track GMV, net revenue, take rate, Gold MRR, gross/contribution margin, active organizations, published and transacting events, organizer activation, 30/90/180-day organizer retention, buyer conversion/repeat rate, acquisition cost/payback, refund/chargeback/fraud rates and losses, dispute evidence completeness/timeliness/win rate by reason, admission scan coverage/manual overrides, reserve coverage, support contacts per order, uptime, checkout success, check-in latency, and city-level supply/demand liquidity.

## Architectural scale path

1. **Pilot:** modular monolith, PostgreSQL/PostGIS, disciplined transactions, background-job boundary, structured logs, and production observability.
2. **Multi-city:** connection pooling, caching, queues, materialized/reporting read models, bulk operations, CDN/media pipeline, and location-aware indexes.
3. **National:** independently scalable checkout/check-in workloads where evidence warrants it, warehouse/BI pipeline, feature flags, automated fraud controls, tenancy isolation tests, and regional failover planning.
4. **Platform:** versioned APIs/webhooks, enterprise identity and controls, data residency/internationalization where required, partner ecosystem, and carefully extracted services only around proven scaling boundaries.

## Release governance

- Product milestones are accepted against measurable exit criteria, not calendar dates alone.
- Financial, privacy, security, and legal controls are reviewed before real-money launch and before each new region.
- Scope enters a sprint only when dependencies and acceptance criteria are explicit.
- Every production flow owns telemetry, alerts, a support path, and a rollback or containment plan.
