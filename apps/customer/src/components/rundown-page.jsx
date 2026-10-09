import { useEffect } from 'react';
import { ArrowDown, ArrowUpRight, CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { EventArtwork } from './event-artwork';
import { LoadingIndicator } from './loading-indicator';
import { eventStartingPrice, money } from '../lib/discovery';
import { eventVenueName } from '../lib/event-venue';
import { eventDate, eventTime } from '../lib/presentation';
import { useRundown } from '../lib/use-rundown';
import './rundown-page.css';
import { eventPublicHref, ordinaryLinkClick } from '../../../shared/public-links.mjs';

function dateLabel(event) {
  if (!event.startsAt || Number.isNaN(new Date(event.startsAt).getTime())) return 'Date to be confirmed';
  try { return `${eventDate(event)} · ${eventTime(event)}`; }
  catch { return 'Date to be confirmed'; }
}

function priceLabel(event) {
  const lowest = eventStartingPrice(event);
  if (!lowest) return event.guestlistCapacity > 0 ? 'Guestlist available' : 'View event';
  if (lowest.total === 0) return 'Free';
  return `From ${money(lowest.total, lowest.currency)} total${lowest.quantity > 1 ? ` for ${lowest.quantity}` : ''}`;
}

export function RundownCard({ event, onOpenEvent }) {
  const location = [eventVenueName(event), event.location?.city].filter(Boolean).join(' · ');
  return <article className="rundown-card" data-testid="rundown-event-card" data-event-id={event.id}>
    <a href={eventPublicHref(event.id, event.referralCode)} className="rundown-card-open" aria-label={`View ${event.title}`} onClick={click => {
      if (onOpenEvent && ordinaryLinkClick(click)) { click.preventDefault(); onOpenEvent(event); }
    }}>
      <EventArtwork event={event} className="rundown-flyer" loading="lazy" />
      <span className="rundown-card-copy">
        <span className="rundown-card-title" title={event.title}>{event.title}</span>
        <time className="rundown-card-date" dateTime={event.startsAt}>{dateLabel(event)}</time>
        <span className="rundown-card-location" title={location}>{location}</span>
        <span className="rundown-card-bottom"><span>{priceLabel(event)}</span><ArrowUpRight size={13} aria-hidden="true" /></span>
      </span>
    </a>
  </article>;
}

export function RundownPage({ rundownId, onOpenEvent, preview, session, onSignIn, onMetadata }) {
  const { profile, items, loadState, error, moreState, moreError, hasMore, reload, loadMore } = useRundown(rundownId, { preview, session });
  useEffect(() => { onMetadata?.({ id: rundownId, profile, items, loadState }); }, [onMetadata, rundownId, profile, items, loadState]);
  return <main className="rundown-page wrap" id="rundown" aria-labelledby="rundown-title">
    <header className="rundown-heading">
      <p className="eyebrow">{preview ? 'YOUR RUNDOWN' : 'THE RUNDOWN'}</p>
      <h1 id="rundown-title">{profile ? `${profile.name}’s Rundown` : 'Rundown.'}</h1>
      <p className="rundown-heading-note">{preview ? 'Preview · ' : ''}Upcoming nights · Soonest first</p>
    </header>
    {loadState === 'loading' ? <div className="rundown-loading"><LoadingIndicator>Loading the rundown…</LoadingIndicator></div>
      : loadState === 'sign-in' ? <div className="rundown-state"><CalendarDays size={24} aria-hidden="true" /><h2>Sign in to view your rundown.</h2><p>Use the account connected to your events or business team.</p><Button variant="outline" onClick={onSignIn}>Sign in</Button></div>
      : loadState === 'unavailable' ? <div className="rundown-state"><CalendarDays size={24} aria-hidden="true" /><h2>This rundown isn’t available.</h2><p>Check the link or find your next night on Nitewide.</p><a className="rundown-discover" href="/">Discover events <ArrowUpRight size={15} aria-hidden="true" /></a></div>
      : loadState === 'error' ? <div className="rundown-state" role="alert"><h2>The rundown couldn’t load.</h2><p>{error}</p><Button variant="outline" onClick={reload}>Try again</Button></div>
      : <>
        {items.length ? <div className="rundown-grid" aria-label="Rundown events" aria-busy={moreState === 'loading'}>{items.map(event => <RundownCard key={event.id} event={event} onOpenEvent={onOpenEvent} />)}</div>
          : <div className="rundown-state"><CalendarDays size={24} aria-hidden="true" /><h2>{hasMore ? 'No events on this page.' : 'No upcoming events yet.'}</h2><p>{hasMore ? 'View more to see the next events.' : 'Check back for the next nights on this rundown.'}</p></div>}
        {moreError && <p className="rundown-more-error" role="alert">{moreError}</p>}
        {hasMore && <div className="rundown-more"><Button variant="outline" disabled={moreState === 'loading'} aria-busy={moreState === 'loading'} onClick={loadMore}>
          {moreState === 'loading' ? <LoadingIndicator>Loading more…</LoadingIndicator> : <>{moreState === 'error' ? 'Try again' : 'View more'} <ArrowDown size={15} aria-hidden="true" /></>}
        </Button></div>}
      </>}
  </main>;
}
