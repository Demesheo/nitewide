# Persistent model roles

Use these roles for NiteWide work until the user explicitly changes this preference:

- `gpt-6-astra` (GPT-6 Astra): planning and orchestration.
- `gpt-6-sol` (GPT-6 Sol): coding and implementation.
- `gpt-6-luna` (GPT-6 Luna): writing tests, review, UI testing, and command-line work (shell commands, CLI tools, builds, test execution, diagnostics, and Git commands).

Role-based subagents are authorized within the user's requested task. Use subagents, not new chats, for this delegation.

If a required model is unavailable, report that limitation to the user rather than silently substituting another model.

These instructions guide model selection and delegation; they do not automatically change the active chat's model.

## Test policy

Standard `npm test` includes the Admissions, Business HTTP, and Team/Overview/Analytics database checks using isolated, migrated fixture databases. These checks are mandatory, not opt-in or silently skipped, and must never depend on or reseed the development/demo database.

Demo-specific database checks run only through the explicit `npm run test:demo` command with a dedicated `DEMO_TEST_DATABASE_URL`.

Quota-consuming live email checks must never run as part of standard tests, CI, builds, or deployments. Standard test processes disable outbound email credentials.
