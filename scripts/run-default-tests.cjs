#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Empty values prevent dotenv from loading local Resend credentials in tests.
// The opt-in delivery command uses a different entry point after mocked tests pass.
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test', '--workspaces', '--if-present'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', RESEND_TEST_READ_API_KEY: '' },
});
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
