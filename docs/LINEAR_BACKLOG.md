# Linear setup and initial backlog

This document is the import map for the Nitewide Linear workspace. It keeps the external tracker reproducible and prevents product decisions from living only in tickets.

## Workspace structure

**Project:** Nitewide — MVP to Market  
**Repository:** https://github.com/Demesheo/nitewide  
**Cycle cadence:** two weeks, starting September 28, 2026  
**Milestones:** M0 Foundation, M1 Transaction-ready Alpha, M2 Orlando Beta, M3 Orlando Pilot, M4 Florida Expansion, M5 Southeast/Texas Growth, M6 Annual Strategy Review

### Goals

1. Ship a trustworthy transaction-ready Nitewide alpha by November 8, 2026.
2. Run an Orlando design-partner beta by December 20, 2026.
3. Launch and validate the Orlando production pilot by February 28, 2027.
4. Prove a repeatable Florida city-launch playbook by May 31, 2027.
5. Build an exit-ready, defensible marketplace and operating platform while preserving a path to national category leadership.

### Labels

- App: `customer`, `business`, `admin`, `platform`
- Domain: `auth`, `discovery`, `commerce`, `payments`, `guestlist`, `admission`, `affiliates`, `analytics`, `crm`, `growth`, `operations`, `security`
- Type: `feature`, `infrastructure`, `research`, `compliance`
- Region: `orlando`, `florida`, `southeast`, `texas`, `national`

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

## Sprint 1 — Sep 28–Oct 11, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| CUST-01 | 5 | P0 | As a visitor, I can view an indexable event page with location privacy, schedule, organizer, offerings, and availability. | Responsive page handles public/attendee-only/private location rules, loading/empty/error states, metadata, and analytics. |
| CUST-02 | 8 | P0 | As a customer, I can select multiple ticket/package quantities and review a correct cart before paying. | Price/fee breakdown, limits, availability refresh, validation, mobile UX, and no client-authoritative totals. |
| CUST-03 | 5 | P0 | As a customer, I can create, verify, recover, sign in, and sign out of my account securely. | Customer-only signup, verification, reset, session rotation/revocation, enumeration resistance, and tests. |
| PAY-02 | 8 | P0 | As a customer, I can complete a sandbox payment exactly once despite retries. | Hosted/secure payment UI, server-side totals, idempotent order/payment creation, webhook verification, and failure recovery. |
| BIZ-01 | 5 | P0 | As an organizer, I can create an organization or continue as an independent creator. | Validated onboarding, owner membership, generic category/location, audit trail, and permission tests. |
| BIZ-02 | 8 | P0 | As an authorized creator, I can draft, edit, preview, publish, unpublish, and cancel an event. | Lifecycle rules, required fields, timezone handling, location privacy, audit history, and concurrency protection. |
| BIZ-03 | 8 | P0 | As an organizer, I can configure multiple ticket/package tiers without needing Gold. | Quantities, price, entries/unit, sales window, limits, visibility/password, approval setting, and inventory tests. |

## Sprint 2 — Oct 12–25, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| CUST-04 | 5 | P0 | As a buyer, I can view order history and retrieve durable QR credentials. | Only authorized users can access orders; QR is securely delivered/reissued and refunded/transferred states are clear. |
| CUST-05 | 5 | P0 | As a customer, I can request direct or promoter guestlist access and track pending/approved/rejected status. | Capacity source is explicit; duplicate requests and authorization are handled; credential exists only after approval. |
| BIZ-04 | 5 | P0 | As authorized staff or a promoter, I can review only guestlist requests within my scope. | Venue and promoter pools remain independent; decisions are transactional, audited, capacity-safe, and notify the customer. |
| BIZ-05 | 8 | P0 | As door staff, I can scan or manually find admissions quickly and understand every rejection state. | Online QR p95 target, duplicate prevention, search fallback, permission checks, audit trail, and entry/exit model. |
| BIZ-06 | 5 | P1 | As an owner, I can invite employees/hosts and assign least-privilege event responsibilities. | Invitation expiry, role scopes, removal, event assignment, audit entries, and privilege-escalation tests. |
| ADMIN-01 | 5 | P0 | As an internal operator, I can sign in with scoped staff permissions. | Admin is not a client-selected role; MFA/provider plan, session controls, RBAC matrix, audit trail, and tests. |
| ADMIN-02 | 5 | P0 | As support staff, I can search users, organizations, events, orders, tickets, and guestlists without unrestricted data access. | Fast filters, masked sensitive fields, permission scopes, deep links, and access auditing. |

## Sprint 3 — Oct 26–Nov 8, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| PAY-03 | 8 | P0 | As finance/support, I can refund an eligible order and reconcile payment, ticket, fee, and inventory state. | Full/partial policy, idempotency, webhook races, revoked credentials, immutable ledger/audit, and tests. |
| PAY-04 | 8 | P0 | As an organizer/affiliate, I can see pending/available/paid balances backed by reconciled transactions. | Split rules, commission precedence, negative adjustments, payout eligibility, provider state, and export are defined. |
| BIZ-07 | 5 | P0 | As an event operator, I can monitor sales, inventory, guestlist, and check-ins during an event. | Freshness is visible; filters and totals reconcile; degraded/error states and operational alerts exist. |
| BIZ-08 | 5 | P1 | As an owner, I can invite org affiliates and select event promoters with overrides and attributable links. | Defaults/overrides never stack; links/codes, commission/allocation, disablement, and permission tests pass. |
| ADMIN-03 | 5 | P0 | As support, I can inspect payment/refund/payout timelines and safely initiate allowed remediation. | Step-up permission, reason capture, confirmation, provider reconciliation, audit, and no silent destructive action. |
| PLAT-05 | 8 | P0 | As the launch team, we need end-to-end alpha acceptance coverage and observability. | Automated happy/failure/concurrency tests cover discovery-to-entry; traces/logs/metrics correlate order, payment, and credential. |

## Sprint 4 — Nov 9–22, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| BIZ-09 | 5 | P0 | As a design partner, I can complete guided onboarding and publish a real event safely. | Checklist, sandbox/live separation, payout setup, support contact, sample removal, and activation telemetry. |
| COMMS-01 | 5 | P0 | As a customer, I receive verified transactional email/SMS for account, order, guestlist, transfer, refund, and event changes. | Consent/transactional classification, templates, retries, delivery events, suppression, and no secrets/QR leakage. |
| PAY-05 | 8 | P0 | As an organization, I can use Free or subscribe to Gold with correct billing and entitlements. | $199/month Gold, Free/Gold fee rules, lifecycle, failed renewal, cancellation, invoices, and server-side enforcement. |
| GROWTH-01 | 5 | P1 | As an organizer, I can purchase a boost on either tier with configurable future Gold discounts. | Inventory/placement policy, billing, disclosure, start/end, reporting, refund rules, and admin control. |
| CUST-06 | 5 | P1 | As a ticket holder, I can transfer an eligible credential without creating two valid entries. | Secure acceptance, expiry/cancel, ownership history, QR rotation, notifications, and audit. |

## Sprint 5 — Nov 23–Dec 6, 2026

| ID | Pts | Pri | User story / deliverable | Acceptance summary |
|---|---:|---:|---|---|
| BIZ-10 | 8 | P0 | As an operator, I can filter and export trustworthy sales, fees, inventory, AOV, attendance, and guestlist reports. | Totals reconcile to ledger; timezone/currency, saved filters, CSV safety, access control, and freshness are explicit. |
| BIZ-11 | 5 | P1 | As an owner, I can compare affiliate clicks, visits, requests, sales, commission, conversion, AOV, and guestlist use. | Attribution windows/model are documented; disabled promoters and adjustments remain historically accurate. |
| ADMIN-04 | 5 | P0 | As an administrator, I can review immutable audit trails for sensitive actions. | Actor, target, before/after, reason, correlation, timestamp, filtering, retention, and restricted export. |
| ADMIN-05 | 5 | P1 | As an administrator, I can moderate organizations/events and configure pricing, boosts, features, cities, and launch state. | Changes are validated, versioned, auditable, reversible where possible, and protected by scoped permissions. |
| ADMIN-06 | 5 | P1 | As leadership, I can see platform revenue, GMV, supply, demand, reliability, risk, and support health. | Metrics are defined, time/region filters work, data quality/freshness is visible, and source reports reconcile. |

## Sprint 6 — Dec 7–20, 2026

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
| REPORT-01 | P1 | As a Gold operator, I can use searchable/filterable advanced reports, cohorts, retention views, and scheduled exports. | M4 |
| CITY-01 | P0 | As the growth team, I can evaluate and launch a city using supply, demand, partner, support, legal, and unit-economics gates. | M4 |
| CITY-02 | P1 | As leadership, I can compare city cohorts and pause expansion when liquidity or economics miss thresholds. | M5 |
| API-01 | P2 | As an approved partner, I can use versioned APIs/webhooks with scoped credentials, limits, replay, and documentation. | M5 |
| SCALE-01 | P1 | As engineering, we can scale multi-city reporting with queues, caching, location indexes, and read models. | M5 |
| SCALE-02 | P2 | As the company, we can validate a second event vertical without adding nightlife-specific core schema. | M6 |
| EXIT-01 | P1 | As leadership, we can complete an acquisition/financing readiness review with clean metrics, contracts, IP, security, and financial controls. | M6 |

## Backlog rules

- The durable product decision belongs in repository documentation; the Linear issue links to it.
- Each issue receives one application label, relevant domain/region labels, a milestone, a cycle when scheduled, an owner before work starts, and testable acceptance criteria.
- An issue moves to Done only under the repository definition of done in `TODO.md`.
- Valuation stages in the roadmap are strategic evidence gates and must never be converted into guaranteed forecasts.
