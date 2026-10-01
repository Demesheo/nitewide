import { selectedStatuses } from './status-filter.js';

export function supportCaseQuery(params) {
  const query = new URLSearchParams({ page: params.get('page') || '1', pageSize: '25', search: params.get('search') || '', category: params.get('category') || 'all' });
  for (const value of selectedStatuses(params)) query.append('statuses', value);
  return query.toString();
}
