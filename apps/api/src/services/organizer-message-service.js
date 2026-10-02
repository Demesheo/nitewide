const { QueryTypes } = require('sequelize');
const { mutationTransaction } = require('./mutation-transaction');
const { assertActiveUser } = require('./lifecycle-service');
const { assertFinanceAccess } = require('./business-payment-account-service');
const { notFound, conflict } = require('../domain/errors');
const { paidBooking, canRequestRefund, assertRefundRequestOpen } = require('../domain/organizer-message-policy');
const schemas = require('../http/organizer-message-schemas');

// Conversation access is current organizer authority, not referral attribution.
// Ended/archived events retain their financial conversations; suspension and
// removal still revoke organizer access. Customers always see only their order.
const organizerAccessSql = `((t.organization_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM organizations org WHERE org.id=t.organization_id AND org.status='active' AND org.lifecycle_state='active') AND (
  EXISTS (SELECT 1 FROM organization_owners oo WHERE oo.organization_id=t.organization_id AND oo.user_id=:userId AND oo.lifecycle_state='active')
  OR EXISTS (SELECT 1 FROM venue_access va JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
    WHERE va.organization_id=t.organization_id AND va.location_id=e.location_id AND va.user_id=:userId AND va.status='active' AND va.role='manager')))
  OR (t.organization_id IS NULL AND e.creator_user_id=:userId AND EXISTS (SELECT 1 FROM users u WHERE u.id=:userId AND u.independent_creator=true)))`;
const unreadSql = `EXISTS (SELECT 1 FROM organizer_messages msg WHERE msg.thread_id=t.id AND msg.sender_side<>:side
  AND msg.created_at>COALESCE((SELECT tr.last_read_at FROM organizer_thread_reads tr WHERE tr.thread_id=t.id AND tr.user_id=:userId),'-infinity'::timestamptz))`;

function createOrganizerMessageService({ models, notifications, refunds, now = () => new Date() }) {
  const sequelize = models.Order?.sequelize || models.Event?.sequelize;
  const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const scope = side => side === 'customer' ? 't.customer_user_id=:userId' : organizerAccessSql;
  const transact = work => mutationTransaction(sequelize, work);
  const lockMessageKey = (userId, key, transaction) => sequelize.query(
    "SELECT pg_advisory_xact_lock(hashtextextended(:key,0))", { replacements: { key: `organizer-message/${userId}/${key}` }, transaction });
  async function actor(userId, transaction) {
    const user = await models.User.findByPk(userId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE } : {}) });
    assertActiveUser(user); return user;
  }
  async function allowed(userId, side, thread, transaction) {
    await actor(userId, transaction);
    const [result] = await select(`SELECT (${scope(side)}) AS allowed FROM organizer_threads t JOIN events e ON e.id=t.event_id WHERE t.id=:threadId`,
      { userId, side, threadId: thread.id }, transaction);
    if (!result?.allowed) throw notFound('Conversation');
  }
  const requestSummary = row => row ? { id: row.id, status: row.status, kind: row.kind, requestedAt: row.requestedAt,
    reason: row.reason, resolution: row.resolution || null, decisionKey: row.decisionKey || null } : null;
  const projection = `t.id,t.order_id AS "orderId",t.event_id AS "eventId",e.title AS "eventTitle",
    org.name AS "organizationName",buyer.display_name AS "customerName",t.last_message_at AS "lastMessageAt",
    t.last_message_preview AS "lastMessagePreview",${unreadSql} AS unread,
    CASE WHEN rr.id IS NULL THEN NULL ELSE jsonb_build_object('id',rr.id,'status',rr.status,'kind',rr.kind,
      'requestedAt',rr.requested_at,'reason',rr.reason,'resolution',rr.resolution,'decisionKey',rr.decision_key) END AS "refundRequest"`;
  const joins = `FROM organizer_threads t JOIN events e ON e.id=t.event_id JOIN users buyer ON buyer.id=t.customer_user_id
    LEFT JOIN organizations org ON org.id=t.organization_id LEFT JOIN order_refund_requests rr ON rr.order_id=t.order_id`;
  async function list(userId, side, input = {}) {
    const { page, pageSize } = schemas.pageQuery.parse(input);
    return transact(async transaction => {
      await actor(userId, transaction);
      const values = { userId, side, pageSize, offset: (page - 1) * pageSize };
      const [totals] = await select(`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER (WHERE ${unreadSql})::integer AS "unreadCount" ${joins} WHERE ${scope(side)}`, values, transaction);
      const items = await select(`SELECT ${projection} ${joins} WHERE ${scope(side)} ORDER BY t.last_message_at DESC,t.id DESC LIMIT :pageSize OFFSET :offset`, values, transaction);
      return { items, total: totals.total, unreadCount: totals.unreadCount, page, pageSize, hasMore: page * pageSize < totals.total };
    });
  }
  async function detailInTransaction(userId, side, threadId, input, transaction) {
    const { page, pageSize } = schemas.pageQuery.parse(input);
    const thread = await models.OrganizerThread.findByPk(threadId, { transaction });
    if (!thread) throw notFound('Conversation');
    await allowed(userId, side, thread, transaction);
    const values = { userId, side, threadId, pageSize, offset: (page - 1) * pageSize };
    const [summary] = await select(`SELECT ${projection} ${joins} WHERE t.id=:threadId`, values, transaction);
    const total = await models.OrganizerMessage.count({ where: { threadId }, transaction });
    const items = await select(`SELECT msg.id,u.display_name AS "senderName",msg.sender_side AS "senderSide",msg.body,msg.kind,msg.created_at AS "createdAt"
      FROM organizer_messages msg JOIN users u ON u.id=msg.sender_user_id WHERE msg.thread_id=:threadId
      ORDER BY msg.created_at DESC,msg.id DESC LIMIT :pageSize OFFSET :offset`, values, transaction);
    const order = await models.Order.findByPk(thread.orderId, { transaction });
    const event = await models.Event.findByPk(thread.eventId, { transaction });
    let canResolveRefund = false;
    if (side === 'business' && thread.organizationId) {
      try { await assertFinanceAccess(models, userId, thread.organizationId, transaction); canResolveRefund = ['pending','approved'].includes(summary.refundRequest?.status); }
      catch (error) { if (error.status !== 403) throw error; }
    }
    return { thread: summary, messages: { items: items.reverse(), total, page, pageSize, hasMore: page * pageSize < total },
      canReply: true, canRequestRefund: side === 'customer' && !summary.refundRequest && canRequestRefund(order, event, now()), canResolveRefund: Boolean(canResolveRefund) };
  }
  const detail = (userId, side, threadId, input = {}) => transact(transaction => detailInTransaction(userId, side, threadId, input, transaction));
  async function readInTransaction(userId, thread, transaction) {
    const existing = await models.OrganizerThreadRead.findOne({ where: { threadId: thread.id, userId }, transaction });
    if (existing) await existing.update({ lastReadAt: thread.lastMessageAt }, { transaction });
    else await models.OrganizerThreadRead.create({ threadId: thread.id, userId, lastReadAt: thread.lastMessageAt }, { transaction });
  }
  async function markRead(userId, side, threadId) {
    return transact(async transaction => {
      const thread = await models.OrganizerThread.findByPk(threadId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!thread) throw notFound('Conversation');
      await allowed(userId, side, thread, transaction);
      await readInTransaction(userId, thread, transaction);
      return { read: true };
    });
  }
  async function notify(thread, senderSide, messageId, transaction) {
    const metadata = { threadId: thread.id, orderId: thread.orderId, messageId };
    if (senderSide === 'business') {
      await notifications?.emit({ userId: thread.customerUserId, eventId: thread.eventId, kind: 'organizer_message',
        title: 'Organizer replied', message: 'You have a new message about your booking. Open Messages to read it.', metadata }, transaction);
    } else {
      // Bounded database fan-out: no email, no external calls, no per-recipient
      // loading. The recipient's current scope is rechecked when opening it.
      await sequelize.query(`INSERT INTO notifications(id,user_id,event_id,kind,title,message,metadata,created_at,updated_at)
        SELECT gen_random_uuid(),u.id,:eventId,'organizer_message','New booking message',
          'A customer sent a message about their booking. Open Messages to reply.',CAST(:metadata AS jsonb),:now,:now
        FROM users u WHERE u.is_active=true AND u.lifecycle_state='active' AND u.id<>:senderId AND (
          EXISTS (SELECT 1 FROM organizer_threads t JOIN events e ON e.id=t.event_id WHERE t.id=:threadId AND ${organizerAccessSql.replaceAll(':userId', 'u.id')}))`,
      { replacements: { eventId: thread.eventId, metadata: JSON.stringify(metadata), now: now(), senderId: thread.customerUserId, threadId: thread.id }, transaction });
    }
  }
  async function persistMessage(userId, side, thread, input, kind, transaction) {
    const previous = await models.OrganizerMessage.findOne({ where: { senderUserId: userId, idempotencyKey: input.idempotencyKey }, transaction });
    if (previous) {
      if (previous.threadId !== thread.id || previous.body !== input.body || previous.kind !== kind || previous.senderSide !== side) throw conflict('Message retry does not match the original message.', 'MESSAGE_IDEMPOTENCY_CONFLICT');
      return previous;
    }
    const timestamp = new Date(Math.max(+now(), +new Date(thread.lastMessageAt) + 1));
    const message = await models.OrganizerMessage.create({ threadId: thread.id, senderUserId: userId, senderSide: side, body: input.body,
      kind, idempotencyKey: input.idempotencyKey, createdAt: timestamp, updatedAt: timestamp }, { transaction });
    await thread.update({ lastMessageAt: timestamp, lastMessagePreview: input.body.slice(0, 200) }, { transaction });
    await readInTransaction(userId, thread, transaction);
    await notify(thread, side, message.id, transaction);
    return message;
  }
  async function lockBooking(orderId, transaction) {
    const initial = await models.Order.findByPk(orderId, { transaction });
    if (!initial) throw notFound('Booking');
    const event = await models.Event.findByPk(initial.eventId, { transaction, lock: transaction.LOCK.UPDATE });
    const order = await models.Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!event || !paidBooking(order)) throw notFound('Booking');
    return { order, event };
  }
  async function contact(userId, orderId, body) {
    const input = schemas.sendMessage.parse(body);
    const threadId = await transact(async transaction => {
      await actor(userId, transaction);
      await lockMessageKey(userId, input.idempotencyKey, transaction);
      const { order, event } = await lockBooking(orderId, transaction);
      if (order.buyerUserId !== userId) throw notFound('Booking');
      let thread = await models.OrganizerThread.findOne({ where: { orderId }, transaction, lock: transaction.LOCK.UPDATE });
      const previous = await models.OrganizerMessage.findOne({ where: { senderUserId: userId, idempotencyKey: input.idempotencyKey }, transaction });
      if (previous) {
        if (!thread || previous.threadId !== thread.id || previous.body !== input.body || previous.kind !== input.kind) throw conflict('Message retry does not match the original message.', 'MESSAGE_IDEMPOTENCY_CONFLICT');
        return thread.id;
      }
      if (input.kind !== 'question') assertRefundRequestOpen(order, event, now());
      if (!thread) thread = await models.OrganizerThread.create({ orderId, eventId: event.id, organizationId: event.organizationId,
        customerUserId: userId, lastMessageAt: now(), lastMessagePreview: input.body.slice(0, 200) }, { transaction });
      if (input.kind !== 'question') {
        const existing = await models.OrderRefundRequest.findOne({ where: { orderId }, transaction });
        if (existing) throw conflict('An organizer refund request already exists. Reply in the conversation instead.', 'REFUND_REQUEST_EXISTS');
        await models.OrderRefundRequest.create({ orderId, threadId: thread.id, customerUserId: userId, kind: input.kind,
          reason: input.body, requestedAt: now() }, { transaction });
        await require('./commission-ledger-service').createCommissionLedgerService({ models, sequelize, now }).setRefundHold({ orderId, hold: true, transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Order', entityId: orderId,
          action: 'order.organizer_refund_requested', after: { threadId: thread.id, kind: input.kind, timely: true } }, { transaction });
      }
      await persistMessage(userId, 'customer', thread, input, input.kind, transaction);
      return thread.id;
    });
    return detail(userId, 'customer', threadId);
  }
  async function reply(userId, side, threadId, body) {
    const input = schemas.replyMessage.parse(body);
    await transact(async transaction => {
      await actor(userId, transaction);
      await lockMessageKey(userId, input.idempotencyKey, transaction);
      const initial = await models.OrganizerThread.findByPk(threadId, { transaction });
      if (!initial) throw notFound('Conversation');
      await allowed(userId, side, initial, transaction);
      await lockBooking(initial.orderId, transaction);
      const thread = await models.OrganizerThread.findByPk(threadId, { transaction, lock: transaction.LOCK.UPDATE });
      await persistMessage(userId, side, thread, input, 'reply', transaction);
    });
    return detail(userId, side, threadId);
  }
  async function resolve(userId, orderId, body) {
    const input = schemas.resolveRequest.parse(body);
    const request = await transact(async transaction => {
      await actor(userId, transaction);
      await lockMessageKey(userId, input.idempotencyKey, transaction);
      const { order, event } = await lockBooking(orderId, transaction);
      await assertFinanceAccess(models, userId, event.organizationId, transaction);
      const pending = await models.OrderRefundRequest.findOne({ where: { orderId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!pending) throw notFound('Refund request');
      if (pending.status !== 'pending') {
        if (pending.decisionKey !== input.idempotencyKey || pending.resolution !== input.reason ||
          (input.decision === 'deny' ? pending.status !== 'denied' : !['approved', 'resolved'].includes(pending.status))) throw conflict('This refund request already has a different decision.', 'REFUND_DECISION_CONFLICT');
        return pending;
      }
      if (input.decision === 'approve' && !refunds) throw conflict('Verified refund processing is unavailable.', 'PAYMENTS_NOT_ENABLED');
      await pending.update({ status: input.decision === 'deny' ? 'denied' : 'approved', decisionKey: input.idempotencyKey,
        resolution: input.reason, reviewedAt: now(), reviewedByUserId: userId }, { transaction });
      if (input.decision === 'deny') await require('./commission-ledger-service').createCommissionLedgerService({ models, sequelize, now }).setRefundHold({ orderId, hold: false, transaction });
      const thread = await models.OrganizerThread.findByPk(pending.threadId, { transaction, lock: transaction.LOCK.UPDATE });
      await persistMessage(userId, 'business', thread, { body: `Your ${pending.kind} request was ${input.decision === 'deny' ? 'declined' : 'approved'}. ${input.reason}`, idempotencyKey: input.idempotencyKey }, 'reply', transaction);
      await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'OrderRefundRequest', entityId: pending.id,
        action: `organizer_refund.${pending.status}`, after: { orderId, decision: input.decision } }, { transaction });
      return pending;
    });
    if (request.status === 'denied' || request.status === 'resolved') return { request: requestSummary(request), refund: null };
    // No provider calls while holding organizer, event, order, or ledger locks.
    const result = await refunds.requestRefund(userId, orderId, { reason: `Organizer-approved request ${request.id}: ${request.resolution}`.slice(0, 500), idempotencyKey: `organizer-refund/${request.id}` });
    if (result.status === 'succeeded') await models.OrderRefundRequest.update({ status: 'resolved' }, { where: { id: request.id, status: 'approved' } });
    await request.reload();
    return { request: requestSummary(request), refund: result };
  }
  return { list, detail, contact, reply, markRead, resolve };
}
module.exports = { createOrganizerMessageService, organizerAccessSql, unreadSql };
