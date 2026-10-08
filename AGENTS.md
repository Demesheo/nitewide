# Repository work and local verification

## Before committing or pushing

- Run and pass the complete local release gate on the final file contents before
  any commit or push. Focused tests, `test:quick`, screenshots, and CI after a push
  are useful feedback, but do not replace this gate.
- Use Node **24.21.0** from `.nvmrc` and npm **12.1.0** from `package.json`, matching
  the GitHub workflow. Do not silently use an incompatible default runtime.
- With Docker Desktop running, use the isolated PostgreSQL 18/PostGIS server:

  ```sh
  npm run test:db:up
  CI=true TEST_DATABASE_ADMIN_URL='postgres://postgres:isolated-pg18-password@127.0.0.1:5434/postgres' npm run test:release
  npm run api:contract:check
  git diff --check
  ```

- `test:release` must run unfiltered: all workspace unit/component tests, every
  required API/database suite, all configured browser projects, and fresh
  production frontend builds. Keep `CI=true` so recovered browser flakes fail.
- Fix failures and rerun the gate. Do not skip required coverage, weaken
  assertions, accept recovered flakes, or bypass failures to commit/push. If a
  prerequisite is unavailable, report the blocker without committing/pushing.
- A successful pre-commit run may cover the immediate push only if the tested
  tree is unchanged. Any subsequent source/test/configuration edit invalidates
  that result. Preserve unrelated user changes and stage only authorized work.
- Report the commands, runtime versions, result counts, and intentional skips.
  Local success does not establish that GitHub CI or a hosted deployment passed.

## Test isolation

- Always set the explicit loopback maintenance URL above. Do not use the
  development database on port 5433 or any hosted application database.
- Use repository test runners, which clear provider credentials and operate
  only on generated disposable databases. Never enable real email, payments,
  SMS, storage, or geocoding for ordinary tests.
- Do not run concurrent browser runners or frontend builds against the same
  fixed ports/dist directories. After all test processes finish, the test-only
  database server can be stopped with `npm run test:db:down`; do not stop a server
  used by another active test run.
- See `docs/TESTING.md` and `docs/UI_TESTING.md` for coverage and safety details.
