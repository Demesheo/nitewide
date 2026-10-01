# Lean launch hosting plan

Decision recorded: September 30, 2026.

The agreed starting plan is paid Render services on the free Hobby workspace,
combined with Cloudflare Free and R2 Standard within its free usage allowances.
The estimated infrastructure base is $34.50 per month. This decision is saved for
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

Prices are the planning snapshot discussed on September 30, 2026, not a fixed
quote. Recheck provider pricing and account eligibility before provisioning.
The estimate excludes usage overages, email, SMS, payment processing, taxes,
separate staging infrastructure, and any additional backup or monitoring costs.

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

## Launch prerequisites

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
