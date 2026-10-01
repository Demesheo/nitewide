export const accessRequestStatuses = ['pending', 'approved', 'declined'];

// Keep review filters separate from the Businesses directory's search/page.
export function requestFilters(params) {
  const supplied = params.getAll('requestStatuses');
  const statuses = supplied.includes('all') ? [] : supplied.length ? [...new Set(supplied.filter((status) => accessRequestStatuses.includes(status)))] : ['pending'];
  const page = Number(params.get('requestPage') || 1);
  return { statuses, page: Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1, search: (params.get('requestSearch') || '').slice(0, 120) };
}
export function requestListQuery(params) {
  const filters = requestFilters(params);
  const query = new URLSearchParams({ page: String(filters.page), pageSize: '25', search: filters.search });
  for (const status of filters.statuses) query.append('statuses', status);
  return query.toString();
}
export function accessRequestDraft(request) {
  return {
    recipient: { displayName: request?.displayName || '', email: request?.email || '', phone: request?.phone || '', role: request?.role === 'manager' ? 'manager' : 'owner', financeAuthorized: false },
    organization: { name: request?.businessName || '', description: request?.details || '', planTier: 'free', website: '' },
  };
}
export function onboardingPayload({ recipient, organization, venues, authority, reason, accessRequest, version }) {
  return { kind: 'organization', recipient: { ...recipient, ...(accessRequest ? { email: accessRequest.email } : {}), financeAuthorized: recipient.role === 'manager' && recipient.financeAuthorized },
    organization: { ...organization, website: organization.website || undefined }, venues: venues.map(({ key, ...venue }) => venue), confirmedAuthority: authority, reason,
    ...(accessRequest ? { version } : {}) };
}
export function requestReviewPath(id) {
  return `?section=businesses&businessView=requests&request=${encodeURIComponent(id)}`;
}
export function requestStatusCopy(status) {
  return status === 'approved' ? 'Approved for onboarding. Active access still requires the recipient to accept their secure setup invitation.'
    : status === 'declined' ? 'Declined. This request has not granted business access.'
      : 'Pending review. This request has not granted business access.';
}
