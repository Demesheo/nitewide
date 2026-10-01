export const humanLabel = (value) => ({ admin: 'Manager', affiliate: 'Promoter', internal_admin: 'Internal administrator', platform_owner: 'Platform owner', read_only: 'Read-only administrator', in_progress: 'In progress' }[value] || String(value || '').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()));
const nouns = { users: ['person', 'people'], organizations: ['business', 'businesses'], events: ['event', 'events'], locations: ['venue', 'venues'], orders: ['purchase', 'purchases'], offerings: ['ticket or package', 'tickets & packages'], owners: ['ownership assignment', 'ownership assignments'], employees: ['business assignment', 'business assignments'], venue_access: ['venue assignment', 'venue assignments'], guestlist: ['guestlist request', 'guestlist requests'], tickets: ['admission ticket', 'admission tickets'], check_ins: ['attendance record', 'attendance records'], payments: ['payment', 'payments'], order_items: ['purchased item', 'purchased items'], audit: ['change', 'changes'], team_invitations: ['team invitation', 'team invitations'], guestlist_invitations: ['guestlist invitation', 'guestlist invitations'], onboarding_invitations: ['account invitation', 'account invitations'], notifications: ['notification', 'notifications'], organization_affiliates: ['business referral', 'business referrals'], event_affiliates: ['event referral', 'event referrals'] };
export function recordCount(total, resource) {
  const labels = nouns[resource] || ['record', 'records'];
  return `${total.toLocaleString()} ${labels[total === 1 ? 0 : 1]}`;
}
export function recordStatuses(record, resource) {
  const access = record.lifecycleState && record.lifecycleState !== 'active' ? record.lifecycleState : null;
  const states = resource === 'users' ? [access || (record.isActive === false ? 'disabled' : 'active')] : [record.status, access];
  if (record.onboardingPending) states.push('Setup pending');
  return [...new Set(states.filter(Boolean))];
}
