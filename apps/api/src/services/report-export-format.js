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
function header(metadata) {
  const { selected, range } = metadata;
  if (selected) return csvRow(columns[selected].header);
  return csvRow(['Nitewide business report', 'USD', range.timezone, `Paid ${range.startDate} through ${range.endDate}`])
    + csvRow(['Section', 'Name / date', 'Role / kind', 'Event', 'Sales USD', 'Orders / units', 'Commission USD', 'Checked in', 'Expected']);
}
function line(section, row, metadata) {
  if (metadata.offering) row = { ...row, commissionCents: null };
  if (metadata.selected) return csvRow(columns[metadata.selected].row(row, metadata));
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
