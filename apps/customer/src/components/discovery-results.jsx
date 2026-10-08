import { CalendarDays, Compass, MapPin as MapPinIcon, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { EventCard } from './event-card';
import { LoadingIndicator } from './loading-indicator';
import { businessLink } from '../lib/business-link';
import { confirmedDiscoveryScope, qualifiedDiscoveryCity } from '../lib/discovery-selection';
import { DiscoverySort } from './discovery-controls';

const calendarLabel = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function DiscoveryDistance({ event, origin }) {
  const available = origin?.kind === 'city-center' && event.location?.privacy !== 'private' && Number.isFinite(event.distanceMiles) && event.distanceMiles >= 0;
  return <p className="card-distance">{available ? `${event.distanceMiles.toLocaleString('en-US', { maximumFractionDigits: 1 })} mi from ${origin.label} city center` : 'Distance unavailable'}</p>;
}

export function DiscoveryResults({ submitted, area, distanceOrigin, resolutionStatus, hasUpcomingAreaEvents, results, loadState, nextCursor, moreState, loadEvents, loadMore, saved, save, openEvent, weekRange, weeklyEvents, previewState, previewCursor, visible, onFiltersChange }) {
  const confirmedScope = confirmedDiscoveryScope(area, resolutionStatus);
  const comingSoon = loadState === 'ready' && confirmedScope && hasUpcomingAreaEvents === false && !results.length;
  const coverageUnconfirmed = !confirmedScope || hasUpcomingAreaEvents == null;
  return <>
    <section id="discover" className="discovery wrap">
      <div className="section-heading discovery-heading">
        <p className="eyebrow">GO WHERE THE NIGHT TAKES YOU</p>
        <h2>The night is <span className="heading-accent">yours.</span></h2>
        <DiscoverySort sort={submitted.sort} disabled={!qualifiedDiscoveryCity(submitted.city)} onChange={onFiltersChange}/>
      </div>
      {loadState === 'unselected' ? <div className="empty-state"><MapPinIcon /><h3>Choose an area to find your night.</h3><p>Enter a city with its state or region above, then select Find my night. For places outside the US, include the country too.</p></div>
        : loadState === 'loading' ? <div className="event-grid" aria-label="Loading events" role="status" aria-busy="true">{[1, 2, 3].map((index) => <div className="skeleton-card" key={index}><div /><span /><span /></div>)}</div>
        : loadState === 'error' ? <div className="empty-state"><Compass /><h3>The night’s still out there.</h3><p>We couldn’t load events. Check your connection and try again.</p><Button onClick={loadEvents}>Try again</Button></div>
          : comingSoon ? <div className="empty-state coming-soon-state"><Compass /><h3>Nitewide coming soon to {area.city || submitted.city.split(',')[0]}</h3><p>Event creators and businesses: request access to <a href={businessLink(import.meta.env.VITE_BUSINESS_URL, window.location)}>Nitewide Business</a> to bring your experiences to this area.</p><p className="coming-soon-note">Already planning your next night? Try another area above.</p></div>
          : results.length ? <>
            {loadState === 'refreshing' && <p className="results-refresh" role="status">Updating results…</p>}
            {loadState === 'error-refresh' && <p className="results-refresh" role="alert">Couldn’t update results. Showing your previous results. <button type="button" onClick={loadEvents}>Try again</button></p>}
            {(area?.kind === 'radius' || coverageUnconfirmed) && <p className="discovery-area-hint">{area?.kind === 'radius' ? 'Nearby results include only public event locations with confirmed coordinates.' : 'Nearby coverage is not fully confirmed. These matches use the qualified city you selected.'}</p>}
            <div className="event-grid">{results.map((event) => <EventCard key={event.id} event={event} saved={saved.includes(event.id)} onSave={() => save(event)} onOpen={() => openEvent(event)}>{submitted.sort === 'distance' && <DiscoveryDistance event={event} origin={distanceOrigin}/>}</EventCard>)}</div>
            {nextCursor && <Button variant="outline" className="load-more" disabled={moreState === 'loading'} onClick={() => loadMore()}>{moreState === 'loading' ? 'Loading more nights…' : moreState === 'error' ? 'Retry more nights' : 'More nights, more possibilities'} <Plus size={17} /></Button>}
            {moreState === 'expired' && <p className="results-refresh" role="status">These results have expired. <button type="button" onClick={loadEvents}>Refresh results</button></p>}
          </> : coverageUnconfirmed ? <div className="empty-state"><MapPinIcon /><h3>Nearby coverage is not confirmed yet.</h3><p>{area?.kind === 'radius' ? 'Nearby results include only public event locations with confirmed coordinates. This city-center radius may not include every event in the area.' : 'We couldn’t confirm this city’s metro or nearby area. Choose a suggested city, or check the city, state or region, and country.'}</p><p>Try another date, search or area. This is not a confirmation that this area has no upcoming events.</p></div>
          : <div className="empty-state"><CalendarDays /><h3>{submitted.query ? 'No experiences match this search.' : submitted.date ? 'No experiences on this date.' : 'No upcoming experiences match these filters.'}</h3><p>{submitted.query ? 'Try another search or date in this area.' : submitted.date ? 'Upcoming events for the following week are shown below.' : 'Try another date or search in this area.'}</p></div>}
    </section>
    {loadState === 'ready' && confirmedScope && !comingSoon && submitted.date && !results.length && visible && <section className="upcoming-preview wrap">
      <div className="section-heading"><h2>Upcoming this week.</h2></div>
      <p className="results-summary">{calendarLabel(weekRange.start)} – {calendarLabel(weekRange.end)} · {submitted.city}</p>
      <div className="event-grid">{weeklyEvents.map((event) => <EventCard key={event.id} event={event} saved={saved.includes(event.id)} onSave={() => save(event)} onOpen={() => openEvent(event)}>{submitted.sort === 'distance' && <DiscoveryDistance event={event} origin={distanceOrigin}/>}</EventCard>)}</div>
      {previewState === 'loading' && <LoadingIndicator>Finding the following week…</LoadingIndicator>}
      {previewState === 'error' && <div className="empty-state"><p>We couldn’t load the following week.</p><Button onClick={loadEvents}>Try again</Button></div>}
      {previewState === 'ready' && !weeklyEvents.length && <div className="empty-state"><CalendarDays /><h3>No matches in this seven-day window.</h3><p>{coverageUnconfirmed ? 'Nearby coverage is incomplete. Try another date, city or search.' : 'Try another city or search to find more events.'}</p></div>}
      {previewCursor && <Button variant="outline" className="load-more" disabled={previewState === 'loading-more'} onClick={() => loadMore(true)}>{previewState === 'loading-more' ? 'Loading more nights…' : previewState === 'error-more' ? 'Retry more from this week' : 'Show more from this week'} <Plus size={17} /></Button>}
      {previewState === 'expired' && <p className="results-refresh" role="status">These results have expired. <button type="button" onClick={loadEvents}>Refresh results</button></p>}
    </section>}
  </>;
}
