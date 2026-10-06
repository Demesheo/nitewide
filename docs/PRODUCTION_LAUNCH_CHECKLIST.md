# Nitewide production launch checklist

Prepared October 2, 2026. Scope: Customer, Business, Admin, API, background workers, PostgreSQL, media, email, Stripe payments and commissions.

This is the master release checklist from production preparation through the first public launch. It records work to implement and safeguards to verify; existing code, a green CI run, or a healthy API does not by itself complete an item. All boxes are intentionally unchecked. For each completed item, record its owner, verification date, release commit or image digest, and supporting test result or operational evidence. Track unresolved work in linked issues without putting secrets or customer information here.

Creating this checklist does not authorize provisioning, DNS changes, secret rotation, database edits, real charges, provider sends, deployment, or enabling live payments. Perform those steps only within separately approved implementation and operational work.

## Launch blocking conditions

Do not enable paid production bookings while live-mode support, merchant routing, payment verification, refund recovery, or actual fee reconciliation remains unverified. Do not launch a release with broken authentication, missing entry assets, cross-account data access, unsafe guest passes, or no tested recovery procedure.

Current payment code intentionally supports disabled/test modes and rejects live keys. Production payments require implementation and review, not simply replacing `sk_test_` with `sk_live_`. A free-only launch is a separate explicit scope decision; free events, claims and guestlists must not depend on payment onboarding.

## 1 Establish the release scope and environments

- [ ] Confirm the launch scope, supported countries/currencies/payment methods, initial creator cohort, and which unfinished features will remain unavailable with honest UI messaging.
- [ ] Assign accountable owners for release approval, infrastructure, payment reconciliation, customer/business support, security incidents and recovery.
- [ ] Introduce the agreed staging/production branch and release process without automatically enabling payments. Define which checks and human approval permit promotion to production.
- [ ] Keep staging/test data, media access, runtime secrets, provider credentials and webhook destinations separate from production. The October 6 hosting decision selects paid Render staging with the same web/API, independent worker and PostgreSQL layout as production, but a 256 MB database and 1 GB storage budget. Use synthetic staging data and retain disposable CI; do not import dev/demo account bindings into production.
- [ ] Ensure regular production uses `NODE_ENV=production`, `HOSTED_DEMO=false`, production API/worker start commands rather than the demo bootstrap supervisor, no demo credentials or automatic reseeding, no test/reset endpoints, and no development identity-header shortcut. Bootstrap the first administrator through a controlled, audited process.
- [ ] Confirm the lean Render and Cloudflare architecture and recheck its pricing before provisioning. The recorded monthly bases are $34.50 production plus $20.30 staging, totaling $54.80 before taxes and usage additions, against a combined hosting budget below $60. Confirm included storage, budget headroom and the existing demo's disposition; a third paid stack is not included. These estimates are not invoice caps or capacity guarantees. Resolve whether the planned 200 monthly bookings are per creator or per event before sizing.

References: [Hosting decision](LAUNCH_HOSTING_PLAN.md), [environment security](ENVIRONMENT_SECURITY.md), [hosted demo boundaries](HOSTED_DEMO.md).

## 2 Configure infrastructure and secrets safely

- [ ] Prepare the selected production and staging stacks for separately authorized provisioning: each has an always-on paid web service and independently deployed worker, with a separate paid PostgreSQL 18 database matching the CI major version. Use 1 GB database RAM and 5 GB storage in production; 256 MB RAM and 1 GB storage in staging. Preserve the monorepo and shared frontend hosting. Verify non-demo startup and frontend serving before deployment; do not reuse the demo bootstrap/reseeding flow. Keep the existing PostgreSQL 16 dev/demo data unchanged until a separate backup-and-upgrade rehearsal is approved.
- [ ] Generate separate session-signing, QR-signing and email-encryption keys using the documented generator. Install matching values across API/worker instances within one environment; use different values between environments. Keep them out of Git, frontend variables, build arguments, logs and images.
- [ ] Verify certificate-checked database TLS from the API, worker and migration runner. Confirm missing secrets, reused/default keys, invalid certificates and insecure TLS overrides fail safely.
- [ ] Document secret ownership, secure backup, rotation and emergency revocation. Rehearse rotation without accidentally making retained email payloads unreadable or abandoning issued passes.
- [ ] Rehearse [separate app-domain routing](RENDER_RELEASE_SETUP.md#rehearse-separate-app-domains-on-staging) on staging. Configure explicit public HTTPS customer, business and admin URLs plus matching routing mode/CORS on API and worker. Test every landing page, sign-in page, authenticated workspace and deep link on the actual domains; do not assume localhost paths or origin-scoped sessions transfer to hosted domains. Verify provider callbacks/webhooks no longer target an unconfigured direct origin.
- [ ] Configure the Squarespace-registered domain, Cloudflare DNS and hosting certificates. Verify HTTPS, intended redirects, DNS recovery and all application/API/webhook hostnames before advertising them.
- [ ] Verify the actual proxy chain and `TRUST_PROXY_HOPS`; spoofed forwarding headers must not bypass shared account/IP limits. Confirm alternate origin access cannot defeat the intended ingress protections.
- [ ] Keep authenticated responses, checkout, inventory, admissions, private messages and sensitive passes out of shared/CDN caches. Test HTML/asset caching so a release cannot leave customers with missing modules or a blank sign-in page.

References: [Secret creation and TLS](ENVIRONMENT_SECURITY.md), [abuse controls](ABUSE_AND_SESSIONS.md), [frontend deployment tests](UI_TESTING.md).

## 3 Prevent payment configuration drift

This phase addresses the Render checkout failure: local configuration and merchant records did not automatically exist in Render's separate environment/database. `/health/ready` checks database availability and draining; it is not proof that Stripe checkout is usable.

- [ ] Verify the implemented [payment-specific release preflight](API_DIAGNOSTICS.md#payment-deployment-preflight) on the candidate deployment and make it an explicit promotion gate. Use `--require-paid --expect-revision <SHA>` when sandbox paid processing is intended; it checks runtime credential formats, separate secrets, URLs/CORS, schema, merchant routing and API/worker parity. Key-pair identity and actual destination/delivery verification remain separate evidence, not inferred from formats. Live support remains disabled.
- [ ] Validate the secret/publishable key pair against the intended Stripe environment, and validate separate `STRIPE_WEBHOOK_SECRET` and `STRIPE_ACCOUNT_WEBHOOK_SECRET` settings. Verify the reviewed API/SDK version and both deployed webhook routes.
- [ ] Compare effective API and worker payment configuration on the deployed revision. Do not assume a local `.env`, repository template, or successful environment save configured or restarted both runtimes.
- [ ] Remove `STRIPE_SANDBOX_SHARED_ACCOUNT_ID` from the relevant staging/production API and worker environments and restart both. The temporary merchant is `acct_1ULv5gFsihNvQfTU`; it must never become a production fallback.
- [ ] Verify every intended organization's default and event-specific merchant selection after removing shared routing, including multiple venues with separate accounts. Preserve original merchant snapshots on existing orders, retries, commissions and refunds; do not rewrite history.
- [ ] Keep server-verified capabilities and current lifecycle/access checks authoritative. Missing, stale, restricted, disconnected or wrongly scoped accounts must fail closed for paid operations, while free operations remain available.
- [ ] Make configuration failures understandable in Customer checkout and Business Payments: loading, unavailable, onboarding required and retry states must not look like an unresponsive button. Never substitute a mock success for a failed Stripe operation.
- [ ] Add separate payment-readiness diagnostics and alerts. Keep basic liveness/database readiness distinct so a Stripe outage does not unnecessarily take discovery, free claims and unrelated operations offline.

References: [Stripe configuration and merchant routing](STRIPE_CONNECT_PREPARATION.md), [health and diagnostic limits](API_DIAGNOSTICS.md).

## 4 Complete and prove paid checkout

- [ ] Implement and review explicit live-mode support across checkout, account synchronization, webhooks, refunds and commissions before installing live credentials. Verify test objects cannot satisfy live readiness or settle live orders, and vice versa.
- [ ] Preserve the agreed Stripe Connect Standard/full-Stripe-Dashboard experience and merchant-of-record/direct-charge model. Confirm the actual Accounts v2 configuration with Stripe; do not silently switch charge types to work around a limitation.
- [ ] Verify server-created Checkout Sessions use locked server prices, the intended connected merchant and `application_fee_amount`. Client-supplied payment status, browser redirects and webhook payload fields alone must never issue paid admissions.
- [ ] Reconcile actual Stripe processing-fee responsibility, application fees, merchant proceeds and Nitewide contribution. Resolve any disagreement between older fee descriptions and the connected account's provider-confirmed configuration; avoid double charging or assuming the model's estimates are actual settlement costs.
- [ ] Validate buyer-paid, business-absorbed and mixed carts, quantity limits, rounding, tax handling and supported payment-method costs. Enforce configuration constraints in Business/Admin editors, including the $10 absorbed-fee floor, without inventing unknown costs or unexpectedly rejecting otherwise valid purchases for a modeled margin target.
- [ ] Prove free offerings use a claim flow with no Stripe payment session, payment-information collection, service fee or commission. Mixed carts charge only their paid components.
- [ ] Run a controlled deployed sandbox purchase through a normally routed test business. Verify the exact charge, application fee, actual Stripe-to-application webhook delivery, order fulfillment and admission passes; a locally replayed signature or mocked CI response is not delivery evidence.
- [ ] Test declined cards, additional authentication, lost responses, double clicks, refresh/back navigation, abandoned purchases and provider timeouts. Preserve one attempt through retries, reject a changed cart with the same key, recover via the Pay button and prevent duplicate charges/admissions.
- [ ] Verify pending abandoned purchases appear as resumable notifications, not completed bookings; cancelled/expired attempts do not appear as bookings. Unknown provider outcomes must not prematurely release inventory or permit another charge.
- [ ] Verify Express wallets and cards on eligible real devices and production-equivalent HTTPS domains registered for each actual merchant. Test Apple Pay, Google Pay and Link availability, graceful card fallback, no separate Bank/Klarna choice, and no Pay button until the secure form is ready. Do not require an unavailable wallet to appear on every browser.
- [ ] Verify both signed webhook destinations handle duplicate/out-of-order events, account restriction/deauthorization, payment failure/expiry, refunds, disputes and commission invoices safely. Confirm processing/reconciliation can recover after API/worker restarts.
- [ ] Rehearse full and partial refunds through the original merchant, including lost responses and failed/pending refunds. Event cancellation must support the agreed full customer refund, including Nitewide's fee, with merchant approval or an audited administrative override.
- [ ] Validate dispute evidence, financial holds and recovery procedures without labeling a dispute as an invented refund or rewriting paid commissions. Define who monitors provider exceptions and how they are resolved.
- [ ] Rehearse safely stopping new paid checkouts without preventing recovery, refunds or access to existing verified passes. Approve a narrowly scoped real-payment smoke test only after the earlier gates pass; never run live charges as ordinary CI.

References: [Stripe implementation and recovery](STRIPE_CONNECT_PREPARATION.md), [fee model and limitations](FEE_POLICY.md), [pricing design](MARGIN_PROTECTED_PRICING_DESIGN.md). Stripe documents [separate event destinations and signature verification](https://docs.stripe.com/webhooks) and [mocked automated testing boundaries](https://docs.stripe.com/automated-testing); controlled provider checks supplement those tests.

## 5 Verify commissions and organizer support

- [ ] Validate the business-funded referral-payment use case with Stripe before enabling it live. Payments must go from the business's authorized funding method to the recipient's connected account, not from Nitewide's balance/application fee. Confirm authorization and any bank-payment mandate requirements for the chosen implementation.
- [ ] Require completed, freshly verified individual onboarding for commission eligibility. Business onboarding must not unlock a person's rate; unavailable recipients remain effectively at 0% without rewriting historical terms.
- [ ] Verify the business-set eligible paid-order minimum is at least $10, combined paid items can qualify, and taxes/service fees/free items are excluded from the basis. Changes must affect future attempts only.
- [ ] Verify event-end-plus-48-hours holds, explicit owner/finance-authorized approval, per-recipient statements, durable retries and no duplicate invoices or automatic residual debits.
- [ ] Test proportional unpaid-commission reductions for refunds, booking-specific dispute/request holds, invoice void/recovery and accurate net sales/commission analytics. Verify unrelated bookings are not held unnecessarily.
- [ ] Prove fee evidence and net receipt with actual sandbox provider records. Audited manual Invoicing-fee review must remain visibly merchant-reviewed, never provider-verified; residual amounts require separate approval. A Stripe balance credit must not be presented as a bank payout.
- [ ] Verify booking-linked Messages in Customer and Business, reply/unread state and current organizer access. Organizer contact must use in-app messages, not email; promoters and removed staff must not gain access to private customer conversations.
- [ ] Verify customers can submit refund/cancellation requests only before the event starts, that timely requests remain resolvable afterward without an organizer deadline, and that sending a request does not itself cancel passes or guarantee a refund.
- [ ] Have appropriate advisers review merchant/customer terms, cancellation/refund disclosures, dispute responsibilities, referral agreements, worker classification and tax-reporting requirements. App roles or a disclaimer must not be treated as proof of legal classification or eliminated liability.

Reference: [Commission execution and organizer conversations](STRIPE_CONNECT_PREPARATION.md#business-payments-workspace-and-individual-commissions).

## 6 Validate the full product experience

- [ ] Verify registration, email verification, password reset/change, password visibility controls, logout/revocation and suspension across all three apps. Failed requests must leave usable, accessible forms rather than a blank page.
- [ ] Verify Customer discovery, search, location/date/timezone handling, event flyers, offering selection, paid/free purchases, passes, notifications, Messages, profile, Connections and authorized My events workflows.
- [ ] Verify Business approved-only sign-in, Request access, Admin review and invite acceptance. Customer-only accounts must not enter Business; approved owners/managers can onboard organizations with zero, one or multiple venues.
- [ ] Verify Business creation/edit/publication/cancellation, venue naming/address/team assignment, independent event locations, Payments, guestlists, admissions and analytics. A venue must have one owning organization; old migration conflicts must be explicitly resolved before rollout.
- [ ] Verify role/access changes, removal and re-addition with the same or different role. Restored membership must work without stale removal flags; removed/suspended users must lose unauthorized capabilities, while financial and audit history remains intact.
- [ ] Verify accountless private guestlist invitations with name/personal/email/phone workflows and multiple spots, immediate approval when permitted/capacity exists, and one separate QR pass per spot. Keep copy-link controls in the intended details views and protect bearer links from logs and unnecessary exposure.
- [ ] Verify customer spot requests cap at five, authorized reviewers can adjust approval quantities in Customer/Business, and notification text, allocated capacity and issued pass count match the approved quantity. Test denial, withdrawal, revocation, expired links and event/organization/venue lifecycle rules.
- [ ] Verify mobile camera/manual admissions on physical devices, duplicate-scan handling, concurrent check-in and poor connectivity. Never show confirmed admission when the server cannot confirm it; document the door team's outage procedure.
- [ ] Verify Admin manual onboarding/review queues, business/venue/event/user drilldowns, granular audited edits, ownership changes, suspensions, finance views and customer/client issue resolution. Administrative alerts must be platform-specific, not copies of ordinary business reminders.
- [ ] Verify reporting totals, refunds/commission adjustments, scope isolation, readable chart labels, drilldown reset and customers/team views. Validate large export snapshots, progress/download/retry, expiry and access revocation during export.
- [ ] Check mobile and desktop layouts for every core workflow, including keyboard/focus behavior, accessible labels/contrast, touch targets, reduced motion, modal sizing, loading/empty/error states and no overflow or unexpected scroll jumps.
- [ ] Verify application icons, manifests/install behavior where supported, cross-app links, deep-link reloads, cache/update behavior and startup recovery on actual hosted URLs. Do not serve a stale offline checkout or claim an offline check-in succeeded.

References: [Customer](CUSTOMER_ACCOUNT.md), [Business](BUSINESS_FRONTEND.md), [Admin](ADMIN_REBUILD_PLAN.md), [guestlist](GUESTLIST_INVITES_NOTIFICATIONS.md), [admissions](ADMISSIONS.md), [reporting](REPORTING_EXPORTS.md).

## 7 Prove durable operations and security

- [ ] Verify the separately deployed worker uses the same approved revision/schema and runtime configuration as the API. Test stale-heartbeat alerts, lease recovery, bounded concurrency, retry visibility, audited replay and graceful termination within hosting deadlines.
- [ ] Verify notifications, payment/refund/commission recovery, transactional email and large exports continue after restarts without lost committed work or duplicate fulfillment. Check durable queues during a controlled provider outage.
- [ ] Configure production R2 storage with bucket-scoped credentials and verify finalized uploads/read access across instances. Copy and verify any required legacy local uploads before switching their database records; do not rely on ephemeral disk.
- [ ] Enable orphan cleanup only for safely isolated storage ownership. Preserve referenced/shared/rescheduled event assets and define the event-aware 30-day flyer-retention policy before implementing it; an upload-age bucket deletion rule is not sufficient.
- [ ] Configure and verify production transactional email sender authentication, runtime sending credentials, templates, signed delivery events and password/verification/invitation links. Conduct only separately authorized delivery checks; normal tests must consume no provider-send quota.
- [ ] Review authorization, cross-organization access, lifecycle checks, transaction lock ordering, concurrent removal/write races, object-level permissions and idempotency conflict handling across legacy and newer routes.
- [ ] Review dependency/image vulnerabilities, frontend XSS handling, upload validation, security headers, session storage and any CSRF protections required by the chosen authentication transport. Confirm logs, exports and diagnostics do not expose secrets, private financial details or bearer links.
- [ ] Tune and verify shared abuse limits against legitimate venue/shared-network traffic, malicious login/registration/invitation/upload/reporting traffic and database outages. Do not disable protections to fix proxy configuration mistakes.
- [ ] Approve data retention, privacy/access/deletion procedures and public terms with appropriate advisers. Preserve required financial/audit records and private-link safeguards; document support access and audit expectations.

References: [Workers](BACKGROUND_WORKERS.md), [media](MEDIA_STORAGE.md), [email](TRANSACTIONAL_EMAIL.md), [security](ENVIRONMENT_SECURITY.md), [sessions](ABUSE_AND_SESSIONS.md).

## 8 Measure capacity and rehearse recovery

- [ ] Load-test representative events, bookings, users and retention at the agreed creator scale, including peak simultaneous checkout, door scans, uploads, reporting and exports. Record latency/error budgets and measured resource usage rather than inferring capacity from creator count.
- [ ] Capture isolated paid-staging PostgreSQL query plans for representative report scopes, including rows/loops/buffers/spills, then verify production behavior in the controlled pre-launch phase. Measure pool saturation, lock waits, CPU/RAM, disk/index growth, queue backlog and export storage; add rollups or larger instances only when measurements justify them. Smaller staging resources can expose inefficiencies but do not prove production capacity or guarantee limits will never be reached. Keep targeted capacity checks separate from routine browser regressions.
- [ ] Budget the combined API/worker database connections and provider request rates. Set tested statement/lock/acquisition timeouts and queue bounds so reporting or exports cannot starve purchases/admissions.
- [ ] Configure external uptime and error/latency monitoring, storage/usage alerts, worker backlog/heartbeat alerts and payment/webhook reconciliation alerts. Persist useful metrics beyond process restarts without logging sensitive data.
- [ ] Define availability and recovery targets, incident contacts and customer-facing communications. The lean single-instance plan has no automatic redundant API/database failover and cannot promise 100% uptime.
- [ ] Configure database/media/secret recovery coverage and test restoring into an isolated environment. Record measured recovery time and acceptable data-loss limits, including queued jobs, immutable merchant snapshots and admission state.
- [ ] Rehearse failed migration, failed asset release, API/worker interruption and provider outage. Roll back application images/configuration compatibly with the schema; never reset/reseed production or erase provider-confirmed financial history to recover a deploy.

References: [Diagnostic metrics and deadlines](API_DIAGNOSTICS.md), [measured report plans](REPORTING_EXPORTS.md), [capacity assumptions](LAUNCH_HOSTING_PLAN.md#capacity-and-availability-assumptions).

## 9 Approve and launch the release

- [ ] Run required unit/API/database, response-contract and all active Customer/Business/Admin phone/desktop browser suites against the release candidate. Resolve failures/flakes and document coverage gaps; obsolete skipped specs are not proof the rebuilt workflow passed.
- [ ] Confirm `npm run api:contract:check` and the reviewed generated OpenAPI artifact match the deployed route behavior. Expand partial response schemas for critical payment/onboarding/client contracts where necessary.
- [ ] Promote the exact verified immutable image, with matching API and worker revisions. Keep production promotion explicitly approved; the current demo workflow is not automatically a production release process.
- [ ] Back up retained production data, apply reviewed migrations once through the approved runner, and verify the resulting schema before starting dependent runtimes. Rehearse this sequence on isolated paid staging without demo seeding; verify production's actual deployment sequence during the controlled pre-launch phase.
- [ ] Inspect actual deployed configuration, release identity, `/health/live`, `/health/ready`, payment-specific preflight, entry HTML/JavaScript/CSS, deep links and worker heartbeat. A Live badge or HTTP 200 for the homepage alone is insufficient.
- [ ] Record controlled sandbox and physical-device checks alongside CI evidence, including actual webhook delivery. Standard provider-mocked tests must stay isolated from production secrets/data and real charges/email.
- [ ] Obtain explicit product, security, operational and financial sign-off for the exact launch scope. Keep paid transactions disabled if their gates are not complete, even if a free-only launch is approved.
- [ ] Roll out to a small agreed creator cohort first, verify real support/admissions/financial operations, then expand toward the first 100 creators within measured capacity and support limits.
- [ ] Monitor the initial launch window with named coverage, agreed rollback thresholds and a reconciliation review. Confirm no duplicate charges, missing passes, unresolved provider mismatches, queue accumulation or critical mobile/desktop failures before widening access.

## Verification commands and evidence

The existing offline commands below are useful evidence inputs, not a substitute for testing deployed configuration. They use the documented disposable test setup and mocked external providers; do not run them against a production database.

```bash
npm ci
npm test
npm run api:contract:check
npm run build
npm run test:e2e
```

The opt-in `npm run test:stripe:sandbox` command performs provider operations and is separate from ordinary CI. Review [its safeguards and cleanup](STRIPE_CONNECT_PREPARATION.md#explicit-sandbox-tests-and-account-reuse) before an authorized run; its local event replay does not prove delivery to the deployed webhook destination. Email simulator commands also require explicit authorization and consume sends.

For final sign-off, record: release commit/image digest; API and worker revisions; migration state; environment/preflight result; CI and browser reports; provider/device checks; backup/restore and rollback evidence; unresolved exceptions; approvers; and launch/rollback decision. Store credentials, sensitive provider evidence and personal data in access-controlled systems, not this checklist.

References: [API testing](TESTING.md), [browser coverage and remaining manual checks](UI_TESTING.md), [executable API contract](API_CONTRACT.md).
