# Automated browser testing

Playwright exercises the customer, business, and rebuilt admin apps through real browser interactions, API routes, authentication, migrations and PostgreSQL. `admin-rebuild.spec.cjs` and `admin-access-requests.spec.cjs` cover the current admin workflows; obsolete, previously unselected admin routes have been retired. External email is mocked; **zero Resend quota is consumed**. There are no live payments or SMS sends.

## Run locally

Use the Node/npm versions pinned in `.node-version` and `package.json`. Start Docker Desktop and the isolated PostgreSQL 18 test server, then:

```sh
npm ci
npx playwright install chromium webkit
npm run test:db:up
export TEST_DATABASE_ADMIN_URL='postgres://postgres:isolated-pg18-password@127.0.0.1:5434/postgres'
npm run test:e2e
unset TEST_DATABASE_ADMIN_URL
npm run test:db:down
```

Linux needs browser system dependencies: `npx playwright install --with-deps chromium webkit`.

Keep `TEST_DATABASE_ADMIN_URL` set while running any focused browser commands
below against PostgreSQL 18. CI uses the same major version. This separate server
does not upgrade or share the development database; see
[database test setup](TESTING.md#postgresql-18-release-tests).

The runner builds all apps with isolated settings and `NODE_ENV=production` before testing, so Vite selects production React and optimized bundles. Only the disposable API/database harness uses `NODE_ENV=test`; provider credentials remain cleared in both environments. You do not need to start the normal local apps; they can continue running separately.

```sh
npm run test:e2e -- --project=customer-iphone
npm run test:e2e -- --project=business-iphone --grep "QR photo"
npm run test:e2e:headed -- --project=business-desktop
npm run test:e2e:ui
npm run test:e2e:report
```

`npm test` remains the complete unit/API/component suite, including all required database suites and non-quota-consuming mocked email checks. `npm run test:e2e` is the browser suite. Simulated email commands remain explicit opt-ins and are not called by either suite or CI.

### Feedback without weakening release verification

```sh
npm run test:quick
npm run test:affected -- --dry-run
npm run test:affected -- --base origin/main
npm run test:release
npm run test:e2e -- --list
```

- `test:quick` runs all frontend unit/component tests and API unit tests, with provider credentials blank and no database provisioning. It is feedback, not a release gate.
- `test:affected` includes staged, unstaged and untracked files, plus the requested Git merge-base comparison. It prints its selection. Spec-only edits select their configured projects on both devices; frontend test edits run that app's complete unit/component suite. Frontend source currently has cyclic cross-app imports, so source changes select all three frontend suites and all six browser projects. Unknown/shared/API/schema/configuration/deployment changes, Git discovery failures and CI fall back to `test:release`. `--dry-run` executes no verification.
- `test:release` runs complete `npm test`, then an unfiltered browser suite with fresh production builds. It accepts no coverage filters. Use this before committing/releasing; CI still requires every matrix lane and image check.
- Browser `--list` skips builds and database/server startup, uses only its console reporter, and keeps inventory timings separate so it cannot replace successful HTML/JUnit/attempt reports with an all-skipped listing. Targeted local allowlisted projects may reuse builds only when source/shared files, build environment/runtime and compiled outputs match their fingerprints. Missing/changed evidence rebuilds. Do not run another frontend build concurrently against the same `dist` directories; normal development servers can run separately. A full browser run and every CI run rebuild all three served apps regardless of local markers.

API database execution creates one new empty `template0`-derived database per invocation, applies every checked-in migration exactly once, verifies migration metadata plus PostGIS/pgcrypto, closes source sessions and disables new connections before cloning. Each mandatory suite receives its own unique clean clone; no application rows or sessions are shared. Two suites run concurrently by default, bounded to 1–2 via `node apps/api/scripts/run-tests.cjs --integration --concurrency 1`. Each required child must execute nonzero tests with zero skips, cancellations or todo cases. Demo seed suites remain separate explicit opt-ins. On the verified macOS/Linux harness, shutdown tracks child process groups, stops them before database cleanup and retains a generated database if its process group cannot be safely stopped; Windows process-tree cleanup is not verified.

Browser tests stay at one worker per database. Named fixture recipes reset the entire owned dataset before each real-data journey: auth-only cases get one actor/no commerce, ordinary commerce gets four actors/one event/one order, and admissions gets a genuine second event/QR credential. Pagination/export recipes deliberately keep the larger 14-event/12-order or 25-team-member datasets. Operator scenarios preserve credited/uncredited sales and party allocations without reseeding the same dataset twice. Unknown recipes fail; legacy full fixtures remain available. Worker shutdown and request/query drain still precede every reset.

Pure pricing-editor boundary tests additionally cover invalid currency, fee mode, integer/range constraints and unavailable pricing, including structured error codes/field indexes. These fast variants do not replace browser permission, payment-state, responsive-layout or interaction assertions.

### Optional query-plan profiling

```sh
npm run test:api:plans
```

This command runs the complete reporting/export integration suite in a fresh managed loopback database, including the representative 1,205-event, 24,001-order and 12,001-customer dataset. It additionally emits PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` diagnostics for summary, customer and event queries, plus a JIT-disabled summary comparison. Provider credentials and ambient application database URLs are blocked. It accepts no filters.

Ordinary CI still reconciles the full-scale totals and final event page, freezes export snapshots under concurrent purchases and name changes, and checks quotas, authorization revocation, expiry, interrupted rendering, worker contention and durable retries. Only repeated plan/timing diagnostics moved out of the default gate: their former sole assertion was nonnegative execution time, not a performance threshold or index-use guarantee. Run the profiling command when changing reporting SQL/indexes or investigating performance; it does not replace the mandatory regression suite.

## Isolation and safety

- Fixed loopback ports: API 14100; customer 15173; business 15174; admin 15175. These cannot be redirected to Render or production through CLI/environment overrides.
- A new database named `nitewide_test_<32 hex characters>` is created, migrated and seeded for each run. Tests using the real-data fixture reset that database, with one worker to avoid cross-test mutations; fully mocked UI cases do not request an unnecessary reset. The harness stops its worker and drains unfinished HTTP/database work before resetting. The database is removed on normal completion or interruption.
- The only configurable database connection is `TEST_DATABASE_ADMIN_URL`, which must point to the loopback server's `/postgres` maintenance database with database-creation rights. Locally the helper reads only loopback credentials on port 5433 from `.env`; it never reuses the existing application database.
- The fixtures contain only invented accounts, relative future event dates, bookings and allocations. The fake password is `NitewideDemo!2026`; no real credentials are stored in tests.
- All Resend credentials are cleared before builds and startup. Only the external email boundary is mocked. Browser requests to non-loopback hosts are blocked; the harness worker has no live provider credentials.
- The test-only reset endpoints are guarded, localhost-bound and exist only in `e2e/server.cjs`. The entire harness and artifacts are excluded from the Docker image. Never import the harness into production code.
- The runner rejects custom config, output, worker-count, full-parallel and repeat-count overrides. Per-worker databases are needed before increasing concurrency. Do not run concurrent codegen/test runners on the same fixed ports. Existing servers are never reused.
- After a force-kill or machine crash, a generated test database may remain. Inspect its exact name and active connections before removing only that database. Never point cleanup at a development or hosted database.

## Browser and workflow coverage

Customer, business, and rebuilt admin each run in two projects: **iPhone 13 / WebKit**, the mobile-first target, and **desktop Chromium**. Admin desktop uses a 1440 × 900 viewport and iPhone uses 390 × 844. All use America/New_York and reduced motion to make timezone/rendering assertions repeatable. Run both `admin-rebuild-iphone` and `admin-rebuild-desktop` for every admin UI change; inspect grid placement, readable hierarchy, compact artwork, reachable actions, and horizontal overflow as well as functional outcomes. See [Admin responsive design standard](ADMIN_FRONTEND.md) for the durable UI review requirements.

Customer workflows cover sign-in/session persistence, registration/password confirmation, recoverable auth errors, event deep links, Maps links, saving/reloading, booking pagination, guestlist passes, notification navigation/dismissal/clear-all, pending-request edits/withdrawal, and demo VIP checkout with individual admission passes.

Business workflows cover navigation/URL cleanup, chart switching, backend team pagination, manager referrals/personal-pool invitations, explicit analytics search, drill-down, full CSV export, manual admissions, customer admission status, real QR-photo decoding for valid/fake/wrong-event/repeat codes, promoter access and offering-editor interactions.

`business-access.spec.cjs` exercises approved-only sign-in, customer/session denial, public request submission and the invitation authentication exception. `admin-access-requests.spec.cjs` exercises manual review, approval and review permission/error states. Negative UI cases use controlled API responses; a real-API approval case on each viewport verifies that queuing the invitation does not grant access before acceptance. Required API/database integration tests separately verify actual new-account and existing-account acceptance. Both browser specs run on iPhone/WebKit and desktop/Chromium with disposable requests and mocked delivery; none of these tests dispatch real email or consume sending quota.

Business startup regressions deliberately fail a production workspace module download and inject a route-render failure in both WebKit and Chromium. The eagerly loaded recovery screen must stay visible, retain the current URL and stored session, hide private error details, and reload only when requested. Chromium verifies recovery after a transient module failure. The tested WebKit build can retain a failed module across reloads: its regression verifies that the retry remains safe and the recovery screen stays usable, not that reload always restores the workspace. Persistent failure includes guidance to reopen the browser and, if necessary, sign in again. These do not replace API-error handling: an ordinary rejected request must not destroy a healthy sign-in form or erase a typed password. A static startup message remains in the HTML if JavaScript cannot boot at all.

Offline HTTP tests also enforce the hosted release cache policy: entry HTML is `no-store`, fingerprinted JavaScript/CSS is immutable, unversioned assets revalidate, and missing assets return an uncached 404 rather than an application HTML document. The browser recovery screen cannot restore an unavailable server; it gives a safe path to retry after the connection or deployment recovers.

Active admin rebuild specs cover directory/navigation state, capability boundaries, onboarding, audited edits, scoped venues and venue teams, support cases, analytics drill-downs and complete exports, and compact event artwork/layout. The real admin identity journey also covers customer access denial, retryable failed logout and session revocation. Removed legacy lifecycle paths were not part of the active browser gate; required API lifecycle/history tests remain, but are not equivalent rebuilt-interface UI coverage.

The private Nitewide support journey verifies real requester intake, Admin replies, case linkage/resolution, private internal notes and unverified guest capability access on both devices. Existing Customer footer and Business entry/workspace journeys additionally exercise the quiet footer links, signed-out recovery after reload and Business issue submission. Shared interaction tests cover stable uncertain-send retries, token/session changes, unread acknowledgment and guest secrets confined to fragment recovery links. Required API/database tests enforce record scope, staff reply permissions, lifecycle/rate limits and private recovery-token checks; no real email or provider calls are used.

These are real interaction regressions, not screenshots-only checks or mocked API response snapshots. Extend the suite whenever a fixed bug or stable repeated workflow warrants coverage. It is not exhaustive coverage of every control.

### Consolidate customer journeys, not safety coverage

Feature-only tests use `loginViaApi()` to create a fresh session through the real sign-in endpoint after their database reset, then open the relevant app or event directly. Customer setup waits for the browser's authenticated `/auth/me` response and verifies the user identity; it does not require a background header to be accessible while a modal is open. The shared-event regression explicitly checks that modal accessibility isolation remains intact. Business setup uses the approved-access Business endpoint. Storage is seeded once on an empty, loopback-only document: there is no persistent initialization script or shared saved token that can resurrect a revoked session after reload, logout or password rotation. UI sign-in, registration, password changes, logout, access denial, invitation acceptance and startup recovery continue to exercise their own browser flows.

The initial customer-core consolidation used **19 journeys per browser, down from 30**, eliminating 11 repeated browser contexts/setups and 11 fixture resets per device. Related states share one authenticated customer/cart and use named `test.step()` sections for diagnostics. Every journey still runs in both desktop Chromium and iPhone WebKit; test timeouts remain 45 seconds. Independent permission boundaries and unrelated actors remain isolated in customer-operations and API/database tests. The later removal pass below reduces core to 18 without changing device coverage.

| Previously separate workflows | Consolidated coverage |
| --- | --- |
| Contact save, incorrect password, successful password rotation | Profile lifecycle: unchanged layout, failed-session preservation, cleared secrets, old-token revocation, contact/preferences persistence |
| Invalid login, valid login/reload, failed logout, revoke-all | Same sign-in/session journey, with two real tokens verified revoked and no session restored on reload |
| Booking pagination, guestlist QR, exact notification passes | Booking journey validates page two, correct guestlist party, both exact admission destinations and individual dismissal |
| Pending demo status, lost-response retry | One committed order: pending checks retain its original key and never repost, then retry retrieves its exact passes |
| Payment review, server-status recovery | Same sandbox attempt: Pay enters review, reload preserves it without passes/payment controls, then server verification opens exact passes without preparing again |
| Cancelled/refunded saved attempts | Two named terminal-state steps share auth/configuration; neither replays automatically and each explicit new purchase gets a distinct key |
| Secure-form loading, uncertain/confirmed cancellation | Same form: no Pay while loading; an uncertain cancellation keeps the key, a confirmed one retires it |
| Rejected cart/new key, successful VIP purchase | One revised real demo purchase produces six individual passes and exactly one asynchronous receipt notification |

Lost-response **reload** remains distinct from manual **retry**, because automatic recovery while the public event is unavailable is a different boundary. Clear-all notifications, pending-guest withdrawal, unavailable payment configuration, abandoned-checkout reminders/resumption and one-click retirement remain explicit cases. `checkout-attempt.test.js` additionally covers pending-before-submission (zero order POSTs) and review returned by lookup, initial preparation or known-order resumption. `payment-form-interactions.test.js` retains provider failures, verified-payment preflight, wallet/card behavior, iframe loading, double-submit locking and lost-verification responses. API/database payment and authorization coverage is unchanged.

Do not share database/session state between tests, turn these into order-dependent mega-tests, or silence flaky failures to improve timings. Export progress mocks stay in rendering until the progress assertion explicitly releases completion, while component tests exercise stale-list and lifecycle races deterministically.

### Apply the same journey model across apps

The broader regression audit consolidates related **browser** workflows, not independent unit/API policy cases. Each journey owns a fresh context and its own fixture reset where real data is needed. Named `test.step()` sections retain actionable trace/report boundaries; state never crosses test cases. Every journey continues to run on both iPhone WebKit and desktop Chromium with the unchanged 45-second timeout.

| Selected cases per device, including intentional app-specific skips | Before journey cleanup | After customer-core cleanup | After all-app cleanup |
| --- | ---: | ---: | ---: |
| Customer | 43 | 32 | 29 |
| Business | 48 | 48 | 33 |
| Admin | 39 | 39 | 24 |
| Total across both devices | 260 | 238 | 172 |

The all-app pass removes another 66 primary browser contexts/setup paths beyond the customer-core pass, for **88 fewer overall**. Final discovery selects **166 runnable cases plus the same six cross-app skips**. My events is 10→7 journeys per device; Business core/access/payments is 26/8/11→16/7/7; admin rebuild/access review is 27/12→16/8. The shared Messages/commissions file remains three cases with its existing app-specific selection boundaries. This is a reduction in repeated setup, not a reason to remove distinct safety outcomes.

| Area | Shared journey and retained boundaries |
| --- | --- |
| Admin shell | Non-default navigation requested during delayed session verification, every workspace, responsive header actions and branding; rejected verification remains separate |
| Admin records and toolbars | Submitted People search/status filters, page-two audited edit, scoped roles/invitations and return context; toolbar geometry/status/sorting checked on every supported surface |
| Admin event and support views | Compact artwork, bounded accessible preview, missing-image fallback and reduced motion; support search, uniquely labeled references, audited creation and resolution |
| Admin access review | Needs-attention entry, editable review, unavailable delivery, stale version refresh and renewed authority; decline, reviewed-elsewhere, denied roles and real no-access-before-acceptance remain independent |
| Business workspace and profile | Real UI entry/navigation, chart switching and team paging; incorrect password, secret clearing, token rotation and retryable server-side logout |
| Business analytics and admissions | Readable chart labels/tooltips, explicit drill-down/reset and full CSV; fake/wrong-event/valid/repeated QR scans plus a separate manual guest credential and its customer check-in state |
| Business payments | Shared sandbox routing, hosted setup/readiness and merchant selection lifecycles; disconnect retains unresolved obligations, reversible disable, active-account disconnection and stable retry identity |
| Customer My events | Manager directory/history/search, clipboard fallback/retry, unchanged guest approval and revoked-access cleanup; customer-only denial, promoter scope, past restrictions, quantity adjustment and anonymous passes/revocation stay separate |
| Messages and commissions | Real two-app conversation, exact reply/read notification and no email; approved payment retry and audited fee-review/residual approval remain separate because their starting financial states differ |

Permission actors, startup asset failures, checkout uncertainty/reload, commission recipient readiness and background export progress/download remain explicit boundaries. Keep progress held until its assertion releases completion; do not consume a download wait budget during job preparation. Mobile-only controls and desktop geometry are still asserted, not replaced by a generic viewport smoke test. Admin screenshots now live in per-test artifact directories and are attached to the report rather than written to a global temporary path.

The full unit/API run also exposed a nondeterministic checkout fixture: its mock personal verification could be timestamped after checkout captured the current time, correctly failing the production future-evidence guard. That fixture now injects one deterministic clock for the event, checkout and verification evidence. Future/stale verification policy tests remain unchanged; no production eligibility rule was relaxed.

### Remove duplicate tests and unnecessary work

The follow-up removal pass selects **170 browser cases: 164 runnable and the same six cross-app skips**, down from 172. Customer and admin remain 29 and 24 selected cases per device; Business becomes 32. It removes one duplicated owner/promoter sign-in case, not either role's distinct behavior. No browser timeout, retry, device, payment policy or required integration suite was removed.

| Removed or shortened work | Retained coverage |
| --- | --- |
| Separate approved owner/promoter Business sign-in case | Owner UI sign-in and Create event in the workspace journey; actual logout/revocation in profile; promoter UI sign-in, personal Overview, no Create event and assigned admissions in one promoter journey |
| Three identical Overview→Events cycles | One genuine summary request held explicitly while navigation leaves the loading view, then a successful clean Overview return; deterministic timing replaces probabilistic repetition |
| Extra admin login-page boot, duplicate first guest pass assertion, extra past-event boot | Existing branded login form is submitted; the pass loop still checks all four passes; past-event sign-in opens its original deep link directly and retains both API denial checks |
| Eight previously unselected legacy admin tests | Current customer denial, retryable failed logout and two-session revoke-all checks moved into the active real admin journey; rebuilt navigation, People editing and organization-manager onboarding remain active. Required API lifecycle/history checks remain; retired legacy suspend/archive UI paths are not claimed as rebuilt UI coverage |
| Business profile/decline/reactivation source scans | Actual profile journey and rendered guestlist review. Keep request now explicitly proves zero decision POSTs and restored approval controls before confirmed decline; revocation, reapproval, admitted and denied states remain |
| Decorative CSS/JSX contracts | Exact gradients, shadows, icon colors and one timeline glow are deliberately no longer pinned. Premium entitlement/visibility, contrast, focus, touch targets, QR readability, safe areas, zoom and reduced-motion/transparency fallbacks remain; there is no claim of equivalent pixel coverage |
| Customer appearance test setup | Noir and mobile guards share `appearance.test.js`; two action/icon dimension cases are folded into its existing accessibility case with their assertions intact |
| Five API unit file workers | All 11 cases and 385 assertion sites in the affected files are retained: pricing boundaries→pricing-editor-policy; build freshness/routing/collision audit→feedback-runners/runner-safety/runner-execution; organization slug→management-domain; historical price replay→checkout-service; seed venue policy→posh-importer |

The unit changes remove six separate cases (four source/decorative scans and two folded appearance cases) and six Node file workers, without reducing the financial boundary sweep, email quota isolation or any of the 31 mandatory database suites. Related assertions share domain setup; unrelated actors and payment starting states still stay isolated. These changes primarily reduce maintenance and duplicate operations. Compare measured complete-run timings before claiming another CI speed improvement.

Pre-existing coverage gaps identified during retirement: rebuilt suspend/restore confirmation UI and the exact paid-order archive/retention scenario do not yet have active browser equivalents. The latter also has no exact matching current API test; broader financial history/cleanup policies are not a substitute. These paths were already unselected, so deleting the obsolete file does not reduce the running gate, but future lifecycle work should cover them explicitly.

### Reduce repeated workflows and expensive setup

The next pass selects **156 browser cases: 150 runnable plus the unchanged six cross-app skips**, versus 170/164 before it. Customer/Business/admin each retain both devices, with 28/28/22 selections per device. Seven standalone journeys were removed; their meaningful outcomes survive in these named journeys or stronger lower-layer checks:

| Removed work | Survivor and preserved boundary |
| --- | --- |
| Customer and Business multi-route password-eye tours | Real sign-in journeys retain geometry, keyboard toggling and zero accidental submit requests; the shared rendered `password-input.test.js` retains ref, attributes, independent confirmation visibility, focus, FormData and disabled controls. Individual parent-route eye tours are not claimed as retained browser coverage |
| Separate zero-commission editor/invitation flow and Manage tiers flow | Promoter invitation journey retains disabled rates, real zero-value PUT/POST, renewal/old-token rejection, recipient acceptance and every existing/new offering control without saving editor changes |
| Separate referral clipboard refusal boot | Personal-invitation journey retains the fully selected read-only fallback and no false success before restoring gesture-sensitive copying; four anonymous passes, repeated copy and subsequent form recovery remain. Separate My events/database expiry and revocation boundaries are unchanged |
| Mocked manager onboarding and repeated approval 503/409 wizard steps | Real Admin Needs-attention→approval journey submits manager/finance/no-venue data, validates authority and retains pending acceptance/no ownership/no membership. Rendered approval/decline tests retain exact failures, drafts, version refresh and request payloads; the reviewed-elsewhere browser conflict remains separate |
| Five Customer landing source cases | Existing browser brand/footer navigation, appearance 44px close-target assertion and Discover/date bindings in `discovery-week.test.js`. Exact landing copy, gradients, spacing, icon syntax and ornamental placement expectations are deliberately removed, not equivalent pixel coverage |
| Two Business referral/pool source cases | Rendered referral retry/revision/pool-refresh journey, additionally strengthened with the 401 unauthorized callback |
| Duplicate API health/discovery cases and the isolated My events role unit | Health wire-schema/service identity and merged discovery-filter assertions; real Customer/Business read-only and operations permission boundaries in mandatory My events/admin access database suites |
| Six identical OpenAPI model/router builds | One read-only artifact shared across all five contract cases; negative undocumented-route registration still uses a separate router |

Frontend counts are **37 admin, 209 Business and 180 Customer cases** (426 total), down from 433. API unit counts are **607**, down from 610. Financial, webhook, refund, retry, authorization, quantity and lifecycle policy variants are not removed simply to lower counts.

The standalone direct manual-onboarding submission is no longer exercised in a browser. Its shared wizard and submission payload remain covered by rendered Admin interactions and mandatory API onboarding tests; the real browser approval journey covers manager/no-venue/finance review and deferred access. Those are complementary layers, not identical click paths.

Related frontend cases now share only their Vite transformation server: payment accounts 3→1 startups, event people 3→1, guestlist review 4→1, account screens 3→1, Overview attention 2→1, and pure event-template helpers 3→0. This eliminates **13 of 18 startups** and three Business file workers. Each case still owns fresh JSDOM, rendered roots, requests, mocks and restored globals; an `after` hook closes the shared server even following assertion failure. Pure helpers use existing esbuild and the actual Business helper module, not a new production execution path.

Business-read integration keeps a full 503-event owner traversal with unique stable ordering. Manager, employee and suspended-former-owner/promoter roles compare exact first/final IDs, totals, page/hasMore and management/edit permissions; independent scope, own-sales sorting, aggregates and attention remain. Twelve duplicate intermediate-page requests and six repeated schema-invalid requests are removed. All 31 required database suites remain active; optional query-plan profiling is described above.

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

`.github/workflows/demo-image.yml` runs unit/API tests, four browser jobs, and the cached production image build in parallel. Each browser job runs both iPhone and desktop against its own ephemeral PostgreSQL service:

| Job | Selected specs |
| --- | --- |
| `customer-core` | `customer.spec.cjs` |
| `business-core` | Business projects: `business.spec.cjs` |
| `business-operations` | Business projects: access, payments and Messages/commissions; Customer projects: My events and Messages |
| `platform-operations` | Admin projects: both rebuilt-admin specs |

All six active projects remain required; the `verify` gate fails unless every matrix job and the unit/build jobs pass. A Node regression checks that every configured device/spec pair appears exactly once across the four jobs. No image is published and no Render request is made before that gate passes. Browser tests remain single-worker within each job; separate jobs never share a database.

Each browser job pulls `mcr.microsoft.com/playwright:v1.63.0-noble`, which already contains browsers and Linux dependencies. It does not run `playwright install --with-deps` or download Ubuntu packages. `e2e/ci-container.cjs --check` rejects an image version that differs from the installed `@playwright/test` version. `PLAYWRIGHT_PROJECT_GROUP` accepts the four job names above and the retained complete-app/old customer-operations aliases; each selects fixed allowlisted projects/specs. Mixed lanes execute only each project's configured specs, not a cross-product of unrelated app workflows. Omitting the group retains the complete local-equivalent suite. When upgrading Playwright, update both the lockfile and `PLAYWRIGHT_CONTAINER_IMAGE` in the workflow. The Linux container mounts the checked-out repository and the exact Node/npm installation from `setup-node`, preserving Node 24.21.0 and npm 12.1.0 rather than using the image's bundled runtime. Host networking keeps the database and app URLs on loopback; provider credentials are not forwarded.

Browser image pulls and npm dependency installation have five-minute step limits; browser execution has ten minutes. The browser job has a fifteen-minute overall limit, and the unit/API job has ten minutes. These limits fail a stalled prerequisite without bypassing tests. A registry or runner outage can still fail setup; inspect the affected step before rerunning. The initial 5–10 minute verification/publication target is an engineering goal, not a measured guarantee, and excludes Render startup.

The production image is built once, exported as a Docker archive, smoke-checked for Linux/amd64, non-root execution and required app files, and retained as `demo-image` for one day. After verification, publication verifies the archive checksum, loads and pushes that same image; it never rebuilds. BuildKit uses the GitHub Actions layer cache. The Playwright image and test harness remain excluded from the deployable image.

New commits cancel superseded unit, browser and build jobs for the same Git ref. Publication and deployment jobs use separate non-cancelling queues. Both check the current remote `main` SHA before proceeding, so an older completed verification cannot intentionally release a superseded commit. Once a deployment request starts it is not cancelled by a new push. The Render hook has bounded connection/request timeouts and is not automatically retried, since an uncertain response might already have triggered a deployment.

CI retries failures once for diagnosis and also fails on recovered flaky tests. Each job stops after **three tests exhaust their retries** to bound cascading setup failures; the job is failed, not successful with reduced coverage, and publication/deployment stay blocked. Local runs have no failure budget so all diagnostics can be collected. Available reports/JUnit XML are retained as separate `playwright-results-<job>` artifacts for 14 days after success or failure, except cancelled jobs; screenshots, videos and traces are kept on failures. All test mutations remain disposable. Review flaky results and remove their underlying race rather than increasing retries.

Performance collectors save redacted phase measurements in ignored `.test-metrics/`, outside Playwright's cleared output directory. They cover dependency/browser installation, migration, database cloning/cleanup, fixture seeding/reset, worker stop/start, request drain, fresh authentication/bootstrap/readiness, builds and per-journey durations. Reports contain static file/line, project/recipe and status labels—not credentials, user data, request bodies or provider responses. Counts include retries; overlapping/nested totals must not be added together as wall time. CI writes a step summary and uploads metrics for 14 days on success/failure; `node scripts/report-test-timings.cjs` prints local reports. CI bootstrap timing works before node_modules is installed. Complete release verification retains API and browser reports under the same run ID.

### Timing baseline and tradeoffs

The October 2 audit of [successful run 57](https://github.com/Demesheo/nitewide/actions/runs/37061577114) measured customer/browser execution at 444 seconds (504-second job), Business at 301 seconds (370-second job), admin at 182 seconds (245-second job), and unit/API execution at 197 seconds. Customer iPhone cases accounted for 335 seconds versus 94.7 seconds on desktop. Frontend builds took only 2.6–2.8 seconds per browser job, so sharing build artifacts is not the priority.

The subsequent [run 59, attempt 2](https://github.com/Demesheo/nitewide/actions/runs/37080571560/attempts/2) passed the current pre-refactor set: 82 customer, 94 Business and 78 admin cases, with six existing cross-app skips. Its browser execution steps took 443, 320 and 117 seconds respectively (job totals 512, 389 and 177 seconds); unit/API execution took 201 seconds. This confirms the customer bottleneck and also shows runner timing variability. Attempt 1 failed on a recovered iPhone export flake; a green rerun does not resolve that race.

The two customer file partitions held approximately 294 and 136 seconds of browser work in that baseline. Splitting only that lane adds one runner's setup cost (about 60–70 seconds in that run) while lowering the parallel critical path; this improves wall-clock feedback, not necessarily total billed runner minutes. Fresh API setup also reduces repeated browser maneuvers. Pre-consolidation discovery included 260 cases (254 runnable plus six existing cross-app skips), versus 246 passes in run 57. All permissions, payment, mobile and desktop scenarios remain required.

That earlier implementation verification passed all 254 runnable browser cases, the full `npm test` command (including all 31 required isolated database suites), and a fresh-build export rerun on both browsers. Independent discovery confirmed that the four CI partitions selected all 260 cases exactly once. Local runs use the repository's sequential all-app runner, not four separate CI runners; their wall time is not a comparable CI speed benchmark.

[Run 37086894673](https://github.com/Demesheo/nitewide/actions/runs/37086894673/job/111098963880) then exposed a customer-core setup race on Linux Chromium: eight failures and two recovered flakes waited for a header profile button that the already-open event modal correctly hid from the accessibility tree. Customer-core's job took 533 seconds; repeated ten-second waits and retries accounted for a substantial portion, not checkout execution. All 30 iPhone cases passed, and the other browser partitions passed; publication/deployment were blocked.

The October 3 customer-core consolidation fixed that readiness check and reduced core from 60 to **38 device-specific executions** (19 journeys on each browser). At that point full discovery selected **238 cases: 232 runnable plus six existing cross-app skips**. The consolidated core passed locally with CI retries/flaky rejection enabled in 1.4 minutes of Playwright wall time. This is a local check, not a prediction of Linux CI duration; measure the next hosted run before claiming CI speed savings. The coverage mapping above records which repeated workflows were combined and which edge variants have fast lower-layer checks.

That customer-core-only verification passed **all 232 runnable browser cases**, with the six existing cross-app skips and no failures or flakes, across all six projects with `CI=true`. The sequential all-app local run took 8.1 minutes; it is not the four-job CI critical path. The complete `npm test` command also passed, including all 31 required isolated database suites and customer/business/admin component tests. The CI configuration/isolation regressions passed separately with CI mode enabled.

The subsequent all-app consolidation passed **all 166 runnable browser cases**, with the same six cross-app skips and no failures or recovered flakes, across all six projects with `CI=true`. Its sequential local JUnit wall time was **390.6 seconds (6.5 minutes)** versus 486.2 seconds (8.1 minutes) for the customer-core-only baseline: **19.7% shorter**. This comparison measures the additional all-app consolidation, not the whole 260→172 reduction or the parallel Linux CI critical path. Measure the next hosted run before claiming CI speed savings.

Independent cross-agent coverage reviews retained non-default admin navigation during verification, payment-review controls hidden before and after reload, and overflow checks while expanded customer password/review views are still open. These state-specific checks must not migrate to a later read-only or successful-payment state during future consolidation. The full unit/API/component command passed again, including all 31 required isolated database suites; the 13 CI configuration/isolation regressions also passed with CI mode enabled. No production payment, eligibility or authorization rule changed.

The final customer review-control and expanded-form overflow assertions were added while the all-app run was already underway, then verified separately on both browsers: all four targeted executions passed without retries in 20.2 seconds. Local verification and its timing baseline used the bundled Node 24.19.0/npm 11.5.1 runtime. Node satisfies the engine range, but npm is below the repository's npm 12 minimum; this does not verify the pinned Node 24.21.0/npm 12.1.0 Linux CI environment. That hosted run remains the release gate.

Known separate follow-up: `report-client.js` still emits global progress without session identity and does not cancel an already-running automatic export download when the account changes. The current fix scopes list responses and retries, clears component state on session removal, and retains server-side download authorization; it does not resolve that pre-existing client continuation lifecycle. Add explicit account-switch cancellation/scoping tests when addressing it.

The next optimization pass verified the complete `test:release` command: all **31 mandatory database suites** and **166 browser cases** passed, with the same six intentional cross-app skips and no recovered flakes. API measurements confirmed one empty-database migration and 31 distinct clones at bounded concurrency two. The sequential local browser JUnit wall time was **355.9 seconds (5.9 minutes)** versus 390.6 seconds (6.5 minutes) immediately before lean fixtures: **8.9% shorter**, or 26.8% shorter than the 486.2-second customer-core-only baseline. The API runner took 127.5 seconds locally; this is not comparable to the earlier Linux job's 201 seconds. Exact CLI inventory confirmed the four balanced CI lanes select 38/32/34/68 cases, totaling every device/journey pair once. No additional CI runners or removed safety scenarios account for the change.

Independent review added pre-install bootstrap and malformed-cache regressions; complete final offline verification passed 610 API unit tests and 37/215/187 admin/business/customer tests. A real SIGTERM check interrupted a fresh template/two-clone invocation, exited 143, removed all three owned databases and left pre-existing databases untouched. Actual browser listing selected 172 cases without builds/server startup. A targeted real admin sign-in passed once after rebuilding all apps and again with all three unchanged isolated builds reused; full/CI runs never use this shortcut. Local verification still used Node 24.19.0/npm 11.5.1, not the pinned Linux Node 24.21.0/npm 12.1.0. Hosted CI and actual parallel-lane speed remain unverified until these changes are pushed.

The duplicate-removal pass then passed the complete `CI=true npm run test:release` gate: **610 API unit tests, 37/211/185 admin/business/customer tests, all 31 mandatory isolated database suites, and 164 browser cases**. The same six cross-app selections skipped intentionally; there were no failures or recovered flakes. The restored admin denial/logout/revoke-all steps and deterministic pending-report navigation passed on both browsers. Sequential local JUnit time was **351.9 seconds (5.9 minutes)** versus 355.9 seconds before this removal pass, a roughly 1.1% single-run difference that does not establish a meaningful CI speed gain. API runner time was 126.4 seconds with one migration and 31 clones. The benefit here is fewer duplicated cases/file workers and simpler maintenance; all four CI lanes and all six device projects remain required. Runtime versions and hosted-CI limitations above still apply.

The further workflow/setup reduction passed **two complete local `CI=true npm run test:release` runs**: 607 API units, 37/209/180 admin/Business/Customer tests, every one of the 31 mandatory database suites, and **150 browser passes with the same six intentional skips**. Neither run had failures or recovered flakes. Browser JUnit time was **331.1 and 337.0 seconds**, compared with 351.9 seconds before this pass: about **4–6% shorter**. Combined release Node/browser phases were 467.2 and 481.5 seconds versus 495.9 seconds (about **3–6% shorter**, 14–29 seconds saved). Node-phase time varied from 133.8 to 142.1 seconds versus 141.8; pure API units remained about 3.3 seconds. Fewer frontend startups and cases therefore do not establish a consistent standalone frontend/unit wall-time improvement. These local timings are not the parallel Linux CI critical path or a promised speedup.

The retained `test:api:plans` command also passed all seven reporting/export checks and emitted all four plan diagnostics against a new isolated database. Final actual CLI inventories selected **36/26/30/64** cases across customer-core/Business-core/Business-operations/platform-operations, covering all 156 selections exactly once. A discovered reporting issue was fixed: inventory commands previously overwrote successful reports with all-skipped listings. Console-only listing now rejects additional reporters, clears ambient reporter injection, and writes a separate inventory timing scope. After the final full gate, four real listings left the successful HTML, JUnit and all six full-run timing reports byte-for-byte unchanged. The expanded runner safeguard passed separately (11 cases); the unused onboarding password-tour helper was retired without changing the retained visibility helper. No production behavior changed. Pinned Linux runtime and hosted-CI verification still require the next pushed run.

```sh
npm run test:e2e:report
npx playwright show-trace test-results/<failed-test>/trace.zip
```

Review trace actions, DOM snapshots, requests and error screenshots. Never upload `.env`, authentication state from real accounts, or live application data as CI artifacts.

## Follow-up lane balancing and request setup

[Hosted run 61](https://github.com/Demesheo/nitewide/actions/runs/37143184834) verified the previous cleanup on the pinned Linux runtime: every job passed in 6m 2s, compared with 9m 30s for run 59's successful second attempt. Its platform-operations job took 5m, while business-operations took 2m 37s. The follow-up moves Customer My events and Customer Messages to business-operations, alongside Business access, payments and commissions; platform-operations now owns only Admin. The shared Messages spec remains in one lane for both apps. Actual CLI inventories select **36/26/50/44** cases, still every one of the same 156 journey/device selections exactly once, with no extra runners or concurrent database mutations.

Only repeated prerequisites changed. The Business adjusted-approval journey creates its five-spot pending request through the real customer API rather than replaying the Customer request form. Customer My events retains that complete form interaction on both devices: initial one spot, minus disabled, increase to five, plus disabled, touch sizing, server rejection of six, actual submission and pending state. Both review interfaces still adjust five to four through the UI, assert the submitted decision, and open the real Customer notification plus all four distinct QR passes. Promoter and past-event My events journeys use fresh API sign-in instead of repeating the sign-in form; their real role-scoped UI, unauthorized/past-event mutation rejection and independent sessions remain unchanged. Dedicated UI sign-in journeys remain active.

The complete local `CI=true npm run test:release` gate passed **607 API unit tests, 37/209/180 Admin/Business/Customer frontend tests, all 31 isolated database suites, and 150 browser cases plus the same six intentional skips**, with zero failures or recovered flakes. Sequential local browser JUnit time was 327.6s; this does not predict the parallel hosted lane timing. No production source, timeout, retry, assertion for the tested review outcomes, or payment/authorization release gate changed. The next pushed GitHub run will measure the lane improvement against run 61.

## Remaining manual verification

WebKit device emulation is not a physical iPhone. Native camera permission/optics, real-world door connectivity, Safari share sheets, actual email delivery, Stripe/payment processing and genuine Wallet/device integrations still require explicit targeted tests or manual device checks. Pixel-perfect visual baselines can be added later in a controlled OS/browser environment; current layout checks detect horizontal overflow without brittle platform-dependent screenshot comparisons.

References: [Playwright CI](https://playwright.dev/docs/ci), [locators](https://playwright.dev/docs/locators), [codegen](https://playwright.dev/docs/codegen), [web server lifecycle](https://playwright.dev/docs/test-webserver).
