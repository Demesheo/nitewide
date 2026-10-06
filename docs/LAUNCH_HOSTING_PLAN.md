# Lean launch hosting plan

Decision recorded: September 30, 2026.
Budget amended: October 6, 2026 — production plus paid Render staging with the
same service layout and a smaller database. The combined planning base is
$54.80 per month, with a total hosting budget below $60.

The agreed starting plan is paid Render services on the free Hobby workspace,
combined with Cloudflare Free and R2 Standard within its free usage allowances.
The estimated production infrastructure base is $34.50 per month, with staging
adding $20.30 per month. This decision is saved for
later implementation; it does not authorize purchasing, provisioning, migrating,
changing DNS, or deploying services now.

## Agreed infrastructure

| Component | Starting configuration | Estimated monthly base |
| --- | --- | ---: |
| API and customer, business, and admin frontends | One paid Render web service, 512 MB RAM | $7.00 |
| Background work | Separate paid Render worker, 512 MB RAM | $7.00 |
| PostgreSQL | Paid Render database, 1 GB RAM | $19.00 |
| PostgreSQL storage | 5 GB | $1.50 |
| Render workspace | Hobby | $0.00 |
| Cloudflare | Free DNS, CDN where eligible, managed HTTPS, available basic protection, Turnstile, and analytics | $0.00 |
| Durable images and flyers | Cloudflare R2 Standard, within free allowances | $0.00 within allowances |
| **Total base** | | **$34.50** |

Compute prices were rechecked on October 6, 2026; storage is conservatively
budgeted at $0.30 per GB. Confirm the Dashboard quote, including any included
storage, before provisioning. These estimates are not fixed quotes.
The estimate excludes usage overages, email, SMS, payment processing, taxes,
and any additional backup or monitoring costs. The $54.80 combined base leaves
$5.20 below $60 before these additions; it is not a guaranteed invoice cap.

Render's Hobby workspace is free, but the web service, worker, and database are
paid instances. Render Pro, multiple API replicas, database high availability,
Redis, a full Cloudflare backend migration, and separate frontend hosting are
deferred until measurements or operational needs justify them. Keep the existing
monorepo and initially serve the three frontends from the web service.

Cloudflare Free does not make all API responses cacheable: private, authenticated,
checkout, admission, and current inventory responses must remain uncached.
Cloudflare protection does not replace application authorization or abuse limits.
The Squarespace-registered domain can remain registered there; DNS configuration
will be decided when implementation resumes.

R2 Standard's free monthly allowances are 10 GB-month storage, one million Class A
operations, and ten million Class B operations. Usage above those allowances is
billable. R2 has no egress bandwidth charge. Persist stable object keys or asset
identifiers in PostgreSQL, not expiring presigned URLs. Revisit the proposed policy
of retaining flyers until 30 days after the event ends, including reschedules and
shared assets, before implementing cleanup.

For now, local development and the Render demo will share the private
`nitewide-dev-media` R2 bucket and its bucket-scoped S3 credentials. Their databases
remain separate, so automatic media cleanup stays disabled on both. Staging and
production will receive separate storage and credentials when introduced. See
[R2 configuration and cleanup safeguards](MEDIA_STORAGE.md). This decision does
not itself deploy the adapter or change Render's environment settings.

## Production lite staging

The agreed staging environment uses the same web/API, independently deployed
worker and PostgreSQL architecture as production, with smaller database resources.
Both web services initially serve all three frontends. Keep the free Hobby
workspace; this plan does not require Render Pro.

| Staging component | Starting configuration | Estimated monthly base |
| --- | --- | ---: |
| API and customer, business, and admin frontends | One paid Render web service, 512 MB RAM | $7.00 |
| Background work | Separate paid Render worker, 512 MB RAM | $7.00 |
| PostgreSQL | Paid Render database, 256 MB RAM | $6.00 |
| PostgreSQL storage | 1 GB budget allowance | $0.30 |
| **Staging total base** | | **$20.30** |
| **Production plus staging base** | | **$54.80** |

The `staging` branch targets the release candidate; the `production` branch
targets the approved release. Use separate databases, synthetic users, runtime
secrets, provider credentials, webhook destinations and R2 buckets. Staging must
not have production database credentials or media write access. Match PostgreSQL
version, required extensions and migration history, allowing the candidate's
reviewed migrations to be rehearsed before promotion. Stripe remains test-only
in staging; live payments are a separate implementation and approval gate.

The smaller database helps expose inefficient queries, unbounded exports,
connection pressure and worker contention early. It does not establish production
capacity or guarantee that production will never reach its limits. Use measured
query plans, latency, memory, storage growth and queue backlog to tune the app;
run targeted capacity checks separately from normal browser regression suites.
Production still needs resource/usage alerts, a tested response to approaching
limits and representative load checks on its actual configuration.

These totals cover two environments only. Keep the existing demo's deployment
routing unchanged until a separate decision determines whether to reuse it for
staging or retain it. A third paid demo database or service adds cost and must be
reconciled with the below-$60 budget. Cloudflare/R2 free allowances are shared
account allowances, not a separate free allocation for every environment.

Prepare and verify the non-demo image/start commands locally before provisioning
either environment. Rehearse configuration, migrations, independent API/worker
deployment, recovery and hosted device checks on staging, then validate the exact
production configuration in a controlled pre-launch phase. Recording this plan
does not authorize cloud provisioning, live keys, charges, email sends or
test-data imports, and does not mark those verification gates complete.

## Launch prerequisites

Use the [Render and Cloudflare setup guide](RENDER_RELEASE_SETUP.md) for the
non-demo startup commands, environment templates, isolated R2 buckets, verified
database connection and later DNS cutover. Prepare storage now; point production
DNS only after its Render deployment and certificates are verified.

Use the [production launch checklist](PRODUCTION_LAUNCH_CHECKLIST.md) as the master
release gate for Customer, Business, Admin, API and worker preparation. It expands
these prerequisites with configuration checks, merchant routing, actual provider
verification, recovery drills and final approval; recording the plan does not mark
those checks complete or authorize infrastructure changes.

1. Create production separately from the public demo, using fresh secrets and a
   clean database without demo credentials, mock purchases, or automatic reseeding.
2. Implement R2 storage, upload finalization, orphan cleanup, and media migration.
3. Deploy the existing dedicated worker independently and verify retries, failed
   job replay, graceful shutdown, and backlog visibility.
4. Validate payment and provider reconciliation flows before accepting real paid
   bookings, and configure real transactional email delivery.
5. Verify database recovery, independent backups as needed, alerts, deployment
   rollback, and incident procedures.
6. Load-test concurrent checkout, check-in, reporting, exports, and image uploads;
   onboard creators in controlled cohorts and adjust compute based on evidence.

## Capacity and availability assumptions

This is a launch candidate, not proven capacity for 100 creators or an uptime
guarantee. Peak simultaneous activity determines RAM and CPU requirements; retained
history, indexes, temporary files, and export snapshots determine storage growth.
Measure actual database growth and peak query behavior before estimating runway.

The workload discussed was 100 creators with 12 events per month and 200 bookings
per month, but the unit for those bookings remains unresolved. If bookings are per
creator per month, the total is 20,000 monthly bookings; if per event, it is 240,000.
Do not assume either interpretation when sizing production. The earlier
10–30 KB per booking estimate was illustrative, not a measured benchmark.

Plan storage alerts before the disk fills and assess storage autoscaling when
provisioning. The starting setup has no redundant API or database failover;
Cloudflare cannot keep transactional operations available during backend failure.

## Sources and related documentation

- [Render pricing](https://render.com/pricing)
- [Render workspace features](https://render.com/docs/platform-features-by-plan)
- [Render database recovery](https://render.com/docs/postgresql-backups)
- [Cloudflare Free plan](https://www.cloudflare.com/plans/free/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Background workers](BACKGROUND_WORKERS.md)
- [Environment secrets and database TLS](ENVIRONMENT_SECURITY.md)
- [Current hosted demo](HOSTED_DEMO.md)

Resume by reviewing this decision, confirming workload assumptions and budget,
and agreeing on the implementation scope before making infrastructure changes.
