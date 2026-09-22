# Nitewide

Nitewide is a web-first event discovery, commerce, guestlist, promoter, admission, and business-operations platform. The launch brand is nightlife-focused; the core model supports concerts, festivals, private events, conferences, hospitality, and other event verticals without special-case tables.

This repository contains:

- `apps/api` — Express, Sequelize, PostgreSQL, and PostGIS REST API
- `apps/customer` — Nitewide discovery and customer web app
- `apps/business` — Nitewide Business event operations and analytics
- `apps/admin` — Nitewide Admin internal operations
- `docs/IMPLEMENTATION_PLAN.md` — architectural decisions and milestones
- `TODO.md` — completed, current, next, and later work
- `docs/PRODUCT_ROADMAP.md` — dated sprints, milestones, regions, quality targets, and scale gates
- `docs/LINEAR_BACKLOG.md` — Linear goals, labels, cycles, and initial user-story backlog
- `docs/TOP_25_NIGHTLIFE_METROS.md` — ranked U.S. nightlife metro targets, rollout interpretation, and market-launch scorecard
- `docs/PAYMENT_PROVIDER_EVALUATION.md` — Stripe MVP decision and post-launch Stax/PayPal evaluation framework
- `docs/STAX_SALES_CALL_BRIEF.txt` — call-ready Stax sales briefing, Florida volume projections, negotiation requirements, and compliance questions

## Requirements

- Node.js 20 or newer (Node 24 is also supported)
- npm 10 or newer
- Docker, or a PostgreSQL 15+ database with PostGIS and `pgcrypto`

The Docker database is exposed on local port `5433` so it can run alongside a Homebrew or system PostgreSQL server using the standard `5432` port.

## Exact local setup

From the repository root:

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run dev
```

Open:

- Customer: <http://localhost:5173>
- Business: <http://localhost:5174>
- Admin: <http://localhost:5175>
- API health: <http://localhost:4000/health>

The seed command is intentionally destructive to local data: it truncates platform tables and creates a coherent sample marketplace. It refuses to run in production unless explicitly invoked with `--allow-production` from the API workspace.

For a **non-destructive** demo refresh, run `npm run db:seed:sales`. This repeatable local-only command adds up to four weeks of Friday/Saturday/Sunday venue history, varied paid orders across GA and all three bottle packages, and a stable varied team for each venue: 1–3 managers plus the owner, 9–12 employees, and two promoters. Those counts are demo fixtures, not product limits. Two of each six demo orders are direct purchases with no promoter or employee attribution. It preserves existing accounts, edits, and sales, and fills the 30-day analytics and event → paid-customer drill-downs.

For a **non-destructive guestlist refresh**, run `npm run db:seed:guestlists`. It adds guestlist-only demo customers (with no purchases) and pending, approved, declined, and cancelled requests to every future published demo-venue event. Referrals come from actual demo owners, managers, employees, and promoters, weighted toward employees and promoters. The two most recent completed events per venue also get checked-in and no-show guests with no purchases. Future events never receive checked-in or no-show statuses. The command preserves existing requests and is safe to rerun; the baseline seed includes the same fixtures.

For a **non-destructive Orlando event refresh**, use `npm run db:seed:posh -- --dry-run`, then `npm run db:seed:posh -- --apply`. The reviewed September 21–October 20, 2026 snapshot adds 23 Posh-sourced demo events and 11 flyers across Euphoria, Eden, La Rosa and OHM (formerly Tier). Dates expire instead of rolling forward. Existing accounts, events, sales and guestlists are preserved. The baseline seed also includes eligible snapshot events; an uncached import needs internet access. See [sources, matching decisions, demo pricing, image permissions, and exact import/test steps](docs/POSH_DEMO_DATA.md).

The sample marketplace includes 12 Orlando venues with events on the next Friday, Saturday, and Sunday plus the previous four weeks of weekend events. Every event has $10 general-admission presales plus $300 regular-bottle, $400 premium-bottle, and $1,000 Clase Azul/1942 packages. Friday events demonstrate a 50-person direct venue list plus two independent 20-person promoter lists, for 90 possible guestlist admissions. Venue owners, managers, employees, promoters, attributed sales, guestlist requests and approvals, payments, and admission credentials provide useful customer, business, and admin data. Team members appear in Overview and Analytics even with zero personal referral sales; venue-wide sales are not attributed to them automatically. Customer discovery defaults to the visitor's current city (with browser consent and an IP/event-city fallback) and their current local calendar date.

## Database commands

```bash
# Apply pending migrations
npm run db:migrate

# Undo the most recent migration
npm run db:migrate:undo --workspace @nitewide/api

# Replace local data with realistic, linked sample data
npm run db:seed

# Add missing historical/direct demo sales without clearing local data
npm run db:seed:sales

# Add missing demo guestlist requests without clearing local data
npm run db:seed:guestlists
```

The initial migration enables PostGIS and stores a `geography(Point, 4326)` alongside normalized address fields. Exact addresses and coordinates are removed from public API responses when a location is `attendees_only` or `private`.

## Run and test commands

```bash
# Everything
npm run dev

# One application
npm run dev:api
npm run dev:customer
npm run dev:business
npm run dev:admin

# Automated API and domain tests
npm test

# Production builds of all web apps
npm run build

# Recalculate the conservative Florida operating model
npm run model:florida
```

The API development process uses a normal Node process for compatibility with macOS file-watch limits. Restart `npm run dev` after changing API code; the Vite web apps still refresh automatically.

The assumptions, outputs, valuation sensitivities, and evidence gates behind the Florida model are documented in [docs/FLORIDA_50M_MODEL.md](docs/FLORIDA_50M_MODEL.md).

Tests use Node's test runner and exercise the REST boundary, pricing rules, promoter attribution precedence, transactional checkout behavior, inventory oversell rejection, business reporting, event edit protections, and frontend helpers. Fast tests inject repositories. An optional real-PostgreSQL HTTP workflow runs with `RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js`; it creates and cleans only its isolated fixtures, without reseeding your data. To verify all seeded teams and their Overview/Analytics figures against the local database without writing to it, run `RUN_DB_TESTS=1 node --test apps/api/test/seed-team-integration.test.js` after the demo seed.

## Demo users and authentication

The seed creates working demo credentials for every current application persona. All demo accounts use the password `NitewideDemo!2026`.

| App | Persona and capabilities | Email |
|---|---|---|
| Nitewide Admin | Internal administrator | `admin@nitewide.test` |
| Nitewide Business | Organization owner across the sample venues | `maya.owner@nitewide.test` |
| Nitewide Business | Euphoria venue manager and event creator | `sam.rivera.manager@nitewide.test` |
| Nitewide Business | Euphoria employee/host (not a manager) | `tessa.ward.employee1@nitewide.test` |
| Nitewide Business / Customer | Euphoria organization and event promoter | `leo.carter.promoter1@nitewide.test` |
| Nitewide Customer | Customer, buyer, and guestlist requester | `jordan.customer.customer1@nitewide.test` |

The customer app provides working **Sign in** and **Create account** flows. Public registration always creates only a customer identity; clients cannot request owner, manager, employee, promoter, or administrator access. Because Nitewide uses one identity, an elevated demo user can still use the customer app as a customer. Owners can invite managers; owners and managers can invite employees or promoters from the Business Team page. Invitees register or sign in with the invited email and accept a seven-day link. Resend renews the link and opens a prefilled email in the operator's mail app; automatic delivery is not implemented yet.

Customer and invited-user registration accept an optional phone number. US ten-digit numbers are normalized to E.164 (`+14075550123`); international numbers need their country code. Email marketing, booking/event SMS, and marketing SMS are three independent choices. SMS consent timestamps and an initially empty phone-verification timestamp are stored on the user. Organization and event invitations can save an optional contact phone on the invitation; this inviter-supplied number is never silently copied onto an existing user account. Apply migration `202609220003-phone-and-sms-consent` before using these fields. No reseed is needed. SMS is not sent yet; the future Twilio adapter must verify the user number, honor category-specific consent and opt-outs, and provide approved sender configuration before any user texts are enabled.

Passwords are salted and hashed with scrypt. Successful authentication returns a signed 12-hour bearer session. During local development only, the existing `x-user-id` header remains available for direct API testing; production disables that shortcut. Replace the built-in authentication service with a managed identity provider, secure cookie strategy, token revocation, password recovery, email verification, and abuse controls before launch.

## Admin experience

The Admin app is a dark, responsive shadcn/ui operations console with real administrator sign-in, platform health and alert counts, and a filterable analytics explorer. Its region → organization/creator → event → customer table supports preset or custom UTC date ranges, multi-select regions/organizations, search, and CSV export; charts show sales pace, region contribution, experience mix, and ticket/package performance. Authorized admins can correct supported user, organization, and event fields; every override requires a reason and records its before/after state. Protected identifiers, credentials, payment references, financial amounts, order/payment statuses, and ownership links are not editable, and an administrator cannot remove their own access. Financial corrections await a provider-reconciled workflow.

Admins can also create working demo users for every currently modeled persona: customer, internal admin, organization owner, venue manager, employee/host, organization promoter, event promoter, and independent event creator. Scoped roles require an organization or event and use the real membership and promoter-attribution tables. Open <http://127.0.0.1:5175> and use the Nitewide Admin credential above. See [Admin frontend, role fixtures, override guardrails, and tests](docs/ADMIN_FRONTEND.md).

## Customer experience

The customer app uses shadcn/ui (Radix primitives), Tailwind CSS, and Lucide icons with a responsive blue/purple/magenta nightclub palette. See [Frontend components and styling](docs/FRONTEND.md) for color tokens, component contracts, layout, interaction rules, and development guidance. Run `npm run dev:api` and `npm run dev:customer`, then open http://localhost:5173. Vite proxies `/api` to the local API; for a separately hosted API, set `VITE_API_URL` when building the customer app. Production hosting must proxy `/api` or supply that build-time URL.

- Sign in and registration use the real API and existing seeded credentials above. Sessions are checked on reload and expire automatically.
- Discovery filters live API events by city, blanket search, venue-local calendar date, experience type, and starting price. The Search field matches titles, summaries, descriptions, venues, cities/regions, categories, and offering text. Today's date remains the default. An empty date shows an explanation followed by matching events on the next seven calendar dates (selected date + 1 through + 7, inclusive), preserving all other filters. The complete card opens its event; the separate heart only saves it. Click **All upcoming** to browse without a date limit.
- Tickets and packages open an event-detail dialog with inventory-aware quantity controls. Checkout is **demo only**: it displays full payment and the customer-paid **7.5% + $0.79 per paid order** service fee. The business/organization/creator pays Stripe processing separately; no Stripe surcharge is added to the customer total. The demo stores an account-scoped preview receipt locally. It never calls the order/payment endpoint, collects a card, reduces inventory, or issues a valid admission QR. **My bookings** shows these local previews, not a server-backed ticket wallet.
- Guestlist requests are real API requests for one person and require host approval. A successful request is pending, not admission confirmation.
- Saved events live in this browser. Demo bookings are filtered to the signed-in user but are not encrypted or synchronized across devices. Use **Sign out** when switching accounts.
- The initial discovery API response is capped at 100 events. Server-side search/pagination and synchronized saved events/wallet are follow-up production milestones.
- Uploaded event artwork from Nitewide Business appears on customer cards and details, with portrait flyers shown uncropped. Events without artwork use stock Unsplash mood photography (not verified venue photography). Replace fallback imagery with approved venue/event assets before public launch.

Customer checks: `npm test --workspace @nitewide/customer`. Production build: `npm run build --workspace @nitewide/customer`. Browser verification covers sign-in, combined search filters, saved events, demo checkout/receipt, and desktop/mobile layouts. Component setup follows the [shadcn Vite integration](https://ui.shadcn.com/docs/installation/vite); installed component source is in `apps/customer/src/components/ui`.

## Business experience

The redesigned **Events** workspace includes upcoming/live, past and draft views, full-event sales, ticket/package breakdowns, team/promoter performance, and attendee spending dialogs. Venue addresses come from the selected authorized organization; independent creators can enter their own location. Admission tiers support date windows and automatic release after cheaper tiers sell out. Owners/managers/independent creators can set each event referrer's commission from 0–40% without changing earlier sales. Past events are read-only. See [Event operations, permissions, release rules, API and tests](docs/EVENT_OPERATIONS.md). Run `npm run db:migrate` and restart the API for the additive event-workspace migration; no reseed is needed.

In an event's **Team** tab, **Add promoter** creates an event-only invitation with a 0–40% commission offer. Accepted promoters see their own performance, sales and referred guestlists without joining the venue. Invitations currently use copied private links or your email app, not automatic email delivery. Apply all migrations (including `202609220002-event-invitations`) and restart the API; no reseed is required.

The public [Nitewide Business splash page](http://127.0.0.1:5174/) introduces the product, sourced competitor positioning, planned pricing, and the roadmap. **For business** beside customer sign-in links here; its sign-in buttons open `/sign-in`, then authenticated sessions enter `/app`. See [splash-page components and deployment](docs/BUSINESS_LANDING.md). Set `VITE_BUSINESS_URL` in the Customer build and `VITE_CUSTOMER_URL` in the Business build for deployed cross-app navigation.

The business app is a dark, responsive shadcn/ui workspace with real sign-in, organization/period filters, sales charts by event and ticket/package, team/promoter performance, and CSV export. It includes role-enforced event creation/editing, draft/publication controls, location privacy, flexible ticket/package/reservation tiers, inventory and sales-window controls, plus guestlist approval and independent venue/promoter limits.

Run `npm run dev:api` and `npm run dev:business`, then open <http://127.0.0.1:5174>. Use the owner, manager, or promoter credentials above. Customer identities may create independent events but cannot manage venue events without permission. The Analytics page provides preset/custom dates, multi-select regions/organizations, search, charts, and region → venue/creator → event drill-downs. Its Team & referrals tab drills from team members and promoters into their referred customers and sales. Reports use actual paid USD order data; they are not bank balances or settled payouts. All Free/Premium workspaces currently have basic report access; advanced paid entitlement enforcement remains a roadmap item.

See [Business frontend, roles, reporting, tests, and styling](docs/BUSINESS_FRONTEND.md) for the complete component map, design tokens, permission matrix, transaction protections, reporting definitions, setup, test commands, and launch limitations. Run `npm run db:migrate` for the additive event-image migration; do not reseed existing data. Flyers upload in the event editor (JPG/PNG/WebP, ≤10 MB), persist in git-ignored `apps/api/uploads/events`, and are public artwork URLs. Back up this directory with your database; use S3/CDN storage before multi-instance production deployment.

## Core API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Database-aware service health |
| `POST` | `/api/auth/register` | Register a customer identity and receive a session |
| `POST` | `/api/auth/sign-in` | Sign in with email and password |
| `GET` | `/api/auth/me` | Resolve the current bearer session and capabilities |
| `GET` | `/api/business/workspace` | Role-scoped events and sales by event, tier, team member/promoter; `days` and `organizationId` filters |
| `GET` | `/api/admin/workspace` | Admin-only platform records, operational counts, alerts, and period sales aggregates |
| `POST` | `/api/admin/demo-users` | Admin-only creation of a role-ready demo identity and scoped memberships |
| `PATCH` | `/api/admin/users/:id` | Audited admin update of supported user access/profile fields |
| `PATCH` | `/api/admin/organizations/:id` | Audited admin update of organization plan, status, and profile fields |
| `PATCH` | `/api/admin/events/:id` | Audited admin override of supported event operations fields |
| `POST` | `/api/business/events` | Atomically create event, location, and offering tiers |
| `PUT` | `/api/business/events/:eventId` | Role-enforced full event edit with optimistic version and sold-inventory protection |
| `POST` | `/api/business/uploads/image` | Authenticated multipart image upload; optimized WebP asset |
| `GET` | `/api/media/images/:assetId` | Public event artwork |
| `GET` | `/api/events` | Public discovery |
| `GET` | `/api/events/:eventId` | Public event detail and offerings |
| `POST` | `/api/organizations` | Create an organization and owner membership |
| `POST` | `/api/organizations/:id/affiliates` | Add an `OrgAffiliate` with defaults |
| `POST` | `/api/events` | Create an independent or organization event |
| `POST` | `/api/events/:id/offerings` | Create a ticket, package, or reservation tier |
| `POST` | `/api/events/:id/affiliates` | Select an `EventAffiliate` and optional overrides |
| `PATCH` | `/api/business/events/:id/guestlist-capacity` | Set the event's direct venue guestlist limit |
| `PATCH` | `/api/business/events/:id/affiliates/:affiliateId/guestlist-allocation` | Set or clear one promoter's event-specific guestlist limit |
| `GET` | `/api/business/events/:id/guestlist-settings` | View direct and per-promoter limits and usage |
| `POST` | `/api/events/:id/guestlist` | Submit a direct or promoter guestlist request |
| `GET` | `/api/business/events/:id/guestlist` | List all requests for owner/manager/creator/admin; only own referrals for basic employees/promoters |
| `POST` | `/api/business/events/:id/guestlist/:entryId/decision` | Approve or decline a pending request; cancel an approved, unused entry |
| `POST` | `/api/orders` | Transactional checkout and QR credential issuance |
| `GET` | `/api/orders/:id` | Customer order detail (stored QR hashes are never returned) |
| `POST` | `/api/check-ins` | Validate and consume a QR credential |
| `GET` | `/api/business/events/:id/analytics` | Event sales and attendance snapshot |
| `GET` | `/api/business/analytics` | Permission-scoped portfolio analytics and referral drill-downs |
| `GET` | `/api/admin/analytics` | Internal region-to-customer analytics explorer |
| `GET` | `/api/admin/overview` | Internal platform counts |

Example purchase using seeded data:

```bash
curl -X POST http://localhost:4000/api/orders \
  -H 'content-type: application/json' \
  -H 'x-user-id: 10000000-0000-4000-8000-000000000004' \
  -d '{
    "eventId":"40000000-0000-4000-8000-000000000001",
    "idempotencyKey":"checkout-from-readme-001",
    "affiliateCode":"LEO-AFTERGLOW",
    "items":[{"offeringId":"50000000-0000-4000-8000-000000000001","quantity":1}],
    "payment":{"provider":"development","reference":"readme-payment-001","status":"succeeded"}
  }'
```

The raw QR token is returned only at credential issuance. The database retains only its SHA-256 hash.

## Rules encoded in the model

- A user may buy, create independent events, own several organizations, and promote many organizations/events simultaneously.
- Organization ownership is many-to-many through `OrganizationOwner`; it is not a single `ownerId` shortcut.
- Every event has `creatorUserId`; `organizationId` is optional.
- `OrgAffiliate` supplies defaults. A selected `EventAffiliate` overrides non-null commission and guestlist fields. Values do not stack.
- Guestlist submissions begin as pending requests. Authorized owners, employees, organization promoters, or event promoters approve or reject them; the QR credential is issued only on approval.
- The event's `guestlistCapacity` applies only to direct venue guestlist entries. Each selected promoter has a separate `guestlistAllocation`, so promoter allocations are additional pools and neither consume nor conflict with the venue pool or another promoter's pool.
- `Offering` describes repeatable inventory, `OrderItem` records the purchase snapshot, and `Ticket` represents each admission credential.
- A package can generate several tickets through `entriesPerUnit`.
- Checkout, allocation, and check-in run in serializable transactions with locked inventory/credential rows.
- Currency uses integer cents; commissions use basis points.
- Buyers pay the same **7.5% + $0.79 service fee per paid order** for Free and Premium organizations. The **business/organization/independent creator pays Stripe processing**, not the customer and not Nitewide's platform-fee revenue. Free orders have no service fee. Free core platform use has no organizer listing or platform transaction fee; optional Premium remains $249/month with planned advanced tools and no transaction-fee discount. Advanced offering configuration is available on both tiers. Order pricing snapshots record the policy version and processing payer; old orders are not repriced. Actual Stripe fees/settlement await the live Connect integration and must use provider records, not an estimated 2.9% + $0.30 deduction. See [fee policy and examples](docs/FEE_POLICY.md).

## Production boundaries

Before launch, integrate a real authentication provider, payment processor and webhook reconciliation, refunds/chargebacks, promoter payouts, subscription billing, email/SMS delivery, observability, rate limiting, secrets management, background jobs, and a durable QR-delivery channel. Those responsibilities are kept explicit rather than represented by unsafe production stubs.
