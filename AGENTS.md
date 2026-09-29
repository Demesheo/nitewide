# Persistent model roles

Use `gpt-6-astra` (GPT-6 Astra) at high reasoning effort for NiteWide planning, orchestration, and final overview.
Use `gpt-6-sol` (GPT-6 Sol) at high reasoning effort for coding and implementation following Astra's direction, then code review after Luna's checks.
Use `gpt-6-luna` (GPT-6 Luna) at high reasoning effort for writing unit tests and UI/UX testing and review.

Use role-based subagents within the user's requested task. If a required model is unavailable, report that limitation rather than silently substituting another model.

These instructions guide model selection and delegation; they do not automatically change the active chat's model.

## Test policy

Standard `npm test` includes the Admissions, Business HTTP, and Team/Overview/Analytics database checks using isolated, migrated fixture databases. These checks are mandatory, not opt-in or silently skipped, and must never depend on or reseed the development/demo database.

Demo-specific database checks run only through the explicit `npm run test:demo` command with a dedicated `DEMO_TEST_DATABASE_URL`.

Quota-consuming live email checks must never run as part of standard tests, CI, builds, or deployments. Standard test processes disable outbound email credentials.
