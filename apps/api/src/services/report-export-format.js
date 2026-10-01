const { csvRow } = require('./business-report-service');
const number = (value) => Number(value || 0);
const usd = (value) => (number(value) / 100).toFixed(2);
const expected = (row) => number(row.admissions) + number(row.guestlistPlaces);
const average = (row) => usd(row.orders ? Math.round(number(row.salesCents) / row.orders) : 0);
function localStart(row) {
  return row.startsAt ? new Intl.DateTimeFormat('en-US', { timeZone: row.venueTimezone || 'UTC',
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(row.startsAt)) : '';
}
const columns = {
  businesses: { header: ['Business ID','Business','Events','Paid orders','Face-value sales USD','Added buyer fees USD','Business-absorbed fees USD','Combined fees USD','Customers','Units','Business proceeds before provider adjustments USD','Modeled processing USD','Modeled contribution USD'],
    row: r => [r.businessId,r.label,r.events,r.orders,usd(r.salesCents),usd(r.addedBuyerFeesCents),usd(r.businessAbsorbedFeesCents),usd(r.combinedFeesCents),r.customers,r.units,usd(r.businessProceedsBeforeProviderCents),r.modeledProcessingCents == null ? '' : usd(r.modeledProcessingCents),r.modeledContributionCents == null ? '' : usd(r.modeledContributionCents)] },
  purchases: { header: ['Purchase ID','Business ID','Event ID','Customer ID','Customer','Paid at','Matched face-value sales USD','Order face-value USD','Order added buyer fees USD','Business-absorbed fees USD','Combined fees USD','Order total USD','Recorded commission USD','Business proceeds before provider adjustments USD','Modeled processing USD','Modeled contribution USD','Demo'],
    row: r => [r.orderId,r.businessId,r.eventId,r.customerId,r.label,r.paidAt,usd(r.salesCents),usd(r.faceValueSalesCents),usd(r.addedBuyerFeesCents),usd(r.businessAbsorbedFeesCents),usd(r.combinedFeesCents),usd(r.customerPaidCents),usd(r.recordedCommissionsCents),usd(r.businessProceedsBeforeProviderCents),r.modeledProcessingCents == null ? '' : usd(r.modeledProcessingCents),r.modeledContributionCents == null ? '' : usd(r.modeledContributionCents),r.demo] },
  regions: { header: ['Region', 'Events', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
    row: (r) => [r.label, r.events, r.orders, usd(r.salesCents), r.customers, r.units, r.checkedIn, expected(r), average(r)] },
  venues: { header: ['Venue / creator', 'Events', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
    row: (r) => [r.label, r.events, r.orders, usd(r.salesCents), r.customers, r.units, r.checkedIn, expected(r), average(r)] },
  events: { header: ['Event', 'Status', 'Starts at', 'Paid orders', 'Sales USD', 'Customers', 'Units', 'Check-ins', 'Expected', 'Avg. order USD'],
    row: (r) => [r.label, r.status, localStart(r), r.orders, usd(r.salesCents), r.customers, r.units, r.checkedIn, expected(r), average(r)] },
  offerings: { header: ['Offering', 'Kind', 'Units', 'Orders', 'Sales USD'], row: (r) => [r.label, r.kind, r.units, r.orders, usd(r.salesCents)] },
  team: { header: ['Name', 'Role', 'Attributed sales USD', 'Paid orders', 'Guestlist places', 'Approved guestlist places', 'Commission USD', 'Contribution %'],
    row: (r, m) => [r.label, r.role, usd(r.salesCents), r.orders, r.guestlistPlaces, r.approvedGuestlistPlaces,
      r.commissionCents == null ? '' : usd(r.commissionCents), m.salesCents ? (number(r.salesCents) / m.salesCents * 100).toFixed(1) : '0.0'] },
  customers: { header: ['Customer', 'Email', 'Paid orders', 'Sales USD', 'Units'], row: (r) => [r.label, r.email, r.orders, usd(r.salesCents), r.units] },
};
function selectedColumns(metadata) {
  const selected = columns[metadata.selected];
  if (metadata.audience !== 'admin' || ['businesses','purchases'].includes(metadata.selected)) return selected;
  const keys = { events: ['eventId','businessId'],offerings: ['offeringId','eventId','businessId'],team: ['id'],customers: ['buyerUserId'],venues: ['id'],regions: ['id'] }[metadata.selected];
  const financialHeaders = metadata.selected === 'events' ? ['Order face-value USD','Order added buyer fees USD','Business-absorbed fees USD','Combined fees USD','Business proceeds before provider adjustments USD','Modeled processing USD','Modeled contribution USD'] : [];
  return { header: [...keys.map(key => ['venues','regions'].includes(metadata.selected) ? 'Aggregate key' : key),...selected.header,...financialHeaders],
    row: (row,m) => [...keys.map(key => row[key]),...selected.row(row,m),...(metadata.selected === 'events' ? [usd(row.faceValueSalesCents),usd(row.addedBuyerFeesCents),usd(row.businessAbsorbedFeesCents),usd(row.combinedFeesCents),usd(row.businessProceedsBeforeProviderCents),row.modeledProcessingCents == null ? '' : usd(row.modeledProcessingCents),row.modeledContributionCents == null ? '' : usd(row.modeledContributionCents)] : [])] };
}
function header(metadata) {
  const { selected, range } = metadata;
  if (selected) return csvRow(selectedColumns(metadata).header);
  if (metadata.audience === 'admin') {
    const f = metadata.financial;
    return csvRow(['NiteWide platform report','USD',range.timezone,`Paid ${range.startDate} through ${range.endDate}`])
      + csvRow(['Provider reconciliation','Unavailable pending payment integration','Refund totals unavailable'])
      + (f ? csvRow(['Recorded face-value USD',usd(f.faceValueSalesCents),'Recorded added buyer fees USD',usd(f.addedBuyerFeesCents),'Recorded business-absorbed fees USD',usd(f.businessAbsorbedFeesCents),'Recorded combined fees USD',usd(f.combinedFeesCents),'Modeled processing USD',f.modeledProcessingCents == null ? '' : usd(f.modeledProcessingCents),'Modeled contribution USD',f.modeledContributionCents == null ? '' : usd(f.modeledContributionCents)]) : '')
      + csvRow(['Section','Record ID / aggregate key','Business ID','Event ID','Customer ID','Name / date','Kind / role','Matched face-value sales USD','Orders / units','Order added buyer fees USD','Business-absorbed fees USD','Combined fees USD','Recorded commission USD','Business proceeds before provider adjustments USD','Modeled processing USD','Modeled contribution USD']);
  }
  return csvRow(['Nitewide business report', 'USD', range.timezone, `Paid ${range.startDate} through ${range.endDate}`])
    + csvRow(['Section', 'Name / date', 'Role / kind', 'Event', 'Sales USD', 'Orders / units', 'Commission USD', 'Checked in', 'Expected']);
}
function line(section, row, metadata) {
  if (metadata.offering) row = { ...row, commissionCents: null };
  if (metadata.selected) return csvRow(selectedColumns(metadata).row(row, metadata));
  if (metadata.audience === 'admin') return csvRow([section,row.orderId || row.offeringId || row.eventId || row.businessId || row.id || '',row.businessId || '',row.eventId || '',row.customerId || '',row.label || row.date,row.kind || row.role || '',
    usd(row.salesCents),row.units ?? row.orders,row.addedBuyerFeesCents == null ? '' : usd(row.addedBuyerFeesCents),row.businessAbsorbedFeesCents == null ? '' : usd(row.businessAbsorbedFeesCents),row.combinedFeesCents == null ? '' : usd(row.combinedFeesCents),row.recordedCommissionsCents == null ? '' : usd(row.recordedCommissionsCents),row.businessProceedsBeforeProviderCents == null ? '' : usd(row.businessProceedsBeforeProviderCents),
    row.modeledProcessingCents == null ? '' : usd(row.modeledProcessingCents),row.modeledContributionCents == null ? '' : usd(row.modeledContributionCents)]);
  const values = {
    events: () => ['Event', row.label, row.region, row.eventId, usd(row.salesCents), row.orders,
      row.commissionCents == null ? '' : usd(row.commissionCents), row.checkedIn, expected(row)],
    offerings: () => ['Offering', row.label, row.kind, '', usd(row.salesCents), row.units, '', '', ''],
    team: () => ['Person', row.label, row.role, '', usd(row.salesCents), row.orders, row.commissionCents == null ? '' : usd(row.commissionCents), '', ''],
    daily: () => ['Daily', row.date, '', '', usd(row.salesCents), row.orders, '', '', ''],
  };
  return csvRow(values[section]());
}
module.exports = { header, line };
