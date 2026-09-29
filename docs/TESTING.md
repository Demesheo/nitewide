# Standard and demo-only tests

Run `npm test` from the repository root, or `npm test --workspace @nitewide/api` for the API alone. The API runner first executes unit tests and mocked email tests, then runs these five required integration suites serially:

- `admissions-integration.test.js`: permission boundaries, QR integrity, concurrent admissions, reporting, and customer passes.
- `business-integration.test.js`: authentication, organization isolation, checkout, sales, event creation/editing, and guestlist approvals through the REST boundary.
- `business-reporting-integration.test.js`: deterministic Team, Overview, and Analytics reconciliation against real PostgreSQL queries and test-owned fixtures.
- `admin-onboarding-lifecycle-integration.test.js`: role/lifecycle protections, onboarding, scoped edits, retained history, and admin management filtering.
- `public-discovery-integration.test.js`: discovery cursor stability, filters, ordering, deep links, and collections larger than the former 100-event limit.

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
