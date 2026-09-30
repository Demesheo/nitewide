# API abuse protection and session controls

The API applies shared PostgreSQL limits to authentication, invitations, image uploads, reporting, CSV exports, and session administration. Signed access tokens now reference a server-side session: logging out revokes access rather than merely removing browser storage. These controls apply to customer, business, and admin accounts. MFA is not implemented.

## Shared limits

Counters use atomic PostgreSQL upserts, not process-local memory. Every replica in an environment must use the same database and `AUTH_TOKEN_SECRET`. Limits reserve a slot before the expensive operation, include successful and failed attempts, and do not reset on successful login. Restarting an API process does not clear them. Email addresses are trimmed and lowercased; stored account, user, and IP identifiers are HMAC digests, not raw personal information. IPv4-mapped addresses normalize to IPv4; IPv6 addresses share a /64 network limit.

| Operation | Window | IP or IPv6 network | Account or signed-in user | Additional limit |
| --- | --- | --- | --- | --- |
| Login | 15 minutes | 60 | 30 per normalized email | 10 per email and network pair |
| Registration | 1 hour | 20 | 5 per normalized email | None |
| Password reset, email verification, onboarding acceptance | 1 hour | 30 | 5 per supplied email; authenticated resends 5 per user | Existing verification-email allowance also applies |
| Invitations, acceptance, resends, attendee instructions | 1 hour | 300 | 100 per authenticated user | Includes admin invitation creation |
| Image uploads | 1 hour | 120 | 40 per authenticated user | Runs before multipart parsing and image decoding |
| Reports, analytics, overview, operations, legacy workspace | 1 minute | 300 | 120 per authenticated user | All report routes share a bucket |
| CSV exports | 1 minute | 30 | 10 per authenticated user | Separate from normal reporting |
| Session administration | 1 minute | 120 | 30 per authenticated user | Shared across session list and revocation routes |

Each fixed window starts with its first request and expires independently. A blocked request receives HTTP `429`, a generic message, and a `Retry-After` header in seconds. Blocked requests do not prolong the window. A failed counter operation returns `503 SECURITY_UNAVAILABLE`; there is no unprotected in-memory fallback. Unknown accounts receive the same login error and password derivation work as known accounts.

The defaults are defined in `apps/api/src/services/abuse-service.js`. Tune them with real traffic measurements, particularly for shared venue networks. Account-wide login limits also introduce a temporary denial-of-service tradeoff: a distributed attacker can exhaust a known account's allowance. The account becomes usable again when its window expires; there is no permanent account lock or MFA requirement. Deploy edge filtering and connection/body-size limits as well: this application-level protection is not a substitute for DDoS protection.

Expired bucket and session rows are pruned in indexed batches of at most 1,000 each, no more than once per minute per process when protected API traffic arrives. Cleanup retains records until one day after their expiry and never resets live counters. No separate cache, Redis credentials, or queue worker is required for this implementation.

## Trusted proxy configuration

Direct deployments ignore `X-Forwarded-For` by default. Set `TRUST_PROXY_HOPS` only when a verified reverse-proxy topology requires it. Zero ignores forwarding headers; one trusts exactly one hop. The hosted Render demo defaults to one hop, preserving its existing configuration. Regular production does not automatically trust a proxy.

The public ingress must overwrite or safely append forwarding headers, and users must not be able to reach the API over a shorter alternate path. A hop count is unsafe if traffic can arrive through differing proxy chain lengths. Do not trust all headers or set an arbitrary hop count to make IPs appear correct. Verify the actual ingress configuration before deployment. Development Vite proxies share the loopback IP unless forwarding is explicitly and safely configured.

These policies follow Express's recommendation to protect authentication with combined account/IP controls and carefully configure proxy trust: [production security](https://expressjs.com/en/advanced/best-practice-security/) and [proxy configuration](https://expressjs.com/en/guide/behind-proxies.html).

## Session controls

Sessions expire after 12 hours; API requests check the session record, account lifecycle, and password version. There is no cached revocation grace period. A request already authorized before revocation can finish; later requests are denied.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/auth/sessions` | Lists the most recent 100 unexpired, unrevoked sessions with IDs, creation/expiry timestamps, and the current-session flag |
| `POST /api/auth/logout` | Revokes only the presenting session |
| `DELETE /api/auth/sessions/:sessionId` | Revokes a session belonging to the presenting user; never another user's session |
| `POST /api/auth/sessions/revoke-all` | Revokes every current session for the presenting user, including the caller, across all three apps |

These endpoints require a real bearer session; the local development identity header cannot administer sessions. Customer and business profile controls and admin navigation provide normal logout and **Sign out everywhere**. If revocation cannot reach the server, the UI keeps the session and displays an error so it does not falsely claim that server access was revoked.

Password changes and user suspension, archival, disabling, or pending-onboarding state revoke all sessions through database triggers, covering bulk updates and direct administrative writes. Restoring the account does not reactivate those old sessions; the user signs in again. Organization/venue role changes remain enforced by existing per-request permission checks; they do not globally log a user out of unrelated memberships. Session creation locks the user and credential rows, and logout-all locks the same user row to serialize against in-flight issuance. A genuinely new login after revocation can create a new session.

## Deployment and regression coverage

Apply the additive migration with `npm run db:migrate` before starting the updated API. It adds `auth_sessions`, `abuse_buckets`, their indexes, and revocation triggers. No reseed is needed, and no business records are removed. Existing stateless access tokens deliberately stop working after upgrade: users sign in once to obtain registered sessions. Rolling deployments must not keep old stateless API replicas serving traffic after the cutover.

`npm test` includes isolated real-PostgreSQL coverage for concurrent limits across two API instances, forwarded-header spoofing, expiry, session ownership, logout, logout-all, password changes, and suspension/reactivation. Unit tests cover normalization, policy selection, and fail-closed storage behavior. `npm run test:e2e` exercises the three apps on iPhone WebKit and desktop Chromium, including UI logout and server-side rejection of the revoked tokens. Both commands mock email delivery and consume zero Resend quota.
