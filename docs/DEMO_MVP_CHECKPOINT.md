# Local development demo MVP checkpoint

Checkpoint: **September 23, 2026**. Git tag: `local-dev-demo-mvp-2026-09-23`.
Commit: `891b14f9056ef3334e8957b21f165cf6d4ef4860`.

This immutable baseline includes the customer, business and admin apps, role-scoped
analytics, event offerings and tiers, referral attribution, individualized commissions,
guestlist allocations/invitations/decisions, QR credentials, in-app notifications,
margin-protected demo checkout, and the updated investor deck and whitepaper.

Verification at checkpoint: 323 automated tests passed, 7 opt-in suites skipped;
the PostgreSQL business HTTP workflow passed separately; all production frontend
builds passed. Working tree was clean and main was pushed to GitHub.

This is a **local demo MVP**, not a production launch. Payments and settlement,
email/SMS, infrastructure hardening and operational integrations remain gated.
No real funds, real admissions, or actual traction are implied by sample sales.

Next milestone: a password-protected, isolated hosted demo, built as a Docker image
in GitHub Actions, deployed to Render, with a dedicated seeded PostgreSQL database.
Keep local development unchanged. Never use a production/customer database for seed
operations, and never bake secrets, local database dumps or investor files into images.

To inspect this baseline without discarding current work:

```sh
git show local-dev-demo-mvp-2026-09-23
git worktree add --detach ../nitewide-mvp-checkpoint local-dev-demo-mvp-2026-09-23
```
