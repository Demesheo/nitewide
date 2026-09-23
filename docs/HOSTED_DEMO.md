# Shareable Render demo

Baseline: [local demo MVP checkpoint](DEMO_MVP_CHECKPOINT.md). This deployment is
isolated demo infrastructure, not a live payment launch.

Hosted URL: https://nitewide-demo.onrender.com/ (free Render service in My Workspace).
The free database created September 23 expires October 23, 2026. This demo shares
sample accounts and records with every visitor; do not use real contact, payment,
or confidential business data.

## Build and release

GitHub Actions tests the workspace and builds a Linux/AMD64 multi-stage image.
Main publishes `ghcr.io/demesheo/nitewide-demo:demo` and `:sha-<commit>`.
The public image contains application code and packaged demo fixtures, not local
`.env` files, uploaded images, database dumps, or investor documents. Runtime
secrets must exist only in Render. First-time GHCR package visibility must be set
to public to allow anonymous Render pulls.

Create a Blueprint from `render.yaml` in Render **My Workspace**. The Blueprint
creates one free web service and an isolated PostgreSQL 16/PostGIS database. It
generates a private token signing secret. Per the founder's September 23 decision,
there is no shared demo password: anyone with the URL can browse the demo and use
the documented sample accounts. Normal account login and role permissions still
protect account, business and admin operations. Pages are marked noindex; this is
not an access control. The `/health` endpoint exposes status only.

Routes on the single HTTPS origin:

| Path | App |
| --- | --- |
| `/` | Customer discovery, bookings and connections |
| `/business` | Business landing page |
| `/sign-in`, `/app` | Business sign-in and workspace |
| `/admin` | Admin app (still requires an internal-admin account) |
| `/api/*` | Shared, permission-scoped API |

Existing seed accounts use
`NitewideDemo!2026` (see README identities). Visitors share sample records; do not
enter real personal information. Hosted mode uses production authentication and
does not accept `x-user-id`. Checkout accepts mock payments only. No Stripe,
Resend, Plivo or other paid delivery credentials should be set on this service.

## Data lifecycle

Startup takes a database advisory lock, runs versioned migrations, and seeds only
an empty database named exactly `nitewide_demo`. A durable bootstrap marker stops
destructive automatic retries after incomplete seeding. Restarts preserve records
and do not reseed. No local DB snapshot is uploaded. Initialization can take several
minutes while sample customers/sales are created and reviewed flyer assets download.

Free Render web instances sleep when idle and have ephemeral filesystems. Known
seed flyers are restored from reviewed source URLs after restart; visitor-uploaded
images are temporary and can disappear after restart/redeploy. Source availability
is an external dependency. Free PostgreSQL expires after 30 days. Upgrade storage
and database durability before relying on this demo long term. No paid resources
are authorized by this configuration.

The service's deploy-hook URL is configured as GitHub environment
`demo` secret `RENDER_DEMO_DEPLOY_HOOK`. Subsequent successful main builds request
deployment of the exact image digest. Never commit or print the hook. A successful
hook request is not a healthy deployment: check Render's deploy status and `/health`.
Rollback by selecting a previously successful retained image digest in Render;
database migrations are not rolled back with the image. Do not delete a rollback
image from GHCR while it may still be needed.

## Required smoke checks

- Public pages open without a shared password; protected API calls still require account authentication.
- Customer and business sign-in work independently on one origin; no localhost links.
- Jordan can see seeded future purchases/QR credentials and complete mock checkout.
- Sam can view the matching sale/referral/commission and review guestlist requests.
- Admin requires an authorized account. `x-user-id` alone cannot impersonate users.
- Images load after restart, API missing routes return JSON 404 (not SPA HTML).
- A redeploy preserves existing users/orders and does not reseed.

References: [Render images](https://render.com/docs/deploying-an-image),
[free limits](https://render.com/docs/free), [PostGIS](https://render.com/docs/postgresql-extensions),
[GitHub image publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
