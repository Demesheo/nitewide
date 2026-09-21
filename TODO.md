# Nitewide TODO

This is the repository-level source of truth for near-term work. Product scope, dated sprints, launch regions, scale gates, and the Linear issue map live in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) and [docs/LINEAR_BACKLOG.md](docs/LINEAR_BACKLOG.md).

## Completed foundation

- [x] Establish the Nitewide brand with a generic, multi-vertical event domain.
- [x] Create the Express/Sequelize/PostgreSQL/PostGIS API and three web apps.
- [x] Model multi-capability users, organization ownership, employees, `OrgAffiliate`, and `EventAffiliate` relationships.
- [x] Model reusable offerings, orders, order items, payments, admission credentials, attribution, check-ins, boosts, and audit logs.
- [x] Add transactional inventory, pricing rules, affiliate precedence, QR issuance/check-in, and API tests.
- [x] Add pending guestlist requests with staff/promoter approval and independent venue/promoter capacity pools.
- [x] Seed 12 Orlando venues, Friday/Saturday/Sunday events, $10 GA, three bottle packages, staff, promoters, sales, and guestlist activity.
- [x] Add customer registration/sign-in and demo users for customer, promoter, manager, owner, and admin personas.
- [x] Default customer discovery to the visitor's current city and current day.

## Now — Sprint 0 and Sprint 1

- [x] Import the approved roadmap and 102 user stories into Linear and connect the GitHub repository.
- [ ] Add CI for lint, tests, builds, migration validation, and dependency/security checks.
- [ ] Add production authentication requirements: secure sessions, email verification, password reset, logout/revocation, throttling, and abuse controls.
- [ ] Complete customer event detail, offering selection, cart, and checkout UI.
- [ ] Select and implement the payment-provider foundation, idempotent webhooks, and reconciliation ledger.
- [ ] Add organization onboarding and event/offering CRUD to Nitewide Business.
- [ ] Add admin RBAC and operational user/organization/event lookup.
- [ ] Define product analytics events, consent rules, SLOs, and launch dashboards.

## Next — Alpha and Florida beta

- [ ] Complete customer orders, QR wallet, guestlist request/status, and ticket transfer.
- [ ] Complete business guestlist review, promoter management, QR scanning, door sales, and live event operations.
- [ ] Add refunds, chargebacks, payouts, platform fees, Gold subscription billing, and boost billing.
- [ ] Add transactional email/SMS delivery and durable QR delivery.
- [ ] Add attendee event reminders, guestlist decision messages, actionable approval-queue alerts, and low-inventory/sold-out notifications across email, SMS, and in-app channels.
- [ ] Add consent-based email/SMS marketing, customer preferences, suppression/unsubscribe handling, segmentation, attribution, and frequency caps.
- [ ] Add business sales, attendance, affiliate, and inventory dashboards with filters and CSV export.
- [ ] Add admin transaction oversight, support tooling, audit explorer, moderation, and pricing configuration.
- [ ] Add observability, alerts, backups, disaster-recovery drills, rate limits, secrets management, and background jobs.
- [ ] Meet accessibility and public performance budgets; run load, security, and recovery tests.
- [ ] Recruit design partners in Orlando, Miami, Fort Lauderdale, and Tampa and execute the Florida beta checklist.
- [ ] Implement Stripe Connect onboarding, reconciled balance states, risk holds/reserves, and daily payouts scheduled within 24 hours after eligible funds clear.
- [ ] Approve a Stripe Connect charge-model and negative-balance-liability ADR targeting connected-seller direct charges, Stripe-owned loss liability, and automatic venue-bank deficit recovery; prohibit platform-liability configurations without a separate capital/risk approval.
- [ ] Persist and monitor each connected account’s loss-liability and negative-balance-debit configuration; freeze payouts/sales and escalate when external-account recovery fails or is unavailable.
- [ ] Have counsel validate merchant-of-record and seller responsibilities, connected-merchant dispute obligations, reserve/recovery/indemnity terms, consumer support duties, and the limits of contractual risk transfer.
- [ ] Complete the opaque signed-QR payment-to-admission evidence chain, mandatory scan policy, offline/manual reconciliation, and append-only check-in audit records.
- [ ] Automate reason-specific Stripe dispute evidence packets and a connected-merchant dispute inbox with deadlines, scoped human review, submission auditing, outcomes, and dispute-control metrics.
- [ ] Implement idempotent asynchronous dispute webhooks, reversible customer risk restrictions with notice/appeal, secure venue tasks using Stripe `due_by`, privacy-safe evidence review, reminder/escalation, and restriction/fund reconciliation on dispute closure.
- [ ] Adopt a privacy-minimizing door identity policy: do not retain full ID images by default; require counsel-approved necessity, consent, encryption, access, retention/deletion, and incident controls for any exception.
- [ ] Engage qualified legal/tax/accounting specialists; form the advised entity, obtain an EIN, evaluate an S-corporation election, open business banking, and establish books.
- [ ] Map Stripe principal, application-fee, subscription, refund, dispute, reserve, affiliate, tax, and merchant-deficit activity into a reconciled subledger and CPA-approved general ledger/revenue-recognition policy.
- [ ] Produce merchant-recovery aging, expected-loss/write-off controls, and diligence schedules instead of assuming external bank debit creates zero A/R exposure.
- [ ] Run a supervised founder-to-operator transition drill covering access, deploy/rollback, restore, payments, disputes, support, vendors, incidents, and signing-key recovery.
- [ ] Complete customer terms/privacy/refund policies plus organizer, affiliate, payment, and data-processing agreements before public launch.

## Later — Expansion and platform depth

- [ ] Add consent-aware CRM, segmentation, email/SMS campaigns, and automated outreach.
- [ ] Add reservations, tables, deposits, floor plans, minimum-spend packages, and host assignment.
- [ ] Add follows, reminders, recommendations, social sharing, calendar, and wallet integrations.
- [ ] Add advanced reporting/read models, cohort and retention analysis, scheduled reports, and data exports.
- [ ] Add configurable Gold boost discounts, promotion controls, and experimentation tooling.
- [ ] Launch Orlando, Miami, Fort Lauderdale, and Tampa, then move directly to evidence-ranked national market waves when launch gates are met.
- [ ] Validate non-nightlife verticals without introducing vertical-specific core tables.
- [ ] Evaluate white-label, secondary-ticketing, enterprise, and international capabilities only after core marketplace fit.

## Definition of done

An item is done only when its acceptance criteria pass, permissions and audit behavior are covered, automated tests are added at the appropriate layer, documentation is current, telemetry is present for production paths, and the change is deployed or explicitly marked as code-complete awaiting release.
