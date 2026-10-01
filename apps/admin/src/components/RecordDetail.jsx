import { lazy, Suspense, useState } from 'react';
import { api } from '../lib/api';
import { useAdminResource } from '../hooks/useAdminResource';
import { formatDate, formatMoney } from '../lib/admin';
import { listQuery } from '../lib/navigation';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { RecordForm } from './Management';
import { RecordList, recordTitle, humanLabel } from './Directory';
import { ResourceState, Pager } from './ResourceState';
import Ownership from './Ownership';
const AdminEventEditor = lazy(() => import('./AdminEventEditor'));
import { hasAdminPermission } from '../lib/permissions';
import EventRecordHeader, { EventRecordDetails } from './EventRecordHeader';
import BusinessVenues from './BusinessVenues';
import VenueForm from './VenueForm';
import VenueTeam from './VenueTeam';
import PersonProfile from './PersonProfile';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';
import { relatedRecords, personActivityGroups, eventActivityGroups, groupedActivity } from '../lib/record-relations';
import { recordStatuses } from '../lib/record-summary';

const names = { organizations: 'business', users: 'person', events: 'event', locations: 'venue' };
const references = { organizationId: ['organizations', 'Business'], eventId: ['events', 'Event'], userId: ['users', 'Person'], creatorUserId: ['users', 'Creator'], buyerUserId: ['users', 'Buyer'], holderUserId: ['users', 'Ticket holder'], orderId: ['orders', 'Purchase'], locationId: ['locations', 'Venue'] };
const fieldNames = { isInternalAdmin: 'Internal admin', financeAuthorized: 'Finance permission', totalCents: 'Purchase total recorded', priceCents: 'Price per unit', isDiscoverable: 'Show in discovery', startsAt: 'Starts', endsAt: 'Ends', emailVerifiedAt: 'Email verified', lifecycleState: 'Access state' };
const fieldLabel = (key) => { const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '); return fieldNames[key] || words[0].toUpperCase() + words.slice(1); };
const valueLabel = (key, value) => value == null ? '—' : key.endsWith('At') ? formatDate(value, true) : key.endsWith('Cents') ? formatMoney(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? null : ['role', 'internalAdminRole', 'status', 'lifecycleState'].includes(key) ? humanLabel(value) : String(value).replaceAll('_', ' ');
function RecordBasics({ resourceKey, detail, onOpenRecord }) {
  const hidden = ['id', 'version', 'createdAt', 'updatedAt', 'venueIds', 'slug', 'imageAssetId', 'imageUrl', 'businessType', 'independentCreator', 'name', 'title', 'displayName', 'status', 'lifecycleState'];
  return <div className="record-section-grid"><section className="record-details-group"><h3>{resourceKey === 'organizations' ? 'Business profile' : resourceKey === 'users' ? 'Person details' : 'Record information'}</h3><dl className="record-basics">{Object.entries(detail).filter(([key, value]) => !hidden.includes(key) && typeof value !== 'object' && !references[key]).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{valueLabel(key, value)}</dd></div>)}</dl></section>{Object.keys(references).some((key) => detail[key] && !(resourceKey === 'organizations' && key === 'locationId')) && <section className="record-details-group"><h3>Related records</h3><div className="record-link-grid">{Object.entries(references).filter(([key]) => detail[key] && !(resourceKey === 'organizations' && key === 'locationId')).map(([key, [kind, title]]) => <Button key={key} variant="outline" onClick={() => onOpenRecord(kind, detail[key])}>View {title.toLowerCase()}</Button>)}</div></section>}</div>;
}
function RecordTools({ resourceKey, resource, detail, actions, onAction }) {
  return <div className="record-admin-tools"><details className="management-record-meta"><summary>Record identifiers & history</summary><div><code>{detail.id}</code><small>Version {detail.version ?? 'unavailable'}</small>{detail.createdAt && <small>Created {formatDate(detail.createdAt, true)}</small>}{detail.updatedAt && <small>Updated {formatDate(detail.updatedAt, true)}</small>}</div></details><section className="record-context-actions"><h3>Contextual actions</h3>{actions.length ? <div className="record-actions">{actions.map((item) => <Button variant="outline" key={item.id} onClick={() => onAction(item)}>{item.lifecycle ? `${item.id[0].toUpperCase()}${item.id.slice(1)} ${names[resourceKey] || resource.label.toLowerCase()}` : item.label}</Button>)}</div> : <p className="record-muted">No manual state actions are available for this record.</p>}</section></div>;
}
function RelatedRecords({ resource, title, scope, params, onUpdate, onOpenRecord, refresh, resources, person, onCreateEvent, onEditOfferings }) {
  const [creating, setCreating] = useState(false);
  const invitations = Boolean(scope.userId && ['team_invitations', 'guestlist_invitations'].includes(resource));
  const query = new URLSearchParams({ page: params.get('relatedPage') || '1', search: params.get('relatedSearch') || '' });
  const relation = invitations ? { relation: params.get('relation') || 'received' } : {};
  const result = useAdminResource(`/admin/management/${resource}?${listQuery(query, { ...scope, ...relation })}`, refresh);
  const config = resources.find((item) => item.key === resource);
  const createLabel = { employees: 'Add business employee', organization_affiliates: 'Add business promoter', event_affiliates: 'Add event promoter', guestlist: 'Add guestlist request', guestlist_invitations: 'Invite guest', team_invitations: 'Invite team member', notifications: 'Create notification' }[resource];
  const createValues = { ...scope, ...(person ? { email: person.email, phone: person.phone || '' } : {}) };
  const lockedFields = (config?.fields || []).filter((field) => createValues[field.key] && ['organizationId', 'eventId', 'userId', ...(person ? ['email', 'phone'] : [])].includes(field.key)).map((field) => field.key);
  const contextualOpen = (kind, id, options) => onOpenRecord(kind, id, { preserveParent: true, ...options });
  return <section className="related-activity" aria-label={title}>
    <div className="related-heading"><h3>{title}</h3><div className="record-actions">{resource === 'events' && onCreateEvent && <Button onClick={onCreateEvent}>Create event</Button>}{resource === 'offerings' && onEditOfferings && <Button onClick={onEditOfferings}>Manage tickets & packages</Button>}{config?.canCreate && createLabel && <Button onClick={() => setCreating(true)}>{createLabel}</Button>}</div></div>
    <SubmittedSearch id="related-record-search" label={`Search ${title.toLowerCase()}`} value={params.get('relatedSearch') || ''} resetToken={resource} onSearch={(relatedSearch) => onUpdate({ relatedSearch, relatedPage: 1 })}/>
    {invitations && <div className="activity-options" role="group" aria-label="Invitation direction">{[['received', 'Received by this person'], ['sent', 'Sent by this person']].map(([value, label]) => <Button key={value} variant="outline" aria-pressed={(params.get('relation') || 'received') === value} onClick={() => onUpdate({ relation: value, relatedPage: 1 }, false)}>{label}</Button>)}</div>}
    <ResourceState {...result} onRetry={() => onUpdate({ relatedRefresh: String(Date.now()) })}>{result.data && <RecordList result={result.data} resourceKey={resource} onOpenRecord={contextualOpen} onPage={(page) => onUpdate({ relatedPage: page }, false)}/>}</ResourceState>
    {creating && config && <RecordForm resource={config} resources={resources} initialValues={createValues} lockedFields={lockedFields} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); onUpdate({ relatedRefresh: String(Date.now()) }); }}/>}
  </section>;
}
function ActionDialog({ resourceKey, record, action, onClose, onSaved }) {
  const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const notice = useAdminResource(resourceKey === 'events' && action.id === 'cancel' ? `/admin/events/${record.id}/notification-preview` : null);
  const actionName = action.lifecycle ? `${action.id[0].toUpperCase()}${action.id.slice(1)} ${names[resourceKey] || resourceKey.replaceAll('_', ' ')}` : action.label;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const onboarding = resourceKey === 'onboarding_invitations';
      await api(onboarding ? `/admin/onboarding/${record.id}/${action.id}` : resourceKey === 'locations' && record.organizationId ? `/admin/businesses/${record.organizationId}/venues/${record.id}/${action.id}` : `/admin/management/${resourceKey}/${record.id}/actions/${action.id}`, { method: 'POST', body: JSON.stringify({ reason, ...(action.lifecycle || onboarding || (resourceKey === 'events' && action.id === 'cancel') ? { version: record.version } : {}) }) });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}><DialogContent className="dialog management-dialog"><DialogHeader><DialogTitle>{actionName}</DialogTitle><DialogDescription>{recordTitle(record, resourceKey)} · {record.id}</DialogDescription></DialogHeader><form onSubmit={submit}><p className="notice">{resourceKey === 'events' && action.id === 'cancel' ? 'Cancellation stops new sales and retains existing purchases and admission history. Refunds are not automatic.' : action.id === 'suspend' && resourceKey === 'organizations' ? 'Suspension blocks new sales, invitations and business changes. Existing bookings and admissions remain valid. Event cancellation is a separate action.' : 'This action is audited. Historical purchases, admissions and memberships are retained.'}</p>{notice.loading && <p role="status">Checking attendee notification count…</p>}{notice.error && <p className="error" role="alert">{notice.error}</p>}{notice.data && <p className="notice">{notice.data.recipients} affected attendees will be notified through the event notice workflow.</p>}<label htmlFor="record-action-reason">Required audit reason<textarea id="record-action-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label><label className="management-confirm" htmlFor="record-action-confirm"><input id="record-action-confirm" type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>I confirm this action for the record shown above.</label>{error && <p className="error" role="alert">{error}{error.includes('changed') && ' Reload the record and review its current state before retrying.'}</p>}<div className="management-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !confirmed || notice.loading || Boolean(notice.error)}>{busy ? 'Applying…' : actionName}</Button></div></form></DialogContent></Dialog>;
}
export default function RecordDetail({ resourceKey, id, params, onUpdate, onBack, returnLabel, onOpenRecord, session }) {
  const [refresh, setRefresh] = useState(0); const [editing, setEditing] = useState(false); const [action, setAction] = useState(null); const [createEvent, setCreateEvent] = useState(false);
  const record = useAdminResource(`/admin/management/${resourceKey}/${id}`, refresh);
  const metadata = useAdminResource('/admin/management/resources', refresh);
  const resource = metadata.data?.find((item) => item.key === resourceKey);
  const detail = record.data; const tab = params.get('tab') || 'basics';
  const eventLocation = useAdminResource(resourceKey === 'events' && detail?.locationId && !detail.location ? `/admin/management/locations/${detail.locationId}` : null, refresh);
  const relatedTabs = (relatedRecords[resourceKey] || []).filter(([key]) => metadata.data?.some((item) => item.key === key));
  const changed = () => { setEditing(false); setAction(null); setRefresh((value) => value + 1); };
  const actions = (resource?.actions || []).filter(() => resourceKey !== 'locations' || !detail?.organizationId || hasAdminPermission(session.user, 'access.manage')).filter((item) => !item.lifecycle || (detail?.lifecycleState === 'active' ? ['suspend', 'archive'].includes(item.id) : detail?.lifecycleState === 'suspended' ? ['archive', 'restore'].includes(item.id) : item.id === 'restore'));
  if (resourceKey === 'onboarding_invitations' && hasAdminPermission(session.user, 'businesses.manage') && detail && !detail.acceptedAt && !detail.revokedAt) actions.push({ id: 'resend', label: 'Resend setup email' }, { id: 'revoke', label: 'Revoke setup invitation' });
  const activityGroups = resourceKey === 'users' ? personActivityGroups : resourceKey === 'events' ? eventActivityGroups : null;
  const personGroup = activityGroups ? groupedActivity(activityGroups, tab, params.get('activity'), relatedTabs) : null;
  const selectedRelated = personGroup?.selected || relatedTabs.find(([key]) => key === tab);
  const visibleRelatedTabs = activityGroups ? activityGroups.filter(([, , keys]) => relatedTabs.some(([key]) => keys.includes(key))).map(([key, title]) => [key, title]) : relatedTabs;
  const selectTab = (key) => onUpdate({ tab: key, activity: null, relation: null, relatedPage: 1, relatedSearch: null }, false);
  const ownedVenue = resourceKey === 'locations' && Boolean(detail?.organizationId);
  const venueContext = useAdminResource(ownedVenue ? `/admin/businesses/${detail.organizationId}/venues/${id}` : null, refresh);
  const venueDetail = venueContext.data || detail;
  const canEdit = resource?.canEdit && (!ownedVenue || (hasAdminPermission(session.user, 'access.manage') && detail.lifecycleState === 'active'));
  return <section className="record-detail">
    <Button variant="ghost" className="record-back" onClick={onBack}>← {returnLabel}</Button>
    <ResourceState loading={record.loading || metadata.loading || (ownedVenue && venueContext.loading)} error={record.error || metadata.error || (ownedVenue && venueContext.error)} onRetry={() => setRefresh((value) => value + 1)}>
      {detail && resource && <>
        <section className="panel management-panel record-main-panel">
          {resourceKey === 'events' ? <EventRecordHeader event={detail} location={detail.location || eventLocation.data} locationLoading={eventLocation.loading} locationError={eventLocation.error} canEdit={canEdit} onEdit={() => setEditing(true)} onRefresh={() => setRefresh((value) => value + 1)}/> : <header className="record-heading"><div><p className="eyebrow">{names[resourceKey] || resource.label}</p><h2>{recordTitle(detail, resourceKey)}</h2><div className="record-statuses">{recordStatuses(detail, resourceKey).map((state) => <span key={state}>{humanLabel(state)}</span>)}</div></div><div className="record-actions">{canEdit && <Button onClick={() => setEditing(true)}>Edit details</Button>}<Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Refresh record</Button></div></header>}
          <div role="tablist" aria-label="Record sections" className="record-tabs">
            {[['basics', resourceKey === 'users' ? 'Profile' : 'Details'], ...(resourceKey === 'organizations' ? [['venues', 'Venues']] : []), ...(ownedVenue ? [['venue-team', 'Venue team']] : []), ...(resourceKey === 'organizations' && hasAdminPermission(session.user, 'businesses.manage') ? [['ownership', 'Ownership & finance']] : []), ...visibleRelatedTabs].map(([key, title]) => <Button key={key} role="tab" variant="ghost" aria-selected={(personGroup?.key || tab) === key} onClick={() => selectTab(key)}>{title}</Button>)}
          </div>
          {tab === 'basics' && <>
            {resourceKey === 'events' ? <EventRecordDetails event={detail} onOpenRecord={(kind, recordId) => onOpenRecord(kind, recordId, { preserveParent: true })}/> : resourceKey === 'users' ? <PersonProfile person={detail} onActivity={selectTab}/> : <RecordBasics resourceKey={resourceKey} detail={detail} onOpenRecord={(kind, recordId) => onOpenRecord(kind, recordId, { preserveParent: true })}/>}
            {resourceKey === 'venue_access' && detail.locationId && <Button variant="outline" onClick={() => onOpenRecord('locations', detail.locationId, { preserveParent: true, tab: 'venue-team' })}>Manage this venue’s team</Button>}
            {resource.unavailable && <p className="notice">{resource.unavailable}</p>}
            <RecordTools resourceKey={resourceKey} resource={resource} detail={detail} actions={actions} onAction={setAction}/>
          </>}
          {tab === 'ownership' && resourceKey === 'organizations' && hasAdminPermission(session.user, 'businesses.manage') && <Ownership id={id} onOpenRecord={onOpenRecord} onChanged={changed}/>}
        </section>
        {tab === 'venues' && resourceKey === 'organizations' && <BusinessVenues business={detail} params={params} onUpdate={onUpdate} onOpenRecord={onOpenRecord} refresh={`${refresh}:${params.get('venuesRefresh') || ''}`} onChanged={changed} session={session}/>}
        {tab === 'venue-team' && ownedVenue && <VenueTeam venue={venueDetail} params={params} onUpdate={onUpdate} onOpenRecord={onOpenRecord} session={session}/>}
        {personGroup && personGroup.members.length > 1 && <div className="activity-options" role="group" aria-label={personGroup.title}>{personGroup.members.map(([key, title]) => <Button key={key} variant="outline" aria-pressed={selectedRelated?.[0] === key} onClick={() => onUpdate({ tab: personGroup.key, activity: key, relatedSearch: null, relatedPage: 1, relation: null }, false)}>{title}</Button>)}</div>}
        {selectedRelated && <RelatedRecords key={selectedRelated[0]} resource={selectedRelated[0]} title={selectedRelated[1]} scope={Object.fromEntries(Object.keys(selectedRelated[2]).map((key) => [key, id]))} params={params} onUpdate={onUpdate} onOpenRecord={onOpenRecord} refresh={`${refresh}:${params.get('relatedRefresh') || ''}`} resources={metadata.data} person={resourceKey === 'users' ? detail : null} onCreateEvent={resourceKey === 'organizations' && hasAdminPermission(session.user, 'events.manage') ? () => setCreateEvent(true) : null} onEditOfferings={resourceKey === 'events' && canEdit ? () => setEditing(true) : null}/>}
        {createEvent && <Suspense fallback={<p role="status">Loading event editor…</p>}><AdminEventEditor businessId={id} session={session} onClose={() => setCreateEvent(false)} onSaved={() => { setCreateEvent(false); changed(); }}/></Suspense>}
        {editing && (resourceKey === 'events' ? <Suspense fallback={<p className="loading" role="status">Loading event editor…</p>}><AdminEventEditor id={id} session={session} onClose={() => setEditing(false)} onSaved={changed}/></Suspense> : ownedVenue ? <VenueForm businessId={detail.organizationId} record={venueDetail} onClose={() => setEditing(false)} onSaved={changed}/> : <RecordForm resource={resource} resources={metadata.data} record={detail} onClose={() => setEditing(false)} onSaved={changed}/>)}
        {action && <ActionDialog resourceKey={resourceKey} record={ownedVenue ? venueDetail : detail} action={action} onClose={() => setAction(null)} onSaved={changed}/>}
      </>}
    </ResourceState>
  </section>;
}
