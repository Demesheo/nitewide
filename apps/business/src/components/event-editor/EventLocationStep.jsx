import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Field, SelectField } from '../controls';
import AsyncVenuePicker from '../AsyncVenuePicker';

export function EventLocationStep({ draft, organization, setDraft, set, loc, session, request, audience }) {
  const venueOnly = organization?.canCreateEvents && !organization?.canManage && audience !== 'admin';
  const [mode, setMode] = useState(draft.locationId || venueOnly || draft.locationMode === 'saved' ? 'saved' : 'address');
  useEffect(() => setMode(draft.locationId || venueOnly || draft.locationMode === 'saved' ? 'saved' : 'address'), [draft.organizationId, venueOnly]);
  const savedMode = Boolean(draft.organizationId && (mode === 'saved' || venueOnly));
  function chooseVenue(venue) {
    const location = Object.fromEntries(['name', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode', 'timezone', 'privacy', 'latitude', 'longitude'].map((key) => [key, venue[key]]));
    setDraft((current) => ({ ...current, locationMode: 'saved', locationId: venue.id, location }));
  }
  return <div className="form-grid">
    {draft.organizationId && !venueOnly && <div className="full"><SelectField id="event-location-mode" label="Event location"
      value={mode} onChange={(value) => { setMode(value); setDraft((current) => ({ ...current, locationMode: value, locationId: null })); }}
      options={[["address", "Enter a venue name and address"], ["saved", "Use a saved business venue"]]}/></div>}
    {savedMode ? <>
      <div className="full"><AsyncVenuePicker organizationId={draft.organizationId} session={session} request={request} audience={audience}
        value={draft.locationId} onSelect={chooseVenue}/></div>
      {draft.locationId && <div className="venue-address-card full"><MapPin size={22}/><div><strong>{draft.location.name || organization?.name}</strong>
        <p>{draft.location.addressLine1}</p><p>{[draft.location.city, draft.location.region, draft.location.postalCode].filter(Boolean).join(', ')}</p>
        <small>Uses the saved venue address. Changing venue keeps the local times entered for this event.</small></div></div>}
    </> : <>
      <Field id="venue-name" label="Venue / location name" value={draft.location.name || ''}
        onChange={(event) => loc('name', event.target.value)} maxLength={180}/>
      <div className="full"><Field id="venue-address" label="Street address" maxLength={180}
        value={draft.location.addressLine1 || ''} onChange={(event) => loc('addressLine1', event.target.value)}/></div>
      <Field id="venue-city" label="City" required maxLength={100} value={draft.location.city}
        onChange={(event) => loc('city', event.target.value)}/>
      <Field id="venue-region" label="State / region" maxLength={100} value={draft.location.region || ''}
        onChange={(event) => loc('region', event.target.value)}/>
      <Field id="venue-postal" label="ZIP / postal code" maxLength={24} value={draft.location.postalCode || ''}
        onChange={(event) => loc('postalCode', event.target.value)}/>
      <Field id="venue-country" label="Country code" minLength={2} maxLength={2} required value={draft.location.countryCode}
        onChange={(event) => loc('countryCode', event.target.value.toUpperCase())}/>
      <SelectField id="venue-privacy" label="Location visibility" value={draft.location.privacy}
        onChange={(value) => loc('privacy', value)} options={[
          ['public', 'Public address'], ['attendees_only', 'Attendees only'], ['private', 'Private'],
        ]}/>
    </>}
    <Field id="guestlist-capacity" label="Direct guestlist limit (people)" type="number" min={0} max={1000000} required
      value={draft.guestlistCapacity} onChange={(event) => set('guestlistCapacity', event.target.value)}/>
    <Field id="event-capacity" label="Reference venue capacity (optional)" type="number" min={0} max={1000000}
      value={draft.capacity} onChange={(event) => set('capacity', event.target.value)}/>
    <p className="hint full">Direct guestlist and promoter allocations are separate pools. Venue capacity is informational;
      paid inventory is controlled per tier. Keep their combined admissions within your venue’s safe occupancy.</p>
  </div>;
}
