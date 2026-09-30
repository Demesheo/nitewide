# Environment secrets and database TLS

The API validates its configuration before opening an HTTP listener. Production, including the hosted demo, requires three explicitly configured, distinct secrets of at least 32 characters. Missing keys, the development defaults, example placeholders, and reusing one value for multiple purposes prevent startup. Secrets are server settings; never put them in a `VITE_*` variable, application UI, Git, an image build argument, or a Docker image.

| Variable | Purpose | Effect of changing it |
| --- | --- | --- |
| `AUTH_TOKEN_SECRET` | Signs customer, business, and admin sessions | Existing sessions must log in again; QR passes and queued email remain valid |
| `QR_TOKEN_SECRET` | Signs ticket and guestlist wallet passes | Previously displayed signed passes must be reopened to refresh; sessions and queued email remain valid |
| `EMAIL_ENCRYPTION_KEY` | Encrypts stored email template variables with AES-256-GCM | Retained encrypted outbox payloads need the original key or re-encryption; sessions and QR passes remain valid |

Signup verification, password reset, and invitation tokens remain randomly generated single-use tokens with hashes stored in the database. Resend API and webhook keys are separate provider credentials, not any of these three application keys. Use the same values across API/worker replicas within one environment, and different values across development, staging, and production.

## Local development

After copying `.env.example` to the repository root `.env` and installing dependencies:

```bash
npm run secrets:generate -- --env-file .env
```

This creates three independent 256-bit random values as 64-character hexadecimal strings, replaces development/example placeholders, and preserves other settings and already configured keys. Rerunning does not rotate those keys. It refuses duplicate assignments, reused keys, short existing keys, and environment files marked test/production. The file is restricted to its owner on macOS/Linux; use an equivalent private file ACL on Windows. Values are never printed by the command. `.env` is ignored by Git.

Restart the API after changing environment values. Keep local PostGIS on `DATABASE_SSL=false` unless you configure a local TLS server. Development/test have separate known defaults to support isolated offline fixtures, but initialization above replaces those defaults for your local application.

The initial development setup for this change generated all three keys in the root `.env`. The local outbox had no retained encrypted payloads, so no payload migration was needed. Previously loaded sessions and signed passes need a login/pass refresh after the API restart.

## New staging or production environment

Create a new file for each environment:

```bash
npm run secrets:generate -- --output .env.secrets.staging
npm run secrets:generate -- --output .env.secrets.production
```

The command writes a private file containing only the three assignments and refuses to overwrite an existing file. `.env.secrets*` files are ignored by Git and excluded from the Docker build context. Store each set in your password manager or secret manager, then install the values on that environment's API and email worker. Generating a file alone does not configure a deployment.

For Render, open the API web service → **Environment** → add `AUTH_TOKEN_SECRET`, `QR_TOKEN_SECRET`, and `EMAIL_ENCRYPTION_KEY` with the values from that environment's file. Add `NODE_ENV=production`, the service's `DATABASE_URL`, and `DATABASE_SSL=true`. Save the environment and redeploy. Repeat for a separate email worker if present. Do not place runtime keys in GitHub Actions build variables. Other container hosts should inject the same variable names through their runtime secret store or a private `--env-file` mounted outside the image.

For a new hosted demo Blueprint, `render.yaml` uses three separate `generateValue: true` entries so Render creates independent keys. An existing Render service must receive the two new variables before deploying this version; editing the repository template alone does not update a service created outside Blueprint management. Keep an existing strong session key when adding the two independent keys, provided no encrypted outbox payloads require migration. Generate fresh values for Render rather than reusing development keys.

On September 30, 2026, the existing `nitewide-demo` service received fresh, Render-only `QR_TOKEN_SECRET` and `EMAIL_ENCRYPTION_KEY` values while retaining its session key and other environment settings. Its email outbox contained zero records before the update; no encrypted payload migration or reseed was required. Reopen previously displayed passes after deploying the dedicated QR signer.

## Verified database TLS

Regular production (`NODE_ENV=production`, `HOSTED_DEMO=false`) requires an explicit PostgreSQL URL and `DATABASE_SSL=true`. The API, migration CLI (including `--env production`), and hosted bootstrap share one database configuration helper. TLS uses `rejectUnauthorized=true` and Node's default hostname validation. An untrusted/expired certificate or incorrect hostname fails the connection. Use the database provider's DNS hostname, not an IP address or alias absent from its certificate.

When the provider uses a public certificate authority, no custom CA setting is needed. When it supplies a private CA, use one of:

```dotenv
DATABASE_SSL=true
DATABASE_SSL_CA_FILE=/etc/secrets/database-ca.pem
```

Or set `DATABASE_SSL_CA` to the provider's PEM CA certificate/bundle in the service environment. Real multiline text and literal `\n` escapes are supported. Both CA variables together, malformed certificates, or a CA with TLS disabled fail configuration. On Render, upload the provider's CA as a secret file and use its mounted absolute path, or paste PEM into the environment variable. The CA must come from the database provider; never disable verification to resolve a certificate error.

Remove URL query options such as `sslmode=require`, `sslmode=no-verify`, `sslmode=disable`, `ssl`, `sslrootcert`, `sslcert`, `sslkey`, or `sslnegotiation`. These driver options can replace the explicit TLS object and are rejected. `sslmode=verify-full` is accepted and normalized away while retaining verified TLS. `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected when database TLS is enabled.

The explicitly isolated hosted demo (`HOSTED_DEMO=true`) retains its Render private-network plaintext database setting and local container smoke test. It still requires all three independent production secrets. This exception is for disposable demo infrastructure; regular production cannot opt out of TLS. If the demo uses a TLS endpoint, verification is enforced there too.

## Upgrading and rotating keys

Keep a secure copy of the existing environment keys and back up retained data before replacing keys. Restart all replicas together after updating a key; replicas with different session/QR keys cannot consistently validate one another's artifacts. Key changes are explicit operator actions; the generator never silently rotates an existing configured value.

To upgrade a deployment that previously used only `AUTH_TOKEN_SECRET`, plan for its existing signed passes and email queue:

- If the outbox has no retained encrypted payloads, keep the current session key and generate two new independent QR/email keys. Customers reopen their passes after deployment.
- If it has retained payloads, keep the old signing value as `EMAIL_ENCRYPTION_KEY` during the upgrade and generate new session and QR keys. This preserves payload decryption while requiring customers to log in and reopen passes. All three resulting values must be distinct, and none may be a development default.
- If the old signing value was a development default, first drain/clear eligible payloads with the old release or explicitly re-encrypt retained payloads under the new email key. The production validator will not accept that development value for any purpose. Do not discard retained payloads as an incidental step of deployment.

For later email-key rotation, pause enqueueing and the worker, then drain or re-encrypt retained encrypted rows using the old and new email keys before updating the runtime key. Changing the encryption key alone makes those old payloads unreadable. Reset/verification/invitation links should not be sent after their expiry; preserve those expiry values if re-encrypting. Keep Resend disabled during migration work. Session-key or QR-key rotation does not require touching the email outbox.

No database schema migration or reseed is required for this configuration change. Automated tests cover production defaults, missing/reused keys, TLS URL overrides, runtime/migration TLS settings, custom CA loading, and the independent effects of rotation. `npm test` uses mocked email delivery and isolated local test databases; it consumes no sending quota.
