const { Op, Transaction } = require('sequelize');
const { conflict, notFound, DomainError } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
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
  async function submit(body) {
    const input = schemas.requestAccess.parse(body);
    await db.transaction(async transaction => {
      // Serialize same-contact requests without revealing account or queue state.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended(:email, 10427))', { replacements: { email: input.email }, transaction });
      const existing = await models.BusinessAccessRequest.findOne({ where: { email: input.email, status: 'pending' }, transaction });
      if (existing) return;
      const row = await models.BusinessAccessRequest.create(input, { transaction });
      await models.AuditLog.create({ actorUserId: null, entityType: 'BusinessAccessRequest', entityId: row.id, action: 'business.access.requested', after: { status: 'pending' } }, { transaction });
    });
    return RECEIVED;
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
      const { rows, count } = await models.BusinessAccessRequest.findAndCountAll({ where, order: [['createdAt','ASC'],['id','ASC']], limit: input.pageSize, offset: (input.page - 1) * input.pageSize, transaction });
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
  return { submit, list, detail, approve: (actor,id,body) => review(actor,id,body,true), decline: (actor,id,body) => review(actor,id,body,false) };
}
module.exports = { createBusinessAccessRequestService };
