import { useState } from 'react';
import { api } from '../lib/api';
import { useAdminResource } from '../hooks/useAdminResource';
import { hasAdminPermission } from '../lib/permissions';
import { Button } from '../../../business/src/components/ui/button';
import { Input } from '../../../business/src/components/ui/input';
import { ResourceState, Pager } from './ResourceState';
import VenueForm from './VenueForm';
import SubmittedSearch from '../../../business/src/components/SubmittedSearch';

export default function BusinessVenues({ business, params, onUpdate, onOpenRecord, refresh, onChanged, session, request = api, basePath = '/admin/businesses', audience = 'admin' }) {
  const [editing, setEditing] = useState(null); const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({ page: params.get('venuesPage') || '1', pageSize: '25', search: params.get('venueSearch') || '' });
  const state = useAdminResource(`${basePath}/${business.id}/venues?${query}`, refresh, request);
  const canWrite = audience === 'admin' ? hasAdminPermission(session.user, 'access.manage') : Boolean(state.data?.canCreate);
  const changed = () => { setEditing(null); setCreating(false); onChanged(); };
  return <section className="venue-workspace" aria-label="Business venues">
    <div className="record-heading"><div><h3>Venues</h3><p className="notice">Manage this business’s venues. Events can also use their own physical location.</p></div></div>
    <div className="management-toolbar"><SubmittedSearch id="business-venue-search" label="Search business venues" value={params.get('venueSearch') || ''} resetToken={business.id} onSearch={(venueSearch) => onUpdate({ venueSearch, venuesPage: 1 })}/>{canWrite && <Button onClick={() => setCreating(true)}>Create venue</Button>}<Button variant="outline" onClick={() => onUpdate({ venuesRefresh: String(Date.now()) }, false)}>Refresh venues</Button></div>
    <ResourceState {...state} onRetry={() => onUpdate({ venuesRefresh: String(Date.now()) }, false)}>{state.data && <>
      <p role="status">{state.data.total} {state.data.total === 1 ? 'venue' : 'venues'} match these filters.</p>
      {state.data.items.length ? state.data.items.map((venue) => <article className="management-record" key={venue.id} data-testid="business-venue"><div><h4>{venue.name || 'Unnamed venue'}</h4><p className="notice">{[venue.addressLine1, venue.city, venue.region, venue.postalCode].filter(Boolean).join(', ') || 'Address not provided'}</p><small>{venue.lifecycleState || 'active'}</small></div><div className="record-actions"><Button variant="outline" onClick={() => onOpenRecord('locations', venue.id, { preserveParent: true })}>View venue</Button>{(audience === 'admin' ? canWrite : venue.canManage) && venue.lifecycleState === 'active' && <Button variant="outline" onClick={() => setEditing(venue)}>Edit venue</Button>}{(audience === 'admin' || venue.canManageTeam) && <Button variant="outline" onClick={() => onOpenRecord('locations', venue.id, { preserveParent: true, tab: 'venue-team' })}>Venue team</Button>}</div></article>) : <p className="empty">{params.get('venueSearch') ? 'No venues match this search.' : 'No venues linked to this business.'}</p>}
      <Pager result={state.data} onPage={(page) => onUpdate({ venuesPage: page }, false)}/>
    </>}</ResourceState>
    {(creating || editing) && <VenueForm businessId={business.id} businessVersion={state.data?.organizationVersion ?? business.version} record={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={changed} request={request} basePath={basePath}/>}
  </section>;
}
