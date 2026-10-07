# First administrator setup

This is a one-time, operator-only setup for an **empty-admin staging or production
release**. It is not a recovery backdoor. It grants `platform_owner` (full internal
administration) to an existing active account. It does not create an account,
reset a password, verify an email, assign organization roles, seed demo data,
send email, call Stripe, or issue a session. No HTTP endpoint or startup hook
exposes it. Each environment needs its own separately approved setup.

## Before running

1. Deploy a CI-verified image containing `deploy/bootstrap-admin.cjs`; migrations
   must already have succeeded. Confirm the exact deployed full commit revision
   and the correct staging or production **web service**.
2. Obtain approval for the named person to hold full internal-admin access.
   Verify their identity and email ownership separately, outside the signup form.
   Merely registering an email address does not prove its ownership. Production
   also requires completed in-app email verification; the command refuses an
   unverified production account. Staging initially has no email delivery; use
   synthetic staging identities only. Never
   promote a public registrant based only on their name/email claim.
3. That person registers through the environment's normal customer signup with
   their own unique password. Existing accounts may be used. Do not put the
   password in chat, command arguments, environment variables, files or logs.
4. Open an interactive private terminal in the approved service (for example its
   Render Shell). Use the service's injected runtime settings, not a copied
   database URL or developer `.env`. Do not change the IP allowlist for this.

## Preview, then explicitly apply

Replace `<deployed-full-SHA>` and `<account-email>` below. The preview performs
only reads inside a PostgreSQL read-only transaction and prints the account ID,
name, email, version and email-verification state. Check all of them.

```sh
npm run admin:bootstrap -- --environment staging --expected-revision <deployed-full-SHA> --email <account-email>
```

Use the returned UUID, a recognizable operator label and the approved reason:

```sh
npm run admin:bootstrap -- --environment staging --expected-revision <deployed-full-SHA> --email <account-email> \
  --user-id <preview-UUID> --operator "<operator identity>" --reason "<approved setup reason>" --apply
```

The apply command prints a fresh preview, asks for the **existing account
password with input hidden**, then asks for a typed `PROMOTE staging <UUID>`
confirmation. Cancel with Ctrl+C. Piped input/non-interactive CI cannot apply.
Production uses `--environment production` on its approved production service;
never copy staging accounts or credentials into it.

The command checks the environment and immutable image revision before opening
a database connection. It rechecks the exact account, active state, version and
current password under the database-wide exclusive authorization lock. Concurrent
attempts cannot appoint multiple first admins. The grant, session revocation
and durable `platform.first_admin_bootstrapped` audit record commit together;
failure rolls all three back. The audit records the target, before/after access,
environment, revision, reason, password-check result and self-declared operator
label, **not** the password or an invented authenticated actor.

All existing target sessions are revoked. Sign in afresh at the admin app;
staging is `https://admin-staging.nitewide.com`. Check admin access and the audit
record. The password and existing organization memberships are unchanged.
An unverified email stays unverified. This command does not provide MFA;
privileged account security remains a separate launch gate.

## Retry and recovery

Any internal-admin account, even suspended/archived, blocks first-admin setup.
The durable audit marker also blocks it if that first account is later demoted.
There is intentionally no force, reset, reseed or "ignore existing admin" flag.

If a terminal disconnects or a response is lost, run the **read-only preview**
again. `ALREADY_BOOTSTRAPPED` indicates an earlier setup committed: verify the
target can sign in and inspect the durable audit through the existing admin or
an authorized operator's read-only database inspection. Do not regrant blindly,
delete the audit marker, or treat this refusal as proof the wrong target was
promoted. `ADMIN_EXISTS` means another admin already exists; use it instead.
Other failures can be retried only after checking the target/configuration.

If all admin access is lost, use a separately approved incident/recovery process
with identity verification, a backup, the exact existing account/privilege
change, session revocation and an audit record. Do not repurpose this command as
an unattended production recovery tool.
