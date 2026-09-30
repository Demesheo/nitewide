# SQL reporting and snapshot exports

Business and Admin analytics use scoped SQL aggregates and server-paginated tables. They no longer load capped arrays of orders, customers or events into Node. Small CSV exports download immediately; large exports prepare a stable dataset in the background and remain downloadable for 24 hours.

## Reporting APIs

Business uses `/api/business/reports/summary` and `/api/business/reports/:table`; Admin uses `/api/admin/reports/summary`, `/api/admin/reports/:table` and `/api/admin/reports/bootstrap`. Tables are `regions`, `venues`, `events`, `offerings`, `team` and `customers`. Existing date, search, scope, sorting and drilldown filters still apply. Table pages remain bounded; exports omit pagination deliberately.

The summary executes one aggregate statement over a shared materialized event/order/item/guest scope instead of sequential aggregate statements. Authorization, filters and data reads share a transaction snapshot. Intermediate rows contain only required columns, management access is calculated per event, and customer units are grouped by order rather than repeatedly scanned. Report transactions use `SET LOCAL jit=off`, not a database-wide configuration change.

Business access continues to exclude archived resources and preserve own-referral restrictions. Internal Admin reporting retains historical records, including archived events. Venue selection includes organization or independent-creator identity so separate businesses sharing a location are not combined accidentally. Admin's `No event location` group keeps historical events with missing locations reachable.

The redundant `/api/business/workspace`, `/api/business/analytics` and `/api/admin/analytics` endpoints now return authenticated `410 LEGACY_REPORT_RETIRED`. They do not silently truncate results or ask users to narrow scopes. Current frontends use their replacement APIs; external clients must migrate. Pure aggregation utilities retained for unit tests are not active bulk-loading endpoints.

## Export contract

Request `GET /api/business/reports/export.csv` or internal-only `GET /api/admin/reports/export.csv` with the report filters. Set `exportTable` to export one table; omitting it exports events, offerings, team and daily data. Venue-local event starts and spreadsheet-formula escaping are preserved.

- Up to 1,000 output rows: `200 text/csv`, captured before streaming. Slow clients never hold the snapshot transaction open, and the worker cannot reclaim an immediate stream.
- More than 1,000 rows: `202` with a job ID, status/progress and authenticated status/download URLs. The response does not contain a partial CSV. The final snapshot is taken when the worker captures the job, not when the user clicks Export. Calendar dates are fixed at submission, and `snapshotAt` records capture time.
- Poll `GET /api/business/reports/exports/:id`; list the latest 20 own jobs with `GET /api/business/reports/exports`.
- Download a ready job with `GET /api/business/reports/exports/:id/download`. Earlier download attempts return `409 EXPORT_NOT_READY`.
- Retry failed preparation with `POST /api/business/reports/exports/:id/retry`. Three preparing jobs per account are allowed; serializable admission and bounded retries enforce this during concurrent submissions and retries.

Business and Admin show a collapsible Prepared exports section with progress, Download and Retry. Automatic polling waits up to ten minutes without resubmitting the export; longer jobs can be downloaded later from that section. Leaving Analytics does not cancel a queued job.

## Snapshot and worker lifecycle

Migration `202609300005-report-export-jobs` adds durable job, snapshot-row and CSV-chunk tables. Run `npm run db:migrate`, then restart the API and start `npm run dev:worker`. No reseed is needed. The dedicated worker process polls exports every two seconds; the API never dispatches them. The free demo supervises separate API and worker processes in its existing container; production should run a dedicated worker service. See [Background workers](BACKGROUND_WORKERS.md).

The worker captures ordered aggregate rows in one repeatable-read transaction, commits them, then renders 250-row batches using sequence-key pagination. Each render checkpoint commits its CSV chunk and progress together. Subsequent batches do not recount or reread live orders. Purchases, refunds and changing sales rankings during rendering cannot duplicate, skip or alter captured rows. Failed jobs retain their snapshot/checkpoint; retries resume it instead of mixing in newer data.

Workers claim jobs with `FOR UPDATE SKIP LOCKED` and a five-minute token-fenced lease. Expired leases can be reclaimed after a crash. SIGTERM stops new work, finishes the active checkpoint and releases rendering work for resumption. Snapshot queries have a two-minute statement timeout; submission queries have a 30-second timeout. These are safety boundaries, not guarantees that arbitrarily large exports will finish.

Files are identity-bound, never public URLs. Effective access is checked at submission, capture, status, retry and download. Membership/role/lifecycle changes invalidate old exports conservatively; ordinary purchases and financial changes do not. New requests expire at 24 hours. A download begun before expiry pins its chunks for a bounded 30-minute stream so cleanup cannot truncate it mid-download. Cleanup subsequently cascades the stored data. Completed jobs discard snapshot payload rows and retain only CSV chunks.

CSV chunks currently live in PostgreSQL to survive restarts and free-host ephemeral storage. Monitor database size, queue age, failures, throughput and lease recovery. At higher sustained export volume, move completed chunks to private R2 objects with short-lived downloads; do not enable public buckets or store permanent presigned URLs. That storage change is not implemented here.

## Measurements and rollup decision

The mandatory `report-export-integration.test.js` creates 1,205 events, 24,001 paid orders/items and 12,001 distinct buyers in a disposable database. It reconciles totals beyond the old limits and logs PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for summaries, event tables and customer tables. It also exercises concurrent purchases, competing workers, interrupted rendering, access revocation, expiry and retries. Standard commands send no emails.

```bash
npm run test:api:integration -- --suite report-export-integration.test.js
```

Initial local Docker measurements showed a roughly 3.8-second summary and temporary spills. Narrowing scope rows removed those spills; JIT compilation still consumed roughly 1.5–1.7 seconds. A measured narrowed summary took 3.715 seconds with JIT versus 1.870 seconds without JIT. Other runs vary with CPU contention; this is a local diagnostic comparison, not a production latency promise or a million-user benchmark. CI checks correctness and records timings without hardware-dependent pass thresholds.

Persistent financial rollups were not added based on this sample: compilation and permission/scope work were demonstrated costs, while a correct rollup benefit has not yet been measured. The shared materialized scope reuses aggregates within each query without introducing stale financial data. Before adding daily event/referrer/offering rollups, measure production-like concurrency and p95 latency with JIT disabled, current statistics and relevant indexes. A rollup must reconcile paid/refunded orders, historical commissions, admissions and lifecycle changes. Distinct customers across dates/venues cannot be computed by adding daily distinct counts, and scoped referral access must remain authoritative.

Use [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) to compare estimates, actual rows, loops, buffers and spills. `ANALYZE` executes the query, so measure read-only report statements on staging or a replica where suitable. PostgreSQL's [transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html) describes the snapshot and serialization guarantees used here.
