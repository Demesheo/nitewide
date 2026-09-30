# Standard and demo-only tests

## Node test runner and Supertest

API tests use Node's built-in `node:test` runner and `node:assert/strict`. Supertest is a pinned API development dependency, not a production dependency. HTTP regression tests exercise the actual Express routes, middleware, validation, status codes, response bodies, and headers; database integration suites run against migrated PostgreSQL/PostGIS with test-owned fixtures, not a mocked database.

Run these commands from the repository root:

| Command | Coverage | Database required |
| --- | --- | --- |
| `npm test` | All workspace unit/component tests, mocked email tests, and required API/database regressions | Yes |
| `npm run test:api` | API unit/mocked email tests and all required API/database regressions | Yes |
| `npm run test:api:unit` | API unit tests, mock-backed HTTP contracts, hosted routes, and mocked emails | No |
| `npm run test:api:integration` | All ten required isolated database suites | Yes |
| `npm run test:api:integration -- --suite admissions-integration.test.js` | One required database suite, with the same provisioning/cleanup protections | Yes |

Workspace equivalents are `npm run test:unit --workspace @nitewide/api` and `npm run test:integration --workspace @nitewide/api`. A focused suite must be one of the required filenames below; unknown options, conflicting modes, arbitrary paths, and demo-only filenames fail before connecting to PostgreSQL. The default `npm test` still runs every required suite; focused commands do not weaken CI coverage.

GitHub Actions already invokes `npm test` with an ephemeral PostGIS service. These Node/Supertest regressions run in the existing Unit and API tests job and gate image publication/deployment; no extra duplicate CI test job is needed. Playwright remains the separate customer/business browser regression layer. The standard commands above consume **zero email sends**; quota-consuming simulator commands remain explicitly separate.

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

Run `npm test` from the repository root, or `npm test --workspace @nitewide/api` for the API alone. The API runner first executes unit tests and mocked email tests, then runs these required integration suites serially:

- `admissions-integration.test.js`: permission boundaries, QR integrity, concurrent admissions, reporting, and customer passes.
- `business-integration.test.js`: authentication, organization isolation, checkout, sales, event creation/editing, and guestlist approvals through the REST boundary.
- `business-reporting-integration.test.js`: deterministic Team, Overview, and Analytics reconciliation against real PostgreSQL queries and test-owned fixtures.
- `admin-onboarding-lifecycle-integration.test.js`: role/lifecycle protections, onboarding, scoped edits, retained history, and admin management filtering.
- `public-discovery-integration.test.js`: discovery cursor stability, filters, ordering, deep links, and collections larger than the former 100-event limit.
- `customer-experience-integration.test.js`: customer identity confirmation, saved-event merging, guestlist state, attendee-only location privacy, and paged Connections/people results.
- `abuse-session-integration.test.js`: shared account/IP limits, session revocation, and isolated security workflows.
- `business-read-integration.test.js`: scoped business workspace and paginated read contracts.
- `referral-reactivation-integration.test.js`: restored roles, referral access, and outstanding invitation lifecycle checks.
- `mutation-concurrency-integration.test.js`: actual PostgreSQL authorization lock waits, both write/removal orderings, concurrent shared writes, invitation/audit/outbox rollback, and checkout cart conflicts without duplicate inventory or credentials.

There is no opt-in flag for these suites. Each receives its own generated `nitewide_test_<UUID>` database on a PostgreSQL/PostGIS server. The runner migrates only that database, executes its suite, then drops that exact generated database. It does not seed, migrate, or inspect development/demo application data. Integration files reject direct execution without the runner's managed database URL and marker. Interrupting the runner stops its child process group and performs the same generated-database cleanup.

The local default uses the project's loopback PostgreSQL service on port 5433. If `.env` specifies that known local endpoint, only its server credentials are reused and the connection is changed to the `postgres` maintenance database. The caller's ambient `DATABASE_URL` is never used as the test target. Otherwise the local Docker default is `postgres`/`postgres` on port 5433. Start the project's PostGIS service before testing, or set `TEST_DATABASE_ADMIN_URL` explicitly to a loopback test PostgreSQL/PostGIS server's `postgres` maintenance database. The role needs `CREATE DATABASE` and permission to apply the PostGIS migrations. CI supplies its ephemeral PostgreSQL service on port 5432 through this variable. Remote server URLs are rejected. Missing prerequisites cause a failing test command with setup guidance, not skipped integration coverage.

Every test subprocess runs with `NODE_ENV=test`, blank Resend credentials, `RESEND_TEST_MODE=false`, and business guestlist review emails disabled. These explicit values prevent dotenv from reloading local provider credentials. Mocked email tests remain included; the standard and demo-only commands do not consume Resend quota or send live email.

The following five suites validate demo imports, seed composition, and seeded venue fixtures. They are excluded from the standard unit batch and production CI coverage:

- `orlando-seed-integration.test.js`
- `posh-importer-integration.test.js`
- `seed-cleanup-integration.test.js`
- `seed-guestlists-integration.test.js`
- `venue-selection-integration.test.js`

Run them explicitly with `npm run test:demo` after preparing a dedicated, non-production database named `nitewide_demo_test` or `nitewide_demo_test_<name>` and setting `DEMO_TEST_DATABASE_URL` to it. The command enables only these existing demo checks, disables email delivery, and never creates, migrates, or seeds that database automatically. It rejects development/production application database names. Existing demo seed/import utilities remain available for deliberately preparing such fixtures; standard tests do not invoke them.
