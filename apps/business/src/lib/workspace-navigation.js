const sections = new Set(['overview', 'analytics', 'events', 'admissions', 'team', 'payments']);
const tabs = new Set(['sales', 'tickets', 'people', 'guestlist']);
const eventViews = new Set(['upcoming', 'past', 'draft', 'all']);
const eventSorts = new Set(['starts_asc', 'starts_desc', 'title_asc', 'title_desc', 'phase_asc', 'phase_desc', 'sales_asc', 'sales_desc', 'orders_asc', 'orders_desc', 'access_asc', 'access_desc']);
const reportTables = new Set(['regions', 'venues', 'events', 'offerings', 'team', 'customers']);
const reportEventId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '') ? value : '';
const reportSorts = new Set(['sales_desc', 'sales_asc', 'name_asc', 'name_desc', 'orders_desc', 'orders_asc', 'starts_asc', 'starts_desc', 'customers_asc', 'customers_desc', 'units_asc', 'units_desc', 'checkins_asc', 'checkins_desc', 'average_asc', 'average_desc', 'events_asc', 'events_desc', 'guestlist_asc', 'guestlist_desc', 'commission_asc', 'commission_desc', 'contribution_asc', 'contribution_desc']);
const teamRoles = new Set(['Owner', 'Manager', 'Employee', 'Promoter', 'Creator']);
const teamSorts = new Set(['name_asc', 'name_desc', 'role_asc', 'role_desc', 'email_asc', 'email_desc',
  'sales_asc', 'sales_desc', 'orders_asc', 'orders_desc', 'customers_asc', 'customers_desc', 'status_asc', 'status_desc']);
const overviewTeamSorts = new Set(['name_asc', 'name_desc', 'role_asc', 'role_desc', 'sales_asc', 'sales_desc', 'orders_asc', 'orders_desc', 'guestlist_asc', 'guestlist_desc', 'commission_asc', 'commission_desc', 'contribution_asc', 'contribution_desc']);
const pageNumber = (value) => Math.min(100000, Math.max(1, Math.trunc(Number(value) || 1)));
const pageSizeNumber = (value) => [10, 25, 50].includes(Number(value)) ? Number(value) : 10;
const timezoneNumber = (value) => { if (!value || value.length > 64) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } };

// Organization context belongs to the entire workspace; drill-down and filter
// state still belongs to one section and is cleared on navigation.
const scopeKeys = ['organizationIds', 'venueIds'];
const sectionKeys = {
  overview: new Set([...scopeKeys, 'days', 'overviewTeamRoles', 'overviewTeamSearch', 'overviewTeamSort', 'overviewTeamPage', 'overviewTeamPageSize']),
  analytics: new Set([...scopeKeys, 'reportPeriod', 'reportStart', 'reportEnd', 'reportRegion', 'reportRegions',
    'reportSearch', 'reportEvent', 'reportPerson', 'reportOfferingKind', 'reportOfferingName', 'reportTable',
    'reportSort', 'reportPage', 'reportPageSize', 'reportTimezone', 'reportTeamRoles', 'reportTeamSearch',
    'reportTeamSort', 'reportTeamPage', 'reportTeamPageSize']),
  events: new Set([...scopeKeys, 'event', 'entry', 'tab', 'eventView', 'eventSort', 'eventSearch',
    'eventFrom', 'eventTo', 'eventPage', 'eventPageSize']),
  admissions: new Set(),
  payments: new Set(['paymentOrganization', 'paymentView', 'paymentAccountReturn', 'commissionProfileReturn']),
  team: new Set(['teamOrganizationId', 'teamRoles', 'teamSearch', 'teamSort', 'teamPage',
    'teamPageSize', 'teamInvitationPage', 'teamInvitationPageSize', 'managedVenueBusinessId', 'managedVenueId',
    'managedVenueTab', 'venueSearch', 'venuesPage', 'venuesRefresh', 'venueTeamSearch', 'venueTeamPage']),
};
const defaultValues = {
  days: '30', eventView: 'upcoming', eventSort: 'starts_asc', eventPage: '1', eventPageSize: '10',
  overviewTeamSort: 'sales_desc', overviewTeamPage: '1', overviewTeamPageSize: '10',
  reportPeriod: '30', reportSort: 'sales_desc', reportPage: '1', reportPageSize: '10',
  reportTeamSort: 'sales_desc', reportTeamPage: '1', reportTeamPageSize: '10',
  teamSort: 'name_asc', teamPage: '1', teamPageSize: '10', teamInvitationPage: '1', teamInvitationPageSize: '10',
};

function activeSection(params) {
  // Keep already-issued Stripe onboarding links working after moving Payments.
  if (params.get('section') === 'team' && reportEventId(params.get('paymentAccountReturn')) && reportEventId(params.get('paymentOrganization'))) return 'payments';
  if (sections.has(params.get('section'))) return params.get('section');
  // Older event links omitted section; keep those links working.
  return params.get('event') ? 'events' : 'overview';
}

function sectionParams(params) {
  const section = activeSection(params);
  const allowed = sectionKeys[section];
  const scoped = new URLSearchParams();
  for (const [key, value] of params) if (key === 'workspaceOrganization' || allowed.has(key)) scoped.append(key, value);
  if (section === 'events' && !scoped.get('event')) {
    scoped.delete('entry'); scoped.delete('tab');
  }
  return { section, params: scoped };
}

export function readWorkspaceLocation(search = window.location.search) {
  const { section, params } = sectionParams(new URLSearchParams(search));
  const eventId = params.get('event');
  return {
    section, eventId, entryId: params.get('entry'), workspaceOrganization: params.get('workspaceOrganization') || '',
    paymentOrganization: reportEventId(params.get('paymentOrganization')),
    paymentView: params.get('paymentView') === 'commissions' ? 'commissions' : 'business',
    tab: tabs.has(params.get('tab')) ? params.get('tab') : null,
    organizationIds: params.getAll('organizationIds'), venueIds: params.getAll('venueIds'),
    days: ['7', '30', '90', '365'].includes(params.get('days')) ? params.get('days') : '30',
    eventView: eventViews.has(params.get('eventView')) ? params.get('eventView') : 'upcoming',
    eventSort: eventSorts.has(params.get('eventSort')) ? params.get('eventSort') : 'starts_asc',
    eventSearch: params.get('eventSearch') || '', eventFrom: params.get('eventFrom') || '',
    eventTo: params.get('eventTo') || '', eventPage: pageNumber(params.get('eventPage')),
    eventPageSize: pageSizeNumber(params.get('eventPageSize')),
    overviewTeamRoles: params.getAll('overviewTeamRoles').filter((role) => teamRoles.has(role)),
    overviewTeamSearch: params.get('overviewTeamSearch') || '',
    overviewTeamSort: overviewTeamSorts.has(params.get('overviewTeamSort')) ? params.get('overviewTeamSort') : 'sales_desc',
    overviewTeamPage: pageNumber(params.get('overviewTeamPage')),
    overviewTeamPageSize: pageSizeNumber(params.get('overviewTeamPageSize')),
    reportTeamRoles: params.getAll('reportTeamRoles').filter((role) => teamRoles.has(role)),
    reportTeamSearch: params.get('reportTeamSearch') || '',
    reportTeamSort: overviewTeamSorts.has(params.get('reportTeamSort')) ? params.get('reportTeamSort') : 'sales_desc',
    reportTeamPage: pageNumber(params.get('reportTeamPage')),
    reportTeamPageSize: pageSizeNumber(params.get('reportTeamPageSize')),
    teamOrganizationId: params.get('teamOrganizationId') || '',
    teamRoles: params.getAll('teamRoles').filter((role) => teamRoles.has(role)),
    teamSearch: params.get('teamSearch') || '',
    teamSort: teamSorts.has(params.get('teamSort')) ? params.get('teamSort') : 'name_asc',
    teamPage: pageNumber(params.get('teamPage')),
    teamPageSize: pageSizeNumber(params.get('teamPageSize')),
    teamInvitationPage: pageNumber(params.get('teamInvitationPage')),
    teamInvitationPageSize: pageSizeNumber(params.get('teamInvitationPageSize')),
    reportPeriod: ['7', '30', '90', '365', 'custom'].includes(params.get('reportPeriod')) ? params.get('reportPeriod') : '30',
    reportStart: params.get('reportStart') || '', reportEnd: params.get('reportEnd') || '',
    reportRegion: params.get('reportRegion') || '', reportSearch: params.get('reportSearch') || '',
    reportEvent: reportEventId(params.get('reportEvent')),
    reportPerson: params.get('reportPerson') || '',
    reportOfferingKind: params.get('reportOfferingKind') || '',
    reportOfferingName: params.get('reportOfferingName') || '',
    reportRegions: params.getAll('reportRegions'),
    reportTable: params.get('reportOfferingKind') || params.get('reportOfferingName')
      ? 'customers'
      : params.get('reportPerson')
        ? ['offerings', 'customers'].includes(params.get('reportTable')) ? params.get('reportTable') : 'offerings'
        : reportEventId(params.get('reportEvent'))
      ? ['offerings', 'team', 'customers'].includes(params.get('reportTable')) ? params.get('reportTable') : 'offerings'
      : reportTables.has(params.get('reportTable')) ? params.get('reportTable') : 'regions',
    reportSort: reportSorts.has(params.get('reportSort')) ? params.get('reportSort') : 'sales_desc',
    reportPage: pageNumber(params.get('reportPage')),
    reportPageSize: pageSizeNumber(params.get('reportPageSize')),
    reportTimezone: timezoneNumber(params.get('reportTimezone')),
  };
}

export function writeWorkspaceLocation(changes, { replace = false } = {}) {
  const url = new URL(window.location.href);
  url.pathname = '/app';
  // Explicit section changes are navigation: begin with that destination's
  // state. A partial write keeps only parameters owned by the active section.
  if (Object.hasOwn(changes, 'section')) {
    const organization = url.searchParams.get('workspaceOrganization');
    url.search = '';
    if (organization) url.searchParams.set('workspaceOrganization', organization);
  }
  for (const [key, value] of Object.entries(changes)) {
    url.searchParams.delete(key);
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const { section, params } = sectionParams(url.searchParams);
  url.search = '';
  if (section !== 'overview') url.searchParams.set('section', section);
  for (const [key, value] of params) {
    if (defaultValues[key] === value) continue;
    if (key === 'reportTable' && value === 'regions' &&
      !params.has('reportEvent') && !params.has('reportPerson') && !params.has('reportOfferingKind')) continue;
    url.searchParams.append(key, value);
  }
  const next = `${url.pathname}${url.search}`;
  const currentState = window.history.state;
  const clearEventScroll = Object.hasOwn(changes, 'section') || section !== 'events';
  const hasEventScroll = clearEventScroll && currentState != null && Object.hasOwn(currentState, 'eventsScrollY');
  const nextState = hasEventScroll ? { ...currentState } : currentState;
  if (hasEventScroll) delete nextState.eventsScrollY;
  if (next === `${window.location.pathname}${window.location.search}`) {
    if (hasEventScroll) window.history.replaceState(nextState, '', next);
    return;
  }
  window.history[replace ? 'replaceState' : 'pushState'](nextState, '', next);
  window.dispatchEvent(new window.Event('nitewide:workspace-location'));
}
