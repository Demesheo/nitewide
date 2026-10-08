# Standard and demo-only tests

## Required local gate before commit and push

Before committing or pushing, use Node 24.21.0 (`.nvmrc`) and npm 12.1.0
(`package.json`) to pass `CI=true npm run test:release` with the explicit isolated
PostgreSQL 18 maintenance URL on port 5434 shown below. Also pass
`npm run api:contract:check` and `git diff --check`. The release gate includes the
complete workspace/API/database suite and unfiltered browser suite with fresh
production frontend builds. Focused discovery checks or a frontend build alone
do not replace required reporting, worker, payment, and permission regressions.

Run on the final file contents; rerun after any subsequent source/test/config
change. Failed, cancelled, skipped required coverage and recovered browser
flakes block commit/push. Only the documented cross-app browser skips are
intentional. See the root `AGENTS.md` for the durable workflow rule.

## Node test runner and Supertest

API tests use Node's built-in `node:test` runner and `node:assert/strict`. Supertest is a pinned API development dependency, not a production dependency. HTTP regression tests exercise the actual Express routes, middleware, validation, status codes, response bodies, and headers; database integration suites run against migrated PostgreSQL/PostGIS with test-owned fixtures, not a mocked database.

Run these commands from the repository root:

| Command | Coverage | Database required |
| --- | --- | --- |
| `npm test` | All workspace unit/component tests, mocked email tests, and required API/database regressions | Yes |
| `npm run test:api` | API unit/mocked email tests and all required API/database regressions | Yes |
| `npm run test:api:unit` | API unit tests, mock-backed HTTP contracts, hosted routes, and mocked emails | No |
| `npm run test:api:integration` | All required isolated database suites | Yes |
| `npm run test:api:integration -- --suite admissions-integration.test.js` | One required database suite, with the same provisioning/cleanup protections | Yes |
| `npm run api:contract` | Regenerate the committed OpenAPI document from route metadata and shared schemas | No |
| `npm run api:contract:check` | Detect drift between the executable contract and committed document | No |

Workspace equivalents are `npm run test:unit --workspace @nitewide/api` and `npm run test:integration --workspace @nitewide/api`. A focused suite must be a required filename registered in `apps/api/scripts/run-tests.cjs`; unknown options, conflicting modes, arbitrary paths, and demo-only filenames fail before connecting to PostgreSQL. The default `npm test` still runs every required suite; focused commands do not weaken CI coverage.

GitHub Actions already invokes `npm test` with an ephemeral PostgreSQL 18/PostGIS service. These Node/Supertest regressions run in the existing Unit and API tests job and gate image publication/deployment; no extra duplicate CI test job is needed. Playwright remains the separate customer/business browser regression layer. The standard commands above consume **zero email sends**; quota-consuming simulator commands remain explicitly separate.

### PostgreSQL 18 release tests

The staging and production templates specify PostgreSQL 18. Test against that major version
without touching the existing PostgreSQL 16 development database on port 5433:

```sh
npm run test:db:up
export TEST_DATABASE_ADMIN_URL='postgres://postgres:isolated-pg18-password@127.0.0.1:5434/postgres'
npm run test:api:integration
# Or run the full unit, component, database and browser release gate:
CI=true npm run test:release
unset TEST_DATABASE_ADMIN_URL
npm run test:db:down
```

The Compose project publishes port 5434 on loopback only, uses test-only
credentials and a separate anonymous volume at `/var/lib/postgresql`, the
[PostGIS image's PostgreSQL 18 mount path](https://github.com/postgis/docker-postgis#pgdata-volume-path-change).
Its upstream image is amd64, so Docker Desktop uses emulation on Apple silicon.
`test:db:down` removes only this test project's containers, network and anonymous
volumes; do not run it while tests are active. Tests allocate and remove only
their generated databases, with all live provider credentials cleared.

Without the explicit `TEST_DATABASE_ADMIN_URL`, the existing local helper still
uses port 5433 for legacy development checks. Those PostgreSQL 16 checks do not
establish PostgreSQL 18 release compatibility. Do not attach the development
volume to the PostgreSQL 18 server or change its image tag to migrate retained
data. The hosted demo's database and smoke stack also remain on 16.

The October 6, 2026 compatibility run used PostgreSQL 18.6 and PostGIS 3.6.4
in the isolated Docker server, with Node 24.19.0 and npm 11.5.1 locally. All 50
migrations applied, all 33 mandatory database suites passed (205 tests), and
630 API unit plus 433 frontend tests passed. The full phone/desktop browser
run passed 156 cases, with six intentional cross-app skips and no failures or
recovered flakes. CI retains its pinned Node 24.21.0/npm 12.1.0 gate; local
compatibility results do not replace it or the deployed staging checks. These
tests cover new-database migrations, not a retained-data major-version upgrade,
Render TLS, backups or production capacity.

### Adding HTTP regressions

Use `test/support/http-client.cjs` rather than `fetch` against a running app or deployment. Pass an Express app or a loopback-bound fixture server and an application-relative path; remote URL targets are rejected and redirects are not followed. Requests have a five-second response timeout and ten-second total deadline. Keep real database workflows in a registered mandatory integration suite, guarded by `assertManagedTestDatabase()`, with deterministic fixtures and cleanup in `finally`. Assert database effects as well as HTTP responses, especially on rejected or replayed writes.

For example, within an existing fixture test where `server` is the local API server and `customerToken` belongs to the fixture customer:

```js
const { request } = require('./support/http-client.cjs');

const response = await request(server, `/api/events/${fixture.ids.event}/guestlist`, {
  method: 'POST',
  token: customerToken,
  body: { partySize: 2 },
}).expect(202).expect('Content-Type', /json/);
assert.equal(response.body.data.entry.status, 'pending');
assert.equal(response.body.data.requiresApproval, true);
```

Bind explicit fixture servers with `app.listen(0, '127.0.0.1')`, await their listening event, and close them in `t.after()` or `finally`. Keep service-only unit tests for domain rules; use real database suites for locking, rollback, and persistence. Supertest preserves numeric JSON fields, supports `.attach()`/`.field()` for multipart uploads, and sends raw strings unchanged for signed webhooks. Read JSON from `response.body`, CSV/HTML from `response.text`, binary data from `response.body`, and headers from `response.headers['content-type']`. Test error responses with `.expect(401)`, `.expect(403)`, `.expect(409)`, etc.; do not turn failures into skips or relax assertions to accommodate a regression.

## Required database regressions

The October 8 cleanup retires only unreachable implementations and exact
duplicates, not mandatory integration suites. Removed reporting tombstones and
disabled legacy admin PATCH operations are checked for absence; authorization
and shared report-rate-limit checks use the active report summary route. Current
versioned editors retain lifecycle, ownership, history, and transaction coverage.
See [the browser cleanup coverage map](UI_TESTING.md#october-8-production-candidate-cleanup)
for deliberately retired click paths and their complementary lower-layer tests.

The subsequent hardening pass addresses the active review findings:

- Business/Admin inboxes load on navigation, opening, explicit reload, and
  relevant mutations, not timers or window focus/visibility changes. Rendered
  regressions cover the shared conversations and both workspace shells. The
  existing Business access-recovery browser journeys use page refresh instead
  of focus to recheck bootstrap; their denial, protected-data, and session
  assertions remain unchanged.
  Business API-auth browser setup activates its page and waits for a successful
  bootstrap response matching the fresh session token before the unchanged
  visible-navigation assertion; it does not bypass real Business authorization.
- Report downloads and progress are scoped to an opaque session identity.
  Account/token changes and logout cancel pending requests, body reads, status
  waits, and file saves; late results cannot update another account. Same-session
  report navigation does not cancel preparation, and server jobs remain intact.
- Both report APIs and frontends share strict calendar-date validation, paired
  ordered dates, and a 366-calendar-day inclusive custom-range limit. Real HTTP
  regressions reject invalid ranges before report queries or export persistence
  and preserve timezone/DST end-day semantics.
- Reads sharing one PostgreSQL transaction client run serially, including
  Sequelize page count/rows. Tests guard invitation membership reads and real
  report/support transaction queries against overlap; independent pooled reads
  remain parallel. Do not suppress the pg concurrency deprecation warning.

Boost auction/ranking/billing, Premium subscription billing, and ticket transfer
remain unfinished features, not approved deletions. SMS backend and consent
storage also remain deliberately deferred.

Run `npm test` from the repository root, or `npm test --workspace @nitewide/api` for the API alone. The API runner first executes unit tests and mocked email tests, then runs required integration suites with bounded concurrency of two. Each suite receives its own disposable database. Coverage includes:

- `admissions-integration.test.js`: permission boundaries, QR integrity, concurrent admissions, reporting, and customer passes.
- `business-integration.test.js`: authentication, organization isolation, checkout, sales, event creation/editing, and guestlist approvals through the REST boundary.
- `business-reporting-integration.test.js`: deterministic Team, Overview, and Analytics reconciliation against real PostgreSQL queries and test-owned fixtures.
- `admin-onboarding-lifecycle-integration.test.js`: role/lifecycle protections, onboarding, scoped edits, retained history, and admin management filtering.
- `admin-business-access-integration.test.js`: secure accepted ownership, manager-led onboarding, finance permissions, concurrent ownership changes, last-owner guards, and generated business slugs.
- `admin-report-support-integration.test.js`: canonical admin drill-downs, non-duplicated order fees, support cases, platform attention, and shared fee/commission editing constraints.
- `venue-access-integration.test.js`: exclusive managed venue ownership, venue-specific roles, address/history protection, referral and invitation revocation/regrant, scoped reports/exports, and paged venue directories beyond 1,000 records.
- `public-discovery-integration.test.js`: discovery cursor stability, filters, ordering, deep links, and collections larger than the former 100-event limit.
- `customer-experience-integration.test.js`: customer identity confirmation, saved-event merging, guestlist state, attendee-only location privacy, and paged Connections/people results.
- `abuse-session-integration.test.js`: shared account/IP limits, session revocation, and isolated security workflows.
- `business-read-integration.test.js`: scoped business workspace and paginated read contracts.
- `referral-reactivation-integration.test.js`: restored roles, referral access, and outstanding invitation lifecycle checks.
- `mutation-concurrency-integration.test.js`: actual PostgreSQL authorization lock waits, both write/removal orderings, concurrent shared writes, invitation/audit/outbox rollback, and checkout cart conflicts without duplicate inventory or credentials.
- `report-export-integration.test.js`: 1,205 events, 24,001 paid orders and 12,001 buyers; reconciled SQL totals, EXPLAIN ANALYZE/BUFFERS diagnostics, immediate and background CSVs, concurrent purchases, access revocation, expiry, checkpoint retries and competing workers. It creates only test-owned data in its disposable database.
- `notification-worker-integration.test.js`: durable fan-out, leases, atomic checkpoints, access/preference rechecks, retries and competing workers.
- `email-worker-integration.test.js`: leased outbox claims, mocked bounded delivery, retry visibility and graceful stop without provider sends.
- `media-storage-integration.test.js`: normalized uploads, finalization, lifecycle permissions and orphan cleanup using mock/local storage.
- `production-diagnostics-integration.test.js`: real database timeouts, readiness, request/query metrics and sanitized HTTP failures.
- `api-domain-contract-integration.test.js`: executable response contracts and shared lifecycle/authorization rules across legacy and domain routes.

See [API contract](API_CONTRACT.md) for adding domain operations and regenerating schemas, and [API diagnostics](API_DIAGNOSTICS.md) for error codes, operational metrics and timeout configuration. Unit regressions cover malformed JSON, oversized requests, unsupported operations and bounded API/worker shutdown. Contract and database regressions are part of the existing CI gate, not optional live-deployment tests.

There is no opt-in flag for these suites. Each receives its own generated `nitewide_test_<UUID>` database on a PostgreSQL/PostGIS server. The runner migrates only that database, executes its suite, then drops that exact generated database. It does not seed, migrate, or inspect development/demo application data. Integration files reject direct execution without the runner's managed database URL and marker. Interrupting the runner stops its child process group and performs the same generated-database cleanup.

The local default uses the project's loopback PostgreSQL service on port 5433. If `.env` specifies that known local endpoint, only its server credentials are reused and the connection is changed to the `postgres` maintenance database. The caller's ambient `DATABASE_URL` is never used as the test target. Otherwise the local Docker default is `postgres`/`postgres` on port 5433. Start the project's PostGIS service before testing, or set `TEST_DATABASE_ADMIN_URL` explicitly to a loopback test PostgreSQL/PostGIS server's `postgres` maintenance database. The role needs `CREATE DATABASE` and permission to apply the PostGIS migrations. CI supplies its ephemeral PostgreSQL service on port 5432 through this variable. Remote server URLs are rejected. Missing prerequisites cause a failing test command with setup guidance, not skipped integration coverage.

Every test subprocess runs with `NODE_ENV=test`, blank Resend credentials, `RESEND_TEST_MODE=false`, and business guestlist review emails disabled. These explicit values prevent dotenv from reloading local provider credentials. Mocked email tests remain included; the standard and demo-only commands do not consume Resend quota or send live email.

### Reporting performance and snapshot regression

Run `npm run test:api:integration -- --suite report-export-integration.test.js` for the representative SQL/export suite. Its `REPORT_PLAN` diagnostics include execution/planning times, buffers, temporary spill blocks, JIT time and expensive plan nodes. Timing is diagnostic, not a brittle CI pass/fail threshold. See [Reporting and exports](REPORTING_EXPORTS.md) for the measured baseline, migration, worker lifecycle and rollup decision.

The following five suites validate demo imports, seed composition, and seeded venue fixtures. They are excluded from the standard unit batch and production CI coverage:

- `orlando-seed-integration.test.js`
- `posh-importer-integration.test.js`
- `seed-cleanup-integration.test.js`
- `seed-guestlists-integration.test.js`
- `venue-selection-integration.test.js`

Run them explicitly with `npm run test:demo` after preparing a dedicated, non-production database named `nitewide_demo_test` or `nitewide_demo_test_<name>` and setting `DEMO_TEST_DATABASE_URL` to it. The command enables only these existing demo checks, disables email delivery, and never creates, migrates, or seeds that database automatically. It rejects development/production application database names. Existing demo seed/import utilities remain available for deliberately preparing such fixtures; standard tests do not invoke them.
