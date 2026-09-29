# Persistent model preference

Use `gpt-6-astra` (GPT-6 Astra) at high reasoning effort for NiteWide planning, implementation, tests, review, UI testing, and command-line work until the user explicitly changes this preference. Do not delegate these roles to Sol or Luna by default. The user may explicitly request a different model or delegation for a particular task.

If Astra is unavailable, report that limitation to the user rather than silently substituting another model.

These instructions guide model selection and delegation; they do not automatically change the active chat's model.

## Test policy

Standard `npm test` includes the Admissions, Business HTTP, and Team/Overview/Analytics database checks using isolated, migrated fixture databases. These checks are mandatory, not opt-in or silently skipped, and must never depend on or reseed the development/demo database.

Demo-specific database checks run only through the explicit `npm run test:demo` command with a dedicated `DEMO_TEST_DATABASE_URL`.

Quota-consuming live email checks must never run as part of standard tests, CI, builds, or deployments. Standard test processes disable outbound email credentials.
