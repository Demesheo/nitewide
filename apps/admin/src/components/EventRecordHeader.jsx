import { CalendarClock, MapPin } from 'lucide-react';
import { formatDate } from '../lib/admin';
import { Button } from './ui/button';
import EventArtwork from './EventArtwork';

export default function EventRecordHeader({ event, location, locationLoading, locationError, canEdit, onEdit, onRefresh }) {
  const states = [event.status, event.lifecycleState !== 'active' ? event.lifecycleState : null].filter(Boolean);
  return <header className="event-record-heading" role="region" aria-label="Event summary">
    <EventArtwork event={event}/>
    <div className="event-record-copy"><p className="eyebrow">EVENT</p><h2>{event.title}</h2><div className="record-statuses">{[...new Set(states)].map((state) => <span key={state}>{state.replaceAll('_', ' ')}</span>)}</div></div>
    <div className="record-actions event-header-actions">{canEdit && <Button onClick={onEdit}>Edit details</Button>}<Button variant="outline" onClick={onRefresh}>Refresh record</Button></div>
    <dl className="event-header-facts"><div><dt><CalendarClock size={15} aria-hidden="true"/>Starts</dt><dd><time dateTime={event.startsAt}>{formatDate(event.startsAt, true)}</time></dd></div><div><dt>Ends</dt><dd><time dateTime={event.endsAt}>{formatDate(event.endsAt, true)}</time></dd></div><div className="event-header-location"><dt><MapPin size={15} aria-hidden="true"/>Location</dt><dd>{location ? <><strong>{location.name || 'Event location'}</strong><span>{[location.addressLine1, location.addressLine2].filter(Boolean).join(', ')}</span><span>{[location.city, location.region, location.postalCode].filter(Boolean).join(', ')}</span></> : locationLoading ? <span role="status">Loading location…</span> : <span>{locationError ? 'Location details unavailable. Refresh to retry.' : 'No location provided.'}</span>}</dd></div></dl>
  </header>;
}

export function EventRecordDetails({ event, onOpenRecord }) {
  const summary = event.summary?.trim(); const description = event.description?.trim();
  const links = [['organizationId', 'Business', 'organizations'], ['creatorUserId', 'Creator', 'users'], ['locationId', 'Location record', 'locations']].filter(([key]) => event[key]);
  return <div className="record-section-grid event-record-sections">
    <section className="record-details-group event-description"><h3>Event information</h3>{summary && <p>{summary}</p>}{description && description !== summary && <p className="event-description-text">{description}</p>}{!summary && !description && <p className="record-muted">No event description has been added.</p>}</section>
    <section className="record-details-group"><h3>Admission & discovery</h3><dl className="record-fact-list">{event.category && <div><dt>Category</dt><dd>{event.category.replaceAll('_', ' ')}</dd></div>}<div><dt>Direct guestlist limit</dt><dd>{Number(event.guestlistCapacity || 0).toLocaleString()} people</dd></div><div><dt>Reference venue capacity</dt><dd>{event.capacity == null ? 'Not set' : Number(event.capacity).toLocaleString() + ' people'}</dd></div><div><dt>Discovery</dt><dd>{event.isDiscoverable ? 'Shown in discovery' : 'Not shown in discovery'}</dd></div>{event.feeMode && <div><dt>Default fee mode</dt><dd>{event.feeMode === 'absorbed' ? 'Business absorbs fees' : 'Buyer-added fees'}</dd></div>}</dl><p className="record-muted">Paid inventory is controlled by the event’s offerings.</p></section>
    {links.length > 0 && <section className="record-details-group"><h3>Related records</h3><div className="record-link-grid">{links.map(([key, title, resource]) => <Button key={key} variant="outline" onClick={() => onOpenRecord(resource, event[key])}>View {title.toLowerCase()}</Button>)}</div></section>}
  </div>;
}
