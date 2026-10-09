const { QueryTypes } = require('sequelize');
const { forbidden } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
const { assertFinanceAccess } = require('./business-payment-account-service');
const { assertActiveUser } = require('./lifecycle-service');
const { refundedTotalSql, refundedCommissionSql, netCommissionSql } = require('./refund-report-policy');
const { verifiedStripeOrderSql, ownCommissionSql, demoOrderSql, canViewEarningsSql } = require('./business-payment-report-policy');

function createBusinessPaymentOverviewService({ models, stripe, paymentMode = 'test' }) {
  const mode = ['test', 'live'].includes(stripe?.mode) ? stripe.mode : paymentMode;
  if (!['test', 'live'].includes(mode)) throw new TypeError('Payment reporting requires an explicit history mode');
  const sequelize = models.Order?.sequelize;
  const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const numeric = row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (key === 'currency') return [key, value];
    const amount = Number(value || 0);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Payment report aggregate is outside the supported integer range');
    return [key, amount];
  }));
  async function overview(userId, organizationId) {
    return mutationTransaction(sequelize, async transaction => {
      await assertFinanceAccess(models, userId, organizationId, transaction);
      const rows = await select(`WITH scoped_orders AS (
        SELECT o.*, ${verifiedStripeOrderSql()} AS verified FROM orders o JOIN events e ON e.id=o.event_id
        WHERE e.organization_id=:organizationId AND o.provider_mode=:mode
      ) SELECT UPPER(o.currency) AS currency,
        COALESCE(SUM(o.total_cents) FILTER (WHERE verified AND o.status IN ('paid','refunded')),0)::bigint AS "collectedCents",
        COALESCE(SUM(${refundedTotalSql()}) FILTER (WHERE verified AND o.status IN ('paid','refunded')),0)::bigint AS "refundedCents",
        COALESCE(SUM(o.total_cents-${refundedTotalSql()}) FILTER (WHERE verified AND o.status IN ('paid','refunded')),0)::bigint AS "netCollectedCents",
        COUNT(*) FILTER (WHERE verified AND o.status='paid')::integer AS "paidOrders",
        COUNT(*) FILTER (WHERE verified AND o.status='refunded')::integer AS "refundedOrders",
        COUNT(*) FILTER (WHERE o.status='pending' AND o.provider_verification_status<>'review')::integer AS "pendingOrders",
        COUNT(*) FILTER (WHERE o.provider_verification_status='review')::integer AS "reviewOrders"
        FROM scoped_orders o WHERE verified OR o.status='pending' OR o.provider_verification_status='review'
        GROUP BY UPPER(o.currency) ORDER BY UPPER(o.currency)`, { organizationId, mode }, transaction);
      const currencies = rows.map(numeric);
      return { organizationId, period: 'all_time', mode, currencies,
        pendingOrders: currencies.reduce((total, row) => total + row.pendingOrders, 0),
        reviewOrders: currencies.reduce((total, row) => total + row.reviewOrders, 0), merchantBalance: null, payouts: null };
    });
  }
  async function earnings(userId, query = {}) {
    const { organizationId } = require('../http/payment-schemas').earningsQuery.parse(query);
    const values = { userId, mode, organizationId: organizationId === 'independent' ? null : organizationId || null, independent: organizationId === 'independent' };
    const eventScope = `(NOT :independent OR e.organization_id IS NULL) AND (:organizationId IS NULL OR e.organization_id=:organizationId)`;
    return mutationTransaction(sequelize, async transaction => {
      assertActiveUser(await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.SHARE }));
      const [access] = await select(`SELECT ${canViewEarningsSql} AS allowed`, { userId }, transaction);
      if (!access?.allowed) throw forbidden('An affiliate assignment or historical own earnings is required');
      const rows = await select(`WITH own_orders AS (
        SELECT o.*, (${verifiedStripeOrderSql()} AND o.provider_mode=:mode) AS verified, ${demoOrderSql()} AS demo
        FROM orders o JOIN events e ON e.id=o.event_id WHERE ${eventScope} AND o.affiliate_commission_cents>0 AND o.status IN ('paid','refunded') AND ${ownCommissionSql()}
      ) SELECT UPPER(o.currency) AS currency,
        COALESCE(SUM(${netCommissionSql()}) FILTER (WHERE verified),0)::bigint AS "verifiedEarnedCents",
        COALESCE(SUM(${refundedCommissionSql()}) FILTER (WHERE verified),0)::bigint AS "verifiedRefundedCents",
        COALESCE(SUM(${netCommissionSql()}) FILTER (WHERE demo),0)::bigint AS "demoEarnedCents",
        COALESCE(SUM(${refundedCommissionSql()}) FILTER (WHERE demo),0)::bigint AS "demoRefundedCents",
        COUNT(*) FILTER (WHERE verified AND o.status='paid')::integer AS "verifiedPaidOrders",
        COUNT(*) FILTER (WHERE verified AND o.status='refunded')::integer AS "verifiedRefundedOrders",
        COUNT(*) FILTER (WHERE demo AND o.status='paid')::integer AS "demoPaidOrders",
        COUNT(*) FILTER (WHERE demo AND o.status='refunded')::integer AS "demoRefundedOrders"
        FROM own_orders o WHERE verified OR demo GROUP BY UPPER(o.currency) ORDER BY UPPER(o.currency)`, values, transaction);
      const ledgerRows = await select(`SELECT UPPER(ce.currency) AS currency,
        SUM(ce.unpaid_commission_cents)::bigint AS "unpaidCommissionCents",
        SUM(ce.unpaid_commission_cents-ce.reserved_commission_cents) FILTER (WHERE ce.refund_hold OR ce.dispute_hold)::bigint AS "heldCommissionCents",
        SUM(ce.unpaid_commission_cents-ce.reserved_commission_cents) FILTER (WHERE NOT ce.refund_hold AND NOT ce.dispute_hold AND cs.available_at<=NOW() AND e.ends_at+INTERVAL '48 hours'<=NOW())::bigint AS "payableCommissionCents",
        SUM(ce.reserved_commission_cents)::bigint AS "reservedCommissionCents",
        SUM(ce.paid_commission_cents)::bigint AS "paidCommissionCents",
        SUM(ce.business_loss_cents)::bigint AS "businessLossCents"
        FROM commission_earnings ce JOIN commission_statements cs ON cs.id=ce.statement_id JOIN events e ON e.id=ce.event_id
        JOIN orders earning_order ON earning_order.id=ce.order_id
        WHERE ce.recipient_user_id=:userId AND earning_order.provider_mode=:mode AND ${eventScope} GROUP BY UPPER(ce.currency)`, values, transaction);
      const zeroOrder = { verifiedEarnedCents:0,verifiedRefundedCents:0,demoEarnedCents:0,demoRefundedCents:0,
        verifiedPaidOrders:0,verifiedRefundedOrders:0,demoPaidOrders:0,demoRefundedOrders:0 };
      const zeroLedger = { unpaidCommissionCents:0,heldCommissionCents:0,payableCommissionCents:0,reservedCommissionCents:0,paidCommissionCents:0,businessLossCents:0 };
      const currencies = new Map(rows.map(row => [row.currency,{ ...zeroLedger,...numeric(row) }]));
      for (const row of ledgerRows) currencies.set(row.currency,{ ...zeroOrder,...currencies.get(row.currency),...numeric(row) });
      const creditRows = await select(`SELECT UPPER(currency) AS currency,
        COALESCE(SUM(provider_net_cents) FILTER (WHERE provider_verification_status='verified' AND status IN ('paid','paid_fee_review')),0)::bigint AS "creditedCents",
        COALESCE(SUM(provider_net_cents-invoicing_fee_cents) FILTER (WHERE provider_verification_status='verified' AND fee_evidence='provider_verified' AND status='paid'),0)::bigint AS "verifiedNetCents",
        COALESCE(SUM(provider_net_cents-invoicing_fee_cents) FILTER (WHERE provider_verification_status='verified' AND fee_evidence='merchant_reviewed' AND status='paid'),0)::bigint AS "merchantReviewedNetCents",
        COUNT(*) FILTER (WHERE status='paid_fee_review')::integer AS "feeReviewPayments"
        FROM commission_payments WHERE recipient_user_id=:userId AND provider_mode=:mode AND (NOT :independent)
          AND (:organizationId IS NULL OR organization_id=:organizationId)
          AND status IN ('paid','paid_fee_review','reversed','disputed') GROUP BY UPPER(currency)`, values, transaction);
      return { period: 'all_time', mode, scope: 'own', currencies: [...currencies.values()], receivedPayouts: { currencies: creditRows.map(numeric),bankPayouts:null },
        dashboardConnected: null, dashboardUrl: null, payoutsUnavailableReason: 'bank_payouts_not_tracked' };
    });
  }
  return { overview, earnings };
}
module.exports = { createBusinessPaymentOverviewService };
