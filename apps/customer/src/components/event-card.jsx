import { Heart, MapPin, ArrowUpRight } from "lucide-react";
import { Badge } from "./ui/badge";
import { cityName, eventStartingPrice, feeLabel, money } from "../lib/discovery";
import { eventDate, eventTime } from "../lib/presentation";
import { EventArtwork } from "./event-artwork";
import { isPremiumHost } from '../lib/premium-host';
import { eventVenueName } from '../lib/event-venue';
export function EventCard({ event, saved, onSave, onOpen, children, actionLabel }) {
  const lowest = eventStartingPrice(event);
  return (
    <article data-testid="customer-event-card" data-event-id={event.id} className={`event-card${isPremiumHost(event) ? ' premium-host-card' : ''}`} onClick={(click) => { if (!click.target.closest('button')) onOpen?.(); }}>
      <div className="card-image">
        <div className="image-link">
          <EventArtwork event={event} loading="lazy" />
        </div>
        {isPremiumHost(event) && <span className="premium-host-badge"><span aria-hidden="true">✦</span> PREMIUM HOST</span>}
      </div>
      <div className="card-copy">
        <div className="card-meta">
          {event.category !== "nightlife" && (
            <Badge className="card-category">
              {(event.category || 'experience').replaceAll("_", " ").toUpperCase()}
            </Badge>
          )}
          <button
            type="button"
            className={`save-button ${saved ? "saved" : ""}`}
            aria-label={`${saved ? "Unsave" : "Save"} ${event.title}`}
            aria-pressed={saved}
            onClick={(click) => { click.stopPropagation(); onSave?.(); }}
          >
            <Heart size={17} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="card-date">
          <time dateTime={event.startsAt}>{eventDate(event)} <span>· {eventTime(event)}</span></time>
        </p>
        <p className="venue-name">
          {eventVenueName(event)}
        </p>
        <h3 className="card-title">
          <button
            type="button"
            className="card-open"
            onClick={(click) => { click.stopPropagation(); onOpen?.(); }}
            aria-label={`Explore ${event.title}`}
          >
            <span className="card-title-text">{event.title}</span>
          </button>
        </h3>
        <p className="card-location">
          <MapPin size={13} />
          {cityName(event)}
          {event.location?.region ? `, ${event.location.region}` : ""}
        </p>
        {children}
        <div className="card-bottom">
          <span className="card-price">
            {actionLabel || (lowest === null ? (
              event.guestlistCapacity > 0 ? "Explore guestlist" : "View event"
            ) : lowest.total === 0 ? (
              "Free admission"
            ) : (
              <>
                <span className="upfront-total"><small>From</small> {money(lowest.total, lowest.currency)} <small>total{lowest.quantity > 1 ? ` for ${lowest.quantity}` : ''}</small></span>
                <small>{feeLabel(lowest, lowest.currency)}</small>
              </>
            ))}
          </span>
          <span className="card-arrow" aria-hidden="true">
            <ArrowUpRight size={21} />
          </span>
        </div>
      </div>
    </article>
  );
}
