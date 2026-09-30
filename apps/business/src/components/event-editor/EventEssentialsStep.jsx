import { Field, SelectField } from '../controls';
import { ImageUpload } from '../ImageUpload';

export function EventEssentialsStep({ draft, event, session, organizations, venues, canCreateIndependent, setDraft, set, onUploading }) {
  return <div className="form-grid">
    <div className="full"><ImageUpload value={draft.imageUrl} session={session} onBusy={onUploading}
      onChange={(asset) => setDraft((current) => ({ ...current, imageAssetId: asset?.id || null, imageUrl: asset?.url || null }))}/></div>
    <div className="full"><SelectField id="event-organization" label="Organization" disabled={Boolean(event)}
      value={draft.organizationId || 'independent'} onChange={(value) => {
        const organizationId = value === 'independent' ? null : value;
        const selectedOrganization = organizations.find((item) => item.id === organizationId);
        const defaultVenue = venues.find((venue) => venue.organizationId === organizationId);
        const location = selectedOrganization?.location || defaultVenue?.location;
        setDraft((current) => ({ ...current, organizationId,
          locationId: organizationId ? selectedOrganization?.locationId || defaultVenue?.locationIds?.[0] || null : null,
          location: location ? { ...location } : { name: '', addressLine1: '', city: '', region: 'FL', postalCode: '', countryCode: 'US', timezone: 'America/New_York', privacy: 'public' },
        }));
      }} options={[
        ...(canCreateIndependent || (!event?.organizationId && event) ? [['independent', 'Independent event · owned by you']] : []),
        ...organizations.filter((item) => item.canManage || item.id === event?.organizationId).map((item) => [item.id, item.name]),
      ]}/></div>
    <div className="full"><Field id="event-title" label="Event name" placeholder="Give your next night a name"
      required minLength={2} maxLength={180} value={draft.title} onChange={(event) => set('title', event.target.value)}/></div>
    <div className="full"><Field id="event-summary" label="Short description" maxLength={500}
      placeholder="The one-line invitation" value={draft.summary} onChange={(event) => set('summary', event.target.value)}/></div>
    <label className="field full"><span>About this experience</span><textarea aria-label="About this experience" rows={4}
      maxLength={20000} value={draft.description} onChange={(event) => set('description', event.target.value)}/></label>
    <Field id="event-start" label="Starts at (venue time)" type="datetime-local" required value={draft.startsAt}
      onChange={(event) => set('startsAt', event.target.value)}/>
    <Field id="event-end" label="Ends at (venue time)" type="datetime-local" required value={draft.endsAt}
      onChange={(event) => set('endsAt', event.target.value)}/>
    <p className="hint full">Enter the event’s local start and end times. Overnight events should end on the following day.</p>
  </div>;
}
