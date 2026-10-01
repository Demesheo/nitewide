export const relatedRecords = {
  organizations: [['users', 'People', { organizationId: true }], ['events', 'Events', { organizationId: true }], ['team_invitations', 'Team invitations', { organizationId: true }], ['organization_affiliates', 'Promoters & referrals', { organizationId: true }], ['audit', 'Change history', { organizationId: true }]],
  events: [['offerings', 'Tickets & packages', { eventId: true }], ['orders', 'Purchases', { eventId: true }], ['guestlist', 'Guestlist', { eventId: true }], ['guestlist_invitations', 'Guestlist invitations', { eventId: true }], ['tickets', 'Admission tickets', { eventId: true }], ['check_ins', 'Attendance', { eventId: true }], ['team_invitations', 'Promoter invitations', { eventId: true }], ['event_affiliates', 'Promoters & referrals', { eventId: true }], ['audit', 'Change history', { entityId: true }]],
  users: [['owners', 'Ownership & management', { userId: true }], ['employees', 'Business employment', { userId: true }], ['venue_access', 'Venue roles', { userId: true }], ['orders', 'Purchases', { userId: true }], ['guestlist', 'Guestlist requests', { userId: true }], ['tickets', 'Admission tickets', { userId: true }], ['check_ins', 'Attendance', { userId: true }], ['team_invitations', 'Team invitations', { userId: true }], ['guestlist_invitations', 'Guestlist invitations', { userId: true }], ['onboarding_invitations', 'Account invitations', { userId: true }], ['organization_affiliates', 'Business referrals', { userId: true }], ['event_affiliates', 'Event referrals', { userId: true }], ['attributions', 'Referral activity', { userId: true }], ['notifications', 'Notifications', { userId: true }], ['audit', 'Change history', { entityId: true }], ['credentials', 'Sign-in security', { userId: true }], ['account_tokens', 'Account recovery', { userId: true }]],
  orders: [['order_items', 'Purchased items', { orderId: true }], ['payments', 'Payment history', { orderId: true }], ['audit', 'Change history', { entityId: true }]],
};
export const personActivityGroups = [
  ['people-roles', 'Business & venue roles', ['owners', 'employees', 'venue_access']],
  ['people-purchases', 'Purchases & admission', ['orders', 'guestlist', 'tickets', 'check_ins']],
  ['people-invitations', 'Invitations', ['team_invitations', 'guestlist_invitations', 'onboarding_invitations']],
  ['people-referrals', 'Referrals', ['organization_affiliates', 'event_affiliates', 'attributions']],
  ['people-notifications', 'Notifications', ['notifications']],
  ['people-history', 'History & security', ['audit', 'credentials', 'account_tokens']],
];
export const eventActivityGroups = [
  ['offerings', 'Tickets & packages', ['offerings']],
  ['orders', 'Purchases', ['orders']],
  ['event-guestlist', 'Guestlist', ['guestlist', 'guestlist_invitations']],
  ['event-admissions', 'Admissions', ['tickets', 'check_ins']],
  ['event-referrals', 'Referrals', ['event_affiliates', 'team_invitations']],
  ['audit', 'History', ['audit']],
];
export function personActivity(tab, activity, available) {
  return groupedActivity(personActivityGroups, tab, activity, available);
}
export function groupedActivity(groups, tab, activity, available) {
  const group = groups.find(([key, , members]) => key === tab || members.includes(tab));
  if (!group) return null;
  const members = available.filter(([key]) => group[2].includes(key));
  return { key: group[0], title: group[1], members, selected: members.find(([key]) => key === activity || key === tab) || members[0] };
}
