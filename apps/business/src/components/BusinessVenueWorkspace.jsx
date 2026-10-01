import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { writeWorkspaceLocation } from '../lib/workspace-navigation';
import { useAdminResource } from '../../../admin/src/hooks/useAdminResource';
import BusinessVenues from '../../../admin/src/components/BusinessVenues';
import VenueForm, { VenueLifecycleDialog } from '../../../admin/src/components/VenueForm';
import VenueTeam from '../../../admin/src/components/VenueTeam';
import { ResourceState } from '../../../admin/src/components/ResourceState';
import { Button } from './ui/button';

const basePath = '/business/organizations';
function venueParams(search, businessId) {
  const params = new URLSearchParams(search);
  if (params.get('managedVenueBusinessId') && params.get('managedVenueBusinessId') !== businessId) for (const key of ['managedVenueId', 'managedVenueTab', 'venueSearch', 'venuesPage', 'venuesRefresh', 'venueTeamPage', 'venueTeamSearch']) params.delete(key);
  return params;
}

export default function BusinessVenueWorkspace({ session, business, onUnauthorized }) {
  const [params, setParams] = useState(() => venueParams(window.location.search, business.id)); const [refresh, setRefresh] = useState(0); const [editing, setEditing] = useState(false); const [action, setAction] = useState(null);
  const request = useCallback(async (path, options) => { try { return await api(path, session, options); } catch (error) { if (error.status === 401) onUnauthorized?.(); throw error; } }, [session, onUnauthorized]);
  useEffect(() => {
    const priorBusinessId = new URLSearchParams(window.location.search).get('managedVenueBusinessId');
    if (priorBusinessId && priorBusinessId !== business.id) writeWorkspaceLocation({ managedVenueBusinessId: business.id, managedVenueId: null, managedVenueTab: null, venueSearch: null, venuesPage: null, venuesRefresh: null, venueTeamPage: null, venueTeamSearch: null }, { replace: true });
    const restore = () => setParams(venueParams(window.location.search, business.id)); window.addEventListener('popstate', restore); restore(); return () => window.removeEventListener('popstate', restore);
  }, [business.id]);
  function update(values, replace = true) {
    writeWorkspaceLocation({ ...values, managedVenueBusinessId: business.id }, { replace });
    setParams(new URLSearchParams(window.location.search));
  }
  const venueId = params.get('managedVenueId'); const tab = params.get('managedVenueTab') || 'details';
  const record = useAdminResource(venueId ? `${basePath}/${business.id}/venues/${venueId}` : null, refresh, request);
  const changed = () => { setEditing(false); setAction(null); setRefresh((value) => value + 1); };
  if (!venueId) return <BusinessVenues business={business} params={params} onUpdate={update} onOpenRecord={(_, id, options) => update({ managedVenueBusinessId: business.id, managedVenueId: id, managedVenueTab: options?.tab === 'venue-team' ? 'team' : 'details' }, false)} refresh={`${refresh}:${params.get('venuesRefresh') || ''}`} onChanged={changed} session={session} request={request} basePath={basePath} audience="business"/>;
  const venue = record.data;
  const actions = venue?.canLifecycle ? venue.lifecycleState === 'active' ? ['suspend', 'archive'] : venue.lifecycleState === 'suspended' ? ['restore', 'archive'] : ['restore'] : [];
  return <div className="venue-record-workspace"><Button variant="ghost" onClick={() => update({ managedVenueId: null, managedVenueTab: null }, false)}>← Back to business venues</Button><ResourceState {...record} onRetry={changed}>{venue && <>
    <section className="venue-workspace"><div className="record-heading"><div><h3>{venue.name}</h3><p className="notice">{venue.lifecycleState || 'active'}</p></div>{venue.canManage && venue.lifecycleState === 'active' && <Button onClick={() => setEditing(true)}>Edit venue</Button>}</div>
      <div className="record-actions"><Button variant={tab === 'details' ? 'default' : 'outline'} onClick={() => update({ managedVenueTab: 'details' }, false)}>Venue details</Button>{venue.canManageTeam && <Button variant={tab === 'team' ? 'default' : 'outline'} onClick={() => update({ managedVenueTab: 'team' }, false)}>Venue team</Button>}</div>
      {tab === 'details' && <><p className="notice">{[venue.addressLine1, venue.addressLine2, venue.city, venue.region, venue.postalCode, venue.countryCode].filter(Boolean).join(', ')}</p><p className="notice">Address visibility: {(venue.privacy || 'public').replaceAll('_', ' ')}</p><div className="record-actions">{actions.map((item) => <Button key={item} variant="outline" onClick={() => setAction(item)}>{item[0].toUpperCase() + item.slice(1)} venue</Button>)}</div></>}
    </section>
    {tab === 'team' && venue.canManageTeam && <VenueTeam venue={venue} params={params} onUpdate={update} session={session} request={request} basePath={basePath} audience="business"/>}
    {editing && <VenueForm businessId={business.id} record={venue} onClose={() => setEditing(false)} onSaved={changed} request={request} basePath={basePath}/>}
    {action && <VenueLifecycleDialog venue={venue} action={action} onClose={() => setAction(null)} onSaved={changed} request={request} basePath={basePath}/>}
  </>}</ResourceState></div>;
}
