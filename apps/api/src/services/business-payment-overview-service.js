const { QueryTypes } = require('sequelize');
const { forbidden } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
const { assertFinanceAccess } = require('./business-payment-account-service');
const { assertBusinessAccess } = require('./business-access-policy');
const { verifiedStripeOrderSql, ownCommissionSql, demoOrderSql, canViewEarningsSql } = require('./business-payment-report-policy');

function createBusinessPaymentOverviewService({ models }) {
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
        WHERE e.organization_id=:organizationId AND o.provider_mode='test'
      ) SELECT UPPER(o.currency) AS currency,
        COALESCE(SUM(o.total_cents) FILTER (WHERE verified AND o.status IN ('paid','refunded')),0)::bigint AS "collectedCents",
        COALESCE(SUM(o.total_cents) FILTER (WHERE verified AND o.status='refunded'),0)::bigint AS "refundedCents",
        COALESCE(SUM(o.total_cents) FILTER (WHERE verified AND o.status='paid'),0)::bigint AS "netCollectedCents",
        COUNT(*) FILTER (WHERE verified AND o.status='paid')::integer AS "paidOrders",
        COUNT(*) FILTER (WHERE verified AND o.status='refunded')::integer AS "refundedOrders",
        COUNT(*) FILTER (WHERE o.status='pending' AND o.provider_verification_status<>'review')::integer AS "pendingOrders",
        COUNT(*) FILTER (WHERE o.provider_verification_status='review')::integer AS "reviewOrders"
        FROM scoped_orders o WHERE verified OR o.status='pending' OR o.provider_verification_status='review'
        GROUP BY UPPER(o.currency) ORDER BY UPPER(o.currency)`, { organizationId }, transaction);
      const currencies = rows.map(numeric);
      return { organizationId, period: 'all_time', mode: 'test', currencies,
        pendingOrders: currencies.reduce((total, row) => total + row.pendingOrders, 0),
        reviewOrders: currencies.reduce((total, row) => total + row.reviewOrders, 0), merchantBalance: null, payouts: null };
    });
  }
  async function earnings(userId) {
    return mutationTransaction(sequelize, async transaction => {
      await assertBusinessAccess(models, userId, transaction);
      const [access] = await select(`SELECT ${canViewEarningsSql} AS allowed`, { userId }, transaction);
      if (!access?.allowed) throw forbidden('An affiliate assignment or historical own earnings is required');
      const rows = await select(`WITH own_orders AS (
        SELECT o.*, ${verifiedStripeOrderSql()} AS verified, ${demoOrderSql()} AS demo
        FROM orders o WHERE o.affiliate_commission_cents>0 AND o.status IN ('paid','refunded') AND ${ownCommissionSql()}
      ) SELECT UPPER(o.currency) AS currency,
        COALESCE(SUM(o.affiliate_commission_cents) FILTER (WHERE verified AND o.status='paid'),0)::bigint AS "verifiedEarnedCents",
        COALESCE(SUM(o.affiliate_commission_cents) FILTER (WHERE verified AND o.status='refunded'),0)::bigint AS "verifiedRefundedCents",
        COALESCE(SUM(o.affiliate_commission_cents) FILTER (WHERE demo AND o.status='paid'),0)::bigint AS "demoEarnedCents",
        COALESCE(SUM(o.affiliate_commission_cents) FILTER (WHERE demo AND o.status='refunded'),0)::bigint AS "demoRefundedCents",
        COUNT(*) FILTER (WHERE verified AND o.status='paid')::integer AS "verifiedPaidOrders",
        COUNT(*) FILTER (WHERE verified AND o.status='refunded')::integer AS "verifiedRefundedOrders",
        COUNT(*) FILTER (WHERE demo AND o.status='paid')::integer AS "demoPaidOrders",
        COUNT(*) FILTER (WHERE demo AND o.status='refunded')::integer AS "demoRefundedOrders"
        FROM own_orders o WHERE verified OR demo GROUP BY UPPER(o.currency) ORDER BY UPPER(o.currency)`, { userId }, transaction);
      return { period: 'all_time', scope: 'own', currencies: rows.map(numeric), receivedPayouts: null,
        dashboardConnected: null, dashboardUrl: null, payoutsUnavailableReason: 'not_connected' };
    });
  }
  return { overview, earnings };
}
module.exports = { createBusinessPaymentOverviewService };
