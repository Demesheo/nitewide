export function selectedStatuses(params) {
  const values = params.getAll('statuses');
  if (values.length) return values;
  const legacy = params.get('status');
  return legacy && legacy !== 'all' ? [legacy] : [];
}
