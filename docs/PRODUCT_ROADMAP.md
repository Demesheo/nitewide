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

## One-year execution timeline

All dates are planning targets. A milestone ships only when its exit criteria pass.

| Milestone | Dates | Outcome and exit criteria |
|---|---|---|
| M0 — Plan and harden foundation | Sep 20–27, 2026 | Backlog is tracked, CI is green, security/payment architecture is decided, analytics/SLOs are defined, and the local baseline is reproducible. |
| M1 — Transaction-ready alpha | Sep 28–Nov 8, 2026 | A customer can discover, register, purchase in a test payment environment, receive a QR credential, request guestlist access, and be checked in; business and admin users can operate those flows. |
| M2 — Orlando design-partner beta | Nov 9–Dec 20, 2026 | At least three design partners can onboard, publish, sell, manage promoters/guestlists, scan entry, reconcile money, and read trusted reports with monitored support. |
| M3 — Orlando production pilot | Jan 4–Feb 28, 2027 | Real payments/payouts/refunds, security/privacy controls, support runbooks, 99.9% service target, and pilot event reliability gates pass. |
| M4 — Florida expansion | Mar 1–May 31, 2027 | Orlando playbook is repeatable in Tampa and Miami; retention, organizer activation, and unit-economics gates are met before launch. |
| M5 — Southeast/Texas growth | Jun 1–Aug 31, 2027 | Selected Atlanta/Charlotte/Nashville and Dallas/Houston launches use standardized city operations, scalable reporting, CRM, and marketing. |
| M6 — Annual strategy and exit-readiness review | Sep 1–20, 2027 | Cohort retention, revenue quality, marketplace liquidity, security, financial controls, and acquisition readiness determine the next expansion or financing plan. |

## Initial sprint plan

Sprints are two weeks after the one-week planning sprint.

| Sprint | Dates | Primary deliverable |
|---|---|---|
| Sprint 0 | Sep 20–27 | Linear/GitHub planning, CI, architecture decisions, metrics, SLOs, and production risk register. |
| Sprint 1 | Sep 28–Oct 11 | Customer event detail/cart/checkout; payment provider and webhook foundation; business organization/event CRUD. |
| Sprint 2 | Oct 12–25 | Orders and QR wallet; guestlist request/status; staff approval and check-in UI; admin operational search. |
| Sprint 3 | Oct 26–Nov 8 | Refund/payout skeleton, live event dashboard, affiliate management, hardening, alpha acceptance tests. |
| Sprint 4 | Nov 9–22 | Design-partner onboarding, role invitations, transactional email/SMS, pricing/subscription enforcement. |
| Sprint 5 | Nov 23–Dec 6 | Sales/attendance/affiliate reporting, filters/export, admin payment/support/audit workflows. |
| Sprint 6 | Dec 7–20 | Beta load/security/accessibility testing, incident and recovery runbooks, partner rehearsal and beta release. |
| Hardening window | Dec 21–Jan 3 | Fix beta findings, freeze risky changes, and complete production launch review. |

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

Targets apply to production at the Orlando pilot unless a later scale gate supersedes them.

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
| Pilot | Orlando |
| Florida | Tampa, Miami |
| Southeast and Mid-Atlantic | Atlanta, Charlotte, Nashville, Washington DC, Baltimore |
| Texas | Dallas, Houston |
| Northeast | New York, Philadelphia, Boston |
| West | Los Angeles, San Diego, San Francisco, Las Vegas, Phoenix, Denver, Portland, Seattle |
| Midwest | Chicago, Detroit, Minneapolis, Indianapolis, St. Louis |

The order inside later waves is a hypothesis and should be re-ranked using organizer pipeline, demand signals, acquisition cost, competition, and operating constraints.

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
