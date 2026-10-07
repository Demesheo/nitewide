# Render staging and production setup

Use paid staging as production lite: the same bundled web/API and separate
worker layout, with a smaller independent PostgreSQL database. The planning bases
are $20.30 staging and $34.50 production, totaling $54.80 before taxes and usage
additions. See [the hosting plan](LAUNCH_HOSTING_PLAN.md) for budget assumptions.
Cloudflare storage is part of setup now; production DNS cutover follows a healthy
Render deployment. This guide does not authorize cloud changes or live payments.

## Prepare the release

The existing root `render.yaml` and `deploy/start.cjs` remain demo-only. Do not
apply that Blueprint to staging or production. Regular releases use:

| Process | Command |
| --- | --- |
| API and all three frontends | `node deploy/run.cjs api` |
| Independent worker | `node deploy/run.cjs worker` |
| Configuration check without provider calls | `node deploy/run.cjs check` |
| Reviewed migrations without seeding | `node deploy/run.cjs migrate` |

Regular startup requires an explicit environment, verified database TLS, matching
database/bucket names, explicit public HTTPS app URLs and an embedded release
revision. It rejects demo mode, reseeding and shared sandbox merchant routing.
The API uses `SERVE_FRONTENDS=true`; the worker uses `false`. Each retains its
existing bounded shutdown handlers. Migration execution holds a database advisory
lock, applies the migration chain through the CLI and never seeds records.

After a separately approved commit/push, GitHub verifies the `staging` and
`production` branches using the existing unit/API, browser and image jobs. It
publishes the exact checked artifact as
`ghcr.io/demesheo/nitewide:sha-<40-character-commit>`. No additional browser lane
is introduced. `main` automatically deploys the existing demo. `staging`
automatically deploys its verified digest after the one-time setup below;
`production` publishes artifacts only and still requires manual approval.
Deployment does not enable payments.

### Automatic staging deployment

Create a GitHub Actions environment named **staging**, restricted to the
**staging branch**. Do not require a reviewer for routine staging deployments.
Keep the demo and production environments/secrets separate. In this environment
configure these values (never commit hook URLs or paste them into chat):

| Type | Name | Value |
| --- | --- | --- |
| Secret | `RENDER_STAGING_API_DEPLOY_HOOK` | Existing staging web service Settings → Deploy Hook |
| Secret | `RENDER_STAGING_WORKER_DEPLOY_HOOK` | Existing staging worker Settings → Deploy Hook |
| Variable | `STAGING_API_SERVICE_ID` | Staging web service's `srv-…` ID |
| Variable | `STAGING_WORKER_SERVICE_ID` | Staging worker's distinct `srv-…` ID |
| Variable | `STAGING_READINESS_URL` | `https://<actual-staging-host>.onrender.com/health/ready` |

Use image-backed services whose image repository is `ghcr.io/demesheo/nitewide`.
The workflow sends the exact verified digest, not a mutable tag, and refuses
missing/mismatched hooks. It never falls back to a Git rebuild. A superseded
branch commit does not start deployment; deployments are serialized and not
canceled midway through migrations.

The API deploy runs its pre-deploy migrations first. The workflow waits for
`/health/ready` to report the expected public `X-Nitewide-Revision` and
`X-Nitewide-Environment: staging` headers before requesting the worker deploy.
It then probes `/health/ready?requireWorker=true`, which additionally requires
a running worker heartbeat less than 30 seconds old with matching release and
private runtime configuration evidence. Neither worker details nor the keyed
fingerprint are exposed. An old healthy release, a queued hook response, or a
mismatched worker cannot produce deployment success. Failure leaves a red job;
inspect Render before retrying an uncertain hook request. There is no automatic
rollback or reseeding.

The normal Render health check stays `/health/ready`, independent of worker
startup, to avoid deadlocking the API-first rollout. A worker must be provisioned
before enabling this workflow; missing worker configuration fails closed.
After custom-domain cutover, the direct Render hostname still supports these
health probes. Hook-only image overrides do not change Render's default image
reference: keep its configured verified digest current before manual redeploys.

The manually provisioned staging services share the **nitewide-staging-runtime**
environment group, scoped to **Nitewide / Staging**. Keep common settings there,
not in duplicate service overrides. The API retains its `PORT` and
`SERVE_FRONTENDS=true`; the worker overrides `SERVE_FRONTENDS=false`. The current
Dashboard-created worker uses Render's default 30-second shutdown window, so its
local `WORKER_SHUTDOWN_TIMEOUT_MS=20000` exits before a platform hard kill. Durable
leases recover unfinished jobs. The Blueprint's longer 180-second Render window
must be applied before using its 150-second application shutdown deadline; do
not increase the application deadline alone.

Use one verified image digest for both release services. Replace both image
placeholders in the selected template before applying it:

- [Staging Blueprint](../deploy/render.staging.yaml)
- [Production Blueprint](../deploy/render.production.yaml)

Confirm the artifact belongs to the intended branch/revision and all verification
jobs succeeded. If GHCR access is private, configure Render registry credentials
before pulling the image. Production promotion requires human approval of the
exact verified artifact, migrations and deployment settings; changing a branch
or publishing an image is not that approval.

Validate the selected file with Render CLI v2.7+ before applying it:

```bash
render blueprints validate deploy/render.staging.yaml
```

If the CLI is unavailable, use the Dashboard's Blueprint validation/review; do
not treat YAML parsing as confirmation that account references or the image are
valid. Commit/push the reviewed template before the Dashboard reads it from Git.

## Set up Cloudflare storage first

In the existing Cloudflare account, create two **Standard**, private R2 buckets:

| Environment | Bucket | Credential scope |
| --- | --- | --- |
| Staging | `nitewide-staging-media` | This bucket only |
| Production | `nitewide-production-media` | This bucket only |

For each bucket, create a separate R2 S3-compatible credential with **Object Read
and Write**, limited to that bucket. Store its access key ID and secret access
key privately. The API uses those S3 credentials, not the token value. The
Cloudflare account ID can be shared; bucket credentials must not be shared with
dev/demo or the other release environment. Keep public access and `r2.dev`
disabled. Standard automatic jurisdiction uses the normal account endpoint;
jurisdiction-specific buckets require a matching `R2_ENDPOINT` on both runtimes.
See [Cloudflare R2 credential instructions](https://developers.cloudflare.com/r2/api/tokens/).

Keep `MEDIA_CLEANUP_ENABLED=false` initially. After an authorized upload/read
and orphan-cleanup verification against the isolated bucket, enable cleanup on
the same environment's API and worker. Do not configure a blanket upload-age
deletion rule as an event-end retention policy. R2 free allowances are shared
across the account; separate buckets do not multiply those allowances.

## Create staging on Render

Stay on Hobby and use the **Nitewide / Staging** project environment. The staging
template specifies Virginia, a 512 MB web service, a 512 MB independent worker,
PostgreSQL 18 with 256 MB RAM and **1 GB storage**. Confirm storage explicitly
instead of accepting a larger Dashboard default. Match the required PostGIS and
pgcrypto extensions through the existing migration chain. No Redis, persistent
disk, replica, autoscaling plan upgrade or additional frontend service is needed.

Both release templates and the existing CI database jobs use PostgreSQL 18.
Use the [isolated PostgreSQL 18 test server](TESTING.md#postgresql-18-release-tests)
to check migrations and database/browser regressions locally. The development
database and existing Render demo stay on PostgreSQL 16; upgrading their retained
data is a separate backup-and-migration operation, not an image-tag change.

Begin with the database, then configure the web service, then start the worker
after migrations and web readiness succeed. If Blueprint creation starts both
services together and the worker fails because the schema is not yet migrated,
retry that worker deployment only after the API's migration step succeeds. Do
not seed or reset the database to recover a deploy.

The templates intentionally deny external database access with `ipAllowList: []`.
Our release configuration requires certificate verification, so do not blindly
use Render's default internal connection string or disable TLS verification.
Obtain the database's full external DNS connection string and test verified TLS
from each service and the migration runner. Allow only the approved services'
Render outbound CIDRs (and any specifically approved temporary operator IP).
Record those CIDRs in the Blueprint before applying/syncing it; leaving `[]`
blocks the external URL, and resyncing `[]` would remove a Dashboard-only allow
list. Do not open `0.0.0.0/0` as a convenience workaround. Remove a copied
`sslmode=require` parameter, or replace it with `sslmode=verify-full`, and set
`DATABASE_SSL=true`. A trusted private endpoint can be considered only after its
CA and hostname verification are proven. See [database security](ENVIRONMENT_SECURITY.md).

The web service's initial secret prompts include the connection URL and R2 S3
credentials. The worker references these web-service values. Both use the same
environment-scoped generated signing/encryption keys. The staging template now
keeps the five public app-routing settings in the shared runtime group, matching
the TLS-verified custom-domain cutover. For a new deployment without verified
custom domains, override those settings for the bootstrap below before starting
either runtime. There are no shared secret groups between staging and production.
`sync: false` prompts
apply only on initial creation; later secret changes require an explicit runtime
update and verification of both services.

Use the actual web hostname issued by Render, not an assumed service-name URL:

```text
APP_ROUTING_MODE=paths
CUSTOMER_APP_URL=https://<actual-staging-host>.onrender.com
BUSINESS_APP_URL=https://<actual-staging-host>.onrender.com/app
CORS_ORIGINS=https://<actual-staging-host>.onrender.com
```

Leave `ADMIN_APP_URL` blank during this bootstrap (or set it to that origin's
`/admin`). The database path must be `/nitewide_staging`. In path mode all three
frontend builds use the same origin: customer `/`, business landing `/business`, business sign-in
`/sign-in`, business workspace `/app`, admin `/admin`. Staging sends noindex
headers; those headers are not access control. Use synthetic data only and
verify account/role access before adding any sensitive information.

Leave Stripe disabled and email sending unconfigured for initial infrastructure
checks. Sandbox payments require a later explicit configuration step: install
the same sandbox keys and separate webhook secrets on API/worker, configure the
two staging webhook destinations, connect normally routed test merchants and
run payment preflight/provider verification. Never copy the demo's temporary
`STRIPE_SANDBOX_SHARED_ACCOUNT_ID` into staging. No production live keys are
accepted by the current code.

Staging caps each database pool at four connections, email/notification
concurrency at one and exports at one. Production starts at eight connections
per process and email/notification concurrency of two. These are bounded starting
settings, not measured capacity. Measure combined pools, statement latency,
memory, disk growth and worker backlog before tuning. Database storage growth is
manual in these templates to avoid silently increasing the fixed hosting bill;
set storage/billing alerts and respond before capacity is exhausted.

Before calling staging ready, verify the actual revision, migration state,
`/health/live`, `/health/ready`, entry HTML and referenced assets, all deep links,
worker heartbeat, private media access and cross-organization authorization.
Ordinary readiness is not payment readiness. Plan a controlled first-admin
bootstrap and synthetic organization/event setup; there is no automatic demo
account or fixture creation in this deployment.

## Rehearse separate app domains on staging

Keep the domain registered with Squarespace. Cloudflare can host authoritative
DNS without moving its registration. Before changing nameservers, inventory and
preserve existing DNS records, including mail/verification records, and check
any existing DNSSEC delegation. A nameserver switch affects the entire domain,
not just Nitewide's website, and requires a separate reviewed cutover.

Bootstrap on the actual `onrender.com` hostname in `APP_ROUTING_MODE=paths`
first. One web service still serves all three apps; separate domains do not
require separate frontend services or extra compute. Check Render's current
workspace-wide custom-domain allowance and charges before adding the domains.

| App | Staging | Production |
| --- | --- | --- |
| Customer | `https://staging.nitewide.com` | `https://nitewide.com` |
| Business | `https://business-staging.nitewide.com` | `https://business.nitewide.com` |
| Admin | `https://admin-staging.nitewide.com` | `https://admin.nitewide.com` |

Business landing is `/`, sign-in `/sign-in`, and workspace `/app` on its own
hostname. Admin opens at its hostname's root. Flat staging names avoid requiring
a certificate for nested `business.staging.nitewide.com`.

After staging's direct Render checks pass, perform a separately approved cutover:

1. Add all three staging hostnames as custom domains on the **staging** web
   service. Do not change the production apex/Squarespace website yet.
2. In Cloudflare, create CNAME records named `staging`, `business-staging`, and
   `admin-staging`, all targeting the staging service's actual `onrender.com`
   hostname. Begin **DNS only** for Render certificate validation. Preserve
   unrelated records, especially mail and verification records.
3. Wait for Render's domain verification and valid certificates. Then enable
   Cloudflare proxying and **Full (strict)** encryption. Never use Flexible TLS.
4. Verify the real proxy chain before changing `TRUST_PROXY_HOPS`, preserving
   spoofed-forwarding-header protections and legitimate per-client rate limits.
   Staging uses `TRUST_PROXY_MODE=cloudflare-render` **instead of**
   `TRUST_PROXY_HOPS`. A private/loopback Render ingress is trusted only as the
   socket peer; subsequent proxy hops must match the finite reviewed
   [Cloudflare IPv4/IPv6 ranges](https://www.cloudflare.com/ips/). Express stops
   at the first untrusted address instead of trusting a fixed number of hops.
   This supports both proxied and shorter direct-ingress paths without accepting
   a caller's prepended IP. It does not trust `CF-Connecting-IP` or
   `True-Client-IP` supplied by the caller. The mode is opt-in and does not change
   existing demo or production configuration. Keep Render's ingress/private
   network boundary restricted; this is not a policy for arbitrary hosting.
   Recheck the published ranges during infrastructure reviews and before launch.
5. Keep API, webhooks, checkout, passes, Messages, authentication and all entry
   HTML uncached. Respect `no-store`; cache only appropriate static assets.
   Do not enable Cache Everything, Rocket Loader or script transformations on
   payment/authentication pages as an untested optimization.
   The staging-only Cloudflare cache rule bypasses all three staging hostnames
   except `/assets/`, `/business/assets/` and `/admin/assets/`. Those static
   prefixes still respect origin cache headers; missing assets remain `no-store`.
   Verify hashed JS/CSS become cache hits while HTML, `/app-config.js`, API
   responses (including extension-like paths) and health checks do not.
6. Update and verify app URLs, CORS, provider return/webhook URLs and
   merchant-specific wallet domain registrations. Recheck browser/device flows
   on the actual custom domain, not only on Render's direct hostname.

Deploy a verified image containing this routing support before enabling it;
older images do not understand the new setting. Once all three domains have
valid certificates, set these on **both API and worker**, using the same
reviewed image digest:

```text
APP_ROUTING_MODE=subdomains
CUSTOMER_APP_URL=https://staging.nitewide.com
BUSINESS_APP_URL=https://business-staging.nitewide.com/app
ADMIN_APP_URL=https://admin-staging.nitewide.com
CORS_ORIGINS=https://staging.nitewide.com,https://business-staging.nitewide.com,https://admin-staging.nitewide.com
TRUST_PROXY_MODE=cloudflare-render
```

Remove `TRUST_PROXY_HOPS` from the staging runtime group when selecting this
mode; startup refuses ambiguous dual policies. Roll it out only with a verified
image containing `http/trusted-proxy.js`. API/worker readiness includes the
proxy policy in its private configuration parity check. Verify the original
visitor's rate-limit counter increases for requests with and without forged
forwarding headers, through both ingress paths; do not expose raw IPs, headers
or signing secrets in a public diagnostic endpoint or logs.

Update these values in the intended Blueprint too before a future sync, so
bootstrap settings cannot undo the cutover. The staging Blueprint and the
manually created services share them through `nitewide-staging-runtime`; the
production template uses worker `fromService` bindings to copy the web-service
settings. Verify both runtimes restarted with matching configuration evidence.
Startup refuses missing admin URLs,
overlapping hosts, unexpected URL paths and incomplete/wildcard CORS lists.
Staging also refuses production app hostnames. Stripe remains disabled or
sandbox-only; subdomains do not enable live payments.

The server selects the app by the original `Host` header, not forwarded-host
input. Unconfigured hosts return 404 for app/API routes. Render's direct origin
still exposes `/health`, `/health/live` and `/health/ready` for health checks,
but does **not** remain an alternate app or webhook endpoint in subdomain mode.
Point the sandbox Stripe/Resend webhook destinations to a configured hostname
(for example `https://business-staging.nitewide.com/api/webhooks/stripe` and
`/api/webhooks/stripe/accounts`) before expecting webhook delivery there.
Use the customer hostname for customer checkout return URLs and wallet domain
registrations, and the business hostname for business onboarding returns.

The same verified image supports both modes without rebuilding for each domain.
Its entry HTML loads `/app-config.js` before React starts. It
contains only the configured public app links, never credentials, and overrides
build-time cross-app links. Entry HTML and runtime configuration are `no-store`;
fingerprinted assets retain immutable caching. `/business`, `/app`, `/sign-in`
and `/admin` compatibility links redirect to the configured app without trusting
user-provided redirect targets; invitation query parameters remain intact.
Customer guestlist/referral links stay on the customer app.

Each origin retains its existing authentication and role checks. Signing into
one app does not automatically sign into another: browser session storage is
origin-scoped. This routing change is not SSO and never puts access tokens into
cross-app URLs. Re-test invitations, password reset, account onboarding, checkout
returns, assets, deep-link reloads and authorization on desktop and iPhone.

For repeatable offline browser checks of the actual built apps, run
`npm run test:app-routing`. It builds the same asset bases as the image and tests
desktop Chromium and iPhone WebKit through a loopback server using synthetic
hostnames/API fixtures. It makes no DNS, provider, database or account changes;
it does not substitute for real DNS/TLS/device verification after cutover.

To roll back routing, restore `APP_ROUTING_MODE=paths`, the direct Render
customer/business URLs and corresponding CORS origin on both runtimes. Clear
`ADMIN_APP_URL` or restore it to the direct origin's `/admin`, then restart both.
Existing browser sessions on custom origins are not transferred.
Restore provider destinations too; do not reseed or rewrite retained purchases.

Repeat this procedure for production only after its separate deployment is
approved, using the production hostnames in the table and production-specific
database, storage and keys. Review apex/`www` conflicts and the intended `www`
redirect before changing existing website records.

Render documents [DNS-only certificate verification before proxying](https://render.com/docs/configure-cloudflare-dns/).
Cloudflare's [Full (strict) mode](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
requires a valid certificate for the origin hostname.

Cloudflare Free DNS/proxy protection and eligible static caching belong in the
initial setup. Turnstile on appropriate public forms and privacy-conscious
analytics are separate application/configuration steps before launch where
needed; this preparation does not claim those integrations are already active.
Do not place a browser challenge in front of signed Stripe/Resend webhooks.
Review direct-origin access before relying on Cloudflare-only controls; proxying
does not automatically prevent requests to the Render origin.

## Repeat the staging rehearsal for production

Use the production template only after reviewing the selected artifact, launch
scope and operational gates. It creates a different database named
`nitewide_production`, different generated keys and the production R2 bucket
binding, with 1 GB database RAM and 5 GB storage. The same application artifacts
and reviewed migration sequence must pass staged testing before promotion.
Preserve existing orders and merchant snapshots; never reseed retained history.

Verify backup/restore, rollback, HTTPS device behavior, payment configuration and
capacity on production's actual resources in a controlled pre-launch phase.
The smaller staging database cannot prove production will never reach a limit.
See the [master production launch checklist](PRODUCTION_LAUNCH_CHECKLIST.md).
