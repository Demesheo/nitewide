# Automated browser testing

Playwright exercises the customer, business and admin apps through real browser interactions, API routes, authentication, migrations and PostgreSQL. External email is mocked; **zero Resend quota is consumed**. There are no live payments or SMS sends.

## Run locally

Use the Node/npm versions pinned in `.node-version` and `package.json`. Start Docker Desktop and the project's PostgreSQL service, then:

```sh
npm ci
npx playwright install chromium webkit
npm run test:e2e
```

Linux needs browser system dependencies: `npx playwright install --with-deps chromium webkit`.

The runner builds all apps with isolated settings before testing. You do not need to start the normal local apps; they can continue running separately.

```sh
npm run test:e2e -- --project=customer-iphone
npm run test:e2e -- --project=business-iphone --grep "QR photo"
npm run test:e2e:headed -- --project=admin-desktop
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

Each app runs in two projects: **iPhone 13 / WebKit**, the mobile-first target, and **desktop Chromium**. All use America/New_York and reduced motion to make timezone/rendering assertions repeatable.

Customer workflows cover sign-in/session persistence, registration/password confirmation, recoverable auth errors, event deep links, Maps links, saving/reloading, booking pagination, guestlist passes, notification navigation/dismissal/clear-all, pending-request edits/withdrawal, and demo VIP checkout with individual admission passes.

Business workflows cover navigation/URL cleanup, chart switching, backend team pagination, manager referrals/personal-pool invitations, explicit analytics search, drill-down, full CSV export, manual admissions, customer admission status, real QR-photo decoding for valid/fake/wrong-event/repeat codes, promoter access and offering-editor interactions.

Admin workflows cover mobile/desktop navigation, customer access denial, paginated user search, audited edits, suspension/restoration, event archiving, purchase-history retention and independent-creator onboarding with a mocked setup email.

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

`.github/workflows/demo-image.yml` runs unit/API tests, installs Chromium/WebKit with system dependencies, and runs every browser project before building/publishing the Docker image. Publishing depends on verification; Render deployment depends on publishing. A browser failure blocks publication/deployment. The runner itself builds the frontends, so a second standalone build step is unnecessary.

CI retries failures once for diagnosis and also fails on recovered flaky tests. Reports/JUnit XML are always retained as `playwright-results` for 14 days; screenshots, videos and traces are kept on failures. All test mutations remain disposable. Review flaky results and remove their underlying race rather than increasing retries.

```sh
npm run test:e2e:report
npx playwright show-trace test-results/<failed-test>/trace.zip
```

Review trace actions, DOM snapshots, requests and error screenshots. Never upload `.env`, authentication state from real accounts, or live application data as CI artifacts.

## Remaining manual verification

WebKit device emulation is not a physical iPhone. Native camera permission/optics, real-world door connectivity, Safari share sheets, actual email delivery, Stripe/payment processing and genuine Wallet/device integrations still require explicit targeted tests or manual device checks. Pixel-perfect visual baselines can be added later in a controlled OS/browser environment; current layout checks detect horizontal overflow without brittle platform-dependent screenshot comparisons.

References: [Playwright CI](https://playwright.dev/docs/ci), [locators](https://playwright.dev/docs/locators), [codegen](https://playwright.dev/docs/codegen), [web server lifecycle](https://playwright.dev/docs/test-webserver).
