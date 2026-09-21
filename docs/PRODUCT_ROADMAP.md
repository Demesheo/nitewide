# Nitewide product roadmap

Last updated: September 20, 2026

## Product direction

Nitewide is a web-first nightlife discovery, commerce, promotion, and operations platform. The brand stays focused on nightlife at launch, while the platform continues to use generic concepts—users, organizations, events, locations, offerings, orders, credentials, affiliates, and audit records—so concerts, festivals, private events, hospitality, and other verticals can be added without a rewrite.

The product is organized into five connected systems:

1. **Discover** — location-aware event search and conversion.
2. **Sell** — tickets, packages, guestlists, reservations, checkout, credentials, and admission.
3. **Promote** — affiliate links, allocations, attribution, commissions, campaigns, and boosts.
4. **Manage** — organization, event, staff, inventory, door, customer, and support operations.
5. **Analyze** — trusted sales, attendance, customer, affiliate, and marketplace reporting.

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
| M1 — Transaction-ready alpha | Sep 28–Oct 18, 2026 | A customer can discover, register, purchase in Stripe test mode, receive a QR credential, request guestlist access, and be checked in; business/admin users operate and reconcile the complete flow. |
| M2 — Florida design-partner beta | Oct 19–Nov 15, 2026 | Design partners in Orlando, Miami, Fort Lauderdale, and Tampa can onboard, publish, sell, configure promoters/guestlists, scan entry, view balances, and read trusted reports. |
| M3 — Florida public launch | Nov 16–Dec 15, 2026 | Real payments, refunds, risk controls, daily payout scheduling, legal policies, support runbooks, and production reliability gates pass for all four Florida launch markets. |
| M4 — National launch readiness | Dec 16, 2026–Feb 28, 2027 | The Florida playbook is automated; national city scoring, timezone/tax configuration, privacy operations, partner onboarding, fraud controls, and support capacity are ready. |
| M5 — National expansion | Mar 1–May 31, 2027 | Evidence-selected U.S. markets launch in waves using standardized acquisition, city operations, payments, reporting, and reliability controls rather than a fixed Southeast/Texas sequence. |
| M6 — National scale and strategic readiness | Jun 1–Sep 20, 2027 | National cohort quality, unit economics, revenue durability, operational resilience, diligence readiness, and the next financing, acquisition, or category-leadership plan are reviewed. |

## Initial sprint plan

The accelerated launch uses one-week alpha sprints, two-week beta sprints, and larger outcome windows after launch. Scope can move, but launch gates cannot be waived.

| Sprint | Dates | Primary deliverable |
|---|---|---|
| Sprint 0 | Sep 20–27 | Linear/GitHub planning, CI, architecture decisions, metrics, SLOs, and production risk register. |
| Sprint 1 | Sep 28–Oct 4 | Managed identity, event detail/offer selection, organization/event CRUD, Stripe Connect spike, staging deployment. |
| Sprint 2 | Oct 5–11 | Test checkout/webhooks, order/QR wallet, guestlist request/approval, QR/manual check-in, operational search. |
| Sprint 3 | Oct 12–18 | Refund/balance ledger, affiliate links, live operations, alpha observability, security and end-to-end acceptance. |
| Sprint 4 | Oct 19–Nov 1 | Florida market configuration, partner onboarding, staff roles, communications, reporting, and payout onboarding. |
| Sprint 5 | Nov 2–15 | Four-market beta rehearsal, accessibility/performance/load work, support workflows, subscriptions and boosts. |
| Sprint 6 | Nov 16–29 | Live-payment pilot, daily cleared-fund payout scheduling, legal policies/contracts, bookkeeping, reserves, and incident drills. |
| Sprint 7 | Nov 30–Dec 15 | Florida public launch, partner/customer support, launch analytics, reliability freeze, and measured issue burn-down. |
| Sprint 8 | Dec 16–Jan 15 | Florida retention and conversion improvements; automate founder-heavy support and city operations. |
| Sprint 9 | Jan 16–Feb 28 | National readiness, market scoring, privacy/tax/payment coverage, fraud controls, and wave-one launch decision. |

## Payments and organizer payouts

The MVP default is Stripe Connect with Stripe-hosted or embedded onboarding and connected-account payout components. A short architecture/legal review remains a launch dependency because charge type determines fee collection, refund/dispute handling, negative-balance liability, tax reporting, and whether funds can be split among organizers and affiliates.

- Track `pending`, `available`, `scheduled`, `in_transit`, `paid`, `failed`, `reversed`, and `held` balances in an immutable internal ledger reconciled to provider objects.
- Schedule eligible standard payouts no later than 24 hours after funds become available, subject to account verification, risk holds, reserves, refunds, disputes, weekends/holidays, and provider/bank processing.
- Do not market “money in the bank within 24 hours.” POSH documents that card proceeds generally take 24–48 business hours to become available, while standard ACH arrival takes additional time.
- Offer provider-supported Instant Payouts only to eligible connected accounts, with transparent provider/platform fees and explicit risk limits. Never advance unsettled funds by default.
- Use provider-hosted KYC/KYB, bank/debit-card collection, tax information, and 1099 delivery wherever possible to minimize solo-founder compliance operations.
- Delay organizer/affiliate transfers until source funds and attribution are final enough for the configured risk tier; maintain reserves and reversible adjustments for refunds and disputes.
- Reconcile payments, transfers, payouts, refunds, disputes, fees, commissions, and net organizer balances daily, with idempotent webhooks and alerts for unmatched money movement.

Decision sources: [POSH balance and payout documentation](https://support.posh.vip/en/articles/15090213-managing-your-balance-payouts-bank-accounts), [POSH tax reporting](https://support.posh.vip/en/articles/15090259-tax-reporting-understanding-your-1099-k), [Stripe Connect payouts](https://docs.stripe.com/connect/supported-embedded-components/payouts), [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), and [Stripe tax-form settings](https://docs.stripe.com/connect/tax-form-settings).

## Application outcomes

### Nitewide Customer

- Discover nearby events by current city and day, then search/filter by location, date, category, price, venue, and organizer.
- Read fast, indexable event and organization pages; select tickets, packages, guestlist, or reservations without an app download.
- Register/sign in, pay with supported payment methods, receive durable QR credentials, view orders, transfer eligible tickets, and track guestlist approval.
- Follow organizers/events, receive reminders, share attributable links, and get consent-respecting recommendations in later phases.

### Nitewide Business

- Onboard organizations or work as an independent creator; invite owners, managers, employees, hosts, and promoters with scoped permissions.
- Create, publish, and manage events, locations, sale windows, quantities, purchase limits, hidden/password offers, approval-required offers, packages, reservations, and at-door sales.
- Configure direct venue guestlists and independent per-promoter allocations; approve requests and operate fast QR/manual check-in with audit history.
- Monitor gross/net sales, fees, inventory, average order value, attendance, guestlist use, promoter conversion/commission, refunds, and customer cohorts.
- Add consent-aware CRM, segmentation, campaigns, automation, advanced reports, and business operations as Gold value—not as restrictions on basic selling configuration.

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

At each quarterly review, track GMV, net revenue, take rate, Gold MRR, gross/contribution margin, active organizations, published and transacting events, organizer activation, 30/90/180-day organizer retention, buyer conversion/repeat rate, acquisition cost/payback, refund/chargeback/fraud rates, support contacts per order, uptime, checkout success, check-in latency, and city-level supply/demand liquidity.

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
