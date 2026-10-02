// All projections use cumulative provider-verified adjustments. Original order
// and line amounts remain immutable. Legacy fully refunded history is zero net.
const refundedSubtotalSql = (o = 'o') => `(CASE WHEN ${o}.status='refunded' THEN ${o}.subtotal_cents ELSE LEAST(${o}.subtotal_cents,COALESCE(${o}.refunded_subtotal_cents,0)) END)`;
const refundedTotalSql = (o = 'o') => `(CASE WHEN ${o}.status='refunded' THEN ${o}.total_cents ELSE LEAST(${o}.total_cents,COALESCE(${o}.refunded_total_cents,0)) END)`;
const refundedCommissionSql = (o = 'o') => `(CASE WHEN ${o}.status='refunded' THEN ${o}.affiliate_commission_cents ELSE LEAST(${o}.affiliate_commission_cents,COALESCE(${o}.refunded_commission_cents,0)) END)`;
const netSubtotalSql = (o = 'o') => `GREATEST(0,${o}.subtotal_cents-${refundedSubtotalSql(o)})`;
const netCommissionSql = (o = 'o') => `GREATEST(0,${o}.affiliate_commission_cents-${refundedCommissionSql(o)})`;
// Paid commissions are retained costs borne by the business, not
// clawbacks. Add that cost once; paying an earning is never a second expense.
const commissionExpenseSql = (o = 'o') => `(${netCommissionSql(o)}+COALESCE((SELECT ce.business_loss_cents FROM commission_earnings ce WHERE ce.order_id=${o}.id),0))`;
// Keep fully refunded purchases only when they retain a real paid commission
// cost. Their sales/units/order/customer counts remain zero in projections.
const financialOrderSql = (o = 'o') => `(${o}.status='paid' OR (${o}.status='refunded' AND EXISTS (SELECT 1 FROM commission_earnings retained WHERE retained.order_id=${o}.id AND retained.business_loss_cents>0)))`;
// Cumulative rounding distributes each refunded cent exactly once across lines.
// Calculate this over ALL lines before filtering a requested offering.
const netItemSql = (item = 'oi', order = 'eo') => `(${item}.line_total_cents-(
  ROUND(${refundedSubtotalSql(order)}::numeric*SUM(${item}.line_total_cents) OVER(PARTITION BY ${item}.order_id ORDER BY ${item}.id ROWS UNBOUNDED PRECEDING)/NULLIF(${order}.subtotal_cents,0))
  - ROUND(${refundedSubtotalSql(order)}::numeric*(SUM(${item}.line_total_cents) OVER(PARTITION BY ${item}.order_id ORDER BY ${item}.id ROWS UNBOUNDED PRECEDING)-${item}.line_total_cents)/NULLIF(${order}.subtotal_cents,0))))`;
module.exports = { refundedSubtotalSql, refundedTotalSql, refundedCommissionSql, netSubtotalSql, netCommissionSql, commissionExpenseSql, financialOrderSql, netItemSql };
