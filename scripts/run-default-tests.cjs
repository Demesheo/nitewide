#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');
const { offlineEnvironment } = require('../apps/api/scripts/test-database.cjs');

// Empty values prevent dotenv from loading local Resend credentials in tests.
// The opt-in delivery command uses a different entry point after mocked tests pass.
const result = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test', '--workspaces', '--if-present'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: offlineEnvironment(),
  detached: process.platform !== 'win32',
});
let interrupted = null;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = signal;
  if (!result.pid) return;
  try {
    if (process.platform === 'win32') result.kill('SIGTERM');
    else process.kill(-result.pid, 'SIGTERM');
  } catch (error) { if (error.code !== 'ESRCH') process.stderr.write('Could not stop the workspace test process group.\n'); }
});
result.once('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
result.once('close', (status) => { process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : status ?? 1; });
