import { MapPin } from 'lucide-react';
import { Field, SelectField } from '../controls';

export function EventLocationStep({ draft, organization, savedVenues, setDraft, set, loc }) {
  return <div className="form-grid">
    {draft.organizationId ? <>
      <div className="full"><SelectField id="event-saved-venue" label="Saved venue"
        value={savedVenues.find((venue) => venue.locationIds.includes(draft.locationId))?.id || ''}
        onChange={(id) => { const selected = savedVenues.find((venue) => venue.id === id);
          if (selected) setDraft((current) => ({ ...current, locationId: selected.locationIds[0], location: { ...selected.location } })); }}
        options={savedVenues.map((venue) => [venue.id, venue.label])}/></div>
      <div className="venue-address-card full"><MapPin size={22}/><div><strong>{draft.location.name || organization?.name}</strong>
        <p>{draft.location.addressLine1}</p><p>{[draft.location.city, draft.location.region, draft.location.postalCode].filter(Boolean).join(', ')}</p>
        <small>Uses the saved venue address. Changing venue keeps the local times entered for this event.</small></div></div>
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
