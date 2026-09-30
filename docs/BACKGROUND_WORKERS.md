# Background workers

The API commits durable work; a separate Node process delivers email, fans out checkout notifications and prepares large CSV exports. PostgreSQL stores queues and checkpoints, so process restarts do not lose committed jobs. No Redis or new cloud resource is required for this implementation.

## Start and deploy

Apply migrations with `npm run db:migrate`. New migrations `202609300006-email-worker-leases` and `202609300007-notification-jobs` preserve existing records; no reseed is required. Stop old API instances that still dispatch email before upgrading, apply migrations, then start the new API and worker. Do not overlap old non-fenced dispatchers with the new workers.

Locally, `npm run dev` starts all three apps, the API and worker. To run separately:

```bash
npm run dev:api
npm run dev:worker
```

For production, run `node apps/api/src/server.js` as the web process and `node apps/api/src/worker.js` as a dedicated worker. On Render, create a Background Worker using the same image/revision and override its command to `node apps/api/src/worker.js`. Workers do not expose an HTTP port. Apply migrations before deploying both services. Configure a 180-second termination grace period so the default 150-second worker deadline fits inside it. Dedicated Render workers require a paid plan; no paid service is created automatically.

The current free demo retains `node deploy/start.cjs`: it bootstraps/migrates the isolated demo once, then supervises **two separate OS processes**. If either exits unexpectedly, the supervisor terminates the other and exits unsuccessfully so hosting can restart the container. This preserves the free deployment but does not isolate CPU/memory or allow independent scaling. A sleeping free web service also pauses its worker; do not promise delivery SLAs from this demo. Render's default shorter termination grace may interrupt work; leases and checkpoints recover it on restart.

Both processes need the same `DATABASE_URL`, verified database TLS settings, session/QR/email keys, app URLs and email configuration. Set secrets in the environment, never the image. For live email, configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_ENCRYPTION_KEY`, HTTPS app URLs and `RESEND_TEST_MODE=false` on both services. Leave **both** Resend sending settings unset to disable delivery. Development test mode restricts recipients but **still consumes quota** when explicit simulator-address jobs are sent.

## Bounds and recovery

| Setting | Default | Meaning |
| --- | --- | --- |
| `EMAIL_WORKER_CONCURRENCY` | 2 | Simultaneous email sends per worker, maximum 8 |
| `EMAIL_WORKER_BATCH_SIZE` | 25 | Maximum claims per email poll, maximum 100 |
| `EMAIL_REQUEST_INTERVAL_MS` | 600 | Shared database pacing between email requests, minimum 500 ms |
| `NOTIFICATION_WORKER_CONCURRENCY` | 2 | Parallel notification jobs per worker, maximum 8 |
| `EXPORT_WORKER_CONCURRENCY` | 1 | Concurrent exports per worker, maximum 4 |
| `WORKER_POLL_INTERVAL_MS` | 2000 | Delay between polls in each independent lane |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 150000 | Maximum graceful shutdown time before crash recovery |

Multiple workers use `FOR UPDATE SKIP LOCKED` and token leases. Email leases last two minutes; a late response cannot overwrite a new owner's state. Claims are limited to a concurrency-sized wave so waiting rows do not hold idle leases. Provider requests have a ten-second timeout, never run inside a database transaction, and share database pacing across workers in this environment. Other applications using the same Resend account are outside that limiter; provider 429 responses honor `Retry-After` and trigger backoff. Adjust pacing to the account's limits before increasing workers.

Email attempts are retained in a bounded history of the latest 20 results, alongside total attempt count, cycle count, replay count, next-attempt time and safe error codes. Transient network/429/5xx errors retry exponentially, up to five claims per cycle. Crashed claims count toward the attempt budget. Expired security links are not sent. Successful messages clear encrypted variables.

Replay retains the same sender, variables and provider idempotency key. Resend [retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); the dispatcher conservatively stops automatic sends and replay after 23 hours from the first claim. For an older ambiguous failure, inspect provider delivery events first. Do not clear the first-attempt time or generate a new key to force a retry. A deliberate replacement message requires a new business action after confirming that it will not duplicate a previous send. Acceptance is not proof of inbox delivery; signed webhooks continue to track delivery outcomes.

Checkout writes one notification job inside the same transaction as the purchase. Recipient lookup and notification creation happen after the purchase commits, without holding checkout's event/inventory locks. The worker preserves the original audience, applies preferences and rechecks current active access. Removed staff do not receive delayed financial notifications. Each notification and recipient checkpoint commit together, preventing duplicate in-app messages after crashes or replay. A bounded pass yields periodically; failed jobs back off and resume existing checkpoints on replay. Customer purchase notifications may appear shortly after checkout rather than immediately.

Exports retain repeatable-read snapshots, chunk checkpoints, authenticated downloads and existing retry endpoints. See [Snapshot exports](REPORTING_EXPORTS.md). Independent lanes keep a long export from blocking emails or notifications.

SIGTERM/SIGINT stop new claims, wake polling sleeps, finish active email requests and notification batches, checkpoint/release exports, then close the database. If hosting kills the process first, expired leases recover durable work. No exactly-once external delivery guarantee is made beyond the provider's idempotency window.

## Inspect and replay

Internal administrators can use these authenticated APIs; business/customer accounts receive 403. Responses omit encrypted variables, invitation tokens and notification payloads.

- `GET /api/admin/background/workers`: latest 100 worker heartbeats, status and health (running with heartbeat within two minutes).
- `GET /api/admin/background/email?status=failed&page=1&pageSize=25`: paginated status, attempts, replay count, scheduling and error history. Status accepts `all`, `pending`, `processing`, `sent`, `failed`, `expired`.
- `GET /api/admin/background/notifications?status=failed&page=1&pageSize=25`: recipient progress, attempts, next retry, safe errors. Status accepts `pending`, `running`, `retry`, `completed`, `failed`.
- `POST /api/admin/background/email/:id/replay` or `POST /api/admin/background/notifications/:id/replay`, JSON body `{"reason":"Inspected failure and corrected configuration"}`: enqueue only; never sends inline. Replays require failed status and record an audit log. Unsafe/expired email replays return 409.
- Existing export status/download/retry routes remain per-account and authorization checked.

Use your normal authenticated admin session token, not a provider key. Monitor stale heartbeats, pending/retry age, failures, lease recovery and export database storage. This change adds operational APIs, not a new Admin dashboard screen.

## Automated coverage and quota

`npm test` includes mocked email tests, worker runtime/shutdown tests and mandatory disposable-database email/notification integration suites. They cover competing workers, bounded concurrency, expired leases, safe replay, audit authorization, idempotent notifications, preference/access checks and shutdown. Playwright runs the worker runtime in its isolated harness and stops it before each fixture reset. Customer and business browser regressions remain enabled; Admin browser testing remains paused as requested.

All standard tests/build/deploy checks use **zero Resend sends**. Only the existing explicit customer/business `:simulated` commands consume email quota; no simulator was run for this implementation.
