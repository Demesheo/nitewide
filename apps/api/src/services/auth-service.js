const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DomainError } = require('../domain/errors');

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
  return { id: user.id, email: user.email, displayName: user.displayName, phone: user.phone, marketingConsentAt: user.marketingConsentAt, transactionalSmsConsentAt: user.transactionalSmsConsentAt, marketingSmsConsentAt: user.marketingSmsConsentAt, phoneVerifiedAt: user.phoneVerifiedAt };
}

function createAuthService({ sequelize, models, tokenSecret, now = () => new Date() }) {
  async function rolesFor(user) {
    const [memberships, employeeCount, orgAffiliateCount, eventAffiliateCount, createdEventCount] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { userId: user.id }, attributes: ['role'] }),
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
    if (createdEventCount) roles.push('event_creator');
    return roles;
  }

  async function sessionFor(user) {
    const issuedAt = Math.floor(now().getTime() / 1000);
    const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
    return { accessToken: signToken({ sub: user.id, iat: issuedAt, exp: expiresAt }, tokenSecret), expiresAt: new Date(expiresAt * 1000).toISOString(), user: publicUser(user), roles: await rolesFor(user) };
  }

  async function register(input) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const password = await createPasswordRecord(input.password);
    const user = await sequelize.transaction(async (transaction) => {
      const created = await models.User.create({ email: normalizedEmail, displayName: input.displayName.trim(), phone: input.phone, marketingConsentAt: input.marketingConsent ? now() : null, transactionalSmsConsentAt: input.transactionalSmsConsent ? now() : null, marketingSmsConsentAt: input.marketingSmsConsent ? now() : null }, { transaction });
      // Future Twilio integration: verify this user supplied number, set
      // phoneVerifiedAt, then enqueue only consented SMS categories. A phone
      // number or invitation contact alone never authorizes SMS delivery.
      await models.UserCredential.create({ userId: created.id, ...password }, { transaction });
      await models.AuditLog.create({ actorUserId: created.id, entityType: 'User', entityId: created.id, action: 'user.registered', after: { role: 'customer' } }, { transaction });
      return created;
    });
    return sessionFor(user);
  }

  async function signIn(input) {
    const user = await models.User.findOne({ where: { email: input.email.trim().toLowerCase() } });
    const credential = user ? await models.UserCredential.findByPk(user.id) : null;
    if (!user || !user.isActive || !credential || !(await passwordMatches(input.password, credential))) {
      throw new DomainError('Email or password is incorrect', { code: 'INVALID_CREDENTIALS', status: 401 });
    }
    return sessionFor(user);
  }

  async function authenticate(accessToken) {
    const payload = verifyToken(accessToken, tokenSecret, now);
    const user = await models.User.findByPk(payload.sub);
    if (!user?.isActive) throw new DomainError('Session is invalid or expired', { code: 'UNAUTHENTICATED', status: 401 });
    return user;
  }

  async function me(userId) {
    const user = await models.User.findByPk(userId);
    if (!user?.isActive) throw new DomainError('User not found', { code: 'UNAUTHENTICATED', status: 401 });
    return { user: publicUser(user), roles: await rolesFor(user) };
  }

  return { register, signIn, authenticate, me };
}

module.exports = { createAuthService, createPasswordRecord, passwordMatches, signToken, verifyToken };
