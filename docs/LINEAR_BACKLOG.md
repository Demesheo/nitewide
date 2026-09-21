# Linear setup and initial backlog

This document is the import map for the Nitewide Linear workspace. It keeps the external tracker reproducible and prevents product decisions from living only in tickets.

## Workspace structure

**Project:** [Nitewide — MVP to Market](https://linear.app/demesheo/project/nitewide-mvp-to-market-14fde07cb15e/overview)

**Repository:** https://github.com/Demesheo/nitewide

**Delivery cadence:** one-week alpha sprints, two-week beta sprints, then milestone outcome windows

**Milestones:** M0 Foundation/Entity/Architecture, M1 Transaction-ready Alpha, M2 Florida Beta, M3 Florida Public Launch, M4 National Readiness, M5 National Expansion, M6 National Scale/Strategic Readiness

## Linear synchronization status

- Synchronized September 20, 2026 as 103 consecutive issues, `DEM-5` through `DEM-107`, with no missing identifiers or duplicate titles.
- The original 53 issues were expanded in place; 50 operating, legal, finance, payment, admission-evidence, dispute-risk, affiliate-economics, expansion, communications, and marketing issues were added.
- All 103 synchronized issues are intentionally unassigned and carry a project, milestone, priority, estimate, relevant labels, testable acceptance criteria, verification evidence, dependencies/risks, and a solo-founder execution note.
- Current synchronized milestone allocation is M0: 12, M1: 28, M2: 21, M3: 12, M4: 13, M5: 9, and M6: 8. No synchronized issue is missing a milestone.
- `ADS-01` and `DATA-02` are approved locally and queued for the next Linear synchronization because the workspace's Linear Agent daily limit was reached. Once synchronized, the expected total is 105 issues and M4 increases to 15.
- The project runs from September 20, 2026 through September 20, 2027.
- `Demesheo/nitewide` is linked to the `DEM` team with one-way GitHub → Linear issue creation. Updates to synchronized issues remain bidirectional; new Linear backlog items are not duplicated into GitHub Issues.
- Linear's available workspace automation could not create or schedule cycles. Sprint dates are therefore retained in issue descriptions and in the roadmap until cycles are enabled or created manually.

### Goals

1. Ship a trustworthy transaction-ready Nitewide alpha by October 18, 2026.
2. Run a four-market Florida design-partner beta by November 15, 2026.
3. Launch Nitewide publicly in Orlando, Miami, Fort Lauderdale, and Tampa by December 15, 2026.
4. Become ready for evidence-ranked national market waves by February 28, 2027.
5. Build an exit-ready, defensible marketplace and operating platform while preserving a path to national category leadership.

### Labels

- App: `customer`, `business`, `admin`, `platform`
- Domain: `auth`, `discovery`, `commerce`, `payments`, `guestlist`, `admission`, `affiliates`, `analytics`, `crm`, `growth`, `operations`, `security`, `communications`, `email`, `sms`, `marketing`
- Type: `feature`, `infrastructure`, `research`, `compliance`
- Region: `orlando`, `miami`, `fort-lauderdale`, `tampa`, `florida`, `national`
- Operating model: `solo-founder`, `outsourced`, `legal`, `finance`

Priorities use P0 (launch blocker), P1 (milestone-critical), P2 (important), and P3 (later). Estimates are relative points.

## Sprint 0 — Sep 20–27, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| PLAT-01 | 2 | P0 | As a team, we need GitHub and Linear connected so code and product delivery share traceability. | Repository is linked; issue/branch/PR conventions and status automation are documented. |
| PLAT-02 | 5 | P0 | As a maintainer, I need CI on every change so regressions cannot silently ship. | Tests, builds, migration validation, formatting/lint, dependency and secret checks run with protected required status. |
| PLAT-03 | 3 | P0 | As an operator, I need explicit SLOs and analytics events so launch quality is measurable. | Funnel/event taxonomy, Core Web Vitals, API, checkout, check-in, and availability dashboards are specified with owners. |
| PLAT-04 | 5 | P0 | As a customer, I need a production-safe identity design so my account cannot be easily compromised. | Secure session/cookie, verification, recovery, logout/revocation, throttling, provider decision, and threat model are approved. |
| PAY-01 | 5 | P0 | As finance, I need a payment architecture decision so fees, refunds, payouts, tax, and reconciliation have one source of truth. | Provider/Connect model, money flow, webhooks, idempotency, ledger, dispute/refund/payout boundaries, and sandbox plan are approved. |
| OPS-01 | 3 | P1 | As a founder, I need a production risk register and launch checklist so blockers remain visible. | Security, privacy, legal, support, payments, reliability, and partner risks have owner, severity, mitigation, and review date. |

## Sprint 1 — Sep 28–Oct 4, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| CUST-01 | 5 | P0 | As a visitor, I can view an indexable event page with location privacy, schedule, organizer, offerings, and availability. | Responsive page handles public/attendee-only/private location rules, loading/empty/error states, metadata, and analytics. |
| CUST-02 | 8 | P0 | As a customer, I can select multiple ticket/package quantities and review a correct cart before paying. | Price/fee breakdown, limits, availability refresh, validation, mobile UX, and no client-authoritative totals. |
| CUST-03 | 5 | P0 | As a customer, I can create, verify, recover, sign in, and sign out of my account securely. | Customer-only signup, verification, reset, session rotation/revocation, enumeration resistance, and tests. |
| PAY-02 | 8 | P0 | As a customer, I can complete a sandbox payment exactly once despite retries. | Hosted/secure payment UI, server-side totals, idempotent order/payment creation, webhook verification, and failure recovery. |
| BIZ-01 | 5 | P0 | As an organizer, I can create an organization or continue as an independent creator. | Validated onboarding, owner membership, generic category/location, audit trail, and permission tests. |
| BIZ-02 | 8 | P0 | As an authorized creator, I can draft, edit, preview, publish, unpublish, and cancel an event. | Lifecycle rules, required fields, timezone handling, location privacy, audit history, and concurrency protection. |
| BIZ-03 | 8 | P0 | As an organizer, I can configure multiple ticket/package tiers without needing Premium. | Quantities, price, entries/unit, sales window, limits, visibility/password, approval setting, and inventory tests. |

## Sprint 2 — Oct 5–11, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| CUST-04 | 5 | P0 | As a buyer, I can view order history and retrieve durable QR credentials. | Only authorized users can access orders; QR is securely delivered/reissued and refunded/transferred states are clear. |
| CUST-05 | 5 | P0 | As a customer, I can request direct or promoter guestlist access and track pending/approved/rejected status. | Capacity source is explicit; duplicate requests and authorization are handled; credential exists only after approval. |
| BIZ-04 | 5 | P0 | As authorized staff or a promoter, I can review only guestlist requests within my scope. | Venue and promoter pools remain independent; decisions are transactional, audited, capacity-safe, and notify the customer. |
| BIZ-05 | 8 | P0 | As door staff, I can scan or manually find admissions quickly and understand every rejection state. | Online QR p95 target, duplicate prevention, search fallback, permission checks, audit trail, and entry/exit model. |
| BIZ-06 | 5 | P1 | As an owner, I can invite employees/hosts and assign least-privilege event responsibilities. | Invitation expiry, role scopes, removal, event assignment, audit entries, and privilege-escalation tests. |
| ADMIN-01 | 5 | P0 | As an internal operator, I can sign in with scoped staff permissions. | Admin is not a client-selected role; MFA/provider plan, session controls, RBAC matrix, audit trail, and tests. |
| ADMIN-02 | 5 | P0 | As support staff, I can search users, organizations, events, orders, tickets, and guestlists without unrestricted data access. | Fast filters, masked sensitive fields, permission scopes, deep links, and access auditing. |

## Sprint 3 — Oct 12–18, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| PAY-03 | 8 | P0 | As finance/support, I can refund an eligible order and reconcile payment, ticket, fee, and inventory state. | Full/partial policy, idempotency, webhook races, revoked credentials, immutable ledger/audit, and tests. |
| PAY-04 | 8 | P0 | As an organizer/affiliate, I can see pending/available/paid balances backed by reconciled transactions. | Split rules, commission precedence, negative adjustments, payout eligibility, provider state, and export are defined. |
| BIZ-07 | 5 | P0 | As an event operator, I can monitor sales, inventory, guestlist, and check-ins during an event. | Freshness is visible; filters and totals reconcile; degraded/error states and operational alerts exist. |
| BIZ-08 | 5 | P1 | As an owner, I can invite org affiliates and select event promoters with versioned reward offers, overrides, and attributable links. | Percentage/fixed and per-ticket/per-order terms, eligible tiers, caps, public/private access, defaults/overrides, links/codes, allocation, disablement, and permission tests pass without stacking. |
| ADMIN-03 | 5 | P0 | As support, I can inspect payment/refund/payout timelines and safely initiate allowed remediation. | Step-up permission, reason capture, confirmation, provider reconciliation, audit, and no silent destructive action. |
| PLAT-05 | 8 | P0 | As the launch team, we need end-to-end alpha acceptance coverage and observability. | Automated happy/failure/concurrency tests cover discovery-to-entry; traces/logs/metrics correlate order, payment, and credential. |

## Sprint 4 — Oct 19–Nov 1, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| BIZ-09 | 5 | P0 | As a design partner, I can complete guided onboarding and publish a real event safely. | Checklist, sandbox/live separation, payout setup, support contact, sample removal, and activation telemetry. |
| COMMS-01 | 5 | P0 | As a customer, I receive verified transactional email/SMS for account, order, guestlist, transfer, refund, and event changes. | Consent/transactional classification, templates, retries, delivery events, suppression, and no secrets/QR leakage. |
| PAY-05 | 8 | P0 | As an organization, I can use Free or subscribe to Premium with correct billing and entitlements. | $249/month Premium, identical buyer-funded transaction pricing on both plans, no Premium fee discount, lifecycle, failed renewal, cancellation, invoices, and server-side enforcement. |
| GROWTH-01 | 5 | P1 | As an organizer, I can purchase a boost on either tier without an automatic Premium discount. | Inventory/placement policy, billing, disclosure, start/end, reporting, refund rules, and admin control. |
| CUST-06 | 5 | P1 | As a ticket holder, I can transfer an eligible credential without creating two valid entries. | Secure acceptance, expiry/cancel, ownership history, QR rotation, notifications, and audit. |

## Sprint 5 — Nov 2–15, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| BIZ-10 | 8 | P0 | As an operator, I can filter and export trustworthy sales, fees, inventory, AOV, attendance, and guestlist reports. | Totals reconcile to ledger; timezone/currency, saved filters, CSV safety, access control, and freshness are explicit. |
| BIZ-11 | 5 | P1 | As an owner, I can compare affiliate clicks, visits, requests, sales, gross rewards, Nitewide fees, promoter net rewards, conversion, AOV, and guestlist use. | Attribution windows/model are documented; reports expose reversals and contribution economics; disabled promoters and historical terms remain accurate. |
| ADMIN-04 | 5 | P0 | As an administrator, I can review immutable audit trails for sensitive actions. | Actor, target, before/after, reason, correlation, timestamp, filtering, retention, and restricted export. |
| ADMIN-05 | 5 | P1 | As an administrator, I can moderate organizations/events and configure pricing, boosts, features, cities, and launch state. | Changes are validated, versioned, auditable, reversible where possible, and protected by scoped permissions. |
| ADMIN-06 | 5 | P1 | As leadership, I can see platform revenue, GMV, supply, demand, reliability, risk, and support health. | Metrics are defined, time/region filters work, data quality/freshness is visible, and source reports reconcile. |

## Sprint 6 — Nov 16–29, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| PLAT-06 | 8 | P0 | As users, we need critical flows to meet WCAG 2.2 AA and mobile performance budgets. | Automated/manual accessibility checks and p75 LCP/INP/CLS budgets pass on representative devices. |
| PLAT-07 | 8 | P0 | As operations, we need proven capacity for beta traffic and event-door bursts. | Load model covers browse/checkout/webhooks/check-in; no oversells/double entry; bottlenecks and safe limits documented. |
| SEC-01 | 8 | P0 | As the company, we need security/privacy launch gates completed. | Threat model actions, access review, dependency/secret scanning, retention/deletion, consent provenance, incident plan, and testing pass. |
| OPS-02 | 5 | P0 | As on-call support, I need monitoring, alerts, backups, recovery, and incident runbooks. | Owners and escalation exist; restore drill and payment/check-in incidents are rehearsed; RPO/RTO measured. |
| OPS-03 | 5 | P0 | As a design partner, I can run a complete rehearsal before beta release. | Partner acceptance script covers publish, purchase, guestlist, promoter, refund, door, reporting, and support handoff. |

## Post-beta epics

| ID | Pri | User story / deliverable | Target milestone |
|---|---:|---|---|
| CRM-01 | P1 | As an organizer, I can search and segment consented customers without exposing data I do not control. | M3 |
| CRM-02 | P1 | As an organizer, I can send compliant email/SMS campaigns and automated reminders with attribution. | M4 |
| TABLE-01 | P2 | As a venue, I can define sections/tables, capacity, minimum spend, packages, deposits, hosts, and request/assignment states. | M4 |
| CUST-07 | P2 | As a customer, I can request/reserve a table and track approval, deposit, guests, and status. | M4 |
| CUST-08 | P2 | As a customer, I can follow organizers/events and receive reminders and consent-respecting recommendations. | M4 |
| REPORT-01 | P1 | As a Premium operator, I can use searchable/filterable multi-dimensional visualizations, promoter ROI, cohorts, retention views, and scheduled exports. | M4 |
| CITY-01 | P0 | As the growth team, I can evaluate and launch a city using supply, demand, partner, support, legal, and unit-economics gates. | M4 |
| CITY-02 | P1 | As leadership, I can compare city cohorts and pause expansion when liquidity or economics miss thresholds. | M5 |
| API-01 | P2 | As an approved partner, I can use versioned APIs/webhooks with scoped credentials, limits, replay, and documentation. | M5 |
| SCALE-01 | P1 | As engineering, we can scale multi-city reporting with queues, caching, location indexes, and read models. | M5 |
| SCALE-02 | P2 | As the company, we can validate a second event vertical without adding nightlife-specific core schema. | M6 |
| EXIT-01 | P1 | As leadership, we can complete an acquisition/financing readiness review with clean metrics, contracts, IP, security, and financial controls. | M6 |

## Expanded solo-founder and launch-gap backlog

These issues fill the operating, legal, financial, payments, launch, and national-scale gaps identified after the initial import. They are deliberately written so specialist work can be outsourced while the founder retains an auditable decision and acceptance record.

### M0 — Foundation, entity, and architecture

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| FOUND-01 | P0 | 5 | Establish the solo-developer/AI delivery system: protected CI, AI review checklist, decision records, dependency automation, release train, rollback ownership, and a weekly capacity review. |
| LEGAL-01 | P0 | 3 | Select and engage a Florida startup attorney and CPA; document scopes, quotes, conflicts, confidentiality, deadlines, and which decisions require licensed advice. |
| LEGAL-02 | P0 | 5 | Form the advised legal entity, obtain EIN/registered-agent records, and evaluate/file an S-corporation election only after tax advice; store confirmations securely. |
| FIN-01 | P0 | 3 | Open dedicated business checking/savings and payment-processor accounts with least-privilege access, dual-factor recovery, ownership records, and no commingled funds. |
| LEGAL-03 | P0 | 5 | Obtain written marketplace, payments/payouts, money-transmission, ticketing, sales-tax, privacy, and Florida launch risk analysis with action list. |
| OPS-04 | P1 | 3 | Create an outsourcing/vendor register covering legal, accounting, insurance, security testing, accessibility, design, and after-hours incident help with budgets and acceptance owners. |

### M1 — Transaction-ready alpha

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| PAY-06 | P0 | 8 | Complete a Stripe Connect proof of concept and processor comparison; target seller connected-account direct charges, Stripe-owned payment-loss liability, and supported automatic external-account debit for negative balances; decide charge type, fee collection, split model, merchant/tax/support duties, unsupported-account fallback, and prohibited platform-liability configurations in an ADR. |
| PAY-07 | P0 | 8 | Add Stripe-hosted/embedded KYC/KYB and bank-account onboarding with capability/status tracking, requirements remediation, privacy boundaries, and test fixtures. |
| PAY-08 | P0 | 8 | Implement immutable pending/available/scheduled/in-transit/paid/failed/reversed/held balance and payout states reconciled to provider objects. |
| PAY-09 | P0 | 5 | Define and enforce risk holds, reserves, new-organizer limits, refund/dispute offsets, payout blocking, automatic connected-bank negative-balance recovery monitoring, failed-recovery escalation, sales/payout freezes, manual review, and auditable release decisions without silently funding venue deficits from Nitewide’s operating account. |
| CUST-09 | P0 | 8 | Complete current-city/date discovery with search, filters, map/list behavior, SEO city pages, location privacy, empty states, and analytics. |
| PLAT-08 | P0 | 8 | Create preview/staging/production delivery with managed hosting/database, DNS/TLS, environment separation, secrets, migrations, health checks, rollback, and deployment telemetry. |

### M2 — Florida design-partner beta

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| CITY-03 | P0 | 5 | Configure Orlando, Miami, Fort Lauderdale, and Tampa as data-driven markets with boundaries, aliases, timezones, landing pages, launch state, and representative fixtures. |
| GROWTH-02 | P0 | 5 | Build a founder-led venue/promoter pipeline with qualification, outreach templates, consent, follow-up, objections, demo script, conversion stages, weekly targets, and a Florida experiment testing the mature-market assumption that transparent 90%-of-reward promoter economics can drive 50% of paid transactions through attributable promoter/affiliate traffic while improving venue adoption, retention, and contribution margin. |
| ECON-01 | P0 | 8 | Implement versioned buyer-funded pricing: the same 7.5% + $0.85 service fee per paid order for Free and $249/month Premium organizations, explicit fee display, no organizer-side or Premium-discounted transaction fee, configurable 10% service fee on organizer-funded promoter rewards, transparent gross/fee/net ledgers, refunds/reversals, and unit-economics telemetry. Never call an estimate the exact Stripe fee or report gross fees/subscriptions as net profit. |
| GROWTH-03 | P1 | 5 | Publish Florida city/venue/event SEO pages with canonical metadata, structured data, sitemaps, moderation, performance budgets, and measurable acquisition funnels. |
| BIZ-12 | P1 | 5 | Add event duplication and validated bulk import so one developer can onboard partner calendars quickly without corrupting inventory or permissions. |
| PAY-10 | P1 | 5 | Add provider-controlled Instant Payouts for eligible accounts with availability display, transparent fees, limits, confirmation, ledger entries, and failure handling. |
| OPS-05 | P0 | 5 | Launch a self-service help center and support intake with identity verification, ticket routing, macros, payment/admission escalation, response targets, and feedback capture. |

### M3 — Florida public launch

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| LEGAL-04 | P0 | 5 | Have counsel finalize customer terms, privacy/cookie notices, purchase/refund/transfer policy, consent language, age rules, and Florida disclosures; publish versioned acceptance records. |
| LEGAL-05 | P0 | 5 | Have counsel finalize organizer, venue, affiliate/promoter, data-processing, payout/reserve, prohibited-event, indemnity, and termination agreements. |
| FIN-02 | P0 | 5 | Establish CPA-approved principal/agent and revenue-recognition policies, chart of accounts, immutable-subledger mappings, daily processor-to-bank reconciliation, and monthly close covering application fees/refunds, subscriptions/deferred revenue, processor costs, taxes, disputes, reserves, affiliate liabilities, merchant-deficit aging, expected loss/write-offs, and retention evidence. |
| PAY-11 | P0 | 8 | Pilot live daily payouts scheduled within 24 hours after funds become available; verify KYC, holds, reconciliation, bank arrival visibility, failures, reversals, alerts, and support copy. |
| OPS-06 | P0 | 5 | Complete the Florida production launch checklist with feature/payment kill switches, data backup/restore, incident communications, support coverage, rollback, and go/no-go evidence. |
| RISK-01 | P0 | 3 | Obtain appropriate general liability, cyber/E&O, crime/payment, and event-related coverage recommendations; bind required policies and document exclusions/renewals. |

### M4 — National launch readiness

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| CITY-04 | P0 | 8 | Build national market scoring from organizer pipeline, event/nightlife density, demand, competition, CAC, support, legal/payment readiness, and unit economics. |
| PLAT-09 | P0 | 8 | Generalize market/timezone/tax/currency/configuration and content moderation so U.S. cities launch without code forks or local constants. |
| SEC-02 | P0 | 8 | Implement privacy requests, export/deletion, consent provenance, retention, legal holds, vendor inventory, breach workflow, and state-law applicability review. |
| OPS-07 | P1 | 5 | Automate national support triage, status communications, organizer education, runbooks, escalation, and outsourced overflow without exposing unrestricted customer data. |
| GROWTH-04 | P0 | 5 | Turn Florida learning into a repeatable national city-launch playbook with partner minimums, waitlists, content seeding, launch calendar, budget, KPIs, and stop criteria. |
| PAY-12 | P0 | 8 | Validate national payments/payout/tax coverage, connected-account eligibility, state restrictions, 1099 ownership, reserve policy, prohibited businesses, and processor escalation. |
| ADS-01 | P1 | 8 | Add Google AdSense-only inventory to customer discovery and eligible, Google-evaluable Free business content pages: responsive Google-rendered units in clearly labeled card-shaped slots target 12% of organic event cards with a two-slot target below 12 only when content density permits; footer/right-rail business slots; no direct sponsors, house/affiliate ads, Ad Manager, other networks, or modified creative; consent/RDP/GPP/GPC controls; no ads on checkout, credentials, communications, approvals, check-in, disputes, or sparse pages; accessibility/performance, invalid-traffic, fill/viewability, revenue, and conversion telemetry. |
| DATA-02 | P1 | 8 | Launch aggregated minimum-cohort market insights with deidentification, suppression/query controls, contractual no-reidentification, export review, access logs, retention, reidentification testing, privacy assessments, and counsel approval. Personal records, contact lists, precise location, raw cookies/device IDs, payment/admission histories, and relationship graphs are never sold; personalized ads or legally defined sale/share remain disabled until the complete consent/opt-out/GPC/GPP and state-law program passes. |

### M5 — National expansion

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| CITY-05 | P0 | 8 | Launch the first evidence-ranked national wave with per-city owners-by-automation, partner readiness, content quality, support capacity, budgets, and rollback thresholds. |
| GROWTH-05 | P1 | 8 | Automate qualified partner acquisition, referral tracking, onboarding nudges, lifecycle messaging, attribution, experiments, and city-level CAC/payback reporting. |
| SCALE-03 | P0 | 8 | Run national browse/checkout/webhook/check-in load and chaos tests; document capacity, graceful degradation, queue backpressure, recovery, and spend controls. |
| DATA-01 | P1 | 8 | Build privacy-aware warehouse/BI pipelines and certified metrics for city cohorts, marketplace liquidity, organizer retention, buyer repeats, payments, risk, and margins. |
| SEC-03 | P0 | 8 | Add rules and review tooling for account/payment/promo abuse, velocity, device/risk signals, payout holds, false-positive measurement, appeals, and auditability. |
| OPS-08 | P1 | 5 | Establish vendor SLAs, on-call backup, incident authority, security contacts, service budgets, and business-continuity coverage for a solo founder. |

### M6 — National scale and strategic readiness

| ID | Pri | Pts | Deliverable and acceptance summary |
|---|---:|---:|---|
| STRAT-01 | P1 | 5 | Build a permissioned financing/acquisition data room with corporate, cap table, contracts, IP, financial, tax, product, security, privacy, and KPI evidence. |
| STRAT-02 | P1 | 5 | Maintain monthly downside/base/upside operating models, including the 80-nightclub-venue case with $500 GA sales per event-night plus one $5,000 ticket-only non-nightclub event per ten nightclub event-nights, and run value reviews against retention, growth, margins, liquidity, concentration, risk, defensibility, and the Florida $50M, $100M-exit, and $1B-category-leader evidence gates. Reconcile actuals, separate enterprise/equity value, and prohibit guaranteed valuation claims or stale-comparable multiples. |
| LEGAL-06 | P1 | 5 | Complete trademark/domain, open-source, contractor invention assignment, partner contract, privacy, regulatory, and litigation/claim diligence with remediation owners. |
| FIN-03 | P1 | 8 | Produce audit-ready books and diligence schedules for GMV, gross/net take rate, $249 Premium MRR, Premium attach/churn and subscription gross margin, credits, Stripe Billing and analytics/support costs, refunded fees, processor costs on the full customer charge, venue-funded gross promoter kickbacks, Nitewide's 10% kickback fee, promoter net rewards, disputes/fraud losses, reserves, merchant receivables and aging, bad debt, restricted cash, affiliate liabilities, reconciled deposits, tax filings, forecasts, scenarios, concentration, and normalized metrics; do not claim pure profit, zero A/R, or uncontaminated revenue. |
| SCALE-04 | P2 | 8 | Review the architecture against 10x/100x transaction, check-in, city, tenant, analytics, and recovery scenarios; extract services only where measured evidence supports it. |
| FOUNDER-01 | P0 | 5 | Reduce solo-founder bus-factor risk with role-based access, credential/signing-key escrow, recovery access, vendor and processor contacts, contract/IP register, architecture/ADR/runbook index, automated deploy/rollback/restore verification, an authorized emergency operator, and a supervised transition drill with remediated gaps. |

## Communications and marketing expansion

| ID | Pri | Pts | Target | Deliverable and acceptance summary |
|---|---:|---:|---|---|
| COMMS-02 | P0 | 8 | M1 | Build a channel-neutral notification outbox and email/SMS adapters with idempotency, templates/versioning, retries, delivery webhooks, timezone/locale support, suppression, audit history, observability, and provider failover boundaries. |
| COMMS-03 | P0 | 5 | M2 | Send configurable attendee confirmations and reminders for purchased tickets, accepted transfers, reservations, RSVPs, and approved guestlist entries; deduplicate recipients and use the event timezone. |
| COMMS-04 | P0 | 5 | M2 | Notify only authorized owners/managers/employees/hosts/promoters when guestlist, reservation, refund, transfer, or other approval requests need action; deep-link to the scoped queue and stop alerts after resolution. |
| COMMS-05 | P1 | 5 | M2 | Emit low-inventory and sold-out transitions, alert configured operators once per state change, update public availability, support waitlists, and prevent alert storms or oversells. |
| MKT-02 | P1 | 8 | M4 | Add consent-based email/SMS marketing with channel preferences, audience provenance, segmentation, templates, scheduling, tests, suppression/unsubscribe, frequency caps, campaign attribution, and compliance evidence. |

## Admission evidence and dispute-risk expansion

| ID | Pri | Pts | Target | Deliverable and acceptance summary |
|---|---:|---:|---|---|
| ADMIT-01 | P0 | 8 | M1 | Implement the auditable `PaymentIntent/Charge → Order → OrderItem → Ticket → signed opaque QR → CheckIn` chain; record credential/key version, event, gate, timestamp, scanner/operator, state, online/offline mode, and reasoned overrides without exposing payment or customer data in the QR. |
| RISK-02 | P0 | 8 | M2 | Build an idempotent asynchronous workflow for Stripe dispute-created/updated/funds/closed events: create one auditable case, apply reversible risk restrictions with notice/appeal, compile and validate reason-specific evidence, notify authorized connected merchants with a secure deep link and Stripe `due_by` deadline, require human approval/submission, reconcile outcomes/recovery, and measure results. Never email sensitive attachments, assume a fixed seven-day deadline, treat a dispute as proven fraud, or retain full ID images without counsel-approved controls. |

## Backlog rules

- The durable product decision belongs in repository documentation; the Linear issue links to it.
- Each issue receives one application label, relevant domain/region labels, a milestone, a cycle when scheduled, an owner before work starts, and testable acceptance criteria.
- An issue moves to Done only under the repository definition of done in `TODO.md`.
- Valuation stages in the roadmap are strategic evidence gates and must never be converted into guaranteed forecasts.
