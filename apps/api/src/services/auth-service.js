const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DomainError } = require('../domain/errors');
const { Op } = require('sequelize');
const { TEMPLATES } = require('./email-templates');
const { activeUser } = require('./lifecycle-service');

const scrypt = promisify(crypto.scrypt);
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

async function createPasswordRecord(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { passwordHash: derived.toString('hex'), passwordSalt: salt };
}

async function passwordMatches(password, credential) {
  const candidate = await createPasswordRecord(password, credential.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(candidate.passwordHash, 'hex'), Buffer.from(credential.passwordHash, 'hex'));
}

function signToken(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token, secret, now = () => new Date()) {
  try {
    const [encoded, providedSignature] = token.split('.');
    if (!encoded || !providedSignature) throw new Error('Malformed token');
    const expectedSignature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const provided = Buffer.from(providedSignature);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) throw new Error('Invalid signature');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(now().getTime() / 1000)) throw new Error('Expired token');
    return payload;
  } catch (_error) {
    throw new DomainError('Session is invalid or expired', { code: 'UNAUTHENTICATED', status: 401 });
  }
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName, phone: user.phone, marketingConsentAt: user.marketingConsentAt, transactionalSmsConsentAt: user.transactionalSmsConsentAt, marketingSmsConsentAt: user.marketingSmsConsentAt, phoneVerifiedAt: user.phoneVerifiedAt, emailVerifiedAt: user.emailVerifiedAt };
}

function createAuthService({ sequelize, models, tokenSecret, invitations = null, email = null, customerAppUrl = 'http://localhost:5173', now = () => new Date() }) {
  const tokenHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const actionUrl = (key, token) => {
    const url = new URL(customerAppUrl);
    url.searchParams.set(key, token);
    return url.toString();
  };
  async function issueAction(user, purpose, transaction) {
    if (!email?.enabled || !models.UserActionToken) return null;
    const recent = await models.UserActionToken.count({
      where: { userId: user.id, purpose, createdAt: { [Op.gte]: new Date(now().getTime() - 3600000) } },
      transaction,
    });
    if (recent >= 3) return null;
    const raw = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(now().getTime() + (purpose === 'password_reset' ? 3600000 : 86400000));
    const record = await models.UserActionToken.create({
      userId: user.id, purpose, email: user.email, tokenHash: tokenHash(raw), expiresAt,
    }, { transaction });
    const queued = await email.queue({
      key: `${purpose}/${record.id}`, to: user.email,
      template: purpose === 'password_reset' ? TEMPLATES.passwordReset : TEMPLATES.verifyEmail,
      variables: { NAME: user.displayName, [purpose === 'password_reset' ? 'RESET_URL' : 'VERIFY_URL']: actionUrl(purpose === 'password_reset' ? 'resetPassword' : 'verifyEmail', raw) },
      expiresAt,
    }, transaction);
    return queued ? record.id : null;
  }
  async function rolesFor(user) {
    const [memberships, employeeCount, orgAffiliateCount, eventAffiliateCount, createdEventCount] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { userId: user.id, lifecycleState: 'active' }, attributes: ['role'] }),
      models.OrganizationEmployee.count({ where: { userId: user.id, status: 'active' } }),
      models.OrgAffiliate.count({ where: { userId: user.id, status: 'active' } }),
      models.EventAffiliate.count({ where: { userId: user.id, status: 'active' } }),
      models.Event.count({ where: { creatorUserId: user.id } }),
    ]);
    const roles = ['customer'];
    if (user.isInternalAdmin) roles.push('internal_admin');
    if (memberships.some((membership) => membership.role === 'owner')) roles.push('organization_owner');
    if (memberships.some((membership) => membership.role === 'admin')) roles.push('venue_manager');
    if (employeeCount) roles.push('employee');
    if (orgAffiliateCount || eventAffiliateCount) roles.push('promoter');
    if (user.independentCreator) roles.push('event_creator');
    return roles;
  }

  async function sessionFor(user) {
    const issuedAt = Math.floor(now().getTime() / 1000);
    const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
    const credential = await models.UserCredential.findByPk(user.id);
    return { accessToken: signToken({ sub: user.id, iat: issuedAt, exp: expiresAt, pwd: credential?.passwordChangedAt ? new Date(credential.passwordChangedAt).getTime() : null }, tokenSecret), expiresAt: new Date(expiresAt * 1000).toISOString(), user: publicUser(user), roles: await rolesFor(user) };
  }

  async function register(input) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const password = await createPasswordRecord(input.password);
    const { user, guestlistInvite, verificationEmailQueued } = await sequelize.transaction(async (transaction) => {
      const created = await models.User.create({ email: normalizedEmail, displayName: input.displayName.trim(), phone: input.phone, marketingConsentAt: input.marketingConsent ? now() : null, transactionalSmsConsentAt: input.transactionalSmsConsent ? now() : null, marketingSmsConsentAt: input.marketingSmsConsent ? now() : null }, { transaction });
      // Future Twilio integration: verify this user supplied number, set
      // phoneVerifiedAt, then enqueue only consented SMS categories. A phone
      // number or invitation contact alone never authorizes SMS delivery.
      await models.UserCredential.create({ userId: created.id, ...password }, { transaction });
      await models.AuditLog.create({ actorUserId: created.id, entityType: 'User', entityId: created.id, action: 'user.registered', after: { role: 'customer' } }, { transaction });
      const verificationEmailQueued = Boolean(await issueAction(created, 'verify_email', transaction));
      let guestlistInvite = null;
      if (input.guestlistInviteToken && invitations) {
        try { guestlistInvite = await invitations.claim(input.guestlistInviteToken, created.id, transaction); }
        catch (error) {
          if (!['INVITE_INVALID', 'FORBIDDEN'].includes(error.code)) throw error;
          guestlistInvite = { status: 'invalid' };
        }
      }
      return { user: created, guestlistInvite, verificationEmailQueued };
    });
    return { ...await sessionFor(user), verificationEmailQueued, ...(guestlistInvite ? { guestlistInvite } : {}) };
  }

  async function signIn(input) {
    const user = await models.User.findOne({ where: { email: input.email.trim().toLowerCase() } });
    const credential = user ? await models.UserCredential.findByPk(user.id) : null;
    if (!activeUser(user) || !credential || !(await passwordMatches(input.password, credential))) {
      throw new DomainError('Email or password is incorrect', { code: 'INVALID_CREDENTIALS', status: 401 });
    }
    return sessionFor(user);
  }

  async function authenticate(accessToken) {
    const payload = verifyToken(accessToken, tokenSecret, now);
    const user = await models.User.findByPk(payload.sub);
    if (!activeUser(user)) throw new DomainError('Session is invalid or expired', { code: 'UNAUTHENTICATED', status: 401 });
    const credential = await models.UserCredential.findByPk(user.id);
    const changedAt = credential?.passwordChangedAt ? new Date(credential.passwordChangedAt).getTime() : null;
    // Sessions issued before the password-version claim was introduced remain
    // valid until expiry, unless the password has since been reset.
    if (changedAt && (payload.pwd == null ? (payload.iat || 0) * 1000 + 1000 < changedAt : payload.pwd !== changedAt)) {
      throw new DomainError('Session is invalid or expired', { code: 'UNAUTHENTICATED', status: 401 });
    }
    return user;
  }

  async function requestPasswordReset(emailAddress) {
    if (!email?.enabled) throw new DomainError('Email delivery is not configured', { code: 'EMAIL_UNAVAILABLE', status: 503 });
    const user = await models.User.findOne({ where: { email: emailAddress.trim().toLowerCase(), isActive: true } });
    if (user) await sequelize.transaction((transaction) => issueAction(user, 'password_reset', transaction));
    return { message: 'If an account exists, a reset link will be sent shortly.' };
  }

  async function requestEmailVerification(userId) {
    if (!email?.enabled) throw new DomainError('Email delivery is not configured', { code: 'EMAIL_UNAVAILABLE', status: 503 });
    const user = await models.User.findByPk(userId);
    if (!user?.isActive || user.emailVerifiedAt) return { verificationEmailQueued: false, message: 'No verification email is needed for this account.' };
    const queued = await sequelize.transaction((transaction) => issueAction(user, 'verify_email', transaction));
    return queued
      ? { verificationEmailQueued: true, message: 'Verification email queued. Check your inbox.' }
      : { verificationEmailQueued: false, message: 'A verification email could not be queued right now. Try again later.' };
  }

  async function consumeAction(raw, purpose, onValid) {
    if (!models.UserActionToken) throw new DomainError('This link is invalid or expired', { code: 'ACTION_TOKEN_INVALID', status: 400 });
    return sequelize.transaction(async (transaction) => {
      const record = await models.UserActionToken.findOne({
        where: { tokenHash: tokenHash(raw), purpose }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!record || record.consumedAt || record.expiresAt <= now()) {
        throw new DomainError('This link is invalid or expired', { code: 'ACTION_TOKEN_INVALID', status: 400 });
      }
      const user = await models.User.findByPk(record.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!activeUser(user) || user.email !== record.email) {
        throw new DomainError('This link is invalid or expired', { code: 'ACTION_TOKEN_INVALID', status: 400 });
      }
      await onValid(user, transaction);
      await record.update({ consumedAt: now() }, { transaction });
      return user;
    });
  }

  async function verifyEmail(raw) {
    await consumeAction(raw, 'verify_email', async (user, transaction) => {
      await user.update({ emailVerifiedAt: now() }, { transaction });
      if (email?.enabled) await email.queue({
        key: `welcome/${user.id}`, to: user.email, template: TEMPLATES.welcome,
        variables: { NAME: user.displayName, APP_URL: customerAppUrl },
      }, transaction);
    });
    return { verified: true };
  }

  async function resetPassword(raw, password) {
    await consumeAction(raw, 'password_reset', async (user, transaction) => {
      const record = await createPasswordRecord(password);
      await models.UserCredential.update({ ...record, passwordChangedAt: now() }, { where: { userId: user.id }, transaction });
    });
    return { reset: true };
  }

  async function me(userId) {
    const user = await models.User.findByPk(userId);
    if (!activeUser(user)) throw new DomainError('User not found', { code: 'UNAUTHENTICATED', status: 401 });
    return { user: publicUser(user), roles: await rolesFor(user) };
  }

  return { register, signIn, authenticate, me, requestPasswordReset, requestEmailVerification, verifyEmail, resetPassword };
}

module.exports = { createAuthService, createPasswordRecord, passwordMatches, signToken, verifyToken };
