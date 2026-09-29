# Nitewide Admin frontend

The Management page provides versioned granular editing, scoped role changes, and suspend/archive/restore controls. Permanent admin deletion is disabled; purchases, admissions, and audit history remain intact. See [Internal admin management](ADMIN_MANAGEMENT.md) for resource capabilities and API details.

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
- Server-searchable users, organizations, events, orders/payments, and audit history in Management, with authoritative counts, allowlisted sorting/status filters, and 25-row pages. Overview and analytics CSV exports remain available; Management record lists do not yet export the entire filtered result. Analytics tables page at 10 rows by default with 25/50 options.
- Audited overrides for reasonable operational fields: user access/display data, organization plan/status/profile, and event schedule/content/status/capacity/discoverability.
- Guided onboarding for a multi-venue organization, a single-venue business, or an independent event creator. The recipient confirms their email and sets their own password; an existing account signs in before accepting scoped access. Setup links are never returned to administrators.
- Strict, versioned editing of users, organizations, events, locations, and organization/event role assignments; archived records remain inspectable by internal admins.
- Creation of real demo identities for customer, internal administrator, organization owner, venue manager, employee/host, organization promoter, event promoter, and independent event creator workflows.

Demo role assignments are implemented through the platform's actual data model. Owners and managers receive `OrganizationOwner` membership, employees receive separate `OrganizationEmployee` membership, promoters receive `OrgAffiliate` or `EventAffiliate`, and an event creator receives a private independent draft fixture. Organization/event roles require selecting their scope. Demo passwords are salted with scrypt and never returned by the API. The demo-user endpoint is disabled in production.

## Guardrails

Admin pages are not a substitute for a payments provider dashboard. Admins cannot edit credential secrets, QR hashes, provider references, payment status, or financial amounts. A changed user email is unverified, invalidates active credentials/tokens, and queues a verification message only when email delivery is configured. Event capacity cannot fall below ticket and approved guestlist admissions. Every supported change requires a reason and audit entry; high-risk edits require the current version. An administrator cannot remove their own admin access, the last active administrator, or the last active owner of an active organization. Suspension/archive blocks new activity at the server; restore does not republish cancelled events or issue refunds.

Admin schedule overrides show UTC explicitly. The Business editor remains the venue-time-zone-aware flow for routine scheduling. The legacy Overview snapshot still includes at most 100 recent rows per resource, but the focused Management and Operations lists search and paginate against the full authorized server-side dataset. Analytics drilldowns still need their own scale migration.

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

The default `npm test` includes isolated migrated PostgreSQL integration suites and mocked email checks. See [Testing](TESTING.md); no live provider messages are sent.
