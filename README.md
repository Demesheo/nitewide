# Nitewide

Nitewide is a web-first event discovery, commerce, guestlist, affiliate, admission, and business-operations platform. The launch brand is nightlife-focused; the core model supports concerts, festivals, private events, conferences, hospitality, and other event verticals without special-case tables.

This repository contains:

- `apps/api` — Express, Sequelize, PostgreSQL, and PostGIS REST API
- `apps/customer` — Nitewide discovery and customer web app
- `apps/business` — Nitewide Business event operations and analytics
- `apps/admin` — Nitewide Admin internal operations
- `docs/IMPLEMENTATION_PLAN.md` — architectural decisions and milestones
- `TODO.md` — completed, current, next, and later work
- `docs/PRODUCT_ROADMAP.md` — dated sprints, milestones, regions, quality targets, and scale gates
- `docs/LINEAR_BACKLOG.md` — Linear goals, labels, cycles, and initial user-story backlog

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

The sample marketplace includes 12 Orlando venues with events on the next Friday, Saturday, and Sunday. Every event has $10 general-admission presales plus $300 regular-bottle, $400 premium-bottle, and $1,000 Clase Azul/1942 packages. Friday events demonstrate a 50-person direct venue list plus two independent 20-person promoter lists, for 90 possible guestlist admissions. Venue managers, organization affiliates, event promoters, attributed sales, guestlist requests and approvals, payments, and admission credentials provide useful customer, business, and admin data. Customer discovery defaults to the visitor's current city (with browser consent and an IP/event-city fallback) and their current local calendar date.

## Database commands

```bash
# Apply pending migrations
npm run db:migrate

# Undo the most recent migration
npm run db:migrate:undo --workspace @nitewide/api

# Replace local data with realistic, linked sample data
npm run db:seed
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

Tests use Node's test runner and exercise the REST boundary, pricing rules, affiliate precedence, transactional checkout behavior, and inventory oversell rejection. A real Postgres instance is used for migrations and local execution; tests deliberately inject repositories at the service boundary so they stay fast and deterministic.

## Demo users and authentication

The seed creates working demo credentials for every current application persona. All demo accounts use the password `NitewideDemo!2026`.

| App | Persona and capabilities | Email |
|---|---|---|
| Nitewide Admin | Internal administrator | `admin@nitewide.test` |
| Nitewide Business | Organization owner across the sample venues | `maya.owner@nitewide.test` |
| Nitewide Business | Euphoria venue manager and event creator | `sam.rivera.manager@nitewide.test` |
| Nitewide Business / Customer | Euphoria organization and event promoter | `leo.carter.promoter1@nitewide.test` |
| Nitewide Customer | Customer, buyer, and guestlist requester | `jordan.customer.customer1@nitewide.test` |

The customer app provides working **Sign in** and **Create account** flows. Public registration always creates only a customer identity; clients cannot request owner, manager, promoter, or administrator access. Because Nitewide uses one identity, an elevated demo user can still use the customer app as a customer.

Passwords are salted and hashed with scrypt. Successful authentication returns a signed 12-hour bearer session. During local development only, the existing `x-user-id` header remains available for direct API testing; production disables that shortcut. Replace the built-in authentication service with a managed identity provider, secure cookie strategy, token revocation, password recovery, email verification, and abuse controls before launch.

## Core API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Database-aware service health |
| `POST` | `/api/auth/register` | Register a customer identity and receive a session |
| `POST` | `/api/auth/sign-in` | Sign in with email and password |
| `GET` | `/api/auth/me` | Resolve the current bearer session and capabilities |
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
| `POST` | `/api/events/:id/guestlist` | Submit a direct or affiliate guestlist request |
| `GET` | `/api/business/events/:id/guestlist` | List guestlist requests for authorized staff/promoters |
| `POST` | `/api/business/events/:id/guestlist/:entryId/decision` | Approve or reject a guestlist request |
| `POST` | `/api/orders` | Transactional checkout and QR credential issuance |
| `GET` | `/api/orders/:id` | Customer order detail (stored QR hashes are never returned) |
| `POST` | `/api/check-ins` | Validate and consume a QR credential |
| `GET` | `/api/business/events/:id/analytics` | Event sales and attendance snapshot |
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

- A user may buy, create independent events, own several organizations, and affiliate with many organizations/events simultaneously.
- Organization ownership is many-to-many through `OrganizationOwner`; it is not a single `ownerId` shortcut.
- Every event has `creatorUserId`; `organizationId` is optional.
- `OrgAffiliate` supplies defaults. A selected `EventAffiliate` overrides non-null commission and guestlist fields. Values do not stack.
- Guestlist submissions begin as pending requests. Authorized owners, employees, organization affiliates, or event promoters approve or reject them; the QR credential is issued only on approval.
- The event's `guestlistCapacity` applies only to direct venue guestlist entries. Each selected promoter has a separate `guestlistAllocation`, so promoter allocations are additional pools and neither consume nor conflict with the venue pool or another promoter's pool.
- `Offering` describes repeatable inventory, `OrderItem` records the purchase snapshot, and `Ticket` represents each admission credential.
- A package can generate several tickets through `entriesPerUnit`.
- Checkout, allocation, and check-in run in serializable transactions with locked inventory/credential rows.
- Currency uses integer cents; commissions use basis points.
- Buyers pay the same 7.5% + $0.85 service fee per paid order for Free and Premium organizations. Premium is $249/month and unlocks advanced analytics and business-management capabilities without a transaction-fee discount. Advanced offering configuration remains available on both tiers.

## Production boundaries

Before launch, integrate a real authentication provider, payment processor and webhook reconciliation, refunds/chargebacks, affiliate payouts, subscription billing, email/SMS delivery, observability, rate limiting, secrets management, background jobs, and a durable QR-delivery channel. Those responsibilities are kept explicit rather than represented by unsafe production stubs.
