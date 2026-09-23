const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const { getConfig } = require('../apps/api/src/config');

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Initialization command failed (${code})`)));
  });
}
async function initialize() {
  const config = getConfig();
  if (!config.hostedDemo || new URL(config.DATABASE_URL).pathname !== '/nitewide_demo') throw new Error('Demo image requires a protected, isolated nitewide_demo database');
  const client = new Client({ connectionString: config.DATABASE_URL, ssl: config.databaseSsl ? { rejectUnauthorized: true } : false });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(721092300)');
    await run('npm', ['run', 'db:migrate', '--workspace', '@nitewide/api'], path.resolve(__dirname, '..'));
    await client.query('CREATE TABLE IF NOT EXISTS demo_bootstrap (id integer PRIMARY KEY CHECK (id = 1), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query('SELECT status FROM demo_bootstrap WHERE id=1');
    if (!rows.length) {
      const existing = await client.query('SELECT COUNT(*)::integer AS count FROM users');
      if (existing.rows[0].count) throw new Error('Refusing to initialize a populated database');
      await client.query("INSERT INTO demo_bootstrap (id,status) VALUES (1,'started')");
      await require('../apps/api/src/db/seed').seed({ hostedBootstrap: true });
      await client.query("UPDATE demo_bootstrap SET status='ready' WHERE id=1");
    } else if (rows[0].status !== 'ready') {
      throw new Error('Previous seed did not finish. Inspect the dedicated demo database; automatic destructive retries are disabled.');
    }
    // Render free instances have ephemeral filesystems. Rehydrate only known
    // source flyers referenced by this demo DB; never reset visitor changes.
    const { stableId, prepareImage } = require('../apps/api/src/db/posh-importer');
    const urls = new Set([
      ...require('../apps/api/src/db/fixtures/posh-orlando-2026-09-21').events,
      ...require('../apps/api/src/db/fixtures/posh-orlando-2026-09-22').events,
    ].map(event => event.imageUrl));
    for (const url of urls) {
      const asset = await client.query('SELECT id FROM media_assets WHERE id=$1', [stableId(`image:${url}`)]);
      if (asset.rows.length) await prepareImage(url, config.MEDIA_UPLOAD_DIR || '/app/media');
    }
  } finally { await client.end(); }
}
if (require.main === module) initialize().then(() => require('../apps/api/src/server')).catch(error => { console.error('Demo startup failed:', error.message); process.exitCode = 1; });
module.exports = { initialize };
