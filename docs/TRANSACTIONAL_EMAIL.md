# Transactional email (Resend)

Nitewide sends account security, booking, guestlist, and event-change emails through published Resend templates. The Resend connector used to create templates is separate from the API's runtime credentials. Production delivery needs a sending-only API key and verified sender domain.

## Local development with Resend's simulator addresses

For local development before a domain is verified, set `RESEND_API_KEY`, `RESEND_FROM_EMAIL=Nitewide <onboarding@resend.dev>`, and `RESEND_TEST_MODE=true` in the Git-ignored root `.env`. Test mode is rejected outside `NODE_ENV=development`. It queues and drains mail **only** for Resend's documented simulator recipients, never for a real customer address or a seeded `@nitewide.test` address. It also blocks any previously queued non-simulator recipient when the worker starts. There is no automatic forwarding or redirection of real users' email.

The Nitewide live workflow test uses only `delivered+label@resend.dev` recipients. These are **recipient** addresses, not a sending domain or an inbox for reading the message. Resend records the delivery event in its Dashboard/API. Each simulator email still counts against the sending quota. Merely configuring test mode sends nothing; an application action involving an explicit simulator-address account is required. Do not use the simulator sender or test mode on Render or in production.

Source: [Resend's test-email guide](https://resend.com/docs/dashboard/emails/send-test-emails).

## Email test commands and quota safety

The four root commands have a consistent audience/mode naming scheme:

| Audience | Mocked, 0 sends | Simulated, quota-consuming |
|---|---|---|
| Customer | `npm run test:email:customer:mocked` | `npm run test:email:customer:simulated` (up to 11 sends) |
| Business | `npm run test:email:business:mocked` | `npm run test:email:business:simulated` (up to 14 sends) |

Both mocked suites live in `apps/api/email-tests/` and run automatically through `npm test`, including the GitHub build/deploy verification workflow. They use in-memory action fixtures and mocked provider requests. The Docker build only compiles the apps; it does not run tests or send email. Neither simulated command is called by `npm test`, `npm run build`, Docker, or deployment.

The root `npm test` runner blanks Resend credentials in every workspace test process; `dotenv` will not replace those values from a local `.env`. This protects quota even if an unrelated test starts an API instance. Use the root command for the normal test suite.

The mocked tests do **not** send messages or consume Resend quota. Keep all live-provider sends behind the separate simulated commands and simulator-recipient guards. Sending a test message through the running application is a separate, manual action; Resend counts it against the sending quota even when the recipient is a simulator address.

### Optional customer simulated delivery check (11 quota-counting sends)

**Quota cost:** `npm test` and both `:mocked` commands consume **0 email sends**. One complete `npm run test:email:customer:simulated` run sends **11 emails total**, all to uniquely labeled `delivered+...@resend.dev` addresses. This counts as **11 sends against the monthly quota** and **11 against the daily quota on a free plan**. Read-only preflight and event-polling API requests do not send additional emails. If the command fails after sending begins, **1–11 sends may already count**; check the printed message IDs and your Resend usage before rerunning. Each new successful run spends another 11 sends.

To retest only the guestlist-request email after a failure, use `npm run test:email:customer:simulated -- --only=guestlist-request`. It still runs all customer mocked checks and preflights the selected template, but submits **one** delivered-only simulator email and counts as **one** send. Do not rerun the full 11-send suite to check this single template.

After a partial run that already delivered the first four messages and the focused guestlist-request retry, `npm run test:email:customer:simulated -- --only=remaining` selects only the six previously unsent customer templates (guestlist decline/approval, event cancellation/time/venue changes, and attendee instructions). It consumes **six** sends if complete. This is a targeted continuation, not a replacement for a clean full-suite run.

The separate customer `:simulated` command runs the customer mocked suite first and stops if any test fails. It executes the same service actions as the app against isolated in-memory fixtures—no demo database mutation, real customer, or Stripe charge. Before sending, it verifies that all 11 distinct templates are queued exactly once, all recipients use `delivered+...@resend.dev`, the read API is accessible, and all 11 Resend templates are published with the required variables. If any preflight fails, it sends nothing. It then submits the queued templates through the production Resend adapter and polls `GET /emails/:id` until every message reports `last_event=delivered`, or fails with the message ID for inspection. This verifies Resend's provider-side events, not delivery to a real inbox or Nitewide webhook processing (a Resend webhook endpoint has not been implemented).

The command can use the existing `RESEND_API_KEY` if it has full access, as it does in the local development account. Alternatively, keep a sending-only `RESEND_API_KEY` and set a separate `RESEND_TEST_READ_API_KEY` with full access in the Git-ignored root `.env`. The read-access preflight fails before any send if the selected key lacks permission. Keep `NODE_ENV=development`, `RESEND_TEST_MODE=true`, and `RESEND_FROM_EMAIL=Nitewide <onboarding@resend.dev>`; the command refuses CI and hosted-demo environments. A full-access key is more powerful than a sending-only key: keep it local, never in GitHub Actions, Render, or a Vite variable. The command never accepts arbitrary recipients or a different sender. It checks **delivered only**; no bounce, complaint, or suppression states are tested.

| Application action in isolated fixture | Email template |
|---|---|
| Create customer account | Verification |
| Verify customer email | Welcome |
| Request password reset | Password reset |
| Complete demo checkout | Purchase receipt with ticket access |
| Submit guestlist request | Request received |
| Decline guestlist request | Declined |
| Approve the declined guestlist request | Approved |
| Cancel an event | Event cancelled |
| Change event start time significantly | Event time change |
| Change event venue | Event venue change |
| Send attendee instructions | Event instructions |

Waitlisted is excluded because that workflow is not active in the application.

### Business-app action emails

The business app adds eight published templates. The same outbox and role checks apply. Organization and event invitations queue email when delivery is configured; the UI retains a copyable private link when it is not. Guestlist reviewer email is opt-in through `BUSINESS_GUESTLIST_REVIEW_EMAILS=true` (default off); in-app reviewer notifications are unchanged. Business event-status notices go to active owners/managers and active event team members. Business emails contain role and event terms, not Nitewide's private fee income.

| Isolated business action | Template | Recipient |
|---|---|---|
| Invite an organization member | Team invitation | Invitee |
| Invite an event promoter | Promoter invitation | Invitee |
| Accept either invitation | Access accepted | Inviter |
| Change a member's role or remove them | Access changed | Affected member |
| Change event commission or guestlist allocation | Event terms changed | Affected member or promoter |
| Submit a guestlist request when reviewer email is enabled | Guestlist review needed | Authorized reviewer |
| Publish, cancel, or materially change time or venue | Business event status | Active event team |
| Send attendee instructions | Instructions sent | Sender |

`npm run test:email:business:mocked` covers these 14 action paths with in-memory fixtures and mocked delivery, using **0 quota**. It also runs during `npm test`. To explicitly verify provider delivery, run `npm run test:email:business:simulated`. A complete run sends **14** uniquely labeled `delivered+business-...@resend.dev` messages and consumes **14 monthly sends**, plus **14 daily sends on the free plan**. A partial run may consume **1–14 sends**. The runner executes the business mock suite first, verifies every action/message and all published templates before sending, refuses CI/hosted demo, and accepts no arbitrary recipient. It checks only `delivered`, never intentionally sends to other simulator states. Do not run it unless you intend to spend the quota. The customer 11-send command remains separate; running both successfully costs **25 sends**.

For a deployed API, set `BUSINESS_APP_URL` to the HTTPS business-app `/app` URL. The hosted single-origin demo derives it from `CUSTOMER_APP_URL`; local development defaults to `http://localhost:5174/app`. The invitation, event, and guestlist-review links open that app after authentication. `Instructions sent` reports **queued** recipients, not confirmed inbox delivery; a delivery webhook and dashboard are future work.

The simulated commands are not referenced by `npm test`, `npm run build`, Docker, or the GitHub/Render deployment pipeline. Resend's [simulator guide](https://resend.com/docs/dashboard/emails/send-test-emails) documents the addresses and quota accounting; the [usage limits](https://resend.com/docs/api-reference/rate-limit) explain daily and monthly quotas, and the [Retrieve Sent Email API](https://resend.com/docs/api-reference/emails/retrieve-email) documents `last_event`.

## Go-live checklist

1. Add a sending domain in Resend and complete its SPF, DKIM, and DMARC DNS setup. Check that the domain's status is **verified** before enabling delivery.
2. Create a **sending access** Resend API key. Keep it only in the server's local `.env` or Render secret environment variables, never in Vite variables, Git, a browser, or a Docker image.
3. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (for example, `Nitewide <tickets@mail.yourdomain.com>`), `CUSTOMER_APP_URL`, and `BUSINESS_APP_URL` (HTTPS origins in production), and ensure `RESEND_TEST_MODE=false`. Set all on each API deployment. If either Resend setting is missing, delivery is disabled; app actions still work, but email is not queued. Set `BUSINESS_GUESTLIST_REVIEW_EMAILS=true` only if reviewer inbox alerts are wanted.
4. Run `npm run db:migrate` before starting the API. The migration adds email verification timestamps, hashed one-time account tokens, and an encrypted email outbox.
5. Test against a controlled real inbox using a newly created account and a demo purchase. Verify the full path: signup → verification → welcome; password reset; purchase receipt → Booked → QR pass; guestlist request/decision; and event change. Do not use seed `@nitewide.test` addresses for delivery—they are intentionally suppressed.
6. In Resend, monitor sends, bounces, and complaints. Do not enable bulk event mail until the sender is verified and the target environment's `CUSTOMER_APP_URL` points at that same environment.

The outbox encrypts template variables at rest with a key derived from the dedicated `EMAIL_ENCRYPTION_KEY`, retries transient 429/5xx/network failures, and uses a stable Resend idempotency key. This key is separate from session and QR signing. Drain or re-encrypt retained outbox payloads before rotating the email key; rotating the session key no longer affects email decryption. See [environment setup and legacy-key upgrade](ENVIRONMENT_SECURITY.md). Password-reset links expire in one hour; verification links expire in 24 hours. Their tokens are hashed in the account-token table and consumed once. Already-sent outbox payloads are cleared.

The email worker runs in the API process every 15 seconds. On free Render hosting, sleeping services cannot drain email until they wake. For production, move this durable outbox to an always-on worker or job queue and add signed Resend delivery/bounce webhooks before promising delivery SLAs. A Resend API acceptance ID means *accepted for sending*, not delivered to an inbox.

## Published templates

| Alias | Trigger |
| --- | --- |
| `nitewide-verify-email` | New account or changed-email verification request |
| `nitewide-welcome` | Email successfully verified |
| `nitewide-password-reset` | Requested one-time password reset |
| `nitewide-purchase-receipt` | Each successful order, including demo bookings; links to Booked and the signed-in QR wallet |
| `nitewide-guestlist-received` | New pending guestlist request |
| `nitewide-guestlist-approved` | Approval or confirmed invitation |
| `nitewide-guestlist-declined` | Decline or revoked approval |
| `nitewide-guestlist-waitlisted` | Prepared, not triggered: the product has no waitlist state yet |
| `nitewide-event-cancelled` | A published booked event is cancelled |
| `nitewide-event-time-change` | Start or end time of a published booked event changes by at least 15 minutes |
| `nitewide-event-venue-change` | An editable independent event's venue address/name changes |
| `nitewide-event-instructions` | Manager explicitly sends instructions from Event details |

All event-update messages target distinct active customers with a paid order or pending/approved guestlist entry. They do not target unbooked followers. Purchase and guestlist messages link to the recipient's own authenticated booking; QR codes are generated after login, not attached to an email that can be forwarded.

Event cancellation and significant time edits in Business and Admin enqueue emails automatically when the event was already published. Organization venue addresses are centrally managed and are not editable in the event form; if a future organization-address editor is added, it must also enqueue the venue-change email. “Send attendee instructions” is an explicit managed-event action with confirmation language; it does not fire on every description edit. Waitlisted email is intentionally dormant until a real waitlist status and transition exist.

## API actions

- `POST /api/auth/password-reset/request` with `{ "email": "..." }` returns the same success response whether or not an account exists once email delivery is configured. Otherwise it returns `EMAIL_UNAVAILABLE` (503) rather than promising a link that cannot be sent. Requests are limited to three per account per hour.
- `POST /api/auth/password-reset/complete` with `{ "token": "...", "password": "..." }` consumes the link, changes the password, and invalidates earlier sessions.
- `POST /api/auth/email/verify` with `{ "token": "..." }` marks the current address verified and queues a welcome email.
- `POST /api/auth/email/resend` requires a signed-in account and is limited to three verification requests per hour.
- `POST /api/business/events/:eventId/instructions` requires event management permission and `{ "instructions": "..." }`; it queues one email per booked customer and returns a recipient count.

The sender domain, API key, template aliases, and customer URL are server-side only. Provider errors are stored by status/code without recipients or message bodies in logs.
