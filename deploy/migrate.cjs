const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

async function migrate(config, { ClientClass = Client, spawnProcess = spawn, signals = process } = {}) {
  const client = new ClientClass({ connectionString: config.DATABASE_URL, ssl: config.databaseTls,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
    statement_timeout: 120000, lock_timeout: 10000 });
  let child;
  let interrupted = false;
  let deadline;
  const stop = () => {
    interrupted = true;
    child?.kill('SIGTERM');
    if (child && !deadline) deadline = setTimeout(() => child.kill('SIGKILL'), 30000);
  };
  signals.once('SIGTERM', stop); signals.once('SIGINT', stop);
  try {
    await client.connect();
    // Session-scoped: the lock stays held while the separate CLI applies the
    // reviewed migration chain, and connection close always releases it.
    await client.query('SELECT pg_advisory_lock(721092301)');
    if (interrupted) throw new Error('Migration interrupted');
    await new Promise((resolve, reject) => {
      child = spawnProcess(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'production'],
        { cwd: path.resolve(__dirname, '../apps/api'), env: process.env, stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', code => code === 0 && !interrupted ? resolve() : reject(new Error('Release migration failed')));
    });
  } finally {
    clearTimeout(deadline);
    signals.removeListener('SIGTERM', stop); signals.removeListener('SIGINT', stop);
    await client.end();
  }
}
module.exports = { migrate };
