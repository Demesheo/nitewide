// Chart values remain cents; compact axes leave room for readable labels.
const axisMoney = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
});
const axisDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const chartMoneyLabel = (cents) => axisMoney.format(Number(cents) / 100);
export const chartDateLabel = (date) => axisDate.format(new Date(`${date}T00:00:00Z`));
export const chartTick = { fill: '#d8d1e1', fontSize: 12 };
export const chartTooltipStyles = {
  contentStyle: { background: '#20202c', border: '1px solid #585166', borderRadius: 12, color: '#fafafa', fontSize: 13, lineHeight: 1.5, whiteSpace: 'normal', overflowWrap: 'anywhere' },
  itemStyle: { color: '#fafafa' },
  labelStyle: { color: '#fafafa', fontWeight: 600 },
  wrapperStyle: { maxWidth: 240, zIndex: 2 },
};
