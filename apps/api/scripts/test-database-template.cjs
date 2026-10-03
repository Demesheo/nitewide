const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { maintenanceUrl, postgresUrl, assertLoopbackUrl, assertGeneratedDatabaseName } = require('./test-database.cjs');

function createTemplateDatabaseManager({ environment = process.env, ClientClass = Client, supervisor, timing, migrationNames, uuid = randomUUID, log = console.log } = {}) {
  const adminUrl = assertLoopbackUrl(postgresUrl(maintenanceUrl(environment))).toString();
  const allocated = new Set();
  const clientOptions = { connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'nitewide-isolated-test-runner' };
  let admin;
  let connected = false;
  let template;
  let frozen = false;

  function databaseUrl(name) {
    const url = postgresUrl(adminUrl);
    url.pathname = `/${assertGeneratedDatabaseName(name)}`;
    return url.toString();
  }

  function assertRunning() {
    if (supervisor.stopped) throw new Error('Test run stopped during database provisioning.');
  }

  async function allocate(source) {
    assertRunning();
    const name = assertGeneratedDatabaseName(`nitewide_test_${uuid().replaceAll('-', '')}`);
    const existing = await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [name]);
    if (existing.rows.length) throw new Error('Refusing to reuse an existing generated test database.');
    assertRunning();
    // Remember the target before issuing CREATE: a lost connection may hide a
    // successful server-side CREATE, and cleanup must still try that exact name.
    allocated.add(name);
    try {
      const sourceName = source ? assertGeneratedDatabaseName(source) : 'template0';
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${sourceName}" ALLOW_CONNECTIONS true`);
    } catch (error) {
      if (error.code === '42P04') allocated.delete(name);
      throw error;
    }
    assertRunning();
    return name;
  }

  async function withDatabase(name, operation) {
    const client = new ClientClass({ ...clientOptions, connectionString: databaseUrl(name) });
    try {
      await client.connect();
      return await operation(client);
    } finally { await client.end(); }
  }

  async function prepare(migrate) {
    admin = new ClientClass({ ...clientOptions, connectionString: adminUrl });
    try {
      await timing.measure('database-maintenance-connect', async () => { await admin.connect(); connected = true; }, { role: 'maintenance' });
    } catch (error) {
      throw new Error(`Cannot provision the isolated PostgreSQL test database (${error.code || 'configuration error'}). Start the local PostGIS service on port 5433 or set TEST_DATABASE_ADMIN_URL to the local postgres maintenance database with CREATE DATABASE permission. No application database was migrated or seeded.`);
    }
    template = await timing.measure('database-template-create', () => allocate(), { role: 'template' });
    await timing.measure('migration-empty-database-validation', () => withDatabase(template, async (client) => {
      const relations = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')");
      const extensions = await client.query('SELECT extname FROM pg_extension');
      if (relations.rows.length || extensions.rows.some((row) => row.extname !== 'plpgsql')) {
        throw new Error('The required migration boundary must start from an empty template0 database.');
      }
    }), { role: 'template' });
    assertRunning();
    await timing.measure('migration', () => migrate(databaseUrl(template), template), { role: 'template' });
    supervisor.assertScopeStopped(template);
    await timing.measure('migration-schema-validation', () => withDatabase(template, async (client) => {
      const applied = await client.query('SELECT name FROM "sequelize_meta" ORDER BY name');
      const actual = applied.rows.map((row) => row.name).sort();
      const expected = [...migrationNames].sort();
      if (!expected.length || actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
        throw new Error('The required empty-database migration did not apply every checked-in migration exactly once.');
      }
      const extensions = await client.query('SELECT extname FROM pg_extension');
      if (!['postgis', 'pgcrypto'].every((extension) => extensions.rows.some((row) => row.extname === extension))) {
        throw new Error('The migrated template is missing the required PostGIS or pgcrypto extension.');
      }
    }), { role: 'template' });
    await timing.measure('database-template-freeze', async () => {
      assertRunning();
      supervisor.assertScopeStopped(template);
      // Refuse new source sessions before closing any leftovers, so no session
      // can race the check or carry test mutations into later clones.
      await admin.query(`ALTER DATABASE "${assertGeneratedDatabaseName(template)}" WITH ALLOW_CONNECTIONS false`);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [template]);
      const sessions = await admin.query('SELECT pid FROM pg_stat_activity WHERE datname = $1', [template]);
      if (sessions.rows.length) throw new Error('The migrated template still has active source sessions and cannot be cloned safely.');
      frozen = true;
    }, { role: 'template' });
    return template;
  }

  async function clone(suite) {
    if (!frozen || !template) throw new Error('Integration databases require the fully migrated, frozen template.');
    const name = await timing.measure('database-clone', () => allocate(template), { suite, role: 'integration' });
    return { name, url: databaseUrl(name) };
  }

  async function drop(name, labels = {}) {
    assertGeneratedDatabaseName(name);
    if (!allocated.has(name)) throw new Error('Refusing to clean up a database not allocated by this invocation.');
    supervisor.assertScopeStopped(name);
    await timing.measure('database-cleanup', async () => {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } catch (firstError) {
        // A child failure or interrupted CREATE can also break the original
        // maintenance connection. Retry only this owned, generated target.
        const cleanupClient = new ClientClass({ ...clientOptions, connectionString: adminUrl });
        try {
          await cleanupClient.connect();
          await cleanupClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        } catch (error) {
          throw new Error(`Cleanup failed for isolated database ${name} (${error.code || firstError.code || 'connection error'}). Only this generated database requires cleanup.`);
        } finally { await cleanupClient.end(); }
      }
      allocated.delete(name);
      log(`Removed isolated test database ${name}.`);
    }, labels);
  }

  async function cleanup() {
    const errors = [];
    for (const name of [...allocated]) {
      try { await drop(name, { role: name === template ? 'template' : 'integration' }); }
      catch (error) { errors.push(error); }
    }
    if (admin) {
      try { await admin.end(); }
      catch (error) { errors.push(error); }
      connected = false;
    }
    if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'));
  }

  return { prepare, clone, drop, cleanup, get template() { return template; }, get allocatedNames() { return [...allocated]; }, get connected() { return connected; } };
}

module.exports = { createTemplateDatabaseManager };
