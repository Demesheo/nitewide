# Nitewide Admin frontend

Nitewide Admin is the internal operations console at `http://127.0.0.1:5175`. It is intentionally separate from the Customer and Business applications and every API operation independently requires an authenticated `isInternalAdmin` user.

## Local access

Run the database, API, and Admin app:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:admin
```

Sign in with `admin@nitewide.test` and `NitewideDemo!2026`. The UI stores the 12-hour development bearer session in session storage, verifies it on reload, and removes it on sign-out or an unauthorized response. The development `x-user-id` shortcut is not used by this app.

## Current capabilities

- Overview of paid volume, platform fees, organizations, published events, failed payments, pending guestlists, check-ins, and operational alerts.
- Analytics explorer with 7-, 30-, 90-, and 365-day presets or an inclusive custom start/end date (up to 366 days), multi-select region and organization filters, blanket search, CSV export, and region → organization/independent creator → event → customer drill-down.
- Paid-sales pace, top-region, experience-category, and ticket/package visualizations. Drill rows show event count, paid checkouts, face-value sales, unique customers, units, admissions, and average order.
- Searchable users, organizations, events, orders/payments, and audit history; the loaded view can be exported as CSV. Table headers sort, and all data tables page at 10 rows by default with 25/50 options. Management tables start A–Z; sales tables start highest sales first.
- Audited overrides for reasonable operational fields: user access/display data, organization plan/status/profile, and event schedule/content/status/capacity/discoverability.
- Creation of real demo identities for customer, internal administrator, organization owner, venue manager, employee/host, organization promoter, event promoter, and independent event creator workflows.

Demo role assignments are implemented through the platform's actual data model. Owners and managers receive `OrganizationOwner` membership, employees receive separate `OrganizationEmployee` membership, promoters receive `OrgAffiliate` or `EventAffiliate`, and an event creator receives a private independent draft fixture. Organization/event roles require selecting their scope. Demo passwords are salted with scrypt and never returned by the API. The demo-user endpoint is disabled in production.

## Guardrails

Admin pages are not a substitute for a payments provider dashboard. The UI does not permit edits to primary IDs, email identities, ownership links, slugs, credential secrets, QR hashes, order/payment status, payment provider references, or financial amounts. Financial status changes require a later provider-reconciled workflow so an admin cannot fabricate a paid/refunded order or leave ticket inventory inconsistent. Event capacity cannot be reduced below issued tickets, and the direct venue guestlist capacity cannot fall below approved guests. Every supported change requires a reason and creates an `AuditLog` record containing the actor, prior state, resulting state, entity, and timestamp. An administrator cannot remove their own admin access or the last active administrator.

Admin schedule overrides show UTC explicitly. The Business editor remains the venue-time-zone-aware flow for routine scheduling. Lists load up to 100 recent rows per resource, with search/status filtering on that loaded window; server-side pagination and cross-history search are still required for large deployments.

Analytics uses `GET /api/admin/analytics`. Dates are based on paid-order `paidAt` in UTC; the current day is included. Region means the event location's city/region/country, with an “Unspecified region” bucket. Sales are paid USD order subtotals (face value), not settlements, profit, or total customer charges. Orders count checkouts, units count offering quantities, and admissions use historical entries-per-unit snapshots—not door scans. Search selects matching events (or events with a matching customer), then aggregates their authorized paid orders; it does not filter individual matching orders. Region choices and organization choices are OR within each field and AND across fields. Customer names/emails and CSV exports are sensitive operational data. The report has explicit 5,000-event and 20,000-order limits; narrow filters when reached. Larger deployments need server-side grouped reporting and pagination.

Before production, add multi-factor authentication, short-lived secure-cookie sessions, password recovery, role-change notifications, step-up authentication for high-risk actions, pagination/server-side query search, Stripe reconciliation, dispute tooling, and a second-person approval policy for financial corrections.

## Components and styling

The Admin app uses the same shadcn/ui approach as the other Nitewide apps: local, editable primitives built from Radix UI, class-variance-authority, Tailwind CSS, and Lucide icons. Current primitives live in `apps/admin/src/components/ui` and include Button, Input, Badge, Card, Table, and Dialog. It shares the Customer and Business nightlife tokens (retro blue, deep violet, velvety burgundy, hot pink, and light magenta), with Business's dark surfaces and lavender controls in a denser operations layout. Amber and pink remain reserved for warning and risk states.

Prefer adding a shadcn primitive under `components/ui` before creating a one-off interactive control. Keep focus rings, labels, keyboard behavior, Dialog focus management, responsive tables, and reduced information density on mobile.

## Verification

```bash
npm test --workspace @nitewide/admin
node --test apps/api/test/admin-service.test.js
node --test apps/api/test/analytics-service.test.js
npm run build --workspace @nitewide/admin
```

The tests cover search helpers, formatting, reporting math, server-side authorization order, and protection against administrator self-lockout. Full API boundary tests require permission to bind an ephemeral local test port; the real-database integration suite remains opt-in.
