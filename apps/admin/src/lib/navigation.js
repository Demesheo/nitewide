export const sections = ['overview', 'businesses', 'events', 'people', 'support', 'analytics', 'audit'];
export const primaryResources = { businesses: 'organizations', events: 'events', people: 'users', audit: 'audit' };
export const directoryResources = {
  businesses: ['organizations', 'locations', 'onboarding_invitations'],
  events: ['events', 'offerings', 'orders', 'payments', 'tickets', 'guestlist', 'guestlist_invitations', 'check_ins', 'boosts', 'media'],
  people: ['users', 'employees', 'venue_access', 'organization_affiliates', 'event_affiliates', 'team_invitations', 'notifications', 'credentials', 'account_tokens'],
  audit: ['audit', 'email_outbox', 'attributions'],
};
export const sectionForResource = (resource) => resource === 'email_outbox' ? 'support' : Object.entries(directoryResources).find(([, keys]) => keys.includes(resource))?.[0] || 'businesses';
export function readRoute(search = '') {
  const params = new URLSearchParams(search);
  const aliases = { organizations: 'businesses', users: 'people', reports: 'analytics', management: 'people', operations: 'support', orders: 'events' };
  const supplied = params.get('section');
  const section = sections.includes(supplied) ? supplied : aliases[supplied] || 'overview';
  const resource = params.get('record') ? params.get('resource') || primaryResources[section] : primaryResources[section];
  return { section, resource, id: params.get('record'), params, returnTo: params.get('returnTo') };
}
export function changedQuery(search, values) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(values)) {
    params.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) if (item !== null && item !== undefined && item !== '') params.append(key, String(item));
  }
  return `?${params.toString()}`;
}
export function recordQuery(search, resource, id, { preserveParent = false, tab } = {}) {
  const route = readRoute(search);
  const parent = readRoute(route.returnTo);
  if (parent.id === id && parent.resource === resource) return tab ? changedQuery(route.returnTo, { tab }) : route.returnTo;
  const params = new URLSearchParams({ section: sectionForResource(resource), resource, record: id });
  if (tab) params.set('tab', tab);
  params.set('returnTo', !preserveParent && route.id && route.returnTo ? route.returnTo : search || '?section=overview');
  return `?${params.toString()}`;
}
export function recordReturnLabel(search) {
  const { returnTo } = readRoute(search);
  const parent = readRoute(returnTo);
  if (parent.id) return `Back to ${{ organizations: 'business', locations: 'venue', users: 'person', events: 'event' }[parent.resource] || 'previous record'}`;
  return parent.section === 'analytics' ? 'Back to report' : 'Back to results';
}
export function returnQuery(search) {
  const { returnTo, section, resource } = readRoute(search);
  return returnTo?.startsWith('?') && !returnTo.includes('#') ? returnTo : changedQuery('', { section, resource });
}
export function listQuery(params, scope = {}) {
  const query = new URLSearchParams({ page: params.get('page') || '1', pageSize: '25', search: params.get('search') || '', status: params.get('status') || '', sort: params.get('sort') || 'createdAt', direction: params.get('direction') || 'desc' });
  for (const key of ['startDate', 'endDate']) if (params.get(key)) query.set(key, params.get(key));
  for (const status of params.getAll('statuses')) query.append('statuses', status);
  if (query.has('startDate') || query.has('endDate')) query.set('timezone', params.get('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  for (const [key, value] of Object.entries(scope)) if (value) query.set(key, value);
  return query.toString();
}
