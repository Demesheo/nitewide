# API errors and production diagnostics

This guide describes the API error contract, privacy protections, health probes, database deadlines and shutdown behavior. Defaults apply to local development and hosted environments unless an environment variable overrides them. No external logging or monitoring provider is required.

## Error responses

Errors use the existing JSON envelope, with a correlation ID added when handled through the application:

```json
{
  "error": {
    "code": "MALFORMED_JSON",
    "message": "Request body must be valid JSON",
    "requestId": "10000000-0000-4000-8000-000000000001"
  }
}
```

The same ID appears in `X-Request-Id`. Clients may supply a UUID in that header; other values are replaced with a generated UUID. A request ID is a troubleshooting correlation value, not an authentication credential.

| Condition | HTTP status | Behavior |
| --- | --- | --- |
| Malformed JSON or unreadable body | 400 | Fixed safe message; request body is never echoed |
| Oversized JSON, raw webhook or uploaded file | 413 | Fixed safe size error |
| Unsupported body encoding | 415 | Fixed safe encoding error |
| Schema validation | 422 | Field locations and generic messages, without input values |
| Authentication or authorization | 401 or 403 | Existing domain rules apply |
| Unique constraint or concurrent update | 409 | Safe conflict message |
| Unregistered API route | 404 | Removed operations are not registered; use the executable contract for supported paths |
| Unsupported method on a registered API route | 405 | `Allow` header identifies supported methods |
| Database statement, lock or pool acquisition timeout | 503 | Retryable service busy message |
| Unexpected failure | 500 | No internal message, stack, SQL or database details |

Legacy errors with explicit client `status` or `statusCode` are normalized instead of becoming HTTP 500. Domain services continue to provide intentional user-facing messages through `DomainError`. JSON bodies retain the 1 MB limit; signed raw email webhooks retain the 256 KB limit; artwork uploads retain the 10 MB file limit.

## Structured logs and metrics

The API emits JSON request completion records with the UUID, fixed route template, method, status, duration, query count, query duration and bounded failure category. Worker startup and shutdown also use the structured logger. `LOG_LEVEL` accepts `info`, `warn`, `error` or `silent`; tests default to `silent`.

The logger uses an allowlist. It does not serialize bodies, headers, query values, emails, phone numbers, account IDs, credentials, QR tokens, signed media URLs, raw SQL, bindings, arbitrary error messages or stacks. Route templates are registered constants, not actual request URLs. Capture the response request ID when reporting an issue.

Authenticated internal administrators can inspect process metrics at `GET /api/admin/diagnostics/metrics`. Ordinary customer and business accounts cannot access this endpoint. Do not publish or proxy it without preserving authentication and internal-role authorization.

Metrics contain process uptime and aggregate counts, duration totals, maximums and fixed latency buckets. HTTP series are bounded to 256 combinations plus an overflow series; query series use a fixed operation and outcome vocabulary. Unknown query types use `OTHER`; no query text is parsed or exposed. Queries include failed statements, timeouts and connection acquisition duration. An HTTP record's query duration is the sum of its queries, so concurrent query durations can exceed wall-clock request duration.

Metrics reset on process restart and describe one process only. They are not persistent distributed telemetry, percentile estimates or a substitute for a monitoring service. Scrape each instance with an authorized session if collecting history externally.

## Health probes

| Endpoint | Purpose |
| --- | --- |
| `/health/live` | Process liveness; independent of the database |
| `/health/ready` | Database availability and whether the API is draining |
| `/health` | Backward-compatible readiness alias for existing Render configuration |

Readiness returns 503 for a failed database check, an expired readiness deadline or draining. Liveness remains 200 during draining until the server closes. Health responses contain no connection details and are not cached. Concurrent readiness probes share one in-flight database check, preventing a hung check from flooding the pool. The HTTP deadline does not cancel the underlying probe; PostgreSQL and connection deadlines bound that work separately.

## Payment deployment preflight

`GET /api/admin/diagnostics/payments` is a separate, authenticated **internal-admin-only** diagnostic with `Cache-Control: no-store`. It does not change `/health/live`, `/health/ready`, merchant assignments or checkout behavior. A payment configuration problem must not take discovery, free claims, guestlists or existing passes offline. HTTP 200 means the diagnostic returned a report, not that payments passed: inspect its `mode` and checks.

The report distinguishes `disabled`, `sandbox-ready` and `configuration-blocked`. It checks the effective runtime's test credential formats, both distinct webhook signing secrets, hosted callback/CORS settings, payment schema/migration ledger, active published paid-event merchant routing, and fresh payment-worker identity. The bundled hosted demo additionally requires customer `/` and business `/app` callbacks on the same origin; standalone deployments are not restricted to those paths. Live mode remains unsupported. Missing, restricted, stale, disconnected or wrong-organization merchants are counted without returning account IDs, customer information or raw provider/database errors. Free events do not require a merchant; inactive and ended events are excluded from new-checkout routing checks.

The database inspection uses a bounded read-only transaction and aggregate queries, not one provider request per event. Concurrent HTTP probes share one inspection. It makes **no Stripe requests, charges, refunds, emails or database writes**, and it never refreshes merchant readiness. Stored provider observations use the same freshness policy as checkout, so an expired observation must be refreshed through the existing authorized Business Payments workflow before rechecking.

Worker heartbeats carry a keyed payment-configuration comparison token and release identity in the existing private heartbeat details. The diagnostic compares every fresh running worker (two-minute heartbeat window) with the API, including whether payment reconciliation is enabled. Missing or mismatched evidence blocks hosted sandbox readiness; local development warns when no worker is running. The comparison token is not a raw secret, is not logged, and is not returned in the preflight report. It establishes runtime parity, not correct external provider settings.

The image build embeds its public Git SHA in `apps/api/release.json` and verifies it before publication. Native Render Git deployments without that file use `RENDER_GIT_COMMIT`; a malformed or missing baked revision is not substituted with an operator-provided claim. API and worker must use the same reviewed image and settings. No runtime secret is a build argument.

### Release commands

Run on the target runtime, after reviewed migrations and after its worker has produced a heartbeat:

```sh
npm run payments:preflight -- --require-paid --expect-revision <full-40-character-commit-SHA>
```

Or inspect the **actually running deployed API**, using a current internal-admin session stored privately as `PAYMENT_PREFLIGHT_ADMIN_TOKEN` (never as a command argument or query string):

```sh
npm run payments:preflight -- --url https://nitewide-demo.onrender.com --require-paid --expect-revision <full-40-character-commit-SHA>
```

The deployed command rejects redirects and validates the response against the executable report contract before printing it. The local command uses injected runtime settings; only local development may need the ignored root `.env`. Both exit nonzero for blocked results; `--require-paid` also rejects disabled payments, the absence of a usable paid-event route, or missing/mismatched payment-worker evidence even locally. `--expect-revision` prevents an older healthy release from passing as the candidate. The command has a 20-second overall deadline. Running it without `--require-paid` permits an intentionally disabled free-only environment; that is not paid-launch approval.

Treat this command as an explicit payment release gate after API/worker startup, not as the general host health check. Do not automatically redeploy, reseed, change settings or change merchants when it fails. The current demo workflow embeds/verifies release identity, but does not receive production credentials or automatically run a remote authenticated payment check. A production promotion process still needs to invoke this gate against its candidate environment.

### Evidence it cannot establish

Credential **formats** do not establish that secret and publishable keys belong to the same Stripe sandbox; that needs separately recorded identity and end-to-end evidence. Stripe documents [key roles and environment isolation](https://docs.stripe.com/keys). Likewise, two correctly shaped signing secrets do not establish that the Dashboard destinations use those secrets, the right event subscriptions/API version, the right URLs, or that Stripe actually delivers events. Confirm both destinations' signed delivery in Workbench using [Stripe's webhook guidance](https://docs.stripe.com/webhooks).

`sandbox-ready` means these configuration/routing checks passed, **not** that production payments, actual webhook delivery, wallet availability, financial settlement or backups have been verified. The report explicitly labels key-pair identity and webhook delivery unverified and merchant readiness stored-snapshot-only. Keep the controlled provider, physical-device and launch approval gates in the [production checklist](PRODUCTION_LAUNCH_CHECKLIST.md).

## Environment configuration

Set these variables in the repository's ignored local `.env` or the API and worker services' Render environment settings. The `.env.example` contains the defaults. Do not put secrets or connection URLs in source control.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_LEVEL` | `info`; `silent` in tests | Structured log level |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 120000 | Maximum PostgreSQL statement execution time |
| `DATABASE_LOCK_TIMEOUT_MS` | 10000 | Maximum wait for a PostgreSQL lock |
| `DATABASE_IDLE_TRANSACTION_TIMEOUT_MS` | 120000 | Maximum inactivity inside a transaction |
| `DATABASE_CONNECT_TIMEOUT_MS` | 10000 | Connection establishment deadline |
| `DATABASE_ACQUIRE_TIMEOUT_MS` | 30000 | Sequelize pool acquisition deadline |
| `READINESS_TIMEOUT_MS` | 3000 | Maximum time an HTTP readiness response waits |
| `HTTP_REQUEST_TIMEOUT_MS` | 60000 | Maximum time to receive the full HTTP request |
| `API_SHUTDOWN_TIMEOUT_MS` | 30000 | Overall HTTP drain and database close deadline |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 150000 | Overall worker drain and database close deadline |

Timeout values must be positive and fall within the configuration schema's limits; invalid values prevent startup. PostgreSQL enforces statement, lock and idle transaction deadlines for each application connection. Existing background exports explicitly set transaction-local statement deadlines of 120 seconds for materialization and 30 seconds for batches; these intentionally override the connection-level statement timeout.

The HTTP request timeout bounds receiving an HTTP body, not application response execution. Queries have separate deadlines; a sequence of queries can still take longer than one statement deadline. API idle keep-alive connections expire after 5 seconds and headers must arrive within 15 seconds or the shorter HTTP request timeout.

## Shutdown and verification

On SIGTERM or SIGINT, the API marks itself draining, stops accepting new connections, closes idle sockets and allows active requests to complete. It then closes the database pool. The overall deadline remains referenced so a stalled database close cannot leave the process running indefinitely. At the deadline, open HTTP connections are closed and the process exits with failure. Successful shutdown exits with status zero.

The worker has its own bounded graceful shutdown; it stops taking new background work and waits for active work before closing its database pool. No process may claim a successful graceful shutdown after its configured deadline expires.

Run the standard API tests, or these focused commands:

```sh
node --test apps/api/test/production-diagnostics.test.js
npm test --workspace @nitewide/api -- --suite production-diagnostics-integration.test.js
```

The integration runner provisions and removes an isolated local PostgreSQL database. Tests cover JSON and upload error normalization, safe logs, bounded metric labels, authorization, readiness recovery, real statement and lock timeouts, and shutdown deadlines. No live email, R2 or Render requests are made.

The implementation follows the documented [Express body-parser error types](https://expressjs.com/en/resources/middleware/body-parser/#errors), [PostgreSQL timeout settings](https://www.postgresql.org/docs/current/runtime-config-client.html) and [Node HTTP shutdown APIs](https://nodejs.org/api/http.html#servercloseallconnections).
