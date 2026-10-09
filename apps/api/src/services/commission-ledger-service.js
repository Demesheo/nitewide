const { Op, QueryTypes } = require('sequelize');
const { conflict, notFound, DomainError } = require('../domain/errors');
const { COMMISSION_SETTLEMENT_DELAY_MS, proportionalRefund } = require('../domain/commission-policy');
const { mutationTransaction, authorizationFence } = require('./mutation-transaction');

const numbers = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith('Cents') ? Number(value || 0) : value]));
const totalsSql = `COALESCE(SUM(e.original_commission_cents),0)::bigint AS "originalCommissionCents",
  COALESCE(SUM(e.unpaid_commission_cents),0)::bigint AS "unpaidCommissionCents",
  COALESCE(SUM(e.paid_commission_cents),0)::bigint AS "paidCommissionCents",
  COALESCE(SUM(e.refunded_commission_cents),0)::bigint AS "refundedCommissionCents",
  COALESCE(SUM(e.reserved_commission_cents),0)::bigint AS "reservedCommissionCents",
  COALESCE(SUM(e.business_loss_cents),0)::bigint AS "businessLossCents",
  COALESCE(SUM(CASE WHEN e.refund_hold OR e.dispute_hold THEN e.unpaid_commission_cents-e.reserved_commission_cents ELSE 0 END),0)::bigint AS "heldCommissionCents",
  COALESCE(SUM(CASE WHEN NOT e.refund_hold AND NOT e.dispute_hold AND s.available_at<=:current
    AND EXISTS (SELECT 1 FROM events maturity WHERE maturity.id=s.event_id AND maturity.ends_at+INTERVAL '48 hours'<=:current)
    THEN e.unpaid_commission_cents-e.reserved_commission_cents ELSE 0 END),0)::bigint AS "payableCommissionCents"`;
function createCommissionLedgerService({ sequelize, models, now = () => new Date() }) {
  const inTransaction = async (transaction, work) => {
    if (!transaction) return mutationTransaction(sequelize, work);
    await authorizationFence(sequelize, transaction);
    return work(transaction);
  };
  const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  async function recordPaidOrder({ order, event, transaction }) {
    if (!models.CommissionEarning || order.status !== 'paid' || order.providerVerificationStatus !== 'verified'
      || !['test', 'live'].includes(order.providerMode) || order.pricingPlanSnapshot?.demo === true || !order.stripePaymentIntentId) return null;
    const snapshot = order.commissionSnapshot;
    if (snapshot?.version !== 1 || snapshot.commissionEligibility?.eligible !== true || snapshot.effectiveCommissionBps <= 0
      || !snapshot.organizationId || !snapshot.recipientUserId || !snapshot.individualCommissionProfileId || !snapshot.stripeAccountId
      || snapshot.eligibleSubtotalCents < snapshot.minimumSubtotalCents || order.affiliateCommissionCents <= 0) return null;
    return inTransaction(transaction, async (tx) => {
      const availableAt = new Date(new Date(event.endsAt).getTime() + COMMISSION_SETTLEMENT_DELAY_MS);
      const [statement] = await models.CommissionStatement.findOrCreate({ where: { organizationId: snapshot.organizationId, eventId: order.eventId,
        recipientUserId: snapshot.recipientUserId, currency: order.currency }, defaults: { eventTitle: snapshot.eventTitle || event.title, availableAt }, transaction: tx });
      const [earning] = await models.CommissionEarning.findOrCreate({ where: { orderId: order.id }, defaults: {
        organizationId: snapshot.organizationId, eventId: order.eventId, recipientUserId: snapshot.recipientUserId, statementId: statement.id,
        currency: order.currency, originalCommissionCents: order.affiliateCommissionCents, unpaidCommissionCents: order.affiliateCommissionCents, snapshot,
      }, transaction: tx });
      return earning;
    });
  }
  async function setRefundHold({ orderId, hold, transaction }) {
    return inTransaction(transaction, async (tx) => {
      if (hold) {
        const identity = await models.CommissionEarning.findOne({ where: { orderId }, attributes: ['eventId'], transaction: tx });
        if (identity && models.Event.findByPk) await models.Event.findByPk(identity.eventId, { transaction: tx, lock: tx.LOCK.UPDATE });
        await invalidateReservedPayments(orderId, 'purchase_refund_request', tx);
      }
      const earning = await models.CommissionEarning.findOne({ where: { orderId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (earning && earning.refundHold !== Boolean(hold)) await earning.update({ refundHold: Boolean(hold) }, { transaction: tx });
      return earning;
    });
  }
  async function setDisputeHold({ orderId, hold, transaction }) {
    return inTransaction(transaction, async (tx) => {
      if (hold) {
        const identity = await models.CommissionEarning.findOne({ where: { orderId }, attributes: ['eventId'], transaction: tx });
        if (identity && models.Event.findByPk) await models.Event.findByPk(identity.eventId, { transaction: tx, lock: tx.LOCK.UPDATE });
        await invalidateReservedPayments(orderId, 'purchase_dispute', tx);
      }
      const earning = await models.CommissionEarning.findOne({ where: { orderId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (earning && earning.disputeHold !== Boolean(hold)) await earning.update({ disputeHold: Boolean(hold) }, { transaction: tx });
      return earning;
    });
  }
  async function invalidateReservedPayments(orderId, reason, transaction) {
    if (!models.CommissionPayment) return;
    if (typeof sequelize.query === 'function') {
      const values = { orderId, current: now(), reason };
      // Payment first, then earning, matching execution settlement. The event
      // fence held by the caller excludes a new allocation while we discover
      // affected payments. Do not settle/release an unknown provider outcome.
      await select(`SELECT COUNT(*)::integer FROM (SELECT p.id FROM commission_payments p
        WHERE EXISTS (SELECT 1 FROM commission_allocations a JOIN commission_earnings e ON e.id=a.earning_id
          WHERE a.payment_id=p.id AND a.status='reserved' AND e.order_id=:orderId) ORDER BY p.id FOR UPDATE OF p) locked`, values, transaction);
      await sequelize.query(`UPDATE commission_payments p SET invalidated_at=COALESCE(p.invalidated_at,:current),
        invalidation_reason=:reason,reconciliation_token=NULL,updated_at=:current
        WHERE NOT (p.provider_verification_status='verified' AND p.status IN ('paid','paid_fee_review','reversed')
          AND p.provider_charge_id IS NOT NULL AND p.provider_balance_transaction_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM commission_allocations a JOIN commission_earnings e ON e.id=a.earning_id
          WHERE a.payment_id=p.id AND a.status='reserved' AND e.order_id=:orderId)`, { replacements: values, transaction });
      return;
    }
    const identity = await models.CommissionEarning.findOne({ where: { orderId }, transaction });
    if (!identity) return;
    const allocations = await models.CommissionAllocation.findAll({ where: { earningId: identity.id, status: 'reserved' }, transaction });
    if (!allocations.length) return;
    const payments = await models.CommissionPayment.findAll({ where: { id: { [Op.in]: allocations.map(a => a.paymentId) } },
      order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    for (const payment of payments) {
      const funded = payment.providerVerificationStatus === 'verified' && ['paid', 'paid_fee_review', 'reversed'].includes(payment.status)
        && payment.providerChargeId && payment.providerBalanceTransactionId;
      if (!funded) await payment.update({ invalidatedAt: payment.invalidatedAt || now(), invalidationReason: reason, reconciliationToken: null }, { transaction });
    }
  }
  async function adjustRefund({ order, refundId, cumulativeRefundedTotalCents, transaction }) {
    return inTransaction(transaction, async (tx) => {
      const values = proportionalRefund({ subtotalCents: order.subtotalCents, totalCents: order.totalCents,
        originalCommissionCents: order.affiliateCommissionCents || 0, cumulativeRefundedTotalCents });
      if (values.refundedTotalCents < (order.refundedTotalCents || 0)) return order;
      // Event -> affected payment -> earning agrees with reserve and execution.
      // Refund callers already hold the event lock; direct callers acquire it.
      if (models.Event.findByPk) await models.Event.findByPk(order.eventId, { transaction: tx, lock: tx.LOCK.UPDATE });
      if (values.refundedCommissionCents > (order.refundedCommissionCents || 0)) await invalidateReservedPayments(order.id, 'purchase_refund', tx);
      const earning = await models.CommissionEarning.findOne({ where: { orderId: order.id }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (earning) {
        const delta = Math.max(0, values.refundedCommissionCents - earning.refundedCommissionCents);
        const reduction = Math.min(delta, earning.unpaidCommissionCents - earning.reservedCommissionCents);
        // An invalidated reserved invoice retains unknown provider obligations
        // until verified void/release. Release then restores only reduced unpaid
        // entitlement; already received funds remain a business loss.
        await earning.update({ unpaidCommissionCents: earning.unpaidCommissionCents - reduction,
          refundedCommissionCents: values.refundedCommissionCents, businessLossCents: earning.businessLossCents + delta - reduction }, { transaction: tx });
      }
      await order.update(values, { transaction: tx });
      if (models.AuditLog && refundId) await models.AuditLog.create({ entityType: 'Order', entityId: order.id,
        organizationId: order.commissionSnapshot?.organizationId || null, action: 'commission.refund_adjusted', after: { refundId, ...values } }, { transaction: tx });
      return order;
    });
  }
  const selection = ({ statementIds, eventIds }) => {
    const ids = statementIds || eventIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length)
      throw new DomainError('Select between 1 and 100 distinct event statements.', { code: 'INVALID_COMMISSION_STATEMENTS', status: 422 });
    return { [statementIds ? 'id' : 'eventId']: { [Op.in]: ids } };
  };
  async function lockedStatements(input, transaction) {
    const where = { organizationId: input.organizationId, recipientUserId: input.recipientUserId, currency: input.currency, ...selection(input) };
    const identities = await models.CommissionStatement.findAll({ where, attributes: ['id', 'eventId'], order: [['eventId', 'ASC']], transaction });
    if (identities.length !== (input.statementIds || input.eventIds).length) throw notFound('Commission statement');
    // Event first, then statement, then earnings, matching purchase/refund order.
    const events = await models.Event.findAll({ where: { id: { [Op.in]: identities.map((row) => row.eventId) } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.SHARE || 'SHARE' });
    const statements = await models.CommissionStatement.findAll({ where, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    for (const statement of statements) {
      const event = events.find((e) => e.id === statement.eventId);
      if (!event || new Date(event.endsAt).getTime() + COMMISSION_SETTLEMENT_DELAY_MS > now().getTime())
        throw conflict('Commission becomes payable 48 hours after the event ends.', 'COMMISSION_SETTLEMENT_PENDING');
    }
    return statements;
  }
  async function approveStatements(input) {
    return inTransaction(input.transaction, async (transaction) => {
      const statements = await lockedStatements(input, transaction);
      for (const statement of statements) {
        if (new Date(statement.availableAt) > now()) throw conflict('Commission becomes payable 48 hours after the event ends.', 'COMMISSION_SETTLEMENT_PENDING');
        if (!statement.approvedAt) await statement.update({ status: 'approved', approvedAt: now(), approvedByUserId: input.approvedByUserId }, { transaction });
      }
      return statements;
    });
  }
  async function assertStatementMode({ statementIds, providerMode, transaction }) {
    selection({ statementIds });
    if (!['test', 'live'].includes(providerMode)) throw conflict('Commission statements require a known payment environment.', 'COMMISSION_MODE_MISMATCH');
    if (typeof sequelize.query === 'function') {
      const mismatches = await select(`SELECT e.id FROM commission_earnings e LEFT JOIN orders o ON o.id=e.order_id
        WHERE e.statement_id IN (:statementIds) AND o.provider_mode IS DISTINCT FROM :providerMode LIMIT 1`, { statementIds, providerMode }, transaction);
      if (mismatches.length) throw conflict('These statements contain purchases from another payment environment and require separate finance review.', 'COMMISSION_MODE_MISMATCH');
      return;
    }
    const earnings = await models.CommissionEarning.findAll({ where: { statementId: { [Op.in]: statementIds } }, transaction });
    const orders = await models.Order.findAll({ where: { id: { [Op.in]: earnings.map(e => e.orderId) } }, transaction });
    if (earnings.some(e => orders.find(o => o.id === e.orderId)?.providerMode !== providerMode)) throw conflict('These statements contain purchases from another payment environment and require separate finance review.', 'COMMISSION_MODE_MISMATCH');
  }
  async function reserveStatements(input) {
    return inTransaction(input.transaction, async (transaction) => {
      const statements = await lockedStatements(input, transaction);
      for (const statement of statements) {
        if (!statement.approvedAt || new Date(statement.availableAt) > now()) throw conflict('Approve a mature event statement before payment.', 'COMMISSION_STATEMENT_NOT_APPROVED');
      }
      const providerMode = input.providerMode ?? 'test';
      await assertStatementMode({ statementIds: statements.map(s => s.id), providerMode, transaction });
      if (typeof sequelize.query === 'function') {
        const values = { paymentId: input.paymentId, statementIds: statements.map((s) => s.id), current: now(), providerMode };
        const [payment] = await select('SELECT provider_mode AS "providerMode" FROM commission_payments WHERE id=:paymentId', values, transaction);
        if (payment?.providerMode !== providerMode) throw conflict('Commission payment environment changed.', 'COMMISSION_MODE_MISMATCH');
        const [existing] = await select(`SELECT COUNT(*)::integer AS count,
          COUNT(*) FILTER (WHERE status<>'reserved' OR statement_id NOT IN (:statementIds))::integer AS invalid
          FROM commission_allocations WHERE payment_id=:paymentId`, values, transaction);
        if (existing.invalid) throw conflict('This commission payment has already been resolved.', 'COMMISSION_PAYMENT_RESOLVED');
        let rows;
        if (existing.count) {
          rows = await select(`SELECT statement_id AS "statementId",SUM(amount_cents)::bigint AS "amountCents",COUNT(*)::integer AS "allocationCount"
            FROM commission_allocations WHERE payment_id=:paymentId GROUP BY statement_id`, values, transaction);
        } else {
          // Lock and allocate every eligible earning inside PostgreSQL. Only the
          // <=100 event totals cross the process boundary; large event histories
          // do not need an artificial cap or an in-memory earning collection.
          rows = await select(`WITH eligible AS MATERIALIZED (
            SELECT e.id,e.statement_id,e.unpaid_commission_cents-e.reserved_commission_cents AS amount
            FROM commission_earnings e JOIN orders o ON o.id=e.order_id
            WHERE e.statement_id IN (:statementIds) AND o.provider_mode=:providerMode AND NOT e.refund_hold AND NOT e.dispute_hold
              AND e.unpaid_commission_cents>e.reserved_commission_cents ORDER BY e.id FOR UPDATE OF e
          ), inserted AS (
            INSERT INTO commission_allocations(id,payment_id,statement_id,earning_id,amount_cents,status,created_at,updated_at)
            SELECT gen_random_uuid(),:paymentId,statement_id,id,amount,'reserved',:current,:current FROM eligible
            RETURNING earning_id,statement_id,amount_cents
          ), changed AS (
            UPDATE commission_earnings e SET reserved_commission_cents=e.reserved_commission_cents+i.amount_cents,updated_at=:current
            FROM inserted i WHERE e.id=i.earning_id RETURNING i.statement_id,i.amount_cents
          ) SELECT statement_id AS "statementId",SUM(amount_cents)::bigint AS "amountCents",COUNT(*)::integer AS "allocationCount"
            FROM changed GROUP BY statement_id`, values, transaction);
        }
        const selected = statements.map((s) => ({ id: s.id, eventId: s.eventId, eventTitle: s.eventTitle, currency: s.currency,
          amountCents: Number(rows.find((r) => r.statementId === s.id)?.amountCents || 0) }));
        const amountCents = selected.reduce((sum, s) => sum + s.amountCents, 0);
        if (!amountCents) throw conflict('No unheld commission is available in these statements.', 'NO_PAYABLE_COMMISSION');
        return { statements: selected, allocationCount: rows.reduce((sum, r) => sum + r.allocationCount, 0), amountCents, totalCents: amountCents };
      }
      // Narrow unit fixtures have no SQL connection. They exercise the same
      // balance transitions through their row repository without domain SQL.
      const existing = await models.CommissionAllocation.findAll({ where: { paymentId: input.paymentId }, order: [['earningId', 'ASC']], transaction });
      const earnings = await models.CommissionEarning.findAll({ where: { statementId: { [Op.in]: statements.map((row) => row.id) } },
        order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      if (existing.some((a) => !statements.some((s) => s.id === a.statementId) || a.status !== 'reserved')) throw conflict('This commission payment has already been resolved.', 'COMMISSION_PAYMENT_RESOLVED');
      const allocations = existing.length ? existing : [];
      if (!existing.length) {
        for (const earning of earnings) {
          const amountCents = earning.unpaidCommissionCents - earning.reservedCommissionCents;
          if (earning.refundHold || earning.disputeHold || amountCents <= 0) continue;
          allocations.push(await models.CommissionAllocation.create({ paymentId: input.paymentId, statementId: earning.statementId,
            earningId: earning.id, amountCents }, { transaction }));
          await earning.update({ reservedCommissionCents: earning.reservedCommissionCents + amountCents }, { transaction });
        }
      }
      const selected = statements.map((statement) => {
        const items = allocations.filter((a) => a.statementId === statement.id).map((a) => ({ id: a.earningId,
          orderId: earnings.find((e) => e.id === a.earningId)?.orderId, amountCents: a.amountCents,
          snapshot: earnings.find((e) => e.id === a.earningId)?.snapshot }));
        return { id: statement.id, eventId: statement.eventId, eventTitle: statement.eventTitle, currency: statement.currency,
          amountCents: items.reduce((sum, item) => sum + item.amountCents, 0), earnings: items };
      });
      const amountCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
      if (!amountCents) throw conflict('No unheld commission is available in these statements.', 'NO_PAYABLE_COMMISSION');
      return { statements: selected, allocations, amountCents, totalCents: amountCents };
    });
  }
  async function finishPayment({ paymentId, paid, settledAmountCents, transaction }) {
    if (settledAmountCents !== undefined && (!paid || !Number.isSafeInteger(settledAmountCents) || settledAmountCents < 0)) throw new RangeError('Invalid settled commission amount');
    return inTransaction(transaction, async (tx) => {
      if (models.CommissionPayment?.findByPk) await models.CommissionPayment.findByPk(paymentId, { transaction: tx, lock: tx.LOCK.UPDATE });
      if (typeof sequelize.query === 'function') {
        const values = { paymentId, current: now() };
        // Match reservation/refund locks: earnings in id order before allocation
        // rows. Aggregate lock subqueries return a single row, even for huge
        // events, while protecting all affected balances in this transaction.
        await select(`SELECT COUNT(*)::integer FROM (SELECT e.id FROM commission_earnings e
          WHERE EXISTS (SELECT 1 FROM commission_allocations a WHERE a.payment_id=:paymentId AND a.earning_id=e.id)
          ORDER BY e.id FOR UPDATE OF e) locked`, values, tx);
        await select(`SELECT COUNT(*)::integer FROM (SELECT a.id FROM commission_allocations a
          WHERE a.payment_id=:paymentId ORDER BY a.earning_id FOR UPDATE OF a) locked`, values, tx);
        const [state] = await select(`SELECT COUNT(*)::integer AS count,COUNT(*) FILTER (WHERE status='reserved')::integer AS reserved,
          COUNT(*) FILTER (WHERE status='paid')::integer AS paid,COUNT(*) FILTER (WHERE status='released')::integer AS released
          ,COALESCE(SUM(amount_cents),0)::bigint AS amount,COALESCE(SUM(paid_amount_cents),0)::bigint AS credited
          FROM commission_allocations WHERE payment_id=:paymentId`, values, tx);
        if (paid ? state.released : state.paid) throw conflict('Commission payment resolution conflicts with its durable allocations.', 'COMMISSION_PAYMENT_RESOLVED');
        const amount = Number(state.amount), credit = paid ? settledAmountCents ?? amount : 0;
        if (!Number.isSafeInteger(amount) || credit > amount) throw new RangeError('Invalid settled commission amount');
        if (state.paid && settledAmountCents !== undefined && Number(state.credited) !== settledAmountCents)
          throw conflict('Commission payment was settled with a different credited amount.', 'COMMISSION_PAYMENT_RESOLVED');
        const [mismatch] = await select(`SELECT COUNT(*)::integer AS count FROM commission_earnings e JOIN (
          SELECT earning_id,SUM(amount_cents)::integer AS amount FROM commission_allocations
          WHERE payment_id=:paymentId AND status='reserved' GROUP BY earning_id) used ON used.earning_id=e.id
          WHERE e.reserved_commission_cents<used.amount`, values, tx);
        if (mismatch.count) throw conflict('Commission allocation needs review.', 'COMMISSION_ALLOCATION_MISMATCH');
        if (state.reserved) {
          const reservedBalance = 'e.reserved_commission_cents-used.amount';
          const paidBalance = 'e.paid_commission_cents+used.credit';
          const unpaidBalance = `GREATEST(${reservedBalance},e.original_commission_cents-(${paidBalance})-e.refunded_commission_cents)`;
          // Cumulative proportional floors allocate every cent deterministically
          // without floating point or materializing an event's order history.
          // Approved allocation amounts stay immutable; actual credits are separate.
          await sequelize.query(`WITH ordered AS (
            SELECT id,amount_cents, SUM(amount_cents) OVER (ORDER BY earning_id,id)::numeric AS cumulative,
              SUM(amount_cents) OVER ()::numeric AS total FROM commission_allocations WHERE payment_id=:paymentId AND status='reserved'
          ), credits AS (
            SELECT id,(FLOOR(cumulative * :credit / total)-FLOOR((cumulative-amount_cents) * :credit / total))::integer AS credit FROM ordered
          ), resolved AS (
            UPDATE commission_allocations a SET status=:status,paid_amount_cents=CASE WHEN :paid THEN c.credit ELSE NULL END,
              paid_at=CASE WHEN :paid THEN :current ELSE a.paid_at END,
              released_at=CASE WHEN NOT :paid OR c.credit<a.amount_cents THEN :current ELSE a.released_at END,updated_at=:current
            FROM credits c WHERE a.id=c.id RETURNING a.earning_id,a.amount_cents,c.credit
          ), used AS (SELECT earning_id,SUM(amount_cents)::integer AS amount,SUM(credit)::integer AS credit FROM resolved GROUP BY earning_id)
          UPDATE commission_earnings e SET reserved_commission_cents=${reservedBalance},paid_commission_cents=${paidBalance},
            unpaid_commission_cents=${unpaidBalance},business_loss_cents=(${unpaidBalance})+(${paidBalance})+e.refunded_commission_cents-e.original_commission_cents,updated_at=:current
            FROM used WHERE e.id=used.earning_id`, { replacements: { ...values, credit, paid, status: paid ? 'paid' : 'released' }, transaction: tx });
        }
        const [remaining] = await select(`SELECT COALESCE(SUM(LEAST(used.remainder,GREATEST(0,e.unpaid_commission_cents-e.reserved_commission_cents))),0)::bigint AS amount
          FROM commission_earnings e JOIN (SELECT earning_id,SUM(amount_cents-COALESCE(paid_amount_cents,0))::bigint AS remainder
            FROM commission_allocations WHERE payment_id=:paymentId GROUP BY earning_id) used ON e.id=used.earning_id`, values, tx);
        return { allocationCount: state.count, paid, settledAmountCents: state.reserved ? credit : Number(state.credited),
          releasedAmountCents: amount - (state.reserved ? credit : Number(state.credited)), remainingCommissionCents: Number(remaining.amount) };
      }
      const identities = await models.CommissionAllocation.findAll({ where: { paymentId }, order: [['earningId', 'ASC']], transaction: tx });
      const earnings = await models.CommissionEarning.findAll({ where: { id: { [Op.in]: identities.map((a) => a.earningId) } }, order: [['id', 'ASC']], transaction: tx, lock: tx.LOCK.UPDATE });
      const allocations = await models.CommissionAllocation.findAll({ where: { paymentId }, order: [['earningId', 'ASC']], transaction: tx, lock: tx.LOCK.UPDATE });
      if (allocations.some((a) => paid ? a.status === 'released' : a.status === 'paid')) throw conflict('Commission payment resolution conflicts with its durable allocations.', 'COMMISSION_PAYMENT_RESOLVED');
      const total = allocations.reduce((sum, a) => sum + a.amountCents, 0), credit = paid ? settledAmountCents ?? total : 0;
      if (!Number.isSafeInteger(total) || credit > total) throw new RangeError('Invalid settled commission amount');
      if (allocations.some(a => a.status === 'paid') && settledAmountCents !== undefined
        && allocations.reduce((sum, a) => sum + (a.paidAmountCents || 0), 0) !== settledAmountCents)
        throw conflict('Commission payment was settled with a different credited amount.', 'COMMISSION_PAYMENT_RESOLVED');
      let cumulative = 0;
      for (const allocation of allocations) {
        const before = cumulative; cumulative += allocation.amountCents;
        if (allocation.status !== 'reserved') continue;
        const paidAmountCents = total ? Number(BigInt(cumulative) * BigInt(credit) / BigInt(total) - BigInt(before) * BigInt(credit) / BigInt(total)) : 0;
        const earning = earnings.find((e) => e.id === allocation.earningId);
        if (!earning || earning.reservedCommissionCents < allocation.amountCents) throw conflict('Commission allocation needs review.', 'COMMISSION_ALLOCATION_MISMATCH');
        const reservedCommissionCents = earning.reservedCommissionCents - allocation.amountCents;
        const paidCommissionCents = earning.paidCommissionCents + paidAmountCents;
        const unpaidCommissionCents = Math.max(reservedCommissionCents, earning.originalCommissionCents - paidCommissionCents - earning.refundedCommissionCents);
        const businessLossCents = unpaidCommissionCents + paidCommissionCents + earning.refundedCommissionCents - earning.originalCommissionCents;
        await earning.update({ reservedCommissionCents, paidCommissionCents, unpaidCommissionCents, businessLossCents }, { transaction: tx });
        await allocation.update(paid ? { status: 'paid', paidAt: now(), paidAmountCents, ...(paidAmountCents < allocation.amountCents ? { releasedAt: now() } : {}) }
          : { status: 'released', releasedAt: now() }, { transaction: tx });
      }
      const remainingCommissionCents = earnings.reduce((sum, earning) => {
        const remainder = allocations.filter(a => a.earningId === earning.id).reduce((amount, a) => amount + a.amountCents - (a.paidAmountCents || 0), 0);
        return sum + Math.min(remainder, Math.max(0, earning.unpaidCommissionCents - earning.reservedCommissionCents));
      }, 0);
      const settled = allocations.reduce((sum, a) => sum + (a.paidAmountCents || 0), 0);
      return { allocations, allocationCount: allocations.length, paid, settledAmountCents: settled, releasedAmountCents: total - settled, remainingCommissionCents };
    });
  }
  async function listStatements({ organizationId, recipientUserId, currency, page = 1, pageSize = 20, transaction } = {}) {
    if (!organizationId && !recipientUserId) throw new Error('A business or recipient scope is required');
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid statement page');
    const values = { organizationId: organizationId === 'independent' ? null : organizationId || null, independent: organizationId === 'independent', recipientUserId: recipientUserId || null, currency: currency || null,
      current: now(), limit: pageSize, offset: (page - 1) * pageSize };
    const predicate = `(:organizationId IS NULL OR s.organization_id=:organizationId) AND (NOT :independent OR s.organization_id IS NULL) AND (:recipientUserId IS NULL OR s.recipient_user_id=:recipientUserId) AND (:currency IS NULL OR s.currency=:currency)`;
    const [count] = await select(`SELECT COUNT(*)::integer AS total FROM commission_statements s WHERE ${predicate}`, values, transaction);
    const rows = await select(`SELECT s.id,s.organization_id AS "organizationId",s.event_id AS "eventId",s.recipient_user_id AS "recipientUserId",s.currency,
      s.event_title AS "eventTitle",s.status,s.available_at AS "availableAt",s.approved_at AS "approvedAt",${totalsSql}
      FROM commission_statements s LEFT JOIN commission_earnings e ON e.statement_id=s.id WHERE ${predicate}
      GROUP BY s.id ORDER BY s.available_at DESC,s.id DESC LIMIT :limit OFFSET :offset`, values, transaction);
    return { rows: rows.map(numbers), total: count.total, page, pageSize };
  }
  async function statementDetails({ statementId, organizationId, recipientUserId, page = 1, pageSize = 20, transaction }) {
    if (!organizationId && !recipientUserId) throw new Error('A business or recipient scope is required');
    const statement = await models.CommissionStatement.findOne({ where: { id: statementId,
      ...(organizationId ? { organizationId } : {}), ...(recipientUserId ? { recipientUserId } : {}) }, transaction });
    if (!statement) throw notFound('Commission statement');
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid statement page');
    const result = await models.CommissionEarning.findAndCountAll({ where: { statementId }, order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: pageSize, offset: (page - 1) * pageSize, transaction });
    return { statement, rows: result.rows, total: result.count, page, pageSize };
  }
  async function summarizeStatements({ organizationId, recipientUserId, currency, statementIds, transaction }) {
    selection({ statementIds });
    if (!organizationId && !recipientUserId) throw new Error('A business or recipient scope is required');
    const rows = await select(`SELECT s.id,s.organization_id AS "organizationId",s.event_id AS "eventId",s.recipient_user_id AS "recipientUserId",s.currency,
      s.event_title AS "eventTitle",s.status,s.available_at AS "availableAt",s.approved_at AS "approvedAt",${totalsSql}
      FROM commission_statements s LEFT JOIN commission_earnings e ON e.statement_id=s.id WHERE s.id IN (:statementIds)
      AND (:organizationId IS NULL OR s.organization_id=:organizationId) AND (:recipientUserId IS NULL OR s.recipient_user_id=:recipientUserId)
      AND (:currency IS NULL OR s.currency=:currency) GROUP BY s.id ORDER BY s.id`,
    { organizationId: organizationId || null, recipientUserId: recipientUserId || null, currency: currency || null, statementIds, current: now() }, transaction);
    if (rows.length !== statementIds.length) throw notFound('Commission statement');
    return rows.map(numbers);
  }
  return { recordPaidOrder, setRefundHold, setDisputeHold, adjustRefund, approveStatements, assertStatementMode, reserveStatements, finishPayment,
    settlePayment: (input) => finishPayment({ ...input, paid: true }), releasePayment: (input) => finishPayment({ ...input, paid: false }), listStatements, statementDetails, summarizeStatements };
}
module.exports = { createCommissionLedgerService, totalsSql };
