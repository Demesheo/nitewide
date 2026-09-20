# Nitewide

Nitewide is a web-first event discovery, commerce, guestlist, affiliate, admission, and business-operations platform. The launch brand is nightlife-focused; the core model supports concerts, festivals, private events, conferences, hospitality, and other event verticals without special-case tables.

This repository contains:

- `apps/api` — Express, Sequelize, PostgreSQL, and PostGIS REST API
- `apps/customer` — Nitewide discovery and customer web app
- `apps/business` — Nitewide Business event operations and analytics
- `apps/admin` — Nitewide Admin internal operations
- `docs/IMPLEMENTATION_PLAN.md` — architectural decisions and milestones

## Requirements

- Node.js 20 or newer (Node 24 is also supported)
- npm 10 or newer
- Docker, or a PostgreSQL 15+ database with PostGIS and `pgcrypto`

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
```

Tests use Node's test runner and exercise the REST boundary, pricing rules, affiliate precedence, transactional checkout behavior, and inventory oversell rejection. A real Postgres instance is used for migrations and local execution; tests deliberately inject repositories at the service boundary so they stay fast and deterministic.

## Development identity boundary

Authentication is deliberately an integration boundary in this milestone. Protected routes require an `x-user-id` header; the seed logs the available IDs and uses these stable examples:

| Persona | User ID |
|---|---|
| Internal admin | `10000000-0000-4000-8000-000000000001` |
| Organization owner | `10000000-0000-4000-8000-000000000002` |
| Org + event affiliate | `10000000-0000-4000-8000-000000000003` |
| Customer | `10000000-0000-4000-8000-000000000004` |
| Independent creator | `10000000-0000-4000-8000-000000000005` |

Replace this boundary with a production identity provider before exposing the API publicly. Do not trust arbitrary user IDs from clients in production.

## Core API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Database-aware service health |
| `GET` | `/api/events` | Public discovery |
| `GET` | `/api/events/:eventId` | Public event detail and offerings |
| `POST` | `/api/organizations` | Create an organization and owner membership |
| `POST` | `/api/organizations/:id/affiliates` | Add an `OrgAffiliate` with defaults |
| `POST` | `/api/events` | Create an independent or organization event |
| `POST` | `/api/events/:id/offerings` | Create a ticket, package, or reservation tier |
| `POST` | `/api/events/:id/affiliates` | Select an `EventAffiliate` and optional overrides |
| `POST` | `/api/events/:id/guestlist` | Join direct or affiliate guestlist |
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
- Event guestlist capacity covers both direct and affiliate entries. Affiliate allocation is also enforced when attribution is used.
- `Offering` describes repeatable inventory, `OrderItem` records the purchase snapshot, and `Ticket` represents each admission credential.
- A package can generate several tickets through `entriesPerUnit`.
- Checkout, allocation, and check-in run in serializable transactions with locked inventory/credential rows.
- Currency uses integer cents; commissions use basis points.
- Free pricing is 7% + $0.65 per paid order. Gold is $199/month + 5% + $0.50 per paid order. Advanced offering configuration is available to both tiers.

## Production boundaries

Before launch, integrate a real authentication provider, payment processor and webhook reconciliation, refunds/chargebacks, affiliate payouts, subscription billing, email/SMS delivery, observability, rate limiting, secrets management, background jobs, and a durable QR-delivery channel. Those responsibilities are kept explicit rather than represented by unsafe production stubs.

