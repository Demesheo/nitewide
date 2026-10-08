const { Op, Transaction } = require('sequelize');
const { conflict, forbidden, notFound, DomainError } = require('../domain/errors');
const { activeUser } = require('./lifecycle-service');
const { mutationTransaction } = require('./mutation-transaction');
const { findAndCountSequential } = require('./transaction-reads');
const { pageResult } = require('./business-read-service');
const schemas = require('../http/business-access-schemas');
const RECEIVED = Object.freeze({ message: 'Request received. Nitewide will review your business access request. Access is not granted until onboarding is completed.' });
function createBusinessAccessRequestService({ models, permissions, onboarding, now = () => new Date() }) {
  const db = models.User?.sequelize || models.Event?.sequelize;
  async function read(actor, work) {
    await permissions.assertInternalPermission(actor, 'directory.view');
    return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
      await permissions.assertInternalPermission(actor, 'directory.view', transaction);
      return work(transaction);
    });
  }
  const applicantView = row => ({ id: row.id, businessName: row.businessName, role: row.role, status: row.status,
    purpose: row.purpose, createdAt: row.createdAt, reviewedAt: row.reviewedAt || null, organizationId: row.organizationId || null });
  async function applicant(actor, transaction) {
    const user = await models.User.findByPk(actor, { transaction, lock: transaction.LOCK.SHARE });
    if (!activeUser(user)) throw forbidden('An active Nitewide account is required to request an organization');
    return user;
  }
  async function submit(body, actor = null) {
    const { confirmedAuthority, ...values } = (actor ? schemas.organizationRequest : schemas.requestAccess).parse(body);
    let requested, duplicate = false;
    await mutationTransaction(db, async transaction => {
      const user = actor ? await applicant(actor, transaction) : null;
      const input = { ...values, ...(user ? { email: user.email } : {}) };
      // Serialize same-contact requests without revealing account or queue state.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended(:email, 10427))', { replacements: { email: input.email }, transaction });
      const existing = await models.BusinessAccessRequest.findOne({ where: { email: input.email, status: 'pending' }, transaction });
      if (existing) { requested = existing; duplicate = true; return; }
      const row = await models.BusinessAccessRequest.create({ ...input, requesterUserId: actor,
        purpose: actor ? 'new_organization' : 'business_access', confirmedAuthorityAt: confirmedAuthority ? now() : null }, { transaction });
      requested = row;
      await models.AuditLog.create({ actorUserId: actor, entityType: 'BusinessAccessRequest', entityId: row.id, action: 'business.access.requested',
        after: { status: 'pending', purpose: row.purpose, confirmedAuthority: true } }, { transaction });
    });
    return actor ? { message: duplicate ? 'You already have a request awaiting Nitewide review. Your existing access is unchanged.'
      : 'Your new organization request is awaiting Nitewide review. Your existing access is unchanged.', request: applicantView(requested), duplicate } : RECEIVED;
  }
  async function mine(actor, query) {
    const input = schemas.query.parse(query);
    return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
      const user = await applicant(actor, transaction);
      const where = { [Op.or]: [{ requesterUserId: actor }, { email: user.email }] };
      if (input.statuses.length) where.status = { [Op.in]: [...new Set(input.statuses)] };
      if (input.search) where.businessName = { [Op.iLike]: `%${input.search.replace(/[\\%_]/g, '\\$&')}%` };
      const { rows, count } = await findAndCountSequential(models.BusinessAccessRequest, { where,
        order: [['createdAt','DESC'],['id','ASC']], limit: input.pageSize, offset: (input.page - 1) * input.pageSize, transaction });
      return pageResult(rows.map(applicantView), count, input.page, input.pageSize);
    });
  }
  async function list(actor, query) {
    const input = schemas.query.parse(query);
    const where = {};
    if (input.statuses.length) where.status = { [Op.in]: [...new Set(input.statuses)] };
    if (input.search) {
      const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
      where[Op.or] = ['displayName','email','phone','businessName'].map(key => ({ [key]: { [Op.iLike]: search } }));
    }
    return read(actor, async transaction => {
      const { rows, count } = await findAndCountSequential(models.BusinessAccessRequest, { where, order: [['createdAt','ASC'],['id','ASC']], limit: input.pageSize, offset: (input.page - 1) * input.pageSize, transaction });
      return pageResult(rows, count, input.page, input.pageSize);
    });
  }
  async function detail(actor, id) {
    return read(actor, async transaction => {
      const row = await models.BusinessAccessRequest.findByPk(id, { transaction });
      if (!row) throw notFound('Access request');
      return row;
    });
  }
  async function review(actor, id, body, approving) {
    await permissions.assertInternal(actor);
    const input = (approving ? schemas.approve : schemas.decline).parse(body);
    return mutationTransaction(db, async transaction => {
      await permissions.assertInternal(actor, transaction);
      const row = await models.BusinessAccessRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw notFound('Access request');
      if (row.version !== input.version || row.status !== 'pending') throw conflict('This request was already reviewed or changed. Refresh before continuing.', 'ACCESS_REQUEST_STALE');
      let invitation = null;
      if (approving) {
        if (input.recipient.email !== row.email) throw conflict('Use the email submitted with this request.', 'ACCESS_REQUEST_EMAIL_MISMATCH');
        if (row.requesterUserId) {
          const applicantUser = await models.User.findByPk(row.requesterUserId, { transaction, lock: transaction.LOCK.SHARE });
          if (!activeUser(applicantUser) || applicantUser.email !== row.email) throw conflict('The applicant account changed or is unavailable. Review the account before preparing onboarding.', 'ACCESS_REQUEST_ACCOUNT_CHANGED');
        }
        const { version, ...onboardingInput } = input;
        invitation = await onboarding.create(actor, onboardingInput, transaction);
        if (invitation.delivery !== 'queued') throw new DomainError('The onboarding email could not be queued. The request is still pending; try again when email delivery is available.', { code: 'EMAIL_UNAVAILABLE', status: 503 });
      }
      const before = { status: row.status, version: row.version };
      await row.update({ status: approving ? 'approved' : 'declined', reviewedByUserId: actor, reviewedAt: now(), reviewReason: input.reason,
        organizationId: invitation?.organizationId || null, onboardingInvitationId: invitation?.id || null }, { transaction });
      await models.AuditLog.create({ actorUserId: actor, organizationId: row.organizationId, entityType: 'BusinessAccessRequest', entityId: row.id,
        action: `admin.business_access.${row.status}`, before, after: { status: row.status, adminReason: input.reason, onboardingInvitationId: invitation?.id || null } }, { transaction });
      return { request: row, ...(invitation ? { invitation } : {}) };
    }, { accessChange: true });
  }
  return { submit, mine, list, detail, approve: (actor,id,body) => review(actor,id,body,true), decline: (actor,id,body) => review(actor,id,body,false) };
}
module.exports = { createBusinessAccessRequestService };
