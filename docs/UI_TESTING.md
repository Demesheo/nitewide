# Automated browser testing

Playwright exercises the customer, business, and rebuilt admin apps through real browser interactions, API routes, authentication, migrations and PostgreSQL. Legacy admin specs remain paused; `admin-rebuild.spec.cjs` covers the new workflows. External email is mocked; **zero Resend quota is consumed**. There are no live payments or SMS sends.

## Run locally

Use the Node/npm versions pinned in `.node-version` and `package.json`. Start Docker Desktop and the project's PostgreSQL service, then:

```sh
npm ci
npx playwright install chromium webkit
npm run test:e2e
```

Linux needs browser system dependencies: `npx playwright install --with-deps chromium webkit`.

The runner builds all apps with isolated settings and `NODE_ENV=production` before testing, so Vite selects production React and optimized bundles. Only the disposable API/database harness uses `NODE_ENV=test`; provider credentials remain cleared in both environments. You do not need to start the normal local apps; they can continue running separately.

```sh
npm run test:e2e -- --project=customer-iphone
npm run test:e2e -- --project=business-iphone --grep "QR photo"
npm run test:e2e:headed -- --project=business-desktop
npm run test:e2e:ui
npm run test:e2e:report
```

`npm test` remains the fast unit/API/component suite, including non-quota-consuming mocked email checks. `npm run test:e2e` is the browser suite. Run both before committing. Simulated email commands remain explicit opt-ins and are not called by either suite or CI.

## Isolation and safety

- Fixed loopback ports: API 14100; customer 15173; business 15174; admin 15175. These cannot be redirected to Render or production through CLI/environment overrides.
- A new database named `nitewide_test_<32 hex characters>` is created, migrated and seeded for each run. Each test resets that database, with one worker to avoid cross-test mutations. The harness drains unfinished HTTP/database work before resetting. It is removed on normal completion or interruption.
- The only configurable database connection is `TEST_DATABASE_ADMIN_URL`, which must point to the loopback server's `/postgres` maintenance database with database-creation rights. Locally the helper reads only loopback credentials on port 5433 from `.env`; it never reuses the existing application database.
- The fixtures contain only invented accounts, relative future event dates, bookings and allocations. The fake password is `NitewideDemo!2026`; no real credentials are stored in tests.
- All Resend credentials are cleared before builds and startup. Only the email-service boundary is mocked. Browser requests to non-loopback hosts are blocked. The harness has no email worker.
- The test-only reset endpoints are guarded, localhost-bound and exist only in `e2e/server.cjs`. The entire harness and artifacts are excluded from the Docker image. Never import the harness into production code.
- The runner rejects custom config, output, worker-count, full-parallel and repeat-count overrides. Per-worker databases are needed before increasing concurrency. Do not run concurrent codegen/test runners on the same fixed ports. Existing servers are never reused.
- After a force-kill or machine crash, a generated test database may remain. Inspect its exact name and active connections before removing only that database. Never point cleanup at a development or hosted database.

## Browser and workflow coverage

Customer, business, and rebuilt admin each run in two projects: **iPhone 13 / WebKit**, the mobile-first target, and **desktop Chromium**. Admin desktop uses a 1440 × 900 viewport and iPhone uses 390 × 844. All use America/New_York and reduced motion to make timezone/rendering assertions repeatable. Run both `admin-rebuild-iphone` and `admin-rebuild-desktop` for every admin UI change; inspect grid placement, readable hierarchy, compact artwork, reachable actions, and horizontal overflow as well as functional outcomes. See [Admin responsive design standard](ADMIN_FRONTEND.md) for the durable UI review requirements.

Customer workflows cover sign-in/session persistence, registration/password confirmation, recoverable auth errors, event deep links, Maps links, saving/reloading, booking pagination, guestlist passes, notification navigation/dismissal/clear-all, pending-request edits/withdrawal, and demo VIP checkout with individual admission passes.

Business workflows cover navigation/URL cleanup, chart switching, backend team pagination, manager referrals/personal-pool invitations, explicit analytics search, drill-down, full CSV export, manual admissions, customer admission status, real QR-photo decoding for valid/fake/wrong-event/repeat codes, promoter access and offering-editor interactions.

Business startup regressions deliberately fail a production workspace module download and inject a route-render failure in both WebKit and Chromium. The eagerly loaded recovery screen must stay visible, retain the current URL and stored session, hide private error details, and reload only when requested. Chromium verifies recovery after a transient module failure. The tested WebKit build can retain a failed module across reloads: its regression verifies that the retry remains safe and the recovery screen stays usable, not that reload always restores the workspace. Persistent failure includes guidance to reopen the browser and, if necessary, sign in again. These do not replace API-error handling: an ordinary rejected request must not destroy a healthy sign-in form or erase a typed password. A static startup message remains in the HTML if JavaScript cannot boot at all.

Offline HTTP tests also enforce the hosted release cache policy: entry HTML is `no-store`, fingerprinted JavaScript/CSS is immutable, unversioned assets revalidate, and missing assets return an uncached 404 rather than an application HTML document. The browser recovery screen cannot restore an unavailable server; it gives a safe path to retry after the connection or deployment recovers.

Active admin rebuild specs cover directory/navigation state, capability boundaries, onboarding, audited edits, scoped venues and venue teams, support cases, analytics drill-downs and complete exports, and compact event artwork/layout. Retained legacy specs are not a substitute for coverage of the rebuilt interface.

These are real interaction regressions, not screenshots-only checks or mocked API response snapshots. Extend the suite whenever a fixed bug or stable repeated workflow warrants coverage. It is not exhaustive coverage of every control.

## Selectors and HTML conventions

Prefer `getByRole` and `getByLabel` with exact accessible names. Scope repeated buttons to their card, table, dialog or pagination group. Stable `data-testid` attributes identify record/card surfaces where names are duplicated: `customer-event-card`, `customer-event-details`, `offering-editor`, `admission-credential`, `admin-record`. Record IDs are in `data-event-id`, `data-offering-id`, `data-credential-id` and `data-record-id`.

Forms/auth inputs have meaningful IDs/names; dynamic form controls use their existing field IDs as names. Report tables and pagination groups have accessible names. This improves accessibility and selector precision without changing visual styling. React `key` is not a DOM attribute or a browser selector: retain record-ID-based keys, never add arbitrary index keys to appease a test. Avoid styling-class locators unless a layout boundary lacks an appropriate semantic/test selector.

Use locator auto-waiting and assertions, never fixed sleeps. Wait for specific responses only when validating backend pagination or committed changes. Do not use `force: true` to bypass blocked UI. Assert persisted results and negative paths, not just clicks.

## Capture and improve a missing workflow

The safe codegen command builds and starts the same disposable environment:

```sh
npm run test:e2e:codegen -- customer
npm run test:e2e:codegen -- business
npm run test:e2e:codegen -- admin
```

It opens its **own WebKit window**, not your Chrome session, with iPhone dimensions. Codegen needs a visible desktop and is not run in CI. The Inspector records into ignored `test-results/codegen-<app>.spec.js`. Accounts are `jordan@playwright.nitewide.test`, `sam@playwright.nitewide.test`, and `admin@playwright.nitewide.test`. Close codegen normally to clean up the test servers/database.

Before adding a recording to `e2e/specs/<app>.spec.cjs`:

1. Replace the generated import with `const { test, expect, login } = require('../fixtures.cjs')` and request the `fixture` in every test. This ensures reset and network/error guards run.
2. Replace captured URLs, credentials, event dates/IDs and passes with fixture values; use the shared login/navigation helpers.
3. Remove setup duplication, index-based/long CSS locators, redundant actions and sleeps. Add accessible labels/test IDs only where useful to the actual interface.
4. Assert meaningful outcomes, persistence, authorization/errors, pagination and absence of runtime errors. Never retain real personal data, secrets or production mutations in recordings.
5. Run the affected iPhone and desktop projects, then `npm test` and the complete `npm run test:e2e` suite.

For agent-assisted browser work, use an owned Codex side tab when manual investigation is needed. When it reveals a repeatable regression not covered here, capture with this isolated codegen workflow or write the same clean fixture-based test directly. Do not treat a one-off exploratory action as automatic justification for permanent coverage.

## CI/CD and diagnostics

`.github/workflows/demo-image.yml` runs unit/API tests, all four active browser projects, and the cached production image build in three parallel jobs. The two test jobs have separate ephemeral PostgreSQL services. The `verify` gate fails unless all three jobs pass; no image is published and no Render request is made before that gate passes. Browser tests remain single-worker because each test resets its own job's database.

The browser job pulls `mcr.microsoft.com/playwright:v1.63.0-noble`, which already contains browsers and Linux dependencies. It does not run `playwright install --with-deps` or download Ubuntu packages. `e2e/ci-container.cjs --check` rejects an image version that differs from the installed `@playwright/test` version. When upgrading Playwright, update both the lockfile and `PLAYWRIGHT_CONTAINER_IMAGE` in the workflow. The Linux container mounts the checked-out repository and the exact Node/npm installation from `setup-node`, preserving Node 24.21.0 and npm 12.1.0 rather than using the image's bundled runtime. Host networking keeps the database and app URLs on loopback; provider credentials are not forwarded.

Browser image pulls and npm dependency installation have five-minute step limits; browser execution has six minutes. The browser job has a twelve-minute overall limit, and the unit/API job has ten minutes. These limits fail a stalled prerequisite without bypassing tests. A registry or runner outage can still fail setup; inspect the affected step before rerunning. The initial 5–10 minute verification/publication target is an engineering goal, not a measured guarantee, and excludes Render startup.

The production image is built once, exported as a Docker archive, smoke-checked for Linux/amd64, non-root execution and required app files, and retained as `demo-image` for one day. After verification, publication verifies the archive checksum, loads and pushes that same image; it never rebuilds. BuildKit uses the GitHub Actions layer cache. The Playwright image and test harness remain excluded from the deployable image.

New commits cancel superseded unit, browser and build jobs for the same Git ref. Publication and deployment jobs use separate non-cancelling queues. Both check the current remote `main` SHA before proceeding, so an older completed verification cannot intentionally release a superseded commit. Once a deployment request starts it is not cancelled by a new push. The Render hook has bounded connection/request timeouts and is not automatically retried, since an uncertain response might already have triggered a deployment.

CI retries failures once for diagnosis and also fails on recovered flaky tests. Available reports/JUnit XML are retained as `playwright-results` for 14 days after success or failure, except cancelled jobs; screenshots, videos and traces are kept on failures. All test mutations remain disposable. Review flaky results and remove their underlying race rather than increasing retries.

```sh
npm run test:e2e:report
npx playwright show-trace test-results/<failed-test>/trace.zip
```

Review trace actions, DOM snapshots, requests and error screenshots. Never upload `.env`, authentication state from real accounts, or live application data as CI artifacts.

## Remaining manual verification

WebKit device emulation is not a physical iPhone. Native camera permission/optics, real-world door connectivity, Safari share sheets, actual email delivery, Stripe/payment processing and genuine Wallet/device integrations still require explicit targeted tests or manual device checks. Pixel-perfect visual baselines can be added later in a controlled OS/browser environment; current layout checks detect horizontal overflow without brittle platform-dependent screenshot comparisons.

References: [Playwright CI](https://playwright.dev/docs/ci), [locators](https://playwright.dev/docs/locators), [codegen](https://playwright.dev/docs/codegen), [web server lifecycle](https://playwright.dev/docs/test-webserver).
