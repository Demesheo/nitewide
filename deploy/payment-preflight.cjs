#!/usr/bin/env node
const path = require('node:path');
const ipaddr = require('ipaddr.js');

const HELP = `Payment deployment preflight (read-only; no Stripe requests or charges).
  npm run payments:preflight -- [--require-paid] [--expect-revision <40-character SHA>]
  npm run payments:preflight -- --url https://your-app.example --require-paid --expect-revision <SHA>

Without --url, inspect this runtime's configuration and database.
With --url, inspect the running API using PAYMENT_PREFLIGHT_ADMIN_TOKEN from
the private environment. Never put that token in a URL or command argument.
Missing payment configuration fails --require-paid; a free-only runtime can
report disabled. This is not payment, credential-pair or webhook delivery proof.
`;

function parseOptions(args) {
  const options = { requirePaid: false, expectRevision: null, url: null, help: false };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help') options.help = true;
    else if (option === '--require-paid') options.requirePaid = true;
    else if (option === '--expect-revision') {
      const revision = args[++index];
      if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Expected revision must be a full lowercase Git SHA.');
      options.expectRevision = revision;
    } else if (option === '--url') {
      let url;
      try { url = new URL(args[++index]); } catch { throw new Error('Use an HTTPS application origin for --url.'); }
      const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
      const loopback = hostname === 'localhost' || ipaddr.isValid(hostname) && ipaddr.process(hostname).range() === 'loopback';
      const publicHost = ipaddr.isValid(hostname) ? ipaddr.process(hostname).range() === 'unicast'
        : hostname.includes('.') && !/(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || !(url.protocol === 'https:' && publicHost || url.protocol === 'http:' && loopback)) {
        throw new Error('Use an HTTPS public origin without credentials, path, query or fragment; HTTP is only allowed on loopback.');
      }
      options.url = url.origin;
    } else throw new Error('Unknown payment preflight option. Use --help.');
  }
  return options;
}

async function inspectRemote(options, { environment, fetchImpl }) {
  const token = environment.PAYMENT_PREFLIGHT_ADMIN_TOKEN;
  if (!token || /[\r\n]/.test(token)) throw new Error('Set PAYMENT_PREFLIGHT_ADMIN_TOKEN to an authorized internal-admin session in the private environment.');
  const url = new URL('/api/admin/diagnostics/payments', options.url);
  if (options.requirePaid) url.searchParams.set('requirePaid', 'true');
  if (options.expectRevision) url.searchParams.set('expectRevision', options.expectRevision);
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? 'The deployed preflight requires a current internal-admin session.' : 'The deployed payment preflight could not be read.');
  // Runtime schema rejects unknown properties and accepts only fixed messages.
  // Even an erroneous proxy response cannot echo arbitrary provider/private data.
  const { paymentPreflightReport } = require('../apps/api/src/http/payment-preflight-schemas');
  return paymentPreflightReport.parse((await response.json()).data);
}

async function inspectLocal(options, { environment, loadConfig, createDatabase, createModels, createPreflight }) {
  const config = loadConfig(environment);
  const sequelize = createDatabase(config);
  try {
    const report = await createPreflight({ config, sequelize, models: createModels(sequelize) }).inspect(options);
    return require('../apps/api/src/http/payment-preflight-schemas').paymentPreflightReport.parse(report);
  } finally { await sequelize.close(); }
}

async function run(args = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(args);
  const log = dependencies.log || (value => process.stdout.write(`${value}\n`));
  if (options.help) { log(HELP); return 0; }
  const environment = dependencies.environment || process.env;
  try {
    if (!options.url && !dependencies.environment) {
      // Runtime-injected settings win; the ignored local file is only a local
      // convenience, never bundled into the image or printed by this command.
      require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
    }
    const report = options.url
      ? await inspectRemote(options, { environment, fetchImpl: dependencies.fetchImpl || fetch })
      : await inspectLocal(options, { environment,
        loadConfig: dependencies.loadConfig || require('../apps/api/src/config').getConfig,
        createDatabase: dependencies.createDatabase || require('../apps/api/src/db/sequelize').createSequelize,
        createModels: dependencies.createModels || require('../apps/api/src/db/models').initModels,
        createPreflight: dependencies.createPreflight || require('../apps/api/src/diagnostics/payment-preflight').createPaymentPreflight });
    log(JSON.stringify(report, null, 2));
    const failed = report.mode === 'configuration-blocked' || report.checks.some(item => item.status === 'fail')
      || options.requirePaid && (report.mode !== 'sandbox-ready' || report.schema.status !== 'ready'
        || report.routing.status !== 'ready' || report.workers.status !== 'ready'
        || report.routing.readyEventCount < 1 || report.routing.blockedEventCount > 0)
      || options.expectRevision && report.runtime.revision !== options.expectRevision;
    return failed ? 1 : 0;
  } catch {
    log(JSON.stringify({ scope: 'payment-preflight', mode: 'configuration-blocked',
      message: 'Preflight could not complete. Check runtime configuration, database access or internal-admin authorization; no payments were attempted.' }));
    return 1;
  }
}

if (require.main === module) {
  // Bound even a stalled connection acquisition/close or remote JSON stream.
  const deadline = setTimeout(() => {
    process.stderr.write('Payment preflight exceeded its deadline; no payments were attempted.\n');
    process.exit(1);
  }, 20000);
  run().then(code => { clearTimeout(deadline); process.exitCode = code; }).catch(() => {
    clearTimeout(deadline); process.stderr.write('Invalid payment preflight options. Use --help.\n'); process.exitCode = 1;
  });
}

module.exports = { run, parseOptions };
