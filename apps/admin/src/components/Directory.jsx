import { lazy, Suspense, useState } from 'react';
import { useAdminResource } from '../hooks/useAdminResource';
import { primaryResources, listQuery } from '../lib/navigation';
import { formatDate, formatMoney } from '../lib/admin';
import { Button } from './ui/button';
import { RecordForm } from './Management';
import { ResourceState, Pager } from './ResourceState';
import OnboardingForm from './OnboardingForm';
import BusinessAccessRequests from './BusinessAccessRequests';
import { ReferenceInput } from './Management';
import { readSession } from '../lib/api';
import { hasAdminPermission } from '../lib/permissions';
import EventsSearchForm from './EventsSearchForm';
import SortControls from './SortControls';
import { selectedStatuses } from '../lib/status-filter';
import { MultiSelect as BusinessMultiSelect } from '../../../business/src/components/MultiSelect';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';
import PageHeader from './PageHeader';
import { humanLabel, recordCount, recordStatuses } from '../lib/record-summary';
export { humanLabel } from '../lib/record-summary';
const AdminEventEditor = lazy(() => import('./AdminEventEditor'));
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export const resourceLabels = { organizations: 'Businesses', users: 'People', events: 'Events', locations: 'Venues', offerings: 'Tickets & packages', orders: 'Purchases', payments: 'Payment history', tickets: 'Admission tickets', guestlist: 'Guestlist requests', guestlist_invitations: 'Guestlist invitations', team_invitations: 'Team invitations', onboarding_invitations: 'Account invitations', owners: 'Business ownership', employees: 'Business access', organization_affiliates: 'Business referrals', event_affiliates: 'Event referrals', notifications: 'Notifications', check_ins: 'Admission history', credentials: 'Sign-in security', account_tokens: 'Account recovery history', audit: 'Change history', email_outbox: 'Email delivery', attributions: 'Referral history' };
export const recordTitle = (record, resource) => (['owners', 'employees', 'venue_access', 'organization_affiliates', 'event_affiliates'].includes(resource) && (record.location?.name || record.organization?.name || record.event?.title) ? `${record.location?.name || record.organization?.name || record.event?.title}${record.role ? ` — ${humanLabel(record.role)}` : ''}` : null) || record.displayName || record.user?.displayName || record.name || record.title || record.email || record.user?.email || (record.action ? humanLabel(record.action.replaceAll('.', ' ')) : record.code) || `${(resourceLabels[resource] || humanLabel(resource))} ${record.id.slice(0, 8)}`;
const statuses = { users: ['active', 'disabled', 'suspended', 'archived'], organizations: ['active', 'suspended', 'closed', 'archived'], events: ['draft', 'published', 'cancelled', 'completed', 'suspended', 'archived'], orders: ['pending', 'paid', 'cancelled', 'refunded'] };
const sorts = { users: [['createdAt', 'Joined'], ['displayName', 'Name'], ['email', 'Email']], organizations: [['createdAt', 'Created'], ['name', 'Name'], ['status', 'Status']], events: [['createdAt', 'Created'], ['startsAt', 'Starts'], ['title', 'Title'], ['status', 'Status']], orders: [['createdAt', 'Created'], ['totalCents', 'Total'], ['status', 'Status']], audit: [['createdAt', 'Created'], ['action', 'Action']] };
export function RecordList({ result, resourceKey, onOpenRecord, onPage }) {
  const view = { users: 'View person', organizations: 'View business', events: 'View event', locations: 'View venue', orders: 'View purchase' }[resourceKey] || 'View record';
  return <section className="panel management-panel"><p role="status">{recordCount(result.total, resourceKey)}</p>{result.items.length ? <div className="management-records">{result.items.map((record) => <article className="management-record" data-testid="admin-record" data-record-id={record.id} key={record.id}><div className="management-record-summary"><h3>{recordTitle(record, resourceKey)}</h3><p className="management-record-state">{recordStatuses(record, resourceKey).map(humanLabel).join(' · ')}</p><p className="management-record-context">{record.displayName ? record.email : record.city ? [record.city, record.region].filter(Boolean).join(', ') : record.startsAt ? formatDate(record.startsAt, true) : record.totalCents != null ? formatMoney(record.totalCents) : humanLabel(record.role || '')}{record.organization?.name ? ` · ${record.organization.name}` : ''}{record.event?.title ? ` · ${record.event.title}` : ''}</p><details className="management-record-meta"><summary>Identifiers & history</summary><div><code>{record.id}</code><small>Created {formatDate(record.createdAt, true)}</small></div></details></div><Button variant="outline" onClick={() => onOpenRecord(resourceKey, record.id)}>{view}</Button></article>)}</div> : <div className="empty">No matching {resourceLabels[resourceKey]?.toLowerCase() || 'records'}.</div>}<Pager result={result} onPage={onPage}/></section>;
}
export default function Directory(props) {
  const requests = props.section === 'businesses' && props.params.get('businessView') === 'requests';
  const businessTabs = props.section === 'businesses' && <div className="record-tabs business-view-tabs" role="tablist" aria-label="Business views">{[['directory', 'Businesses'], ['requests', 'Access requests']].map(([view, title]) => <Button id={`admin-business-view-${view}`} variant="outline" role="tab" aria-selected={requests === (view === 'requests')} key={view} onClick={() => props.onUpdate({ businessView: view === 'requests' ? 'requests' : null, request: null }, false)}>{title}</Button>)}</div>;
  return requests ? <BusinessAccessRequests {...props} businessTabs={businessTabs}/> : <DirectoryRecords {...props} businessTabs={businessTabs}/>;
}
function DirectoryRecords({ section, resourceKey, params, onUpdate, onOpenRecord, businessTabs }) {
  const [refresh, setRefresh] = useState(0); const [creating, setCreating] = useState(false); const [onboarding, setOnboarding] = useState(false);
  const [chooseBusiness, setChooseBusiness] = useState(false); const [businessId, setBusinessId] = useState(''); const [createEvent, setCreateEvent] = useState(false);
  const metadata = useAdminResource('/admin/management/resources', refresh);
  const key = primaryResources[section];
  const result = useAdminResource(`/admin/management/${key}?${listQuery(params)}`, refresh);
  const resource = metadata.data?.find((item) => item.key === key);
  const change = (values) => onUpdate({ ...values, page: 1 });
  const changed = (record) => {
    setCreating(false); setOnboarding(false); setRefresh((value) => value + 1);
    // Inviting a person returns an invitation; its id is not the person's id.
    const id = key === 'users' ? record?.userId : record?.id;
    if (id) onOpenRecord(key, id);
  };
  const searchLabel = { users: 'Search people', organizations: 'Search businesses', events: 'Search events', audit: 'Search change history' }[key];
  const placeholder = { users: 'Name, phone, email or ID', organizations: 'Business name', events: 'Event title', audit: 'Action or description' }[key];
  const selected = selectedStatuses(params);
  const sortControls = <SortControls label="Sort records">
    <label>Sort by<select aria-label="Sort records by" value={params.get('sort') || 'createdAt'} onChange={(event) => change({ sort: event.target.value })}>{(sorts[key] || [['createdAt', 'Created']]).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
    <label>Direction<select aria-label="Sort direction" value={params.get('direction') || 'desc'} onChange={(event) => change({ direction: event.target.value })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
  </SortControls>;
  return <section className="management">
    <PageHeader title={{ users: 'People', organizations: 'Businesses', events: 'Events', audit: 'Audit' }[key]} description={{ users: 'People and their access across the platform.', organizations: 'Business workspaces, venues, ownership and account setup.', events: 'Events, purchases and admission history.', audit: 'The history of platform changes.' }[key]}>
        <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Refresh</Button>
        {key === 'organizations' && hasAdminPermission(readSession()?.user, 'businesses.manage') && <Button onClick={() => setOnboarding(true)}>Onboard business</Button>}
        {key === 'events' && hasAdminPermission(readSession()?.user, 'events.manage') && <Button onClick={() => setChooseBusiness(true)}>Create event</Button>}
        {key === 'users' && resource?.canCreate && <Button onClick={() => setCreating(true)}>Invite person</Button>}
    </PageHeader>
    {businessTabs}
    <div className={`management-toolbar directory-toolbar${key === 'events' ? ' directory-events' : ''}`}>
      <div className="management-list-filters">
      {statuses[key] && <BusinessMultiSelect label="Status" options={statuses[key].map((id) => ({ id, label: humanLabel(id) }))} selected={selected} onChange={(next) => change({ statuses: next, status: null })}/>}
      </div>
      {key === 'events' ? <EventsSearchForm params={params} onUpdate={onUpdate} sortControls={sortControls}/> : <><SubmittedSearch id="admin-record-search" label={searchLabel} value={params.get('search') || ''} resetToken={key} onSearch={(search) => change({ search })} placeholder={key === 'audit' ? placeholder : 'Search'} icon={key !== 'audit'} hideLabel={key !== 'audit'} description={key === 'users' ? 'Search by name, phone, email or ID.' : undefined}/>{sortControls}</>}
    </div>
    <ResourceState loading={result.loading || metadata.loading} error={result.error || metadata.error} onRetry={() => setRefresh((value) => value + 1)}>{result.data && <RecordList result={result.data} resourceKey={key} onOpenRecord={onOpenRecord} onPage={(page) => onUpdate({ page }, false)}/>}</ResourceState>
    {creating && resource && <RecordForm resource={resource} resources={metadata.data} onClose={() => setCreating(false)} onSaved={changed}/>}
    {onboarding && <OnboardingForm onClose={() => setOnboarding(false)} onSaved={() => changed()}/>}
    {chooseBusiness && <Dialog open onOpenChange={(open) => !open && setChooseBusiness(false)}><DialogContent className="dialog"><DialogHeader><DialogTitle>Create event for a business</DialogTitle><DialogDescription>Choose the business responsible for this event.</DialogDescription></DialogHeader><ReferenceInput field={{ resource: 'organizations', label: 'Event business', required: true }} resources={metadata.data || []} value={businessId} onChange={setBusinessId}/><Button disabled={!businessId} onClick={() => { setChooseBusiness(false); setCreateEvent(true); }}>Continue to event editor</Button></DialogContent></Dialog>}
    {createEvent && <Suspense fallback={<p className="loading" role="status">Loading event editor…</p>}><AdminEventEditor businessId={businessId} session={readSession()} onClose={() => setCreateEvent(false)} onSaved={() => { setCreateEvent(false); setRefresh((value) => value + 1); }}/></Suspense>}
  </section>;
}
