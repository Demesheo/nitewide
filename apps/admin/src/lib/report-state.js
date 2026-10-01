const kinds = ['businesses', 'events', 'offerings', 'purchases', 'customers', 'team', 'regions', 'venues'];
export const reportKinds = kinds;
export function reportPath(params) {
  try { const value = JSON.parse(params.get('drill') || '[]'); return Array.isArray(value) ? value.filter((row) => kinds.includes(row.kind) && typeof row.id === 'string' && typeof row.label === 'string').map(({ kind, id, label }) => ({ kind, id, label })).slice(0, 6) : []; } catch { return []; }
}
export function reportRequest(params, { includePaging = false } = {}) {
  const query = new URLSearchParams(); const period = params.get('period') || '30';
  if (period === 'custom') { const from = params.get('startDate'); const to = params.get('endDate'); if (!from || !to || from > to) return null; query.set('startDate', from); query.set('endDate', to); }
  else query.set('days', ['7', '30', '90', '365'].includes(period) ? period : '30');
  query.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  for (const region of params.getAll('regions')) query.append('regions', region);
  for (const id of params.getAll('organizationIds')) query.append('organizationIds', id);
  if (params.get('reportSearch')) query.set('search', params.get('reportSearch'));
  for (const row of reportPath(params)) {
    const key = { businesses: 'businessId', events: 'eventId', offerings: 'offeringId', customers: 'customerId', team: 'personId' }[row.kind];
    if (key) query.set(key, row.id);
    else if (row.kind === 'regions') { query.delete('regions'); query.append('regions', row.label); }
    else if (row.kind === 'venues') { query.delete('venueIds'); query.append('venueIds', row.id); }
  }
  if (includePaging) { query.set('page', params.get('reportPage') || '1'); query.set('pageSize', params.get('reportPageSize') || '10'); query.set('sort', params.get('reportSort') || 'sales_desc'); }
  return query.toString();
}
export function nextReportKind(kind) { return { businesses: 'events', events: 'offerings', offerings: 'purchases', customers: 'purchases', team: 'purchases', regions: 'businesses', venues: 'events' }[kind]; }
export function reportRecord(kind, row) {
  // Aggregate venue and region keys must never be used to mutate a record.
  if (kind === 'businesses') return row.organizationId ? ['organizations', row.organizationId] : row.creatorUserId ? ['users', row.creatorUserId] : null;
  if (kind === 'events') return row.eventId ? ['events', row.eventId] : null;
  if (kind === 'offerings') return row.offeringId ? ['offerings', row.offeringId] : null;
  if (kind === 'purchases') return row.orderId ? ['orders', row.orderId] : null;
  if (kind === 'customers') return row.customerId || row.buyerUserId ? ['users', row.customerId || row.buyerUserId] : null;
  if (kind === 'team') return row.userId ? ['users', row.userId] : null;
  return null;
}
