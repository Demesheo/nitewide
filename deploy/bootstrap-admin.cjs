#!/usr/bin/env node
// Operator-only, one-time privilege grant. Never imported by API routes, worker
// startup, migrations or demo seeding; ordinary releases do not run this command.
const { Writable } = require('node:stream');
const { createInterface } = require('node:readline');
const { z } = require('zod');
const { mutationTransaction } = require('../apps/api/src/services/mutation-transaction');
const { passwordMatches } = require('../apps/api/src/services/auth-service');

const ACTION = 'platform.first_admin_bootstrapped';
const MESSAGES = {
  INVALID_OPTIONS: 'Invalid first-admin options. Use --help; passwords are never command arguments.',
  RELEASE_MISMATCH: 'The explicit environment or revision does not match this release.',
  ALREADY_BOOTSTRAPPED: 'First-admin setup was already completed. Use the existing admin or the reviewed recovery procedure.',
  ADMIN_EXISTS: 'An internal-admin account already exists, including inactive accounts. First-admin setup is forbidden.',
  ACCOUNT_UNAVAILABLE: 'Register an active account through normal signup before running first-admin setup.',
  EMAIL_UNVERIFIED: 'Production first-admin setup requires completed in-app email verification.',
  ACCOUNT_CHANGED: 'The target account changed. Preview it again before approving a grant.',
  PASSWORD_REJECTED: 'The existing account password could not be verified. No admin access was granted.',
  TTY_REQUIRED: 'Applying first-admin setup requires an interactive private terminal for password and confirmation.',
  CANCELLED: 'First-admin setup was cancelled. Run a preview to check its current state.',
  FAILED: 'First-admin setup could not complete. Check release configuration and database access, then preview before retrying.',
};
class BootstrapError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}
const line = (min, max) => z.string().trim().min(min).max(max).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const targetSchema = z.object({
  environment: z.enum(['staging', 'production']),
  expectedRevision: z.string().regex(/^[a-f0-9]{40}$/),
  email: line(3, 320).email().transform(value => value.toLowerCase()),
  userId: z.string().uuid().optional(),
  operator: line(3, 100).optional(), reason: line(10, 500).optional(),
  apply: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.apply && (!value.userId || !value.operator || !value.reason)) {
    context.addIssue({ code: 'custom', message: 'Apply requires user ID, operator and reason' });
  }
});
const HELP = `One-time first-admin setup (private release terminal only).
  npm run admin:bootstrap -- --environment staging --expected-revision <full-SHA> --email <account-email>
  npm run admin:bootstrap -- --environment staging --expected-revision <full-SHA> --email <account-email> \\
    --user-id <preview-UUID> --operator "<operator identity>" --reason "<approved setup reason>" --apply

Default: read-only preview. Apply asks for the existing account password (hidden)
and a typed confirmation. No password flag, default credentials, email sends,
account creation, email verification, organization changes, or public endpoint.
Use the matching production environment only for separately approved production
setup. Uses injected release settings; never loads .env. Any existing admin or
previous bootstrap audit blocks this command permanently. See
docs/FIRST_ADMIN_SETUP.md for identity verification and lost-response recovery.
`;

function parseOptions(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {}, fields = {
    '--environment': 'environment', '--expected-revision': 'expectedRevision',
    '--email': 'email', '--user-id': 'userId', '--operator': 'operator', '--reason': 'reason',
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index], field = argument === '--apply' ? 'apply' : fields[argument];
    if (!field || Object.hasOwn(options, field)) throw new BootstrapError('INVALID_OPTIONS');
    if (field === 'apply') options.apply = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new BootstrapError('INVALID_OPTIONS');
      options[field] = value;
    }
  }
  const parsed = targetSchema.safeParse(options);
  if (!parsed.success) throw new BootstrapError('INVALID_OPTIONS');
  return parsed.data;
}

async function assertAvailable(models, transaction) {
  if (await models.AuditLog.unscoped().findOne({ where: { action: ACTION }, attributes: ['id'], transaction })) {
    throw new BootstrapError('ALREADY_BOOTSTRAPPED');
  }
  // Never treat an archived/suspended admin as permission to appoint another.
  if (await models.User.unscoped().findOne({ where: { isInternalAdmin: true }, attributes: ['id'], transaction })) {
    throw new BootstrapError('ADMIN_EXISTS');
  }
}
function assertAccount(user, options) {
  if (!user || user.isActive !== true || user.lifecycleState !== 'active' || user.onboardingPending !== false) {
    throw new BootstrapError('ACCOUNT_UNAVAILABLE');
  }
  if (options.environment === 'production' && !user.emailVerifiedAt) throw new BootstrapError('EMAIL_UNVERIFIED');
}
function identity(user) {
  return { userId: user.id, email: user.email, displayName: user.displayName,
    version: user.version, emailVerified: Boolean(user.emailVerifiedAt), role: 'platform_owner' };
}
async function previewFirstAdmin(models, options) {
  // PostgreSQL enforces read-only mode as well as the absence of ORM writes.
  return models.User.sequelize.transaction({ readOnly: true }, async transaction => {
    await models.User.sequelize.query('SET TRANSACTION READ ONLY', { transaction });
    await assertAvailable(models, transaction);
    const user = await models.User.unscoped().findOne({ where: { email: options.email }, transaction });
    assertAccount(user, options);
    if (options.userId && user.id !== options.userId) throw new BootstrapError('ACCOUNT_CHANGED');
    const credential = await models.UserCredential.findByPk(user.id, { attributes: ['userId'], transaction });
    if (!credential) throw new BootstrapError('ACCOUNT_UNAVAILABLE');
    return identity(user);
  });
}

async function applyFirstAdmin(models, options, preview, password) {
  const parsed = targetSchema.safeParse(options);
  if (!parsed.success || !parsed.data.apply) throw new BootstrapError('INVALID_OPTIONS');
  options = parsed.data;
  if (typeof password !== 'string' || !password.length || password.length > 128) throw new BootstrapError('PASSWORD_REJECTED');
  return mutationTransaction(models.User.sequelize, async transaction => {
    // Exclusive authorization fence serializes concurrent bootstrap commands
    // and existing access changes across processes. Nothing waits on a prompt
    // while holding this lock; all authority and password checks happen again.
    await assertAvailable(models, transaction);
    const user = await models.User.unscoped().findByPk(options.userId, { transaction, lock: transaction.LOCK.UPDATE });
    assertAccount(user, options);
    if (user.email !== options.email || user.id !== preview.userId || user.version !== preview.version) {
      throw new BootstrapError('ACCOUNT_CHANGED');
    }
    const credential = await models.UserCredential.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });
    let verified = false;
    try { verified = Boolean(credential) && await passwordMatches(password, credential); } catch { /* malformed credential fails closed */ }
    if (!verified) throw new BootstrapError('PASSWORD_REJECTED');
    const before = { isInternalAdmin: user.isInternalAdmin, internalAdminRole: user.internalAdminRole, version: user.version };
    await user.update({ isInternalAdmin: true, internalAdminRole: 'platform_owner' }, { transaction });
    const [revokedSessions] = await models.AuthSession.update({ revokedAt: new Date() }, {
      where: { userId: user.id, revokedAt: null }, transaction,
    });
    const audit = await models.AuditLog.create({
      // Host-terminal operator identity is self-declared, NOT an authenticated
      // in-app actor. Do not misattribute this grant to the promoted account.
      actorUserId: null, entityType: 'User', entityId: user.id, action: ACTION, before,
      after: { isInternalAdmin: true, internalAdminRole: user.internalAdminRole, version: user.version,
        bootstrap: { source: 'private_release_cli', environment: options.environment, revision: options.expectedRevision,
          operatorLabel: options.operator, reason: options.reason, accountPasswordVerified: true,
          emailOwnershipVerified: Boolean(user.emailVerifiedAt), revokedSessions } },
    }, { transaction });
    return { ...identity(user), auditId: audit.id, revokedSessions };
  }, { accessChange: true });
}

function prompt(question, { secret = false, input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new BootstrapError('TTY_REQUIRED'));
  return new Promise((resolve, reject) => {
    const sink = new Writable({ write(chunk, encoding, callback) { if (!secret) output.write(chunk, encoding); callback(); } });
    sink.isTTY = true; sink.columns = output.columns;
    const terminal = createInterface({ input, output: sink, terminal: true, historySize: 0 });
    let finished = false;
    const finish = (error, answer) => {
      if (finished) return;
      finished = true;
      process.removeListener('SIGTERM', cancelled);
      terminal.close(); sink.end();
      if (secret) output.write('\n');
      error ? reject(error) : resolve(answer);
    };
    const cancelled = () => finish(new BootstrapError('CANCELLED'));
    terminal.once('SIGINT', cancelled); terminal.once('close', cancelled);
    process.once('SIGTERM', cancelled);
    if (secret) output.write(question);
    terminal.question(secret ? '' : question, answer => finish(null, answer));
  });
}

async function run(args = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log || (value => process.stdout.write(`${value}\n`));
  let sequelize, password;
  try {
    const options = parseOptions(args);
    if (options.help) { log(HELP); return 0; }
    // No dotenv convenience here: selecting a real release must be deliberate.
    const config = (dependencies.releaseConfig || require('./run.cjs').releaseConfig)(dependencies.environment || process.env);
    if (config.APP_ENVIRONMENT !== options.environment || config.RELEASE_REVISION !== options.expectedRevision) {
      throw new BootstrapError('RELEASE_MISMATCH');
    }
    if (options.apply && !(dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) {
      throw new BootstrapError('TTY_REQUIRED');
    }
    sequelize = (dependencies.createDatabase || require('../apps/api/src/db/sequelize').createSequelize)({
      ...config, LOG_LEVEL: 'silent', DATABASE_POOL_MAX: 1,
    });
    const models = (dependencies.createModels || require('../apps/api/src/db/models').initModels)(sequelize);
    const preview = await previewFirstAdmin(models, options);
    log(JSON.stringify({ event: 'first_admin_preview', environment: config.APP_ENVIRONMENT,
      revision: config.RELEASE_REVISION, target: preview, readOnly: true }));
    if (!options.apply) return 0;
    const ask = dependencies.prompt || prompt;
    password = await ask('Existing account password (hidden): ', { secret: true });
    const confirmation = `PROMOTE ${options.environment} ${preview.userId}`;
    if (await ask(`Type ${confirmation} to grant full platform-owner access: `) !== confirmation) {
      throw new BootstrapError('CANCELLED');
    }
    const result = await applyFirstAdmin(models, options, preview, password);
    log(JSON.stringify({ event: 'first_admin_bootstrapped', environment: config.APP_ENVIRONMENT,
      revision: config.RELEASE_REVISION, ...result, next: 'Sign in again at the admin app. Existing sessions were revoked.' }));
    return 0;
  } catch (error) {
    const code = error instanceof BootstrapError ? error.code : 'FAILED';
    log(JSON.stringify({ event: 'first_admin_setup_blocked', code, message: MESSAGES[code] }));
    return 1;
  } finally {
    password = undefined;
    if (sequelize) await sequelize.close();
  }
}
if (require.main === module) run().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write(`${MESSAGES.FAILED}\n`); process.exitCode = 1;
});
module.exports = { run, parseOptions, previewFirstAdmin, applyFirstAdmin, prompt, ACTION, BootstrapError };
