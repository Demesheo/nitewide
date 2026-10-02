# Stripe Connect sandbox fixtures

`us-sandbox.json` contains a focused US test-data reference from [Stripe's Connect testing guide](https://docs.stripe.com/connect/testing), reviewed on October 1, 2026. It is not a copy of the whole guide. The `success.png` fixture is the Stripe test image supplied by the user, not a real identity document. Keep real identity, bank, login and API credentials out of this folder.

The user-approved base email is `test@nitewide.com`. Call `createStripeTestIdentity(scenario)` from `identity.cjs` once per test to generate `test+<scenario>-<New York date>-<random suffix>@nitewide.com`; reuse the result for that test's retries. These are test identities, not verification tokens. The Connect guide does not specify a magic approval email. Do not replace an existing user's Stripe login/contact email automatically or assume the mailbox/plus addressing is configured. Stripe login and agreements remain user-controlled.

## Use

- Standard unit, database and Playwright tests stay offline: mock the provider response, not its authorization or readiness rules. They never send this data to Stripe or Resend.
- Use the image with the hosted document uploader. File tokens are for API verification workflows; do not paste a file token into a browser file picker. Confirm that a specific Accounts v2 field supports a token before using one—the reference guide includes legacy Accounts v1 examples.
- Use these values only with an explicitly selected sandbox and test keys. Tests must still reject live mode and require verified capabilities. A sandbox can permit a charge with an inactive capability; Nitewide must not interpret that as onboarding approval.
- Address tokens replace street line 1; city, state and postal code must remain legitimate. Use synthetic fixtures, not a person's real identifying information.
- Keep merchant onboarding, individual commission-recipient onboarding, and a return from a hosted form separate. A return URL alone proves none of them completed.
- Do not auto-accept Stripe terms, enter new login credentials, or upload real IDs. Hand those steps to the user. Do not create a new connected account on every regression run.

## Coverage checkpoints

Test loading feedback, navigation or a visible fallback link, provider errors/timeouts, expiry, duplicate clicks, revoked finance access, organization changes and safe return URLs. Validate server-synchronized capabilities, current requirements and closed accounts independently of the hosted form. API tests in `apps/api/test/business-payment-account.test.js` cover readiness and authorization; Business component tests and `e2e/specs/business-payments.spec.cjs` cover setup interactions on desktop and iPhone.

The fixture values are reference data, not evidence of a successful Stripe integration. Actual sandbox onboarding/purchase/refund verification is separate from offline CI and must be recorded explicitly. Recheck the official guide when expanding countries or updating the Stripe API version.

## Explicit API sandbox runner

Use `npm run test:stripe:sandbox` only when explicitly testing the real Stripe sandbox. It first passes mocked unit and isolated PostgreSQL checkout prerequisites, then provisions one tagged test merchant. Subsequent runs should use `npm run test:stripe:sandbox -- --resume <test identifier>` from the ignored JSON report in `test-results/stripe-sandbox/`, keeping the same account and identity. Normal automated tests, builds and deployments do not invoke it; live/CI/deployed targets are rejected.

To reuse an already-onboarded Nitewide sandbox business without creating another Stripe account, run `npm run test:stripe:sandbox -- --account <acct_test_business>`. The runner verifies its Nitewide profile metadata, test mode, account responsibilities and provider readiness. It generates test users, organizations and events in an isolated database automatically, leaving existing application bindings unchanged. Successful payments verify the actual application fee and balance transactions before a full refund. Failed attempts expire unpaid sessions or refund successful charges; unresolved cleanup fails the run and is recorded for inspection.

Our full-Dashboard account model still requires merchant-controlled bank setup and agreement acceptance in Stripe's hosted/Dashboard flow once. The runner must stop before paid tests while provider readiness is restricted. It must never accept terms on a merchant's behalf, add a bank through an unsupported API, bypass MFA or relax the production controller policy. Keep a separate manual signup check through Nitewide Business.

Local signed replays of retrieved provider events test our HTTP receivers and deduplication, not actual Stripe destination delivery. Real sandbox payment/refund checks and provider delivery must be identified separately from mocked coverage. See [sandbox execution and manual onboarding](../../../docs/STRIPE_CONNECT_PREPARATION.md#explicit-sandbox-tests-and-account-reuse) for instructions, safeguards and verified checkpoints.
