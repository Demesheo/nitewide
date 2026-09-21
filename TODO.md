# Nitewide TODO

This is the repository-level source of truth for near-term work. Product scope, dated sprints, launch regions, scale gates, and the Linear issue map live in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) and [docs/LINEAR_BACKLOG.md](docs/LINEAR_BACKLOG.md).

## Completed foundation

- [x] Simplify comparisons to platform rows / feature columns with checkmarks and explicit planned states. Align Customer, API, Business calculator, financial model and documentation on 7.5% + $0.79 per paid order to customers; organizer pays Stripe. Preserve historical receipts and order snapshots.

- [x] Add one compact five-platform feature matrix combining current and planned capabilities, a highlighted Nitewide row, sourced rates, and a tested Posh buyer-fee comparison. Explain the opportunity for more in-venue spending without promising sales growth.

- [x] Add a public Business splash with a dark shadcn theme, interactive sample dashboard, current/upcoming features, sourced competitor positioning, planned pricing, FAQs, and Customer → Business → sign-in navigation. Document deployment links and add route/content/navigation tests.

- [x] Establish the Nitewide brand with a generic, multi-vertical event domain.
- [x] Create the Express/Sequelize/PostgreSQL/PostGIS API and three web apps.
- [x] Model multi-capability users, organization ownership, employees, `OrgAffiliate`, and `EventAffiliate` relationships.
- [x] Model reusable offerings, orders, order items, payments, admission credentials, attribution, check-ins, boosts, and audit logs.
- [x] Add transactional inventory, pricing rules, affiliate precedence, QR issuance/check-in, and API tests.
- [x] Add pending guestlist requests with staff/promoter approval and independent venue/promoter capacity pools.
- [x] Seed 12 Orlando venues, Friday/Saturday/Sunday events, $10 GA, three bottle packages, staff, promoters, sales, and guestlist activity.
- [x] Add a non-destructive, source-attributed Posh snapshot for September 21–October 20, 2026: 23 events / 11 flyers across four existing venues, Tier → OHM mapping, fixed Eastern dates, demo-commerce labels, and tested repeatable imports. See [source coverage and refresh instructions](docs/POSH_DEMO_DATA.md).
- [x] Add customer registration/sign-in and demo users for customer, promoter, manager, owner, and admin personas.
- [x] Default customer discovery to the visitor's current city and current day.
- [x] Build dark shadcn Business sign-in, scoped sales charts, employee/affiliate attribution, filters, and CSV export (local MVP).
- [x] Add role-enforced event/tier create/edit, optimistic conflict checks, sold-inventory guards, and guestlist review/limit controls.
- [x] Add validated event artwork uploads, editor previews/replacement/removal, and uncropped customer-card/detail flyers.
- [x] Give customer cards responsive 4:5 flyer frames, unobstructed artwork, local nightclub/VIP fallbacks, and tested image-error handling.
- [x] Add six distinct Orlando venue mood images for Parlay, Eden, Shakai, Aura, La Rosa and Celine, with Instagram source notes, uploaded-flyer priority, city-safe matching and tested fallback chains.
- [x] Prioritize real Instagram venue photos (including the supplied Parlay screenshot) over generated artwork; add source credits and stretch card flyers edge-to-edge. Local demo only; source/limitations documented.
- [x] Open event dialogs at their title with scroll reset; keep all detail artwork portrait (4:5), including venue photos and fallbacks. Verify long flyers, mobile, keyboard navigation and reopening after scroll.
- [ ] Obtain venue/rightsholder clearance and higher-resolution originals for Instagram demo photos before public release; replace Celine's event still if a preferred glamour photo is supplied.
- [x] Document Business components/styles/roles and test real PostgreSQL workflows with isolated fixtures.

## Now — Sprint 0 and Sprint 1

- [x] Import the approved roadmap and 103 user stories into Linear and connect the GitHub repository.
- [ ] Synchronize the locally approved `ADS-01` and `DATA-02` stories after the Linear Agent daily limit resets.
- [ ] Add CI for lint, tests, builds, migration validation, and dependency/security checks.
- [ ] Add production authentication requirements: secure sessions, email verification, password reset, logout/revocation, throttling, and abuse controls.
- [ ] Complete customer event detail, offering selection, cart, and checkout UI.
- [x] Select Stripe Connect as the MVP processor while preserving the current 7.5% + $0.79 customer service fee and organizer-paid Stripe processing policy.
- [ ] Implement the Stripe Connect foundation, direct-charge/account-liability ADR, hosted/embedded onboarding, idempotent webhooks, and reconciliation ledger.
- [ ] Revisit the documented Stax Orlando partnership and cost-optimization proposal after launch when reconciled Stripe volume and operating data support negotiation.
- [ ] Add organization onboarding and membership administration to Nitewide Business (event/offering create/edit is implemented).
- [ ] Add admin RBAC and operational user/organization/event lookup.
- [ ] Define product analytics events, consent rules, SLOs, and launch dashboards.

## Next — Alpha and Florida beta

- [ ] Complete customer orders, QR wallet, guestlist request/status, and ticket transfer.
- [ ] Complete business guestlist review, promoter management, QR scanning, door sales, and live event operations.
- [ ] Add refunds, chargebacks, payouts, platform fees, $249 Premium subscription billing, and boost billing.
- [ ] Implement transparent buyer-funded checkout pricing and promoter reward economics: versioned 7.5% + $0.79 buyer service fee for both organization plans, configurable 10% affiliate service fee on organizer-funded rewards, gross/fee/net disclosure, multi-ticket order rules, proportional reversals, and reconciled contribution-margin reporting.
- [ ] Add transactional email/SMS delivery and durable QR delivery.
- [ ] Add attendee event reminders, guestlist decision messages, actionable approval-queue alerts, and low-inventory/sold-out notifications across email, SMS, and in-app channels.
- [ ] Add consent-based email/SMS marketing, customer preferences, suppression/unsubscribe handling, segmentation, attribution, and frequency caps.
- [ ] Extend implemented business sales/affiliate reports with attendance and inventory dashboards, paginated queries, and Premium entitlement gates.
- [ ] Move local flyer storage to S3/CloudFront, add moderation/rate limits, and age-gated orphan cleanup.
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
- [ ] Reforecast the Florida $50M evidence model monthly from reconciled actuals, keeping promoter attribution separate from the 90/10 venue-funded kickback split, tracking ticket-only non-nightclub events separately, and reporting downside/base/upside cases rather than a guaranteed valuation.
- [ ] Run a supervised founder-to-operator transition drill covering access, deploy/rollback, restore, payments, disputes, support, vendors, incidents, and signing-key recovery.
- [ ] Complete customer terms/privacy/refund policies plus organizer, affiliate, payment, and data-processing agreements before public launch.

## Later — Expansion and platform depth

- [ ] Add consent-aware CRM, segmentation, email/SMS campaigns, and automated outreach.
- [ ] Add Google AdSense-only, responsive, visibly labeled units to eligible customer discovery card slots and footer/right-rail positions on Google-evaluable Free business content pages, with no other networks/direct sponsors and with consent/RDP, GPC/GPP, density, performance, accessibility, invalid-traffic, and conversion guardrails.
- [ ] Build a counsel-approved aggregated-insights product with minimum cohorts and anti-reidentification controls; do not sell identifiable customer data, raw cookies/device IDs, precise location, contact lists, payment/admission histories, or relationship graphs.
- [ ] Add reservations, tables, deposits, floor plans, minimum-spend packages, and host assignment.
- [ ] Add follows, reminders, recommendations, social sharing, calendar, and wallet integrations.
- [ ] Add advanced reporting/read models, cohort and retention analysis, scheduled reports, and data exports.
- [ ] Add promotion controls and experimentation tooling; Premium does not receive transaction-fee or boost discounts by default.
- [ ] Launch Orlando, Miami, Fort Lauderdale, and Tampa, then move directly to evidence-ranked national market waves when launch gates are met.
- [ ] Validate non-nightlife verticals without introducing vertical-specific core tables.
- [ ] Evaluate white-label, secondary-ticketing, enterprise, and international capabilities only after core marketplace fit.

## Definition of done

An item is done only when its acceptance criteria pass, permissions and audit behavior are covered, automated tests are added at the appropriate layer, documentation is current, telemetry is present for production paths, and the change is deployed or explicitly marked as code-complete awaiting release.
