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

Startup takes a database advisory lock, runs versioned migrations, and normally
seeds only an empty database named exactly `nitewide_demo`. A durable bootstrap
marker stops destructive automatic retries after incomplete initial seeding.
Ordinary restarts preserve records and do not reseed. No local DB snapshot is
uploaded. Initialization can take several minutes while sample customers/sales
are created and reviewed flyer assets download.

### Deliberate demo-data reseed

Only when all hosted records are disposable and a reseed is explicitly approved,
set the Render web service environment variable `DEMO_RESEED_GENERATION` to a new
lowercase, hyphenated identifier (for example `2026-09-24-verified-orlando-v2`)
and deploy the latest image. Startup verifies hosted-demo mode and the exact
`nitewide_demo` database name, applies pending migrations, then replaces the
demo records. A durable generation marker prevents later restarts from reseeding
again. Changing the value to another new identifier authorizes another full
replacement. The free database has no backups; this removes visitor-created
accounts, orders, guestlists, and edits. During the several-minute seed, the
public demo may temporarily show incomplete data. Wait for the Render deployment
to become Live, then check `/health`, the public event API, and both app UIs.

The September 24 seed update adopts the reviewed Rew1nd Saturdays and OHM Friday/
Sunday listings into their booked generic demo events while preserving orders,
tickets, referrals, guestlists, and event identities. Import overlap checks are
scoped to the same organization and physical venue so an unrelated venue sharing
an address cannot suppress a reviewed listing.

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

## Manual build and deploy

### From GitHub (no local tools)

1. Commit and push the intended changes to `main`. A push already starts a build;
   do not also dispatch another run unless you deliberately want a rebuild.
2. To rebuild existing `main`, open [Actions → Demo image](https://github.com/Demesheo/nitewide/actions/workflows/demo-image.yml),
   choose **Run workflow**, select **main**, then start the run.
3. Wait for **verify**, **publish**, and **deploy** to succeed. Verification includes
   unit tests, database migrations/integration tests, app builds, and Docker build.
4. Open [the Render service](https://dashboard.render.com/web/srv-daq3nmo473hc73cgqgk0)
   in **My Workspace** and wait for its newest deployment to show **Live**.
5. Check `/health` and the browser smoke checks below. GitHub's deploy job confirms
   the request was accepted, not that Render has finished or is healthy.

Only `main` publishes/deploys. Pull requests and manual runs on other branches
verify code without publishing. Runs on main are serialized rather than cancelling
an in-progress deployment. The workflow reads GitHub environment `demo` secret
`RENDER_DEMO_DEPLOY_HOOK`; if absent it publishes an image but explicitly skips
the Render request. Always check the deploy job output, not just its green icon.

### From the CLI

Requirements: Node.js 20+ and repository Actions write permission. No local Docker,
database, npm installation, or Render CLI is needed just to dispatch a build.
Use authenticated GitHub CLI (`gh auth login`) or a fine-grained token limited to
`Demesheo/nitewide` with **Actions: read and write**, provided securely as
`GH_TOKEN` or `GITHUB_TOKEN`. Never paste a token into the command itself or commit it.

```bash
npm run deploy:demo -- --help
npm run deploy:demo -- --dry-run
npm run deploy:demo

# Equivalent without npm
node deploy/trigger-demo.cjs

# Optional: choose the newly requested run and wait for GitHub jobs
gh run watch --repo Demesheo/nitewide
```

`deploy/trigger-demo.cjs` always dispatches `demo-image.yml` on **remote main**.
It does not upload working-tree files, commit, push, reseed, or create resources.
It returns zero after dispatch acceptance, not deployment completion. On a timeout,
check Actions before retrying because the request may already have been accepted.
It never prints authentication values or provider error bodies.

### From a disposable container

The public demo image includes the same dependency-free script. After securely
setting `GH_TOKEN` in your local shell or secret manager, use:

```bash
docker run --rm --platform linux/amd64 --entrypoint node \
  -e GH_TOKEN ghcr.io/demesheo/nitewide-demo:demo \
  /app/deploy/trigger-demo.cjs
```

For a no-auth preview, omit `-e GH_TOKEN` and append `--dry-run`. Use a current image
that includes the script (`docker pull ghcr.io/demesheo/nitewide-demo:demo` if needed).
The token is passed to this short-lived container only; a trusted Docker host is
required because host administrators can inspect container environments. Prefer
the CLI on your own machine. **Do not store a GitHub token or the Render hook in
the long-running public demo service**, image layers, source, or browser frontend.
The dispatch command is not an application endpoint and is not exposed to visitors.

### Redeploy an existing image directly in Render

This is a redeploy, not a GitHub build. If code changed, run the GitHub workflow first.

1. Open the existing `nitewide-demo` service in My Workspace.
2. Confirm its assigned image reference in Settings. The Blueprint default is
   `ghcr.io/demesheo/nitewide-demo:demo`; **Manual Deploy → Deploy latest reference**
   pulls the current image for that reference. A pinned digest stays on that digest.
3. For a specific release or rollback, choose a retained successful image digest
   from GHCR/Render deployment history and explicitly deploy that reference.
   Do not assume a previous deploy-hook override changed the default image setting.
4. Wait for **Live**, check health, and verify login, bookings, and business reports.

The normal GitHub pipeline pins each deployment by digest. Merely moving the GHCR
`:demo` tag does not automatically cause an image-backed Render service to redeploy.
Keep the deploy hook secret in GitHub's `demo` environment. If rotating it, update
that environment secret before the next deployment; never put the URL in docs.

### Verification and recovery

```bash
curl --fail --show-error https://nitewide-demo.onrender.com/health
```

Expected: HTTP 200 with `{"status":"ok","service":"nitewide-api"}`. Test customer
`/`, business `/app`, and admin `/admin` in a browser. There is no shared password
gateway or injected floating banner; normal account permissions remain enforced.
The mock checkout and QR demo safeguards remain in place.

- **Build fails:** inspect the first failed GitHub step; fix it and push. Render
  keeps the previous healthy release when no new image is deployed.
- **Deploy job green but no Render deployment:** check the missing-hook message and
  configure the environment secret. A failed hook request fails the deploy job.
- **Render startup fails:** inspect Render logs, required environment settings,
  database availability, and migration errors. Never reseed as a troubleshooting shortcut.
- **Need rollback:** redeploy a retained previous digest. Database migrations and
  visitor changes are not reverted by an image rollback; inspect migration compatibility.
- **Demo sleeps or DB expires:** free-tier limitations apply. The current temporary
  database expires October 23, 2026; preserve needed data before then. A rebuild
  does not extend database lifetime or recover expired data.

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
[GitHub image publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
[manual GitHub workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
